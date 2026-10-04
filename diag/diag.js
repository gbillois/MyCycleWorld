import { Trainer } from '../src/ble/trainer.js';
import { HeartRateMonitor } from '../src/ble/heart-rate.js';
import { ZwiftController, BUTTONS } from '../src/ble/zwift.js';
import { bluetoothSupport, realRequestDevice } from '../src/ble/gatt.js';
import { createMockRequestDevice } from '../src/ble/mock.js';
import { onLog, formatEntry, logText, info, warn, error } from '../src/ble/log.js';
import { VirtualGears } from '../src/core/gears.js';
import { KeyEmitter, KEYS, ACTIONS, DEFAULT_KEYMAP, loadKeymap, saveKeymap } from '../src/core/keymap.js';

const $ = (id) => document.getElementById(id);
const DEMO = new URLSearchParams(location.search).has('demo');
const requestDevice = DEMO ? createMockRequestDevice() : realRequestDevice;

// ---------- Bilan ----------

const CHECKS = [
  ['browser', 'Navigateur compatible Bluetooth'],
  ['trainer', 'Home trainer connecté'],
  ['power', 'Puissance reçue'],
  ['cadence', 'Cadence reçue'],
  ['control', 'Le trainer accepte les changements de pente'],
  ['shifting', 'Vitesses virtuelles appliquées au trainer'],
  ['hr', 'Fréquence cardiaque reçue'],
  ['zwiftL', 'Manette Zwift Play gauche'],
  ['zwiftR', 'Manette Zwift Play droite'],
  ['buttons', 'Boutons des manettes reçus'],
  ['paddle', 'Leviers (palettes) reçus'],
  ['keys', 'Boutons transformés en touches clavier'],
];
const checkState = {};

function renderChecklist() {
  $('checklist').innerHTML = CHECKS.map(([id, label]) => {
    const s = checkState[id] || { state: 'todo', detail: '' };
    const icon = { ok: '✓', warn: '!', bad: '✕', todo: '' }[s.state];
    return `<li class="${s.state}"><span class="dot">${icon}</span><span>${label}${s.detail ? `<span class="detail">${escapeHtml(s.detail)}</span>` : ''}</span></li>`;
  }).join('');
}

