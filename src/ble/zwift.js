// Manettes Zwift Play (et Zwift Click / Ride) en Bluetooth.
//
// Protocole documenté par la communauté (SwiftControl/BikeControl, zwiftplay d'ajchellew, blog Makinolo) :
//  - service 00000001-19ca-... (firmware 1.x) ou 0xFC82 (firmware 2.x / Zwift Ride)
//  - on s'abonne à Async (notify) et Sync TX (indicate), puis on écrit "RideOn" sur Sync RX
//  - la manette répond "RideOn" + 2 octets, puis envoie des messages [type][protobuf]
//      0x07 = Zwift Play firmware 1.x (PlayKeyPadStatus, 0 = appuyé)
//      0x23 = Zwift Ride / Play firmware 2.x (masque de boutons, bit à 0 = appuyé)
//      0x37 = Zwift Click, 0x19 = batterie, 0x15 = "rien de neuf" (keep-alive)
import { hex, startsWith, decodeProtobuf, protobufToString, zigzag } from './bytes.js';
import {
  SERVICES,
  realRequestDevice,
  connectGatt,
  dumpGatt,
  getServiceOrNull,
  getCharOrNull,
  readDeviceInfo,
  readBattery,
  subscribe,
  GattQueue,
} from './gatt.js';
import { info, warn, debug } from './log.js';

const CHAR_ASYNC = '00000002-19ca-4651-86e5-fa29dcdd09d1';
const CHAR_SYNC_RX = '00000003-19ca-4651-86e5-fa29dcdd09d1';
const CHAR_SYNC_TX = '00000004-19ca-4651-86e5-fa29dcdd09d1';
const RIDE_ON = [0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e];
const VIBRATE = [0x12, 0x12, 0x08, 0x0a, 0x06, 0x08, 0x02, 0x10, 0x00, 0x18, 0x20];

export const MSG = { PLAY: 0x07, EMPTY: 0x15, BATTERY: 0x19, RIDE: 0x23, CLICK: 0x37, LOST_CONTROL: 0xfe };

const MSG_NAMES = {
  0x07: 'boutons (Play fw1)',
  0x15: 'vide',
  0x19: 'batterie',
  0x1a: 'statut batterie',
  0x23: 'boutons (Ride / Play fw2)',
  0x2a: 'log interne',
  0x37: 'boutons (Click)',
  0x3c: 'réponse GET',
  0x3e: 'réponse statut',
  0x52: 'RideOn',
  0xfe: 'contrôle perdu (Zwift a pris la manette ?)',
};

// Boutons logiques, communs à toutes les manettes.
export const BUTTONS = {
  L_UP: 'Gauche ▲',
  L_LEFT: 'Gauche ◀',
  L_RIGHT: 'Gauche ▶',
  L_DOWN: 'Gauche ▼',
  L_SHIFT: 'Gauche bouton latéral',
  L_PADDLE: 'Gauche levier',
  L_ON: 'Gauche power',
  L_SHIFT2: 'Gauche shift 2 (Ride)',
  L_POWERUP: 'Gauche power-up (Ride)',
  R_Y: 'Droite Y',
  R_Z: 'Droite Z',
  R_A: 'Droite A',
  R_B: 'Droite B',
  R_SHIFT: 'Droite bouton latéral',
  R_PADDLE: 'Droite levier',
  R_ON: 'Droite power',
  R_SHIFT2: 'Droite shift 2 (Ride)',
  R_POWERUP: 'Droite power-up (Ride)',
};

const PADDLE_THRESHOLD = 25;

// Masques du protocole Ride / Play fw2 (bit à 0 = appuyé).
const RIDE_MASKS = [
  [0x00001, 'L_LEFT'], [0x00002, 'L_UP'], [0x00004, 'L_RIGHT'], [0x00008, 'L_DOWN'],
  [0x00010, 'R_A'], [0x00020, 'R_B'], [0x00040, 'R_Y'], [0x00080, 'R_Z'],
  [0x00100, 'L_SHIFT'], [0x00200, 'L_SHIFT2'], [0x01000, 'R_SHIFT'], [0x02000, 'R_SHIFT2'],
  [0x00400, 'L_POWERUP'], [0x04000, 'R_POWERUP'], [0x00800, 'L_ON'], [0x08000, 'R_ON'],
];

function fieldMap(fields) {
  const m = new Map();
  for (const f of fields) {
    if (f.wire === 2) {
      if (!m.has(f.field)) m.set(f.field, []);
      m.get(f.field).push(f.value);
    } else m.set(f.field, f.value);
  }
  return m;
}

