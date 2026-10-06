// Ceinture cardio (Heart Rate Service standard 0x180D).
import { HEART_RATE_NAME_PREFIXES } from '../core/hardware.js';
import { hex } from './bytes.js';
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
} from './gatt.js';
import { info, warn, debug, packetSampler } from './log.js';

const SRC = 'cardio';

export function parseHeartRate(b) {
  const flags = b[0];
  const bpm = flags & 0x01 ? b[1] | (b[2] << 8) : b[1];
  const contact = flags & 0x04 ? !!(flags & 0x02) : null; // null = capteur ne le signale pas
  return { bpm, contact };
}

export class HeartRateMonitor extends EventTarget {
  constructor({ requestDevice = realRequestDevice } = {}) {
    super();
    this.requestDevice = requestDevice;
    this.bpm = null;
    this.contact = null;
    this.battery = null;
    this.connected = false;
  }

  get name() {
    return this.device?.name || 'Ceinture cardio';
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async connect() {
    info(SRC, 'Ouverture du sélecteur Bluetooth (ceinture cardio)...');
    this.device = await this.requestDevice({
      // Service cardio, ou nom connu (une montre Garmin en diffusion FC ne l'annonce pas toujours).
      filters: [{ services: [SERVICES.HR] }, ...HEART_RATE_NAME_PREFIXES.map((namePrefix) => ({ namePrefix }))],
      optionalServices: [SERVICES.HR, SERVICES.BATTERY, SERVICES.DIS],
    });
    info(SRC, `Appareil choisi : "${this.device.name || '(sans nom)'}"`);
    this.device.addEventListener('gattserverdisconnected', () => {
      this.connected = false;
      warn(SRC, `"${this.name}" déconnecté`);
      this.emit('disconnected');
    });
    await this.setup();
  }

  async setup() {
    this.server = await connectGatt(this.device, SRC);
    this.connected = true;
    await dumpGatt(this.server, SRC);
    await readDeviceInfo(this.server, SRC);
    this.battery = await readBattery(this.server, SRC);
    const hrs = await getServiceOrNull(this.server, SERVICES.HR);
    const m = await getCharOrNull(hrs, 0x2a37);
    if (!m) throw new Error('Pas de mesure de fréquence cardiaque sur cet appareil');
    const sample = packetSampler(5, 200);
    await subscribe(m, (b) => {
      if (sample()) debug(SRC, `HR Measurement: ${hex(b)}`);
      const { bpm, contact } = parseHeartRate(b);
      if (contact !== this.contact && contact !== null) info(SRC, contact ? 'Contact peau OK' : 'Pas de contact peau (humidifie la ceinture)');
      this.bpm = bpm;
      this.contact = contact;
      this.emit('data', { bpm, contact });
    });
    info(SRC, 'Abonné à la fréquence cardiaque');
    this.emit('connected');
  }

  async reconnect() {
    await this.setup();
  }
}
