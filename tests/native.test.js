// Pont avec l'appli iOS (game/native.js), sans navigateur : une fausse fenêtre enregistre les messages.
// Lancer : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeDevices, isNativeApp } from '../game/native.js';
import { KeyEmitter, DEFAULT_KEYMAP } from '../src/core/keymap.js';
import { VirtualGears } from '../src/core/gears.js';

class FakeKeyboardEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.key = init.key;
    this.code = init.code;
  }
}
globalThis.KeyboardEvent = FakeKeyboardEvent;

function setup() {
  const posted = [];
  const win = new EventTarget();
  win.webkit = { messageHandlers: { mcw: { postMessage: (m) => posted.push(m) } } };
  const keys = [];
  win.addEventListener('keydown', (e) => keys.push(`down:${e.code}`));
  win.addEventListener('keyup', (e) => keys.push(`up:${e.code}`));
  const keyEmitter = new KeyEmitter({ ...DEFAULT_KEYMAP }, win);
  const devices = new NativeDevices({ win, keyEmitter });
  const gears = new VirtualGears();
  devices.attachGears(gears);
  return { posted, win, keys, devices, gears };
}

const STATE = {
  v: 1,
  demo: false,
  trainer: { connected: true, controllable: true, controlled: true, controlReady: true, name: 'KICKR', status: 'ok' },
  hr: { connected: true, name: 'HRM' },
  controllers: ['Zwift Play', 'Zwift Play'],
  power: 210,
  cadence: 88,
  speed: 31.5,
  heartRate: 142,
  gear: 12,
};

test('détection de la WebView de l’appli', () => {
  assert.equal(isNativeApp({}), false);
  assert.equal(isNativeApp({ webkit: { messageHandlers: {} } }), false);
  assert.equal(isNativeApp({ webkit: { messageHandlers: { mcw: { postMessage() {} } } } }), true);
});

test('au démarrage, le jeu annonce qu’il est prêt', () => {
  const { posted, win } = setup();
  assert.deepEqual(posted, [{ type: 'ready', protocol: 1, minor: 2 }]);
  assert.equal(typeof win.mcwNative.state, 'function');
  assert.equal(typeof win.mcwNative.button, 'function');
});

test('l’état de l’appli alimente les mesures et les appareils', () => {
  const { devices, win } = setup();
  let changes = 0;
  devices.addEventListener('change', () => changes++);
  win.mcwNative.state(STATE);
  assert.equal(changes, 1);
  assert.equal(devices.trainerActive, true);
  assert.equal(devices.power, 210);
  assert.equal(devices.cadence, 88);
  assert.equal(devices.heartRate, 142);
  assert.equal(devices.trainer.canControl, true);
  assert.equal(devices.trainer.name, 'KICKR');
  assert.equal(devices.hr.bpm, 142);
  assert.equal(devices.connectedControllers.length, 2);
  assert.equal(devices.connectedControllers[0].handshake, true);
  // Appli d'avant la révision 1 : pas de type de machine, c'est un vélo.
  assert.equal(devices.machineKind, 'bike');
  assert.equal(devices.trainer.kind, 'bike');
  assert.equal(devices.trainer.data.strokeRate, null);
  assert.equal(devices.hardware, null);
});

test('révision 1 : rameur, cadence de coups, allure, distance et profil matériel', () => {
  const { devices, win } = setup();
  win.mcwNative.state({
    ...STATE,
    minor: 1,
    hardware: 'technogym',
    machineKind: 'rower',
    power: 203,
    cadence: 26,
    speed: undefined,
    strokeRate: 26.5,
    strokeCount: 120,
    distance: 300,
    pace: 120,
    resistance: 8,
  });
  assert.equal(devices.machineKind, 'rower');
  assert.equal(devices.trainer.kind, 'rower');
  assert.equal(devices.trainerActive, true);
  assert.equal(devices.hardware, 'technogym');
  assert.equal(devices.power, 203);
  const d = devices.trainer.data;
  assert.equal(d.strokeRate, 26.5);
  assert.equal(d.strokeCount, 120);
  assert.equal(d.distance, 300);
  assert.equal(d.pace, 120);
  assert.equal(d.resistance, 8);
  assert.equal(d.stepRate, null);
  assert.equal(d.speed, null);
});

