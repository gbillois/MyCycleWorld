// Pont avec l'appli iOS. Dans la WebView de l'appli, le Bluetooth est géré en natif (CoreBluetooth) :
// le jeu ne parle pas à Web Bluetooth. Il reçoit un état (mesures, appareils connectés, vitesse virtuelle)
// et envoie des ordres (pente, vitesses, vibration, ouverture des écrans natifs). Même interface que Devices
// (voir devices.js).
//
// Protocole (version 1, révision 4)
//   jeu -> appli : window.webkit.messageHandlers.mcw.postMessage({ type, ... })
//       ready   { protocol, minor }  le jeu est chargé, l'appli peut envoyer l'état
//       grade   { value }     pente du terrain en %, AVANT vitesses virtuelles (l'appli les applique ;
//                             sur un elliptique ou un rameur, elle la convertit en niveau de résistance)
//       shift   { delta }     vitesse virtuelle +1 / -1
//       takeControl           prendre le contrôle du trainer (début de course)
//       vibrate               faire vibrer les manettes Zwift
//       openNative { screen, profile? }  révision 2, seulement si l'appli l'annonce dans capabilities :
//                             ouvre un écran natif par-dessus le jeu (settings | devices | cockpit | inspector
//                             | log), après avoir choisi le profil matériel s'il est donné (zwift | technogym | ble)
//       reconnect             révision 3, si annoncé : reconnecter la machine et la ceinture déjà connues
//                             (connexions en attente qui aboutissent dès que l'appareil se réveille)
//       useMachine { id, kind? }  révision 4, si « gym » est annoncé : se brancher sur cette machine de la
//                             carte des salles (connexion en attente qui aboutit dès qu'elle se réveille)
//       releaseMachine        révision 4 : abandonner la connexion en attente vers la machine choisie
//       gymScan { active }    révision 4 : écouter les machines autour (écran « Sur quelle machine ? »)
//       openNative { screen: 'gym' }  révision 4 : écran de cartographie des salles
//   appli -> jeu : window.mcwNative.state({...}), window.mcwNative.button(nom, appuyé)
//                  et window.mcwNative.gym({...}) (révision 4 : carte des salles, voir src/core/gym.js)
//       état v1 : v, demo, trainer { connected, controllable, controlled, controlReady, name, status },
//                 hr { connected, name }, controllers [noms], power, cadence, speed, heartRate, gear
//       révision 1 (champs facultatifs, absents quand inconnus) : minor, hardware (zwift | technogym | ble),
//                 machineKind (bike | cross | rower | treadmill | power), strokeRate (coups/min), strokeCount,
//                 distance (m), pace (s/500 m), stepRate (pas/min), resistance
//       révision 2 : capabilities [noms des commandes facultatives comprises par l'appli, par exemple
//                 'openNative']. Une appli plus ancienne ne l'envoie pas : le jeu garde alors son comportement
//                 d'avant (page « Connecter » avec le message renvoyant vers l'onglet « Appareils »).
//       révision 3 : reconnect { trainer?, hr? (noms des appareils déjà connus), waiting (reconnexion en
//                 attente) }, absent quand l'appli ne connaît aucun appareil.
//       révision 4 : trainer.id (identifiant de la machine connectée ou attendue, celui de la carte) et
//                 trainer.waiting (connexion en attente) ; capability « gym ».
//       carte (révision 4) : { v, defaultPlace, places [{ id, name, width, depth (m), machines [{ id, name,
//                 label?, kind?, x?, y?, err? (m) }] }], nearby [{ id, name, kind?, rssi }], scanning }
import { KeyEmitter, loadKeymap } from '../src/core/keymap.js';
import { parseGym } from '../src/core/gym.js';

const PROTOCOL = 1;
const MINOR = 4;

