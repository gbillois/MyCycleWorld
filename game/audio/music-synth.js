// Instruments de la musique, calculés hors ligne dans le travailleur de rendu (module pur, testé dans
// tests/audio.test.js). Hors temps réel, on peut se payer la qualité : oscillateurs sans repliement
// (polyBLEP), voix désaccordées, filtre en échelle façon Moog (sans délai, stable même modulé), enveloppes
// sans clic, piano électrique en synthèse FM, cordes pincées (Karplus-Strong), percussions modales,
// batterie synthétisée en couches (grosse caisse avec glissé et clic, caisse claire peau + timbre,
// charleston métallique), chorus stéréo, compresseur de bus et limiteur doux.
// Tout est écrit dans des Float32Array à 32 kHz ; le temps est en échantillons.
import { TAU, clamp, mtof, Filter, OnePole, panGains } from './dsp.js';

// Tangente hyperbolique approchée (fraction rationnelle) : saturation douce bon marché.
export function sat(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

// --- Filtre en échelle (4 pôles, 24 dB/octave), forme « sans délai » (Zavalishin) ---
// res 0..1 (auto-oscillation vers 1, on reste sous 0,5), drive : saturation de l'entrée (chaleur).
export class Ladder {
  constructor(sr, fc = 1000, res = 0, drive = 1) {
    this.sr = sr;
    this.s1 = this.s2 = this.s3 = this.s4 = 0;
    this.drive = drive;
    this.set(fc, res);
  }
  set(fc, res = this.res) {
    const g = Math.tan((Math.PI * clamp(fc, 20, this.sr * 0.45)) / this.sr);
    this.G = g / (1 + g);
    this.res = res;
    this.k = 4 * res;
    // Compensation du grave perdu avec la résonance
    this.comp = 1 + 0.5 * this.k;
  }
  process(x) {
    const G = this.G;
    const G2 = G * G;
    const b = 1 - G;
    const S = G2 * G * b * this.s1 + G2 * b * this.s2 + G * b * this.s3 + b * this.s4;
    let u = (x * this.comp - this.k * S) / (1 + this.k * G2 * G2);
    u = sat(u * this.drive) / this.drive;
    let v = (u - this.s1) * G;
    let y = v + this.s1;
    this.s1 = y + v;
    v = (y - this.s2) * G;
    y = v + this.s2;
    this.s2 = y + v;
    v = (y - this.s3) * G;
    y = v + this.s3;
    this.s3 = y + v;
    v = (y - this.s4) * G;
    y = v + this.s4;
    this.s4 = y + v;
    return y;
  }
}

// --- Enveloppe ADSR incrémentale (attaque en arc de sinus, décroissances exponentielles) ---
// a : attaque (s), d : constante de temps du déclin (s), s : maintien 0..1, r : constante de relâchement (s),
// gate : durée de la note (échantillons). next() renvoie le niveau suivant.
export class Env {
  constructor(sr, { a = 0.005, d = 0.3, s = 0.7, r = 0.2 } = {}, gate = Infinity, start = 0) {
    this.A = Math.max(1, Math.round(a * sr));
    this.kd = Math.exp(-1 / Math.max(1, d * sr));
    this.kr = Math.exp(-1 / Math.max(1, r * sr));
    this.s = s;
    this.gate = gate;
    this.i = 0;
    this.x = 1;
    this.lev = 0;
    this.from = start;
    this.rel = -1;
  }
  next() {
    const i = this.i++;
    if (i >= this.gate) {
      if (this.rel < 0) this.rel = this.lev;
      this.rel *= this.kr;
      return this.rel;
    }
    if (i < this.A) {
      const u = Math.sin((Math.PI / 2) * (i / this.A));
      this.lev = this.from + (1 - this.from) * u * u;
    } else {
      this.x *= this.kd;
      this.lev = this.s + (1 - this.s) * this.x;
    }
    return this.lev;
  }
  // Niveau courant (pendant l'attaque, le maintien ou le relâchement)
  get level() {
    return this.rel >= 0 ? this.rel : this.lev;
  }
  // Relâchement anticipé (note étouffée par la suivante)
  release(at) {
    if (at < this.gate) this.gate = at;
  }
}

// Durée utile d'un relâchement de constante r (jusqu'à -80 dB).
export const tailOf = (r) => r * 9.2;

// Oscillateur en dent de scie sans repliement : renvoie la valeur et avance la phase (tableau ph[k]).
function blepSaw(ph, k, dt) {
  const p = ph[k];
  let v = 2 * p - 1;
  if (p < dt) {
    const t = p / dt;
    v -= t + t - t * t - 1;
  } else if (p > 1 - dt) {
    const t = (p - 1) / dt;
    v -= t * t + t + t + 1;
  }
  let q = p + dt;
  if (q >= 1) q -= 1;
  ph[k] = q;
  return v;
}

function blep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

const cents = (c) => Math.pow(2, c / 1200);

// =====================================================================
// Nappe : par note, trois dents de scie désaccordées ouvertes en stéréo, filtre en échelle par canal
// qui s'ouvre lentement (gonflement) avec une respiration très lente. ev : { t, n, notes, v }.
// p : { a, r, cutoff, swell, detune, res, bright, air }
// =====================================================================
export function renderPad(out, sr, ev, p, r) {
  const { l, r: rr } = out;
  const len = l.length;
  const t0 = ev.t;
  const tail = Math.round(tailOf(p.r ?? 0.6) * sr);
  const m = Math.min(len - t0, ev.n + tail);
  if (m <= 0) return;
  const det = p.detune ?? 9;
  const U = [-det, det * 0.15, det];
  const PAN = [-0.75, 0.05, 0.75];
  const ph = [];
  const dts = [];
  const gl = [];
  const gr = [];
  for (const note of ev.notes) {
    const f = mtof(note);
    U.forEach((c, u) => {
      ph.push(r());
      dts.push((f * cents(c + (r() - 0.5) * 3)) / sr);
      const [a, b] = panGains(PAN[u]);
      gl.push(a);
      gr.push(b);
    });
  }
  const V = ph.length;
  const norm = (ev.v ?? 1) / Math.sqrt(V);
  const env = new Env(sr, { a: p.a ?? 0.4, d: 1, s: 1, r: p.r ?? 0.6 }, ev.n);
  const fl = new Ladder(sr, p.cutoff ?? 1200, p.res ?? 0.12, 1.4);
  const fr = rr ? new Ladder(sr, p.cutoff ?? 1200, p.res ?? 0.12, 1.4) : null;
  const swell = p.swell ?? 0.6;
  const base = p.cutoff ?? 1200;
  const kSwell = Math.exp(-1 / (sr * (p.swellTime ?? 1.2)));
  const lfoW = (TAU * 0.13) / sr;
  const lfo0 = r() * TAU;
  let sw = 0;
  for (let i = 0; i < m; i++) {
    if ((i & 31) === 0) {
      const fc = base * (0.55 + swell * (1 - sw)) * (1 + 0.08 * Math.sin(lfo0 + lfoW * i));
      fl.set(fc);
      fr?.set(fc);
    }
    sw = i < ev.n ? sw * kSwell : sw;
    if (i === 0) sw = 1;
    const e = env.next() * norm;
    if (!rr) {
      // Nappe mono (l'élargissement stéréo se fait au mixage, par un chorus)
      let sm = 0;
      for (let k = 0; k < V; k++) sm += blepSaw(ph, k, dts[k]);
      l[t0 + i] += fl.process(sm * 0.7071) * e;
      continue;
    }
    let sl = 0;
    let sr2 = 0;
    for (let k = 0; k < V; k++) {
      const v = blepSaw(ph, k, dts[k]);
      sl += v * gl[k];
      sr2 += v * gr[k];
    }
    l[t0 + i] += fl.process(sl) * e;
    rr[t0 + i] += fr.process(sr2) * e;
  }
}

// =====================================================================
// Piano électrique (synthèse FM type « lame et résonateur ») : porteuse et modulateur au même rapport,
// indice qui retombe vite (attaque qui sonne puis s'adoucit), petite lame aiguë très brève, trémolo
// stéréo (pan alterné du « suitcase »). ev : { t, n, m, v, pan }.
// =====================================================================
export function renderEP(out, sr, ev, p, r) {
  const { l, r: rr } = out;
  const len = l.length;
  const f = mtof(ev.m);
  const vel = ev.v ?? 0.8;
  const decay = (p.decay ?? 1.6) * clamp(1.6 - (ev.m - 48) / 40, 0.6, 1.5);
  const rel = p.r ?? 0.25;
  const m = Math.min(len - ev.t, ev.n + Math.round(tailOf(rel) * sr));
  if (m <= 0) return;
  const env = new Env(sr, { a: 0.003, d: decay, s: 0, r: rel }, ev.n);
  const idx0 = (p.index ?? 1.4) * (0.5 + 0.7 * vel);
  const kIdx = Math.exp(-1 / (sr * 0.25));
  const kTine = Math.exp(-1 / (sr * 0.012));
  const wc = (TAU * f) / sr;
  const wt = (TAU * f * 6.98) / sr;
  const trem = (TAU * (p.trem ?? 4.6)) / sr;
  const depth = p.tremDepth ?? 0.25;
  const [pl, pr] = rr ? panGains(ev.pan ?? 0) : [1, 0];
  let idx = idx0;
  let tine = 0.05 * vel * (p.tine ?? 1);
  let pc = r() * TAU;
  const amp = 0.5 * vel;
  // Oscillateurs en phaseurs tournants (une multiplication complexe par échantillon au lieu d'un sinus)
  const cm = Math.cos(wc);
  const sm = Math.sin(wc);
  let ms = Math.sin(pc);
  let mc = Math.cos(pc);
  const ct = Math.cos(wt);
  const st = Math.sin(wt);
  let ts = 0;
  let tc = 1;
  const cq = Math.cos(trem);
  const sq = Math.sin(trem);
  let qs = Math.sin(trem * ev.t);
  let qc = Math.cos(trem * ev.t);
  for (let i = 0; i < m; i++) {
    const e = env.next();
    if (e < 1e-5 && i > ev.n) break;
    pc += wc;
    if (pc > 1e4) pc -= TAU * Math.floor(pc / TAU);
    const y = (Math.sin(pc + idx * ms) + tine * ts) * e * amp;
    let a = ms * cm + mc * sm;
    mc = mc * cm - ms * sm;
    ms = a;
    a = ts * ct + tc * st;
    tc = tc * ct - ts * st;
    ts = a;
    a = qs * cq + qc * sq;
    qc = qc * cq - qs * sq;
    qs = a;
    if ((i & 1023) === 1023) {
      // renormalisation (l'arrondi ferait dériver l'amplitude des phaseurs)
      let k = 1 / Math.hypot(ms, mc);
      ms *= k;
      mc *= k;
      k = 1 / Math.hypot(qs, qc);
      qs *= k;
      qc *= k;
    }
    idx = 0.25 * idx0 + (idx - 0.25 * idx0) * kIdx;
    tine *= kTine;
    const tr = qs * depth;
    if (!rr) {
      l[ev.t + i] += y * (1 + tr * 0.5);
      continue;
    }
    l[ev.t + i] += y * pl * (1 + tr);
    rr[ev.t + i] += y * pr * (1 - tr);
  }
}

// =====================================================================
// Corde pincée (Karplus-Strong étendu) : excitation filtrée selon la force du doigt, retard fractionnaire
// juste, perte et brillance qui dépendent de la hauteur, étouffement en fin de note (guitare, basse
// acoustique, guitare étouffée). ev : { t, n, m, v, pan }. p : { bright, decay, mute, body }
// =====================================================================
export function renderString(out, sr, ev, p, r) {
  const { l } = out;
  const rr = out.r;
  const len = l.length;
  const f = mtof(ev.m);
  const vel = ev.v ?? 0.8;
  const damp = p.damp ?? 0.5; // 0.5 = moyenne de deux échantillons (son classique)
  // Le filtre d'amortissement retarde la boucle de damp échantillon : on le retire pour rester juste
  const N = sr / f - damp;
  const size = Math.ceil(N) + 3;
  const line = new Float32Array(size);
  const pick = new OnePole((p.bright ?? 2600) * (0.5 + 0.6 * vel), sr);
  // Position du doigt : un peigne creuse quelques harmoniques (son moins « synthétique »)
  const pos = Math.max(1, Math.round(N * (p.pos ?? 0.13)));
  const ex = new Float32Array(size);
  for (let i = 0; i < size; i++) ex[i] = pick.process(r() * 2 - 1);
  const comb = p.comb ?? 0.45;
  for (let i = 0; i < size; i++) line[i] = ex[i] - comb * ex[(i + size - pos) % size];
  let mean = 0;
  for (let i = 0; i < size; i++) mean += line[i];
  mean /= size;
  for (let i = 0; i < size; i++) line[i] -= mean;
  const t60 = (p.decay ?? 2.5) * clamp(1.7 - (ev.m - 40) / 40, 0.5, 1.8);
  const loss = Math.pow(10, -3 / (t60 * f));
  const muteLoss = Math.pow(10, -3 / (0.08 * f));
  const m = Math.min(len - ev.t, ev.n + Math.round(0.12 * sr));
  if (m <= 0) return;
  const [pl, pr] = rr ? panGains(ev.pan ?? 0) : [1, 0];
  const amp = 0.55 * vel;
  let w = 0;
  let prev = 0;
  const A = Math.round(sr * 0.0015);
  // Fondamentale renforcée (contrebasse, guitare basse) : poids dans le grave sans brillance
  const subA = (p.sub ?? 0) * vel;
  const subW = (TAU * f) / sr;
  const subK = Math.exp(-1 / (sr * (p.subDecay ?? 0.6)));
  const subOff = Math.exp(-1 / (sr * 0.03));
  let subL = subA;
  for (let i = 0; i < m; i++) {
    let rp = w - N;
    while (rp < 0) rp += size;
    const i0 = Math.floor(rp);
    const fr = rp - i0;
    const a = line[i0 % size];
    const b = line[(i0 + 1) % size];
    const y = a + (b - a) * fr;
    const g = i < ev.n && !p.mute ? loss : p.mute ? Math.pow(10, -3 / ((p.muteT ?? 0.25) * f)) : muteLoss;
    const v = (y * (1 - damp) + prev * damp) * g;
    prev = y;
    line[w] = v;
    w = (w + 1) % size;
    let o = v * amp;
    if (subA) {
      o += Math.sin(subW * i) * subL;
      subL *= i < ev.n ? subK : subOff;
    }
    if (i < A) o *= i / A;
    if (i > m - 64) o *= (m - i) / 64;
    l[ev.t + i] += o * pl;
    if (rr) rr[ev.t + i] += o * pr;
  }
}

// =====================================================================
// Synthé « pluck » polyphonique (arpèges électro) : deux dents de scie désaccordées, filtre en échelle
// qui se referme vite après l'attaque. ev : { t, n, m, v, pan }. p : { cutoff, envHz, decay, r, detune }
// =====================================================================
export function renderPluck(out, sr, ev, p, r) {
  const { l, r: rr } = out;
  const len = l.length;
  const f = mtof(ev.m);
  const vel = ev.v ?? 0.8;
  const rel = p.r ?? 0.06;
  const m = Math.min(len - ev.t, ev.n + Math.round(tailOf(rel) * sr));
  if (m <= 0) return;
  const env = new Env(sr, { a: 0.002, d: (p.decay ?? 0.15) * 2.2, s: p.sustain ?? 0.15, r: rel }, ev.n);
  const lad = new Ladder(sr, p.cutoff ?? 500, p.res ?? 0.15, 1.3);
  const ph = [r(), r()];
  const d1 = f / sr;
  const d2 = (f * cents(p.detune ?? 7)) / sr;
  const kf32 = Math.exp(-32 / (sr * (p.decay ?? 0.15)));
  const [pl, pr] = rr ? panGains(ev.pan ?? 0) : [1, 0];
  let fe = 1;
  const amp = 0.45 * vel;
  const track = Math.pow(f / 440, 0.25);
  const c0 = p.cutoff ?? 500;
  const ce = (p.envHz ?? 2000) * (0.4 + 0.6 * vel);
  for (let i = 0; i < m; i++) {
    if ((i & 31) === 0) {
      lad.set((c0 + ce * fe) * track);
      fe *= kf32;
    }
    const e = env.next();
    if (e < 2e-4 && i > ev.n) break;
    const y = lad.process((blepSaw(ph, 0, d1) + blepSaw(ph, 1, d2)) * 0.5) * e * amp;
    l[ev.t + i] += y * pl;
    if (rr) rr[ev.t + i] += y * pr;
  }
}

// =====================================================================
// Percussion modale : somme de modes amortis (marimba, vibraphone, célesta, kalimba, steel-drum).
// Attaque de quelques millisecondes (maillet feutré), modes aigus plus courts.
// p.modes : [[rapport, amplitude, constante de temps (s)], ...], p.tremolo : moteur du vibraphone.
// =====================================================================
export function renderModal(out, sr, ev, p, r) {
  const { l } = out;
  const rr = out.r;
  const len = l.length;
  const f = mtof(ev.m);
  const vel = ev.v ?? 0.8;
  const [pl, pr] = rr ? panGains(ev.pan ?? 0) : [1, 0];
  const A = Math.max(1, Math.round(sr * (p.attack ?? 0.002)));
  const relK = Math.exp(-1 / (sr * (p.r ?? 0.12)));
  const maxT = Math.max(...p.modes.map((x) => x[2]));
  const m = Math.min(len - ev.t, Math.round(Math.min(ev.n / sr + (p.r ?? 0.12) * 8, maxT * 7) * sr));
  if (m <= 0) return;
  const tw = (TAU * (p.tremolo ?? 0)) / sr;
  const tdepth = p.tremDepth ?? 0;
  const modes = p.modes.filter(([q]) => f * q < sr * 0.42 && f * q < (p.maxHz ?? 7000));
  for (const [q, a0, tau] of modes) {
    // Phaseur complexe amorti : une rotation par échantillon
    const w = (TAU * f * q) / sr;
    const k = Math.exp(-1 / (sr * tau * (1 + 0.4 * (1 - vel) * 0)));
    const cw = Math.cos(w) * k;
    const sw = Math.sin(w) * k;
    let re = 0;
    let im = a0 * vel * 0.5 * (q === 1 ? 1 : 0.6 + 0.6 * vel);
    let rel = 1;
    for (let i = 0; i < m; i++) {
      const nr = re * cw - im * sw;
      im = re * sw + im * cw;
      re = nr;
      if (i > ev.n) rel *= relK;
      let y = re * rel;
      if (i < A) y *= Math.sin((Math.PI / 2) * (i / A)) ** 2;
      if (tw) y *= 1 - tdepth * (0.5 + 0.5 * Math.sin(tw * (ev.t + i)));
      l[ev.t + i] += y * pl;
      if (rr) rr[ev.t + i] += y * pr;
    }
  }
  // Petit choc du maillet (bruit très bref et sourd)
  if (p.knock) {
    const lp = new OnePole(p.knockHz ?? 1800, sr);
    const n = Math.min(m, Math.round(sr * 0.012));
    for (let i = 0; i < n; i++) {
      const y = lp.process(r() * 2 - 1) * p.knock * vel * Math.exp(-i / (sr * 0.003));
      l[ev.t + i] += y * pl;
      if (rr) rr[ev.t + i] += y * pr;
    }
  }
}

// =====================================================================
// Voix monophonique (lignes de chant et basses de synthé) : liaisons glissées entre notes jointes,
// vibrato qui arrive après l'attaque, petite inflexion de hauteur au début des notes de souffle.
// events triés : [{ t, n, m, v }]. p.kind : whistle | panflute | flute | soft | horn | saw |
//   bass-finger | bass-house | bass-drive | bass-sub | bass-sustain
// =====================================================================
export function renderMono(out, sr, events, p, r) {
  if (!events.length) return;
  const { l } = out;
  const rr = out.r;
  const len = l.length;
  const kind = p.kind;
  const glide = Math.exp(-1 / (sr * (p.glide ?? 0.035)));
  const vibRate = (TAU * (p.vibRate ?? 5.2)) / sr;
  const vibDepth = p.vib ?? 0;
  const breath = p.breath ?? 0;
  const env = p.env ?? { a: 0.01, d: 0.4, s: 0.8, r: 0.12 };
  const ladder = p.cutoff ? new Ladder(sr, p.cutoff, p.res ?? 0.1, p.drive ?? 1.2) : null;
  const bpHz = new Filter('bandpass', 1500, 1.4, sr);
  const lp1 = new OnePole(p.lp ?? 6000, sr);
  const lp2 = new OnePole(p.lp ?? 6000, sr);
  const ph = [r(), r(), r(), r()];
  const sub = [0];
  let lf = Math.log2(mtof(events[0].m));
  let target = lf;
  let e = null;
  let vel = events[0].v ?? 0.8;
  let velS = vel;
  const kVel = 1 - Math.exp(-1 / (sr * 0.003));
  let onset = 0;
  let scoop = 0;
  let chiff = 0;
  let vibPh = r() * TAU;
  const tailN = Math.round(tailOf(env.r) * sr);
  const start = events[0].t;
  const last = events[events.length - 1];
  const end = Math.min(len, last.t + last.n + tailN);
  let k = 0;
  let next = events[0];
  for (let i = start; i < end; i++) {
    if (next && i >= next.t) {
      const prevEnd = k > 0 ? events[k - 1].t + events[k - 1].n : -1e9;
      const legato = k > 0 && next.t - prevEnd < sr * 0.012 && p.legato !== false;
      target = Math.log2(mtof(next.m));
      vel = next.v ?? 0.8;
      if (!legato) {
        // La nouvelle attaque repart du niveau atteint (aucune marche, aucun clic)
        const from = e ? e.level : 0;
        e = new Env(sr, env, next.n, Math.min(from, 1));
        if (!e || from < 0.05) lf = target;
        onset = i;
        scoop = p.scoop ?? 0;
        chiff = p.chiff ?? 0;
        if (kind.startsWith('bass')) lf = target;
      } else {
        e.gate = e.i + next.n;
        e.rel = -1;
      }
      k++;
      next = events[k];
    }
    if (!e) continue;
    lf = target + (lf - target) * glide;
    scoop *= 0.9985;
    const since = (i - onset) / sr;
    const vd = vibDepth * clamp((since - 0.22) / 0.35, 0, 1);
    vibPh += vibRate;
    const f = Math.pow(2, lf - scoop / 12 + (vd * Math.sin(vibPh)) / 1200);
    const dt = f / sr;
    const lev = e.next();
    let y = 0;
    switch (kind) {
      case 'whistle':
      case 'panflute':
      case 'flute': {
        let q = ph[0] + dt;
        q -= Math.floor(q);
        ph[0] = q;
        const s = Math.sin(TAU * q);
        if (kind === 'whistle') y = s + 0.1 * Math.sin(2 * TAU * q) + 0.04 * Math.sin(3 * TAU * q);
        else if (kind === 'panflute') y = s + 0.14 * Math.sin(3 * TAU * q) + 0.04 * Math.sin(5 * TAU * q);
        else y = s + 0.22 * Math.sin(2 * TAU * q) + 0.1 * Math.sin(3 * TAU * q) + 0.03 * Math.sin(4 * TAU * q);
        if ((i & 63) === 0) bpHz.set(clamp(f * 2, 300, 5000), 1.2);
        const n = bpHz.process(r() * 2 - 1);
        y = y * (0.9 + 0.1 * lev) + n * (breath * (0.6 + 0.4 * lev) + chiff);
        chiff *= 0.9985;
        y = lp2.process(lp1.process(y));
        break;
      }
      case 'soft': {
        let q = ph[0] + dt;
        q -= Math.floor(q);
        ph[0] = q;
        const tri = 1 - 4 * Math.abs(q - 0.5);
        y = lp2.process(lp1.process(tri * 0.9 + 0.25 * Math.sin(2 * TAU * q)));
        break;
      }
      case 'horn':
      case 'saw': {
        const d2 = kind === 'horn' ? 5 : 7;
        y = blepSaw(ph, 0, dt) + blepSaw(ph, 1, dt * cents(d2)) * 0.8 + blepSaw(ph, 2, dt * cents(-d2)) * (kind === 'horn' ? 0.8 : 0);
        if (kind === 'saw') {
          // Carré une octave dessous : du corps sans brillance
          let q = sub[0] + dt / 2;
          q -= Math.floor(q);
          sub[0] = q;
          let sq = q < 0.5 ? 1 : -1;
          sq += blep(q, dt / 2);
          let q2 = q - 0.5;
          q2 -= Math.floor(q2);
          sq -= blep(q2, dt / 2);
          y += 0.45 * sq;
        }
        if ((i & 15) === 0) {
          const envF = kind === 'horn' ? Math.pow(lev, 1.6) : Math.exp(-since / 0.18) * 0.7 + 0.3 * lev;
          ladder.set((p.cutoff + (p.envHz ?? 1500) * envF * (0.5 + 0.5 * vel)) * Math.pow(f / 440, p.track ?? 0.3));
        }
        y = ladder.process(y * 0.4);
        break;
      }
      case 'bass-finger':
      case 'bass-sustain': {
        let q = ph[0] + dt;
        q -= Math.floor(q);
        ph[0] = q;
        const x = TAU * q;
        const bright = kind === 'bass-finger' ? Math.exp(-since / 0.12) : 0.4;
        y = Math.sin(x) + (0.28 + 0.25 * bright) * Math.sin(2 * x) + (0.08 + 0.2 * bright) * Math.sin(3 * x) + 0.08 * bright * Math.sin(4 * x);
        y = lp1.process(y);
        break;
      }
      case 'bass-sub': {
        let q = ph[0] + dt;
        q -= Math.floor(q);
        ph[0] = q;
        y = sat(1.6 * Math.sin(TAU * q)) * 0.8 + 0.1 * Math.sin(2 * TAU * q);
        break;
      }
      case 'bass-house':
      case 'bass-drive': {
        let q = ph[3] + dt;
        q -= Math.floor(q);
        ph[3] = q;
        const sine = Math.sin(TAU * q);
        const saw = blepSaw(ph, 0, dt) + blepSaw(ph, 1, dt * cents(8)) * 0.6;
        if ((i & 15) === 0) {
          const envF = Math.exp(-since / (kind === 'bass-house' ? 0.09 : 0.07));
          ladder.set(p.cutoff + (p.envHz ?? 900) * envF * (0.4 + 0.6 * vel));
        }
        y = ladder.process(saw * 0.35) + sine * (kind === 'bass-house' ? 0.9 : 0.6);
        break;
      }
      default:
        y = 0;
    }
    // Nuance lissée (3 ms) : un changement de force entre deux notes ne fait pas de marche
    velS += (vel - velS) * kVel;
    y *= lev * velS * (p.gain ?? 0.5);
    if (lev < 1e-5 && i > onset + 64 && (!next || next.t > i + 64) && e.i > e.gate) {
      e = null;
      continue;
    }
    l[i] += y;
    if (rr) rr[i] += y;
  }
}

// =====================================================================
// Batterie : coups uniques mono, mémorisés par le rendu et rejoués avec gain et panoramique.
// Paramètres de couleur par ambiance (p : { kickHz, kickDecay, snareHz, tone... }).
// =====================================================================
const len = (sr, s) => Math.max(1, Math.round(sr * s));

function shapeAttack(out, sr, ms = 1) {
  const A = Math.max(1, Math.round((sr * ms) / 1000));
  for (let i = 0; i < A && i < out.length; i++) out[i] *= Math.sin((Math.PI / 2) * (i / A)) ** 2;
  const F = Math.min(out.length >> 2, Math.round(sr * 0.01));
  for (let i = 0; i < F; i++) out[out.length - 1 - i] *= i / F;
  return out;
}

// Banque métallique (six carrés aux rapports du TR-808) : base des charlestons et cymbales.
function metal(sr, n, r, base = 1) {
  const F = [205.3, 304.4, 369.6, 522.7, 540, 800].map((x) => (x * base) / sr);
  const ph = F.map(() => r());
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < 6; k++) {
      let q = ph[k] + F[k];
      if (q >= 1) q -= 1;
      ph[k] = q;
      let v = q < 0.5 ? 1 : -1;
      v += blep(q, F[k]);
      let q2 = q - 0.5;
      if (q2 < 0) q2 += 1;
      v -= blep(q2, F[k]);
      s += v;
    }
    out[i] = s / 6;
  }
  return out;
}

