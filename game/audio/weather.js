// Sons de la météo, pilotés à chaque image comme les sons du joueur (quelques gains modulés, aucun nœud créé
// par image) : pluie sur les feuilles et sur la route, grondement des fortes averses, vent qui suit sa force
// (plus fort de face), tonnerre rare sous forte pluie, chuintement des pneus sur route mouillée.
// Tout est débranché du mixage quand il ne pleut pas et qu'il n'y a pas de vent : rien ne coûte alors.
import { biquad } from './engine.js';
import { rng, range, EventClock } from './random.js';
import { smoothstep } from './dsp.js';

const RAIN_LEAVES = { seconds: 4, kind: 'leaves' };
const RAIN_ROAD = { seconds: 4, kind: 'road' };
// Part du feuillage selon le décor (forêts en prairie et en montagne, peu d'arbres au bord de mer).
const LEAFY = { meadow: 1, alpine: 0.8, coast: 0.35, lake: 0.6, river: 0.8 };
// Réglage du mélange (bus ambiance pour la pluie et le vent, bus effets pour les pneus).
const TRIM = { leaves: 0.5, road: 0.38, heavy: 0.2, wind: 0.34, whistle: 0.1, hiss: 0.24 };

function gain(c, v = 0) {
  const g = c.createGain();
  g.gain.value = v;
  return g;
}

// Paramètres purs (testés) : niveaux visés pour un état de météo donné.
// w : { on, rain, wet, wind, head, gust, theme } ; speed : vitesse du joueur (m/s) ; riding : il roule.
export function weatherMix(w, speed = 0, riding = false) {
  if (!w || !w.on) return { leaves: 0, road: 0, heavy: 0, wind: 0, windFreq: 300, whistle: 0, whistleFreq: 700, hiss: 0 };
  const rain = Math.max(0, Math.min(1, w.rain || 0));
  const leafy = LEAFY[w.theme] ?? 0.8;
  const k = Math.min(1.3, (w.wind || 0) / 9);
  const face = 1 + 0.7 * Math.min(1, (w.head || 0) / Math.max(1, w.wind || 0));
  const gust = 0.8 + 0.3 * Math.max(0, Math.min(2, (w.gust ?? 1) - 0.5));
  const go = riding ? Math.min(1, Math.max(0, speed) / 10) : 0;
  return {
    leaves: Math.pow(rain, 1.1) * leafy * TRIM.leaves,
    road: Math.pow(rain, 1.2) * TRIM.road,
    heavy: smoothstep(0.4, 1, rain) * TRIM.heavy,
    wind: Math.pow(k, 1.6) * face * gust * TRIM.wind,
    windFreq: 240 + (w.wind || 0) * 70 + (w.head || 0) * 35,
    whistle: Math.max(0, k - 0.55) * face * TRIM.whistle,
    whistleFreq: 600 + (w.wind || 0) * 45,
    hiss: Math.max(0, Math.min(1, w.wet || 0)) * Math.pow(go, 1.2) * TRIM.hiss,
  };
}

export class WeatherSounds {
  // play(nom, options) : joue un effet du catalogue (tonnerre).
  constructor(engine, play) {
    this.e = engine;
    this.play = play;
    this.ready = false;
    this.on = false;
    this.idle = 0;
    this.r = rng((Math.random() * 4294967296) >>> 0);
    this.thunder = new EventClock(this.r, 38, { min: 14, max: 90, first: 12 });
  }

  async build() {
    if (this.building) return this.building;
    const b = this.e.bank;
    const need = [['noise', { color: 'pink', seconds: 6 }], ['noise', { color: 'white', seconds: 6 }], ['rain', RAIN_LEAVES], ['rain', RAIN_ROAD]];
    this.building = Promise.all(need.map(([n, o]) => b.load(n, o, 1))).then(() => this.make()).catch(() => {});
    return this.building;
  }

  loop(name, opts, rate = 1) {
    const c = this.e.ctx;
    const src = c.createBufferSource();
    src.buffer = this.e.bank.get(name, opts);
    src.loop = true;
    src.playbackRate.value = rate;
    src.start(c.currentTime, Math.random() * src.buffer.duration);
    return src;
  }