test('révision 1 : elliptique (pas/min) ; valeurs invalides ignorées', () => {
  const { devices, win } = setup();
  win.mcwNative.state({ ...STATE, machineKind: 'cross', cadence: 70, stepRate: 140, resistance: 8.5, hardware: 'nimporte', strokeRate: 'x', pace: NaN });
  assert.equal(devices.machineKind, 'cross');
  assert.equal(devices.cadence, 70);
  assert.equal(devices.trainer.data.stepRate, 140);
  assert.equal(devices.trainer.data.resistance, 8.5);
  assert.equal(devices.trainer.data.strokeRate, null);
  assert.equal(devices.trainer.data.pace, null);
  assert.equal(devices.hardware, null, 'profil inconnu ignoré');
  win.mcwNative.state({ ...STATE, machineKind: 'fusée' });
  assert.equal(devices.machineKind, 'bike', 'type inconnu : vélo par défaut');
});

test('révision 1 : tapis de course sans puissance, machine déconnectée', () => {
  const { devices, win } = setup();
  win.mcwNative.state({ ...STATE, machineKind: 'treadmill', power: undefined });
  assert.equal(devices.machineKind, 'treadmill');
  assert.equal(devices.trainerActive, false, 'pas de puissance : le jeu reste au clavier');
  win.mcwNative.state({ ...STATE, machineKind: 'treadmill', power: 210 });
  assert.equal(devices.trainerActive, true, 'puissance estimée par l’appli : le tapis fait avancer le jeu');
  win.mcwNative.state({ ...STATE, trainer: { connected: false }, machineKind: 'rower' });
  assert.equal(devices.machineKind, null);
  assert.equal(devices.trainer.kind, null);
  assert.equal(devices.trainerActive, false);
});

test('démo de l’appli en profil Technogym : rameur simulé', () => {
  const { devices, win } = setup();
  win.mcwNative.state({ v: 1, minor: 1, demo: true, trainer: { connected: false }, hr: { connected: false }, controllers: [], machineKind: 'rower', strokeRate: 26, power: 180, gear: 12 });
  assert.equal(devices.machineKind, 'rower');
  assert.equal(devices.trainer.data.strokeRate, 26);
  assert.equal(devices.trainerActive, true);
});

test('sans trainer ni mesures : mode clavier, valeurs à zéro', () => {
  const { devices, win } = setup();
  win.mcwNative.state({ v: 1, demo: false, trainer: { connected: false }, hr: { connected: false }, controllers: [], gear: 12 });
  assert.equal(devices.trainerActive, false);
  assert.equal(devices.power, 0);
  assert.equal(devices.heartRate, null);
  assert.equal(devices.trainer.device, null);
});

test('mode démo de l’appli : le trainer compte comme connecté', () => {
  const { devices, win } = setup();
  win.mcwNative.state({ v: 1, demo: true, trainer: { connected: false }, hr: { connected: false }, controllers: [], power: 180, gear: 12 });
  assert.equal(devices.trainerActive, true);
  assert.equal(devices.trainer.name, 'Démo');
  assert.equal(devices.power, 180);
});

test('le cardio du trainer n’est pas affiché comme ceinture quand elle est absente', () => {
  const { devices, win } = setup();
  win.mcwNative.state({ v: 1, trainer: { connected: true }, hr: { connected: false }, heartRate: 120, gear: 12 });
  assert.equal(devices.hr.bpm, null);
  assert.equal(devices.heartRate, 120); // le jeu l’affiche quand même
});

test('la vitesse virtuelle de l’appli fait foi', () => {
  const { devices, win, gears } = setup();
  let flashes = 0;
  gears.addEventListener('change', () => flashes++);
  win.mcwNative.state({ ...STATE, gear: 14 });
  assert.equal(gears.gear, 14);
  assert.equal(flashes, 1);
  win.mcwNative.state({ ...STATE, gear: 14 });
  assert.equal(flashes, 1, 'pas de changement, pas d’événement');
  assert.equal(devices.gears, gears);
});

test('les vitesses se changent via l’appli, jamais en local', () => {
  const { devices, posted, gears } = setup();
  devices.shift(1);
  devices.shift(-5);
  assert.deepEqual(posted.slice(1), [{ type: 'shift', delta: 1 }, { type: 'shift', delta: -1 }]);
  assert.equal(gears.gear, 12);
});

