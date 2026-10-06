// Sons du joueur, pilotés par l'état à chaque image (quelques paramètres modulés, aucun nœud créé par image) :
// roulement selon le revêtement, roue libre, transmission, vent, souffle, turbo ; au rameur : attaque, glouglou
// de la propulsion, dégagé, siège qui coulisse, eau sous la coque. Adversaires proches : vélos et avirons.
import { biquad } from './engine.js';
import { tyreParams, freewheelRate, isCoasting, chainMeshRate, breathing, PLANK_SPACING, WHEELBASE } from './patterns.js';

const TAU = Math.PI * 2;
// Réglage du mélange (mesuré : vélo à 30 km/h sur asphalte ≈ -24 dBFS sur le bus des effets)
const TRIM = { hiss: 2.2, rumble: 0.8, crunch: 1.1, wood: 1.1, sand: 1.5, water: 1.4, free: 1, chain: 0.5, wind: 0.45, whistle: 0.25, breath: 0.32, turbo: 0.35, plank: 0.55 };

const node = (c, type, f, q = 0.707) => biquad(c, type, f, q);
function gain(c, v = 0) {
  const g = c.createGain();
  g.gain.value = v;
  return g;
}
const NEED = [['noise', { color: 'pink', seconds: 6 }], ['noise', { color: 'brown', seconds: 6 }], ['noise', { color: 'white', seconds: 6 }]];
const WADE = { seconds: 4, rate: 260, fmin: 250, fmax: 1800, noise: 0.6, noiseLp: 2200 }; // eau brassée (gué)

// =====================================================================
// Vélo
// =====================================================================
export class BikeSounds {
  constructor(engine) {
    this.e = engine;
    this.ready = false;
    this.on = false;
    this.plankAcc = 0;
    this.breathLeft = 0;
  }

  async build() {
    if (this.building) return this.building;
    const b = this.e.bank;
    this.building = Promise.all([...NEED, ['crunch', { seconds: 2 }], ['water', WADE]].map(([n, o]) => b.load(n, o, 1))).then(() => this.make()).catch(() => {});
    for (const f of [170, 200, 230, 260]) b.load('tok', { f }).catch(() => {});
    return this.building;
  }

