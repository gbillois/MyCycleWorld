// Matériel du joueur : home trainer, ceinture cardio, manettes Zwift. Réutilise les modules de src/ble/.
// Mode démo (?demo=1) : appareils simulés, comme sur la page de diagnostic.
import { Trainer } from '../src/ble/trainer.js';
import { HeartRateMonitor } from '../src/ble/heart-rate.js';
import { ZwiftController } from '../src/ble/zwift.js';
import { realRequestDevice } from '../src/ble/gatt.js';
import { createMockRequestDevice } from '../src/ble/mock.js';
import { KeyEmitter, loadKeymap } from '../src/core/keymap.js';

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
    return this.trainer.connected;
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

  async connectTrainer() {
    this.changed('trainer');
    await this.trainer.connect();
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
  sendGrade(grade) {
    if (this.trainer.connected && this.trainer.canControl) this.trainer.setGradeThrottled(grade);
  }

  vibrate() {
    for (const c of this.connectedControllers) c.vibrate().catch(() => {});
  }
}