export function drumHit(kind, sr, r, p = {}) {
  let out;
  switch (kind) {
    case 'kick': {
      // Corps sinusoïdal qui glisse de ~150 à ~50 Hz, clic de batte filtré, saturation douce
      const D = p.kickDecay ?? 0.32;
      out = new Float32Array(len(sr, D * 2.2));
      const f1 = p.kickHz ?? 50;
      const f0 = p.kickFrom ?? 150;
      const tp = p.kickSweep ?? 0.035;
      let ph = 0;
      const click = new OnePole(3500, sr);
      const click2 = new OnePole(3500, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        ph += (f1 + (f0 - f1) * Math.exp(-t / tp)) / sr;
        const body = Math.sin(TAU * ph) * Math.exp(-t / D) * (1 + 0.6 * Math.exp(-t / 0.02));
        const c = click2.process(click.process(r() * 2 - 1)) * Math.exp(-t / 0.0025) * (p.kickClick ?? 0.9);
        out[i] = sat(1.3 * body + c) * 0.95;
      }
      shapeAttack(out, sr, 0.6);
      break;
    }
    case 'snare':
    case 'rimshot': {
      // Peau (deux modes qui retombent un peu) + timbre (bruit en bande moyenne), plafonné vers 7 kHz
      const rim = kind === 'rimshot';
      out = new Float32Array(len(sr, 0.45));
      const f = p.snareHz ?? 185;
      const bp = new Filter('bandpass', p.snareNoiseHz ?? 2600, 0.7, sr);
      const hp = new Filter('highpass', 500, 0.7, sr);
      const lp = new Filter('lowpass', p.snareLp ?? 7500, 0.6, sr);
      let p1 = 0;
      let p2 = 0;
      const nd = p.snareDecay ?? 0.13;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        p1 += (f * (1 + 0.25 * Math.exp(-t / 0.01))) / sr;
        p2 += (f * 1.78 * (1 + 0.2 * Math.exp(-t / 0.01))) / sr;
        const body = (Math.sin(TAU * p1) * 0.8 + Math.sin(TAU * p2) * 0.45) * Math.exp(-t / (rim ? 0.03 : 0.055));
        const n = lp.process(hp.process(bp.process(r() * 2 - 1))) * Math.exp(-t / nd) * (rim ? 1.1 : 1.6);
        const crack = rim ? Math.sin(TAU * 1650 * t) * Math.exp(-t / 0.008) * 0.6 : 0;
        out[i] = sat(body * (rim ? 0.7 : 0.9) + n + crack);
      }
      shapeAttack(out, sr, 0.8);
      break;
    }
    case 'clap': {
      out = new Float32Array(len(sr, 0.4));
      const bp = new Filter('bandpass', p.clapHz ?? 1300, 1.0, sr);
      const lp = new Filter('lowpass', 5200, 0.6, sr);
      const hits = [0, 0.0095, 0.019, 0.026];
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        let e = 0;
        for (let k = 0; k < hits.length; k++) {
          const u = t - hits[k];
          if (u >= 0) e = Math.max(e, (k === 3 ? 1 : 0.7) * Math.min(1, u / 0.0012) * Math.exp(-u / (k === 3 ? 0.075 : 0.006)));
        }
        out[i] = lp.process(bp.process(r() * 2 - 1)) * e * 2.2;
      }
      break;
    }
    case 'snap': {
      // Claquement de doigts : clic bref en bande haute-médium
      out = new Float32Array(len(sr, 0.15));
      const bp = new Filter('bandpass', 2300, 1.6, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        out[i] = bp.process(r() * 2 - 1) * Math.min(1, t / 0.0006) * Math.exp(-t / 0.018) * 3;
      }
      break;
    }
    case 'hat':
    case 'openhat': {
      const open = kind === 'openhat';
      out = new Float32Array(len(sr, open ? 0.6 : 0.12));
      const m = metal(sr, out.length, r, p.hatTune ?? 1);
      const hp = new Filter('highpass', 4200, 0.7, sr);
      const bp = new Filter('bandpass', p.hatHz ?? 6200, 0.9, sr);
      const lp = new Filter('lowpass', 8500, 0.6, sr);
      const tau = open ? 0.17 : p.hatDecay ?? 0.03;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const n = (r() * 2 - 1) * 0.35;
        out[i] = lp.process(bp.process(hp.process(m[i] + n))) * Math.exp(-t / tau) * 2.2;
      }
      shapeAttack(out, sr, 0.8);
      break;
    }
    case 'shaker':
    case 'tamb': {
      // Maracas : grains de bruit en bande haute avec une attaque traînée ; tambourin : + cymbalettes
      out = new Float32Array(len(sr, kind === 'tamb' ? 0.25 : 0.12));
      const bp = new Filter('bandpass', p.shakerHz ?? 4800, 1.1, sr);
      const lp = new Filter('lowpass', 7500, 0.6, sr);
      const jm = kind === 'tamb' ? metal(sr, out.length, r, 3.1) : null;
      const jbp = new Filter('bandpass', 5200, 2, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const e = Math.min(1, t / 0.012) * Math.exp(-t / 0.045);
        let y = lp.process(bp.process(r() * 2 - 1)) * e;
        if (jm) y += jbp.process(jm[i]) * Math.min(1, t / 0.002) * Math.exp(-t / 0.07) * 1.2;
        out[i] = y * 2;
      }
      break;
    }
    case 'tom':
    case 'taiko':
    case 'conga':
    case 'bongo': {
      const f = p.f ?? (kind === 'taiko' ? 72 : kind === 'conga' ? 240 : kind === 'bongo' ? 380 : 110);
      const D = kind === 'taiko' ? 0.55 : kind === 'tom' ? 0.3 : 0.16;
      out = new Float32Array(len(sr, D * 3));
      const bp = new Filter('bandpass', kind === 'taiko' ? 600 : 1500, 0.8, sr);
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        ph += (f * (1 + (kind === 'conga' || kind === 'bongo' ? 0.12 : 0.5) * Math.exp(-t / 0.03))) / sr;
        const body = Math.sin(TAU * ph) * Math.exp(-t / D);
        const skin = bp.process(r() * 2 - 1) * Math.exp(-t / (kind === 'taiko' ? 0.04 : 0.012)) * (kind === 'taiko' ? 0.5 : 0.35);
        out[i] = sat(body * 1.2 + skin);
      }
      shapeAttack(out, sr, 1);
      break;
    }
    case 'block':
    case 'rim': {
      // Bloc de bois / bord de caisse : deux modes brefs
      out = new Float32Array(len(sr, 0.12));
      const f = p.f ?? (kind === 'block' ? 820 : 1150);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        out[i] = (Math.sin(TAU * f * t) + 0.45 * Math.sin(TAU * f * 2.37 * t) * Math.exp(-t / 0.01)) * Math.exp(-t / 0.028);
      }
      shapeAttack(out, sr, 0.7);
      break;
    }
    case 'brush': {
      // Balai : frottement (montée puis retombée) de bruit sourd
      out = new Float32Array(len(sr, 0.32));
      const bp = new Filter('bandpass', 2600, 0.6, sr);
      const lp = new Filter('lowpass', 5000, 0.6, sr);
      for (let i = 0; i < out.length; i++) {
        const u = i / out.length;
        out[i] = lp.process(bp.process(r() * 2 - 1)) * Math.sin(Math.PI * Math.min(1, u * 1.4)) ** 2 * 1.2;
      }
      break;
    }
    case 'crash': {
      // Cymbale sombre et longue (métal + bruit), sans éclat au-dessus de 8 kHz
      out = new Float32Array(len(sr, 2.2));
      const m = metal(sr, out.length, r, 1.47);
      const bp = new Filter('bandpass', 4600, 0.6, sr);
      const lp = new Filter('lowpass', 7000, 0.6, sr);
      const hp = new Filter('highpass', 900, 0.6, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const n = r() * 2 - 1;
        out[i] = lp.process(bp.process(hp.process(m[i] * 0.7 + n * 0.6))) * (Math.exp(-t / 0.6) * 0.8 + 0.2 * Math.exp(-t / 0.08)) * 2;
      }
      shapeAttack(out, sr, 2);
      break;
    }
    case 'riser': {
      // Montée de souffle filtré sur p.dur secondes (fin des ponts), coupée net sur le temps fort
      const D = p.dur ?? 2;
      out = new Float32Array(len(sr, D));
      const bp = new Filter('bandpass', 400, 1.2, sr);
      for (let i = 0; i < out.length; i++) {
        const u = i / out.length;
        if ((i & 31) === 0) bp.set(350 * Math.pow(12, u), 1.2);
        out[i] = bp.process(r() * 2 - 1) * u * u * 1.4;
      }
      const F = Math.round(sr * 0.006);
      for (let i = 0; i < F; i++) out[out.length - 1 - i] *= i / F;
      const A = Math.round(sr * 0.05);
      for (let i = 0; i < A; i++) out[i] *= i / A;
      break;
    }
    default:
      out = new Float32Array(1);
  }
  return out;
}

