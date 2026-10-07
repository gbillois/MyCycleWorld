// Home trainer : lecture puissance/cadence/vitesse (FTMS ou Cycling Power) et pilotage de la résistance (FTMS).
import { hex } from './bytes.js';
import {
  SERVICES,
  ALL_OPTIONAL_SERVICES,
  realRequestDevice,
  connectGatt,
  dumpGatt,
  getServiceOrNull,
  getCharOrNull,
  readDeviceInfo,
  subscribe,
  GattQueue,
  writeChar,
} from './gatt.js';
import { info, warn, debug, packetSampler } from './log.js';

const SRC = 'trainer';

const CHAR = {
  FTMS_FEATURE: 0x2acc,
  TREADMILL_DATA: 0x2acd,
  CROSS_TRAINER_DATA: 0x2ace,
  ROWER_DATA: 0x2ad1,
  INDOOR_BIKE_DATA: 0x2ad2,
  TRAINING_STATUS: 0x2ad3,
  RESISTANCE_RANGE: 0x2ad6,
  POWER_RANGE: 0x2ad8,
  CONTROL_POINT: 0x2ad9,
  MACHINE_STATUS: 0x2ada,
  CPS_MEASUREMENT: 0x2a63,
};

const OP = {
  REQUEST_CONTROL: 0x00,
  RESET: 0x01,
  SET_RESISTANCE: 0x04,
  SET_POWER: 0x05,
  START: 0x07,
  STOP: 0x08,
  SET_SIMULATION: 0x11,
  RESPONSE: 0x80,
};

const OP_NAMES = {
  0x00: 'Request Control',
  0x01: 'Reset',
  0x04: 'Set Target Resistance',
  0x05: 'Set Target Power (ERG)',
  0x07: 'Start/Resume',
  0x08: 'Stop/Pause',
  0x11: 'Set Simulation (pente)',
};

const RESULT_NAMES = {
  0x01: 'succès',
  0x02: 'opération non supportée',
  0x03: 'paramètre invalide',
  0x04: 'échec',
  0x05: 'contrôle non autorisé',
};

const MACHINE_STATUS_NAMES = {
  0x01: 'Reset',
  0x02: 'Arrêt/pause par l’utilisateur',
  0x03: 'Arrêt par sécurité',
  0x04: 'Démarré/repris',
  0x07: 'Résistance cible changée',
  0x08: 'Puissance cible changée',
  0x12: 'Paramètres de simulation changés',
  0x14: 'Spin down',
  0xff: 'Contrôle perdu (une autre appli a pris la main ?)',
};

const FEATURE_BITS = [
  'vitesse moyenne', 'cadence', 'distance', 'inclinaison', 'dénivelé', 'allure', 'pas', 'niveau de résistance',
  'foulées', 'énergie', 'fréquence cardiaque', 'MET', 'temps écoulé', 'temps restant', 'puissance', 'force',
  'données utilisateur',
];
const TARGET_BITS = [
  'vitesse', 'inclinaison', 'résistance', 'puissance (ERG)', 'fréquence cardiaque', 'énergie', 'pas', 'foulées',
  'distance', 'durée', 'zones FC x2', 'zones FC x3', 'zones FC x5', 'simulation (pente)', 'circonférence roue',
  'spin down', 'cadence',
];

function bitsToNames(value, names) {
  return names.filter((_, i) => value & (1 << i));
}

// --- Décodeurs purs (testables sans Bluetooth) ---

