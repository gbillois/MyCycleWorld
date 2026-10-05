// Inspecteur BLE : pour une machine qui ne parle pas (ou pas tout à fait) le FTMS standard.
// Il se connecte à n'importe quel appareil, liste services et caractéristiques, lit tout ce qui est lisible
// et s'abonne à tout ce qui notifie, y compris les caractéristiques propriétaires, en journalisant les octets bruts.
// Le journal (console, copie, téléchargement) permet ensuite d'écrire le décodeur adapté.
import { hex, uuidName, propsList, toBytes } from './bytes.js';
import { ALL_OPTIONAL_SERVICES, realRequestDevice, connectGatt, readDeviceInfo } from './gatt.js';
import { info, warn, debug } from './log.js';

const SRC = 'inspecteur';

// Web Bluetooth ne donne accès qu'aux services déclarés à l'avance : on ajoute les plus courants
// chez les fabricants (UART série, services « maison » fréquents), en plus des services de fitness.
export const EXTRA_SERVICES = [
  0x1814, // Running Speed & Cadence
  0x181c, // User Data
  0xffe0, // série type HM-10
  0xfff0, // service fabricant fréquent
  0xfee0,
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
  'a913bfc0-929e-11e5-b928-0002a5d5c51b', // Technogym (vélos, vu dans qdomyos-zwift)
];

// « 1826, fff0, 6e400001-b5a3-... » -> [0x1826, 0xfff0, '6e400001-...'] (les entrées invalides sont ignorées)
export function parseServiceList(text = '') {
  return text
    .split(/[\s,;]+/)
    .map((t) => t.trim().toLowerCase().replace(/^0x/, ''))
    .filter(Boolean)
    .map((t) => (/^[0-9a-f]{4}$/.test(t) ? parseInt(t, 16) : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(t) ? t : null))
    .filter((t) => t !== null);
}

// Texte lisible si les octets sont de l'ASCII imprimable (noms, numéros de série, versions).
export function asciiOf(bytes) {
  const b = toBytes(bytes);
  if (!b.length || ![...b].every((c) => (c >= 32 && c < 127) || c === 0)) return null;
  return String.fromCharCode(...b.filter((c) => c)).trim() || null;
}

export class BleInspector extends EventTarget {
  constructor({ requestDevice = realRequestDevice } = {}) {
    super();
    this.requestDevice = requestDevice;
    this.chars = new Map(); // uuid -> { service, props, packets, last }
    this.device = null;
  }

  get running() {
    return !!this.device?.gatt?.connected;
  }

  get packets() {
    let n = 0;
    for (const c of this.chars.values()) n += c.packets;
    return n;
  }

  async inspect({ extraServices = [] } = {}) {
    this.stop();
    this.chars.clear();
    const optionalServices = [...new Set([...ALL_OPTIONAL_SERVICES, ...EXTRA_SERVICES, ...extraServices])];
    info(SRC, `Sélecteur ouvert (tous les appareils). Services demandés : ${optionalServices.map((u) => uuidName(typeof u === 'number' ? `0000${u.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb` : u)).join(', ')}`);
    this.device = await this.requestDevice({ acceptAllDevices: true, optionalServices });
    info(SRC, `Appareil : "${this.device.name || '(sans nom)'}" id=${this.device.id}`);
    this.device.addEventListener('gattserverdisconnected', () => {
      info(SRC, `Déconnecté. Résumé : ${this.summary()}`);
      this.dispatchEvent(new Event('change'));
    });
    const server = await connectGatt(this.device, SRC);
    await readDeviceInfo(server, SRC);
    let services = [];
    try {
      services = await server.getPrimaryServices();
    } catch (e) {
      warn(SRC, `Liste des services refusée (${e.message}) : essai service par service.`);
      for (const u of optionalServices) {
        try {
          services.push(await server.getPrimaryService(u));
        } catch {
          /* absent */
        }
      }
    }
    info(SRC, `${services.length} service(s) accessible(s). Les services non déclarés restent invisibles : voir chrome://bluetooth-internals pour la liste complète.`);
    for (const s of services) {
      info(SRC, `• Service ${uuidName(s.uuid)}`);
      let chars = [];
      try {
        chars = await s.getCharacteristics();
      } catch (e) {
        warn(SRC, `  caractéristiques illisibles : ${e.message}`);
        continue;
      }
      for (const c of chars) await this.probe(s, c);
    }
    info(SRC, `Écoute en cours : fais tourner la machine (pédale, rame, démarre une séance). ${this.chars.size} caractéristique(s).`);
    this.dispatchEvent(new Event('change'));
  }

  async probe(service, c) {
    const name = uuidName(c.uuid);
    const props = propsList(c.properties);
    const entry = { service: service.uuid, name, props, packets: 0, last: null };
    this.chars.set(c.uuid, entry);
    info(SRC, `  - ${name} (${props || 'aucune propriété'})`);
    if (c.properties.read) {
      try {
        const v = toBytes(await c.readValue());
        const text = asciiOf(v);
        info(SRC, `      lu : ${hex(v) || '(vide)'}${text ? `  « ${text} »` : ''}`);
        entry.last = hex(v);
      } catch (e) {
        warn(SRC, `      lecture refusée : ${e.message}`);
      }
    }
    if (c.properties.notify || c.properties.indicate) {
      c.addEventListener('characteristicvaluechanged', (ev) => {
        const v = toBytes(ev.target.value);
        entry.packets++;
        entry.last = hex(v);
        // Les 30 premiers paquets de chaque caractéristique, puis 1 sur 20.
        if (entry.packets <= 30 || entry.packets % 20 === 0) debug(SRC, `${name} #${entry.packets} : ${hex(v)}`);
        if (entry.packets % 10 === 0) this.dispatchEvent(new Event('change'));
      });
      try {
        await c.startNotifications();
        info(SRC, `      abonné (${c.properties.notify ? 'notify' : 'indicate'})`);
      } catch (e) {
        warn(SRC, `      abonnement refusé : ${e.message}`);
      }
    }
  }

  summary() {
    const parts = [...this.chars.values()].filter((c) => c.packets).map((c) => `${c.name} : ${c.packets} paquets, dernier ${c.last}`);
    return parts.length ? parts.join(' | ') : 'aucun paquet reçu';
  }

  stop() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }
}