// =====================================================================
// Traitements de bus
// =====================================================================
// Chorus stéréo (deux lignes modulées en opposition de phase, façon Juno) : la nappe s'élargit et chatoie.
export function chorus(out, sr, { mix = 0.35, delay = 0.0075, depth = 0.0022, rate = 0.55 } = {}) {
  const { l, r } = out;
  const n = l.length;
  const size = Math.ceil((delay + depth) * sr) + 4;
  const buf = new Float32Array(size);
  let w = 0;
  const lw = (TAU * rate) / sr;
  for (let i = 0; i < n; i++) {
    const m = (l[i] + r[i]) * 0.5;
    buf[w] = m;
    const dl = (delay + depth * Math.sin(lw * i)) * sr;
    const dr = (delay + depth * Math.sin(lw * i + Math.PI)) * sr;
    const read = (d) => {
      let rp = w - d;
      while (rp < 0) rp += size;
      const i0 = Math.floor(rp);
      const f = rp - i0;
      return buf[i0 % size] * (1 - f) + buf[(i0 + 1) % size] * f;
    };
    l[i] = l[i] * (1 - mix * 0.5) + read(dl) * mix;
    r[i] = r[i] * (1 - mix * 0.5) + read(dr) * mix;
    w = (w + 1) % size;
  }
  return out;
}