const MACHINE_KINDS = new Set(['bike', 'cross', 'rower', 'treadmill', 'power']);
const HARDWARE_IDS = new Set(['zwift', 'technogym', 'ble']);
const NATIVE_SCREENS = new Set(['settings', 'devices', 'cockpit', 'inspector', 'log', 'gym']);

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
    this.capabilities = new Set(); // commandes facultatives annoncées par l'appli (révision 2)
    this.known = null; // appareils déjà connus (révision 3)
    this.gym = null; // carte des salles (révision 4), voir src/core/gym.js
    // Mêmes formes que les objets de Devices (et Trainer), pour que l'écran d'accueil du jeu n'ait rien à savoir.
    this.trainer = {
      id: null, // identifiant de la machine connectée ou attendue (révision 4)
      waiting: false, // connexion en attente vers cette machine (révision 4)
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
      gym: (g) => this.onGym(g),
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
    this.trainer.id = typeof t.id === 'string' ? t.id.toUpperCase() : null;
    this.trainer.waiting = !!t.waiting;
    // Appli d'avant la révision 1 : pas de type de machine, c'est un vélo.
    this.trainer.kind = this.trainer.connected ? (MACHINE_KINDS.has(s.machineKind) ? s.machineKind : 'bike') : null;
    const d = this.trainer.data;
    for (const key of Object.keys(d)) d[key] = num(s[key]);
    if (HARDWARE_IDS.has(s.hardware)) this.hardware = s.hardware;
    this.capabilities = new Set(Array.isArray(s.capabilities) ? s.capabilities.filter((c) => typeof c === 'string') : []);
    Object.assign(this.hr, { connected: demo || !!h.connected, name: demo ? 'Démo' : h.name || 'Ceinture cardio' });
    if (this.hr.connected) this.hr.device = true;
    this.hr.bpm = this.hr.connected ? s.heartRate || null : null;
    this.controllers = Array.isArray(s.controllers) ? s.controllers.map(String) : [];
    // Plus de manette connectée : on relâche les touches qu'elles tenaient.
    if (!this.controllers.length) this.keyEmitter.releaseAll();
    if (this.gears && Number.isInteger(s.gear) && s.gear !== this.gears.gear) this.gears.shift(s.gear - this.gears.gear);
    // Révision 3 : appareils déjà connus (bouton « Reconnecter » de la pause et du choix du niveau).
    const r = s.reconnect && typeof s.reconnect === 'object' ? s.reconnect : null;
    this.known = r ? { trainer: typeof r.trainer === 'string' ? r.trainer : null, hr: typeof r.hr === 'string' ? r.hr : null, waiting: !!r.waiting } : null;
    this.dispatchEvent(new Event('change'));
  }

  onGym(g) {
    this.gym = parseGym(g);
    this.dispatchEvent(new Event('gym'));
  }

  onButton(name, down) {
    if (typeof name !== 'string' || NATIVE_SHIFT_BUTTONS.has(name)) return;
    if (down) this.keyEmitter.buttonDown(name);
    else this.keyEmitter.buttonUp(name);
  }

  // Toute machine connectée fait avancer le jeu. Tapis de course : seulement quand l'appli envoie sa
  // puissance estimée (vitesse et pente) ; sinon (ancienne appli) le jeu reste au clavier.
  get trainerActive() {
    return this.trainer.connected && (this.trainer.kind !== 'treadmill' || this.trainer.data.power != null);
  }

  // Type de la machine connectée : bike | cross | rower | treadmill | power (null si aucune).
  get machineKind() {
    return this.trainer.connected ? this.trainer.kind : null;
  }

  // Le profil matériel se choisit dans l'écran « Appareils » de l'appli (voir this.hardware et openNative).
  setHardware() {}

  // Reconnecte la machine et la ceinture déjà connues ; false si l'appli ne sait pas le faire.
  get canReconnect() {
    return this.capabilities.has('reconnect') && !!this.known;
  }

  reconnect() {
    if (!this.canReconnect) return false;
    this.post({ type: 'reconnect' });
    return true;
  }

  // Carte des salles (révision 4) : l'appli sait choisir une machine de la carte et s'y brancher.
  get canUseGym() {
    return this.capabilities.has('gym');
  }

  // Se brancher sur une machine de la carte (connexion en attente, aboutit dès qu'elle se réveille).
  useMachine(id, kind) {
    if (!this.canUseGym || typeof id !== 'string') return false;
    const message = { type: 'useMachine', id };
    if (MACHINE_KINDS.has(kind)) message.kind = kind;
    this.post(message);
    return true;
  }

  releaseMachine() {
    if (this.canUseGym) this.post({ type: 'releaseMachine' });
  }

  // Écoute des machines autour pendant que l'écran « Sur quelle machine ? » est ouvert.
  gymScan(active) {
    if (this.canUseGym) this.post({ type: 'gymScan', active: !!active });
  }

  // L'appli sait ouvrir ses écrans natifs (appareils, cockpit, diagnostic) par-dessus le jeu.
  get canOpenNative() {
    return this.capabilities.has('openNative');
  }

  // Ouvre un écran natif ; renvoie false si l'appli ne le permet pas (appli plus ancienne) ou si l'écran est inconnu.
  openNative(screen = 'settings', profile) {
    if (!this.canOpenNative || !NATIVE_SCREENS.has(screen)) return false;
    const message = { type: 'openNative', screen };
    if (HARDWARE_IDS.has(profile)) message.profile = profile;
    this.post(message);
    return true;
  }

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
  // Météo : le protocole n'a pas de champ vent. Le jeu fond donc le vent dans `terrain` (pente équivalente
  // à la traînée en plus ou en moins, voir windGrade dans src/core/weather.js) : rien à changer côté appli,
  // et un vélo, un elliptique ou un rameur le ressentent tous. Le 3e argument (détail du vent) est ignoré ici.
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
    throw new Error('Connecte ta machine dans « Appareils » de l’appli.');
  }

  async connectHeartRate() {
    throw new Error('Connecte la ceinture dans « Appareils » de l’appli.');
  }

  async connectController() {
    throw new Error('Connecte la manette dans « Appareils » de l’appli.');
  }
}