  make() {
    const e = this.e;
    const c = e.ctx;
    const out = (this.out = gain(c, 1));
    const pinkA = e.noise('pink');
    const pinkB = e.noise('pink', 0.9);
    const brown = e.noise('brown');
    const white = e.noise('white');
    const crunch = c.createBufferSource();
    crunch.buffer = e.bank.get('crunch', { seconds: 2 });
    crunch.loop = true;
    crunch.start();
    this.sources = [pinkA, pinkB, brown, white, crunch];
    const g = (this.g = {});
    // Chuintement de l'asphalte
    this.hissBp = node(c, 'bandpass', 2000, 0.6);
    pinkA.connect(node(c, 'highpass', 900, 0.6)).connect(this.hissBp).connect((g.hiss = gain(c))).connect(out);
    // Grondement sourd de la route
    this.rumbleLp = node(c, 'lowpass', 120, 0.8);
    brown.connect(this.rumbleLp).connect((g.rumble = gain(c))).connect(out);
    // Gravier / herbe
    this.crunchSrc = crunch;
    crunch.connect(node(c, 'bandpass', 2600, 0.5)).connect((g.crunch = gain(c))).connect(out);
    // Passerelle : résonance creuse des planches sur pilotis
    brown.connect(node(c, 'bandpass', 165, 3.5)).connect((g.wood = gain(c))).connect(out);
    // Sable : souffle mou, sans aigus
    pinkA.connect(node(c, 'bandpass', 950, 0.8)).connect(node(c, 'lowpass', 2400, 0.6)).connect((g.sand = gain(c))).connect(out);
    // Gué et boue : eau brassée par les roues (boucle de bulles et d'éclaboussures)
    const wade = c.createBufferSource();
    wade.buffer = e.bank.get('water', WADE);
    wade.loop = true;
    wade.start();
    this.sources.push(wade);
    this.wadeSrc = wade;
    wade.connect(node(c, 'highpass', 250, 0.6)).connect((g.water = gain(c))).connect(out);
    // Roue libre : train d'impulsions qui fait sonner deux filtres résonants (le « tic-tic » garde son timbre)
    // Beaucoup d'harmoniques égales = impulsions brèves (le navigateur retire celles au-delà de Nyquist).
    const N = 2048;
    const real = new Float32Array(N + 1);
    const imag = new Float32Array(N + 1);
    for (let k = 1; k <= N; k++) real[k] = 1;
    this.free = c.createOscillator();
    this.free.setPeriodicWave(c.createPeriodicWave(real, imag, { disableNormalization: true }));
    this.free.frequency.value = 30;
    const fb = gain(c, 1);
    this.free.connect(node(c, 'bandpass', 3400, 5)).connect(fb);
    this.free.connect(node(c, 'bandpass', 1700, 6)).connect(gain(c, 0.5)).connect(fb);
    fb.connect((g.free = gain(c))).connect(out);
    this.free.start();
    // Transmission : bruit modulé à la fréquence d'engrènement de la chaîne, rythmé par les coups de pédale
    const am = gain(c, 0.55);
    this.mesh = c.createOscillator();
    this.mesh.frequency.value = 70;
    const meshDepth = gain(c, 0.45);
    this.mesh.connect(meshDepth).connect(am.gain);
    this.crank = c.createOscillator();
    this.crank.frequency.value = 3;
    this.crankDepth = gain(c, 0);
    g.chain = gain(c);
    this.crank.connect(this.crankDepth).connect(g.chain.gain);
    white.connect(node(c, 'bandpass', 1900, 1.3)).connect(am).connect(g.chain).connect(out);
    this.mesh.start();
    this.crank.start();
    // Vent dans les oreilles et sifflement aux grandes vitesses
    this.windLp = node(c, 'lowpass', 400, 0.5);
    pinkB.connect(this.windLp).connect((g.wind = gain(c))).connect(out);
    this.whistleBp = node(c, 'bandpass', 1500, 2.5);
    pinkB.connect(this.whistleBp).connect((g.whistle = gain(c))).connect(out);
    // Souffle (inspiration plus aiguë, expiration plus grave), une respiration programmée à la fois
    this.breathBp = node(c, 'bandpass', 900, 1.2);
    white.connect(this.breathBp).connect((g.breath = gain(c))).connect(out);
    // Turbo : poussée de réacteur et note qui grimpe
    this.turboTone = c.createOscillator();
    this.turboTone.type = 'sawtooth';
    this.turboTone.frequency.value = 180;
    const tlp = node(c, 'lowpass', 900, 1.2);
    g.turbo = gain(c);
    pinkA.connect(node(c, 'bandpass', 1300, 1.4)).connect(g.turbo);
    this.turboTone.connect(tlp).connect(gain(c, 0.25)).connect(g.turbo);
    g.turbo.connect(out);
    this.turboTone.start();
    // Couches intermittentes débranchées tant qu'elles se taisent : leurs filtres ne coûtent alors rien.
    this.gates = {};
    for (const k of ['crunch', 'wood', 'sand', 'water', 'free', 'chain', 'whistle', 'breath', 'turbo']) {
      g[k].disconnect();
      this.gates[k] = { on: false, idle: 0 };
    }
    this.ready = true;
  }

  gate(name, active, dt) {
    const s = this.gates[name];
    if (active) {
      s.idle = 0;
      if (!s.on) {
        this.g[name].connect(this.out);
        s.on = true;
      }
    } else if (s.on && (s.idle += dt) > 0.8) {
      this.g[name].disconnect();
      s.on = false;
    }
  }

  setActive(on) {
    if (!this.ready || on === this.on) return;
    this.on = on;
    const t = this.e.ctx.currentTime;
    // Déconnecté du bus quand on ne roule pas : le moteur audio ne calcule plus rien de cette chaîne.
    if (on) {
      this.out.gain.setValueAtTime(0, t);
      this.out.connect(this.e.buses.sfx);
      this.out.gain.linearRampToValueAtTime(1, t + 0.3);
    } else {
      this.out.gain.setTargetAtTime(0, t, 0.08);
      clearTimeout(this.offTimer);
      this.offTimer = setTimeout(() => {
        if (!this.on) this.out.disconnect();
      }, 500);
    }
  }