export function parseIndoorBikeData(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flags = v.getUint16(0, true);
  let o = 2;
  const out = { flags };
  const has = (bit) => flags & (1 << bit);
  if (!has(0)) { out.speed = v.getUint16(o, true) / 100; o += 2; }
  if (has(1)) { out.avgSpeed = v.getUint16(o, true) / 100; o += 2; }
  if (has(2)) { out.cadence = v.getUint16(o, true) / 2; o += 2; }
  if (has(3)) { out.avgCadence = v.getUint16(o, true) / 2; o += 2; }
  if (has(4)) { out.distance = v.getUint16(o, true) + (v.getUint8(o + 2) << 16); o += 3; }
  if (has(5)) { out.resistance = v.getInt16(o, true); o += 2; }
  if (has(6)) { out.power = v.getInt16(o, true); o += 2; }
  if (has(7)) { out.avgPower = v.getInt16(o, true); o += 2; }
  if (has(8)) { out.energy = v.getUint16(o, true); o += 5; }
  if (has(9)) { out.heartRate = v.getUint8(o); o += 1; }
  if (has(10)) { o += 1; }
  if (has(11)) { out.elapsed = v.getUint16(o, true); o += 2; }
  if (has(12)) { out.remaining = v.getUint16(o, true); o += 2; }
  return out;
}

// Rameur (FTMS Rower Data 0x2AD1). Cadence de coups en coups/min (résolution 0.5), allure en s/500 m.
export function parseRowerData(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flags = v.getUint16(0, true);
  let o = 2;
  const out = { flags };
  const has = (bit) => flags & (1 << bit);
  if (!has(0)) {
    out.strokeRate = v.getUint8(o) / 2;
    out.strokeCount = v.getUint16(o + 1, true);
    o += 3;
  }
  if (has(1)) { out.avgStrokeRate = v.getUint8(o) / 2; o += 1; }
  if (has(2)) { out.distance = v.getUint16(o, true) + (v.getUint8(o + 2) << 16); o += 3; }
  if (has(3)) { out.pace = v.getUint16(o, true); o += 2; }
  if (has(4)) { out.avgPace = v.getUint16(o, true); o += 2; }
  if (has(5)) { out.power = v.getInt16(o, true); o += 2; }
  if (has(6)) { out.avgPower = v.getInt16(o, true); o += 2; }
  if (has(7)) { out.resistance = v.getInt16(o, true); o += 2; }
  if (has(8)) { out.energy = v.getUint16(o, true); o += 5; }
  if (has(9)) { out.heartRate = v.getUint8(o); o += 1; }
  if (has(10)) { o += 1; }
  if (has(11)) { out.elapsed = v.getUint16(o, true); o += 2; }
  if (has(12)) { out.remaining = v.getUint16(o, true); o += 2; }
  return out;
}

// Vélo elliptique (FTMS Cross Trainer Data 0x2ACE) : les drapeaux tiennent sur 3 octets.
export function parseCrossTrainerData(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flags = v.getUint16(0, true) | (v.getUint8(2) << 16);
  let o = 3;
  const out = { flags };
  const has = (bit) => flags & (1 << bit);
  if (!has(0)) { out.speed = v.getUint16(o, true) / 100; o += 2; }
  if (has(1)) { out.avgSpeed = v.getUint16(o, true) / 100; o += 2; }
  if (has(2)) { out.distance = v.getUint16(o, true) + (v.getUint8(o + 2) << 16); o += 3; }
  if (has(3)) {
    out.stepRate = v.getUint16(o, true);
    out.avgStepRate = v.getUint16(o + 2, true);
    o += 4;
  }
  if (has(4)) { out.strideCount = v.getUint16(o, true) / 10; o += 2; }
  if (has(5)) { o += 4; }
  if (has(6)) { out.inclination = v.getInt16(o, true) / 10; o += 4; }
  if (has(7)) { out.resistance = v.getInt16(o, true) / 10; o += 2; }
  if (has(8)) { out.power = v.getInt16(o, true); o += 2; }
  if (has(9)) { out.avgPower = v.getInt16(o, true); o += 2; }
  if (has(10)) { out.energy = v.getUint16(o, true); o += 5; }
  if (has(11)) { out.heartRate = v.getUint8(o); o += 1; }
  if (has(12)) { o += 1; }
  if (has(13)) { out.elapsed = v.getUint16(o, true); o += 2; }
  if (has(14)) { out.remaining = v.getUint16(o, true); o += 2; }
  out.backward = !!has(15);
  return out;
}

