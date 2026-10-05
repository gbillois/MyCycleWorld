// Pont avec l'appli iOS. Dans la WebView de l'appli, le Bluetooth est géré en natif (CoreBluetooth) :
// le jeu ne parle pas à Web Bluetooth. Il reçoit un état (mesures, appareils connectés, vitesse virtuelle)
// et envoie des ordres (pente, vitesses, vibration). Même interface que Devices (voir devices.js).
//
// Protocole (version 1)
//   jeu -> appli : window.webkit.messageHandlers.mcw.postMessage({ type, ... })
//       ready                 le jeu est chargé, l'appli peut envoyer l'état
//       grade   { value }     pente du terrain en %, AVANT vitesses virtuelles (l'appli les applique)
//       shift   { delta }     vitesse virtuelle +1 / -1
//       takeControl           prendre le contrôle du trainer (début de course)
//       vibrate               faire vibrer les manettes Zwift
//   appli -> jeu : window.mcwNative.state({...}) et window.mcwNative.button(nom, appuyé)
import { KeyEmitter, loadKeymap } from '../src/core/keymap.js';

const PROTOCOL = 1;

// Les boutons latéraux changent déjà les vitesses côté appli : on ne les retransmet pas en touches clavier.
const NATIVE_SHIFT_BUTTONS = new Set(['L_SHIFT', 'L_SHIFT2', 'R_SHIFT', 'R_SHIFT2']);

export function isNativeApp(win = window) {
  return typeof win.webkit?.messageHandlers?.mcw?.postMessage === 'function';
}

export class NativeDevices extends EventTarget {
  constructor({ win = window, keyEmitter } = {}) {
    super();
    this.win = win;
    this.native = true;
    this.bluetoothAvailable = true;
    this.keyEmitter = keyEmitter || new KeyEmitter(loadKeymap(), win);
    this.gears = null;
    this.snapshot = {};
    this.controllers = [];
    // Mêmes formes que les objets de Devices, pour que l'écran d'accueil du jeu n'ait rien à savoir.
    this.trainer = { connected: false, canControl: false, controlled: false, name: 'Home trainer', device: null, data: { power: null, cadence: null } };
    this.hr = { connected: false, name: 'Ceinture cardio', bpm: null, device: null };

    win.mcwNative = {
      state: (s) => this.onState(s),
      button: (name, down) => this.onButton(name, down),
    };
    this.post({ type: 'ready', protocol: PROTOCOL });
  }

  // Le jeu garde son objet VirtualGears pour l'affichage ; l'appli fait foi pour la vitesse choisie.
  attachGears(gears) {
    this.gears = gears;
  }

  post(message) {
    try {
      this.win.webkit.messageHandlers.mcw.postMessage(message);
    } catch {
      /* hors de l'appli : rien à faire */
    }
  }

  onState(s) {
    if (!s || typeof s !== 'object') return;
    this.snapshot = s;
    const demo = !!s.demo;
    const t = s.trainer || {};
    const h = s.hr || {};
    Object.assign(this.trainer, {
      connected: demo || !!t.connected,
      canControl: !!t.controllable,
      controlled: !!t.controlled,
      name: demo ? 'Démo' : t.name || 'Home trainer',
    });
    if (this.trainer.connected) this.trainer.device = true;
    this.trainer.data.power = s.power ?? null;
    this.trainer.data.cadence = s.cadence ?? null;
    Object.assign(this.hr, { connected: demo || !!h.connected, name: demo ? 'Démo' : h.name || 'Ceinture cardio' });
    if (this.hr.connected) this.hr.device = true;
    this.hr.bpm = this.hr.connected ? s.heartRate || null : null;
    this.controllers = Array.isArray(s.controllers) ? s.controllers.map(String) : [];
    // Plus de manette connectée : on relâche les touches qu'elles tenaient.
    if (!this.controllers.length) this.keyEmitter.releaseAll();
    if (this.gears && Number.isInteger(s.gear) && s.gear !== this.gears.gear) this.gears.shift(s.gear - this.gears.gear);
    this.dispatchEvent(new Event('change'));
  }

  onButton(name, down) {
    if (typeof name !== 'string' || NATIVE_SHIFT_BUTTONS.has(name)) return;
    if (down) this.keyEmitter.buttonDown(name);
    else this.keyEmitter.buttonUp(name);
  }

  get trainerActive() {
    return this.trainer.connected;
  }

  get power() {
    return this.snapshot.power ?? 0;
  }

  get cadence() {
    return this.snapshot.cadence ?? 0;
  }

  get heartRate() {
    return this.snapshot.heartRate || null;
  }

  get connectedControllers() {
    return this.controllers.map((name) => ({ name, side: null, handshake: true }));
  }

  // felt = pente ressentie (vitesses comprises), terrain = pente avant vitesses : l'appli applique les siennes.
  sendGrade(felt, terrain) {
    const value = Number.isFinite(terrain) ? terrain : felt;
    if (Number.isFinite(value)) this.post({ type: 'grade', value });
  }

  shift(delta) {
    this.post({ type: 'shift', delta: delta < 0 ? -1 : 1 });
  }

  prepareRace() {
    this.post({ type: 'takeControl' });
  }

  vibrate() {
    this.post({ type: 'vibrate' });
  }

  async connectTrainer() {
    throw new Error('Connecte le home trainer dans l’onglet « Appareils » de l’appli.');
  }

  async connectHeartRate() {
    throw new Error('Connecte la ceinture dans l’onglet « Appareils » de l’appli.');
  }

  async connectController() {
    throw new Error('Connecte la manette dans l’onglet « Appareils » de l’appli.');
  }
}