  // p : { speed, cadence, power, grade, surface, offRoad, turbo, slip }
  update(dt, p) {
    if (!this.ready || !this.on) return;
    const c = this.e.ctx;
    const t = c.currentTime;
    // N'envoie une nouvelle cible que si la valeur a vraiment changé (moins de travail pour le fil audio).
    const T = (param, v, tau = 0.08) => {
      if (param._v !== undefined && Math.abs(param._v - v) <= Math.abs(v) * 0.015 + 1e-4) return;
      param._v = v;
      param.setTargetAtTime(v, t, tau);
    };
    const tp = tyreParams(p.speed, p.surface, p.offRoad);
    const g = this.g;
    T(g.hiss.gain, tp.hiss * TRIM.hiss);
    T(this.hissBp.frequency, tp.hissFreq, 0.2);
    T(g.rumble.gain, tp.rumble * TRIM.rumble);
    T(this.rumbleLp.frequency, tp.rumbleFreq, 0.2);
    T(g.crunch.gain, (tp.crunch + (p.slip ? 0.4 : 0)) * TRIM.crunch, 0.06);
    T(this.crunchSrc.playbackRate, tp.crunchRate, 0.2);
    T(g.wood.gain, tp.wood * TRIM.wood, 0.1);
    T(g.sand.gain, tp.sand * TRIM.sand, 0.12);
    T(g.water.gain, tp.water * TRIM.water, 0.15);
    T(this.wadeSrc.playbackRate, 0.8 + Math.min(0.7, p.speed / 10), 0.3);
    // Roue libre quand on arrête de pédaler
    const coast = isCoasting(p.cadence, p.power, p.speed);
    // Le train d'impulsions non normalisé donne des clics de hauteur ∝ 1/f : gain ∝ f pour des clics égaux
    // (crête ≈ 0,25 quelle que soit la vitesse ; plus on va vite, plus ils se rapprochent jusqu'au bourdonnement).
    const rate = Math.max(4, freewheelRate(p.speed));
    T(g.free.gain, coast ? TRIM.free * 1.2e-4 * rate * Math.min(1, p.speed / 4) : 0, coast ? 0.06 : 0.03);
    T(this.free.frequency, rate, 0.1);
    // Transmission sous charge
    const load = Math.min(1, p.power / 300);
    const pedal = p.cadence > 15 ? 1 : 0;
    T(g.chain.gain, pedal * (0.25 + 0.75 * load) * TRIM.chain * Math.min(1, p.cadence / 60));
    T(this.crankDepth.gain, pedal * 0.12 * TRIM.chain, 0.2);
    T(this.mesh.frequency, Math.max(5, chainMeshRate(p.cadence)), 0.1);
    T(this.crank.frequency, Math.max(0.5, (p.cadence / 60) * 2), 0.2);
    // Vent : niveau en v², brillance avec la vitesse
    const k = Math.min(1.3, p.speed / 14);
    T(g.wind.gain, k * k * TRIM.wind, 0.15);
    T(this.windLp.frequency, 250 + p.speed * 110, 0.2);
    T(g.whistle.gain, Math.max(0, k - 0.6) * TRIM.whistle, 0.2);
    T(this.whistleBp.frequency, 1100 + p.speed * 90, 0.3);
    // Turbo
    T(g.turbo.gain, p.turbo ? TRIM.turbo : 0, p.turbo ? 0.05 : 0.3);
    T(this.turboTone.frequency, p.turbo ? 420 : 180, p.turbo ? 1.2 : 0.3);
    // Lattes de la passerelle : avant puis arrière, au bon instant (programmées sur l'horloge audio)
    if (tp.plankRate > 0 && p.speed > 0.8) {
      const d = p.speed * dt;
      let next = PLANK_SPACING - this.plankAcc;
      while (next < d) {
        const at = t + 0.03 + next / p.speed;
        this.tok(at, p.speed);
        this.tok(at + WHEELBASE / p.speed, p.speed * 0.8);
        next += PLANK_SPACING;
      }
      this.plankAcc = (this.plankAcc + d) % PLANK_SPACING;
    }
    const gate = (k, v) => this.gate(k, v, dt);
    gate('crunch', tp.crunch > 0.001 || p.slip);
    gate('wood', tp.wood > 0.001);
    gate('sand', tp.sand > 0.001);
    gate('water', tp.water > 0.001);
    gate('free', coast);
    gate('chain', pedal > 0);
    gate('whistle', k > 0.6);
    gate('turbo', p.turbo);
    // Souffle de l'effort
    const br = breathing(p.power, p.grade);
    gate('breath', br.rate > 0 || this.breathLeft > -2);
    this.breathLeft -= dt;
    if (br.rate > 0 && this.breathLeft <= 0) {
      const period = 60 / br.rate;
      this.breathLeft = period * (0.92 + Math.random() * 0.16);
      this.breath(t + 0.02, period, br.level * TRIM.breath);
    }
  }

