// MyCycleWorld, prototype jouable : scène 3D, boucle de jeu, écrans, clavier/manettes, pente au trainer.
import * as THREE from 'three';
import { Track, buildScenery, minimapPath } from './track.js';
import { buildScenery as buildDetailedScenery, disposeTree } from './scenery.js';
import { followSun } from './atmosphere.js';
import { createPost } from './post.js';
import { COURSE_ORDER, courseById, SURFACES } from './courses.js';
import { elevationGain } from '../src/core/profile.js';
import { RiderModel, createItemBox, createBanana } from './models.js';
import { DetailedRider } from './rider.js';
import { updateCrowds } from './people.js';
import { Race, ITEMS } from './race.js';
import { Devices, explainError } from './devices.js';
import { NativeDevices, isNativeApp } from './native.js';
import { Hud, formatTime, ordinal, ordinalHtml, renderResults } from './hud.js';
import { VirtualGears, simulatedEffort } from '../src/core/gears.js';
import { msToKmh, DEFAULTS } from '../src/core/physics.js';
import { bluetoothAdvice } from '../src/core/platform.js';
import { keepScreenOn } from '../src/core/wakelock.js';
import { TouchControls, wantsTouch } from './touch.js';
import { TitleMenu } from './menu.js';
import { RowingRace, formatSplit, splitFromSpeed } from '../src/core/rowing.js';
import { buildRowingWorld } from './rowing-scene.js';
import { Boat } from './boat.js';
import { HARDWARE_ORDER, hardwareById } from '../src/core/hardware.js';
import { MACHINE_LABELS } from '../src/ble/trainer.js';
import { onLog, logText, formatEntry } from '../src/ble/log.js';
import { uuidName } from '../src/ble/bytes.js';
import { BleInspector, parseServiceList } from '../src/ble/inspector.js';
import { FrameGovernor } from '../src/core/framerate.js';
import { TapDrive } from '../src/core/taps.js';
import { createAudio } from './audio/index.js';
import { KayakMode } from './kayak-mode.js';
import { KAYAK_LEVELS, kayakCard, kayakPreview } from './kayak-menu.js';
import { riverById } from './rivers.js';
import { WeatherSystem } from './weather.js';
import { weatherMode, forecast, WEATHER_LABELS, windGrade, ftmsWindSpeed } from '../src/core/weather.js';
import { buildForestScenery } from './mtb-scene.js';
import { MtbMode } from './mtb-mode.js';
import { HelmetFx } from './helmet-fx.js';
import { GymPicker } from './gym-picker.js';
import { gateStatus } from '../src/core/gym.js';
import { STAGES, STAGE_ORDER, JOURNEY, PLACES, nextStage, placeAt, readProgress, recordStage } from './middle-earth.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const LAPS_PARAM = parseInt(params.get('laps'), 10);
const lapsFor = (course) => Math.max(1, Math.min(10, LAPS_PARAM || course.laps || 3));

// Circuit choisi : paramètre d'adresse ?course=, sinon le dernier joué sur cet appareil.
const COURSE_KEY = 'mycycleworld.course';
function storedCourse() {
  try {
    return localStorage.getItem(COURSE_KEY);
  } catch {
    return null;
  }
}
let courseId = courseById(params.get('course') || storedCourse()).id;

function storedPref(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function savePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : réglage valable pour cette session seulement */
  }
}
// Profil matériel (Zwift, Technogym, BLE standard) et direction automatique.
const HW_KEY = 'mycycleworld.hw';
const STEER_KEY = 'mycycleworld.steer';
let hwId = hardwareById(params.get('hw') || storedPref(HW_KEY)).id;
let steerPref = ['auto', 'on', 'off'].includes(storedPref(STEER_KEY)) ? storedPref(STEER_KEY) : 'auto';
// Tapoter l'écran pour pédaler ou ramer (activé par défaut, désactivable dans Options).
const TAP_KEY = 'mycycleworld.tap';
let tapEnabled = storedPref(TAP_KEY) !== 'off';
const tapDrive = new TapDrive();
// Météo (Options) : aléatoire par défaut, toujours beau, pluie, vent, ou désactivée (comportement d'origine).
// ?weather= force le mode, ?seed= fixe le tirage (captures, tests).
const WEATHER_KEY = 'mycycleworld.weather';
let weatherPref = weatherMode(params.get('weather') || storedPref(WEATHER_KEY));
const WEATHER_SEED = parseInt(params.get('seed'), 10);
const weatherSeed = () => (Number.isFinite(WEATHER_SEED) ? WEATHER_SEED : (Math.random() * 4294967296) >>> 0);
let playMachine = 'bike'; // bike | cross | row : machine choisie dans « Jouer »

// Puissance simulée au clavier (sans home trainer). Au rameur : 180 W à 26 coups/min ; en kayak, Maj + ↑ = sprint.
const SIM = { power: 250, cadence: 90, rise: 900, fall: 140, cadenceFall: 70 };
const SIM_ROW = { power: 180, rate: 26, sprint: 250, sprintRate: 32 };
const TURBO_GRADE = -5;
const BANANA_GRADE = 10;

// ---------- Graphismes ----------
// « Détaillés » (par défaut) ou « Simples » (le style low-poly d'origine, plus léger). Choix mémorisé sur l'appareil.
const GFX_KEY = 'mycycleworld.gfx';
function storedGfx() {
  try {
    return localStorage.getItem(GFX_KEY);
  } catch {
    return null;
  }
}
const GFX = ['simple', 'detailed'].includes(params.get('gfx')) ? params.get('gfx') : storedGfx() === 'simple' ? 'simple' : 'detailed';
const DETAILED = GFX === 'detailed';
// Qualité du mode détaillé : 'high' sur ordinateur, 'medium' sur écran tactile, 'low' sur demande (?quality=low).
const QUALITY = ['high', 'medium', 'low'].includes(params.get('quality')) ? params.get('quality') : wantsTouch(params) ? 'medium' : 'high';
const SHADOWS = DETAILED && QUALITY !== 'low';

// ---------- Scène ----------

const renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true, powerPreference: 'high-performance' });
const BASE_RATIO = Math.min(window.devicePixelRatio || 1, DETAILED && QUALITY === 'high' ? 2 : 1.5);
renderer.setPixelRatio(BASE_RATIO);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 4000);
let track = new Track(courseById(courseId));
let scenery;
let sun = null;
if (DETAILED) {
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = SHADOWS;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene.add(new THREE.HemisphereLight('#cfe7ff', '#6b8f4a', 1.1));
  sun = new THREE.DirectionalLight('#fff0d4', 2.8);
  if (SHADOWS) {
    // Ombres douces dans une zone qui suit le joueur.
    sun.castShadow = true;
    const size = QUALITY === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(size, size);
    const box = QUALITY === 'high' ? 36 : 30; // zone serrée, centrée devant la caméra (followSun)
    Object.assign(sun.shadow.camera, { left: -box, right: box, top: box, bottom: -box, near: 1, far: 420 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
  }
  scene.add(sun, sun.target);
} else {
  const skyColor = new THREE.Color('#cfe6fb');
  scene.background = skyColor;
  scene.fog = new THREE.Fog(skyColor, 160, 1100);
  scene.add(new THREE.HemisphereLight('#dff1ff', '#55703a', 1.6));
  const simpleSun = new THREE.DirectionalLight('#fff3dc', 2.2);
  simpleSun.position.set(-300, 400, 200);
  scene.add(simpleSun);
}

// Météo (weather.js) : vent, pluie, route mouillée ; bannières du HUD au début et à la fin des averses.
const weather = new WeatherSystem({ scene, renderer, detailed: DETAILED, quality: QUALITY, onEvent: (type, d) => weatherBanner(type, d) });

// Décor du circuit courant (reconstruit quand on change de circuit, sans recharger la page :
// un rechargement couperait les connexions Bluetooth).
function buildWorld() {
  // Forêt (circuit de VTT) : décor dédié, détaillé ou simple (mtb-scene.js).
  if (track.course.theme === 'forest') {
    scenery = buildForestScenery(scene, track, { quality: QUALITY, renderer, detailed: DETAILED });
  } else if (DETAILED) {
    scenery = buildDetailedScenery(scene, track, { quality: QUALITY, renderer });
  } else {
    const simple = buildScenery(scene, track);
    if (!scene.fog) scene.fog = new THREE.Fog('#cfe6fb', 160, 1100); // retirée par un autre décor (forêt)
    scene.fog.color.set(simple.fogColor); // brume et fond à la couleur de l'horizon (Mordor, Lórien...)
    scene.background = scene.fog.color;
    scenery = {
      ...simple,
      update: (dt, cam) => {
        simple.sky.position.copy(cam.position);
        simple.animate?.(dt); // étapes de la Terre du Milieu : roue du moulin, lave, fumées
      },
      dispose: () => {
        for (const root of [simple.group, simple.sky]) {
          scene.remove(root);
          disposeTree(root);
        }
      },
    };
  }
  // La météo mémorise l'ambiance du décor ; avant de le défaire, elle la rétablit et libère ses particules.
  weather.attach(scenery, track);
  const dispose = scenery.dispose;
  scenery.dispose = () => {
    weather.detach();
    dispose();
  };
}
buildWorld();

// Précompile tous les programmes graphiques (shaders) de la scène pendant l'écran de chargement, objets
// cachés compris : sinon chaque nouvel objet qui entre dans le champ fige l'image le temps de sa
// compilation (des centaines de millisecondes sur iPad, à l'accueil comme en course).
let warming = false;
async function warmShaders() {
  warming = true;
  const hidden = [];
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  try {
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
    // Rendu d'amorçage sans élagage : compile aussi les programmes des ombres
    // (que compile() ne couvre pas) et envoie toutes les géométries à la carte graphique.
    const culled = [];
    scene.traverse((o) => {
      if (o.isMesh && o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
    });
    // Rendu à l'écran (caché par l'écran de chargement ou le menu) : une cible hors écran compilerait
    // d'autres variantes (sans tone mapping ni sortie sRGB) et ne servirait à rien.
    renderer.render(scene, camera);
    for (const o of culled) o.frustumCulled = true;
  } catch (e) {
    console.warn('Précompilation des shaders incomplète', e);
  }
  for (const o of hidden) o.visible = false;
  warming = false;
}
const Rider = DETAILED ? DetailedRider : RiderModel;
const hud = new Hud(track);
const menu = new TitleMenu($('home'));

// Post-traitement des graphismes détaillés (voir post.js) : halo, étalonnage filmique, vignettage.
const post = DETAILED ? await createPost(renderer, scene, camera, QUALITY) : null;

// Écran tactile : boutons à l'écran (ils envoient les mêmes touches que le clavier).
const TOUCH = wantsTouch(params);
const touch = TOUCH ? new TouchControls($('hud')) : null;
if (TOUCH) document.body.classList.add('touch');

// Son (voir audio/index.js) : démarre au premier geste, réglages dans Options.
const audio = createAudio({ quality: QUALITY, touch: TOUCH });

// Sons du mode kayak : abonnement aux événements de chaque nouvelle course, coups de pagaie au rythme du joueur.
const kayakAudio = { race: null, half: 0, count: 0 };
// Kayak : vitesse (eau sous la coque) et effort, temps et distance restante (intensité de la musique).
const kayakPlayerOut = { speed: 0, power: 0, time: 0, remaining: Infinity };
function kayakPlayerAudio() {
  const r = kayak?.race;
  const p = r?.player;
  kayakPlayerOut.speed = p?.v ?? 0;
  kayakPlayerOut.power = p?.power ?? 0;
  kayakPlayerOut.time = r?.time ?? 0;
  kayakPlayerOut.remaining = p && kayak?.river ? Math.max(0, kayak.river.finish - p.s) : Infinity;
  return kayakPlayerOut;
}
function kayakSounds() {
  const r = kayak?.race;
  if (!r) return;
  if (r !== kayakAudio.race) {
    kayakAudio.race = r;
    kayakAudio.half = Math.floor(r.player.phase / Math.PI);
    kayakAudio.count = Math.ceil(-r.time);
    const mine = (d) => d?.racer?.isPlayer;
    r.addEventListener('go', () => audio.sfx('horn'));
    r.addEventListener('gate', ({ detail: d }) => mine(d) && audio.sfx(d.ok ? 'gate-pass' : 'gate-miss'));
    r.addEventListener('sprint', ({ detail: d }) => mine(d) && audio.sfx(d.ok ? 'sprint-gate' : 'sprint-fail'));
    r.addEventListener('glide', ({ detail: d }) => mine(d) && audio.sfx(d.ok ? 'whoosh' : 'bump'));
    r.addEventListener('bump', ({ detail: d }) => mine(d) && audio.sfx('bump'));
    r.addEventListener('pickup', ({ detail: d }) => mine(d) && audio.sfx('pickup'));
    r.addEventListener('use', ({ detail: d }) => mine(d) && d.item === 'turbo' && audio.sfx('turbo'));
    r.addEventListener('whirl-hit', ({ detail: d }) => mine(d) && audio.sfx('whirlpool', { duration: 2.5 }));
    r.addEventListener('finish', ({ detail: d }) => {
      if (!d?.isPlayer) return;
      audio.sfx('fanfare');
      const pos = r.positionOf ? r.positionOf(d) : 9;
      setTimeout(() => audio.sfx(pos === 1 ? 'win' : pos <= 3 ? 'podium' : 'finish-other'), 1800);
    });
  }
  // Compte à rebours 3, 2, 1
  if (r.time < 0) {
    const c = Math.ceil(-r.time);
    if (c < kayakAudio.count) audio.sfx('beep');
    kayakAudio.count = c;
  }
  // Un coup d'aviron du rameur = un coup de pagaie à gauche puis un à droite.
  const half = Math.floor(r.player.phase / Math.PI);
  if (half !== kayakAudio.half && state === 'race' && r.player.strokeRate > 1) audio.sfx('paddle', { side: half % 2 ? 'right' : 'left' });
  kayakAudio.half = half;
}
menu.sound = (kind) => audio.ui(kind);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (post) post.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Fluidité : 60 images/s au plus, résolution abaissée automatiquement si la machine peine (?fps=1 affiche le compteur).
const governor = new FrameGovernor({
  min: Math.min(1, 0.75 / BASE_RATIO), // jamais sous 0.75 pixel physique par pixel CSS
  onScale: (k) => {
    if (params.has('fixedres')) return; // captures d'écran et tests : résolution fixe
    renderer.setPixelRatio(BASE_RATIO * k);
    resize();
  },
});
const fpsMeter = params.has('fps') ? document.body.appendChild(Object.assign(document.createElement('div'), { className: 'fps-meter' })) : null;

// ---------- État du jeu ----------

// Dans l'appli iOS, le Bluetooth et les manettes viennent de l'appli native (voir native.js).
const NATIVE = isNativeApp();
const devices = NATIVE ? new NativeDevices() : new Devices({ demo: DEMO });
const gears = new VirtualGears();
devices.setHardware(hwId);
if (NATIVE) {
  devices.attachGears(gears);
  document.body.classList.add('native');
}
const keys = new Set();
const sim = { power: 0, cadence: 0 };
// VTT (circuit en forêt) : impulsions des sauts, chutes, indicateur « Saute ! » (mtb-mode.js).
const mtbMode = new MtbMode({ hud, audio, devices });
const mtbPose = { pitch: 0, roll: 0, dy: 0 };
let state = 'home'; // home | race | paused | end
let mode = 'bike'; // bike | row | kayak
let rowing = null; // { race, world, boats } en mode rameur
let kayak = null; // KayakMode (kayak-mode.js) en mode kayak
let race = null;
let models = new Map(); // racer -> RiderModel
let boxMeshes = [];
const bananaMeshes = new Map(); // id -> mesh
const raceObjects = new THREE.Group();
scene.add(raceObjects);
// Casques lancés : réserve d'objets cachés, créée une fois (avant warmShaders, pour compiler ses matériaux).
const helmetFx = new HelmetFx(scene, { detailed: DETAILED, shadows: SHADOWS });
let lastSentGrade = null;
let feltGrade = 0;
let windGradeNow = 0; // part du vent dans la pente ressentie (%)
let shake = 0;
let endTimer = null;

const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const tmpFrame = {};
const tmpFrame2 = {};

// Crée une course (et ses objets 3D). Utilisé aussi pour l'aperçu de l'écran d'accueil.
function setupRace() {
  if (mode === 'row') return setupRowing();
  weather.stop(); // temps neutre à l'accueil ; la météo est tirée au départ (startRace)
  disposeTree(raceObjects); // coureurs, étiquettes et objets de la course précédente
  raceObjects.clear();
  bananaMeshes.clear();
  helmetFx.reset();
  models = new Map();
  race = new Race(track, { laps: lapsFor(track.course) });
  const style = track.course.theme === 'forest' ? 'mtb' : 'road'; // VTT et tenue de VTT en forêt
  for (const r of race.racers) {
    const m = new Rider({ jersey: r.color, bike: r.bike, helmet: r.helmet, name: r.isPlayer ? '' : r.name, quality: QUALITY, style });
    if (m.blob) m.blob.visible = !SHADOWS; // la pastille d'ombre ne sert que sans ombres portées
    models.set(r, m);
    raceObjects.add(m.group);
  }
  boxMeshes = race.boxes.map((b) => {
    const mesh = createItemBox();
    const f = track.frame(b.s, b.lateral);
    mesh.position.set(f.x, f.y + 1.3, f.z);
    mesh.userData.baseY = f.y + 1.3;
    raceObjects.add(mesh);
    return mesh;
  });
  mtbMode.attach(race, track, models, scenery);

  race.addEventListener('go', () => hud.flash('Partez !', 1100, 'good'));
  race.addEventListener('pickup', ({ detail }) => {
    if (detail.racer.isPlayer) hud.flash(`${ITEMS[detail.item].icon} ${ITEMS[detail.item].label} !`, 1200);
  });
  race.addEventListener('use', ({ detail }) => {
    if (detail.racer.isPlayer && detail.item === 'turbo') hud.flash('🚀 Turbo ! Pente −5 %', 1400, 'good');
  });
  race.addEventListener('banana-dropped', ({ detail: b }) => {
    const mesh = createBanana();
    const f = track.frame(b.s, b.lateral);
    mesh.position.set(f.x, f.y + 0.12, f.z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    raceObjects.add(mesh);
    bananaMeshes.set(b.id, mesh);
  });
  race.addEventListener('banana-removed', ({ detail: b }) => {
    const mesh = bananaMeshes.get(b.id);
    if (mesh) raceObjects.remove(mesh);
    bananaMeshes.delete(b.id);
  });
  race.addEventListener('banana-hit', ({ detail }) => {
    if (detail.racer.isPlayer) {
      hud.flash('🍌 Peau de banane ! Pente +10 %', 1800, 'bad');
      shake = 1;
      devices.vibrate();
    } else if (detail.banana.owner === race.player) {
      hud.flash(`${detail.racer.name} a glissé sur ta banane !`, 1500, 'good');
    }
  });
  // Casques : lancer, coup reçu (tête-à-queue, pente +10 % au trainer pendant la glissade), coup donné, bouclier.
  race.addEventListener('helmet-thrown', ({ detail: h }) => helmetFx.take(h));
  race.addEventListener('helmet-hit', ({ detail }) => {
    const { racer: r, helmet: h } = detail;
    if (r.isPlayer) {
      hud.flash(h.owner === r ? 'Touché par ton propre casque ! Pente +10 %' : `Touché ! Casque de ${h.owner.name} · pente +10 %`, 1700, 'bad');
      shake = 1.2;
      devices.vibrate();
    } else if (h.owner === race.player) {
      hud.flash(`Dans le mille ! ${r.name} est touché`, 1500, 'good');
    }
  });
  race.addEventListener('helmet-blocked', ({ detail }) => {
    if (detail.racer.isPlayer) hud.flash('🛡️ Casque esquivé', 1300, 'good');
    else if (detail.helmet.owner === race.player) hud.flash(`${detail.racer.name} a paré ton casque`, 1300);
  });
  race.addEventListener('lap', ({ detail }) => {
    hud.flash(detail.lap === race.laps ? 'Dernier tour !' : `Tour ${detail.lap} / ${race.laps}`, 1500);
  });
  rideState.place = race.ride ? placeAt(track.course, 0) : null;
  race.addEventListener('finish', ({ detail: r }) => {
    models.get(r)?.celebrate?.(race.positionOf(r)); // bras levés pour le vainqueur, poing levé sur le podium
    if (!r.isPlayer) return;
    if (race.ride) {
      // Balade : fin de l'étape, arrivée au lieu de destination.
      hud.flash(`${placeAt(track.course, 1)} !`, 2500, 'place');
      endTimer = setTimeout(showEnd, 2200);
      return;
    }
    hud.flash(`Arrivée : ${ordinal(race.positionOf(r))} !`, 2500, 'good');
    endTimer = setTimeout(showEnd, 2200);
  });
  syncScene(0);
  snapCamera();
}

// ---------- Écrans ----------

function show(id) {
  for (const s of ['loading', 'home', 'pause', 'end']) $(s).hidden = s !== id;
  $('gamePause').hidden = state !== 'race' || id !== null;
  $('startGate').hidden = !(gate.active && state === 'race' && id === null);
  const racing = state === 'race' || state === 'paused' || state === 'end';
  hud.show(racing && mode === 'bike');
  $('rowHud').hidden = !(racing && mode === 'row');
  $('kayakHud').hidden = !(racing && mode === 'kayak');
  if (id === 'home') {
    menu.close(false);
    menu.focusDefault();
  }
}

async function goHome() {
  clearTimeout(endTimer);
  // Départ abandonné pendant l'attente : la machine qui dort encore n'est plus attendue.
  if (gate.active && devices.trainer.waiting) devices.releaseMachine?.();
  gate.active = false;
  if (mode === 'row') await leaveRowing();
  if (mode === 'kayak') await leaveKayak();
  state = 'home';
  setupRace();
  show('home');
  refreshDevices();
}

function startRace() {
  keepScreenOn();
  devices.prepareRace?.(); // appli iOS : prise de contrôle du trainer au départ
  clearTimeout(endTimer);
  document.activeElement?.blur?.();
  setupRace();
  // Météo du jour, tirée selon le climat du circuit (null en mode « Désactivée » : course d'origine).
  weather.start(track.course.theme, weatherPref, weatherSeed());
  race.weather = weather.active ? weather : null;
  state = 'race';
  lastSentGrade = null;
  show(null);
  hud.flash('', 1);
}

// Bannières de la météo (début et fin d'averse, vent fort au départ).
function weatherBanner(type, d) {
  if (state !== 'race') return;
  if (type === 'rain-start') hud.flash('🌧️ Il commence à pleuvoir : la route glisse', 2600, 'bad');
  else if (type === 'rain-stop') hud.flash('🌤️ La pluie s’arrête, la route va sécher', 2000, 'good');
  else if (type === 'windy') hud.flash(`💨 Vent fort, ${d.kmh} km/h : abrite-toi dans les roues !`, 2400);
}

// ---------- Départ en attente de la machine choisie sur la carte (appli iOS) ----------
// La course est prête mais figée (compte à rebours arrêté) jusqu'aux premières données d'effort de la
// machine : on lance le niveau, on installe son téléphone, on commence à pédaler ou à ramer, et c'est parti.
const gate = { active: false, machine: null, step: '', prepared: false };
const GATE_VERB = { rower: 'tire la poignée', cross: 'commence à pédaler', treadmill: 'commence à marcher', bike: 'commence à pédaler' };

function armGate(machine) {
  gate.machine = machine;
  gate.active = !!machine;
  gate.step = '';
  gate.prepared = false;
  updateGate(); // textes de l'écran d'attente (ou départ direct si la machine tourne déjà)
}

function updateGate() {
  if (!gate.active) return;
  const status = gateStatus(devices.trainer, gate.machine?.id);
  if (status !== 'connecting' && !gate.prepared) {
    gate.prepared = true;
    devices.prepareRace?.(); // machine enfin là : prise de contrôle (pente ou résistance)
  }
  if (status === 'go') return void openGate(true);
  if (status === gate.step) return;
  gate.step = status;
  const m = gate.machine;
  const name = escHtml(m?.title || 'ta machine');
  const verb = GATE_VERB[devices.machineKind || m?.kind] || 'commence l’effort';
  const box = $('startGate');
  box.dataset.step = status;
  $('gateIcon').innerHTML = `<use href="#${status === 'idle' ? 'i-bolt' : 'i-bt'}"/>`;
  $('gateStep1').className = status === 'connecting' || status === 'other' ? 'current' : 'done';
  $('gateStep2').className = status === 'idle' ? 'current' : '';
  if (status === 'connecting') {
    $('gateTitle').innerHTML = `Réveille ${name}`;
    $('gateStep1').textContent = 'Connexion en attente';
    $('gateText').textContent = `Le jeu se connecte dès que la machine se réveille : un coup de pédale ou de rame, ou Start sur la console. Installe ton téléphone, puis ${verb}.`;
  } else if (status === 'other') {
    $('gateTitle').textContent = 'Une autre machine est connectée';
    $('gateStep1').textContent = `Connexion à ${m?.title || 'ta machine'}…`;
    $('gateText').textContent = `${devices.trainer.name} est encore branchée. Change de machine ou pars avec celle-ci.`;
  } else {
    $('gateTitle').innerHTML = `${name} est connectée`;
    $('gateStep1').textContent = 'Machine connectée';
    $('gateText').textContent = `Installe ton téléphone, puis ${verb} : la course part dès les premières données.`;
  }
  $('gateStep2').textContent = 'Premières données : la course part';
}

// Fin de l'attente : la course démarre (compte à rebours), machine prête ou non.
function openGate(byMachine) {
  if (!gate.active) return;
  gate.active = false;
  $('startGate').hidden = true;
  if (state !== 'race') return; // machine déjà en route avant même le départ : la course part normalement
  if (!gate.prepared) devices.prepareRace?.();
  hud.flash(byMachine ? 'Données reçues : c’est parti !' : 'C’est parti !', 1200, 'good');
}

function pause() {
  if (state !== 'race') return;
  state = 'paused';
  lastSentGrade = null; // force l'envoi du plat, même si la dernière pente était presque nulle
  touch?.releaseAll();
  keys.clear();
  show('pause');
}

function resume() {
  if (state !== 'paused') return;
  document.activeElement?.blur?.();
  state = 'race';
  show(null);
}

function showEnd() {
  if (mode === 'row') return showRowEnd();
  if (mode === 'kayak') return showKayakEnd();
  if (state === 'paused') {
    endTimer = setTimeout(showEnd, 500);
    return;
  }
  if (state !== 'race') return;
  state = 'end';
  touch?.releaseAll();
  $('end').querySelector('.end-kicker').textContent = race.ride ? 'Étape terminée' : 'Course terminée';
  $('nextStage').hidden = true;
  if (race.ride) return showRideEnd();
  const rows = race.ranking().map((r) => ({ r, ...race.estimatedTime(r) }));
  rows.sort((a, b) => (a.estimated === b.estimated ? a.time - b.time : a.estimated ? 1 : -1));
  fillEnd(rows, { kind: 'bike', note: 'le coureur' });
}

// Écran d'arrivée commun : titre, podium des trois premiers, tableau complet.
function fillEnd(rows, { kind, distance = 0, note }) {
  const me = rows.findIndex((x) => x.r.isPlayer) + 1;
  $('endTitle').textContent = me === 1 ? 'Victoire !' : me <= 3 ? `Podium : ${ordinal(me)} sur ${rows.length}` : `Arrivée : ${ordinal(me)} sur ${rows.length}`;
  $('end').dataset.rank = me <= 3 ? String(me) : 'other';
  const { podium, table } = renderResults(rows, { kind, distance });
  $('podium').innerHTML = podium;
  $('results').innerHTML = table;
  $('endNote').textContent = rows.some((x) => x.estimated) ? `≈ : temps estimé, ${note} n’avait pas encore franchi la ligne.` : '';
  show('end');
}

// ---------- Circuits ----------

const THEMES = {
  meadow: ['#4fae47', '#1d5a2a', '#9be37a'],
  alpine: ['#6a8fa8', '#24384a', '#cfe6ff'],
  coast: ['#33b2d6', '#0f5f84', '#9ff0ff'],
  forest: ['#3f7a3a', '#14321c', '#b9e08a'],
};
const SURF_COLORS = { sand: '#f2cf7a', boardwalk: '#c08a55', roots: '#8a5a32', rock: '#b8b2a6', gravel: '#d8cdb4', mud: '#5a3a1e', creek: '#5cc3ff' };
const icon = (id) => `<svg class="ico" aria-hidden="true"><use href="#${id}"/></svg>`;
const stars = (n, max = 5) => `<span class="stars" role="img" aria-label="Difficulté ${n} sur ${max}">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(max - n)}</span>`;

// Mini-carte SVG d'un circuit (cartes et aperçu du menu) : fond du décor, revêtements en couleur, départ en damier.
function courseSvg(t, big = false) {
  const { pts } = minimapPath(t, big ? 4 : 8);
  const P = (x, z) => `${(8 + x * 84).toFixed(1)} ${(8 + z * 84).toFixed(1)}`;
  const d = pts.map(([x, z], i) => `${i ? 'L' : 'M'}${P(x, z)}`).join(' ');
  const theme = t.course.theme in THEMES ? t.course.theme : 'meadow';
  const [c1, c2] = THEMES[theme];
  const gid = `g-${t.course.id}-${big ? 'b' : 's'}`;
  const every = Math.max(1, Math.round(t.count / Math.max(1, pts.length - 1)));
  let surf = '';
  for (let i = 1; i < pts.length; i++) {
    const col = SURF_COLORS[t.surf[Math.min(t.count, i * every)]];
    if (col) surf += `<path d="M${P(...pts[i - 1])} L${P(...pts[i])}" stroke="${col}" stroke-width="${big ? 2.8 : 3.2}" stroke-linecap="round"/>`;
  }
  const deco = {
    meadow: '<ellipse cx="74" cy="22" rx="13" ry="8" fill="#5cc3ff" opacity=".55"/><circle cx="18" cy="80" r="5" fill="#2f7d33" opacity=".7"/><circle cx="26" cy="86" r="4" fill="#2f7d33" opacity=".7"/>',
    alpine: '<path d="M0 34 L16 14 L28 28 L42 8 L60 32 L74 16 L100 40 V0 H0z" fill="#e8f2ff" opacity=".22"/>',
    coast: '<path d="M0 86 Q25 80 50 86 T100 86 V100 H0z" fill="#0b4d73" opacity=".55"/><path d="M0 80 Q25 74 50 80 T100 80 V86 Q75 80 50 86 T0 86z" fill="#f2cf7a" opacity=".55"/>',
    forest: '<g fill="#0e2a16" opacity=".75"><path d="M8 30 l6 -14 l6 14z"/><path d="M78 92 l7 -16 l7 16z"/><path d="M86 30 l5 -12 l5 12z"/><path d="M4 90 l5 -12 l5 12z"/><path d="M44 54 l5 -12 l5 12z"/></g>',
  }[theme];
  const [sx, sz] = pts[0];
  const start = `<g transform="translate(${(8 + sx * 84 - 4).toFixed(1)} ${(8 + sz * 84 - 4).toFixed(1)})"><rect width="8" height="8" rx="1.5" fill="#fff" stroke="#11151f" stroke-width="1"/><rect width="4" height="4" fill="#11151f"/><rect x="4" y="4" width="4" height="4" fill="#11151f"/></g>`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="${gid}" cx="35%" cy="30%" r="85%"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient></defs><rect width="100" height="100" fill="url(#${gid})"/>${deco}<path d="${d}${t.open ? '' : 'Z'}" fill="none" stroke="#0b0e16" stroke-opacity=".6" stroke-width="${big ? 6 : 7.5}" stroke-linejoin="round"/><path d="${d}${t.open ? '' : 'Z'}" fill="none" stroke="#fff" stroke-width="${big ? 2.6 : 3.2}" stroke-linejoin="round"/>${t.open ? finishDot(pts[pts.length - 1], P) : ''}${surf}${start}</svg>`;
}

// Profil d'altitude (aire + ligne), revêtements particuliers en bandes sous la courbe.
function profileSvg(info, cls = 'spark') {
  const { prof, bands, theme } = info;
  const light = (THEMES[theme] || THEMES.meadow)[2];
  const gid = `pf-${info.id}-${cls}`;
  const line = prof.map(([u, y], i) => `${i ? 'L' : 'M'}${(u * 200).toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const band = bands.map(([a, b, col]) => `<rect x="${(a * 200).toFixed(1)}" y="56" width="${((b - a) * 200).toFixed(1)}" height="4" fill="${col}"/>`).join('');
  return `<svg class="${cls}" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}" stop-opacity=".55"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></linearGradient></defs><path d="${line} L200 60 L0 60Z" fill="url(#${gid})"/><path d="${line}" fill="none" stroke="${light}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>${band}</svg>`;
}

// Arrivée d'un parcours ouvert sur la mini-carte : rond doré.
const finishDot = ([x, z], P) => `<circle cx="${P(x, z).split(' ')[0]}" cy="${P(x, z).split(' ')[1]}" r="4" fill="#f2c14e" stroke="#11151f" stroke-width="1.2"/>`;

// Carte de la Terre du Milieu sur parchemin : tout l'itinéraire, l'étape en doré, les villes étapes.
const J_BOUNDS = (() => {
  const xs = JOURNEY.map((p) => p[0]);
  const ys = JOURNEY.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
})();
function journeyPoint([x, y]) {
  const b = J_BOUNDS;
  const k = 84 / Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const ox = (100 - (b.x1 - b.x0) * k) / 2;
  const oy = (100 - (b.y1 - b.y0) * k) / 2;
  return [ox + (x - b.x0) * k, oy + (b.y1 - y) * k];
}
let journeyCount = 0;
const nearestJourney = (km) => JOURNEY.reduce((best, p, i) => (Math.hypot(p[0] - km[0], p[1] - km[1]) < Math.hypot(JOURNEY[best][0] - km[0], JOURNEY[best][1] - km[1]) ? i : best), 0);
function journeySvg(stage, big = false) {
  const pts = JOURNEY.map(journeyPoint);
  const d = (list) => list.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const i0 = nearestJourney(PLACES[stage.from].km);
  const i1 = nearestJourney(PLACES[stage.to].km);
  const part = pts.slice(Math.min(i0, i1), Math.max(i0, i1) + 1);
  const gid = `pj-${stage.id}-${++journeyCount}`; // unique : la même carte peut être affichée deux fois (menu, fin)
  // Reliefs dessinés à la plume : Monts Brumeux, Montagnes Blanches, Ephel Dúath ; Montagne du Destin.
  const hills = [[860, 1040], [866, 1000], [872, 960], [860, 925], [880, 900], [820, 730], [860, 712], [900, 705], [1185, 690], [1200, 660], [1190, 625], [1230, 700]]
    .map((km) => journeyPoint(km)).map(([x, y]) => `<path d="M${(x - 3).toFixed(1)} ${(y + 2).toFixed(1)} l3 -4.5 l3 4.5" fill="none" stroke="#7a5a36" stroke-width=".8" opacity=".75"/>`).join('');
  const [dx, dy] = journeyPoint(PLACES['mount-doom'].km);
  const doom = `<path d="M${(dx - 4).toFixed(1)} ${(dy + 2.5).toFixed(1)} l4 -6 l4 6z" fill="#b8452a" opacity=".85"/>`;
  const towns = STAGES.map((s) => journeyPoint(PLACES[s.from].km)).concat([journeyPoint(PLACES[STAGES[STAGES.length - 1].to].km)]);
  const dots = towns.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${big ? 1.6 : 2.2}" fill="#5a4026"/>`).join('');
  const [sx, sy] = journeyPoint(PLACES[stage.from].km);
  const [ex, ey] = journeyPoint(PLACES[stage.to].km);
  const labels = big
    ? STAGES.map((s) => [s.from, journeyPoint(PLACES[s.from].km)]).concat([[STAGES[STAGES.length - 1].to, journeyPoint(PLACES[STAGES[STAGES.length - 1].to].km)]])
      .map(([id, [x, y]], k) => `<text x="${x.toFixed(1)}" y="${(y + (k % 2 ? 5.2 : -3)).toFixed(1)}" font-size="3.1" text-anchor="middle" fill="#4a3018" font-family="Georgia, serif" font-style="italic">${PLACES[id].name}</text>`).join('')
    : '';
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="${gid}" cx="45%" cy="40%" r="80%"><stop offset="0" stop-color="#f4e7c5"/><stop offset="1" stop-color="#cdb27a"/></radialGradient></defs><rect width="100" height="100" fill="url(#${gid})"/>${hills}${doom}<path d="${d(pts)}" fill="none" stroke="#7a5a36" stroke-width="${big ? 0.9 : 1.4}" stroke-dasharray="${big ? '1.6 1.4' : '2.4 2'}" stroke-linejoin="round"/><path d="${d(part)}" fill="none" stroke="#3a2412" stroke-width="${big ? 3.2 : 5}" stroke-linejoin="round" stroke-linecap="round" opacity=".55"/><path d="${d(part)}" fill="none" stroke="#f2b93b" stroke-width="${big ? 1.8 : 3}" stroke-linejoin="round" stroke-linecap="round"/>${dots}<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${big ? 2.2 : 3.4}" fill="#fff" stroke="#3a2412" stroke-width="1"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="${big ? 2.2 : 3.4}" fill="#f2b93b" stroke="#3a2412" stroke-width="1"/>${labels}</svg>`;
}

// Aperçu d'une étape de la balade : carte du voyage, tracé de l'étape, lieux traversés.
function stagePreview(id, x) {
  const c = courseById(id);
  const best = readProgress(safeStorage)[id];
  const machine = playMachine === 'cross' ? 'Elliptique' : 'Vélo';
  return `<div class="pv stage-pv" data-theme="${x.theme}">
    <div class="pv-map">${journeySvg(c, true)}<span class="pv-inset">${x.big}</span></div>
    <div class="pv-info">
      <span class="pv-kicker">${machine} · balade en Terre du Milieu · étape ${c.index + 1} / ${STAGES.length}</span>
      <h3>${x.name}</h3>
      <p>${x.tagline}. Sans adversaires ni objets : la route, le paysage et ton rythme.</p>
      <div class="pv-diff"><span>Difficulté</span>${stars(x.difficulty)}</div>
      <div class="pv-profile">${profileSvg(x, 'profile')}<span class="pv-alt">${x.alt} m</span></div>
      <dl class="pv-stats"><div><dt>${icon('i-route')}Longueur</dt><dd>${x.km} km</dd></div><div><dt>${icon('i-mountain')}Dénivelé</dt><dd>${x.gain} m</dd></div><div><dt>${icon('i-flag')}Étape</dt><dd>${c.index + 1} / ${STAGES.length}</dd></div><div><dt>${icon('i-clock')}Meilleur temps</dt><dd>${best ? formatTime(best) : '—'}</dd></div></dl>
      <div class="pv-surf">${c.places.map(([, n]) => `<span>${n}</span>`).join('')}</div>
      <div class="pv-weather" data-mode="${weatherPref}"><b>Météo ${WEATHER_LABELS[weatherPref].toLowerCase()}</b><span>${forecast(x.theme, weatherPref)}</span></div>
      <div class="pv-go"><span class="glyph"><span class="k-kbd">Entrée</span><span class="k-pad pad-a">A</span></span>Partir en balade</div>
    </div>
  </div>`;
}

// Balade : lieu traversé (bannière à l'entrée de chaque lieu) et écran de fin d'étape.
const rideState = { place: null };
function ridePlaces() {
  const p = race.player;
  const name = placeAt(track.course, Math.max(0, Math.min(1, p.s / track.length)));
  if (name === rideState.place) return;
  rideState.place = name;
  if (name && p.finishTime === null) hud.flash(name, 2600, 'place');
}

function showRideEnd() {
  const c = track.course;
  const p = race.player;
  const time = p.finishTime ?? race.time;
  const { progress, best } = recordStage(safeStorage, c.id, time);
  const gain = elevationGain(track.grade, track.step) * (track.length / track.total);
  const next = nextStage(c.id);
  $('endTitle').textContent = `${placeAt(c, 1)} !`;
  $('end').dataset.rank = 'ride';
  const stat = (label, value) => `<div class="ride-stat"><span>${label}</span><b>${value}</b></div>`;
  $('podium').innerHTML = `<div class="ride-end">${journeySvg(c, true)}<div class="ride-stats">${stat('Temps', formatTime(time))}${stat('Vitesse moyenne', `${((track.length / Math.max(1, time)) * 3.6).toFixed(1).replace('.', ',')} km/h`)}${stat('Distance', `${(track.length / 1000).toFixed(1).replace('.', ',')} km`)}${stat('Dénivelé', `${Math.round(gain)} m`)}</div></div>`;
  $('results').innerHTML = '';
  const count = Object.keys(progress).length;
  $('endNote').textContent = `${best ? 'Meilleur temps sur cette étape ! ' : `Meilleur temps : ${formatTime(progress[c.id])}. `}${count === STAGES.length ? 'Les huit étapes sont faites : de la Comté à la Montagne du Destin !' : `${count} étape${count > 1 ? 's' : ''} sur ${STAGES.length}.`}${next ? ` Prochaine étape : ${next.name}.` : ''}`;
  $('nextStage').hidden = !next;
  if (next) $('nextStage').querySelector('span').textContent = `Étape suivante : ${next.name}`;
  renderCourses();
  show('end');
}

$('nextStage').addEventListener('click', async () => {
  const next = nextStage(track.course.id);
  if (!next) return;
  await loadCourse(next.id);
  startRace();
});

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const courseInfo = new Map();
function describeCourse(id) {
  if (!courseInfo.has(id)) {
    const t = id === track.course.id ? track : new Track(courseById(id));
    const c = t.course;
    const gain = elevationGain(t.grade, t.step);
    const maxGrade = Math.max(...t.grade);
    const hasSand = t.surf.includes('sand');
    const stats = [`${(t.length / 1000).toFixed(1)} km`, `D+ ${Math.round(gain)} m`, c.ride ? `Étape ${c.index + 1} / ${STAGES.length}` : plural(lapsFor(c), 'tour')];
    const hot = [];
    if (maxGrade >= 8) hot.push(`pente max ${Math.round(maxGrade)} %`);
    if (hasSand) hot.push('sable');
    if (c.mtb) hot.push(plural(c.mtb.jumps.length, 'saut'));
    if (t.surf.includes('creek')) hot.push('gué');
    // Profil échantillonné (120 points) et bandes de revêtement.
    const range = Math.max(8, t.maxY - t.minY);
    const prof = [];
    for (let k = 0; k <= 120; k++) {
      const i = Math.round((k / 120) * t.count);
      prof.push([k / 120, 52 - ((t.y[i] - t.minY) / range) * 44]);
    }
    const bands = [];
    for (const [a, b, type] of c.surfaces || []) if (SURF_COLORS[type]) bands.push([a, b, SURF_COLORS[type]]);
    const surfaces = [...new Set([c.baseSurface || 'asphalt', ...t.surf])].map((x) => SURFACES[x]?.label || x);
    const difficulty = Math.max(1, Math.min(5, Math.round(maxGrade / 3) + (hasSand || c.mtb ? 1 : 0) + (gain / t.length > 0.025 ? 1 : 0)));
    courseInfo.set(id, {
      id, svg: courseSvg(t), big: courseSvg(t, true), name: c.name, tagline: c.tagline, stats, hot, theme: c.theme,
      prof, bands, surfaces, difficulty, km: (t.length / 1000).toFixed(1), gain: Math.round(gain), laps: lapsFor(c),
      maxGrade: Math.round(maxGrade), alt: Math.round(t.maxY - t.minY),
    });
  }
  return courseInfo.get(id);
}

// Aperçu du niveau sélectionné (grande carte, profil, chiffres clés).
function coursePreview(id) {
  const x = describeCourse(id);
  if (courseById(id).ride) return stagePreview(id, x);
  const machine = playMachine === 'cross' ? 'Elliptique' : 'Vélo';
  return `<div class="pv" data-theme="${x.theme}">
    <div class="pv-map">${x.big}</div>
    <div class="pv-info">
      <span class="pv-kicker">${machine} · ${x.theme === 'forest' ? 'VTT' : 'circuit'}</span>
      <h3>${x.name}</h3>
      <p>${x.tagline}</p>
      <div class="pv-diff"><span>Difficulté</span>${stars(x.difficulty)}</div>
      <div class="pv-profile">${profileSvg(x, 'profile')}<span class="pv-alt">${x.alt} m</span></div>
      <dl class="pv-stats"><div><dt>${icon('i-route')}Longueur</dt><dd>${x.km} km</dd></div><div><dt>${icon('i-mountain')}Dénivelé</dt><dd>${x.gain} m</dd></div><div><dt>${icon('i-lap')}Tours</dt><dd>${x.laps}</dd></div><div><dt>${icon('i-slope')}Pente max</dt><dd>${x.maxGrade} %</dd></div></dl>
      <div class="pv-surf">${x.surfaces.map((s) => `<span>${s}</span>`).join('')}</div>
      <div class="pv-weather" data-mode="${weatherPref}"><b>Météo ${WEATHER_LABELS[weatherPref].toLowerCase()}</b><span>${forecast(x.theme, weatherPref)}</span></div>
      <div class="pv-go"><span class="glyph"><span class="k-kbd">Entrée</span><span class="k-pad pad-a">A</span></span>Lancer la course</div>
    </div>
  </div>`;
}

function renderCourses() {
  const progress = readProgress(safeStorage);
  $('courseList').innerHTML = COURSE_ORDER.map((id) => {
    const info = describeCourse(id);
    return `<button type="button" class="course-card" data-course="${id}" data-theme="${info.theme}" aria-current="${id === courseId}"><span class="cc-map">${info.svg}</span><span class="cc-body"><span class="c-name">${info.name}</span><span class="c-tag">${info.tagline}</span>${profileSvg(info)}<span class="c-stats">${info.stats.map((x) => `<span>${x}</span>`).join('')}${info.hot.map((x) => `<span class="hot">${x}</span>`).join('')}</span></span>${stars(info.difficulty)}</button>`;
  }).join('')
    // Balade en Terre du Milieu : huit étapes sans adversaires (middle-earth.js).
    + `<h3 class="course-section"><span>Balade en Terre du Milieu</span><small>${Object.keys(progress).length} / ${STAGES.length} étapes</small></h3>`
    + STAGE_ORDER.map((id) => {
      const info = describeCourse(id);
      const done = progress[id];
      return `<button type="button" class="course-card stage-card" data-course="${id}" data-theme="${info.theme}" data-done="${done ? 'true' : 'false'}" aria-current="${id === courseId}"><span class="cc-map">${journeySvg(courseById(id))}</span><span class="cc-body"><span class="c-name">${info.name}</span><span class="c-tag">${info.tagline}</span>${profileSvg(info)}<span class="c-stats">${info.stats.map((x) => `<span>${x}</span>`).join('')}${done ? `<span class="hot">✓ ${formatTime(done)}</span>` : ''}</span></span>${stars(info.difficulty)}</button>`;
    }).join('');
  previewOf.coursePreview = null;
  showPreview('coursePreview', courseId, coursePreview);
}

// L'aperçu suit le niveau qui a le focus (flèches, manette) ou sous la souris.
const previewOf = {};
function showPreview(box, key, render) {
  const k = `${key}|${playMachine}|${weatherPref}`;
  if (previewOf[box] === k) return;
  previewOf[box] = k;
  $(box).innerHTML = render(key);
}
function bindPreview(list, box, attr, render) {
  const pick = (e) => {
    const card = e.target.closest(`[${attr}]`);
    if (card) showPreview(box, card.getAttribute(attr), render);
  };
  $(list).addEventListener('focusin', pick);
  $(list).addEventListener('pointerover', pick);
}
bindPreview('courseList', 'coursePreview', 'data-course', coursePreview);

// Change de circuit sur place : écran de chargement, décor reconstruit, nouvelle course.
async function loadCourse(id) {
  id = courseById(id).id;
  if (id === courseId && track.course.id === id) return;
  courseId = id;
  try {
    localStorage.setItem(COURSE_KEY, id);
  } catch {
    /* stockage indisponible */
  }
  $('loadingText').textContent = `Chargement : ${courseById(id).name}…`;
  show('loading');
  // Deux images pour que l'écran de chargement s'affiche avant le calcul du décor.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  scenery.dispose();
  track = new Track(courseById(id));
  buildWorld();
  hud.setTrack(track);
  renderCourses();
  setupRace();
  await warmShaders();
}

// Bassins d'aviron (miniature : couloirs, ligne d'arrivée et bateaux).
const ROW_LEVELS = [
  { distance: 500, name: 'Lac Bleu · Sprint', tagline: '500 m en ligne droite, 5 adversaires', difficulty: 2, ref: '1:55' },
  { distance: 1000, name: 'Lac Bleu · Classique', tagline: '1 000 m, garde ton allure jusqu’au bout', difficulty: 3, ref: '3:55' },
];
const BOAT_COLORS = ['#e0384b', '#2b6cff', '#ff5a1f', '#ffd23f', '#3ccf7a', '#9b5de5'];
function rowSvg(distance, big = false) {
  const gid = `rw-${distance}-${big ? 'b' : 's'}`;
  const lanes = [0, 1, 2, 3, 4, 5, 6].map((i) => `<line x1="${8 + i * 14}" y1="12" x2="${8 + i * 14}" y2="96" stroke="#fff" stroke-width="1.6" stroke-dasharray="0.1 4" stroke-linecap="round" opacity=".85"/>`).join('');
  const boats = BOAT_COLORS.map((c, i) => {
    const y = 74 - ((i * 37) % 30) - (distance > 500 ? 0 : 10);
    return `<path d="M${15 + i * 14} ${y + 16} l-3.5 7 h7z" fill="#fff" opacity=".3"/><rect x="${13 + i * 14}" y="${y}" width="4" height="16" rx="2" fill="${c}" stroke="#fff" stroke-width=".8"/>`;
  }).join('');
  const finish = Array.from({ length: 21 }, (_, k) => `<rect x="${8 + k * 4}" y="${8 + (k % 2) * 2}" width="4" height="2" fill="#fff"/><rect x="${8 + k * 4}" y="${10 - (k % 2) * 2}" width="4" height="2" fill="#11151f"/>`).join('');
  const label = big ? '' : `<text x="50" y="58" font-size="15" font-weight="900" text-anchor="middle" fill="#fff" style="paint-order:stroke" stroke="#0d4f86" stroke-width="3">${distance} m</text>`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f9be0"/><stop offset="1" stop-color="#0d4f86"/></linearGradient></defs><rect width="100" height="100" fill="url(#${gid})"/><rect width="8" height="100" fill="#4f9e3e"/><rect x="92" width="8" height="100" fill="#4f9e3e"/>${lanes}${finish}${boats}${label}</svg>`;
}
const rowLevel = (d) => ROW_LEVELS.find((l) => l.distance === +d) || ROW_LEVELS[0];
function rowPreview(d) {
  const l = rowLevel(d);
  return `<div class="pv" data-theme="lake">
    <div class="pv-map">${rowSvg(l.distance, true)}</div>
    <div class="pv-info">
      <span class="pv-kicker">Rameur · bassin</span>
      <h3>${l.name}</h3>
      <p>${l.tagline}</p>
      <div class="pv-diff"><span>Difficulté</span>${stars(l.difficulty)}</div>
      <dl class="pv-stats"><div><dt>${icon('i-flag')}Distance</dt><dd>${l.distance} m</dd></div><div><dt>${icon('i-row')}Bateaux</dt><dd>6</dd></div><div><dt>${icon('i-clock')}Temps visé</dt><dd>${l.ref}</dd></div><div><dt>${icon('i-wave')}Couloirs</dt><dd>bouées</dd></div></dl>
      <div class="pv-surf"><span>Eau calme</span><span>Ligne droite</span><span>Pilote auto du couloir</span></div>
      <div class="pv-go"><span class="glyph"><span class="k-kbd">Entrée</span><span class="k-pad pad-a">A</span></span>Lancer la course</div>
    </div>
  </div>`;
}
$('rowList').innerHTML = ROW_LEVELS.map((l) => `<button type="button" class="course-card" data-row="${l.distance}" data-theme="lake"><span class="cc-map">${rowSvg(l.distance)}</span><span class="cc-body"><span class="c-name">${l.name}</span><span class="c-tag">${l.tagline}</span><span class="c-stats"><span>${l.distance} m</span><span>6 bateaux</span><span>temps visé ${l.ref}</span></span></span>${stars(l.difficulty)}</button>`).join('')
  + KAYAK_LEVELS.map((id) => kayakCard(id, stars)).join(''); // kayak cross : rivières (kayak-menu.js)
showPreview('rowPreview', 500, rowPreview);
bindPreview('rowList', 'rowPreview', 'data-row', rowPreview);
bindPreview('rowList', 'rowPreview', 'data-kayak', (id) => kayakPreview(id, { stars, icon }));
$('rowList').addEventListener('click', (e) => {
  const card = e.target.closest('[data-row]');
  if (card) {
    const d = +card.dataset.row;
    chooseMachineThen(() => startRowing(d), { play: 'row', title: rowLevel(d).name, parent: 'rowPanel', opener: card });
  }
  const k = e.target.closest('[data-kayak]');
  if (k) chooseMachineThen(() => startKayak(k.dataset.kayak), { play: 'row', title: riverById(k.dataset.kayak).name, parent: 'rowPanel', opener: k });
});

// Jouer : choix de la machine, puis du niveau.
for (const card of document.querySelectorAll('[data-machine]')) {
  card.addEventListener('click', () => {
    playMachine = card.dataset.machine;
    if (playMachine === 'row') return menu.open('rowPanel', card);
    $('courseTitle').textContent = playMachine === 'cross' ? 'Elliptique : choisis ton circuit' : 'Vélo : choisis ton circuit';
    $('courseNote').hidden = playMachine !== 'cross';
    $('courseNote').textContent = 'Pas de boutons sur l’elliptique : le pilote automatique tourne pour toi, attrape les boîtes et utilise les objets.';
    menu.open('coursePanel', card);
  });
}

$('courseList').addEventListener('click', (e) => {
  const card = e.target.closest('[data-course]');
  if (!card) return;
  const id = card.dataset.course;
  chooseMachineThen(
    async () => {
      await loadCourse(id);
      startRace();
    },
    { play: playMachine === 'cross' ? 'cross' : 'bike', title: courseById(id).name, parent: 'coursePanel', opener: card },
  );
});

// ---------- Carte de la salle (appli iOS) : choix de la machine au lancement d'un niveau ----------
// Niveau choisi -> « Sur quelle machine ? » (s'il y a une carte) -> départ en attente de la machine.
const safeStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
let pendingLaunch = null; // { start, opts } : niveau à lancer une fois la machine choisie
const gymPicker = new GymPicker({
  devices,
  storage: safeStorage,
  onLaunch: (machine) => launchPending(machine),
  onSkip: () => launchPending(null),
  onEdit: () => devices.openNative?.('gym'),
});
function chooseMachineThen(start, opts) {
  if (!gymPicker.available) {
    armGate(null);
    return start();
  }
  pendingLaunch = { start, opts };
  $('machinePanel').dataset.parent = opts.parent;
  gymPicker.open(opts);
  menu.open('machinePanel', opts.opener);
}
function launchPending(machine) {
  const launch = pendingLaunch;
  if (!launch) return;
  if (machine) devices.useMachine(machine.id, machine.kind);
  armGate(machine);
  launch.start();
}
// Attente du départ : « Partir sans attendre », ou « Changer de machine » (retour au plan, même niveau).
$('gateGo').addEventListener('click', () => openGate(false));
$('gateCancel').addEventListener('click', async () => {
  const launch = pendingLaunch;
  await goHome();
  if (launch) chooseMachineThen(launch.start, launch.opts);
});

// ---------- Mode rameur ----------

// Entre dans le bassin d'aviron : le décor du circuit est libéré, celui du lac construit à la place.
async function startRowing(distance = 500) {
  keepScreenOn();
  devices.prepareRace?.();
  clearTimeout(endTimer);
  document.activeElement?.blur?.();
  if (mode === 'row' && rowing.distance !== distance) {
    // Autre longueur de bassin : on reconstruit le lac.
    for (const b of rowing.boats.values()) disposeTree(b.group);
    raceObjects.clear();
    rowing.boats = new Map();
    rowing.world.dispose();
    rowing.world = buildRowingWorld(scene, { quality: QUALITY, renderer, detailed: DETAILED, distance });
    rowing.distance = distance;
  }
  if (mode !== 'row') {
    $('loadingText').textContent = 'Chargement : bassin d’aviron…';
    show('loading');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    scenery.dispose();
    disposeTree(raceObjects);
    raceObjects.clear();
    models = new Map();
    boxMeshes = [];
    mode = 'row';
    rowing = { world: buildRowingWorld(scene, { quality: QUALITY, renderer, detailed: DETAILED, distance }), race: null, boats: new Map(), distance };
  }
  setupRowing();
  if (!$('loading').hidden) await warmShaders();
  // Météo du bassin : du vent seulement (lac abrité, pas de pluie), effet doux sur les bateaux.
  weather.start('lake', weatherPref, weatherSeed());
  state = 'race';
  lastSentGrade = null;
  show(null);
  hud.flash('', 1);
}

// Revient au vélo : décor du circuit reconstruit.
async function leaveRowing() {
  $('loadingText').textContent = `Chargement : ${track.course.name}…`;
  show('loading');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  for (const b of rowing.boats.values()) disposeTree(b.group);
  raceObjects.clear();
  rowing.world.dispose();
  rowing = null;
  mode = 'bike';
  buildWorld();
  setupRace();
  await warmShaders();
}

function setupRowing() {
  for (const b of rowing.boats.values()) {
    raceObjects.remove(b.group);
    disposeTree(b.group);
  }
  rowing.boats = new Map();
  const r = new RowingRace({ distance: rowing.distance });
  rowing.race = r;
  for (const racer of r.racers) {
    const boat = new Boat({ color: racer.color, name: racer.isPlayer ? '' : racer.name });
    rowing.boats.set(racer, boat);
    raceObjects.add(boat.group);
  }
  // Pastilles de la barre de progression
  $('rProgress').innerHTML = '<div class="row-finish"></div><span class="rp-mark"></span>' + r.racers.map((x, i) => `<span class="dot${x.isPlayer ? ' me' : ''}" data-i="${i}" style="color:${x.color}"><svg aria-hidden="true"><use href="#i-boat"/></svg></span>`).join('');
  r.addEventListener('go', () => hud.flash('Partez !', 1100, 'good'));
  r.addEventListener('finish', ({ detail }) => {
    rowing.boats.get(detail)?.celebrate?.(r.positionOf(detail));
    if (!detail.isPlayer) return;
    hud.flash(`Arrivée : ${ordinal(r.positionOf(detail))} !`, 2500, 'good');
    endTimer = setTimeout(showEnd, 2200);
  });
  syncRowing(0);
  snapRowCamera();
}

function rowingInput() {
  const trainer = devices.trainerActive;
  const rate = devices.trainer?.data?.strokeRate;
  return {
    power: trainer ? devices.power : sim.power,
    strokeRate: trainer ? rate ?? (devices.machineKind === 'rower' ? devices.cadence : 0) : sim.tapRate ? sim.tapRate : sim.power > 20 ? SIM_ROW.rate * Math.min(1, sim.power / SIM_ROW.power) : 0,
    steer: rowSteer(),
  };
}

// Au rameur, le pilote automatique garde le bateau au milieu de son couloir.
function rowSteer() {
  const manual = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
  if (manual || !autoSteer()) return manual;
  const p = rowing.race.player;
  return Math.max(-1, Math.min(1, -p.lateral * 0.8));
}

function syncRowing(dt) {
  const r = rowing.race;
  for (const [racer, boat] of rowing.boats) {
    // Le bateau avance par à-coups : petite poussée à chaque coup d'aviron.
    const surge = racer.v > 0.3 ? Math.sin(racer.phase) * 0.06 : 0;
    boat.group.position.set(racer.laneX + racer.lateral, 0, racer.s + surge);
    boat.group.rotation.set(0, Math.max(-0.12, Math.min(0.12, (racer.isPlayer ? rowSteer() : 0) * -0.08)), Math.sin(racer.phase * 0.5) * 0.015);
    const rowingAmount = racer.strokeRate > 1 ? 1 : Math.max(0, (boat.amount ?? 0) - dt);
    boat.amount = rowingAmount;
    boat.pose(racer.strokeRate > 1 ? racer.phase : Math.PI * 1.5, rowingAmount);
    if (boat.label) boat.label.visible = camera.position.distanceTo(boat.group.position) > 6;
  }
  void r;
}

function snapRowCamera() {
  rowCameraTarget(camPos, camLook);
}

function rowCameraTarget(outPos, outLook) {
  const p = rowing.race.player;
  const x = p.laneX + p.lateral;
  outPos.set(x + 3.2, 3.4, p.s - 10);
  outLook.set(x - 1.5, 0.6, p.s + 12);
}

function frameRowing(dt, nowMs) {
  const r = rowing.race;
  if ((state === 'race' && !gate.active) || state === 'end') {
    // Bassin en ligne droite vers +z : le vent de dos est la composante z du vent (0 sans météo).
    weather.step(dt, r.time, true);
    r.tailwind = weather.active ? weather.now.speed * weather.now.dirZ : 0;
    r.update(dt, rowingInput());
    if (r.time < 0) hud.countdown(String(Math.ceil(-r.time)));
  }
  syncRowing(state === 'paused' ? 0 : dt);
  updateGrade();
  rowCameraTarget(desiredPos, desiredLook);
  camPos.lerp(desiredPos, 1 - Math.exp(-dt * 4));
  camLook.lerp(desiredLook, 1 - Math.exp(-dt * 6));
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  if (Math.abs(camera.fov - 62) > 0.05) {
    camera.fov = 62;
    camera.updateProjectionMatrix();
  }
  if (sun) followSun(sun, tmpVec.set(r.player.laneX, 0, r.player.s), camera);
  rowing.world.update(dt, camera);
  if (nowMs - (frameRowing.last || 0) > 100) {
    frameRowing.last = nowMs;
    updateRowHud();
  }
}

function updateRowHud() {
  const r = rowing.race;
  const p = r.player;
  const set = (id, v) => {
    const el = $(id);
    if (el.textContent !== v) el.textContent = v;
  };
  const pos = r.positionOf(p);
  if (updateRowHud.pos !== pos) {
    // Position : grand chiffre, et un éclair vert ou rouge quand elle change.
    const box = $('rPos').closest('.hud-card');
    if (updateRowHud.pos !== undefined) {
      const flip = box.classList.contains('chg-a');
      box.classList.remove('chg-a', 'chg-b', 'up', 'down');
      box.classList.add(flip ? 'chg-b' : 'chg-a', pos < updateRowHud.pos ? 'up' : 'down');
    }
    updateRowHud.pos = pos;
    $('rPos').innerHTML = ordinalHtml(pos);
  }
  set('rPosTotal', `/ ${r.racers.length}`);
  set('rLeft', p.finishTime !== null ? 'Arrivé !' : `${Math.max(0, Math.ceil(r.distance - p.s))} m`);
  set('rTime', formatTime(Math.max(0, p.finishTime ?? r.time)));
  set('rPower', p.power > 0 || devices.trainerActive ? String(Math.round(p.power)) : '--');
  set('rRate', p.strokeRate > 0 ? String(Math.round(p.strokeRate)) : '--');
  set('rHr', devices.heartRate ? String(devices.heartRate) : '--');
  set('rSplit', formatSplit(splitFromSpeed(p.v)));
  set('rSpeed', (p.v * 3.6).toFixed(1));
  set('rDist', String(Math.floor(Math.min(p.s, r.distance))));
  for (const dot of $('rProgress').querySelectorAll('.dot')) {
    const x = r.racers[+dot.dataset.i];
    dot.style.left = `${Math.min(100, (x.s / r.distance) * 100)}%`;
  }
  const kind = devices.machineKind;
  let hint = '';
  if (!devices.trainerActive) {
    if (tapEnabled) hint = sim.tapRate ? '' : TOUCH ? 'Tape l’écran à chaque coup d’aviron (ou maintiens « Pédaler »)' : 'Clique ou tape l’écran à chaque coup d’aviron, ou maintiens ↑';
    else hint = TOUCH ? 'Maintiens « Pédaler » pour ramer (180 W simulés)' : 'Maintiens ↑ pour ramer (180 W simulés) · ← → pour rester dans ton couloir';
  }
  else if (kind && kind !== 'rower') hint = `Machine connectée : ${MACHINE_LABELS[kind] || kind} (sa puissance fait avancer le bateau)`;
  set('rHint', hint);
  let fx = p.offLane ? '<span class="badge grass">Hors couloir : les bouées freinent !</span>' : autoSteer() ? '<span class="badge auto">🧭 Pilote auto</span>' : '';
  if (weather.active) {
    weather.observe(p, 0, 1); // bassin orienté vers +z
    if (weather.hud.kind !== 'calm') fx += `<span class="badge wind ${weather.hud.kind}">💨 ${weather.hud.text}</span>`;
  }
  if (updateRowHud.fx !== fx) $('rEffects').innerHTML = updateRowHud.fx = fx;
  touch?.setPedalVisible(!devices.trainerActive);
  touch?.setItemReady(false);
}

function showRowEnd() {
  if (state === 'paused') {
    endTimer = setTimeout(showEnd, 500);
    return;
  }
  if (state !== 'race') return;
  state = 'end';
  touch?.releaseAll();
  const r = rowing.race;
  const rows = r.ranking().map((x) => ({ r: x, ...r.estimatedTime(x) }));
  rows.sort((a, b) => (a.estimated === b.estimated ? a.time - b.time : a.estimated ? 1 : -1));
  fillEnd(rows, { kind: 'row', distance: r.distance, note: 'le rameur' });
}

// ---------- Mode kayak cross ----------

// Descente de rivière (kayak-mode.js) : le décor du circuit est libéré, celui de la rivière construit à la place.
async function startKayak(id = 'gorges') {
  keepScreenOn();
  devices.prepareRace?.();
  clearTimeout(endTimer);
  document.activeElement?.blur?.();
  const def = riverById(id);
  weather.stop(); // pas de météo en kayak (la rivière a déjà son courant et ses rapides)
  if (mode !== 'kayak' || kayak.riverId !== def.id) {
    $('loadingText').textContent = `Chargement : ${def.name}…`;
    show('loading');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (mode === 'bike') {
      scenery.dispose();
      disposeTree(raceObjects);
      raceObjects.clear();
      models = new Map();
      boxMeshes = [];
    }
    if (!kayak) {
      kayak = new KayakMode({ scene, raceObjects, camera, sun, renderer, quality: QUALITY, detailed: DETAILED, hud, devices });
      kayak.onFinish = () => (endTimer = setTimeout(showEnd, 2200));
    }
    mode = 'kayak';
    kayak.load(def.id);
  }
  kayak.setup();
  if (!$('loading').hidden) await warmShaders();
  state = 'race';
  lastSentGrade = null;
  show(null);
  hud.flash('', 1);
}

// Revient au vélo : décor du circuit reconstruit.
async function leaveKayak() {
  $('loadingText').textContent = `Chargement : ${track.course.name}…`;
  show('loading');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  kayak.dispose();
  raceObjects.clear();
  mode = 'bike';
  buildWorld();
  setupRace();
  await warmShaders();
}

// Entrées du kayak (objet réutilisé à chaque image) : puissance et cadence de la machine, des tapotements ou du clavier.
const kIn = { power: 0, strokeRate: 0, steer: 0, auto: false, machine: 'other' };
function kayakInput() {
  const trainer = devices.trainerActive;
  const rate = devices.trainer?.data?.strokeRate;
  const sprinting = !trainer && !sim.tapRate && (keys.has('ShiftLeft') || keys.has('ShiftRight')) && keys.has('ArrowUp');
  kIn.power = trainer ? devices.power : sim.power;
  kIn.strokeRate = trainer ? rate ?? (devices.machineKind === 'rower' ? devices.cadence : 0) : sim.tapRate ? sim.tapRate : sim.power > 20 ? (sprinting ? SIM_ROW.sprintRate : SIM_ROW.rate) * Math.min(1, sim.power / SIM_ROW.power) : 0;
  kIn.steer = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
  kIn.auto = autoSteer();
  kIn.machine = trainer && devices.machineKind === 'rower' ? 'rower' : 'other';
  return kIn;
}

function kayakHud() {
  const kind = devices.machineKind;
  let hint = '';
  if (!devices.trainerActive) {
    if (tapEnabled) hint = sim.tapRate ? '' : TOUCH ? 'Tape l’écran à chaque coup de pagaie (plus vite pour sprinter)' : 'Clique en rythme pour pagayer, ou maintiens ↑ (Maj + ↑ pour sprinter)';
    else hint = TOUCH ? 'Maintiens « Pédaler » pour pagayer' : 'Maintiens ↑ pour pagayer · Maj + ↑ pour sprinter · ← → pour tourner';
  } else if (kind && kind !== 'rower') hint = `Machine connectée : ${MACHINE_LABELS[kind] || kind} (sa puissance fait avancer le kayak)`;
  touch?.setPedalVisible(!devices.trainerActive);
  touch?.setItemReady(!!kayak.race?.player.item);
  kHud.hint = hint;
  kHud.autoSteer = autoSteer() && !keys.has('ArrowLeft') && !keys.has('ArrowRight');
  kHud.heartRate = devices.heartRate;
  kHud.trainer = devices.trainerActive;
  return kHud;
}
const kHud = { hint: '', autoSteer: false, heartRate: null, trainer: false };

function showKayakEnd() {
  if (state === 'paused') {
    endTimer = setTimeout(showEnd, 500);
    return;
  }
  if (state !== 'race') return;
  state = 'end';
  touch?.releaseAll();
  fillEnd(kayak.results(), { kind: 'kayak', note: 'le kayakiste' });
}

// ---------- Matériel ----------

function setStatus(id, text, cls = '') {
  const el = $(id);
  el.textContent = text;
  el.className = `status ${cls}`;
}

let busy = { trainer: false, hr: false, zwift: false };

// Jouer : la carte de la machine connectée est mise en avant (badge, focus par défaut) ; un tapis de
// course ou un capteur de puissance joue les circuits vélo.
let markedKind;
function markConnectedMachine() {
  const kind = devices.trainer.connected ? devices.machineKind : null;
  if (kind === markedKind) return; // appelé souvent : ne touche au DOM qu'au changement
  markedKind = kind;
  const want = kind === 'cross' ? 'cross' : kind === 'rower' ? 'row' : kind ? 'bike' : null;
  for (const card of document.querySelectorAll('[data-machine]')) {
    const on = card.dataset.machine === want;
    card.classList.toggle('connected', on);
    if (on) {
      card.setAttribute('aria-current', 'true');
      card.dataset.badge = kind === 'treadmill' ? 'Tapis connecté' : 'Connecté';
    } else card.removeAttribute('aria-current');
  }
}

// Machine déjà connue (rameur qui s'est mis en veille…) : bandeau « Reconnecter » dans la pause et avant
// le lancement d'un niveau. Sur iOS, la reconnexion attend que la machine se réveille, sans délai.
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let machineBarKey = '';
function renderMachineBars() {
  const k = devices.known;
  const t = devices.trainer;
  let key = '';
  let html = '';
  if (t.connected) {
    key = `on|${t.name}`;
    html = `<span class="mb-dot on"></span><span class="mb-text"><b>${escHtml(t.name)}</b> connectée</span>`;
  } else if (k?.trainer || k?.hr) {
    const name = escHtml(k.trainer || k.hr);
    key = `off|${name}|${k.waiting}|${devices.canReconnect}`;
    const text = k.waiting
      ? `<b>${name}</b> · se reconnecte à son réveil (un coup de rame ou de pédale)`
      : `<b>${name}</b> déconnectée`;
    const btn = devices.canReconnect ? `<button type="button" class="btn small" data-reconnect>${k.waiting ? 'Relancer' : 'Reconnecter'}</button>` : '';
    html = `<span class="mb-dot ${k.waiting ? 'wait' : 'off'}"></span><span class="mb-text">${text}</span>${btn}`;
  }
  if (key === machineBarKey) return;
  machineBarKey = key;
  for (const bar of document.querySelectorAll('[data-machine-bar]')) {
    bar.innerHTML = html;
    bar.hidden = !html;
  }
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-reconnect]');
  if (!btn) return;
  btn.disabled = true;
  Promise.resolve(devices.reconnect())
    .catch((err) => hud.flash(`Reconnexion impossible : ${err?.message || err}`, 2600, 'bad'))
    .finally(() => {
      machineBarKey = '';
      renderMachineBars();
    });
});

function refreshDevices() {
  markConnectedMachine();
  renderMachineBars();
  const t = devices.trainer;
  if (!busy.trainer) {
    if (t.connected) {
      const live = t.data.power !== null ? ` · ${Math.round(t.data.power)} W, ${Math.round(t.data.cadence ?? 0)} rpm` : '';
      const kind = t.kind && t.kind !== 'bike' ? ` (${MACHINE_LABELS[t.kind] || t.kind})` : '';
      setStatus('trainerStatus', `${t.name}${kind}${t.canControl ? (t.kind === 'bike' ? ' · pente pilotée' : ' · résistance pilotée') : ' · lecture seule'}${live}`, t.canControl ? 'ok' : 'warn');
    } else if (t.device) setStatus('trainerStatus', 'déconnecté', 'bad');
  }
  const h = devices.hr;
  if (!busy.hr && h.connected) setStatus('hrStatus', `${h.name}${h.bpm ? ` · ${h.bpm} bpm` : ''}`, 'ok');
  else if (!busy.hr && h.device) setStatus('hrStatus', 'déconnectée', 'bad');
  if (!busy.zwift) {
    const list = devices.connectedControllers;
    if (list.length) {
      const names = list.map((c) => (c.side === 'L' ? 'gauche' : c.side === 'R' ? 'droite' : c.handshake ? 'prête' : 'en attente')).join(', ');
      setStatus('zwiftStatus', `${list.length} manette${list.length > 1 ? 's' : ''} (${names})`, 'ok');
    }
  }
  menu.setStatus({
    trainer: !!t.connected,
    hr: !!devices.hr.connected,
    controllers: devices.connectedControllers.length,
    gfxLabel: `${DETAILED ? 'graphismes détaillés' : 'graphisme simple'} · météo ${WEATHER_LABELS[weatherPref].toLowerCase()}`,
  });
  refreshHwTest();
  const verb = { rower: 'Rame', cross: 'Pédale sur l’elliptique', treadmill: 'Cours sur le tapis' }[devices.machineKind] || 'Pédale';
  $('modeHint').textContent = t.connected
    ? `${t.name} fournit la puissance. ${verb} pour avancer !`
    : TOUCH
      ? 'Sans home trainer : maintiens le bouton « Pédaler » à l’écran (250 W simulés).'
      : 'Sans home trainer : maintiens la flèche ↑ pour pédaler (250 W simulés).';
}
devices.addEventListener('change', refreshDevices);
devices.addEventListener('change', updateGate);

async function connect(kind, statusId, fn) {
  busy[kind] = true;
  setStatus(statusId, 'connexion…', 'warn');
  try {
    await fn();
    busy[kind] = false;
    refreshDevices();
  } catch (e) {
    busy[kind] = false;
    setStatus(statusId, explainError(e), 'bad');
  }
}

$('connectTrainer').addEventListener('click', () => connect('trainer', 'trainerStatus', () => devices.connectTrainer({ demoKind: demoKind() })));
$('connectHr').addEventListener('click', () => connect('hr', 'hrStatus', () => devices.connectHeartRate()));
$('connectZwift').addEventListener('click', () => connect('zwift', 'zwiftStatus', () => devices.connectController()));
$('resume').addEventListener('click', resume);
$('quit').addEventListener('click', goHome);
$('replay').addEventListener('click', replay);
$('backHome').addEventListener('click', goHome);

if (NATIVE) {
  $('nativeHint').hidden = false;
  $('nativeHint').textContent = "Appli MyCycleWorld : choisis ton matériel et connecte ta machine dans l'onglet « Appareils » (test de connexion, console et inspecteur Bluetooth y sont aussi), puis reviens ici pour jouer. Pendant la course, l'appli pilote la pente d'un vélo ou la résistance d'un elliptique ou d'un rameur.";
} else if (DEMO) {
  $('demoBanner').hidden = false;
  $('demoLink').textContent = 'Vrai Bluetooth';
  $('demoLink').href = './';
  $('diagLink').href = '../diag/?demo=1';
} else if (!devices.bluetoothAvailable) {
  $('btWarning').textContent = `${bluetoothAdvice()} Tu peux quand même jouer ${TOUCH ? 'avec les boutons à l’écran' : 'au clavier'}.`;
  $('btWarning').hidden = false;
}

// ---------- Profil matériel et test de connexion ----------

// Chaque page de connexion (Zwift, Technogym, Bluetooth standard) a ses boutons, sa console et son test.
const CONNECT_TITLES = { zwift: 'Connecter Zwift', technogym: 'Connecter Technogym', ble: 'Bluetooth standard' };
function applyHardware() {
  const hw = hardwareById(hwId);
  devices.setHardware(hwId);
  $('connectTitle').textContent = CONNECT_TITLES[hwId];
  if (!NATIVE) $('connectTrainer').textContent = hw.connectLabel;
  // En salle (des dizaines de machines) : la carte de la salle de l'appli iOS évite de chercher la sienne dans une liste.
  $('hwHint').textContent = hwId === 'technogym' && !NATIVE ? `${hw.hint} En salle, avec des dizaines de machines : l’appli iPhone MyCycleWorld cartographie la salle et te laisse choisir ta machine sur un plan.` : hw.hint;
  $('connectDemoCross').hidden = !(DEMO && hwId === 'technogym');
  $('zwiftRow').hidden = hwId !== 'zwift';
  for (const card of document.querySelectorAll('[data-connect]')) card.setAttribute('aria-current', String(card.dataset.connect === hwId));
}
for (const card of document.querySelectorAll('[data-connect]')) {
  card.addEventListener('click', () => {
    hwId = card.dataset.connect;
    savePref(HW_KEY, hwId);
    applyHardware();
    // Appli iOS récente : l'écran natif « Appareils » s'ouvre par-dessus le jeu, avec ce profil.
    if (NATIVE && devices.openNative('devices', hwId)) return;
    refreshDevices();
    showLog();
    menu.open('connectPanel', card);
  });
}
applyHardware();
// Appli iOS récente (elle annonce « openNative ») : entrée « Réglages de l'appli » dans les Options.
// Appli plus ancienne : rien ne change, la page « Connecter » renvoie vers son onglet « Appareils ».
if (NATIVE) {
  const refreshNativeEntries = () => {
    $('nativeSettings').hidden = !devices.canOpenNative;
  };
  devices.addEventListener('change', refreshNativeEntries);
  refreshNativeEntries();
  $('nativeSettings').addEventListener('click', () => devices.openNative('settings'));
  // Révision 4 : carte de la salle (lieux, machines repérées) dans les Options.
  const refreshGymEntry = () => {
    $('gymOptions').hidden = !devices.canUseGym;
  };
  devices.addEventListener('change', refreshGymEntry);
  refreshGymEntry();
  $('gymOptions').addEventListener('click', () => devices.openNative('gym'));
}
// Appli iOS : le profil choisi dans l'onglet « Appareils » fait foi dès qu'il change.
let nativeHw = null;
if (NATIVE) {
  devices.addEventListener('change', () => {
    if (!devices.hardware || devices.hardware === nativeHw) return;
    nativeHw = devices.hardware;
    hwId = nativeHw;
    applyHardware();
  });
}

const demoKind = () => (DEMO && hwId === 'technogym' ? 'rower' : undefined);
$('connectAny').addEventListener('click', () => connect('trainer', 'trainerStatus', () => devices.connectTrainer({ acceptAll: true, demoKind: demoKind() })));
$('connectDemoCross').addEventListener('click', () => connect('trainer', 'trainerStatus', () => devices.connectTrainer({ demoKind: 'cross' })));

const ago = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
function refreshHwTest() {
  const t = devices.trainer;
  const box = $('hwTest');
  box.hidden = NATIVE;
  if (box.hidden) return;
  if (!t.device) {
    $('hwTestInfo').innerHTML = '<dt>Machine</dt><dd>aucune connectée pour l’instant</dd>';
    $('hwPilot').disabled = true;
    return;
  }
  const d = t.data;
  const rows = [];
  const info = t.deviceInfo || {};
  rows.push(['Machine', [t.name, [info.manufacturer, info.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')]);
  rows.push(['Connexion', t.connected ? 'connectée' : 'déconnectée', t.connected ? 'ok' : 'bad']);
  if (t.connected) {
    rows.push(['Type', t.kind ? `${MACHINE_LABELS[t.kind] || t.kind}${t.kind === 'power' ? ' (Cycling Power)' : ' (FTMS)'}` : 'inconnu (aucune donnée FTMS ni puissance)', t.kind ? 'ok' : 'bad']);
    rows.push(['Services', (t.serviceList || []).map((u) => uuidName(u).replace(/ \[[^\]]+\]$/, '')).join(', ') || '(liste indisponible)']);
    const age = t.lastPacketAt ? performance.now() - t.lastPacketAt : Infinity;
    rows.push(['Données', t.packets ? `${t.packets} paquets, dernier il y a ${ago(age)}` : 'aucune pour l’instant : démarre une séance ou tire la poignée', t.packets && age < 3000 ? 'ok' : 'bad']);
    const m = [];
    if (d.power !== null) m.push(`${Math.round(d.power)} W`);
    if (d.strokeRate !== null) m.push(`${Math.round(d.strokeRate)} coups/min`);
    else if (d.stepRate !== null) m.push(`${Math.round(d.stepRate)} pas/min`);
    else if (d.cadence !== null) m.push(`${Math.round(d.cadence)} rpm`);
    if (d.speed !== null) m.push(`${d.speed.toFixed(1)} km/h`);
    if (d.distance !== null) m.push(`${d.distance} m`);
    if (d.pace) m.push(`${formatSplit(d.pace)} /500 m`);
    if (d.resistance !== null) m.push(`résistance ${d.resistance}`);
    if (d.heartRate) m.push(`${d.heartRate} bpm`);
    rows.push(['Mesures', m.join(' · ') || '--']);
    rows.push(['Pilotage', t.canControl ? `oui${t.features?.targets?.length ? ` (${t.features.targets.join(', ')})` : ''}` : 'non : lecture seule', t.canControl ? 'ok' : '']);
  }
  $('hwTestInfo').innerHTML = rows.map(([k, v, cls = '']) => `<dt>${k}</dt><dd class="${cls}">${v}</dd>`).join('');
  $('hwPilot').disabled = !t.connected || !t.canControl;
}

// Test du pilotage : un peu plus dur pendant 5 s, puis retour (pente pour un vélo, résistance sinon).
$('hwPilot').addEventListener('click', async () => {
  const t = devices.trainer;
  const btn = $('hwPilot');
  btn.disabled = true;
  try {
    if (t.kind === 'bike') await t.setSimulation({ grade: 6 });
    else {
      const r = t.ranges.resistance || { min: 0, max: 20 };
      await t.setResistanceLevel(r.min + (r.max - r.min) * 0.7);
    }
    btn.textContent = 'Plus dur pendant 5 s…';
    await new Promise((res) => setTimeout(res, 5000));
    if (t.kind === 'bike') await t.setSimulation({ grade: 0 });
    else {
      const r = t.ranges.resistance || { min: 0, max: 20 };
      await t.setResistanceLevel(r.min + (r.max - r.min) * 0.3);
    }
    btn.textContent = 'Pilotage OK ✓';
  } catch (e) {
    btn.textContent = `Échec : ${explainError(e)}`;
  }
  setTimeout(() => {
    btn.textContent = 'Tester le pilotage';
    btn.disabled = false;
  }, 2500);
});

// Console Bluetooth : visible par défaut sur chaque page de connexion.
const logBox = $('hwLog');
function showLog() {
  logBox.textContent = logText().split('\n').slice(-80).join('\n') || 'La console affichera ici tout ce qui se passe en Bluetooth (services trouvés, paquets reçus, commandes envoyées).';
  logBox.scrollTop = logBox.scrollHeight;
}
$('hwLogToggle').addEventListener('click', () => {
  logBox.hidden = !logBox.hidden;
  $('hwLogToggle').textContent = logBox.hidden ? 'Afficher la console' : 'Masquer la console';
  if (!logBox.hidden) showLog();
});
onLog((e) => {
  if (logBox.hidden) return;
  if (!logBox.textContent.includes('\n') && !logBox.textContent.match(/^\d/)) logBox.textContent = formatEntry(e);
  else logBox.textContent += `\n${formatEntry(e)}`;
  logBox.scrollTop = logBox.scrollHeight;
});
$('hwLogCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(logText());
    $('hwLogCopy').textContent = 'Copié ✓';
  } catch {
    logBox.hidden = false;
    logBox.textContent = logText();
    $('hwLogToggle').textContent = 'Masquer la console';
    $('hwLogCopy').textContent = 'Sélectionne le texte';
  }
  setTimeout(() => ($('hwLogCopy').textContent = 'Copier le journal'), 2000);
});

// Journal en fichier texte (à envoyer pour ajouter une machine non standard).
$('hwLogDownload').addEventListener('click', () => {
  const blob = new Blob([logText()], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mycycleworld-bluetooth-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// Inspecteur BLE : n'importe quel appareil, toutes les caractéristiques, octets bruts dans la console.
const inspector = NATIVE ? null : new BleInspector({ requestDevice: (o) => devices.requestDevice(o) });
const EXTRA_KEY = 'mycycleworld.inspectExtra';
$('inspectExtra').value = storedPref(EXTRA_KEY) || '';
function refreshInspector() {
  if (!inspector) return;
  $('inspectStop').disabled = !inspector.running;
  $('inspectStatus').textContent = inspector.running
    ? `Écoute de « ${inspector.device.name || 'appareil'} » : ${inspector.chars.size} caractéristiques, ${inspector.packets} paquets reçus.`
    : inspector.device ? `Terminé : ${inspector.summary()}` : '';
}
inspector?.addEventListener('change', refreshInspector);
$('inspectStart').addEventListener('click', async () => {
  savePref(EXTRA_KEY, $('inspectExtra').value);
  logBox.hidden = false;
  $('hwLogToggle').textContent = 'Masquer la console';
  showLog();
  try {
    $('inspectStatus').textContent = 'Choisis l’appareil dans la fenêtre Bluetooth…';
    await inspector.inspect({ extraServices: parseServiceList($('inspectExtra').value) });
  } catch (e) {
    $('inspectStatus').textContent = explainError(e);
  }
  refreshInspector();
});
$('inspectStop').addEventListener('click', () => {
  inspector.stop();
  refreshInspector();
});

// Direction : selon le matériel, toujours automatique ou manuelle.
// Tapoter pour pédaler / ramer : activé ou désactivé.
for (const btn of document.querySelectorAll('.seg-btn[data-tap]')) {
  btn.setAttribute('aria-pressed', String((btn.dataset.tap === 'on') === tapEnabled));
  btn.addEventListener('click', () => {
    tapEnabled = btn.dataset.tap === 'on';
    savePref(TAP_KEY, tapEnabled ? 'on' : 'off');
    tapDrive.reset();
    for (const b of document.querySelectorAll('.seg-btn[data-tap]')) b.setAttribute('aria-pressed', String(b.dataset.tap === btn.dataset.tap)); // Options et Pause
  });
}

// Météo : aléatoire, toujours beau, pluie, vent ou désactivée (appliquée à la prochaine course).
for (const btn of document.querySelectorAll('.seg-btn[data-weather]')) {
  btn.setAttribute('aria-pressed', String(btn.dataset.weather === weatherPref));
  btn.addEventListener('click', () => {
    weatherPref = weatherMode(btn.dataset.weather);
    savePref(WEATHER_KEY, weatherPref);
    for (const b of document.querySelectorAll('.seg-btn[data-weather]')) b.setAttribute('aria-pressed', String(b === btn));
    renderCourses(); // l'aperçu des circuits annonce la météo
    refreshDevices();
  });
}

for (const btn of document.querySelectorAll('.seg-btn[data-steer]')) {
  btn.setAttribute('aria-pressed', String(btn.dataset.steer === steerPref));
  btn.addEventListener('click', () => {
    steerPref = btn.dataset.steer;
    savePref(STEER_KEY, steerPref);
    for (const b of document.querySelectorAll('.seg-btn[data-steer]')) b.setAttribute('aria-pressed', String(b.dataset.steer === btn.dataset.steer)); // Options et Pause
  });
}

// Choix des graphismes : mémorisé, appliqué en rechargeant la page (le décor est construit au démarrage).
for (const btn of document.querySelectorAll('.seg-btn[data-gfx]')) {
  btn.setAttribute('aria-pressed', String(btn.dataset.gfx === GFX));
  btn.addEventListener('click', () => {
    if (btn.dataset.gfx === GFX) return;
    try {
      localStorage.setItem(GFX_KEY, btn.dataset.gfx);
    } catch {
      /* stockage indisponible : le paramètre d'adresse suffit pour cette fois */
    }
    const url = new URL(location.href);
    url.searchParams.set('gfx', btn.dataset.gfx);
    location.replace(url.toString());
  });
}

// Rejouer la même course (vélo, aviron ou kayak).
function replay() {
  // Même machine de la carte : on attend à nouveau ses données (on rejoue quand on reprend l'effort).
  if (gate.machine) armGate(gate.machine);
  if (mode === 'row') startRowing(rowing.distance);
  else if (mode === 'kayak') startKayak(kayak.riverId);
  else startRace();
}

// ---------- Clavier (et manettes, via KeyEmitter) ----------

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

window.addEventListener('keydown', (e) => {
  // Les manettes simulées appuient au hasard : en démo, on ignore leur pause et leur validation.
  if (DEMO && e.fromController && (e.code === 'Escape' || e.code === 'Enter')) return;
  if (PREVENT.has(e.code) && state !== 'home') e.preventDefault();
  keys.add(e.code);
  const code = e.code;
  if (code === 'Minus' || code === 'NumpadSubtract') return void shiftGear(-1);
  if (code === 'Equal' || code === 'NumpadAdd') return void shiftGear(1);
  if (e.repeat) return;
  if (code === 'Escape') {
    if (state === 'race') pause();
    else if (state === 'paused') resume();
    else if (state === 'end') goHome();
  } else if (code === 'Space' && state === 'race' && mode === 'bike') {
    // VTT : près d'un saut, Espace donne l'impulsion au lieu d'utiliser l'objet.
    // ↓ tenue : le casque part vers l'arrière.
    if (mtbMode.wantsKey()) mtbMode.key();
    else race.useItem(race.player, { back: keys.has('ArrowDown') });
  } else if (code === 'ArrowUp' && state === 'race' && mode === 'bike') {
    mtbMode.key(); // VTT : chaque nouvel appui sur ↑ est une impulsion (sans effet ailleurs)
  } else if (code === 'Space' && state === 'race' && mode === 'kayak') {
    kayak.useItem();
  } else if (code === 'Enter' || code === 'NumpadEnter') {
    if (state === 'race' && gate.active) openGate(false);
    else if (state === 'paused') resume();
    else if (state === 'end') replay();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

// Dans l'appli, c'est elle qui change de vitesse (et applique la pente) puis nous renvoie le résultat.
function shiftGear(delta) {
  if (NATIVE) devices.shift(delta);
  else if (delta < 0) gears.down();
  else gears.up();
}

gears.addEventListener('change', () => {
  if (state === 'race') hud.flash(`Vitesse ${gears.gear} / ${gears.count}`, 600);
});

// ---------- Boucle ----------

function updateSim(dt) {
  const kind = mode === 'bike' ? 'bike' : 'row';
  const now = performance.now();
  // Tapotements : la puissance et la cadence suivent le rythme (sans machine connectée).
  const tapping = tapEnabled && !devices.trainerActive && state !== 'paused' && tapDrive.active(now, kind);
  sim.tapRate = tapping ? tapDrive.target(now, kind).rate : 0;
  // À vélo, la vitesse choisie compte même sans trainer (pente ressentie trop dure ou trop facile = moins de watts).
  const effort = kind === 'bike' ? simulatedEffort(feltGrade) : { factor: 1, cadence: SIM.cadence };
  sim.gearFactor = effort.factor;
  if (tapping) {
    const { power, rate } = tapDrive.target(now, kind);
    const k = 1 - Math.exp(-dt * 4);
    sim.power += (power * effort.factor - sim.power) * k;
    sim.cadence += ((kind === 'row' ? 90 : rate) - sim.cadence) * k;
    return;
  }
  const pedaling = keys.has('ArrowUp') && !devices.trainerActive && state !== 'paused';
  const sprint = mode === 'kayak' && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
  const maxPower = (mode === 'row' ? SIM_ROW.power : mode === 'kayak' ? (sprint ? SIM_ROW.sprint : SIM_ROW.power) : SIM.power) * effort.factor;
  if (pedaling) {
    sim.power = sim.power < maxPower ? Math.min(maxPower, sim.power + SIM.rise * dt) : Math.max(maxPower, sim.power - SIM.fall * dt);
    sim.cadence += ((kind === 'bike' ? effort.cadence : SIM.cadence) - sim.cadence) * (1 - Math.exp(-dt * 3));
  } else {
    sim.power = Math.max(0, sim.power - SIM.fall * dt);
    sim.cadence = Math.max(0, sim.cadence - SIM.cadenceFall * dt);
  }
}

// Bouton Pause à l'écran (même effet que Échap ou le bouton B de la manette).
$('gamePause').addEventListener('click', (e) => {
  e.stopPropagation();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape', key: 'Escape', bubbles: true }));
});

// iOS : pas de zoom au double tapotement ni au pincement (on tapote vite pour pédaler). Si un zoom a
// quand même eu lieu, on réapplique la balise viewport pour revenir à l'échelle 1.
for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = performance.now();
  if (now - lastTouchEnd < 350 && !e.target.closest?.('input, textarea, select')) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });
window.visualViewport?.addEventListener('resize', () => {
  if (window.visualViewport.scale <= 1.01) return;
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const content = meta.content;
  meta.content = `${content}, minimum-scale=1`;
  requestAnimationFrame(() => (meta.content = content));
});

// Un tapotement n'importe où sur la scène (pas sur un bouton) = un tour de pédalier ou un coup d'aviron.
const TAP_IGNORE = 'button, a, input, select, textarea, label, .tc, .side-panel, .screen, [data-no-tap]';
window.addEventListener('pointerdown', (e) => {
  if (state === 'race' && mode === 'bike' && e.button <= 0 && !e.target.closest?.(TAP_IGNORE)) mtbMode.tap(); // VTT : double tapotement = impulsion
  if (!tapEnabled || state !== 'race' || devices.trainerActive) return;
  if (e.button > 0 || e.target.closest?.(TAP_IGNORE)) return;
  tapDrive.tap(performance.now());
  // Petit cercle à l'endroit du tapotement
  const dot = document.createElement('div');
  dot.className = 'tap-ripple';
  dot.style.left = `${e.clientX}px`;
  dot.style.top = `${e.clientY}px`;
  document.body.appendChild(dot);
  setTimeout(() => dot.remove(), 600);
});

// Pilote automatique : forcé dans les options, ou choisi selon le matériel (machine sans boutons de
// direction : elliptique, vélo ou rameur Technogym / BLE, sans manette Zwift connectée).
function autoSteer() {
  if (steerPref === 'on') return true;
  if (steerPref === 'off') return false;
  if (devices.connectedControllers.length) return false;
  if (playMachine === 'cross' || playMachine === 'row') return true;
  const kind = devices.machineKind;
  return kind === 'cross' || kind === 'rower' || (hwId !== 'zwift' && devices.trainerActive);
}

function playerInput() {
  const trainer = devices.trainerActive;
  const input = {
    auto: autoSteer(),
    power: trainer ? devices.power : sim.power,
    cadence: trainer ? devices.cadence : sim.cadence,
    steer: (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0),
    drift: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  };
  return mtbMode.input(input, input); // VTT : impulsion pour les sauts (coup de puissance, touche, tapotement)
}

// Pente envoyée au trainer : terrain + effets des objets, puis vitesses virtuelles.
function updateGrade() {
  if (mode === 'kayak') {
    // Kayak : les rapides sont un peu plus durs (pente légère au vélo et à l'elliptique, résistance douce au rameur).
    const kind = devices.machineKind;
    const g = state === 'race' ? kayak.grade(kind) : 0;
    feltGrade = kind === 'rower' ? g : gears.effectiveGrade(g);
    if (lastSentGrade === null || Math.abs(feltGrade - lastSentGrade) >= 0.1) {
      lastSentGrade = feltGrade;
      devices.sendGrade(feltGrade, g);
    }
    return g;
  }
  if (mode === 'row') {
    // Au rameur, pas de pente : on laisse la machine sur sa résistance (et un trainer sur du plat).
    if (lastSentGrade !== 0 && devices.machineKind !== 'rower') devices.sendGrade(0, 0);
    lastSentGrade = 0;
    feltGrade = 0;
    return 0;
  }
  const p = race.player;
  const t = race.time;
  const terrain = state === 'race' || state === 'end' ? track.gradeAt(p.s) : 0;
  // Le sable (et un peu la passerelle) se ressent aussi dans les jambes : pente équivalente en plus.
  const surface = state === 'race' && !p.offRoad ? SURFACES[track.surfaceAt(p.s)]?.gradeExtra ?? 0 : 0;
  const effects = state === 'race' ? (p.turbo(t) ? TURBO_GRADE : 0) + (p.slipping(t) ? BANANA_GRADE : 0) + surface : 0;
  // Météo : vent de face (ou de dos) converti en pente équivalente, abri de l'aspiration compris. Il entre
  // dans la pente ressentie et dans la pente envoyée aux machines pilotées en résistance et à l'appli iOS ;
  // un vélo en simulation FTMS reçoit la pente sans le vent et le vent dans son champ dédié (devices.js).
  const tail = race.weather && state === 'race' ? p.tailwind ?? 0 : 0;
  windGradeNow = tail ? windGrade(p.v, tail, { cda: DEFAULTS.cda * p.draft }) : 0;
  feltGrade = gears.effectiveGrade(terrain + effects + windGradeNow);
  if (lastSentGrade === null || Math.abs(feltGrade - lastSentGrade) >= 0.1) {
    lastSentGrade = feltGrade;
    if (race.weather) devices.sendGrade(feltGrade, terrain + effects + windGradeNow, { speed: ftmsWindSpeed(tail), grade: gears.effectiveGrade(terrain + effects) });
    else devices.sendGrade(feltGrade, terrain + effects);
  }
  return terrain;
}

const HIT_SPIN = 0.75; // s

function syncScene(dt) {
  const t = race.time;
  for (const [r, m] of models) {
    const f = track.frame(r.s, r.lateral, tmpFrame);
    m.group.position.set(f.x, f.y + 0.03, f.z);
    // Le vélo pointe dans sa direction réelle (cap par rapport à la route) et s'incline dans les virages.
    let yaw = Math.atan2(f.tx, f.tz) - (r.heading || 0);
    // Touché par un casque : tête-à-queue complet, rapide puis amorti.
    const hit = t - r.hitAt;
    if (hit >= 0 && hit < HIT_SPIN) yaw += (r.hitSpin || 1) * Math.PI * 2 * (1 - (1 - hit / HIT_SPIN) ** 2);
    let pitch = -Math.atan(f.grade / 100);
    let roll = r.lean || 0;
    if (r.slipping(t)) roll += Math.sin(t * 25) * 0.18;
    if (m.setPose) {
      // En danseuse dans les côtes, avec le balancement du vélo au rythme du pédalage.
      const climbing = f.grade > 5 && r.cadence > 30 && r.v > 1 ? 1 : 0;
      m.pose = (m.pose ?? 0) + (climbing - (m.pose ?? 0)) * (1 - Math.exp(-dt * 3));
      m.setPose(m.pose);
      roll += Math.sin(r.crank) * 0.07 * m.pose;
    }
    if (m.setSteer) {
      // Braquage du guidon : angle nécessaire pour le virage total (route + écart), à empattement ~1 m.
      const omega = (r.yawRate || 0) + r.v * track.curvatureAt(r.s);
      m.setSteer(Math.max(-0.35, Math.min(0.35, Math.atan(omega / Math.max(r.v, 1.5)))));
    }
    if (race.mtb) {
      // VTT : virage relevé, saut, réception, chute (mtb-mode.js)
      mtbMode.pose(r, m, dt, mtbPose);
      pitch += mtbPose.pitch;
      roll += mtbPose.roll;
      m.group.position.y += mtbPose.dy;
    }
    m.group.rotation.set(pitch, yaw, roll, 'YXZ');
    if (m.setMotion) m.setMotion(r.v, f.grade, r.power); // position aéro dans les descentes rapides
    if (m.setRace) m.setRace(t, camera, race.distance - r.s); // regards, salut au départ, sprint final
    m.setCrank(r.crank);
    m.spinWheels((r.v * dt) / 0.34);
    // Un adversaire collé à la caméra masquerait la route : on le cache, ainsi que son étiquette.
    const camDist = camera.position.distanceTo(m.group.position);
    m.group.visible = r.isPlayer || camDist > 3.5 || state === 'home';
    if (m.label) m.label.visible = camDist > 7;
  }
  const now = performance.now() / 1000;
  const cam = camera.position;
  race.boxes.forEach((b, i) => {
    const mesh = boxMeshes[i];
    // Boîtes lointaines (au-delà de 140 m, dans la brume) non dessinées : beaucoup d'appels de dessin en moins.
    mesh.visible = t >= b.respawnAt && (state === 'home' || mesh.position.distanceToSquared(cam) < 19600);
    mesh.rotation.y = now * 1.2 + i;
    mesh.position.y = mesh.userData.baseY + Math.sin(now * 2 + i) * 0.12;
  });
}

function cameraTarget(outPos, outLook) {
  const p = race.player;
  // La caméra suit en partie la direction du vélo : on voit le coureur tourner, pas glisser.
  const side = Math.sin(p.heading || 0);
  const lift = mtbMode.cameraLift(); // VTT : la caméra suit un peu le saut
  const back = track.frame(p.s - 6.5, p.lateral * 0.85 - side * 3.2, tmpFrame);
  outPos.set(back.x, back.y + 2.7 + lift, back.z);
  const ahead = track.frame(p.s + 7, p.lateral * 0.6 + side * 3.5, tmpFrame2);
  outLook.set(ahead.x, ahead.y + 1.0 + lift * 0.8, ahead.z);
}

function snapCamera() {
  if (state === 'race') cameraTarget(camPos, camLook);
}

const desiredPos = new THREE.Vector3();
const homeLook = new THREE.Vector3();
const desiredLook = new THREE.Vector3();

function updateCamera(dt, nowMs) {
  if (state === 'home') {
    // Écran titre : plan de cinéma qui tourne lentement autour de la grille de départ.
    const c = track.frame(-6, 0, tmpFrame);
    const a = nowMs * 0.00009 + 0.6;
    camera.position.set(c.x + Math.cos(a) * 12, c.y + 2.6 + Math.sin(nowMs * 0.0003) * 0.3, c.z + Math.sin(a) * 12);
    homeLook.set(c.x, c.y + 1.1, c.z);
    if (window.innerWidth > 760) {
      // Le menu est à gauche : on vise un peu à gauche des coureurs pour qu'ils apparaissent à droite.
      const dx = homeLook.x - camera.position.x;
      const dz = homeLook.z - camera.position.z;
      const l = Math.hypot(dx, dz) || 1;
      homeLook.x += (dz / l) * 4.5;
      homeLook.z -= (dx / l) * 4.5;
    }
    camera.lookAt(homeLook);
    camPos.copy(camera.position);
    return;
  }
  cameraTarget(desiredPos, desiredLook);
  camPos.lerp(desiredPos, 1 - Math.exp(-dt * 6));
  camLook.lerp(desiredLook, 1 - Math.exp(-dt * 9));
  camera.position.copy(camPos);
  shake = Math.max(shake, mtbMode.takeShake(dt)); // VTT : réception et chute
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.5;
    camera.position.y += (Math.random() - 0.5) * shake * 0.5;
    shake = Math.max(0, shake - dt * 1.5);
  }
  camera.lookAt(camLook);
  // Légère inclinaison de la caméra avec le vélo et champ de vision qui s'ouvre avec la vitesse.
  const p = race.player;
  camRoll += ((p.lean || 0) * 0.12 - camRoll) * (1 - Math.exp(-dt * 4));
  camera.rotateZ(-camRoll);
  const fov = 63 + Math.min(9, p.v * 0.6);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 2));
    camera.updateProjectionMatrix();
  }
}
let camRoll = 0;

// Le soleil (et sa zone d'ombres) suit le joueur.
function updateSun() {
  if (!sun) return;
  const p = race.player;
  const f = track.frame(p.s, p.lateral, tmpFrame);
  followSun(sun, tmpVec.set(f.x, f.y, f.z), camera);
}
const tmpVec = new THREE.Vector3();

let lastFrame = performance.now();
let lastMenuFrame = 0;
function frame(nowMs) {
  if (warming || !governor.allow(nowMs)) {
    requestAnimationFrame(frame);
    return;
  }
  // Un écran de menu couvre la scène : la 3D derrière se contente de 20 images/s.
  if (state === 'home' && menu.panel && nowMs - lastMenuFrame < 50) {
    requestAnimationFrame(frame);
    return;
  }
  lastMenuFrame = nowMs;
  if (fpsMeter && nowMs - (frame.lastFps || 0) > 500) {
    frame.lastFps = nowMs;
    fpsMeter.textContent = `${Math.round(governor.fps)} i/s · résolution ${Math.round(governor.scale * 100)} %`;
  }
  const dt = Math.min(0.1, Math.max(0, (nowMs - lastFrame) / 1000));
  lastFrame = nowMs;
  updateSim(dt);
  audio.update({ dt, mode, state, camera, track, race, rowing: rowing?.race, gear: gears.gear, player: mode === 'kayak' ? kayakPlayerAudio() : undefined, weather: weather.audio });
  updateCrowds(dt, camera); // foules et figurants animés (people.js)
  helmetFx.group.visible = mode === 'bike';
  if (mode === 'kayak') {
    kayakSounds();
    kayak.frame(dt, nowMs, gate.active && state === 'race' ? 'paused' : state, kayakInput(), kayakHud());
    updateGrade();
    if (post) post.render();
    else renderer.render(scene, camera);
    requestAnimationFrame(frame);
    return;
  }
  if (mode === 'row') {
    frameRowing(dt, nowMs);
    if (post) post.render();
    else renderer.render(scene, camera);
    requestAnimationFrame(frame);
    return;
  }
  if ((state === 'race' && !gate.active) || state === 'end') {
    weather.step(dt, race.time, true); // vent et pluie de l'instant, avant la physique
    race.update(dt, playerInput());
    if (race.time < 0) hud.countdown(String(Math.ceil(-race.time)));
    else if (race.ride && state === 'race') ridePlaces(); // balade : nom des lieux traversés
  }
  syncScene(state === 'paused' ? 0 : dt);
  helmetFx.sync(race, track, state === 'paused' ? 0 : dt, camera);
  mtbMode.frame(state === 'paused' ? 0 : dt, state, { trainer: devices.trainerActive, touch: TOUCH });
  const terrain = updateGrade();
  updateCamera(dt, nowMs);
  updateSun();
  scenery.update(dt, camera);
  if (state !== 'home') {
    weather.observe(race.player);
    weather.render(dt, camera, race);
  }

  if (state !== 'home') {
    const p = race.player;
    touch?.setPedalVisible(!devices.trainerActive);
    touch?.setItemReady(!!p.item);
    hud.update(
      {
        power: p.power,
        cadence: p.cadence,
        heartRate: devices.heartRate,
        speedKmh: msToKmh(p.v),
        gear: gears.gear,
        gearCount: gears.count,
        feltGrade,
        terrainGrade: terrain,
        windGrade: windGradeNow,
        weather: weather.hud,
        position: race.positionOf(p),
        total: race.racers.length,
        ride: race.ride ? Math.max(0, race.distance - p.s) : null, // balade : distance restante (m)
        lap: race.lapOf(p),
        laps: race.laps,
        time: p.finishTime ?? race.time,
        item: p.item,
        turboLeft: p.turboUntil - race.time,
        slipLeft: p.slipUntil - race.time,
        hitLeft: p.hitUntil - race.time,
        draft: p.draft,
        offRoad: p.offRoad,
        surface: p.surface,
        trail: !!race.mtb,
        autoSteer: autoSteer() && !keys.has('ArrowLeft') && !keys.has('ArrowRight'),
        keyboard: !devices.trainerActive,
        tap: tapEnabled,
        // Conseil de vitesse sans trainer : braquet trop dur (côte) ou trop facile (descente).
        gearAdvice: !devices.trainerActive && sim.power > 5 && (sim.gearFactor ?? 1) < 0.85 ? (feltGrade > 5 ? 'down' : 'up') : null,
        touch: TOUCH,
      },
      race,
      nowMs,
    );
  } else if (nowMs - (frame.lastHome || 0) > 300) {
    frame.lastHome = nowMs;
    refreshDevices();
  }
  if (post) post.render();
  else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Accès de débogage (console, tests automatisés).
window.__mcw = {
  gfx: GFX,
  quality: QUALITY,
  renderer,
  scene,
  camera,
  get state() { return state; },
  get race() { return race; },
  tapDrive,
  governor,
  get mode() { return mode; },
  get rowing() { return rowing; },
  get kayak() { return kayak; },
  startKayak,
  startRace,
  snapCamera: () => cameraTarget(camPos, camLook), // caméra replacée d'un coup derrière le joueur (captures)
  devices,
  gears,
  get track() { return track; },
  get courseId() { return courseId; },
  loadCourse,
  get feltGrade() { return feltGrade; },
  audio,
  weather,
  get weatherPref() { return weatherPref; },
  mtb: mtbMode,
  helmetFx,
  get scenery() { return scenery; },
};

renderCourses();
setupRace();
await warmShaders();
goHome();
window.__mcwStarted = true;
requestAnimationFrame(frame);
