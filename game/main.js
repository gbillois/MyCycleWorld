// MyCycleWorld, prototype jouable : scène 3D, boucle de jeu, écrans, clavier/manettes, pente au trainer.
import * as THREE from 'three';
import { Track, buildScenery, minimapPath } from './track.js';
import { buildScenery as buildDetailedScenery, SUN_DIR, disposeTree } from './scenery.js';
import { COURSE_ORDER, courseById, SURFACES } from './courses.js';
import { elevationGain } from '../src/core/profile.js';
import { RiderModel, createItemBox, createBanana } from './models.js';
import { DetailedRider } from './rider.js';
import { Race, ITEMS } from './race.js';
import { Devices, explainError } from './devices.js';
import { NativeDevices, isNativeApp } from './native.js';
import { Hud, formatTime, ordinal, ordinalHtml, renderResults } from './hud.js';
import { VirtualGears } from '../src/core/gears.js';
import { msToKmh } from '../src/core/physics.js';
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
let playMachine = 'bike'; // bike | cross | row : machine choisie dans « Jouer »

// Puissance simulée au clavier (sans home trainer). Au rameur : 180 W à 26 coups/min.
const SIM = { power: 250, cadence: 90, rise: 900, fall: 140, cadenceFall: 70 };
const SIM_ROW = { power: 180, rate: 26 };
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
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 420 });
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

// Décor du circuit courant (reconstruit quand on change de circuit, sans recharger la page :
// un rechargement couperait les connexions Bluetooth).
function buildWorld() {
  if (DETAILED) {
    scenery = buildDetailedScenery(scene, track, { quality: QUALITY, renderer });
    return;
  }
  const simple = buildScenery(scene, track);
  scenery = {
    ...simple,
    update: (dt, cam) => simple.sky.position.copy(cam.position),
    dispose: () => {
      for (const root of [simple.group, simple.sky]) {
        scene.remove(root);
        disposeTree(root);
      }
    },
  };
}
buildWorld();
const Rider = DETAILED ? DetailedRider : RiderModel;
const hud = new Hud(track);
const menu = new TitleMenu($('home'));

// Halo lumineux léger sur ordinateur (post-traitement chargé seulement si besoin).
let post = null;
if (DETAILED && QUALITY === 'high') {
  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
    ]);
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.6, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    post = { composer, bloom };
  } catch (e) {
    console.warn('Post-traitement indisponible, rendu direct.', e);
  }
}