  tok(at, speed) {
    const f = [170, 200, 230, 260][Math.floor(Math.random() * 4)];
    const buf = this.e.bank.get('tok', { f });
    this.e.play(buf, { bus: 'sfx', when: at, gain: TRIM.plank * Math.min(1, speed / 8) * (0.7 + Math.random() * 0.3), rate: 0.92 + Math.random() * 0.16 });
  }

  breath(t, period, level) {
    const g = this.g.breath.gain;
    const f = this.breathBp.frequency;
    const inh = period * 0.4;
    const exh = period * 0.45;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(level * 0.45, t + inh * 0.7);
    g.linearRampToValueAtTime(0.0001, t + inh);
    g.linearRampToValueAtTime(level, t + inh + 0.06);
    g.setTargetAtTime(0.0001, t + inh + 0.1, exh / 3);
    f.cancelScheduledValues(t);
    f.setValueAtTime(1500, t);
    f.setValueAtTime(750, t + inh);
    f.linearRampToValueAtTime(600, t + inh + exh);
  }
}

// =====================================================================
// Aviron (joueur)
// =====================================================================
export class RowSounds {
  constructor(engine) {
    this.e = engine;
    this.ready = false;
    this.on = false;
    this.lastPhase = null;
  }

  async build() {
    if (this.building) return this.building;
    const b = this.e.bank;
    this.building = Promise.all([...NEED, ['water', ROW_WATER]].map(([n, o]) => b.load(n, o, 1))).then(() => this.make()).catch(() => {});
    for (let i = 0; i < 3; i++) for (const n of ['splash', 'drips', 'oarlock']) b.pool(n, {}, 3);
    b.load('gurgle', { dur: 0.9 }).catch(() => {});
    b.load('seat', { dur: 1 }).catch(() => {});
    return this.building;
  }

  make() {
    const e = this.e;
    const c = e.ctx;
    this.out = gain(c, 1);
    const pink = e.noise('pink');
    this.hullLp = node(c, 'lowpass', 400, 0.6);
    this.hull = gain(c);
    pink.connect(node(c, 'highpass', 90, 0.6)).connect(this.hullLp).connect(this.hull).connect(this.out);
    const water = c.createBufferSource();
    water.buffer = e.bank.get('water', ROW_WATER);
    water.loop = true;
    water.start();
    this.bub = gain(c);
    water.connect(node(c, 'lowpass', 2200, 0.6)).connect(this.bub).connect(this.out);
    this.sources = [pink, water];
    this.ready = true;
  }

  setActive(on) {
    if (!this.ready || on === this.on) return;
    this.on = on;
    const t = this.e.ctx.currentTime;
    if (on) {
      this.out.gain.setValueAtTime(0, t);
      this.out.connect(this.e.buses.sfx);
      this.out.gain.linearRampToValueAtTime(1, t + 0.4);
    } else {
      this.out.gain.setTargetAtTime(0, t, 0.1);
      clearTimeout(this.offTimer);
      this.offTimer = setTimeout(() => {
        if (!this.on) this.out.disconnect();
      }, 600);
    }
  }

