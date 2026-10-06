// Ambiances de niveau : nappes continues (vent et rafales, feuillage, insectes, torrent, ressac, clapotis,
// rapides) et événements tirés au sort (oiseaux qui se répondent, animaux de la ferme, sonnailles, cloche du
// village, marmottes, rapace, vagues qui déferlent, goélands, canards). Fondu enchaîné d'un décor à l'autre.
// Rien ne boucle de façon audible : délais de Poisson, positions, hauteurs et variantes changent sans cesse.
// Les nappes sont un fond : bruits rose et brun filtrés bas, larges (stéréo décorrélée) et discrètes ; les
// événements (oiseaux, cloches, animaux) sont clairsemés, lointains et adoucis par la distance.
import { rng, range, irange, pick, chance, EventClock, Wander, nextDelay } from './random.js';
import { pickBird, SCENE_BIRDS } from './patterns.js';
import { coastZ } from './spots.js';
import { biquad } from './engine.js';

const TAU = Math.PI * 2;

// Niveau de chaque espèce (les petits passereaux portent moins loin que le coucou ou le chocard).
const BIRD_GAIN = { blackbird: 0.42, greatTit: 0.3, chaffinch: 0.34, robin: 0.3, skylark: 0.24, swallow: 0.28, cuckoo: 0.45, chough: 0.36, marmot: 0.4, dipper: 0.3, reedWarbler: 0.3, coot: 0.38 };
const SCENE_ANIMALS = { meadow: ['cow', 'sheep', 'horse', 'rooster', 'bee'], alpine: ['raptor'], coast: ['gull'], lake: ['duck'], river: [] };
export const SCENE_REVERB = { meadow: 'meadow', alpine: 'alpine', coast: 'coast', lake: 'lake', river: 'river' };

class Scene {
  constructor(engine, name, world, r) {
    this.e = engine;
    this.name = name;
    this.world = world || {};
    this.spots = this.world.spots || {};
    this.r = r;
    this.nodes = [];
    this.sources = [];
    this.mods = [];
    this.timers = [];
    this.loops = [];
    this.gates = [];
    this.gateLeft = 0;
    this.clocks = {};
    this.ready = false;
    this.stopped = false;
    const c = engine.ctx;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.out.connect(engine.buses.ambience);
    this.def = SCENES[name] || SCENES.meadow;
  }

  async start() {
    const e = this.e;
    const need = [['noise', { color: 'pink', seconds: 6 }], ['noise', { color: 'brown', seconds: 6 }], ...this.def.buffers(this)];
    await Promise.all(need.map(([n, o]) => e.bank.load(n, o, 1).catch(() => null)));
    if (this.stopped) return;
    // Premières variantes des oiseaux et des animaux du décor, pour que les premiers chants ne manquent pas
    for (const [species] of SCENE_BIRDS[this.name] || []) for (let k = 0; k < 3; k++) e.bank.pool('song', { species }, 5);
    for (const n of SCENE_ANIMALS[this.name] || []) for (let k = 0; k < 2; k++) e.bank.pool(n, {}, n === 'gull' ? 4 : 3);
    this.gust = new Wander(this.r, 0, 1, { every: [1.2, 4.5], start: 0.4 });
    this.gustValue = 0.4;
    this.gustSinks = [];
    this.def.build(this);
    const t = e.ctx.currentTime;
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.linearRampToValueAtTime(1, t + 2.5);
    this.ready = true;
  }

