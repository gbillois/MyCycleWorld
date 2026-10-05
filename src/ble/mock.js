// Appareils Bluetooth simulés (mode démo) : home trainer FTMS, ceinture cardio, manettes Zwift Play.
// Ils imitent l'API Web Bluetooth, donc tout le vrai code de décodage est exercé.
import { encodeVarint, toBytes } from './bytes.js';

const BASE = '-0000-1000-8000-00805f9b34fb';
export function canonicalUuid(u) {
  if (typeof u === 'number') return `0000${u.toString(16).padStart(4, '0')}${BASE}`;
  return u.toLowerCase();
}

function notFound(what) {
  const e = new Error(`${what} introuvable`);
  e.name = 'NotFoundError';
  return e;
}

class MockCharacteristic extends EventTarget {
  constructor(service, uuid, properties, { read, onWrite } = {}) {
    super();
    this.service = service;
    this.uuid = canonicalUuid(uuid);
    this.properties = { read: false, write: false, writeWithoutResponse: false, notify: false, indicate: false, ...properties };
    this.read = read;
    this.onWrite = onWrite;
    this.value = null;
    this.notifying = false;
  }
  async readValue() {
    const b = Uint8Array.from(this.read ? this.read() : []);
    this.value = new DataView(b.buffer);
    return this.value;
  }
  async startNotifications() {
    this.notifying = true;
    return this;
  }
  async stopNotifications() {
    this.notifying = false;
    return this;
  }
  notify(bytes) {
    if (!this.notifying || !this.service.device.gatt.connected) return;
    const b = Uint8Array.from(bytes);
    this.value = new DataView(b.buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
  async write(data) {
    await new Promise((r) => setTimeout(r, 5));
    this.onWrite?.(toBytes(data));
  }
  writeValue(d) {
    return this.write(d);
  }
  writeValueWithResponse(d) {
    return this.write(d);
  }
  writeValueWithoutResponse(d) {
    return this.write(d);
  }
}

class MockService {
  constructor(device, uuid) {
    this.device = device;
    this.uuid = canonicalUuid(uuid);
    this.chars = [];
  }
  add(uuid, props, opts) {
    const c = new MockCharacteristic(this, uuid, props, opts);
    this.chars.push(c);
    return c;
  }
  async getCharacteristic(uuid) {
    const c = this.chars.find((x) => x.uuid === canonicalUuid(uuid));
    if (!c) throw notFound('Caractéristique');
    return c;
  }
  async getCharacteristics() {
    return [...this.chars];
  }
}

class MockDevice extends EventTarget {
  constructor(name) {
    super();
    this.name = name;
    this.id = 'demo-' + Math.random().toString(36).slice(2, 8);
    this.services = [];
    this.timers = [];
    const device = this;
    this.gatt = {
      connected: false,
      device,
      async connect() {
        await new Promise((r) => setTimeout(r, 150));
        this.connected = true;
        device.onConnect?.();
        return this;
      },
      disconnect() {
        if (!this.connected) return;
        this.connected = false;
        device.timers.forEach(clearInterval);
        device.timers = [];
        device.dispatchEvent(new Event('gattserverdisconnected'));
      },
      async getPrimaryService(uuid) {
        const s = device.services.find((x) => x.uuid === canonicalUuid(uuid));
        if (!s) throw notFound('Service');
        return s;
      },
      async getPrimaryServices() {
        return [...device.services];
      },
    };
  }
  service(uuid) {
    const s = new MockService(this, uuid);
    this.services.push(s);
    return s;
  }
  every(ms, fn) {
    this.timers.push(setInterval(fn, ms));
  }
  addDis(manufacturer, model, firmware) {
    const enc = new TextEncoder();
    const dis = this.service(0x180a);
    dis.add(0x2a29, { read: true }, { read: () => enc.encode(manufacturer) });
    dis.add(0x2a24, { read: true }, { read: () => enc.encode(model) });
    dis.add(0x2a26, { read: true }, { read: () => enc.encode(firmware) });
  }
}

const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];

export function createMockTrainer() {
  const d = new MockDevice('DEMO Trainer FTMS');
  d.addDis('Démo', 'Smart Trainer', '1.0.0');
  const ftms = d.service(0x1826);
  // Fonctions : cadence, résistance, puissance / consignes : résistance, puissance, simulation.
  const features = (1 << 1) | (1 << 7) | (1 << 14);
  const targets = (1 << 2) | (1 << 3) | (1 << 13);
  ftms.add(0x2acc, { read: true }, { read: () => [...u16(features), 0, 0, ...u16(targets), 0, 0] });
  ftms.add(0x2ad6, { read: true }, { read: () => [...u16(0), ...u16(1000), ...u16(10)] });
  ftms.add(0x2ad8, { read: true }, { read: () => [...u16(0), ...u16(2000), ...u16(1)] });
  const bike = ftms.add(0x2ad2, { notify: true });
  const status = ftms.add(0x2ada, { notify: true });
  const state = { grade: 0, erg: null };
  const cp = ftms.add(0x2ad9, { write: true, indicate: true }, {
    onWrite: (b) => {
      const op = b[0];
      if (op === 0x11) {
        state.grade = new DataView(b.buffer, b.byteOffset).getInt16(3, true) / 100;
        state.erg = null;
        status.notify([0x12, ...b.slice(1)]);
      }
      if (op === 0x05) state.erg = new DataView(b.buffer, b.byteOffset).getInt16(1, true);
      setTimeout(() => cp.notify([0x80, op, 0x01]), 40);
    },
  });
  let t = 0;
  d.onConnect = () =>
    d.every(250, () => {
      t += 0.25;
      const target = state.erg ?? 170 + state.grade * 14;
      const power = Math.max(30, Math.round(target + Math.sin(t * 1.7) * 12 + (Math.random() - 0.5) * 10));
      const cadence = Math.max(50, Math.round((88 - state.grade * 1.2 + Math.sin(t / 3) * 3) * 2));
      const speed = Math.round(Math.max(5, 30 - state.grade * 1.5) * 100);
      const flags = (1 << 2) | (1 << 6); // vitesse (bit0 = 0), cadence, puissance
      bike.notify([...u16(flags), ...u16(speed), ...u16(cadence), ...u16(power)]);
    });
  return d;
}

// Machine FTMS sans mode simulation (rameur ou elliptique), pilotable en résistance.
function mockFtmsMachine(name, model, features, dataUuid, makePacket) {
  const d = new MockDevice(name);
  d.addDis('Technogym (démo)', model, '1.0.0');
  const ftms = d.service(0x1826);
  const targets = 1 << 2; // résistance
  ftms.add(0x2acc, { read: true }, { read: () => [...u16(features), 0, 0, ...u16(targets), 0, 0] });
  ftms.add(0x2ad6, { read: true }, { read: () => [...u16(10), ...u16(250), ...u16(10)] });
  const data = ftms.add(dataUuid, { notify: true });
  const state = { level: 8 };
  const cp = ftms.add(0x2ad9, { write: true, indicate: true }, {
    onWrite: (b) => {
      const op = b[0];
      if (op === 0x04) state.level = b[1] / 10;
      setTimeout(() => cp.notify([0x80, op, op === 0x11 ? 0x02 : 0x01]), 40);
    },
  });
  let t = 0;
  d.onConnect = () =>
    d.every(500, () => {
      t += 0.5;
      data.notify(makePacket(t, state));
    });
  return d;
}

// Rameur : cadence ~26 coups/min, distance, allure /500 m, puissance, cardio.
export function createMockRower() {
  let distance = 0;
  let strokes = 0;
  const features = (1 << 1) | (1 << 2) | (1 << 5) | (1 << 7) | (1 << 10) | (1 << 14);
  return mockFtmsMachine('SKILLROW (démo)', 'Skillrow', features, 0x2ad1, (t, st) => {
    const power = Math.round(165 + st.level * 2 + Math.sin(t * 2.3) * 25);
    const v = Math.cbrt(power / 2.8);
    distance += v * 0.5;
    strokes += 26 / 120;
    const pace = Math.round(500 / v);
    const rate = Math.round((26 + Math.sin(t / 4) * 2) * 2);
    const flags = (1 << 2) | (1 << 3) | (1 << 5) | (1 << 7) | (1 << 9);
    const dist = Math.round(distance);
    return [...u16(flags), rate, ...u16(Math.floor(strokes)), dist & 0xff, (dist >> 8) & 0xff, dist >> 16, ...u16(pace), ...u16(power), ...u16(Math.round(st.level)), 132 + Math.round(Math.sin(t / 9) * 8)];
  });
}

// Elliptique : vitesse, pas/min, résistance, puissance.
export function createMockCrossTrainer() {
  const features = (1 << 2) | (1 << 7) | (1 << 14);
  return mockFtmsMachine('EXCITE SYNCHRO (démo)', 'Excite Synchro', features, 0x2ace, (t, st) => {
    const power = Math.round(140 + st.level * 3 + Math.sin(t * 1.4) * 15);
    const steps = Math.round(140 + Math.sin(t / 3) * 8);
    const flags = (1 << 3) | (1 << 7) | (1 << 8);
    return [flags & 0xff, (flags >> 8) & 0xff, 0, ...u16(Math.round((9 + Math.sin(t) * 0.5) * 100)), ...u16(steps), ...u16(steps), ...u16(Math.round(st.level * 10)), ...u16(power)];
  });
}

export function createMockHeartRate() {
  const d = new MockDevice('DEMO Ceinture HRM');
  d.addDis('Démo', 'HRM', '2.1');
  const hrs = d.service(0x180d);
  const m = hrs.add(0x2a37, { notify: true });
  d.service(0x180f).add(0x2a19, { read: true }, { read: () => [87] });
  let t = 0;
  d.onConnect = () =>
    d.every(1000, () => {
      t++;
      m.notify([0x06, Math.round(128 + Math.sin(t / 8) * 15)]);
    });
  return d;
}

// Encode un PlayKeyPadStatus (firmware 1.x) : 0 = appuyé, 1 = relâché.
export function encodePlayStatus(side, pressed = [], analog = 0) {
  const names = side === 'R' ? ['R_Y', 'R_Z', 'R_A', 'R_B', 'R_SHIFT', 'R_ON'] : ['L_UP', 'L_LEFT', 'L_RIGHT', 'L_DOWN', 'L_SHIFT', 'L_ON'];
  const out = [0x07, 0x08, side === 'R' ? 0 : 1];
  names.forEach((n, i) => out.push((i + 2) << 3, pressed.includes(n) ? 0 : 1));
  const zz = analog >= 0 ? analog * 2 : -analog * 2 - 1;
  out.push(0x40, ...encodeVarint(zz), 0x48, 0x00);
  return out;
}

export function createMockZwiftPlay(side) {
  const d = new MockDevice('Zwift Play');
  d.addDis('Zwift', 'Zwift Play', '1.3.1');
  d.service(0x180f).add(0x2a19, { read: true }, { read: () => [side === 'L' ? 76 : 81] });
  const zs = d.service('00000001-19ca-4651-86e5-fa29dcdd09d1');
  const asyncC = zs.add('00000002-19ca-4651-86e5-fa29dcdd09d1', { notify: true });
  const tx = zs.add('00000004-19ca-4651-86e5-fa29dcdd09d1', { indicate: true });
  let started = false;
  zs.add('00000003-19ca-4651-86e5-fa29dcdd09d1', { writeWithoutResponse: true }, {
    onWrite: (b) => {
      if (b[0] === 0x52 && !started) {
        started = true;
        setTimeout(() => tx.notify([0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e, 0x01, 0x04]), 60);
        startScript();
      }
    },
  });
  const buttons = side === 'R' ? ['R_A', 'R_B', 'R_Y', 'R_Z', 'R_SHIFT'] : ['L_LEFT', 'L_RIGHT', 'L_UP', 'L_DOWN', 'L_SHIFT'];
  function startScript() {
    let tick = 0;
    d.every(100, () => {
      tick++;
      const phase = tick % 16;
      if (phase === 0) {
        const b = buttons[Math.floor(Math.random() * buttons.length)];
        asyncC.notify(encodePlayStatus(side, [b]));
      } else if (phase === 3) asyncC.notify(encodePlayStatus(side, []));
      else if (phase >= 8 && phase <= 11 && tick % 48 < 16) {
        asyncC.notify(encodePlayStatus(side, [], side === 'L' ? -(phase - 7) * 25 : (phase - 7) * 25));
      } else if (phase === 12 && tick % 48 < 16) asyncC.notify(encodePlayStatus(side, []));
      else if (phase === 6) asyncC.notify([0x15]);
      if (tick % 300 === 0) asyncC.notify([0x19, 0x08, side === 'L' ? 75 : 80]);
    });
  }
  return d;
}

// Remplace navigator.bluetooth.requestDevice : choisit l'appareil simulé selon les filtres demandés.
export function createMockRequestDevice() {
  let zwiftCount = 0;
  return async (options) => {
    await new Promise((r) => setTimeout(r, 200));
    const filters = options.filters || [];
    const services = filters.flatMap((f) => f.services || []).map(canonicalUuid);
    // Profil Technogym (filtre par nom) : rameur ou elliptique simulé selon la machine demandée.
    if (filters.some((f) => f.namePrefix === 'Technogym')) {
      if (options.demoKind === 'cross') return createMockCrossTrainer();
      if (options.demoKind !== 'bike') return createMockRower();
    }
    if (services.includes(canonicalUuid(0x1826))) return createMockTrainer();
    if (services.includes(canonicalUuid(0x180d))) return createMockHeartRate();
    if (filters.some((f) => f.namePrefix === 'Zwift')) return createMockZwiftPlay(zwiftCount++ % 2 === 0 ? 'L' : 'R');
    if (options.acceptAllDevices) return createMockTrainer();
    const e = new Error('Aucun appareil démo pour ces filtres');
    e.name = 'NotFoundError';
    throw e;
  };
}
