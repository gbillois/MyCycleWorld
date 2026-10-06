// Briques de synthèse hors Web Audio (module pur, testé dans tests/audio.test.js) : bruits, filtres biquad,
// oscillateurs sans repliement, enveloppes et outils de mixage sur des Float32Array. Les sons ponctuels
// (oiseaux, cloches, éclaboussures, effets du jeu) sont calculés une fois ici puis joués comme des échantillons :
// presque rien à faire pour le fil audio pendant la course.

export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db) => Math.pow(10, db / 20);

// --- Bruits (r : générateur 0..1) ---
export function white(n, r) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r() * 2 - 1;
  return out;
}

// Bruit rose (filtre de Paul Kellet) : énergie égale par octave, base des souffles et du vent.
// loop : le filtre passe deux fois sur le même bruit blanc, la fin rejoint donc le début sans saut.
export function pink(n, r, loop = false) {
  const w = white(n, r);
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let pass = loop ? 0 : 1; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const x = w[i];
      b0 = 0.99886 * b0 + x * 0.0555179;
      b1 = 0.99332 * b1 + x * 0.0750759;
      b2 = 0.969 * b2 + x * 0.153852;
      b3 = 0.8665 * b3 + x * 0.3104856;
      b4 = 0.55 * b4 + x * 0.5329522;
      b5 = -0.7616 * b5 - x * 0.016898;
      if (pass) out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
      b6 = x * 0.115926;
    }
  }
  return out;
}

// Bruit brun (marche aléatoire avec fuite) : grondement, ressac lointain, roulement sourd.
export function brown(n, r, loop = false) {
  const w = white(n, r);
  const out = new Float32Array(n);
  let last = 0;
  for (let pass = loop ? 0 : 1; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      last = (last + 0.02 * w[i]) / 1.02;
      if (pass) out[i] = last * 3.5;
    }
  }
  return out;
}

// --- Filtres biquad (formules RBJ), forme directe transposée II ---
export function biquadCoefs(type, freq, q, sr, gainDb = 0) {
  const f = clamp(freq, 10, sr * 0.49);
  const w0 = (TAU * f) / sr;
  const c = Math.cos(w0);
  const s = Math.sin(w0);
  const alpha = s / (2 * Math.max(0.0001, q));
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'highpass':
      b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
      break;
    case 'bandpass': // gain de crête 0 dB
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
      break;
    case 'peaking': {
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + alpha * A; b1 = -2 * c; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * c; a2 = 1 - alpha / A;
      break;
    }
    default: // lowpass
      b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

export class Filter {
  constructor(type, freq, q, sr, gainDb = 0) {
    this.type = type;
    this.sr = sr;
    this.z1 = 0;
    this.z2 = 0;
    this.set(freq, q, gainDb);
  }
  set(freq, q = this.q, gainDb = this.g) {
    this.freq = freq;
    this.q = q;
    this.g = gainDb;
    Object.assign(this, biquadCoefs(this.type, freq, q, this.sr, gainDb));
  }
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  run(buf) {
    for (let i = 0; i < buf.length; i++) buf[i] = this.process(buf[i]);
    return buf;
  }
}

// Filtre appliqué à une boucle sans raccord audible : un premier passage met le filtre en régime,
// le second écrit le résultat (la fin rejoint donc le début sans saut).
export function loopFilter(buf, ...filters) {
  for (const f of filters) {
    for (let i = 0; i < buf.length; i++) f.process(buf[i]);
    f.run(buf);
  }
  return buf;
}

// Passe-bas à un pôle (pente douce), utile pour adoucir une source riche.
export class OnePole {
  constructor(freq, sr) {
    this.sr = sr;
    this.y = 0;
    this.set(freq);
  }
  set(freq) {
    this.k = 1 - Math.exp((-TAU * freq) / this.sr);
  }
  process(x) {
    this.y += this.k * (x - this.y);
    return this.y;
  }
}

// --- Oscillateurs ---
// Correction polyBLEP : dent de scie et carré sans repliement audible (sons de cuivres, voix, buzzers).
function polyblep(t, dt) {
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

export class Osc {
  constructor(sr, phase = 0) {
    this.sr = sr;
    this.p = phase;
  }
  // Avance d'un échantillon à la fréquence f et renvoie la valeur.
  sine(f) {
    const v = Math.sin(TAU * this.p);
    this.p += f / this.sr;
    this.p -= Math.floor(this.p);
    return v;
  }
  saw(f) {
    const dt = Math.min(0.5, f / this.sr);
    const v = 2 * this.p - 1 - polyblep(this.p, dt);
    this.p += dt;
    this.p -= Math.floor(this.p);
    return v;
  }
  square(f, width = 0.5) {
    const dt = Math.min(0.5, f / this.sr);
    let v = this.p < width ? 1 : -1;
    v += polyblep(this.p, dt);
    let t2 = this.p - width;
    t2 -= Math.floor(t2);
    v -= polyblep(t2, dt);
    this.p += dt;
    this.p -= Math.floor(this.p);
    return v;
  }
  tri(f) {
    const v = this.p < 0.5 ? 4 * this.p - 1 : 3 - 4 * this.p;
    this.p += f / this.sr;
    this.p -= Math.floor(this.p);
    return v;
  }
}

// Sinus amorti ajouté à out (phaseur complexe : une multiplication par échantillon au lieu de sin et exp).
//   d : amortissement (1/s) ; rise : montée relative de la fréquence par seconde (bulles) ; wrap : écriture en boucle.
export function addDecaySine(out, at, sr, f, amp, d, n, rise = 0, wrap = false, phase = 0) {
  const len = out.length;
  let re = Math.cos(phase) * amp;
  let im = Math.sin(phase) * amp;
  const k = Math.exp(-d / sr);
  let cw = 0;
  let sw = 0;
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0) {
      const w = (TAU * f * (1 + (rise * i) / sr)) / sr;
      cw = Math.cos(w) * k;
      sw = Math.sin(w) * k;
    }
    const nr = re * cw - im * sw;
    im = re * sw + im * cw;
    re = nr;
    let j = at + i;
    if (j >= len) {
      if (!wrap) break;
      j %= len;
    }
    out[j] += im;
  }
}