  stop(fade = 2.5) {
    this.stopped = true;
    const c = this.e.ctx;
    const t = c.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => {
      for (const s of this.sources) {
        try {
          s.stop();
        } catch {
          /* rien */
        }
        s.disconnect();
      }
      for (const l of this.loops) l.voice?.stop(0.05);
      for (const n of this.nodes) n.disconnect();
      this.out.disconnect();
    }, fade * 1000 + 100);
  }

  // --- Briques ---
  gain(v = 1) {
    const g = this.e.ctx.createGain();
    g.gain.value = v;
    this.nodes.push(g);
    return g;
  }

  filter(type, f, q = 0.707) {
    const b = biquad(this.e.ctx, type, f, q);
    this.nodes.push(b);
    return b;
  }

  noise(color = 'pink', rate = 1) {
    const s = this.e.noise(color, { rate });
    if (s) this.sources.push(s);
    return s;
  }

  // Une boucle (bruit ou échantillon) -> chaîne de nœuds -> sortie de la scène.
  chain(src, ...nodes) {
    if (!src) return null;
    let n = src;
    for (const x of nodes) {
      n.connect(x);
      n = x;
    }
    n.connect(this.out);
    return n;
  }

  // Paramètre qui suit les rafales : value = lo + (hi - lo) * rafale^power
  onGust(param, lo, hi, power = 1, tau = 0.8) {
    this.gustSinks.push({ param, lo, hi, power, tau });
    param.value = lo + (hi - lo) * Math.pow(this.gustValue, power);
  }

  // Paramètre qui erre lentement entre deux bornes (vie de la nappe).
  wander(param, lo, hi, every = [2, 6]) {
    const w = new Wander(this.r, lo, hi, { every });
    param.value = w.value;
    this.mods.push({ w, param });
  }

  // Vent : souffle brun (grave) et rose (air) filtrés bas, dont le niveau et la brillance suivent les rafales.
  wind({ level = 0.3, lo = 350, hi = 1200, whistle = 0, hp = 70 } = {}) {
    const g = this.gain(level);
    const lp = this.filter('lowpass', lo, 0.5);
    this.chain(this.noise('pink', range(this.r, 0.85, 1)), this.filter('highpass', hp, 0.5), lp, g);
    this.onGust(g.gain, level * 0.35, level, 1.2, 1.4);
    this.onGust(lp.frequency, lo, hi, 1, 1.4);
    const body = this.gain(level * 0.8);
    this.chain(this.noise('brown', range(this.r, 0.9, 1)), this.filter('highpass', 35, 0.6), this.filter('lowpass', 260, 0.5), body);
    this.onGust(body.gain, level * 0.4, level * 0.8, 1.2, 1.6);
    if (whistle > 0) {
      // Chant du vent dans les rochers : bande assez large, très discrète, qui glisse avec les rafales
      const wg = this.gain(0);
      const bp = this.filter('bandpass', 650, 3.5);
      this.chain(this.noise('pink', 0.93), bp, wg);
      this.onGust(wg.gain, 0, whistle, 2.5, 1.6);
      this.onGust(bp.frequency, 450, 900, 1.5, 1.6);
    }
  }

  // Feuillage, roseaux, herbes : bruit rose dans le haut médium, plafonné vers 5 kHz, qui frémit avec les rafales.
  rustle(level = 0.06, f = 2600) {
    const g = this.gain(0);
    this.chain(this.noise('pink', 0.9), this.filter('highpass', f * 0.55, 0.6), this.filter('lowpass', 5000, 0.5), g);
    this.onGust(g.gain, level * 0.15, level, 1.8, 0.8);
  }

  // Boucle d'échantillon calculé (insectes, eau) : niveau qui vit lentement ; positionnée si pos est donnée.
  bed(name, opts, level, { pos = null, ref = 20, rolloff = 1, live = [0.65, 1], rate = 1, lowpass = 0 } = {}) {
    const buf = this.e.bank.get(name, opts);
    if (!buf) return null;
    const c = this.e.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start(c.currentTime, Math.random() * buf.duration);
    this.sources.push(src);
    const g = this.gain(level);
    if (live) this.wander(g.gain, level * live[0], level * live[1], [3, 8]);
    if (lowpass) src.connect(this.filter('lowpass', lowpass, 0.6)).connect(g);
    else src.connect(g);
    if (pos) {
      const p = this.e.panner({ ref, rolloff, max: 3000 });
      this.e.setPos(p, pos);
      this.nodes.push(p);
      p.connect(this.out);
      // Source lointaine (plus de 40 fois sa distance de référence) : débranchée, elle ne coûte rien.
      this.gates.push({ g, p, pos, radius: Math.max(120, ref * 40), on: false });
    } else g.connect(this.out);
    return g;
  }

  // Événement ponctuel sur le bus d'ambiance.
  spawn(buf, o) {
    return buf ? this.e.play(buf, { bus: 'ambience', ...o }) : null;
  }

  after(sec, fn) {
    this.timers.push({ t: sec, fn });
  }

  clock(name, mean, opts) {
    return (this.clocks[name] ||= new EventClock(this.r, mean, opts));
  }

  // Point au hasard autour de l'auditeur (distance d, hauteur h).
  around(d, h = 0) {
    const l = this.e.listener;
    const a = this.r() * TAU;
    return { x: l.x + Math.cos(a) * d, y: l.y + h, z: l.z + Math.sin(a) * d };
  }

  update(dt, info) {
    if (!this.ready || this.stopped) return;
    const t = this.e.ctx.currentTime;
    const g = this.gust.tick(dt);
    if (g) {
      this.gustValue = g.target;
      for (const s of this.gustSinks) s.param.setTargetAtTime(s.lo + (s.hi - s.lo) * Math.pow(g.target, s.power), t, Math.max(0.2, g.time * 0.3 * s.tau));
    }
    if ((this.gateLeft -= dt) <= 0) {
      this.gateLeft = 0.5;
      for (const gt of this.gates) {
        const want = this.e.distanceTo(gt.pos) < gt.radius;
        if (want && !gt.on) gt.g.connect(gt.p);
        else if (!want && gt.on) gt.g.disconnect();
        gt.on = want;
      }
    }
    for (const m of this.mods) {
      const x = m.w.tick(dt);
      if (x) m.param.setTargetAtTime(x.target, t, x.time * 0.4);
    }
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        tm.fn();
      }
    }
    this.def.update(this, dt, info);
  }

  // --- Événements communs ---
  // Oiseau : dans les arbres à 25-90 m (jamais collé à l'oreille), adouci par la distance, un peu de réverbération.
  bird(rate = 1) {
    const species = pickBird(this.name, this.r);
    const buf = this.e.bank.pool('song', { species }, 5);
    if (!buf) return;
    // Pas plus de deux chants à la fois : au-delà, celui-ci attend son tour.
    if (this.e.voices.size > this.e.maxVoices * 0.6) return;
    const high = species === 'skylark';
    const d = high ? range(this.r, 40, 70) : range(this.r, 25, 90);
    const pos = this.around(d, high ? range(this.r, 30, 50) : range(this.r, 3, 12));
    this.spawn(buf, { pos, ref: 14, rolloff: 1, gain: (BIRD_GAIN[species] ?? 0.35) * range(this.r, 0.6, 1), rate: range(this.r, 0.95, 1.05), wet: 0.4, radius: 140 });
    // Un congénère répond parfois d'un autre arbre, plus loin
    if (chance(this.r, 0.2 * rate)) {
      this.after(range(this.r, 0.8, 2.6), () => {
        const b2 = this.e.bank.pool('song', { species }, 5);
        this.spawn(b2, { pos: this.around(range(this.r, 40, 100), range(this.r, 3, 12)), ref: 14, gain: (BIRD_GAIN[species] ?? 0.35) * range(this.r, 0.45, 0.75), rate: range(this.r, 0.95, 1.05), wet: 0.45, radius: 140 });
      });
    }
  }

  animal(name, pos, { gain = 0.5, ref = 12, wet = 0.3, rate = [0.96, 1.04], pool = 3 } = {}) {
    const buf = this.e.bank.pool(name, {}, pool);
    this.spawn(buf, { pos, ref, rolloff: 1, gain, rate: range(this.r, rate[0], rate[1]), wet, radius: 400 });
  }
}