// Décode un message boutons. Renvoie { side, pressed:Set, analog:{L,R} } ou null.
export function decodeButtons(type, payload) {
  const f = fieldMap(decodeProtobuf(payload));
  const pressed = new Set();
  const analog = {};
  // En protobuf un champ absent vaut 0, et 0 = ON = appuyé.
  const on = (n) => (f.get(n) ?? 0) === 0;

  if (type === MSG.PLAY) {
    const right = on(1);
    const side = right ? 'R' : 'L';
    const names = right ? ['R_Y', 'R_Z', 'R_A', 'R_B', 'R_SHIFT', 'R_ON'] : ['L_UP', 'L_LEFT', 'L_RIGHT', 'L_DOWN', 'L_SHIFT', 'L_ON'];
    names.forEach((name, i) => on(i + 2) && pressed.add(name));
    const lr = zigzag(f.get(8) ?? 0);
    analog[side] = lr;
    if (Math.abs(lr) >= PADDLE_THRESHOLD) pressed.add(`${side}_PADDLE`);
    return { side, pressed, analog };
  }

  if (type === MSG.RIDE) {
    const map = f.get(1);
    let side = null;
    if (map !== undefined) {
      for (const [mask, name] of RIDE_MASKS) if ((map & mask) === 0) pressed.add(name);
    }
    for (const sub of f.get(3) || []) {
      const p = fieldMap(decodeProtobuf(sub));
      const loc = p.get(1) ?? 0;
      const value = zigzag(p.get(2) ?? 0);
      if (loc === 0 || loc === 1) {
        const s = loc === 0 ? 'L' : 'R';
        analog[s] = value;
        side = side || s;
        if (Math.abs(value) >= PADDLE_THRESHOLD) pressed.add(`${s}_PADDLE`);
      }
    }
    return { side, pressed, analog };
  }

  if (type === MSG.CLICK) {
    if (on(1)) pressed.add('R_SHIFT');
    if (on(2)) pressed.add('L_SHIFT');
    return { side: null, pressed, analog };
  }
  return null;
}

export class ZwiftController extends EventTarget {
  constructor({ requestDevice = realRequestDevice } = {}) {
    super();
    this.requestDevice = requestDevice;
    this.queue = new GattQueue();
    this.pressed = new Set();
    this.analog = {};
    this.side = null;
    this.protocol = null;
    this.battery = null;
    this.handshake = false;
    this.connected = false;
    this.counts = {};
    this.lastRaw = '';
  }

  get name() {
    return this.device?.name || 'Manette Zwift';
  }