test('la pente envoyée est celle du terrain, avant vitesses virtuelles', () => {
  const { devices, posted } = setup();
  devices.sendGrade(9, 6); // ressentie 9 % (vitesse 15), terrain 6 %
  devices.sendGrade(4, undefined); // repli
  devices.sendGrade(NaN, NaN);
  assert.deepEqual(posted.slice(1), [{ type: 'grade', value: 6 }, { type: 'grade', value: 4 }]);
});

test('début de course : prise de contrôle ; vibration', () => {
  const { devices, posted } = setup();
  devices.prepareRace();
  devices.vibrate();
  assert.deepEqual(posted.slice(1), [{ type: 'takeControl' }, { type: 'vibrate' }]);
});

test('boutons Zwift : touches clavier, sauf les boutons latéraux (déjà gérés par l’appli)', () => {
  const { win, keys } = setup();
  win.mcwNative.button('L_LEFT', true);
  win.mcwNative.button('R_SHIFT', true);
  win.mcwNative.button('L_SHIFT2', true);
  win.mcwNative.button('R_Z', true);
  win.mcwNative.button('L_LEFT', false);
  win.mcwNative.button('R_Z', false);
  win.mcwNative.button(42, true); // invalide : ignoré
  assert.deepEqual(keys, ['down:ArrowLeft', 'down:Space', 'up:ArrowLeft', 'up:Space']);
});

test('manettes perdues : les touches tenues sont relâchées', () => {
  const { win, keys } = setup();
  win.mcwNative.state(STATE);
  win.mcwNative.button('L_RIGHT', true);
  win.mcwNative.state({ ...STATE, controllers: [] });
  assert.deepEqual(keys, ['down:ArrowRight', 'up:ArrowRight']);
});

test('révision 2 : écrans natifs ouverts seulement si l’appli annonce « openNative »', () => {
  const { devices, win, posted } = setup();
  // Pas encore d'état, puis appli d'avant la révision 2 : rien n'est envoyé, le jeu garde sa page « Connecter ».
  assert.equal(devices.canOpenNative, false);
  assert.equal(devices.openNative('devices', 'technogym'), false);
  win.mcwNative.state({ ...STATE, minor: 1 });
  assert.equal(devices.canOpenNative, false);
  assert.equal(devices.openNative('settings'), false);
  assert.deepEqual(posted.slice(1), []);
  // Appli récente.
  win.mcwNative.state({ ...STATE, minor: 2, capabilities: ['openNative'] });
  assert.equal(devices.canOpenNative, true);
  assert.equal(devices.openNative('devices', 'technogym'), true);
  assert.equal(devices.openNative('devices', 'zwift'), true);
  assert.equal(devices.openNative('cockpit'), true);
  assert.equal(devices.openNative(), true, 'par défaut : accueil des réglages');
  assert.equal(devices.openNative('log', 'peloton'), true, 'profil inconnu : non transmis');
  assert.equal(devices.openNative('inspector'), true);
  assert.equal(devices.openNative('fusée'), false, 'écran inconnu : rien');
  assert.deepEqual(posted.slice(1), [
    { type: 'openNative', screen: 'devices', profile: 'technogym' },
    { type: 'openNative', screen: 'devices', profile: 'zwift' },
    { type: 'openNative', screen: 'cockpit' },
    { type: 'openNative', screen: 'settings' },
    { type: 'openNative', screen: 'log' },
    { type: 'openNative', screen: 'inspector' },
  ]);
});

test('révision 2 : capabilities invalides ou retirées', () => {
  const { devices, win } = setup();
  win.mcwNative.state({ ...STATE, capabilities: 'openNative' });
  assert.equal(devices.canOpenNative, false, 'pas une liste : ignoré');
  win.mcwNative.state({ ...STATE, capabilities: [42, null, 'openNative'] });
  assert.equal(devices.canOpenNative, true, 'les noms non textuels sont ignorés');
  win.mcwNative.state({ ...STATE, capabilities: ['autreChose'] });
  assert.equal(devices.canOpenNative, false);
  win.mcwNative.state({ ...STATE, capabilities: ['openNative'] });
  win.mcwNative.state(STATE);
  assert.equal(devices.canOpenNative, false, 'chaque état fait foi');
});

test('état invalide ignoré, connexion impossible depuis le jeu', async () => {
  const { devices, win } = setup();
  win.mcwNative.state(null);
  win.mcwNative.state('x');
  assert.equal(devices.trainerActive, false);
  await assert.rejects(() => devices.connectTrainer(), /Appareils/);
});