  // racer : { phase, strokeRate, v, power }
  update(dt, racer) {
    if (!this.ready || !this.on) return;
    const t = this.e.ctx.currentTime;
    const v = racer.v;
    this.hull.gain.setTargetAtTime(Math.min(1, v / 5) * 0.7, t, 0.2);
    this.hullLp.frequency.setTargetAtTime(300 + v * 260, t, 0.3);
    this.bub.gain.setTargetAtTime(Math.min(1, v / 5) * 0.35, t, 0.3);
    const ph = ((racer.phase % TAU) + TAU) % TAU;
    const prev = this.lastPhase;
    this.lastPhase = ph;
    if (prev === null || racer.strokeRate < 1) return;
    const strokeTime = 60 / Math.max(10, racer.strokeRate);
    const strength = Math.min(1.2, 0.5 + racer.power / 300);
    // Attaque : la phase repasse par 0
    if (ph < prev - Math.PI) stroke(this.e, t, strength, strokeTime, 0, 'sfx', 1);
    // Dégagé : la phase franchit π
    if (prev < Math.PI && ph >= Math.PI) release(this.e, t, strength, strokeTime, 0, 'sfx', 1);
  }
}

const ROW_WATER = { seconds: 6, rate: 90, fmin: 350, fmax: 1800, noise: 0.25, noiseLp: 1200 };

// Coup d'aviron complet (attaque, propulsion) pour le joueur ou un adversaire (pos : source 3D).
function stroke(e, t, strength, strokeTime, x, bus, gainK, pos = null) {
  const b = e.bank;
  const spread = [-1, 1];
  for (const side of spread) {
    const o = pos ? { pos: { x: pos.x + side * 1.6, y: pos.y, z: pos.z }, ref: 4, radius: 45 } : { pan: side * 0.45 };
    e.play(b.pool('splash', {}, 3), { bus, when: t + (side > 0 ? 0.012 : 0), gain: 0.6 * strength * gainK, rate: 0.9 + Math.random() * 0.2, ...o });
  }
  if (!pos) {
    e.play(b.pool('oarlock', {}, 3), { bus, when: t, gain: 0.25 * gainK, rate: 0.95 + Math.random() * 0.1 });
    // Propulsion : moitié du cycle ; on ajuste la vitesse de lecture du glouglou à sa durée
    const drive = strokeTime * 0.5;
    e.play(b.get('gurgle', { dur: 0.9 }), { bus, when: t + 0.04, gain: 0.5 * strength * gainK, rate: Math.max(0.7, Math.min(1.5, 0.9 / drive)) });
  }
}

function release(e, t, strength, strokeTime, x, bus, gainK, pos = null) {
  const b = e.bank;
  const o = pos ? { pos, ref: 4, radius: 40 } : {};
  e.play(b.pool('drips', {}, 3), { bus, when: t, gain: 0.35 * gainK, rate: 0.9 + Math.random() * 0.2, ...o });
  if (!pos) {
    e.play(b.pool('oarlock', {}, 3), { bus, when: t, gain: 0.2 * gainK, rate: 1.05 + Math.random() * 0.1 });
    // Retour : le siège coulisse pendant la seconde moitié du cycle
    const rec = strokeTime * 0.5;
    e.play(b.get('seat', { dur: 1 }), { bus, when: t + 0.05, gain: 0.3 * gainK, rate: Math.max(0.7, Math.min(1.6, 1 / rec)) });
  }
}

// =====================================================================
// Adversaires proches
// =====================================================================
// Vélos : deux emplacements de son (pneus et chaîne) attribués aux deux adversaires les plus proches.
export class RivalBikes {
  constructor(engine) {
    this.e = engine;
    this.slots = [];
    this.left = 0;
  }

  make() {
    const e = this.e;
    const c = e.ctx;
    const pink = e.noise('pink', 1.1);
    const white = e.noise('white', 1.05);
    if (!pink || !white) return false;
    this.sources = [pink, white];
    for (let i = 0; i < 2; i++) {
      const g = gain(c, 0);
      const pan = e.panner({ ref: 3, rolloff: 1.3, max: 200 });
      pink.connect(node(c, 'bandpass', 2300 + i * 300, 0.7)).connect(g);
      white.connect(node(c, 'bandpass', 1800, 1.4)).connect(gain(c, 0.25)).connect(g);
      g.connect(pan);
      this.slots.push({ g, pan, racer: null });
    }
    this.out = gain(c, 1);
    for (const s of this.slots) s.pan.connect(this.out);
    return true;
  }