  make() {
    const e = this.e;
    const c = e.ctx;
    this.amb = gain(c, 1);
    this.fx = gain(c, 1);
    const g = (this.g = {});
    this.sources = [this.loop('rain', RAIN_LEAVES), this.loop('rain', RAIN_ROAD, 0.97), e.noise('pink', 0.8), e.noise('pink', 0.93), e.noise('white', 1.03)];
    const [leaves, road, pinkA, pinkB, white] = this.sources;
    leaves.connect((g.leaves = gain(c))).connect(this.amb);
    road.connect((g.road = gain(c))).connect(this.amb);
    // Grondement de l'averse : bruit rose grave
    pinkA.connect(biquad(c, 'lowpass', 700, 0.5)).connect((g.heavy = gain(c))).connect(this.amb);
    // Vent : souffle large bande qui s'éclaircit avec la force, sifflement dans les rafales
    this.windLp = biquad(c, 'lowpass', 400, 0.5);
    pinkB.connect(biquad(c, 'highpass', 60, 0.5)).connect(this.windLp).connect((g.wind = gain(c))).connect(this.amb);
    this.whistleBp = biquad(c, 'bandpass', 700, 8);
    pinkB.connect(this.whistleBp).connect((g.whistle = gain(c))).connect(this.amb);
    // Pneus sur route mouillée : chuintement aigu d'eau chassée
    white.connect(biquad(c, 'highpass', 1600, 0.6)).connect(biquad(c, 'bandpass', 3800, 0.7)).connect((g.hiss = gain(c))).connect(this.fx);
    this.ready = true;
  }

  setActive(on) {
    if (!this.ready || on === this.on) return;
    this.on = on;
    const t = this.e.ctx.currentTime;
    if (on) {
      for (const [n, bus] of [[this.amb, 'ambience'], [this.fx, 'sfx']]) {
        n.gain.setValueAtTime(0, t);
        n.connect(this.e.buses[bus]);
        n.gain.linearRampToValueAtTime(1, t + 1.2);
      }
    } else {
      this.amb.gain.setTargetAtTime(0, t, 0.3);
      this.fx.gain.setTargetAtTime(0, t, 0.3);
      clearTimeout(this.offTimer);
      this.offTimer = setTimeout(() => {
        if (this.on) return;
        this.amb.disconnect();
        this.fx.disconnect();
      }, 1500);
    }
  }

  // w : météo du jeu (game/weather.js, objet audio) ; speed : vitesse du joueur ; state : accueil, course...
  update(dt, w, speed, state, mode) {
    const riding = (state === 'race' || state === 'end') && mode === 'bike';
    const live = !!w?.on && state !== 'home';
    if (live && !this.ready) this.build();
    if (!this.ready) return;
    const m = weatherMix(live ? w : null, speed, riding);
    const loud = m.leaves + m.road + m.wind + m.hiss > 0.004;
    if (loud) {
      this.idle = 0;
      this.setActive(true);
    } else if (this.on && (this.idle += dt) > 2) this.setActive(false);
    if (!this.on) return;
    const t = this.e.ctx.currentTime;
    const T = (param, v, tau = 0.6) => {
      if (param._v !== undefined && Math.abs(param._v - v) <= Math.abs(v) * 0.02 + 1e-4) return;
      param._v = v;
      param.setTargetAtTime(v, t, tau);
    };
    const g = this.g;
    T(g.leaves.gain, m.leaves, 1.2);
    T(g.road.gain, m.road, 1.2);
    T(g.heavy.gain, m.heavy, 1.5);
    T(g.wind.gain, m.wind, 0.5);
    T(this.windLp.frequency, m.windFreq, 0.6);
    T(g.whistle.gain, m.whistle, 0.6);
    T(this.whistleBp.frequency, m.whistleFreq, 1);
    T(g.hiss.gain, m.hiss, 0.15);
    // Tonnerre, rare, seulement sous une forte averse et pendant la course.
    if (state === 'race' && (w?.rain ?? 0) > 0.65 && this.thunder.tick(dt)) {
      const near = this.r() < 0.3 ? 0.7 : 0.3;
      this.play('thunder', { near, gain: range(this.r, 0.55, 1) * (near > 0.5 ? 1 : 0.7), pan: range(this.r, -0.7, 0.7) });
    }
  }
}