// =====================================================================
// Décors
// =====================================================================
const near = (scene, p, radius) => p && scene.e.distanceTo(p) < radius;

const SCENES = {
  meadow: {
    buffers: () => [['insects', { kind: 'meadow', seconds: 8 }]],
    build(s) {
      s.wind({ level: 0.55, lo: 300, hi: 800 });
      s.rustle(0.07);
      s.bed('insects', { kind: 'meadow', seconds: 8 }, 0.1, { lowpass: 7000 });
      s.bed('insects', { kind: 'meadow', seconds: 8 }, 0.065, { rate: 0.913, lowpass: 7000 }); // autre vitesse : pas de motif qui revient
    },
    update(s, dt, info) {
      const calm = info.speed < 6 ? 1 : 0.7;
      if (s.clock('bird', 6.5, { min: 2.5 }).tick(dt, calm)) s.bird();
      if (s.clock('cuckoo', 45, { min: 20 }).tick(dt)) {
        const buf = s.e.bank.pool('song', { species: 'cuckoo' }, 2);
        s.spawn(buf, { pos: s.around(range(s.r, 110, 220), 10), ref: 60, rolloff: 1, gain: 0.4, wet: 0.5, rate: range(s.r, 0.97, 1.03) });
      }
      if (s.clock('bee', 28, { min: 10 }).tick(dt) && info.speed < 4) {
        const buf = s.e.bank.pool('bee', {}, 3);
        s.spawn(buf, { gain: 0.14, rate: range(s.r, 0.92, 1.08) });
      }
      farm(s, dt);
    },
  },
  alpine: {
    buffers: () => [['water', STREAM]],
    build(s) {
      s.wind({ level: 0.48, lo: 200, hi: 900, whistle: 0.04 }); // au-dessus des arbres : rafales graves, peu de feuillage
      s.rustle(0.013, 3200);
      s.bed('water', STREAM, 0.066, { live: [0.6, 1], lowpass: 3500 });
      if (s.spots.stream) s.bed('water', STREAM, 1, { pos: s.spots.stream, ref: 40, rolloff: 1, lowpass: 3500 });
      if (s.spots.fountain) s.bed('water', STREAM, 0.4, { pos: s.spots.fountain, ref: 3, rolloff: 1.4, rate: 1.4, lowpass: 4000 });
      s.cows = (s.spots.cows || []).map((herd) => ({
        ...herd,
        cows: herd.bells.map((f0) => ({ f0, mode: 'graze', t: range(s.r, 0, 3), walk: 0, pos: pick(s.r, herd.points) })),
      }));
      for (const herd of s.cows) for (const cow of herd.cows) for (const double of [false, true]) s.e.bank.load('cowbell', { f0: cow.f0, double }).catch(() => {});
      s.e.bank.load('church', { nominal: 440 }).catch(() => {});
      s.e.bank.load('church', { nominal: 392 }).catch(() => {});
    },
    update(s, dt, info) {
      if (s.clock('bird', 9, { min: 3 }).tick(dt)) s.bird();
      if (s.clock('marmot', 50, { min: 20 }).tick(dt)) {
        const buf = s.e.bank.pool('song', { species: 'marmot' }, 2);
        s.spawn(buf, { pos: s.around(range(s.r, 70, 150), range(s.r, 5, 25)), ref: 30, gain: 0.3, wet: 0.65 });
      }
      if (s.clock('raptor', 60, { min: 25 }).tick(dt)) {
        const buf = s.e.bank.pool('raptor', {}, 2);
        s.spawn(buf, { pos: s.around(range(s.r, 120, 260), range(s.r, 60, 140)), ref: 80, gain: 0.3, wet: 0.7 });
      }
      cowbells(s, dt);
      churchBell(s, dt);
      void info;
    },
  },
  coast: {
    buffers: () => [['insects', { kind: 'cicada', seconds: 8 }], ['crowd', { excited: false, seconds: 6 }]],
    build(s) {
      s.wind({ level: 0.24, lo: 400, hi: 1000, whistle: 0.012 });
      // Grondement continu de la mer : plus fort près du rivage
      s.surf = s.gain(0.24);
      s.chain(s.noise('brown', 0.9), s.filter('lowpass', 380, 0.6), s.surf);
      // Souffle lointain des rouleaux (large bande, plus doux que le grondement)
      const hiss = s.gain(0.05);
      s.chain(s.noise('pink', 0.7), s.filter('bandpass', 800, 0.5), s.filter('lowpass', 2500, 0.6), hiss);
      s.wander(hiss.gain, 0.025, 0.065, [2, 6]);
      s.cicadas = s.bed('insects', { kind: 'cicada', seconds: 8 }, 0.06, { live: null, lowpass: 6500 });
      s.cicadas2 = s.bed('insects', { kind: 'cicada', seconds: 8 }, 0.04, { live: null, rate: 1.071, lowpass: 6500 });
      if (s.spots.beach) s.bed('crowd', { excited: false, seconds: 6 }, 0.3, { pos: s.spots.beach, ref: 16, rolloff: 1.1, lowpass: 3000 });
    },
    update(s, dt, info) {
      const cfg = s.spots.coast;
      const l = s.e.listener;
      const shore = cfg ? Math.max(0, coastZ(cfg, l.x) - l.z) : 200;
      const t = s.e.ctx.currentTime;
      if (s.updLeft === undefined || (s.updLeft -= dt) <= 0) {
        s.updLeft = 0.25;
        // La mer s'entend de partout sur ce circuit, et gronde quand on longe la plage.
        const k = Math.max(0.4, Math.min(1, 50 / (shore + 15)));
        s.surf.gain.setTargetAtTime(0.48 * k, t, 0.6);
        const inland = Math.min(1, Math.max(0.2, (shore - 20) / 60));
        if (s.cicadas) s.cicadas.gain.setTargetAtTime(0.07 * inland, t, 0.8);
        if (s.cicadas2) s.cicadas2.gain.setTargetAtTime(0.045 * inland, t, 0.8);
      }
      if (cfg && s.clock('wave', 8.5, { min: 6, max: 13 }).tick(dt)) wave(s, cfg);
      if (s.clock('gull', 14, { min: 5 }).tick(dt)) gull(s, cfg);
      if (s.clock('bird', 14, { min: 5 }).tick(dt)) s.bird();
      void info;
    },
  },
  lake: {
    buffers: () => [['lapping', { seconds: 8 }]],
    build(s) {
      s.wind({ level: 0.36, lo: 350, hi: 800 });
      s.bed('lapping', { seconds: 8 }, 1.1);
      s.bed('lapping', { seconds: 8 }, 0.75, { rate: 0.887 });
      s.rustle(0.06, 2200); // roseaux des berges
    },
    update(s, dt) {
      if (s.clock('bird', 7, { min: 2.5 }).tick(dt)) s.bird();
      if (s.clock('duck', 18, { min: 6 }).tick(dt)) {
        const l = s.e.listener;
        const bank = s.world.rowing?.bank ?? 60;
        const side = chance(s.r, 0.5) ? 1 : -1;
        s.animal('duck', { x: side * range(s.r, bank - 12, bank + 2), y: 0.3, z: l.z + range(s.r, -40, 90) }, { gain: 0.4, ref: 10 });
      }
      if (s.clock('cuckoo', 60, { min: 25 }).tick(dt)) {
        const buf = s.e.bank.pool('song', { species: 'cuckoo' }, 2);
        s.spawn(buf, { pos: s.around(range(s.r, 150, 260), 12), ref: 60, gain: 0.38, wet: 0.5 });
      }
    },
  },
  river: {
    buffers: () => [['water', RAPIDS]],
    build(s) {
      s.wind({ level: 0.12, lo: 400, hi: 900 });
      s.bed('water', RAPIDS, 0.5, { lowpass: 3500 });
      const roar = s.gain(0.2);
      s.chain(s.noise('pink', 0.8), s.filter('highpass', 100, 0.6), s.filter('lowpass', 1400, 0.6), roar);
      s.chain(s.noise('brown', 0.85), s.filter('lowpass', 300, 0.6), s.gain(0.2));
      s.wander(roar.gain, 0.13, 0.27, [1.5, 4]);
    },
    update(s, dt) {
      if (s.clock('bird', 10, { min: 4 }).tick(dt)) s.bird();
      if (s.clock('white', 3, { min: 0.8 }).tick(dt)) {
        const buf = s.e.bank.pool('splash', { size: 1.4 }, 4);
        s.spawn(buf, { gain: range(s.r, 0.05, 0.12), pan: range(s.r, -0.9, 0.9), rate: range(s.r, 0.8, 1.05), lowpass: 3500, wet: 0.2 });
      }
    },
  },
};