  setActive(on) {
    if (on && !this.slots.length && !this.make()) return;
    if (!this.slots.length || on === this.on) return;
    this.on = on;
    if (on) this.out.connect(this.e.buses.sfx);
    else {
      for (const s of this.slots) s.g.gain.value = 0;
      this.out.disconnect();
    }
  }

  // others : [{ racer, pos }] (adversaires avec leur position monde)
  update(dt, others) {
    if (!this.on) return;
    const e = this.e;
    const t = e.ctx.currentTime;
    this.left -= dt;
    if (this.left <= 0) {
      this.left = 0.25;
      const near = others.map((o) => [o, e.distanceTo(o.pos)]).filter(([, d]) => d < 28).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([o]) => o.racer);
      for (const s of this.slots) if (s.racer && !near.includes(s.racer)) s.racer = null;
      for (const r of near) if (!this.slots.some((s) => s.racer === r)) {
        const free = this.slots.find((s) => !s.racer);
        if (free) free.racer = r;
      }
    }
    for (const s of this.slots) {
      const o = s.racer && others.find((x) => x.racer === s.racer);
      s.g.gain.setTargetAtTime(o ? Math.min(1, o.racer.v / 12) * 0.5 : 0, t, 0.15);
      if (o) e.setPos(s.pan, o.pos);
    }
  }
}

// Bateaux adverses : éclaboussures 3D à chacune de leurs attaques, pour les deux plus proches.
export class RivalBoats {
  constructor(engine) {
    this.e = engine;
    this.phases = new Map();
  }

  update(dt, boats) {
    const e = this.e;
    if (!e.running) return;
    const t = e.ctx.currentTime;
    const near = boats.map((b) => [b, e.distanceTo(b.pos)]).filter(([, d]) => d < 35).sort((a, b) => a[1] - b[1]).slice(0, 2);
    for (const { racer } of boats) {
      const ph = ((racer.phase % TAU) + TAU) % TAU;
      const prev = this.phases.get(racer);
      this.phases.set(racer, ph);
      const n = near.find(([b]) => b.racer === racer);
      if (!n || prev === undefined || racer.strokeRate < 1) continue;
      const pos = n[0].pos;
      if (ph < prev - Math.PI) stroke(e, t, 0.9, 60 / racer.strokeRate, 0, 'sfx', 0.8, pos);
      if (prev < Math.PI && ph >= Math.PI) release(e, t, 0.9, 60 / racer.strokeRate, 0, 'sfx', 0.6, pos);
    }
  }
}

// Kayak (mode en préparation) : eau qui file sous la coque selon la vitesse.
export class HullSounds {
  constructor(engine) {
    this.e = engine;
    this.ready = false;
  }

  make() {
    const e = this.e;
    const c = e.ctx;
    const pink = e.noise('pink', 0.95);
    if (!pink) return false;
    this.lp = node(c, 'lowpass', 500, 0.6);
    this.g = gain(c, 0);
    pink.connect(node(c, 'highpass', 100, 0.6)).connect(this.lp).connect(this.g);
    this.on = false;
    this.idle = 0;
    this.ready = true;
    return true;
  }

  update(dt, speed) {
    if (!this.ready && (speed <= 0 || !this.make())) return;
    const t = this.e.ctx.currentTime;
    // Débranché à l'arrêt (ou hors du mode kayak) : rien à calculer.
    if (speed > 0.05 && !this.on) {
      this.g.connect(this.e.buses.sfx);
      this.on = true;
    }
    this.idle = speed > 0.05 ? 0 : this.idle + dt;
    if (this.on && this.idle > 1) {
      this.g.disconnect();
      this.on = false;
    }
    this.g.gain.setTargetAtTime(Math.min(1, speed / 5) * 0.45, t, 0.2);
    this.lp.frequency.setTargetAtTime(350 + speed * 280, t, 0.3);
  }
}