// Puissance estimée d'un rameur à partir de l'allure (formule Concept2 : W = 2.8 / (s/m)³).
export function rowerPowerFromPace(pace500) {
  if (!pace500 || pace500 <= 0) return 0;
  return 2.8 / Math.pow(pace500 / 500, 3);
}

export const MACHINE_LABELS = { bike: 'Vélo', cross: 'Vélo elliptique', rower: 'Rameur', treadmill: 'Tapis de course', power: 'Capteur de puissance' };

export function parseCyclingPower(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flags = v.getUint16(0, true);
  const out = { flags, power: v.getInt16(2, true) };
  let o = 4;
  if (flags & 0x01) o += 1; // pedal power balance
  if (flags & 0x04) o += 2; // accumulated torque
  if (flags & 0x10) {
    out.wheelRevs = v.getUint32(o, true);
    out.wheelTime = v.getUint16(o + 4, true);
    o += 6;
  }
  if (flags & 0x20) {
    out.crankRevs = v.getUint16(o, true);
    out.crankTime = v.getUint16(o + 2, true);
    o += 4;
  }
  return out;
}

// Calcule la cadence à partir des compteurs de tours de pédalier (Cycling Power / CSC).
export class CrankCadence {
  constructor() {
    this.last = null;
    this.lastChange = 0;
    this.cadence = 0;
  }
  update(revs, time1024, now = performance.now()) {
    if (this.last) {
      const dRevs = (revs - this.last.revs + 0x10000) % 0x10000;
      const dTime = (time1024 - this.last.time + 0x10000) % 0x10000;
      if (dRevs > 0 && dTime > 0) {
        this.cadence = (dRevs / (dTime / 1024)) * 60;
        this.lastChange = now;
      } else if (now - this.lastChange > 2500) {
        this.cadence = 0;
      }
    } else {
      this.lastChange = now;
    }
    this.last = { revs, time: time1024 };
    return this.cadence;
  }
}

export function encodeSimulation({ grade = 0, windSpeed = 0, crr = 0.004, cw = 0.51 }) {
  const g = Math.round(Math.max(-327, Math.min(327, grade)) * 100);
  const w = Math.round(windSpeed * 1000);
  const c = Math.round(Math.max(0, Math.min(0.0255, crr)) * 10000);
  const k = Math.round(Math.max(0, Math.min(2.55, cw)) * 100);
  return [OP.SET_SIMULATION, w & 0xff, (w >> 8) & 0xff, g & 0xff, (g >> 8) & 0xff, c, k];
}

// --- Classe principale ---

export class Trainer extends EventTarget {
  constructor({ requestDevice = realRequestDevice } = {}) {
    super();
    this.requestDevice = requestDevice;
    this.queue = new GattQueue();
    this.data = { power: null, cadence: null, speed: null, heartRate: null, resistance: null, strokeRate: null, strokeCount: null, distance: null, pace: null, stepRate: null };
    this.kind = null; // bike | cross | rower | treadmill | power
    this.packets = 0;
    this.lastPacketAt = 0;
    this.serviceList = [];
    this.sources = {};
    this.effortAt = {};
    this.features = null;
    this.ranges = {};
    this.cp = null;
    this.pendingCp = null;
    this.crank = new CrankCadence();
    this.connected = false;
    this.simulation = { grade: 0, crr: 0.004, cw: 0.51, windSpeed: 0 };
    this.gradePump = null;
  }

  get name() {
    return this.device?.name || 'Home trainer';
  }

