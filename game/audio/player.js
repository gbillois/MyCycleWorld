// Sons du joueur, pilotés par l'état à chaque image (quelques paramètres modulés, aucun nœud créé par image) :
// roulement selon le revêtement, roue libre, transmission, vent, souffle, turbo ; au rameur : attaque, glouglou
// de la propulsion, dégagé, siège qui coulisse, eau sous la coque. Adversaires proches : vélos et avirons.
// Textures graves et médium : bruits rose et brun seulement (pas de bruit blanc), passe-bas fixes entre 2 et 4 kHz,
// chaque niveau suit sa cible par une approche exponentielle (setTargetAtTime) : ni clic ni effet d'escalier.
import { biquad } from './engine.js';
import { tyreParams, freewheelRate, isCoasting, chainMeshRate, breathing, PLANK_SPACING, WHEELBASE } from './patterns.js';

const TAU = Math.PI * 2;
// Réglage du mélange (mesuré hors ligne, réglages par défaut : vélo à 32 km/h sur asphalte ≈ -28 LUFS en sortie)
const TRIM = { hiss: 1.7, rumble: 0.95, crunch: 1, wood: 1.5, sand: 1.4, water: 1.2, free: 0.65, chain: 0.23, wind: 0.375, windAir: 0.12, windRumble: 0.35, breath: 0.18, turbo: 0.26, plank: 0.55 };