const STREAM = { seconds: 6, rate: 320, fmin: 300, fmax: 2600, noise: 0.4, noiseLp: 1800 };
const RAPIDS = { seconds: 6, rate: 650, fmin: 180, fmax: 3200, noise: 0.9, noiseLp: 2600 };

// Ferme : vaches, moutons qui se répondent, chevaux, coq près de la grange.
function farm(s, dt) {
  const f = s.spots.farm;
  if (!near(s, f?.center, f?.radius ?? 0)) return;
  if (s.clock('cow', 14, { min: 5 }).tick(dt)) s.animal('cow', pick(s.r, f.points), { gain: 0.5, ref: 14 });
  if (s.clock('sheep', 11, { min: 3 }).tick(dt)) {
    s.animal('sheep', pick(s.r, f.points), { gain: 0.36, ref: 10 });
    if (chance(s.r, 0.35)) s.after(range(s.r, 0.6, 1.8), () => s.animal('sheep', pick(s.r, f.points), { gain: 0.3, ref: 10, rate: [1.02, 1.12] }));
  }
  if (s.clock('horse', 24, { min: 8 }).tick(dt)) s.animal('horse', pick(s.r, f.points), { gain: 0.36, ref: 10 });
  if (s.clock('rooster', 40, { min: 15 }).tick(dt)) s.animal('rooster', f.barn, { gain: 0.35, ref: 16, wet: 0.4 });
}