  get canControl() {
    return !!this.cp;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get kindLabel() {
    return MACHINE_LABELS[this.kind] || 'Machine';
  }

  // filters : filtres Web Bluetooth du profil matériel choisi (Zwift, Technogym, BLE standard).
  async connect({ acceptAll = false, filters = null } = {}) {
    const options = acceptAll
      ? { acceptAllDevices: true, optionalServices: ALL_OPTIONAL_SERVICES }
      : {
          filters: filters || [{ services: [SERVICES.FTMS] }, { services: [SERVICES.CPS] }],
          optionalServices: ALL_OPTIONAL_SERVICES,
        };
    info(SRC, 'Ouverture du sélecteur Bluetooth (home trainer)...');
    this.device = await this.requestDevice(options);
    info(SRC, `Appareil choisi : "${this.device.name || '(sans nom)'}" id=${this.device.id}`);
    this.device.addEventListener('gattserverdisconnected', () => this.onDisconnected());
    await this.setup();
  }

  async setup() {
    this.kind = null;
    this.packets = 0;
    this.strokeMark = null;
    this.derivedStrokeRate = undefined;
    for (const k of Object.keys(this.data)) this.data[k] = null;
    this.sources = {};
    this.effortAt = {};
    this.server = await connectGatt(this.device, SRC);
    this.connected = true;
    this.serviceList = (await dumpGatt(this.server, SRC)).map((sv) => sv.uuid);
    this.deviceInfo = await readDeviceInfo(this.server, SRC);

    const ftms = await getServiceOrNull(this.server, SERVICES.FTMS);
    const cps = await getServiceOrNull(this.server, SERVICES.CPS);
    const hrs = await getServiceOrNull(this.server, SERVICES.HR);
    info(SRC, `FTMS: ${ftms ? 'oui' : 'non'} · Cycling Power: ${cps ? 'oui' : 'non'} · Cardio intégré: ${hrs ? 'oui' : 'non'}`);
    if (!ftms && !cps) warn(SRC, 'Ni FTMS ni Cycling Power : cette machine ne pourra pas être lue (protocole propriétaire ?). Le journal ci-dessus liste ses services.');

    if (ftms) await this.setupFtms(ftms);
    if (cps) await this.setupCps(cps);
    if (ftms && !this.cp) warn(SRC, 'FTMS présent mais pas de Control Point : lecture seule.');
    if (!ftms) warn(SRC, "Pas de FTMS : impossible de piloter la résistance (trainer trop ancien ou protocole propriétaire).");
    this.emit('connected');
  }

  async setupFtms(ftms) {
    const feat = await getCharOrNull(ftms, CHAR.FTMS_FEATURE);
    if (feat) {
      try {
        const b = new DataView((await feat.readValue()).buffer);
        const f = b.getUint32(0, true);
        const t = b.getUint32(4, true);
        this.features = { machine: bitsToNames(f, FEATURE_BITS), targets: bitsToNames(t, TARGET_BITS), raw: [f, t] };
        info(SRC, `Mesures FTMS : ${this.features.machine.join(', ') || '(aucune)'}`);
        info(SRC, `Consignes FTMS : ${this.features.targets.join(', ') || '(aucune)'}`);
      } catch (e) {
        warn(SRC, `Lecture des fonctions FTMS impossible : ${e.message}`);
      }
    }
    for (const [key, uuid] of [['resistance', CHAR.RESISTANCE_RANGE], ['power', CHAR.POWER_RANGE]]) {
      const c = await getCharOrNull(ftms, uuid);
      if (!c) continue;
      try {
        const v = new DataView((await c.readValue()).buffer);
        const range = { min: v.getInt16(0, true), max: v.getInt16(2, true), step: v.getUint16(4, true) };
        if (key === 'resistance') Object.keys(range).forEach((k) => (range[k] /= 10));
        this.ranges[key] = range;
        info(SRC, `Plage ${key} : ${range.min} → ${range.max} (pas ${range.step})`);
      } catch {
        /* optionnel */
      }
    }

    // Type de machine selon la caractéristique de données présente.
    const kinds = [
      ['bike', CHAR.INDOOR_BIKE_DATA, 'Indoor Bike Data', parseIndoorBikeData],
      ['rower', CHAR.ROWER_DATA, 'Rower Data', parseRowerData],
      ['cross', CHAR.CROSS_TRAINER_DATA, 'Cross Trainer Data', parseCrossTrainerData],
    ];
    let found = false;
    for (const [kind, uuid, label, parse] of kinds) {
      const c = await getCharOrNull(ftms, uuid);
      if (!c) continue;
      const sample = packetSampler(5, 200);
      await subscribe(c, (b) => {
        if (sample()) debug(SRC, `${label}: ${hex(b)}`);
        try {
          this.onFtmsData(parse(b), kind);
        } catch (e) {
          warn(SRC, `${label} illisible (${hex(b)}): ${e.message}`);
        }
      });
      if (!found) this.kind = kind;
      found = true;
      info(SRC, `Abonné aux données FTMS (${label}) : ${MACHINE_LABELS[kind]}`);
    }
    if (!found) {
      const tm = await getCharOrNull(ftms, CHAR.TREADMILL_DATA);
      if (tm) {
        this.kind = 'treadmill';
        warn(SRC, 'Tapis de course FTMS : non utilisable dans le jeu (pas de puissance).');
      } else warn(SRC, 'Aucune caractéristique de données FTMS (vélo, rameur, elliptique)');
    }

    const status = await getCharOrNull(ftms, CHAR.MACHINE_STATUS);
    if (status) {
      await subscribe(status, (b) => {
        info(SRC, `Statut machine : ${MACHINE_STATUS_NAMES[b[0]] || 'code 0x' + b[0].toString(16)} (${hex(b)})`);
        if (b[0] === 0xff) this.emit('control-lost');
      }).catch((e) => warn(SRC, `Statut machine indisponible : ${e.message}`));
    }

    const cp = await getCharOrNull(ftms, CHAR.CONTROL_POINT);
    if (cp) {
      await subscribe(cp, (b) => this.onCpResponse(b));
      this.cp = cp;
      info(SRC, 'Control Point FTMS prêt, demande de contrôle...');
      // Certaines machines (Technogym notamment) refusent ou ignorent la demande : on reste alors en lecture seule.
      try {
        const r = await this.command([OP.REQUEST_CONTROL]);
        if (!r.ok) throw new Error(RESULT_NAMES[r.result] || `code ${r.result}`);
        await this.command([OP.START]).catch(() => {});
      } catch (e) {
        warn(SRC, `Contrôle refusé (${e.message}) : lecture seule, la résistance ne sera pas pilotée.`);
        this.cp = null;
      }
    }
  }

  async setupCps(cps) {
    const m = await getCharOrNull(cps, CHAR.CPS_MEASUREMENT);
    if (!m) return;
    if (!this.kind) this.kind = 'power';
    const sample = packetSampler(5, 200);
    await subscribe(m, (b) => {
      if (sample()) debug(SRC, `Cycling Power: ${hex(b)}`);
      try {
        this.onCpsData(parseCyclingPower(b));
      } catch (e) {
        warn(SRC, `Cycling Power illisible (${hex(b)}): ${e.message}`);
      }
    });
    info(SRC, 'Abonné aux données Cycling Power');
  }

  onFtmsData(d, kind = 'bike') {
    this.packets++;
    this.lastPacketAt = performance.now();
    // Rameur sans puissance : estimée depuis l'allure.
    if (d.power === undefined && kind === 'rower' && d.pace) d.power = Math.round(rowerPowerFromPace(d.pace));
    if (d.power !== undefined) this.setValue('power', d.power, 'FTMS');
    if (d.cadence !== undefined) this.setValue('cadence', d.cadence, 'FTMS');
    // Elliptique : une révolution = deux pas ; rameur : la « cadence » est la cadence de coups.
    if (d.stepRate !== undefined) {
      this.setValue('stepRate', d.stepRate, 'FTMS');
      this.setValue('cadence', d.stepRate / 2, 'FTMS');
    }
    // Cadence de coups de secours (Skillrow notamment) : moyenne, sinon déduite du compteur de coups.
    const strokes = kind === 'rower' ? this.strokeRateFrom(d) : d.strokeRate;
    if (strokes !== undefined) {
      this.setValue('strokeRate', strokes, 'FTMS');
      this.setValue('cadence', strokes, 'FTMS');
    }
    if (d.strokeCount !== undefined) this.setValue('strokeCount', d.strokeCount, 'FTMS');
    if (d.distance !== undefined) this.setValue('distance', d.distance, 'FTMS');
    if (d.pace !== undefined) this.setValue('pace', d.pace, 'FTMS');
    if (d.speed !== undefined) this.setValue('speed', d.speed, 'FTMS');
    if (d.heartRate !== undefined && d.heartRate > 0) this.setValue('heartRate', d.heartRate, 'FTMS');
    if (d.resistance !== undefined) this.setValue('resistance', d.resistance, 'FTMS');
    this.emit('data', this.data);
  }

  strokeRateFrom(d, now = performance.now()) {
    if (d.strokeCount !== undefined) {
      const m = this.strokeMark;
      if (m && d.strokeCount >= m.count) {
        const dt = (now - m.time) / 1000;
        if (d.strokeCount > m.count && dt >= 1.5) {
          const rate = ((d.strokeCount - m.count) / dt) * 60;
          this.derivedStrokeRate = this.derivedStrokeRate === undefined ? rate : this.derivedStrokeRate * 0.5 + rate * 0.5;
          this.strokeMark = { count: d.strokeCount, time: now };
        } else if (dt > 8) {
          this.derivedStrokeRate = 0;
          this.strokeMark = { count: d.strokeCount, time: now };
        }
      } else this.strokeMark = { count: d.strokeCount, time: now };
    }
    if (d.strokeRate > 0) {
      this.instantStrokeSeen = true;
      return d.strokeRate;
    }
    // Compteur de coups d'abord : il retombe à 0 quand on s'arrête, la moyenne de séance jamais.
    if (this.derivedStrokeRate !== undefined) return this.derivedStrokeRate;
    // Moyenne : seulement si le rameur ne donne jamais sa cadence instantanée, et pas à l'arrêt (puissance 0).
    if (!this.instantStrokeSeen && d.avgStrokeRate > 0 && (d.power ?? 1) > 0) return d.avgStrokeRate;
    return d.strokeRate;
  }

  onCpsData(d) {
    this.packets++;
    this.lastPacketAt = performance.now();
    // FTMS est prioritaire, sauf s'il n'envoie que des zéros (voir setValue).
    this.setValue('power', d.power, 'Cycling Power');
    if (d.crankRevs !== undefined) {
      this.setValue('cadence', Math.round(this.crank.update(d.crankRevs, d.crankTime)), 'Cycling Power');
    }
    this.emit('data', this.data);
  }

  // FTMS fait foi, sauf quand il n'envoie que des zéros alors qu'une autre source (Cycling Power) mesure un
  // effort : certaines machines (vélos Technogym) remplissent les champs FTMS à 0 et donnent la vraie puissance
  // ailleurs. Un zéro ne remplace jamais une source qui montre un effort depuis moins de 3 s (comme l'appli iOS).
  setValue(key, value, source, now = performance.now()) {
    this.effortAt ||= {};
    const effort = typeof value === 'number' && value > 0;
    if (effort) this.effortAt[`${key}|${source}`] = now;
    const current = this.sources[key];
    if (current && current !== source) {
      const at = this.effortAt[`${key}|${current}`];
      const currentLive = at !== undefined && now - at < 3000;
      if (source === 'FTMS') {
        if (!effort && currentLive) return;
      } else if (current === 'FTMS') {
        if (currentLive || !effort) return;
      } else if (!effort && currentLive) return;
    }
    this.data[key] = value;
    if (this.sources[key] !== source) {
      this.sources[key] = source;
      info(SRC, `Source ${key} : ${source}`);
    }
  }

  onCpResponse(b) {
    if (b[0] !== OP.RESPONSE) {
      debug(SRC, `Control Point (inattendu) : ${hex(b)}`);
      return;
    }
    const [, op, result] = b;
    const ok = result === 0x01;
    const msg = `Réponse ${OP_NAMES[op] || '0x' + op.toString(16)} : ${RESULT_NAMES[result] || 'code ' + result}`;
    (ok ? debug : warn)(SRC, msg);
    this.emit('cp-response', { op, result, ok });
    if (this.pendingCp && this.pendingCp.op === op) {
      this.pendingCp.resolve({ op, result, ok });
      this.pendingCp = null;
    }
  }

  // Envoie une commande au Control Point et attend sa réponse (indication).
  command(bytes, timeoutMs = 3000) {
    if (!this.cp) return Promise.reject(new Error('Pas de Control Point FTMS'));
    return this.queue.run(async () => {
      const op = bytes[0];
      const response = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingCp = null;
          reject(new Error(`Pas de réponse à ${OP_NAMES[op] || op} après ${timeoutMs} ms`));
        }, timeoutMs);
        this.pendingCp = {
          op,
          resolve: (r) => {
            clearTimeout(timer);
            resolve(r);
          },
        };
      });
      debug(SRC, `→ ${OP_NAMES[op] || 'op 0x' + op.toString(16)} : ${hex(bytes)}`);
      try {
        await writeChar(this.cp, bytes);
      } catch (e) {
        this.pendingCp = null;
        throw e;
      }
      return response;
    });
  }

  // Mode simulation (terrain) : pente en %, avec résistance au roulement et traînée.
  async setSimulation(params) {
    Object.assign(this.simulation, params);
    const bytes = encodeSimulation(this.simulation);
    const r = await this.command(bytes);
    if (!r.ok && r.result === 0x05) {
      warn(SRC, 'Contrôle refusé, nouvelle demande de contrôle...');
      await this.command([OP.REQUEST_CONTROL]);
      return this.command(bytes);
    }
    return r;
  }

  // Version "jeu" : appelée souvent, n'envoie que la dernière valeur, au plus 4 fois/s.
  // windSpeed (m/s, positif = vent de face) : champ « vitesse du vent » du mode simulation (météo du jeu) ;
  // 0 par défaut, comme avant. Une machine pilotée en résistance ne s'en sert pas (le jeu lui envoie alors
  // le vent déjà converti en pente).
  setGradeThrottled(grade, windSpeed = 0) {
    this.simulation.grade = grade;
    this.simulation.windSpeed = Number.isFinite(windSpeed) ? windSpeed : 0;
    if (this.gradePump) {
      this.gradeDirty = true;
      return;
    }
    const send = async () => {
      this.gradeDirty = false;
      try {
        if (this.kind !== 'bike' && this.kind !== null) await this.setResistanceForGrade(this.simulation.grade);
        else await this.setSimulation({});
      } catch (e) {
        warn(SRC, `Pente non envoyée : ${e.message}`);
      }
      this.gradePump = setTimeout(() => {
        this.gradePump = null;
        if (this.gradeDirty) this.setGradeThrottled(this.simulation.grade);
      }, 250);
    };
    send();
  }

  async setTargetPower(watts) {
    const w = Math.round(watts);
    return this.command([OP.SET_POWER, w & 0xff, (w >> 8) & 0xff]);
  }

  // Machines sans mode simulation (elliptique, rameur) : la pente devient un niveau de résistance.
  async setResistanceForGrade(grade) {
    if (!this.features?.targets.includes('résistance')) return null;
    const r = this.ranges.resistance || { min: 0, max: 20 };
    const t = Math.max(0, Math.min(1, (grade + 4) / 16));
    const level = r.min + (r.max - r.min) * (0.15 + t * 0.7);
    if (this.lastLevel !== undefined && Math.abs(level - this.lastLevel) < (r.step || 0.5)) return null;
    this.lastLevel = level;
    return this.setResistanceLevel(level);
  }

  async setResistanceLevel(level) {
    return this.command([OP.SET_RESISTANCE, Math.max(0, Math.min(255, Math.round(level * 10)))]);
  }

  async reset() {
    return this.command([OP.RESET]);
  }

  onDisconnected() {
    this.connected = false;
    this.cp = null;
    this.data.power = null;
    warn(SRC, `"${this.name}" déconnecté`);
    this.emit('disconnected');
  }

  async reconnect() {
    if (!this.device) throw new Error('Aucun appareil choisi');
    await this.setup();
  }

  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }
}