// Compresseur de bus (détection crête lissée, genou doux) : colle la batterie sans l'écraser.
// threshold relatif à la crête du bus (0..1), ratio, attaque et relâchement en secondes.
export function compress(out, sr, { threshold = 0.4, ratio = 2.5, attack = 0.006, release = 0.12 } = {}) {
  const chans = out.r ? [out.l, out.r] : [out.l];
  const n = out.l.length;
  const ka = Math.exp(-1 / (sr * attack));
  const kr = Math.exp(-1 / (sr * release));
  let env = 0;
  for (let i = 0; i < n; i++) {
    let x = 0;
    for (const c of chans) x = Math.max(x, Math.abs(c[i]));
    env = x > env ? x + (env - x) * ka : x + (env - x) * kr;
    let g = 1;
    if (env > threshold) g = Math.pow(env / threshold, 1 / ratio - 1);
    for (const c of chans) c[i] *= g;
  }
  return out;
}

// Limiteur doux : linéaire jusqu'à knee, arrondi au-delà, jamais au-dessus de ceiling.
export function softLimit(buf, knee = 0.55, ceiling = 0.8) {
  const span = ceiling - knee;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const a = Math.abs(x);
    if (a > knee) buf[i] = Math.sign(x) * (knee + span * Math.tanh((a - knee) / span));
  }
  return buf;
}