const node = (c, type, f, q = 0.707) => biquad(c, type, f, q);
function gain(c, v = 0) {
  const g = c.createGain();
  g.gain.value = v;
  return g;
}
const NEED = [['noise', { color: 'pink', seconds: 6 }], ['noise', { color: 'brown', seconds: 6 }]];
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
    b.pool('breath', {}, 3);
    return this.building;
  }

  make() {
    const e = this.e;
    const c = e.ctx;
    const out = (this.out = gain(c, 1));
    const pinkA = e.noise('pink');
    const pinkB = e.noise('pink', 0.9);
    const brown = e.noise('brown');
    const brownB = e.noise('brown', 0.93);
    const crunch = c.createBufferSource();
    crunch.buffer = e.bank.get('crunch', { seconds: 2 });
    crunch.loop = true;
    crunch.start();
    this.sources = [pinkA, pinkB, brown, brownB, crunch];
    const g = (this.g = {});
    // Roulement sur l'asphalte : souffle doux du pneu, centré dans le médium, sans chuintement aigu
    this.hissBp = node(c, 'bandpass', 1000, 0.5);
    pinkA.connect(node(c, 'highpass', 220, 0.6)).connect(this.hissBp).connect(node(c, 'lowpass', 3200, 0.6)).connect((g.hiss = gain(c))).connect(out);
    // Grondement sourd de la route
    this.rumbleLp = node(c, 'lowpass', 120, 0.7);
    brown.connect(this.rumbleLp).connect((g.rumble = gain(c))).connect(out);
    // Gravier / herbe : grains dans le médium
    this.crunchSrc = crunch;
    crunch.connect(node(c, 'highpass', 250, 0.6)).connect(node(c, 'lowpass', 2500, 0.6)).connect((g.crunch = gain(c))).connect(out);
    // Passerelle : résonance creuse des planches sur pilotis
    brown.connect(node(c, 'bandpass', 165, 2)).connect((g.wood = gain(c))).connect(out);
    // Sable : souffle mou, sans aigus
    pinkA.connect(node(c, 'bandpass', 650, 0.7)).connect(node(c, 'lowpass', 1800, 0.6)).connect((g.sand = gain(c))).connect(out);
    // Gué et boue : eau brassée par les roues (boucle de bulles et d'éclaboussures)
    const wade = c.createBufferSource();
    wade.buffer = e.bank.get('water', WADE);
    wade.loop = true;
    wade.start();
    this.sources.push(wade);
    this.wadeSrc = wade;
    wade.connect(node(c, 'highpass', 250, 0.6)).connect((g.water = gain(c))).connect(out);
    // Roue libre : train d'impulsions qui fait sonner deux filtres résonants (« tic-tic » feutré, assez grave)
    const N = 2048;
    const real = new Float32Array(N + 1);
    const imag = new Float32Array(N + 1);
    for (let k = 1; k <= N; k++) real[k] = 1;
    this.free = c.createOscillator();
    this.free.setPeriodicWave(c.createPeriodicWave(real, imag, { disableNormalization: true }));
    this.free.frequency.value = 30;
    const fb = gain(c, 1);
    this.free.connect(node(c, 'bandpass', 2100, 4)).connect(fb);
    this.free.connect(node(c, 'bandpass', 1150, 5)).connect(gain(c, 0.6)).connect(fb);
    fb.connect(node(c, 'lowpass', 3500, 0.6)).connect((g.free = gain(c))).connect(out);
    this.free.start();
    // Transmission : bruit rose modulé à la fréquence d'engrènement de la chaîne, rythmé par les coups de pédale
    const am = gain(c, 0.75);
    this.mesh = c.createOscillator();
    this.mesh.frequency.value = 70;
    this.mesh.connect(gain(c, 0.25)).connect(am.gain);
    this.crank = c.createOscillator();
    this.crank.frequency.value = 3;
    this.crankDepth = gain(c, 0);
    g.chain = gain(c);
    this.crank.connect(this.crankDepth).connect(g.chain.gain);
    pinkB.connect(node(c, 'bandpass', 1100, 1)).connect(node(c, 'lowpass', 2400, 0.6)).connect(am).connect(g.chain).connect(out);
    this.mesh.start();
    this.crank.start();
    // Vent de la vitesse (option) : souffle brun feutré et un peu d'air médium, décorrélés à gauche et à droite
    // (bruits stéréo indépendants), rafales lentes, grondement discret aux grandes vitesses. Aucun sifflement.
    g.wind = gain(c);
    this.windGust = gain(c, 1);
    this.windLp = node(c, 'lowpass', 300, 0.5);
    brownB.connect(node(c, 'highpass', 40, 0.6)).connect(this.windLp).connect(g.wind);
    this.windAirBp = node(c, 'bandpass', 600, 0.5);
    this.windAir = gain(c, TRIM.windAir);
    pinkB.connect(this.windAirBp).connect(node(c, 'lowpass', 1500, 0.5)).connect(this.windAir).connect(g.wind);
    g.wind.connect(this.windGust);
    this.windRumble = gain(c, 0);
    brownB.connect(node(c, 'lowpass', 75, 0.6)).connect(this.windRumble).connect(this.windGust);
    // Rafales : deux oscillateurs très lents et premiers entre eux (le motif ne revient pas avant longtemps)
    this.gusts = [[0.11, 0.14], [0.27, 0.08]].map(([f, depth]) => {
      const o = c.createOscillator();
      o.frequency.value = f * (0.9 + Math.random() * 0.2);
      o.connect(gain(c, depth)).connect(this.windGust.gain);
      o.start();
      return o;
    });
    // Turbo : poussée feutrée et note ronde qui grimpe
    this.turboTone = c.createOscillator();
    this.turboTone.type = 'triangle';
    this.turboTone.frequency.value = 120;
    g.turbo = gain(c);
    pinkA.connect(node(c, 'bandpass', 800, 0.8)).connect(node(c, 'lowpass', 1800, 0.6)).connect(g.turbo);
    this.turboTone.connect(node(c, 'lowpass', 600, 0.7)).connect(gain(c, 0.3)).connect(g.turbo);
    g.turbo.connect(out);
    this.turboTone.start();
    // Couches intermittentes débranchées tant qu'elles se taisent : leurs filtres ne coûtent alors rien.
    this.gates = {};
    for (const k of ['crunch', 'wood', 'sand', 'water', 'free', 'chain', 'turbo']) {
      g[k].disconnect();
      this.gates[k] = { on: false, idle: 0, node: g[k] };
    }
    this.gates.wind = { on: false, idle: 0, node: this.windGust };
    this.ready = true;
  }

  // Branche une couche dès qu'elle doit sonner, la débranche après 1,5 s de silence (gain alors retombé à 0).
  gate(name, active, dt) {
    const s = this.gates[name];
    if (active) {
      s.idle = 0;
      if (!s.on) {
        s.node.connect(this.out);
        s.on = true;
      }
    } else if (s.on && (s.idle += dt) > 1.5) {
      s.node.disconnect();
      s.on = false;
    }
  }

  setActive(on) {
    if (!this.ready || on === this.on) return;
    this.on = on;
    const t = this.e.ctx.currentTime;
    // Déconnecté du bus quand on ne roule pas : le moteur audio ne calcule plus rien de cette chaîne.
    if (on) {
      clearTimeout(this.offTimer);
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(0, t);
      if (!this.connected) this.out.connect(this.e.buses.sfx);
      this.connected = true;
      this.out.gain.linearRampToValueAtTime(1, t + 0.4);
    } else {
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setTargetAtTime(0, t, 0.08);
      clearTimeout(this.offTimer);
      this.offTimer = setTimeout(() => {
        if (!this.on && this.connected) {
          this.out.disconnect();
          this.connected = false;
        }
      }, 700);
    }
  }

  // p : { speed, cadence, power, grade, surface, offRoad, turbo, slip }
  update(dt, p) {
    if (!this.ready || !this.on) return;
    const c = this.e.ctx;
    const t = c.currentTime;
    // N'envoie une nouvelle cible que si la valeur a vraiment changé (moins de travail pour le fil audio).
    const T = (param, v, tau = 0.1) => {
      if (param._v !== undefined && Math.abs(param._v - v) <= Math.abs(v) * 0.015 + 1e-4) return;
      param._v = v;
      param.setTargetAtTime(v, t, tau);
    };
    const tp = tyreParams(p.speed, p.surface, p.offRoad);
    const g = this.g;
    T(g.hiss.gain, tp.hiss * TRIM.hiss, 0.15);
    T(this.hissBp.frequency, 650 + p.speed * 45, 0.3);
    T(g.rumble.gain, tp.rumble * TRIM.rumble, 0.15);
    T(this.rumbleLp.frequency, tp.rumbleFreq, 0.3);
    T(g.crunch.gain, (tp.crunch + (p.slip ? 0.4 : 0)) * TRIM.crunch, 0.08);
    T(this.crunchSrc.playbackRate, tp.crunchRate, 0.2);
    T(g.wood.gain, tp.wood * TRIM.wood, 0.12);
    T(g.sand.gain, tp.sand * TRIM.sand, 0.15);
    T(g.water.gain, tp.water * TRIM.water, 0.15);
    T(this.wadeSrc.playbackRate, 0.8 + Math.min(0.7, p.speed / 10), 0.3);
    // Roue libre quand on arrête de pédaler
    const coast = isCoasting(p.cadence, p.power, p.speed);
    // Le train d'impulsions non normalisé donne des clics de hauteur ∝ 1/f : gain ∝ f pour des clics égaux
    // (plus on va vite, plus ils se rapprochent jusqu'au ronronnement).
    const rate = Math.max(4, freewheelRate(p.speed));
    T(g.free.gain, coast ? TRIM.free * 1.2e-4 * rate * Math.min(1, p.speed / 4) : 0, coast ? 0.08 : 0.05);
    T(this.free.frequency, rate, 0.1);
    // Transmission sous charge
    const load = Math.min(1, p.power / 300);
    const pedal = p.cadence > 15 ? 1 : 0;
    T(g.chain.gain, pedal * (0.3 + 0.7 * load) * TRIM.chain * Math.min(1, p.cadence / 60), 0.12);
    T(this.crankDepth.gain, pedal * 0.25 * TRIM.chain, 0.2);
    T(this.mesh.frequency, Math.max(5, chainMeshRate(p.cadence)), 0.1);
    T(this.crank.frequency, Math.max(0.5, (p.cadence / 60) * 2), 0.2);
    // Vent (option, désactivé par défaut) : niveau doux qui monte avec la vitesse, à peine plus clair
    const windOn = !!this.e.settings?.windNoise;
    const k = windOn ? Math.min(1.25, p.speed / 14) : 0;
    T(g.wind.gain, Math.pow(k, 1.5) * TRIM.wind, 0.4);
    T(this.windLp.frequency, 220 + p.speed * 30, 0.5);
    T(this.windAirBp.frequency, 450 + p.speed * 25, 0.5);
    T(this.windRumble.gain, Math.max(0, k - 0.6) * TRIM.windRumble, 0.5);
    // Turbo
    T(g.turbo.gain, p.turbo ? TRIM.turbo : 0, p.turbo ? 0.08 : 0.3);
    T(this.turboTone.frequency, p.turbo ? 260 : 120, p.turbo ? 1.2 : 0.3);
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
    const gate = (name, v) => this.gate(name, v, dt);
    gate('crunch', tp.crunch > 0.001 || p.slip);
    gate('wood', tp.wood > 0.001);
    gate('sand', tp.sand > 0.001);
    gate('water', tp.water > 0.001);
    gate('free', coast);
    gate('chain', pedal > 0);
    gate('turbo', p.turbo);
    gate('wind', k > 0.02);
    // Souffle de l'effort : une respiration échantillonnée à la fois, étirée à la cadence voulue
    const br = breathing(p.power, p.grade);
    this.breathLeft -= dt;
    if (br.rate > 0 && this.breathLeft <= 0) {
      const period = 60 / br.rate;
      this.breathLeft = period * (0.92 + Math.random() * 0.16);
      const buf = this.e.bank.pool('breath', {}, 3);
      this.e.play(buf, { bus: 'sfx', when: t + 0.02, gain: br.level * TRIM.breath, rate: Math.max(0.75, Math.min(1.4, 1.6 / period)) });
    }
  }

  tok(at, speed) {
    const f = [170, 200, 230, 260][Math.floor(Math.random() * 4)];
    const buf = this.e.bank.get('tok', { f });
    this.e.play(buf, { bus: 'sfx', when: at, gain: TRIM.plank * Math.min(1, speed / 8) * (0.7 + Math.random() * 0.3), rate: 0.92 + Math.random() * 0.16 });
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
    this.building = Promise.all([['noise', { color: 'pink', seconds: 6 }], ['water', ROW_WATER]].map(([n, o]) => b.load(n, o, 1))).then(() => this.make()).catch(() => {});
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
    water.connect(node(c, 'lowpass', 1800, 0.6)).connect(this.bub).connect(this.out);
    this.sources = [pink, water];
    this.ready = true;
  }

  setActive(on) {
    if (!this.ready || on === this.on) return;
    this.on = on;
    const t = this.e.ctx.currentTime;
    if (on) {
      clearTimeout(this.offTimer);
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(0, t);
      if (!this.connected) this.out.connect(this.e.buses.sfx);
      this.connected = true;
      this.out.gain.linearRampToValueAtTime(1, t + 0.4);
    } else {
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setTargetAtTime(0, t, 0.1);
      clearTimeout(this.offTimer);
      this.offTimer = setTimeout(() => {
        if (!this.on && this.connected) {
          this.out.disconnect();
          this.connected = false;
        }
      }, 800);
    }
  }

  // racer : { phase, strokeRate, v, power }
  update(dt, racer) {
    if (!this.ready || !this.on) return;
    const t = this.e.ctx.currentTime;
    const v = racer.v;
    const T = (param, x, tau) => {
      if (param._v !== undefined && Math.abs(param._v - x) <= Math.abs(x) * 0.015 + 1e-4) return;
      param._v = x;
      param.setTargetAtTime(x, t, tau);
    };
    T(this.hull.gain, Math.min(1, v / 5) * 0.9, 0.2);
    T(this.hullLp.frequency, 300 + v * 220, 0.3);
    T(this.bub.gain, Math.min(1, v / 5) * 0.45, 0.3);
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

const ROW_WATER = { seconds: 6, rate: 90, fmin: 300, fmax: 1500, noise: 0.25, noiseLp: 1100 };

// Coup d'aviron complet (attaque, propulsion) pour le joueur ou un adversaire (pos : source 3D).
function stroke(e, t, strength, strokeTime, x, bus, gainK, pos = null) {
  const b = e.bank;
  const spread = [-1, 1];
  for (const side of spread) {
    const o = pos ? { pos: { x: pos.x + side * 1.6, y: pos.y, z: pos.z }, ref: 4, radius: 45 } : { pan: side * 0.4 };
    e.play(b.pool('splash', {}, 3), { bus, when: t + (side > 0 ? 0.012 : 0), gain: 0.8 * strength * gainK, rate: 0.9 + Math.random() * 0.2, ...o });
  }
  if (!pos) {
    e.play(b.pool('oarlock', {}, 3), { bus, when: t, gain: 0.2 * gainK, rate: 0.95 + Math.random() * 0.1 });
    // Propulsion : moitié du cycle ; on ajuste la vitesse de lecture du glouglou à sa durée
    const drive = strokeTime * 0.5;
    e.play(b.get('gurgle', { dur: 0.9 }), { bus, when: t + 0.04, gain: 0.7 * strength * gainK, rate: Math.max(0.7, Math.min(1.5, 0.9 / drive)) });
  }
}

function release(e, t, strength, strokeTime, x, bus, gainK, pos = null) {
  const b = e.bank;
  const o = pos ? { pos, ref: 4, radius: 40 } : {};
  e.play(b.pool('drips', {}, 3), { bus, when: t, gain: 0.45 * gainK, rate: 0.9 + Math.random() * 0.2, ...o });
  if (!pos) {
    e.play(b.pool('oarlock', {}, 3), { bus, when: t, gain: 0.16 * gainK, rate: 1.05 + Math.random() * 0.1 });
    // Retour : le siège coulisse pendant la seconde moitié du cycle
    const rec = strokeTime * 0.5;
    e.play(b.get('seat', { dur: 1 }), { bus, when: t + 0.05, gain: 0.32 * gainK, rate: Math.max(0.7, Math.min(1.6, 1 / rec)) });
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
    const pink2 = e.noise('pink', 1.05);
    if (!pink || !pink2) return false;
    this.sources = [pink, pink2];
    for (let i = 0; i < 2; i++) {
      const g = gain(c, 0);
      const pan = e.panner({ ref: 3, rolloff: 1.3, max: 200 });
      pink.connect(node(c, 'bandpass', 900 + i * 150, 0.6)).connect(node(c, 'lowpass', 3000, 0.6)).connect(g);
      pink2.connect(node(c, 'bandpass', 1100, 1.2)).connect(gain(c, 0.2)).connect(g);
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
    const t = this.e.ctx.currentTime;
    clearTimeout(this.offTimer);
    if (on) {
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setTargetAtTime(1, t, 0.1);
      if (!this.connected) this.out.connect(this.e.buses.sfx);
      this.connected = true;
    } else {
      // Fondu puis débranchement (aucun arrêt sec)
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setTargetAtTime(0, t, 0.08);
      for (const s of this.slots) s.g.gain.setTargetAtTime(0, t, 0.08);
      this.offTimer = setTimeout(() => {
        if (!this.on && this.connected) {
          this.out.disconnect();
          this.connected = false;
        }
      }, 600);
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
      const v = o ? Math.min(1, o.racer.v / 12) * 0.3 : 0;
      if (s.g.gain._v === undefined || Math.abs(s.g.gain._v - v) > 0.005) {
        s.g.gain._v = v;
        s.g.gain.setTargetAtTime(v, t, 0.15);
      }
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
      if (ph < prev - Math.PI) stroke(e, t, 0.9, 60 / racer.strokeRate, 0, 'sfx', 0.7, pos);
      if (prev < Math.PI && ph >= Math.PI) release(e, t, 0.9, 60 / racer.strokeRate, 0, 'sfx', 0.5, pos);
    }
  }
}

// Kayak : eau qui file sous la coque selon la vitesse.
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
    if (this.on && this.idle > 1.5) {
      this.g.disconnect();
      this.on = false;
    }
    const v = Math.min(1, speed / 5) * 0.32;
    if (this.g.gain._v === undefined || Math.abs(this.g.gain._v - v) > 0.003) {
      this.g.gain._v = v;
      this.g.gain.setTargetAtTime(v, t, 0.2);
      this.lp.frequency.setTargetAtTime(350 + speed * 250, t, 0.3);
    }
  }
}