// Sonnailles : chaque vache broute (coup isolé de temps en temps) ou marche (série de coups irréguliers).
// Densité plafonnée (réserve de coups qui se remplit à 2,5 par seconde) : un tintement paisible, pas un carillon.
function cowbells(s, dt) {
  s.bellBudget = Math.min(3, (s.bellBudget ?? 3) + dt * 2.5);
  for (const herd of s.cows || []) {
    if (!near(s, herd.center, 190)) continue;
    for (const cow of herd.cows) {
      cow.t -= dt;
      if (cow.t > 0) continue;
      if (s.bellBudget >= 1) {
        s.bellBudget -= 1;
        const double = chance(s.r, cow.mode === 'walk' ? 0.3 : 0.12);
        const buf = s.e.bank.get('cowbell', { f0: cow.f0, double });
        s.spawn(buf, { pos: cow.pos, ref: 5, rolloff: 1.25, gain: range(s.r, 0.2, 0.45) * (cow.mode === 'walk' ? 1 : 0.7), rate: range(s.r, 0.995, 1.005), wet: 0.35, radius: 200 });
      }
      if (cow.mode === 'walk') {
        cow.t = range(s.r, 0.45, 0.9);
        cow.walk -= cow.t;
        if (cow.walk <= 0) cow.mode = 'graze';
        if (chance(s.r, 0.2)) cow.pos = pick(s.r, herd.points);
      } else {
        cow.t = nextDelay(s.r, 7, 2, 16);
        if (chance(s.r, 0.08)) {
          cow.mode = 'walk';
          cow.walk = range(s.r, 1.5, 4);
          cow.t = range(s.r, 0.2, 0.5);
        }
      }
    }
  }
}