  get src() {
    return `zwift${this.side ? '-' + this.side : ''}`;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async connect({ acceptAll = false } = {}) {
    const optionalServices = [SERVICES.ZWIFT, SERVICES.ZWIFT_FW2, SERVICES.BATTERY, SERVICES.DIS];
    const options = acceptAll
      ? { acceptAllDevices: true, optionalServices }
      : {
          // Filtre par nom seulement : le filtre manufacturerData (0x094A) n'est pas compris par Bluefy sur iPad.
          filters: [{ namePrefix: 'Zwift' }],
          optionalServices,
        };
    info('zwift', 'Ouverture du sélecteur Bluetooth (manette Zwift)...');
    this.device = await this.requestDevice(options);
    info('zwift', `Appareil choisi : "${this.device.name || '(sans nom)'}" id=${this.device.id}`);
    this.emit('selected');
    this.device.addEventListener('gattserverdisconnected', () => {
      this.connected = false;
      this.handshake = false;
      warn(this.src, `"${this.name}" déconnectée`);
      this.release();
      this.emit('disconnected');
    });
    await this.setup();
  }

  async setup() {
    const src = 'zwift';
    this.server = await connectGatt(this.device, src);
    this.connected = true;
    await dumpGatt(this.server, src);
    this.deviceInfo = await readDeviceInfo(this.server, src);
    this.battery = await readBattery(this.server, src);

    const service =
      (await getServiceOrNull(this.server, SERVICES.ZWIFT_FW2)) || (await getServiceOrNull(this.server, SERVICES.ZWIFT));
    if (!service) {
      throw new Error(
        'Service Zwift introuvable. Ferme Zwift et Zwift Companion (la manette ne parle qu’à une appli à la fois), ' +
          'puis réessaie. Si ça persiste, le firmware est peut-être verrouillé.',
      );
    }
    info(src, `Service Zwift trouvé : ${service.uuid}`);
    const async = await getCharOrNull(service, CHAR_ASYNC);
    const syncTx = await getCharOrNull(service, CHAR_SYNC_TX);
    this.syncRx = await getCharOrNull(service, CHAR_SYNC_RX);
    if (!async || !syncTx || !this.syncRx) throw new Error('Caractéristiques Zwift manquantes (async/syncTx/syncRx)');

    await subscribe(async, (b) => this.onMessage(b, 'async'));
    await subscribe(syncTx, (b) => this.onMessage(b, 'syncTx'));
    info(src, 'Abonné aux notifications, envoi de la poignée de main "RideOn"...');
    await this.write(RIDE_ON);
    setTimeout(() => {
      if (this.connected && !this.handshake) {
        warn(this.src, 'Pas de réponse "RideOn" après 3 s. Appuie sur un bouton de la manette, sinon regarde le journal.');
      }
    }, 3000);
    this.emit('connected');
  }

  write(bytes) {
    const data = Uint8Array.from(bytes);
    const c = this.syncRx;
    return this.queue.run(() => {
      debug(this.src, `→ ${hex(data)}`);
      if (c.properties?.writeWithoutResponse && c.writeValueWithoutResponse) return c.writeValueWithoutResponse(data);
      if (c.writeValueWithResponse) return c.writeValueWithResponse(data);
      return c.writeValue(data);
    });
  }

  async vibrate() {
    if (!this.syncRx) throw new Error('Manette non connectée');
    info(this.src, 'Vibration demandée');
    await this.write(VIBRATE);
  }

  onMessage(b, channel) {
    if (!b.length) return;
    if (startsWith(b, RIDE_ON)) {
      this.handshake = true;
      info(this.src, `Poignée de main OK ✔ (réponse sur ${channel} : ${hex(b.slice(0, 12))}${b.length > 12 ? '…' : ''})`);
      this.emit('handshake');
      return;
    }
    const type = b[0];
    const payload = b.subarray(1);
    this.counts[type] = (this.counts[type] || 0) + 1;

    if (type === MSG.EMPTY) return;
    if (type === MSG.BATTERY) {
      try {
        const f = fieldMap(decodeProtobuf(payload));
        const level = f.get(2) ?? f.get(1);
        if (level !== undefined && level !== this.battery) {
          this.battery = level;
          info(this.src, `Batterie : ${level} %`);
          this.emit('battery', level);
        }
      } catch {
        debug(this.src, `Batterie illisible : ${hex(b)}`);
      }
      return;
    }
    if (type === MSG.LOST_CONTROL) {
      warn(this.src, 'La manette signale "contrôle perdu" : une autre appli (Zwift ?) s’y est connectée.');
      return;
    }

    let decoded = null;
    try {
      decoded = decodeButtons(type, payload);
    } catch (e) {
      warn(this.src, `Message 0x${type.toString(16)} illisible (${hex(b)}) : ${e.message}`);
      return;
    }
    if (!decoded) {
      debug(this.src, `Message ${MSG_NAMES[type] || '0x' + type.toString(16)} sur ${channel} : ${hex(b)} → ${protobufToString(payload)}`);
      return;
    }

    if (!this.protocol) {
      this.protocol = type === MSG.PLAY ? 'Zwift Play fw1' : type === MSG.RIDE ? 'Zwift Ride / Play fw2' : 'Zwift Click';
      info('zwift', `Protocole détecté : ${this.protocol}`);
    }
    if (decoded.side && decoded.side !== this.side) {
      this.side = decoded.side;
      info(this.src, `Manette identifiée : côté ${this.side === 'L' ? 'GAUCHE' : 'DROIT'}`);
      this.emit('side', this.side);
    }
    Object.assign(this.analog, decoded.analog);

    // Les manettes répètent le même état : on ne journalise que les changements.
    const raw = hex(b);
    const changed = raw !== this.lastRaw;
    this.lastRaw = raw;
    const before = [...this.pressed].sort().join(',');
    const after = [...decoded.pressed].sort().join(',');
    if (before !== after) {
      info(this.src, `Boutons : [${after || 'aucun'}]  (${raw})`);
      this.setPressed(decoded.pressed);
    } else if (changed) {
      debug(this.src, `Analogique ${JSON.stringify(this.analog)} (${raw})`);
    }
    this.emit('analog', { ...this.analog });
  }

  setPressed(next) {
    for (const b of next) if (!this.pressed.has(b)) this.emit('buttondown', b);
    for (const b of this.pressed) if (!next.has(b)) this.emit('buttonup', b);
    this.pressed = new Set(next);
    this.emit('buttons', new Set(this.pressed));
  }

  release() {
    this.setPressed(new Set());
  }

  async reconnect() {
    await this.setup();
  }
}