// =====================================================================
// Réverbération de la musique (réponse impulsionnelle stéréo jouée par un ConvolverNode) : plaque dense
// et chaude, densité d'échos qui monte en 40 ms, aigus qui s'éteignent deux fois plus vite que le médium,
// grave retiré (la basse et la grosse caisse restent nettes). Énergie unitaire par canal.
// =====================================================================
export function renderPlate(sr, r, { t60 = 1.8, pre = 0.016, damp = 2600 } = {}) {
  const n = Math.round(sr * (t60 * 1.15 + pre));
  const ch = [new Float32Array(n), new Float32Array(n)];
  const start = Math.round(pre * sr);
  for (const out of ch) {
    const lo = new OnePole(700, sr);
    const lp = new Ladder(sr, 7000, 0, 1);
    for (let i = start; i < n; i++) {
      const t = (i - start) / sr;
      const x = r() * 2 - 1;
      const low = lo.process(x);
      const high = x - low;
      // Les aigus s'éteignent plus vite (air et plaque amortie)
      const y = low * Math.exp((-6.9 * t) / t60) + high * Math.exp((-6.9 * t) / (t60 * 0.55));
      if ((i & 127) === 0) lp.set(7000 * Math.pow(damp / 7000, Math.min(1, t / t60)), 0);
      out[i] = lp.process(y) * Math.min(1, Math.sqrt(t / 0.04));
    }
    new Filter('highpass', 220, 0.6, sr).run(out);
    const F = Math.round(sr * 0.05);
    for (let i = 0; i < F; i++) out[n - 1 - i] *= i / F;
    let e = 0;
    for (let i = 0; i < n; i++) e += out[i] * out[i];
    const k = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < n; i++) out[i] *= k;
  }
  return { l: ch[0], r: ch[1] };
}
