// MyCycleWorld, prototype jouable : scène 3D, boucle de jeu, écrans, clavier/manettes, pente au trainer.
import * as THREE from 'three';
import { Track, buildScenery } from './track.js';
import { RiderModel, createItemBox, createBanana } from './models.js';
import { Race, ITEMS } from './race.js';
import { Devices, explainError } from './devices.js';
import { Hud, formatTime, ordinal } from './hud.js';
import { VirtualGears } from '../src/core/gears.js';
import { msToKmh } from '../src/core/physics.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const LAPS = Math.max(1, Math.min(10, parseInt(params.get('laps'), 10) || 3));

// Puissance simulée au clavier (sans home trainer).
const SIM = { power: 250, cadence: 90, rise: 900, fall: 140, cadenceFall: 70 };
const TURBO_GRADE = -5;
const BANANA_GRADE = 10;

// ---------- Scène ----------

const renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
const scene = new THREE.Scene();
const skyColor = new THREE.Color('#cfe6fb');
scene.background = skyColor;
scene.fog = new THREE.Fog(skyColor, 160, 1100);
const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 4000);
scene.add(new THREE.HemisphereLight('#dff1ff', '#55703a', 1.6));
const sun = new THREE.DirectionalLight('#fff3dc', 2.2);
sun.position.set(-300, 400, 200);
scene.add(sun);

const track = new Track();
const scenery = buildScenery(scene, track);
const hud = new Hud(track);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- État du jeu ----------

