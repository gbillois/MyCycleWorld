// Matériel du joueur : home trainer, ceinture cardio, manettes Zwift. Réutilise les modules de src/ble/.
// Mode démo (?demo=1) : appareils simulés, comme sur la page de diagnostic.
import { Trainer } from '../src/ble/trainer.js';
import { HeartRateMonitor } from '../src/ble/heart-rate.js';
import { ZwiftController } from '../src/ble/zwift.js';
import { realRequestDevice } from '../src/ble/gatt.js';
import { createMockRequestDevice } from '../src/ble/mock.js';
import { KeyEmitter, loadKeymap } from '../src/core/keymap.js';
import { hardwareById } from '../src/core/hardware.js';

export { explainError } from '../src/ble/errors.js';

export class Devices extends EventTarget {
  constructor({ demo = false } = {}) {
    super();
    this.demo = demo;
    const requestDevice = demo ? createMockRequestDevice() : realRequestDevice;
    this.requestDevice = requestDevice;
    this.trainer = new Trainer({ requestDevice });
    this.hr = new HeartRateMonitor({ requestDevice });
    this.controllers = [];
    this.keyEmitter = new KeyEmitter(loadKeymap());
    this.lastTrainerData = 0;
    this.hardware = hardwareById('zwift');

    this.trainer.addEventListener('data', () => {
      this.lastTrainerData = performance.now();
    });
    for (const [dev, type] of [[this.trainer, 'trainer'], [this.hr, 'hr']]) {
      dev.addEventListener('connected', () => this.changed(type));
      dev.addEventListener('disconnected', () => this.changed(type));
    }
  }

  get bluetoothAvailable() {
    return this.demo || !!navigator.bluetooth;
  }

  changed(type) {
    this.dispatchEvent(new CustomEvent('change', { detail: { type } }));
  }

  // Le trainer fournit-il la puissance ? Sinon le jeu passe en mode clavier.
  get trainerActive() {
    return this.trainer.connected && this.trainer.data.power !== null;
  }

  // Type de la machine connectée : bike | cross | rower | treadmill | power (null si aucune).
  get machineKind() {
    return this.trainer.connected ? this.trainer.kind : null;
  }

  setHardware(id) {
    this.hardware = hardwareById(id);
  }

  get power() {
    return this.trainer.data.power ?? 0;
  }

  get cadence() {
    return this.trainer.data.cadence ?? 0;
  }

  get heartRate() {
    if (this.hr.connected && this.hr.bpm) return this.hr.bpm;
    return this.trainer.data.heartRate || null;
  }

  get connectedControllers() {
    return this.controllers.filter((c) => c.connected);
  }

  // acceptAll : montre tous les appareils Bluetooth (machine au nom ou aux services inattendus).
  // demoKind : en mode démo, machine simulée voulue (rower, cross, bike).
  async connectTrainer({ acceptAll = false, demoKind } = {}) {
    this.changed('trainer');
    if (this.trainer.connected) this.trainer.disconnect();
    const filters = this.hardware.filters;
    if (this.demo && demoKind) {
      const base = this.requestDevice;
      this.trainer.requestDevice = (opts) => base({ ...opts, demoKind });
    } else this.trainer.requestDevice = this.requestDevice;
    await this.trainer.connect({ acceptAll, filters });
  }

  // Carte des salles : seulement dans l'appli iOS (la recherche Web Bluetooth ne donne pas la force du signal).
  get canUseGym() {
    return false;
  }

  // Appareils déjà choisis dans cette page (Web Bluetooth ne les retrouve pas après un rechargement) :
  // même forme que l'état « reconnect » de l'appli iOS.
  get known() {
    const t = this.trainer.device ? this.trainer.name || 'Machine' : null;
    const h = this.hr.device ? this.hr.name || 'Ceinture cardio' : null;
    return t || h ? { trainer: t, hr: h, waiting: !!this.reconnecting } : null;
  }

  get canReconnect() {
    return !this.demo && !!this.known;
  }

  // Reconnecte la machine et la ceinture déconnectées (rameur qui s'est mis en veille…).
  async reconnect() {
    if (!this.canReconnect || this.reconnecting) return false;
    this.reconnecting = true;
    this.changed('trainer');
    const jobs = [];
    if (this.trainer.device && !this.trainer.connected) jobs.push(this.trainer.reconnect());
    if (this.hr.device && !this.hr.connected) jobs.push(this.hr.reconnect());
    const results = await Promise.allSettled(jobs);
    this.reconnecting = false;
    this.changed('trainer');
    return results.every((r) => r.status === 'fulfilled');
  }

  async connectHeartRate() {
    this.changed('hr');
    await this.hr.connect();
  }

  async connectController() {
    const c = new ZwiftController({ requestDevice: this.requestDevice });
    c.addEventListener('selected', () => {
      this.controllers.push(c);
      this.keyEmitter.attach(c);
      this.changed('zwift');
    });
    for (const ev of ['connected', 'handshake', 'side', 'disconnected']) c.addEventListener(ev, () => this.changed('zwift'));
    await c.connect();
    return c;
  }

  // Pente envoyée au trainer (si pilotable). La limitation à 4 envois/s est faite par Trainer.
  // wind (météo, facultatif) : { speed (m/s, + = de face), grade (pente sans le vent, vitesses comprises) }.
  // Vélo en mode simulation FTMS : le vent part dans le champ « vitesse du vent » de Set Indoor Bike
  // Simulation (le trainer calcule lui-même la traînée). Elliptique ou rameur (résistance) : `grade`
  // contient déjà la pente équivalente au vent.
  sendGrade(grade, terrain, wind = null) {
    if (!this.trainer.connected || !this.trainer.canControl) return;
    const simulation = this.trainer.kind === 'bike' || this.trainer.kind === null;
    if (wind && simulation) this.trainer.setGradeThrottled(wind.grade, wind.speed);
    else this.trainer.setGradeThrottled(grade);
  }

  vibrate() {
    for (const c of this.connectedControllers) c.vibrate().catch(() => {});
  }
}
