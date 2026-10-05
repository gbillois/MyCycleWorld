// Pont avec l'appli iOS. Dans la WebView de l'appli, le Bluetooth est géré en natif (CoreBluetooth) :
// le jeu ne parle pas à Web Bluetooth. Il reçoit un état (mesures, appareils connectés, vitesse virtuelle)
// et envoie des ordres (pente, vitesses, vibration). Même interface que Devices (voir devices.js).
//
// Protocole (version 1, révision 1)
//   jeu -> appli : window.webkit.messageHandlers.mcw.postMessage({ type, ... })
//       ready   { protocol, minor }  le jeu est chargé, l'appli peut envoyer l'état
//       grade   { value }     pente du terrain en %, AVANT vitesses virtuelles (l'appli les applique ;
//                             sur un elliptique ou un rameur, elle la convertit en niveau de résistance)
//       shift   { delta }     vitesse virtuelle +1 / -1
//       takeControl           prendre le contrôle du trainer (début de course)
//       vibrate               faire vibrer les manettes Zwift
//   appli -> jeu : window.mcwNative.state({...}) et window.mcwNative.button(nom, appuyé)
//       état v1 : v, demo, trainer { connected, controllable, controlled, controlReady, name, status },
//                 hr { connected, name }, controllers [noms], power, cadence, speed, heartRate, gear
//       révision 1 (champs facultatifs, absents quand inconnus) : minor, hardware (zwift | technogym | ble),
//                 machineKind (bike | cross | rower | treadmill | power), strokeRate (coups/min), strokeCount,
//                 distance (m), pace (s/500 m), stepRate (pas/min), resistance
import { KeyEmitter, loadKeymap } from '../src/core/keymap.js';

const PROTOCOL = 1;
const MINOR = 1;

const MACHINE_KINDS = new Set(['bike', 'cross', 'rower', 'treadmill', 'power']);
const HARDWARE_IDS = new Set(['zwift', 'technogym', 'ble']);

// Les boutons latéraux changent déjà les vitesses côté appli : on ne les retransmet pas en touches clavier.
const NATIVE_SHIFT_BUTTONS = new Set(['L_SHIFT', 'L_SHIFT2', 'R_SHIFT', 'R_SHIFT2']);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

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
    this.hardware = null; // profil matériel choisi dans l'appli (zwift | technogym | ble), null si inconnu
    // Mêmes formes que les objets de Devices (et Trainer), pour que l'écran d'accueil du jeu n'ait rien à savoir.
    this.trainer = {
      connected: false,
      canControl: false,
      controlled: false,
      name: 'Home trainer',
      device: null,
      kind: null,
      data: { power: null, cadence: null, speed: null, heartRate: null, resistance: null, strokeRate: null, strokeCount: null, distance: null, pace: null, stepRate: null },
    };
    this.hr = { connected: false, name: 'Ceinture cardio', bpm: null, device: null };

    win.mcwNative = {
      state: (s) => this.onState(s),
      button: (name, down) => this.onButton(name, down),
    };
    this.post({ type: 'ready', protocol: PROTOCOL, minor: MINOR });
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
    // Appli d'avant la révision 1 : pas de type de machine, c'est un vélo.
    this.trainer.kind = this.trainer.connected ? (MACHINE_KINDS.has(s.machineKind) ? s.machineKind : 'bike') : null;
    const d = this.trainer.data;
    for (const key of Object.keys(d)) d[key] = num(s[key]);
    if (HARDWARE_IDS.has(s.hardware)) this.hardware = s.hardware;
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

  // Un tapis de course ne fournit pas de puissance : le jeu reste alors au clavier, comme sur le web.
  get trainerActive() {
    return this.trainer.connected && this.trainer.kind !== 'treadmill';
  }

  // Type de la machine connectée : bike | cross | rower | treadmill | power (null si aucune).
  get machineKind() {
    return this.trainer.connected ? this.trainer.kind : null;
  }

  // Le profil matériel se choisit dans l'onglet « Appareils » de l'appli (voir this.hardware).
  setHardware() {}

  get power() {
    return this.trainer.data.power ?? 0;
  }

  get cadence() {
    return this.trainer.data.cadence ?? 0;
  }

  get heartRate() {
    return this.snapshot.heartRate || null;
  }

  get connectedControllers() {
    return this.controllers.map((name) => ({ name, side: null, handshake: true }));
  }

  // felt = pente ressentie (vitesses comprises), terrain = pente avant vitesses : l'appli applique les siennes
  // (et la convertit en niveau de résistance sur un elliptique ou un rameur).
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
    throw new Error('Connecte ta machine dans l’onglet « Appareils » de l’appli.');
  }

  async connectHeartRate() {
    throw new Error('Connecte la ceinture dans l’onglet « Appareils » de l’appli.');
  }

  async connectController() {
    throw new Error('Connecte la manette dans l’onglet « Appareils » de l’appli.');
  }
}
