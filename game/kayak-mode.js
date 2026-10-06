// Mode kayak cross : relie la course (src/core/kayak.js), le décor de la rivière (kayak-scene.js), les kayaks
// (kayak.js), les boîtes à objets et les tourbillons, la caméra et l'affichage tête haute (#kayakHud).
// main.js garde la main sur les écrans, le matériel et la boucle ; ce module ne fait qu'une course à la fois.
import * as THREE from 'three';
import { River, KayakRace, KAYAK, KAYAK_ITEMS } from '../src/core/kayak.js';
import { riverById } from './rivers.js';
import { buildKayakWorld } from './kayak-scene.js';
import { Kayak } from './kayak.js';
import { createItemBox } from './models.js';
import { disposeTree } from './scenery.js';
import { followSun } from './atmosphere.js';
import { formatTime, ordinal, ordinalHtml } from './hud.js';

const $ = (id) => document.getElementById(id);
const WHIRLS = 8; // tourbillons affichés au plus en même temps

// Tourbillon : disque en spirale (additif) qui tourne sur l'eau. Ressources partagées entre les disques.
let whirlRes = null;
function whirlResources() {
  if (whirlRes) return whirlRes;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.translate(S / 2, S / 2);
  for (let arm = 0; arm < 3; arm++) {
    ctx.beginPath();
    for (let k = 0; k <= 60; k++) {
      const t = k / 60;
      const a = arm * ((Math.PI * 2) / 3) + t * Math.PI * 3.2;
      const r = 8 + t * (S / 2 - 14);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(0, 0, 4, 0, 0, S / 2);
  g.addColorStop(0, 'rgba(40,110,160,0.9)');
  g.addColorStop(0.5, 'rgba(120,200,255,0.35)');
  g.addColorStop(1, 'rgba(120,200,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-S / 2, -S / 2, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.dispose = () => {};
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: '#bfe8ff' });
  mat.dispose = () => {};
  const geo = new THREE.CircleGeometry(1.9, 32).rotateX(-Math.PI / 2);
  geo.dispose = () => {};
  whirlRes = { mat, geo };
  return whirlRes;
}

export class KayakMode {
  constructor({ scene, raceObjects, camera, sun, renderer, quality, detailed, hud, devices }) {
    Object.assign(this, { scene, raceObjects, camera, sun, renderer, quality, detailed, hud, devices });
    this.riverId = null;
    this.river = null;
    this.world = null;
    this.race = null;
    this.boats = new Map();
    this.boxMeshes = [];
    this.whirlMeshes = [];
    this.whirlOf = new Map();
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.desiredPos = new THREE.Vector3();
    this.desiredLook = new THREE.Vector3();
    this.f1 = {};
    this.f2 = {};
    this.tmp = new THREE.Vector3();
    this.shake = 0;
    this.camRoll = 0;
    this.onFinish = null;
    this.hudState = {};
    this.lastHud = 0;
  }

  // Construit (ou reconstruit) la rivière choisie.
  load(riverId) {
    const def = riverById(riverId);
    if (this.world && this.riverId === def.id) return;
    this.disposeWorld();
    this.riverId = def.id;
    this.river = new River(def);
    this.glideS = this.river.gates.filter((g) => g.kind === 'glide').map((g) => g.s);
    this.world = buildKayakWorld(this.scene, this.river, { quality: this.quality, renderer: this.renderer, detailed: this.detailed });
    this.setupMap();
  }

  disposeWorld() {
    this.clearRace();
    if (this.world) this.world.dispose();
    this.world = null;
  }

  clearRace() {
    for (const k of this.boats.values()) {
      this.raceObjects.remove(k.group);
      disposeTree(k.group);
    }
    this.boats = new Map();
    for (const m of [...this.boxMeshes, ...this.whirlMeshes]) this.raceObjects.remove(m);
    this.boxMeshes = [];
    this.whirlMeshes = [];
    this.whirlOf = new Map();
    this.race = null;
  }

  // Nouvelle course sur la rivière chargée.
  setup() {
    this.clearRace();
    const river = this.river;
    const race = new KayakRace(river);
    this.race = race;
    for (const r of race.racers) {
      const k = new Kayak({ color: r.color, name: r.isPlayer ? '' : r.name, quality: this.quality });
      this.boats.set(r, k);
      this.raceObjects.add(k.group);
    }
    this.pairs = [...this.boats.entries()];
    this.boxMeshes = race.boxes.map((b) => {
      const mesh = createItemBox();
      mesh.scale.setScalar(0.8);
      river.frame(b.s, b.lateral, this.f1);
      mesh.position.set(this.f1.x, this.f1.y + 0.95, this.f1.z);
      mesh.userData.baseY = this.f1.y + 0.95;
      this.raceObjects.add(mesh);
      return mesh;
    });
    const wr = whirlResources();
    for (let i = 0; i < WHIRLS; i++) {
      const m = new THREE.Mesh(wr.geo, wr.mat);
      m.visible = false;
      m.renderOrder = 2;
      this.raceObjects.add(m);
      this.whirlMeshes.push(m);
    }
    this.world.gates.reset();
    this.world.challenges.reset();
    this.bindEvents(race);
    this.hudState = {};
    this.buildProgress();
    this.sync(0);
    this.cameraTarget(this.camPos, this.camLook);
  }

  bindEvents(race) {
    const hud = this.hud;
    const p = race.player;
    race.addEventListener('go', () => hud.flash('Partez !', 1100, 'good'));
    race.addEventListener('gate', ({ detail: d }) => {
      if (!d.racer.isPlayer) return;
      this.world.gates.setState(d.gate.id, d.ok ? 'ok' : 'miss');
      if (!d.ok) {
        hud.flash(`Porte ${d.gate.n} manquée : +${KAYAK.gatePenalty} s`, 1500, 'bad');
        this.devices.vibrate();
        this.flashScreen('miss');
      }
    });
    race.addEventListener('sprint-zone', ({ detail: d }) => {
      if (d.racer.isPlayer) hud.flash('Porte sprint : accélère !', 1300, 'good');
    });
    race.addEventListener('glide-zone', ({ detail: d }) => {
      if (d.racer.isPlayer) hud.flash('Passerelle : arrête de ramer !', 1500, 'bad');
    });
    race.addEventListener('sprint', ({ detail: d }) => {
      if (!d.racer.isPlayer) return;
      if (d.grade === 'boost') {
        hud.flash(`Porte sprint : turbo ${d.boost.toFixed(1)} s !`, 1600, 'good');
        this.curtain = null;
        this.world.challenges.setCurtain(d.gate.id, 1, 'boost');
        this.flashScreen('boost');
      } else if (d.grade === 'pass') {
        hud.flash('Porte sprint passée', 1200, 'good');
        this.curtain = null;
        this.world.challenges.setCurtain(d.gate.id, 1);
      } else {
        hud.flash('Trop juste : ralenti, +1 s', 1600, 'bad');
        this.curtain = null;
        this.world.challenges.setCurtain(d.gate.id, 0.5, 'slow');
        this.shake = 0.7;
        this.flashScreen('miss');
      }
    });
    race.addEventListener('glide', ({ detail: d }) => {
      if (!d.racer.isPlayer) return;
      if (d.ok) hud.flash('Bien glissé !', 1200, 'good');
      else {
        hud.flash('Bam ! Il fallait arrêter de ramer', 1700, 'bad');
        this.shake = 0.8;
        this.devices.vibrate();
      }
    });
    race.addEventListener('bump', ({ detail: d }) => {
      if (!d.racer.isPlayer) return;
      this.shake = d.kind === 'rock' ? 0.9 : 0.45;
      if (d.kind === 'rock') {
        hud.flash('Rocher !', 900, 'bad');
        this.devices.vibrate();
      }
    });
    race.addEventListener('pickup', ({ detail: d }) => {
      if (d.racer.isPlayer) hud.flash(`${KAYAK_ITEMS[d.item].icon} ${KAYAK_ITEMS[d.item].label} !`, 1100);
    });
    race.addEventListener('use', ({ detail: d }) => {
      if (!d.racer.isPlayer) return;
      if (d.item === 'turbo') hud.flash('🚀 Turbo !', 1100, 'good');
      else if (d.item === 'shield') hud.flash('🛡️ Bouclier activé', 1200, 'good');
      else hud.flash('🌀 Tourbillon lâché', 1100, 'good');
    });
    race.addEventListener('shield-save', ({ detail: d }) => {
      if (d.racer.isPlayer) hud.flash('🛡️ Le bouclier t’a protégé', 1300, 'good');
    });
    race.addEventListener('whirl-hit', ({ detail: d }) => {
      if (d.racer.isPlayer) {
        hud.flash('🌀 Tourbillon ! Tête-à-queue', 1600, 'bad');
        this.shake = 1;
        this.devices.vibrate();
      } else if (d.whirl.owner === p) hud.flash(`${d.racer.name} tourne dans ton tourbillon !`, 1500, 'good');
    });
    race.addEventListener('whirl-dropped', ({ detail: w }) => {
      const m = this.whirlMeshes.find((x) => !x.visible);
      if (!m) return;
      this.river.frame(w.s, w.lateral, this.f1);
      m.position.set(this.f1.x, this.f1.y + 0.04, this.f1.z);
      m.visible = true;
      this.whirlOf.set(w.id, m);
    });
    race.addEventListener('whirl-removed', ({ detail: w }) => {
      const m = this.whirlOf.get(w.id);
      if (m) m.visible = false;
      this.whirlOf.delete(w.id);
    });
    race.addEventListener('finish', ({ detail: r }) => {
      if (!r.isPlayer) return;
      hud.flash(`Arrivée : ${ordinal(race.positionOf(r))} !`, 2500, 'good');
      this.onFinish?.();
    });
  }

  useItem() {
    if (this.race) this.race.useItem(this.race.player);
  }

  // Pente envoyée au trainer : les rapides sont un peu plus durs (vélo, elliptique : +2,5 % ; rameur : léger).
  grade(kind) {
    const r = this.race;
    if (!r || r.time < 0 || r.player.finishTime !== null) return 0;
    const rapid = this.river.rapidAt(r.player.s);
    return Math.round((kind === 'rower' ? 1 : 2.5) * rapid * 10) / 10;
  }

  // Une image : course (si elle tourne), kayaks, caméra, décor, affichage.
  frame(dt, nowMs, state, input, extra) {
    const race = this.race;
    if (state === 'race' || state === 'end') {
      race.update(dt, input);
      if (race.time < 0) this.hud.countdown(String(Math.ceil(-race.time)));
    }
    this.sync(state === 'paused' ? 0 : dt);
    this.easeCurtain(dt);
    this.cameraTarget(this.desiredPos, this.desiredLook);
    const cam = this.camera;
    this.camPos.lerp(this.desiredPos, 1 - Math.exp(-dt * 5));
    this.camLook.lerp(this.desiredLook, 1 - Math.exp(-dt * 8));
    cam.position.copy(this.camPos);
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.35;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.35;
      this.shake = Math.max(0, this.shake - dt * 1.6);
    }
    cam.lookAt(this.camLook);
    const p = race.player;
    this.camRoll += (p.lean * 0.25 - this.camRoll) * (1 - Math.exp(-dt * 4));
    cam.rotateZ(-this.camRoll);
    const fov = 62 + Math.min(8, p.v * 0.7) + (race.time < p.turboUntil ? 4 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 2.5));
      cam.updateProjectionMatrix();
    }
    if (this.sun) {
      this.river.frame(p.s, p.lateral, this.f1);
      followSun(this.sun, this.tmp.set(this.f1.x, this.f1.y, this.f1.z), cam);
    }
    this.world.update(dt, cam);
    this.drawMap();
    if (nowMs - this.lastHud > 100) {
      this.lastHud = nowMs;
      this.updateCurtain();
      this.updateHud(extra);
    }
  }

  sync(dt) {
    const race = this.race;
    const river = this.river;
    const t = race.time;
    const f = this.f1;
    const cam = this.camera;
    const now = performance.now() / 1000;
    for (let n = 0; n < this.pairs.length; n++) {
      const r = this.pairs[n][0];
      const k = this.pairs[n][1];
      river.frame(r.s, r.lateral, f);
      const rapid = river.rapidAt(r.s);
      const bob = Math.sin(now * 2.3 + r.wobble) * 0.02 + Math.sin(now * 5.1 + r.s * 0.3) * 0.035 * rapid;
      k.group.position.set(f.x, f.y + bob, f.z);
      const yaw = Math.atan2(f.tx, f.tz) - r.heading + r.spin;
      const pitch = Math.sin(now * 3.1 + r.s * 0.2) * 0.035 * rapid;
      k.setOrientation(yaw, r.lean + Math.sin(now * 4.3 + r.wobble) * 0.03 * rapid, pitch);
      // Pagaie : au rythme des coups ; posée quand on glisse (passerelle) ou qu'on ne rame pas
      const rowing = r.strokeRate > 1 && r.power > 15 && t >= -3;
      k.amount = Math.max(0, Math.min(1, (k.amount ?? 0) + (rowing ? 3 : -2) * Math.max(dt, 0.016)));
      // Sous la passerelle basse : on se couche sur le pont si on a cessé de ramer
      let duck = 0;
      for (const gs of this.glideS) duck = Math.max(duck, 1 - Math.min(1, Math.max(0, (Math.abs(gs - r.s) - 1.5) / 5)));
      k.pose(r.phase, k.amount, duck * (1 - k.amount));
      const d = cam.position.distanceTo(k.group.position);
      k.group.visible = r.isPlayer || d > 2.5;
      if (k.label) k.label.visible = d > 6 && d < 120;
    }
    for (let i = 0; i < race.boxes.length; i++) {
      const m = this.boxMeshes[i];
      m.visible = t >= race.boxes[i].respawnAt && cam.position.distanceTo(m.position) < 170;
      if (!m.visible) continue;
      m.rotation.y = now * 1.2 + i;
      m.position.y = m.userData.baseY + Math.sin(now * 2 + i) * 0.12;
    }
    for (const m of this.whirlMeshes) if (m.visible) m.rotation.y = -now * 3;
  }

  // Rideau de la prochaine porte sprint : il se relève à mesure que l'effort des derniers coups monte
  // (cible calculée 10 fois par seconde, mouvement adouci à chaque image).
  updateCurtain() {
    const info = this.race.challengeInfo();
    if (!info || info.kind !== 'sprint') {
      this.curtain = null;
      return;
    }
    const e = info.zone ? Math.max(0, info.effort) : 0;
    const open = e < 0.6 ? (e / 0.6) * 0.3 : e < 1 ? 0.3 + ((e - 0.6) / 0.4) * 0.45 : 0.999;
    if (!this.curtain || this.curtain.id !== info.gate.id) this.curtain = { id: info.gate.id, open: 0, target: 0, mood: 'charge' };
    this.curtain.target = open;
    this.curtain.mood = e >= 1 ? 'boost' : 'charge';
  }

  easeCurtain(dt) {
    const c = this.curtain;
    if (!c) return;
    c.open += (c.target - c.open) * (1 - Math.exp(-dt * 5));
    this.world.challenges.setCurtain(c.id, c.open, c.mood);
  }

  // Caméra de poursuite : derrière le kayak, elle suit un peu son cap.
  cameraTarget(outPos, outLook) {
    const p = this.race.player;
    const river = this.river;
    const side = Math.sin(p.heading);
    // Sous la passerelle basse, la caméra descend au ras de l'eau (elle passe sous le tablier)
    let dip = 0;
    for (const gs of this.glideS) dip = Math.max(dip, 1 - Math.min(1, Math.max(0, (Math.abs(gs - (p.s - 3)) - 4) / 6)));
    const back = river.frame(p.s - 6.2 + dip * 1.8, p.lateral * 0.85 - side * 2.4, this.f1);
    outPos.set(back.x, back.y + 2.45 - dip * 1.65, back.z);
    const ahead = river.frame(p.s + 9, p.lateral * 0.6 + side * 3.2, this.f2);
    outLook.set(ahead.x, ahead.y + 0.7 - dip * 0.3, ahead.z);
  }

  snapCamera() {
    this.cameraTarget(this.camPos, this.camLook);
  }

  // Écran rouge ou vert très bref (porte manquée, turbo de porte sprint).
  flashScreen(kind) {
    const el = $('kFlash');
    if (!el) return;
    el.className = '';
    void el.offsetWidth;
    el.className = `k-flash ${kind}`;
  }

  // --- Affichage tête haute ---

  setupMap() {
    const cv = $('kMap');
    if (!cv) return;
    const dpr = Math.min(3, (window.devicePixelRatio || 1) * (innerWidth >= 1600 && innerHeight >= 900 ? 1.7 : 1));
    const S = 170;
    cv.width = S * dpr;
    cv.height = S * dpr;
    this.mapCtx = cv.getContext('2d');
    this.mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.mapS = S;
    const b = this.river.bounds;
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const pad = 14;
    const k = (S - pad * 2) / size;
    const ox = pad + ((size - (b.maxX - b.minX)) * k) / 2;
    const oz = pad + ((size - (b.maxZ - b.minZ)) * k) / 2;
    this.mapX = (x) => ox + (x - b.minX) * k;
    this.mapY = (z) => oz + (z - b.minZ) * k;
    // Fond : rivière, rapides en blanc, portes (vertes), portes sprint (orange), passerelle (jaune), départ, arrivée
    const c = document.createElement('canvas');
    c.width = S * dpr;
    c.height = S * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineJoin = ctx.lineCap = 'round';
    const river = this.river;
    const path = (from, to) => {
      ctx.beginPath();
      for (let i = from; i <= to; i += 4) {
        const x = this.mapX(river.x[i]);
        const y = this.mapY(river.z[i]);
        if (i === from) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };
    path(0, river.count);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = '#3aa6e0';
    ctx.lineWidth = 6;
    ctx.stroke();
    for (let i = 0; i < river.count; i += 4) {
      if (river.rapid[i] < 0.5) continue;
      path(i, Math.min(river.count, i + 4));
      ctx.strokeStyle = 'rgba(235,248,255,0.85)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    const dot = (s, color, r) => {
      river.frame(s, 0, this.f1);
      const x = this.mapX(this.f1.x);
      const y = this.mapY(this.f1.z);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
    };
    for (const g of river.gates) dot(g.s, g.kind === 'sprint' ? '#ff9a1f' : g.kind === 'glide' ? '#ffd23f' : '#3ccf7a', g.kind === 'normal' ? 1.8 : 3.4);
    for (const [s, col] of [[river.start, '#ffffff'], [river.finish, '#ff5a1f']]) dot(s, col, 3.6);
    this.mapCache = c;
  }

  drawMap() {
    const ctx = this.mapCtx;
    if (!ctx || !this.race) return;
    const S = this.mapS;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.mapCache, 0, 0, S, S);
    for (const r of this.race.racers) if (!r.isPlayer) this.mapDot(ctx, r);
    this.mapDot(ctx, this.race.player);
  }

  // Pastille d'un kayak sur la mini-carte (le joueur avec un halo).
  mapDot(ctx, r) {
    this.river.frame(r.s, r.lateral, this.f1);
    const x = this.mapX(this.f1.x);
    const y = this.mapY(this.f1.z);
    if (r.isPlayer) {
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,90,31,0.28)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r.isPlayer ? 5.5 : 4, 0, Math.PI * 2);
    ctx.fillStyle = r.color;
    ctx.fill();
    ctx.lineWidth = r.isPlayer ? 2.5 : 1.5;
    ctx.strokeStyle = r.isPlayer ? '#fff' : 'rgba(0,0,0,0.6)';
    ctx.stroke();
  }

  buildProgress() {
    const race = this.race;
    $('kTotal').textContent = `/ ${race.racers.length}`;
    const slot = $('kSlot');
    slot.classList.remove('full', 'rolling', 'landed');
  }

  set(id, value, apply) {
    if (this.hudState[id] === value) return false;
    this.hudState[id] = value;
    if (apply) apply(value);
    else $(id).textContent = value;
    return true;
  }

  // extra : { hint, autoSteer, heartRate, trainer }
  updateHud(extra = {}) {
    const race = this.race;
    const p = race.player;
    const t = race.time;
    const pos = race.positionOf(p);
    this.set('pos', pos, () => {
      const box = $('kPos').closest('.hud-card');
      if (this.hudState.prevPos !== undefined) {
        const flip = box.classList.contains('chg-a');
        box.classList.remove('chg-a', 'chg-b', 'up', 'down');
        box.classList.add(flip ? 'chg-b' : 'chg-a', pos < this.hudState.prevPos ? 'up' : 'down');
      }
      this.hudState.prevPos = pos;
      $('kPos').innerHTML = ordinalHtml(pos);
    });
    const passed = p.passed + p.missed;
    this.set('kGates', `Portes ${passed} / ${this.river.normalGates}`);
    this.set('kTime', formatTime(Math.max(0, p.finishTime ?? t)));
    this.set('kPen', p.penalty ? `+${p.penalty} s` : '');
    this.set('kPower', p.power > 0 || extra.trainer ? String(Math.round(p.power)) : '--');
    this.set('kRate', p.strokeRate > 0 ? String(Math.round(p.strokeRate)) : '--');
    this.set('kHr', extra.heartRate ? String(extra.heartRate) : '--');
    const ground = t < 0 ? 0 : Math.max(0, p.v * Math.cos(p.heading) + this.river.currentAt(p.s, p.lateral));
    this.set('kSpeed', (ground * 3.6).toFixed(1));
    const arc = Math.round(Math.min(1, ground * 3.6 / 30) * 245);
    this.set('kArc', arc, (a) => ($('kSpeedArc').style.strokeDasharray = `${a} 327`));
    this.set('kLeft', String(Math.max(0, Math.ceil(this.river.finish - p.s))));
    this.set('kPenalty', String(p.penalty));
    this.setItem(p.item);
    this.updateChallenge();
    // Badges : objets et effets en cours, courant, pilote auto
    const badges = [];
    if (t < p.turboUntil) badges.push(`<span class="badge turbo">🚀 Turbo ${(p.turboUntil - t).toFixed(1)} s</span>`);
    if (t < p.shieldUntil) badges.push(`<span class="badge shield">🛡️ Bouclier ${(p.shieldUntil - t).toFixed(0)} s</span>`);
    if (t < p.spinUntil) badges.push('<span class="badge slip">🌀 Tête-à-queue</span>');
    if (t < p.stunUntil) badges.push('<span class="badge grass">Ralenti</span>');
    if (p.onBank) badges.push('<span class="badge grass">Contre la berge !</span>');
    else if (t >= 0 && this.river.rapidAt(p.s) > 0.5) badges.push('<span class="badge rapid">Rapide : le courant pousse</span>');
    if (extra.autoSteer) badges.push('<span class="badge auto">🧭 Pilote auto</span>');
    this.set('kEffects', badges.join(''), (html) => ($('kEffects').innerHTML = html));
    this.set('kHint', extra.hint || '');
  }

  setItem(item) {
    const had = this.hudState.item;
    if (had === (item || '')) return;
    this.hudState.item = item || '';
    const slot = $('kSlot');
    clearTimeout(this.rollTimer);
    slot.classList.remove('rolling', 'landed');
    if (item) {
      $('kItem').textContent = KAYAK_ITEMS[item].icon;
      $('kItemLabel').textContent = `${KAYAK_ITEMS[item].label} · Espace`;
      slot.classList.add('full');
      if (had !== undefined && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        slot.classList.add('rolling');
        this.rollTimer = setTimeout(() => {
          slot.classList.remove('rolling');
          slot.classList.add('landed');
        }, 780);
      } else slot.classList.add('landed');
    } else {
      $('kItem').textContent = '';
      $('kItemLabel').textContent = 'aucun objet';
      slot.classList.remove('full');
    }
  }

  // Panneau de la porte sprint ou glisse : distance en coups et en mètres, jauge d'effort, verdict attendu.
  updateChallenge() {
    const info = this.race.challengeInfo();
    const box = $('kChallenge');
    const show = !!info;
    if (this.set('chShow', show, () => (box.hidden = !show))) $('kayakHud').classList.toggle('has-challenge', show);
    if (!info) return;
    const strokes = `${info.strokes} coup${info.strokes > 1 ? 's' : ''}`;
    const m = `${Math.max(0, Math.round(info.dist))} m`;
    if (info.kind === 'glide') {
      this.set('chKind', 'glide', () => (box.dataset.kind = 'glide'));
      this.set('kcTitle', info.zone ? 'Passerelle : arrête de ramer !' : `Passerelle basse dans ${strokes}`);
      this.set('kcSub', info.zone ? `dans ${strokes} · ${m} · laisse glisser` : `${m} · lâche la pagaie 2 coups avant`);
      const k = info.zone ? Math.max(0, Math.min(1, 1 - info.recent / Math.max(1, info.limit * 2.2))) : 0;
      this.set('kcFill', k.toFixed(2), (v) => ($('kcFill').style.transform = `scaleX(${v})`));
      this.set('kcState', info.zone ? (info.ok ? 'Tu glisses : parfait' : `Encore ${Math.round(info.recent)} W : stop !`) : '');
      this.set('chOk', info.zone && info.ok ? 'ok' : info.zone ? 'warn' : '', (v) => (box.dataset.state = v));
      return;
    }
    this.set('chKind', 'sprint', () => (box.dataset.kind = 'sprint'));
    this.set('kcTitle', info.zone ? 'Porte sprint : accélère !' : `Porte sprint dans ${strokes}`);
    this.set('kcSub', `${info.zone ? `dans ${strokes} · ` : ''}${m} · vise ${Math.round(info.target)} W (moy. ${Math.round(info.base)} W)`);
    const e = info.zone ? Math.max(0, info.effort) : 0;
    this.set('kcFill', Math.min(1, e / 1.5).toFixed(2), (v) => ($('kcFill').style.transform = `scaleX(${v})`));
    let state = '';
    let label = info.zone ? 'Monte en puissance, coup après coup' : 'Prépare-toi à accélérer';
    if (info.zone && info.judged >= 1) {
      if (info.outcome === 'boost') { state = 'ok'; label = `Turbo assuré : ${Math.round(info.avg)} W`; }
      else if (info.outcome === 'pass') { state = 'mid'; label = `Ça passe (${Math.round(info.avg)} W) : encore pour le turbo`; }
      else { state = 'warn'; label = `${Math.round(info.avg ?? 0)} W : plus fort, sinon ça freine`; }
    }
    this.set('kcState', label);
    this.set('chOk', state, (v) => (box.dataset.state = v));
  }

  // Lignes de l'écran d'arrivée (temps avec pénalités, portes manquées).
  results() {
    const race = this.race;
    const rows = race.ranking().map((r) => ({ r, ...race.estimatedTime(r) }));
    rows.sort((a, b) => (a.estimated === b.estimated ? a.time - b.time : a.estimated ? 1 : -1));
    return rows;
  }

  dispose() {
    this.disposeWorld();
    this.river = null;
    this.riverId = null;
  }
}