// Cloche de l'église du village : volée en arrivant, puis quelques coups de temps en temps.
function churchBell(s, dt) {
  const ch = s.spots.church;
  if (!ch) return;
  const d = s.e.distanceTo(ch);
  if (d > 700) return;
  const ring = (n) => {
    for (let k = 0; k < n; k++) {
      s.after(k * range(s.r, 2.1, 2.5), () => {
        const buf = s.e.bank.get('church', { nominal: k % 2 && n > 4 ? 392 : 440 });
        s.spawn(buf, { pos: ch, ref: 45, rolloff: 0.7, gain: 0.5, wet: 0.55, priority: 1.5 });
      });
    }
  };
  if (!s.rang && d < 450 && s.e.bank.get('church', { nominal: 440 }) && s.e.bank.get('church', { nominal: 392 })) {
    s.rang = true;
    ring(irange(s.r, 6, 8));
    s.clock('church', 80, { min: 50, max: 140, first: 70 });
    return;
  }
  if (s.rang && s.clock('church', 80, { min: 50, max: 140 }).tick(dt)) ring(irange(s.r, 3, 5));
}

// Vague qui déferle : montée sourde, éclatement large bande, puis l'écume qui se retire en chuintant.
// Construite en temps réel (deux bruits filtrés automatisés) : aucune vague n'est identique.
function wave(s, cfg) {
  const e = s.e;
  if (!e.canPlay(true)) return;
  const c = e.ctx;
  const l = e.listener;
  const x = l.x + range(s.r, -50, 50);
  const pos = { x, y: cfg.seaY + 0.6, z: coastZ(cfg, x) + range(s.r, 0, 8) };
  const size = range(s.r, 0.5, 1);
  const t0 = c.currentTime + 0.05;
  const build = range(s.r, 1.4, 2.6);
  const tc = t0 + build;
  const tail = range(s.r, 3, 5.5);
  const body = e.noise('pink', range(s.r, 0.8, 1));
  const foam = e.noise('pink', 1.1);
  if (!body || !foam) return;
  const lp = biquad(c, 'lowpass', 220);
  lp.frequency.setValueAtTime(220, t0);
  lp.frequency.exponentialRampToValueAtTime(800, tc - 0.15);
  lp.frequency.linearRampToValueAtTime(1100 + 1900 * size, tc + 0.08);
  lp.frequency.setTargetAtTime(600, tc + 0.25, 1.1);
  const g = c.createGain();
  g.gain.value = 0; // silence jusqu'au départ programmé (la source tourne déjà)
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.22 * size, tc - 0.2);
  g.gain.linearRampToValueAtTime(0.85 * size, tc + 0.1);
  g.gain.setTargetAtTime(0, tc + 0.3, tail / 3);
  // Écume qui se retire : chuintement doux (bruit rose entre 1,2 et 4 kHz), jamais sifflant
  const hp = biquad(c, 'highpass', 1200);
  hp.frequency.setValueAtTime(1200, t0);
  hp.frequency.linearRampToValueAtTime(2200, tc + tail);
  const flp = biquad(c, 'lowpass', 4000, 0.6);
  const g2 = c.createGain();
  g2.gain.value = 0;
  g2.gain.setValueAtTime(0, t0);
  g2.gain.setValueAtTime(0, tc + 0.1);
  g2.gain.linearRampToValueAtTime(0.22 * size, tc + 0.5);
  g2.gain.setTargetAtTime(0, tc + 0.75, tail / 2.6);
  const pan = e.panner({ ref: 45, rolloff: 1, max: 3000 });
  e.setPos(pan, pos);
  body.connect(lp).connect(g).connect(pan);
  foam.connect(hp).connect(flp).connect(g2).connect(pan);
  pan.connect(s.out);
  const wet = c.createGain();
  wet.gain.value = 0.3;
  pan.connect(wet).connect(e.wet.ambience);
  const end = tc + tail * 1.7;
  body.stop(end);
  foam.stop(end);
  e.adopt([body, foam], [g, lp, g2, hp, flp, pan, wet], { spatial: true });
}