const devices = new Devices({ demo: DEMO });
const gears = new VirtualGears();
const keys = new Set();
const sim = { power: 0, cadence: 0 };
let state = 'home'; // home | race | paused | end
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
  raceObjects.clear();
  bananaMeshes.clear();
  models = new Map();
  race = new Race(track, { laps: LAPS });
  for (const r of race.racers) {
    const m = new RiderModel({ jersey: r.color, bike: r.bike, helmet: r.helmet, name: r.isPlayer ? '' : r.name });
    models.set(r, m);
    raceObjects.add(m.group);
  }
  boxMeshes = race.boxes.map((b) => {
    const mesh = createItemBox();
    const f = track.frame(b.s, b.lateral);
    mesh.position.set(f.x, f.y + 1.0, f.z);
    mesh.userData.baseY = f.y + 1.0;
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
  hud.show(state === 'race' || state === 'paused' || state === 'end');
}

function goHome() {
  clearTimeout(endTimer);
  state = 'home';
  setupRace();
  show('home');
  refreshDevices();
}

function startRace() {
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
  if (state === 'paused') {
    endTimer = setTimeout(showEnd, 500);
    return;
  }
  if (state !== 'race') return;
  state = 'end';
  const rows = race.ranking().map((r) => ({ r, ...race.estimatedTime(r) }));
  rows.sort((a, b) => (a.estimated === b.estimated ? a.time - b.time : a.estimated ? 1 : -1));
  const best = rows[0].time;
  const me = rows.findIndex((x) => x.r.isPlayer) + 1;
  $('endTitle').textContent = me === 1 ? 'Victoire ! 🏆' : `Arrivée : ${ordinal(me)} sur ${rows.length}`;
  $('results').innerHTML =
    '<tr><th>#</th><th>Coureur</th><th>Temps</th><th>Écart</th></tr>' +
    rows
      .map((x, i) => {
        const gap = i === 0 ? '' : `+${formatTime(x.time - best)}`;
        return `<tr class="${x.r.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><span class="dot" style="background:${x.r.color}"></span>${x.r.name}</td><td>${x.estimated ? '≈ ' : ''}${formatTime(x.time)}</td><td>${gap}</td></tr>`;
      })
      .join('');
  $('endNote').textContent = rows.some((x) => x.estimated) ? '≈ : temps estimé, le coureur n’avait pas encore franchi la ligne.' : '';
  show('end');
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
      setStatus('trainerStatus', `${t.name}${t.canControl ? ' · pente pilotée' : ' · lecture seule'}${live}`, t.canControl ? 'ok' : 'warn');
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
  $('modeHint').textContent = t.connected
    ? 'Le home trainer fournit la puissance. Pédale pour avancer !'
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

$('connectTrainer').addEventListener('click', () => connect('trainer', 'trainerStatus', () => devices.connectTrainer()));
$('connectHr').addEventListener('click', () => connect('hr', 'hrStatus', () => devices.connectHeartRate()));
$('connectZwift').addEventListener('click', () => connect('zwift', 'zwiftStatus', () => devices.connectController()));
$('play').addEventListener('click', startRace);
$('resume').addEventListener('click', resume);
$('quit').addEventListener('click', goHome);
$('replay').addEventListener('click', startRace);
$('backHome').addEventListener('click', goHome);

if (DEMO) {
  $('demoBanner').hidden = false;
  $('demoLink').textContent = 'Vrai Bluetooth';
  $('demoLink').href = './';
  $('diagLink').href = '../diag/?demo=1';
} else if (!devices.bluetoothAvailable) {
  $('btWarning').hidden = false;
}

// ---------- Clavier (et manettes, via KeyEmitter) ----------

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

window.addEventListener('keydown', (e) => {
  // Les manettes simulées appuient au hasard : en démo, on ignore leur pause et leur validation.
  if (DEMO && e.fromController && (e.code === 'Escape' || e.code === 'Enter')) return;
  if (PREVENT.has(e.code) && state !== 'home') e.preventDefault();
  keys.add(e.code);
  const code = e.code;
  if (code === 'Minus' || code === 'NumpadSubtract') return void gears.down();
  if (code === 'Equal' || code === 'NumpadAdd') return void gears.up();
  if (e.repeat) return;
  if (code === 'Escape') {
    if (state === 'race') pause();
    else if (state === 'paused') resume();
    else if (state === 'end') goHome();
  } else if (code === 'Space' && state === 'race') {
    race.useItem(race.player);
  } else if (code === 'Enter' || code === 'NumpadEnter') {
    if (state === 'paused') resume();
    else if (state === 'end') startRace();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

gears.addEventListener('change', () => {
  if (state === 'race') hud.flash(`Vitesse ${gears.gear} / ${gears.count}`, 600);
});

// ---------- Boucle ----------

function updateSim(dt) {
  const pedaling = keys.has('ArrowUp') && !devices.trainerActive && state !== 'paused';
  if (pedaling) {
    sim.power = Math.min(SIM.power, sim.power + SIM.rise * dt);
    sim.cadence = Math.min(SIM.cadence, sim.cadence + 200 * dt);
  } else {
    sim.power = Math.max(0, sim.power - SIM.fall * dt);
    sim.cadence = Math.max(0, sim.cadence - SIM.cadenceFall * dt);
  }
}

function playerInput() {
  const trainer = devices.trainerActive;
  return {
    power: trainer ? devices.power : sim.power,
    cadence: trainer ? devices.cadence : sim.cadence,
    steer: (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0),
    drift: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  };
}

// Pente envoyée au trainer : terrain + effets des objets, puis vitesses virtuelles.
function updateGrade() {
  const p = race.player;
  const t = race.time;
  const terrain = state === 'race' || state === 'end' ? track.gradeAt(p.s) : 0;
  const effects = state === 'race' ? (p.turbo(t) ? TURBO_GRADE : 0) + (p.slipping(t) ? BANANA_GRADE : 0) : 0;
  feltGrade = gears.effectiveGrade(terrain + effects);
  if (lastSentGrade === null || Math.abs(feltGrade - lastSentGrade) >= 0.1) {
    lastSentGrade = feltGrade;
    devices.sendGrade(feltGrade);
  }
  return terrain;
}

function syncScene(dt) {
  const t = race.time;
  for (const [r, m] of models) {
    const f = track.frame(r.s, r.lateral, tmpFrame);
    m.group.position.set(f.x, f.y + 0.03, f.z);
    const yaw = Math.atan2(f.tx, f.tz);
    const pitch = -Math.atan(f.grade / 100);
    const steer = r.isPlayer ? playerInput().steer : Math.sign(r.targetLateral - r.lateral) * 0.5;
    const roll = r.slipping(t) ? Math.sin(t * 25) * 0.25 : -steer * 0.12;
    m.group.rotation.set(pitch, yaw, roll, 'YXZ');
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
    mesh.rotation.y = now * 1.4 + i;
    mesh.rotation.x = 0.4;
    mesh.position.y = mesh.userData.baseY + Math.sin(now * 2 + i) * 0.12;
  });
}

function cameraTarget(outPos, outLook) {
  const p = race.player;
  const back = track.frame(p.s - 6.5, p.lateral * 0.85, tmpFrame);
  outPos.set(back.x, back.y + 2.7, back.z);
  const ahead = track.frame(p.s + 7, p.lateral * 0.6, tmpFrame2);
  outLook.set(ahead.x, ahead.y + 1.0, ahead.z);
}

function snapCamera() {
  if (state === 'race') cameraTarget(camPos, camLook);
}

const desiredPos = new THREE.Vector3();
const desiredLook = new THREE.Vector3();

function updateCamera(dt, nowMs) {
  if (state === 'home') {
    // Aperçu : la caméra tourne lentement autour de la grille de départ.
    const c = track.frame(-8, 0, tmpFrame);
    const a = nowMs * 0.00012;
    camera.position.set(c.x + Math.cos(a) * 16, c.y + 5, c.z + Math.sin(a) * 16);
    camera.lookAt(c.x, c.y + 1, c.z);
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
}

let lastFrame = performance.now();
function frame(nowMs) {
  const dt = Math.min(0.1, Math.max(0, (nowMs - lastFrame) / 1000));
  lastFrame = nowMs;
  updateSim(dt);
  if (state === 'race' || state === 'end') {
    race.update(dt, playerInput());
    if (race.time < 0) hud.countdown(String(Math.ceil(-race.time)));
  }
  syncScene(state === 'paused' ? 0 : dt);
  const terrain = updateGrade();
  updateCamera(dt, nowMs);
  scenery.sky.position.copy(camera.position);

  if (state !== 'home') {
    const p = race.player;
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
        keyboard: !devices.trainerActive,
      },
      race,
      nowMs,
    );
  } else if (nowMs - (frame.lastHome || 0) > 300) {
    frame.lastHome = nowMs;
    refreshDevices();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Accès de débogage (console, tests automatisés).
window.__mcw = {
  renderer,
  get state() { return state; },
  get race() { return race; },
  devices,
  gears,
  track,
  get feltGrade() { return feltGrade; },
};

goHome();
window.__mcwStarted = true;
requestAnimationFrame(frame);