function setCheck(id, state, detail = '') {
  const prev = checkState[id];
  if (prev && prev.state === 'ok' && state !== 'ok' && state !== 'bad') return; // un succès reste acquis
  if (prev && prev.state === state && prev.detail === detail) return;
  checkState[id] = { state, detail };
  renderChecklist();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function toast(msg, ms = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

function pill(el, text, cls = '') {
  el.textContent = text;
  el.className = `pill ${cls}`;
}

function explainError(e) {
  if (e?.name === 'NotFoundError' && /cancel/i.test(e.message)) return 'Sélection annulée.';
  if (e?.name === 'NotFoundError') return `Aucun appareil choisi (${e.message}).`;
  if (e?.name === 'SecurityError') return 'Bluetooth bloqué par le navigateur (page non sécurisée ou permission refusée).';
  if (e?.name === 'NetworkError') return `Connexion impossible : l'appareil est peut-être déjà connecté à une autre appli (Zwift ?). ${e.message}`;
  return e?.message || String(e);
}

// ---------- Journal ----------

const logEl = $('log');
let showDebug = false;
const logLines = [];
onLog((entry) => {
  logLines.push(entry);
  if (entry.level === 'debug' && !showDebug) return;
  appendLog(entry);
});
function appendLog(entry) {
  const atBottom = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 20;
  const span = document.createElement('span');
  span.className = entry.level;
  span.textContent = formatEntry(entry) + '\n';
  logEl.appendChild(span);
  while (logEl.childNodes.length > 1500) logEl.removeChild(logEl.firstChild);
  if (atBottom) logEl.scrollTop = logEl.scrollHeight;
}
$('showDebug').addEventListener('change', (e) => {
  showDebug = e.target.checked;
  logEl.textContent = '';
  logLines.filter((l) => showDebug || l.level !== 'debug').slice(-1500).forEach(appendLog);
});
$('clearLogView').addEventListener('click', () => (logEl.textContent = ''));
$('downloadLog').addEventListener('click', () => {
  const blob = new Blob([buildReport()], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mycycleworld-diag-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- Compatibilité ----------

async function checkBrowser() {
  if (DEMO) {
    $('demoBanner').hidden = false;
    $('demoLink').textContent = 'Vrai Bluetooth';
    $('demoLink').href = './';
    setCheck('browser', 'ok', 'mode démo');
    info('diag', 'Mode démo actif : appareils simulés');
    return;
  }
  const s = await bluetoothSupport();
  info('diag', `Navigateur : ${navigator.userAgent}`);
  info('diag', `Web Bluetooth : ${s.api ? 'oui' : 'non'} · contexte sécurisé : ${s.secure ? 'oui' : 'non'} · adaptateur : ${s.available === null ? '?' : s.available ? 'présent' : 'absent'}`);
  let msg = '';
  if (!s.secure) msg = 'La page doit être ouverte en https (ou sur localhost) pour accéder au Bluetooth.';
  else if (!s.api) msg = 'Ce navigateur ne gère pas Web Bluetooth. Ouvre la page dans Chrome ou Edge (pas Firefox, pas Safari, pas iPhone).';
  else if (s.available === false) msg = 'Aucun adaptateur Bluetooth détecté ou Bluetooth désactivé sur cet ordinateur.';
  if (msg) {
    $('compatBanner').textContent = msg;
    $('compatBanner').hidden = false;
    setCheck('browser', 'bad', msg);
  } else setCheck('browser', 'ok', s.available === null ? 'adaptateur non vérifiable' : '');
}

// ---------- Home trainer ----------

const trainer = new Trainer({ requestDevice });
const gears = new VirtualGears();
let terrainGrade = 0;
let ergMode = false;
let bananaUntil = 0;
const powerHistory = [];
let lastSentGrade = null;
let gearChangedSinceOk = false;

$('trainerConnect').addEventListener('click', async () => {
  pill($('trainerStatus'), 'connexion…', 'warn');
  try {
    await trainer.connect({ acceptAll: $('trainerAll').checked });
  } catch (e) {
    const msg = explainError(e);
    error('trainer', msg);
    pill($('trainerStatus'), 'échec', 'bad');
    toast(msg, 4000);
    if (!/annulée/.test(msg)) setCheck('trainer', 'bad', msg);
  }
});
$('trainerReconnect').addEventListener('click', async () => {
  try {
    pill($('trainerStatus'), 'reconnexion…', 'warn');
    await trainer.reconnect();
  } catch (e) {
    error('trainer', explainError(e));
    pill($('trainerStatus'), 'échec', 'bad');
  }
});

trainer.addEventListener('connected', () => {
  pill($('trainerStatus'), 'connecté', 'ok');
  $('trainerReconnect').hidden = true;
  const di = trainer.deviceInfo || {};
  const parts = [trainer.name, di.manufacturer, di.model, di.firmware && `fw ${di.firmware}`].filter(Boolean);
  const ctrl = trainer.canControl
    ? trainer.features?.targets?.includes('simulation (pente)') ? 'pilotable (pente + ERG)' : 'pilotable (simulation non annoncée, on essaie quand même)'
    : 'lecture seule';
  $('trainerInfo').textContent = `${parts.join(' · ')} — ${ctrl}`;
  setCheck('trainer', 'ok', parts.join(' · '));
  if (!trainer.canControl) setCheck('control', 'bad', 'Pas de FTMS Control Point : résistance non pilotable');
  else applyGrade(true);
});
trainer.addEventListener('disconnected', () => {
  pill($('trainerStatus'), 'déconnecté', 'bad');
  $('trainerReconnect').hidden = false;
});
trainer.addEventListener('control-lost', () => toast('Le trainer signale que le contrôle a été pris par une autre appli.', 4000));

trainer.addEventListener('data', ({ detail: d }) => {
  const fmt = (v, digits = 0) => (v === null || v === undefined ? '--' : Number(v).toFixed(digits));
  $('mPower').textContent = fmt(d.power);
  $('mCadence').textContent = fmt(d.cadence);
  $('mSpeed').textContent = fmt(d.speed, 1);
  $('mHrTrainer').textContent = fmt(d.heartRate);
  $('srcPower').textContent = trainer.sources.power ? `(${trainer.sources.power})` : '';
  $('srcCadence').textContent = trainer.sources.cadence ? `(${trainer.sources.cadence})` : '';
  if (d.power > 0) setCheck('power', 'ok', `${d.power} W via ${trainer.sources.power}`);
  else if (d.power === 0) setCheck('power', 'warn', 'reçue mais 0 W : pédale un peu');
  if (d.cadence > 0) setCheck('cadence', 'ok', `${Math.round(d.cadence)} rpm via ${trainer.sources.cadence}`);
  else if (d.cadence === 0) setCheck('cadence', 'warn', 'reçue mais 0 rpm : pédale un peu');
  if (d.heartRate > 0 && !hr.connected) setCheck('hr', 'ok', `${d.heartRate} bpm via le trainer`);
  if (d.power !== null) powerHistory.push({ t: performance.now(), w: d.power });
});

trainer.addEventListener('cp-response', ({ detail }) => {
  if (detail.op !== 0x11) return;
  if (detail.ok) {
    setCheck('control', 'ok', `dernière pente : ${lastSentGrade} %`);
    $('cpResult').textContent = `✓ accepté par le trainer (${lastSentGrade} %)`;
    if (gearChangedSinceOk) setCheck('shifting', 'ok', `vitesse ${gears.gear} → pente ${lastSentGrade} %`);
  } else {
    setCheck('control', 'bad', `refusé (code ${detail.result})`);
    $('cpResult').textContent = `✕ refusé par le trainer (code ${detail.result})`;
  }
});

function currentTargetGrade() {
  const banana = performance.now() < bananaUntil ? 10 : 0;
  return gears.effectiveGrade(terrainGrade + banana);
}

function applyGrade(force = false) {
  const g = currentTargetGrade();
  $('sentGrade').textContent = ergMode ? 'mode ERG' : `${g.toFixed(1)} %`;
  if (ergMode || !trainer.canControl) return;
  if (!force && g === lastSentGrade) return;
  lastSentGrade = g;
  trainer.setGradeThrottled(g);
}

$('terrain').addEventListener('input', (e) => {
  terrainGrade = Number(e.target.value);
  $('terrainVal').textContent = `${terrainGrade} %`;
  applyGrade();
});
$('gradePresets').addEventListener('click', (e) => {
  const g = e.target.dataset.grade;
  if (g === undefined) return;
  $('terrain').value = g;
  $('terrain').dispatchEvent(new Event('input'));
});
$('difficulty').addEventListener('input', (e) => {
  gears.difficulty = Number(e.target.value) / 100;
  $('difficultyVal').textContent = `${e.target.value} %`;
  applyGrade();
});
$('gearStep').addEventListener('change', (e) => {
  gears.stepPercent = Number(e.target.value);
  applyGrade();
});

function renderGears() {
  $('gearVal').textContent = gears.gear;
  $('gearBar').innerHTML = Array.from({ length: gears.count }, (_, i) => `<span class="${i < gears.gear ? 'on' : ''}"></span>`).join('');
}
gears.addEventListener('change', () => {
  renderGears();
  gearChangedSinceOk = true;
  info('vitesses', `Vitesse ${gears.gear}/${gears.count} → pente ressentie ${currentTargetGrade()} %`);
  if (!trainer.canControl) setCheck('shifting', 'warn', `vitesse ${gears.gear} (trainer non pilotable, rien envoyé)`);
  applyGrade();
});
$('gearDown').addEventListener('click', () => gears.down());
$('gearUp').addEventListener('click', () => gears.up());

$('bananaTest').addEventListener('click', () => {
  if (!trainer.canControl) return toast('Connecte d’abord un home trainer pilotable.');
  bananaUntil = performance.now() + 3000;
  info('diag', '🍌 Peau de banane ! +10 % pendant 3 s');
  applyGrade();
  setTimeout(() => applyGrade(), 3050);
});

$('ergOn').addEventListener('click', async () => {
  if (!trainer.canControl) return toast('Connecte d’abord un home trainer pilotable.');
  const w = Number($('ergWatts').value);
  try {
    const r = await trainer.setTargetPower(w);
    if (r.ok) {
      ergMode = true;
      $('ergOn').hidden = true;
      $('ergOff').hidden = false;
      info('diag', `Mode ERG : ${w} W`);
      applyGrade();
    } else toast(`ERG refusé (code ${r.result})`);
  } catch (e) {
    error('trainer', explainError(e));
  }
});
$('ergOff').addEventListener('click', () => {
  ergMode = false;
  $('ergOn').hidden = false;
  $('ergOff').hidden = true;
  info('diag', 'Retour en mode pente');
  applyGrade(true);
});

// Courbe de puissance (60 s).
function drawPowerChart() {
  const c = $('powerChart');
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight || 70;
  if (c.width !== w * dpr) {
    c.width = w * dpr;
    c.height = h * dpr;
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const now = performance.now();
  while (powerHistory.length && now - powerHistory[0].t > 60000) powerHistory.shift();
  if (powerHistory.length < 2) return;
  const max = Math.max(200, ...powerHistory.map((p) => p.w)) * 1.1;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  ctx.beginPath();
  powerHistory.forEach((p, i) => {
    const x = w - ((now - p.t) / 60000) * w;
    const y = h - (p.w / max) * (h - 6) - 3;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ---------- Ceinture cardio ----------

const hr = new HeartRateMonitor({ requestDevice });
$('hrConnect').addEventListener('click', async () => {
  pill($('hrStatus'), 'connexion…', 'warn');
  try {
    await hr.connect();
  } catch (e) {
    const msg = explainError(e);
    error('cardio', msg);
    pill($('hrStatus'), 'échec', 'bad');
    toast(msg, 4000);
  }
});
$('hrReconnect').addEventListener('click', async () => {
  try {
    await hr.reconnect();
  } catch (e) {
    error('cardio', explainError(e));
  }
});
hr.addEventListener('connected', () => {
  pill($('hrStatus'), 'connectée', 'ok');
  $('hrReconnect').hidden = true;
  $('hrInfo').textContent = `${hr.name}${hr.battery !== null ? ` · batterie ${hr.battery} %` : ''}`;
});
hr.addEventListener('disconnected', () => {
  pill($('hrStatus'), 'déconnectée', 'bad');
  $('hrReconnect').hidden = false;
});
hr.addEventListener('data', ({ detail }) => {
  $('mHr').textContent = detail.bpm || '--';
  $('hrContact').textContent = detail.contact === null ? '' : detail.contact ? 'contact OK' : 'pas de contact peau';
  if (detail.bpm > 0) setCheck('hr', 'ok', `${detail.bpm} bpm via ${hr.name}`);
  else setCheck('hr', 'warn', 'reçue mais 0 bpm (ceinture mal mise ?)');
});

// ---------- Manettes Zwift ----------

const controllers = [];
const keyEmitter = new KeyEmitter(loadKeymap());

$('zwiftConnect').addEventListener('click', async () => {
  const c = new ZwiftController({ requestDevice });
  c.addEventListener('selected', () => addController(c));
  try {
    await c.connect({ acceptAll: $('zwiftAll').checked });
  } catch (e) {
    const msg = explainError(e);
    error('zwift', msg);
    toast(msg, 5000);
    if (c.device) addController(c, msg);
  }
});

function addController(c, failMsg) {
  if (controllers.includes(c)) return;
  controllers.push(c);
  const el = document.createElement('div');
  el.className = 'ctrl';
  $('controllers').appendChild(el);
  const render = () => {
    const side = c.side === 'L' ? 'gauche' : c.side === 'R' ? 'droite' : 'côté ?';
    const status = !c.connected ? '<span class="pill bad">déconnectée</span>'
      : c.handshake ? '<span class="pill ok">RideOn ✓</span>' : '<span class="pill warn">en attente RideOn</span>';
    el.innerHTML = `<strong>${escapeHtml(c.name)} (${side})</strong>${status}
      <span class="muted">${c.protocol || 'protocole ?'}</span>
      <span class="muted">${c.deviceInfo?.firmware ? 'fw ' + escapeHtml(c.deviceInfo.firmware) : ''}</span>
      <span class="muted">${c.battery !== null ? '🔋 ' + c.battery + ' %' : ''}</span>
      <button class="btn ghost small-btn" data-act="vibrate">Vibrer</button>
      <button class="btn ghost small-btn" data-act="reconnect" ${c.connected ? 'hidden' : ''}>Reconnecter</button>
      ${failMsg && !c.connected ? `<span class="small" style="flex-basis:100%;color:var(--bad)">${escapeHtml(failMsg)}</span>` : ''}`;
    updateZwiftChecks();
  };
  el.addEventListener('click', async (e) => {
    const act = e.target.dataset.act;
    try {
      if (act === 'vibrate') await c.vibrate();
      if (act === 'reconnect') {
        failMsg = '';
        await c.reconnect();
      }
    } catch (err) {
      failMsg = explainError(err);
      error(c.src, failMsg);
      render();
    }
  });
  ['connected', 'disconnected', 'handshake', 'side', 'battery'].forEach((ev) => c.addEventListener(ev, render));
  c.addEventListener('buttons', render);
  c.addEventListener('buttons', renderLeds);
  c.addEventListener('analog', renderAnalog);
  c.addEventListener('buttondown', (e) => {
    setCheck('buttons', 'ok', `dernier : ${BUTTONS[e.detail] || e.detail}`);
    if (e.detail.endsWith('PADDLE')) setCheck('paddle', 'ok', `${BUTTONS[e.detail]}`);
  });
  keyEmitter.attach(c);
  render();
}

function updateZwiftChecks() {
  const ok = controllers.filter((c) => c.connected && c.handshake);
  pill($('zwiftStatus'), `${ok.length} / 2`, ok.length === 2 ? 'ok' : ok.length ? 'warn' : '');
  for (const side of ['L', 'R']) {
    const c = controllers.find((x) => x.side === side);
    const id = side === 'L' ? 'zwiftL' : 'zwiftR';
    if (c && c.connected && c.handshake) setCheck(id, 'ok', `${c.protocol || ''}${c.deviceInfo?.firmware ? ' · fw ' + c.deviceInfo.firmware : ''}${c.battery !== null ? ' · ' + c.battery + ' %' : ''}`);
  }
  const unknown = controllers.filter((c) => c.connected && c.handshake && !c.side);
  if (unknown.length) {
    for (const id of ['zwiftL', 'zwiftR']) {
      if (checkState[id]?.state !== 'ok') setCheck(id, 'warn', 'connectée : appuie sur un bouton pour savoir de quel côté');
    }
  }
  const failing = controllers.filter((c) => c.connected && !c.handshake);
  if (failing.length && !ok.length) setCheck('zwiftL', 'warn', 'connectée mais pas de réponse RideOn pour l’instant');
}

function renderLeds() {
  const all = new Set(controllers.flatMap((c) => [...c.pressed]));
  document.querySelectorAll('.btn-led').forEach((el) => el.classList.toggle('on', all.has(el.dataset.b)));
}

function renderAnalog() {
  const a = {};
  controllers.forEach((c) => Object.assign(a, c.analog));
  for (const s of ['L', 'R']) {
    const v = Math.max(-100, Math.min(100, a[s] || 0));
    const fill = $(`analog${s}`);
    fill.style.left = v >= 0 ? '50%' : `${50 + v / 2}%`;
    fill.style.width = `${Math.abs(v) / 2}%`;
    $(`analog${s}Val`).textContent = `levier : ${v}`;
  }
}

// ---------- Clavier (vrai clavier + manettes) ----------

const held = new Set();
function isTyping(e) {
  const t = e.target;
  return !e.fromController && t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
}
window.addEventListener('keydown', (e) => {
  if (isTyping(e)) return;
  if (e.fromController) {
    setCheck('keys', 'ok', `dernière : ${e.code}`);
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  }
  showKey(e);
  if (e.repeat) return;
  held.add(e.code);
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') gears.down();
  if (e.code === 'Equal' || e.code === 'NumpadAdd') gears.up();
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

function showKey(e) {
  if (e.repeat) return;
  const box = $('lastKeys');
  if (box.querySelector('.muted')) box.textContent = '';
  const k = document.createElement('span');
  k.className = `k${e.fromController ? ' pad' : ''}`;
  k.textContent = `${e.fromController ? '🎮 ' : ''}${KEYS[e.code]?.label || e.key}${ACTIONS[e.code] ? ' · ' + ACTIONS[e.code] : ''}`;
  box.prepend(k);
  while (box.children.length > 8) box.lastChild.remove();
}

function renderKeymap() {
  const options = Object.entries(KEYS)
    .map(([code, k]) => `<option value="${code}">${k.label}${ACTIONS[code] ? ' — ' + ACTIONS[code] : ''}</option>`)
    .join('');
  $('keymapTable').innerHTML = Object.entries(BUTTONS)
    .map(([b, label]) => `<tr><td>${label}</td><td><select data-b="${b}">${options}</select></td></tr>`)
    .join('');
  $('keymapTable').querySelectorAll('select').forEach((s) => (s.value = keyEmitter.map[s.dataset.b] || 'none'));
}
$('keymapTable').addEventListener('change', (e) => {
  keyEmitter.map[e.target.dataset.b] = e.target.value;
  saveKeymap(keyEmitter.map);
});
$('keymapReset').addEventListener('click', () => {
  keyEmitter.map = { ...DEFAULT_KEYMAP };
  saveKeymap(keyEmitter.map);
  renderKeymap();
  toast('Association par défaut rétablie');
});

// Mini route : le point avance selon les watts et se dirige avec ◀ ▶.
const road = { x: 0.5, dist: 0 };
let lastFrame = performance.now();
function drawRoad(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (held.has('ArrowLeft')) road.x -= dt * 0.6;
  if (held.has('ArrowRight')) road.x += dt * 0.6;
  road.x = Math.max(0.08, Math.min(0.92, road.x));
  const watts = trainer.data.power || 0;
  road.dist += dt * (40 + watts) * 0.6;

  const c = $('miniRoad');
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight || 120;
  if (c.width !== w * dpr) {
    c.width = w * dpr;
    c.height = h * dpr;
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement);
  ctx.fillStyle = '#5aa35a';
  ctx.fillRect(0, 0, w, h);
  const left = w * 0.05;
  const width = w * 0.9;
  ctx.fillStyle = css.getPropertyValue('--road').trim();
  ctx.fillRect(left, 0, width, h);
  ctx.strokeStyle = '#ffffff';
  ctx.setLineDash([18, 18]);
  ctx.lineDashOffset = road.dist % 36;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w / 2, h);
  ctx.lineTo(w / 2, 0);
  ctx.stroke();
  ctx.setLineDash([]);
  const px = left + road.x * width;
  ctx.fillStyle = css.getPropertyValue('--accent').trim();
  ctx.beginPath();
  ctx.arc(px, h * 0.7, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '12px system-ui';
  ctx.fillText(`${Math.round(watts)} W · vitesse ${gears.gear}`, left + 8, 18);

  drawPowerChart();
  if (bananaUntil && now > bananaUntil + 100) bananaUntil = 0;
  requestAnimationFrame(drawRoad);
}

// ---------- Rapport ----------

function buildReport() {
  const lines = [];
  lines.push('=== MyCycleWorld · rapport de diagnostic ===');
  lines.push(`Date : ${new Date().toLocaleString('fr-FR')}`);
  lines.push(`Navigateur : ${navigator.userAgent}`);
  lines.push(`Mode : ${DEMO ? 'DÉMO (simulé)' : 'Bluetooth réel'}`);
  lines.push('');
  lines.push('--- Bilan ---');
  for (const [id, label] of CHECKS) {
    const s = checkState[id] || { state: 'todo', detail: '' };
    const icon = { ok: '[OK]  ', warn: '[~]   ', bad: '[ÉCHEC]', todo: '[--]  ' }[s.state];
    lines.push(`${icon} ${label}${s.detail ? ' : ' + s.detail : ''}`);
  }
  lines.push('');
  lines.push('--- Home trainer ---');
  lines.push(`Nom : ${trainer.device?.name || '-'} · infos : ${JSON.stringify(trainer.deviceInfo || {})}`);
  lines.push(`Mesures FTMS : ${trainer.features?.machine?.join(', ') || '-'}`);
  lines.push(`Consignes FTMS : ${trainer.features?.targets?.join(', ') || '-'}`);
  lines.push(`Plages : ${JSON.stringify(trainer.ranges)} · sources : ${JSON.stringify(trainer.sources)}`);
  lines.push('');
  lines.push('--- Manettes ---');
  if (!controllers.length) lines.push('aucune');
  controllers.forEach((c) => lines.push(`${c.name} · côté ${c.side || '?'} · ${c.protocol || 'protocole ?'} · RideOn ${c.handshake ? 'OK' : 'NON'} · infos ${JSON.stringify(c.deviceInfo || {})} · messages ${JSON.stringify(Object.fromEntries(Object.entries(c.counts).map(([k, v]) => ['0x' + Number(k).toString(16), v])))}`));
  lines.push('');
  lines.push('--- Journal complet ---');
  lines.push(logText());
  return lines.join('\n');
}

$('copyReport').addEventListener('click', async () => {
  const text = buildReport();
  try {
    await navigator.clipboard.writeText(text);
    toast('Rapport copié ! Colle-le dans un message.');
  } catch {
    $('downloadLog').click();
    toast('Copie impossible : le rapport a été téléchargé en fichier.');
  }
});

window.addEventListener('error', (e) => error('page', `${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => warn('page', `Promesse rejetée : ${e.reason?.message || e.reason}`));

// ---------- Démarrage ----------

renderChecklist();
renderGears();
renderKeymap();
checkBrowser();
requestAnimationFrame(drawRoad);