// Écran tactile : boutons à l'écran (ils envoient les mêmes touches que le clavier).
const TOUCH = wantsTouch(params);
const touch = TOUCH ? new TouchControls($('hud')) : null;
if (TOUCH) document.body.classList.add('touch');

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (post) post.composer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Fluidité : 60 images/s au plus, résolution abaissée automatiquement si la machine peine (?fps=1 affiche le compteur).
const governor = new FrameGovernor({
  min: QUALITY === 'high' ? 0.5 : 0.6,
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
let state = 'home'; // home | race | paused | end
let mode = 'bike'; // bike | row
let rowing = null; // { race, world, boats } en mode rameur
let race = null;
let models = new Map(); // racer -> RiderModel
let boxMeshes = [];
const bananaMeshes = new Map(); // id -> mesh
const raceObjects = new THREE.Group();
scene.add(raceObjects);
let lastSentGrade = null;
let feltGrade = 0;
let shake = 0;
let endTimer = null;

const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const tmpFrame = {};
const tmpFrame2 = {};

// Crée une course (et ses objets 3D). Utilisé aussi pour l'aperçu de l'écran d'accueil.
function setupRace() {
  if (mode === 'row') return setupRowing();
  disposeTree(raceObjects); // coureurs, étiquettes et objets de la course précédente
  raceObjects.clear();
  bananaMeshes.clear();
  models = new Map();
  race = new Race(track, { laps: lapsFor(track.course) });
  for (const r of race.racers) {
    const m = new Rider({ jersey: r.color, bike: r.bike, helmet: r.helmet, name: r.isPlayer ? '' : r.name, quality: QUALITY });
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
  race.addEventListener('lap', ({ detail }) => {
    hud.flash(detail.lap === race.laps ? 'Dernier tour !' : `Tour ${detail.lap} / ${race.laps}`, 1500);
  });
  race.addEventListener('finish', ({ detail: r }) => {
    if (!r.isPlayer) return;
    hud.flash(`Arrivée : ${ordinal(race.positionOf(r))} !`, 2500, 'good');
    endTimer = setTimeout(showEnd, 2200);
  });
  syncScene(0);
  snapCamera();
}

// ---------- Écrans ----------

function show(id) {
  for (const s of ['loading', 'home', 'pause', 'end']) $(s).hidden = s !== id;
  const racing = state === 'race' || state === 'paused' || state === 'end';
  hud.show(racing && mode === 'bike');
  $('rowHud').hidden = !(racing && mode === 'row');
  if (id === 'home') {
    menu.close(false);
    menu.focusDefault();
  }
}

async function goHome() {
  clearTimeout(endTimer);
  if (mode === 'row') await leaveRowing();
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
  state = 'race';
  lastSentGrade = null;
  show(null);
  hud.flash('', 1);
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
  if (state === 'paused') {
    endTimer = setTimeout(showEnd, 500);
    return;
  }
  if (state !== 'race') return;
  state = 'end';
  touch?.releaseAll();
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
};
const SURF_COLORS = { sand: '#f2cf7a', boardwalk: '#c08a55' };
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
  }[theme];
  const [sx, sz] = pts[0];
  const start = `<g transform="translate(${(8 + sx * 84 - 4).toFixed(1)} ${(8 + sz * 84 - 4).toFixed(1)})"><rect width="8" height="8" rx="1.5" fill="#fff" stroke="#11151f" stroke-width="1"/><rect width="4" height="4" fill="#11151f"/><rect x="4" y="4" width="4" height="4" fill="#11151f"/></g>`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="${gid}" cx="35%" cy="30%" r="85%"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient></defs><rect width="100" height="100" fill="url(#${gid})"/>${deco}<path d="${d}Z" fill="none" stroke="#0b0e16" stroke-opacity=".6" stroke-width="${big ? 6 : 7.5}" stroke-linejoin="round"/><path d="${d}Z" fill="none" stroke="#fff" stroke-width="${big ? 2.6 : 3.2}" stroke-linejoin="round"/>${surf}${start}</svg>`;
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

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const courseInfo = new Map();
function describeCourse(id) {
  if (!courseInfo.has(id)) {
    const t = id === track.course.id ? track : new Track(courseById(id));
    const c = t.course;
    const gain = elevationGain(t.grade, t.step);
    const maxGrade = Math.max(...t.grade);
    const hasSand = t.surf.includes('sand');
    const stats = [`${(t.length / 1000).toFixed(1)} km`, `D+ ${Math.round(gain)} m`, plural(lapsFor(c), 'tour')];
    const hot = [];
    if (maxGrade >= 8) hot.push(`pente max ${Math.round(maxGrade)} %`);
    if (hasSand) hot.push('sable');
    // Profil échantillonné (120 points) et bandes de revêtement.
    const range = Math.max(8, t.maxY - t.minY);
    const prof = [];
    for (let k = 0; k <= 120; k++) {
      const i = Math.round((k / 120) * t.count);
      prof.push([k / 120, 52 - ((t.y[i] - t.minY) / range) * 44]);
    }
    const bands = [];
    for (const [a, b, type] of c.surfaces || []) if (SURF_COLORS[type]) bands.push([a, b, SURF_COLORS[type]]);
    const surfaces = [...new Set(['asphalt', ...t.surf])].map((x) => SURFACES[x]?.label || x);
    const difficulty = Math.max(1, Math.min(5, Math.round(maxGrade / 3) + (hasSand ? 1 : 0) + (gain / t.length > 0.025 ? 1 : 0)));
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
  const machine = playMachine === 'cross' ? 'Elliptique' : 'Vélo';
  return `<div class="pv" data-theme="${x.theme}">
    <div class="pv-map">${x.big}</div>
    <div class="pv-info">
      <span class="pv-kicker">${machine} · circuit</span>
      <h3>${x.name}</h3>
      <p>${x.tagline}</p>
      <div class="pv-diff"><span>Difficulté</span>${stars(x.difficulty)}</div>
      <div class="pv-profile">${profileSvg(x, 'profile')}<span class="pv-alt">${x.alt} m</span></div>
      <dl class="pv-stats"><div><dt>${icon('i-route')}Longueur</dt><dd>${x.km} km</dd></div><div><dt>${icon('i-mountain')}Dénivelé</dt><dd>${x.gain} m</dd></div><div><dt>${icon('i-lap')}Tours</dt><dd>${x.laps}</dd></div><div><dt>${icon('i-slope')}Pente max</dt><dd>${x.maxGrade} %</dd></div></dl>
      <div class="pv-surf">${x.surfaces.map((s) => `<span>${s}</span>`).join('')}</div>
      <div class="pv-go"><span class="glyph"><span class="k-kbd">Entrée</span><span class="k-pad pad-a">A</span></span>Lancer la course</div>
    </div>
  </div>`;
}

function renderCourses() {
  $('courseList').innerHTML = COURSE_ORDER.map((id) => {
    const info = describeCourse(id);
    return `<button type="button" class="course-card" data-course="${id}" data-theme="${info.theme}" aria-current="${id === courseId}"><span class="cc-map">${info.svg}</span><span class="cc-body"><span class="c-name">${info.name}</span><span class="c-tag">${info.tagline}</span>${profileSvg(info)}<span class="c-stats">${info.stats.map((x) => `<span>${x}</span>`).join('')}${info.hot.map((x) => `<span class="hot">${x}</span>`).join('')}</span></span>${stars(info.difficulty)}</button>`;
  }).join('');
  previewOf.coursePreview = null;
  showPreview('coursePreview', courseId, coursePreview);
}

// L'aperçu suit le niveau qui a le focus (flèches, manette) ou sous la souris.
const previewOf = {};
function showPreview(box, key, render) {
  const k = `${key}|${playMachine}`;
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
$('rowList').innerHTML = ROW_LEVELS.map((l) => `<button type="button" class="course-card" data-row="${l.distance}" data-theme="lake"><span class="cc-map">${rowSvg(l.distance)}</span><span class="cc-body"><span class="c-name">${l.name}</span><span class="c-tag">${l.tagline}</span><span class="c-stats"><span>${l.distance} m</span><span>6 bateaux</span><span>temps visé ${l.ref}</span></span></span>${stars(l.difficulty)}</button>`).join('');
showPreview('rowPreview', 500, rowPreview);
bindPreview('rowList', 'rowPreview', 'data-row', rowPreview);
$('rowList').addEventListener('click', (e) => {
  const card = e.target.closest('[data-row]');
  if (card) startRowing(+card.dataset.row);
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

$('courseList').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-course]');
  if (!card) return;
  await loadCourse(card.dataset.course);
  startRace();
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
    strokeRate: trainer ? rate ?? (devices.machineKind === 'rower' ? devices.cadence : 0) : sim.power > 20 ? SIM_ROW.rate * Math.min(1, sim.power / SIM_ROW.power) : 0,
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
  if (state === 'race' || state === 'end') {
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
  if (sun) {
    sun.target.position.set(r.player.laneX, 0, r.player.s);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 220);
  }
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
  if (!devices.trainerActive) hint = TOUCH ? 'Maintiens « Pédaler » pour ramer (180 W simulés)' : 'Maintiens ↑ pour ramer (180 W simulés) · ← → pour rester dans ton couloir';
  else if (kind && kind !== 'rower') hint = `Machine connectée : ${MACHINE_LABELS[kind] || kind} (sa puissance fait avancer le bateau)`;
  set('rHint', hint);
  const fx = p.offLane ? '<span class="badge grass">Hors couloir : les bouées freinent !</span>' : autoSteer() ? '<span class="badge auto">🧭 Pilote auto</span>' : '';
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

// ---------- Matériel ----------

function setStatus(id, text, cls = '') {
  const el = $(id);
  el.textContent = text;
  el.className = `status ${cls}`;
}

let busy = { trainer: false, hr: false, zwift: false };

function refreshDevices() {
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
    gfxLabel: DETAILED ? 'graphismes détaillés' : 'graphisme simple',
  });
  refreshHwTest();
  const verb = { rower: 'Rame', cross: 'Pédale sur l’elliptique' }[devices.machineKind] || 'Pédale';
  $('modeHint').textContent = t.connected
    ? `${t.name} fournit la puissance. ${verb} pour avancer !`
    : TOUCH
      ? 'Sans home trainer : maintiens le bouton « Pédaler » à l’écran (250 W simulés).'
      : 'Sans home trainer : maintiens la flèche ↑ pour pédaler (250 W simulés).';
}
devices.addEventListener('change', refreshDevices);

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
$('replay').addEventListener('click', () => (mode === 'row' ? startRowing(rowing.distance) : startRace()));
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
  $('hwHint').textContent = hw.hint;
  $('connectDemoCross').hidden = !(DEMO && hwId === 'technogym');
  $('zwiftRow').hidden = hwId !== 'zwift';
  for (const card of document.querySelectorAll('[data-connect]')) card.setAttribute('aria-current', String(card.dataset.connect === hwId));
}
for (const card of document.querySelectorAll('[data-connect]')) {
  card.addEventListener('click', () => {
    hwId = card.dataset.connect;
    savePref(HW_KEY, hwId);
    applyHardware();
    refreshDevices();
    showLog();
    menu.open('connectPanel', card);
  });
}
applyHardware();
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
for (const btn of document.querySelectorAll('.seg-btn[data-steer]')) {
  btn.setAttribute('aria-pressed', String(btn.dataset.steer === steerPref));
  btn.addEventListener('click', () => {
    steerPref = btn.dataset.steer;
    savePref(STEER_KEY, steerPref);
    for (const b of document.querySelectorAll('.seg-btn[data-steer]')) b.setAttribute('aria-pressed', String(b === btn));
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
    race.useItem(race.player);
  } else if (code === 'Enter' || code === 'NumpadEnter') {
    if (state === 'paused') resume();
    else if (state === 'end') (mode === 'row' ? startRowing(rowing.distance) : startRace());
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
  const pedaling = keys.has('ArrowUp') && !devices.trainerActive && state !== 'paused';
  const maxPower = mode === 'row' ? SIM_ROW.power : SIM.power;
  if (pedaling) {
    sim.power = Math.min(maxPower, sim.power + SIM.rise * dt);
    sim.cadence = Math.min(SIM.cadence, sim.cadence + 200 * dt);
  } else {
    sim.power = Math.max(0, sim.power - SIM.fall * dt);
    sim.cadence = Math.max(0, sim.cadence - SIM.cadenceFall * dt);
  }
}

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
  return {
    auto: autoSteer(),
    power: trainer ? devices.power : sim.power,
    cadence: trainer ? devices.cadence : sim.cadence,
    steer: (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0),
    drift: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  };
}

// Pente envoyée au trainer : terrain + effets des objets, puis vitesses virtuelles.
function updateGrade() {
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
  feltGrade = gears.effectiveGrade(terrain + effects);
  if (lastSentGrade === null || Math.abs(feltGrade - lastSentGrade) >= 0.1) {
    lastSentGrade = feltGrade;
    devices.sendGrade(feltGrade, terrain + effects);
  }
  return terrain;
}

function syncScene(dt) {
  const t = race.time;
  for (const [r, m] of models) {
    const f = track.frame(r.s, r.lateral, tmpFrame);
    m.group.position.set(f.x, f.y + 0.03, f.z);
    // Le vélo pointe dans sa direction réelle (cap par rapport à la route) et s'incline dans les virages.
    const yaw = Math.atan2(f.tx, f.tz) - (r.heading || 0);
    const pitch = -Math.atan(f.grade / 100);
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
    m.group.rotation.set(pitch, yaw, roll, 'YXZ');
    if (m.setMotion) m.setMotion(r.v, f.grade, r.power); // position aéro dans les descentes rapides
    m.setCrank(r.crank);
    m.spinWheels((r.v * dt) / 0.34);
    // Un adversaire collé à la caméra masquerait la route : on le cache, ainsi que son étiquette.
    const camDist = camera.position.distanceTo(m.group.position);
    m.group.visible = r.isPlayer || camDist > 3.5 || state === 'home';
    if (m.label) m.label.visible = camDist > 7;
  }
  const now = performance.now() / 1000;
  race.boxes.forEach((b, i) => {
    const mesh = boxMeshes[i];
    mesh.visible = t >= b.respawnAt;
    mesh.rotation.y = now * 1.2 + i;
    mesh.position.y = mesh.userData.baseY + Math.sin(now * 2 + i) * 0.12;
  });
}

function cameraTarget(outPos, outLook) {
  const p = race.player;
  // La caméra suit en partie la direction du vélo : on voit le coureur tourner, pas glisser.
  const side = Math.sin(p.heading || 0);
  const back = track.frame(p.s - 6.5, p.lateral * 0.85 - side * 3.2, tmpFrame);
  outPos.set(back.x, back.y + 2.7, back.z);
  const ahead = track.frame(p.s + 7, p.lateral * 0.6 + side * 3.5, tmpFrame2);
  outLook.set(ahead.x, ahead.y + 1.0, ahead.z);
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
  sun.target.position.set(f.x, f.y, f.z);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 220);
}

let lastFrame = performance.now();
function frame(nowMs) {
  if (!governor.allow(nowMs)) {
    requestAnimationFrame(frame);
    return;
  }
  if (fpsMeter && nowMs - (frame.lastFps || 0) > 500) {
    frame.lastFps = nowMs;
    fpsMeter.textContent = `${Math.round(governor.fps)} i/s · résolution ${Math.round(governor.scale * 100)} %`;
  }
  const dt = Math.min(0.1, Math.max(0, (nowMs - lastFrame) / 1000));
  lastFrame = nowMs;
  updateSim(dt);
  if (mode === 'row') {
    frameRowing(dt, nowMs);
    if (post) post.composer.render();
    else renderer.render(scene, camera);
    requestAnimationFrame(frame);
    return;
  }
  if (state === 'race' || state === 'end') {
    race.update(dt, playerInput());
    if (race.time < 0) hud.countdown(String(Math.ceil(-race.time)));
  }
  syncScene(state === 'paused' ? 0 : dt);
  const terrain = updateGrade();
  updateCamera(dt, nowMs);
  updateSun();
  scenery.update(dt, camera);

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
        position: race.positionOf(p),
        total: race.racers.length,
        lap: race.lapOf(p),
        laps: race.laps,
        time: p.finishTime ?? race.time,
        item: p.item,
        turboLeft: p.turboUntil - race.time,
        slipLeft: p.slipUntil - race.time,
        draft: p.draft,
        offRoad: p.offRoad,
        surface: p.surface,
        autoSteer: autoSteer() && !keys.has('ArrowLeft') && !keys.has('ArrowRight'),
        keyboard: !devices.trainerActive,
        touch: TOUCH,
      },
      race,
      nowMs,
    );
  } else if (nowMs - (frame.lastHome || 0) > 300) {
    frame.lastHome = nowMs;
    refreshDevices();
  }
  if (post) post.composer.render();
  else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Accès de débogage (console, tests automatisés).
window.__mcw = {
  gfx: GFX,
  quality: QUALITY,
  renderer,
  get state() { return state; },
  get race() { return race; },
  governor,
  get mode() { return mode; },
  get rowing() { return rowing; },
  devices,
  gears,
  get track() { return track; },
  get courseId() { return courseId; },
  loadCourse,
  get feltGrade() { return feltGrade; },
};

renderCourses();
goHome();
window.__mcwStarted = true;
requestAnimationFrame(frame);