// --- Enveloppes ---
// Attaque et relâchement en arcs de sinus (pas de clic), u = position 0..1 dans le son.
export function arEnv(u, attack, release) {
  let e = 1;
  if (u < attack) e = Math.sin((Math.PI / 2) * (u / attack));
  if (u > 1 - release) e *= Math.sin((Math.PI / 2) * clamp((1 - u) / release, 0, 1));
  return u < 0 || u > 1 ? 0 : e;
}

// Décroissance exponentielle avec durée à -60 dB t60 (s).
export const decay60 = (t, t60) => Math.exp((-6.907755 * t) / Math.max(1e-4, t60));

// --- Mixage ---
export function mixInto(dst, src, offset = 0, gain = 1, wrap = false) {
  const n = dst.length;
  for (let i = 0; i < src.length; i++) {
    let j = offset + i;
    if (wrap) j %= n;
    else if (j >= n) break;
    if (j >= 0) dst[j] += src[i] * gain;
  }
  return dst;
}

export function peak(buf) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > m) m = a;
  }
  return m;
}

export function rms(buf, start = 0, end = buf.length) {
  let s = 0;
  for (let i = start; i < end; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, end - start));
}

export function normalize(buf, target = 0.9) {
  const m = peak(buf);
  if (m > 0) {
    const k = target / m;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
  }
  return buf;
}

// Normalise ensemble les deux canaux d'un son stéréo.
export function normalizeStereo(l, r, target = 0.9) {
  const m = Math.max(peak(l), peak(r));
  if (m > 0) {
    const k = target / m;
    for (let i = 0; i < l.length; i++) {
      l[i] *= k;
      r[i] *= k;
    }
  }
  return { l, r };
}

// Fondu très court au début et à la fin (aucun clic à la lecture).
export function fadeEdges(buf, sr, ms = 3) {
  const n = Math.min(buf.length >> 1, Math.round((sr * ms) / 1000));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    buf[i] *= g;
    buf[buf.length - 1 - i] *= g;
  }
  return buf;
}

// Retire la composante continue (après saturation ou sommes asymétriques).
export function dcBlock(buf, sr) {
  const hp = new Filter('highpass', 20, 0.707, sr);
  return hp.run(buf);
}

// Saturation douce (tanh), pour de la chaleur sans écrêtage dur.
export function softClip(buf, drive = 1) {
  const k = Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * drive) / k;
  return buf;
}

// Panoramique à puissance constante : pan -1 (gauche) .. 1 (droite).
export function panGains(pan) {
  const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

// --- Analyse (tests et vérifications) ---
// Énergie relative dans une bande de fréquences par transformée de Goertzel sur une grille de fréquences.
export function bandEnergy(buf, sr, f0, f1, steps = 24, start = 0, len = buf.length) {
  let e = 0;
  for (let k = 0; k < steps; k++) {
    const f = f0 * Math.pow(f1 / f0, (k + 0.5) / steps);
    e += goertzel(buf, sr, f, start, len);
  }
  return e / steps;
}

export function goertzel(buf, sr, f, start = 0, len = buf.length - start) {
  const w = (TAU * f) / sr;
  const c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  const end = Math.min(buf.length, start + len);
  for (let i = start; i < end; i++) {
    // Fenêtre de Hann : moins de fuite spectrale entre les bandes.
    const h = 0.5 - 0.5 * Math.cos((TAU * (i - start)) / (end - start));
    const s0 = buf[i] * h + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / ((end - start) * (end - start));
}

// Fréquence dominante (recherche par pas logarithmiques), utile pour suivre une courbe de chant.
export function dominantFreq(buf, sr, start, len, fmin = 200, fmax = 10000, steps = 160) {
  let best = 0;
  let bf = fmin;
  for (let k = 0; k < steps; k++) {
    const f = fmin * Math.pow(fmax / fmin, k / (steps - 1));
    const e = goertzel(buf, sr, f, start, len);
    if (e > best) {
      best = e;
      bf = f;
    }
  }
  return bf;
}