function gull(s, cfg) {
  const l = s.e.listener;
  const z = cfg ? coastZ(cfg, l.x) + range(s.r, -30, 110) : l.z + range(s.r, -60, 60);
  const n = chance(s.r, 0.3) ? irange(s.r, 2, 3) : 1;
  for (let k = 0; k < n; k++) {
    s.after(k * range(s.r, 0.4, 1.5), () => {
      const buf = s.e.bank.pool('gull', {}, 4);
      s.spawn(buf, { pos: { x: l.x + range(s.r, -90, 90), y: l.y + range(s.r, 12, 40), z }, ref: 22, rolloff: 1, gain: range(s.r, 0.25, 0.45), rate: range(s.r, 0.93, 1.07), wet: 0.35, radius: 300 });
    });
  }
}

// =====================================================================
export class Ambience {
  constructor(engine) {
    this.e = engine;
    this.scene = null;
    this.key = null;
    this.r = rng((Math.random() * 4294967296) >>> 0);
  }

  // name : meadow | alpine | coast | lake | river ; world : { id, spots, rowing }
  set(name, world = {}) {
    const key = `${name}:${world.id ?? ''}`;
    if (key === this.key || !this.e.ctx) return;
    this.key = key;
    this.scene?.stop(2.5);
    // Boucles et cloches propres au décor quitté : libérées (recalculées si on y revient)
    const prev = this.scene?.name;
    if (prev && prev !== name) {
      setTimeout(() => {
        const b = this.e.bank;
        b.evict((k) => SCENE_ONLY.test(k) && !this.keep(k));
        // Variantes d'oiseaux et d'animaux qui ne chantent pas dans le nouveau décor
        const sc = this.scene?.name;
        const birds = new Set([...(SCENE_BIRDS[sc] || []).map(([sp]) => sp), 'cuckoo', 'marmot']);
        const animals = new Set(SCENE_ANIMALS[sc] || []);
        b.evictPools((k) => {
          const m = /^song\{"species":"(\w+)"\}$/.exec(k);
          if (m) return !birds.has(m[1]);
          const n = /^(\w+)/.exec(k)[1];
          return ['cow', 'sheep', 'horse', 'rooster', 'bee', 'raptor', 'gull', 'duck'].includes(n) && !animals.has(n);
        });
      }, 3000);
    }
    this.scene = new Scene(this.e, name, world, this.r);
    this.scene.start();
    this.e.setReverb(SCENE_REVERB[name] || 'meadow');
  }

  update(dt, info) {
    this.scene?.update(dt, info);
  }

  // Le décor courant a-t-il encore besoin de ce son ?
  keep(key) {
    const s = this.scene;
    if (!s) return false;
    const need = s.def.buffers(s).map(([n, o]) => `${n}${JSON.stringify(o)}`);
    if (need.includes(key)) return true;
    return s.name === 'alpine' && /^(cowbell|church|water)/.test(key);
  }
}

const SCENE_ONLY = /^(insects|water|lapping|cowbell|church)/;
