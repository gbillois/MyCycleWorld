// Effets du jeu, sons d'interface, sons du kayak, batterie et instruments de la musique, réponses
// impulsionnelles de réverbération. Tout est calculé ici dans des Float32Array (module pur, testé dans
// tests/audio.test.js), puis joué comme échantillon par le moteur.
import { TAU, smoothstep, mtof, Filter, OnePole, Osc, arEnv, addDecaySine, mixInto, normalize, normalizeStereo, fadeEdges, dcBlock, panGains, white, pink, brown, softClip, loopFilter } from './dsp.js';
import { addBubble, renderSplash, renderBubbles } from './voices.js';
import { range, logRange } from './random.js';

const secs = (sr, s) => Math.max(1, Math.round(sr * s));
const stereo = (sr, s) => ({ l: new Float32Array(secs(sr, s)), r: new Float32Array(secs(sr, s)) });

// --- Petits instruments réutilisés ---
// Cloche claire (partiels de glockenspiel : 1, 2,76, 5,4), écrite dans un son stéréo.
function glock(o, sr, at, f, { amp = 1, dur = 1.2, pan = 0, bright = 1 } = {}) {
  const [gl, gr] = panGains(pan);
  const P = [[1, 1, dur], [2.76, 0.35 * bright, dur * 0.45], [5.4, 0.16 * bright, dur * 0.25], [8.93, 0.06 * bright, dur * 0.12]];
  const n = Math.max(0, Math.min(o.l.length - at, secs(sr, dur * 1.2)));
  const tmp = new Float32Array(n);
  for (const [q, a, t60] of P) if (f * q < sr * 0.45) addDecaySine(tmp, 0, sr, f * q, a * amp, 6.907755 / t60, n);
  const att = Math.round(sr * 0.0015);
  for (let i = 0; i < n; i++) {
    const v = i < att ? (tmp[i] * i) / att : tmp[i];
    o.l[at + i] += v * gl;
    o.r[at + i] += v * gr;
  }
}

// Note de cuivres synthétiques : deux dents de scie désaccordées, filtre qui s'ouvre à l'attaque (« blat »),
// vibrato qui arrive après un instant.
function brass(o, sr, at, midi, dur, { vel = 1, pan = 0, bright = 1 } = {}) {
  const f = mtof(midi);
  const n = Math.min(o.l.length - at, secs(sr, dur + 0.15));
  const a = new Osc(sr, Math.random());
  const b = new Osc(sr, Math.random());
  const lp = new Filter('lowpass', 800, 1.1, sr);
  const [gl, gr] = panGains(pan);
  const rel = 0.12;
  let vib = 1;
  let e = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 31) === 0) {
      const att = smoothstep(0, 0.05, t);
      const cut = 500 + (2600 * vel * bright) * (0.55 + 0.45 * Math.exp(-t / 0.12)) * att + f * 1.5;
      lp.set(Math.min(cut, sr * 0.45), 1.1);
    }
    if ((i & 31) === 0) {
      vib = 1 + 0.004 * smoothstep(0.2, 0.45, t) * Math.sin(TAU * 5.5 * t);
      e = Math.min(1, t / 0.025) * (t > dur ? Math.max(0, 1 - (t - dur) / rel) : 1) * (0.85 + 0.15 * Math.exp(-t / 0.08));
    }
    const s = a.saw(f * vib * 1.0035) + b.saw(f * vib * 0.9965);
    const v = lp.process(s) * e * vel * 0.5;
    o.l[at + i] += v * gl;
    o.r[at + i] += v * gr;
  }
}

// Bruit filtré dont la fréquence glisse de f0 à f1 (souffles, « whoosh »).
function sweep(o, sr, r, at, dur, f0, f1, { q = 1.2, amp = 1, env = (u) => Math.sin(Math.PI * u), pan = (u) => 0, exp = true } = {}) {
  const n = Math.min(o.l.length - at, secs(sr, dur));
  const bl = new Filter('bandpass', f0, q, sr);
  const br = new Filter('bandpass', f0, q, sr);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if ((i & 31) === 0) {
      const f = exp ? f0 * Math.pow(f1 / f0, u) : f0 + (f1 - f0) * u;
      bl.set(f, q);
      br.set(f, q);
    }
    const e = env(u) * amp;
    const [gl, gr] = panGains(pan(u));
    o.l[at + i] += bl.process(r() * 2 - 1) * e * gl * 1.4;
    o.r[at + i] += br.process(r() * 2 - 1) * e * gr * 1.4;
  }
}

// Cymbale (crash) : bruit très aigu et partiels métalliques, longue queue.
function cymbal(o, sr, r, at, { amp = 0.5, dur = 2.2 } = {}) {
  const n = Math.min(o.l.length - at, secs(sr, dur));
  const hl = new Filter('highpass', 5000, 0.7, sr);
  const hr = new Filter('highpass', 5000, 0.7, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const e = amp * Math.min(1, t / 0.004) * (0.6 * Math.exp(-t / 0.15) + 0.4 * Math.exp(-t / (dur * 0.35)));
    o.l[at + i] += hl.process(r() * 2 - 1) * e;
    o.r[at + i] += hr.process(r() * 2 - 1) * e;
  }
}

// Timbale : sinus grave légèrement descendant et peau qui frappe.
function timpani(o, sr, r, at, midi, { amp = 0.8 } = {}) {
  const f = mtof(midi);
  const n = Math.min(o.l.length - at, secs(sr, 1.4));
  let ph = 0;
  const lp = new Filter('lowpass', 600, 0.7, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (f * (1 + 0.04 * Math.exp(-t / 0.05))) / sr;
    const v = (Math.sin(TAU * ph) + 0.3 * Math.sin(TAU * ph * 1.5)) * Math.exp(-t / 0.45) * amp + lp.process(r() * 2 - 1) * Math.exp(-t / 0.03) * amp * 0.6;
    o.l[at + i] += v;
    o.r[at + i] += v;
  }
}

const finish = (o, sr, target = 0.85) => {
  normalizeStereo(dcBlock(o.l, sr), dcBlock(o.r, sr), target);
  fadeEdges(o.l, sr, 3);
  fadeEdges(o.r, sr, 3);
  return o;
};

// =====================================================================
// Départ
// =====================================================================
// Bip du compte à rebours (chronométrage officiel) : sinus pur, octave légère.
export function renderBeep(sr, r, { f = 660, dur = 0.24 } = {}) {
  const len = secs(sr, dur + 0.05);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const e = Math.min(1, t / 0.004) * (t < dur * 0.6 ? 1 : Math.exp(-(t - dur * 0.6) / 0.05));
    out[i] = (Math.sin(TAU * f * t) + 0.22 * Math.sin(TAU * 2 * f * t) + 0.07 * Math.sin(TAU * 3 * f * t) + 0.12 * Math.sin(TAU * 0.5 * f * t)) * e;
  }
  return fadeEdges(normalize(out, 0.8), sr, 2);
}

// Corne de départ (corne à air) : deux anches en tierce, saturées, avec une petite montée de hauteur.
export function renderHorn(sr, r) {
  const dur = 1.05;
  const len = secs(sr, dur + 0.2);
  const out = new Float32Array(len);
  const oscs = [new Osc(sr, 0.1), new Osc(sr, 0.4), new Osc(sr, 0.7), new Osc(sr, 0.2)];
  const fr = [370, 371.5, 466, 467.8];
  const lp = new Filter('lowpass', 2800, 0.8, sr);
  const body = new Filter('peaking', 1200, 1.4, sr, 6);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const bend = 0.94 + 0.06 * smoothstep(0, 0.07, t);
    let s = 0;
    for (let k = 0; k < 4; k++) s += oscs[k].saw(fr[k] * bend);
    const e = Math.min(1, t / 0.015) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.15) : 1);
    out[i] = body.process(lp.process(Math.tanh(s * 0.6 * 1.8))) * e;
  }
  return fadeEdges(normalize(dcBlock(out, sr), 0.85), sr, 3);
}

// Sifflet d'arbitre (à bille) : sifflement aigu roulé par la bille qui tourne.
export function renderWhistle(sr, r) {
  const dur = 0.55;
  const len = secs(sr, dur + 0.05);
  const out = new Float32Array(len);
  const trill = range(r, 34, 44);
  const bp = new Filter('bandpass', 3000, 3, sr);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = 2950 * (1 + 0.04 * Math.sin(TAU * trill * t));
    ph += f / sr;
    const e = Math.min(1, t / 0.01) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.04) : 1);
    out[i] = (Math.sin(TAU * ph) * (0.7 + 0.3 * Math.sin(TAU * trill * t)) + bp.process(r() * 2 - 1) * 0.5) * e;
  }
  return fadeEdges(normalize(out, 0.8), sr, 2);
}

// =====================================================================
// Objets et incidents de course
// =====================================================================
// Boîte à objet : roulette scintillante (notes pentatoniques qui défilent) puis gerbe d'étincelles.
export function renderPickup(sr, r) {
  const o = stereo(sr, 1.5);
  const scale = [84, 86, 88, 91, 93, 96, 98];
  let t = 0;
  for (let k = 0; k < 14; k++) {
    const gap = 0.03 + 0.025 * Math.abs(k - 5) / 9; // accélère puis ralentit, comme une roue
    glock(o, sr, Math.round(t * sr), mtof(scale[Math.floor(r() * scale.length)]), { amp: 0.4, dur: 0.18, pan: k % 2 ? 0.3 : -0.3 });
    t += gap;
  }
  const end = t + 0.04;
  [84, 88, 91, 96, 100].forEach((m, i) => glock(o, sr, Math.round((end + i * 0.035) * sr), mtof(m), { amp: 0.7, dur: 0.9, pan: -0.4 + i * 0.2 }));
  sweep(o, sr, r, Math.round(end * sr), 0.5, 7000, 11000, { q: 0.8, amp: 0.12, env: (u) => Math.exp(-u * 4) * Math.min(1, u * 20) });
  return finish(o, sr, 0.8);
}

// Turbo : coup sourd, souffle qui monte et note qui grimpe (réacteur qui s'allume).
export function renderTurbo(sr, r) {
  const o = stereo(sr, 1.4);
  const n = o.l.length;
  let ph = 0;
  const osc = new Osc(sr, 0);
  const lp = new Filter('lowpass', 400, 1.5, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (45 + 60 * Math.exp(-t / 0.05)) / sr;
    const thump = Math.sin(TAU * ph) * Math.exp(-t / 0.12) * 0.9;
    const f = 160 * Math.pow(4.5, smoothstep(0, 0.85, t));
    if ((i & 31) === 0) lp.set(Math.min(f * 3, sr * 0.45), 2);
    const tone = lp.process(osc.saw(f * (1 + 0.01 * Math.sin(TAU * 9 * t)))) * 0.32 * arEnv(t / 1.35, 0.15, 0.4);
    o.l[i] += thump + tone;
    o.r[i] += thump + tone;
  }
  sweep(o, sr, r, 0, 1.2, 280, 4200, { q: 1.3, amp: 0.8, env: (u) => smoothstep(0, 0.3, u) * (1 - smoothstep(0.55, 1, u)) });
  return finish(o, sr, 0.85);
}

// Peau de banane posée : « splotch » mouillé.
export function renderBananaDrop(sr, r) {
  const len = secs(sr, 0.4);
  const out = new Float32Array(len);
  const bp = new Filter('bandpass', 1400, 2.5, sr);
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const t = i / sr;
    if ((i & 31) === 0) bp.set(1400 * Math.pow(300 / 1400, smoothstep(0, 0.5, u)), 2.5);
    out[i] = bp.process(r() * 2 - 1) * 3 * Math.min(1, t / 0.004) * Math.exp(-t / 0.07) * (0.6 + 0.4 * Math.sin(TAU * 30 * t));
  }
  addBubble(out, sr, 0, range(r, 160, 200), 0.8);
  for (let k = 0; k < 6; k++) addBubble(out, sr, Math.floor(r() * sr * 0.12), logRange(r, 600, 1500), range(r, 0.1, 0.3));
  return fadeEdges(normalize(out, 0.85), sr, 2);
}

// Glissade sur la banane : crissement de pneu, puis petite sirène à coulisse qui descend (clin d'œil dessin animé).
export function renderSkid(sr, r) {
  const o = stereo(sr, 1.3);
  const n = o.l.length;
  let ph = 0;
  let jit = 0;
  const bp = new Filter('bandpass', 2500, 1.5, sr);
  let ph2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 255) === 0) jit = (r() * 2 - 1) * 0.05;
    const f = (1950 - 650 * smoothstep(0, 0.9, t)) * (1 + jit);
    ph += f / sr;
    const sq = (Math.sin(TAU * ph) + 0.3 * Math.sin(2 * TAU * ph)) * 0.5 + bp.process(r() * 2 - 1) * 0.6;
    const e = Math.min(1, t / 0.02) * (1 - smoothstep(0.5, 0.95, t));
    const fw = 1150 - 750 * smoothstep(0.45, 1.15, t);
    ph2 += (fw * (1 + 0.03 * Math.sin(TAU * 7 * t))) / sr;
    const slide = Math.sin(TAU * ph2) * 0.35 * smoothstep(0.42, 0.5, t) * (1 - smoothstep(1.05, 1.25, t));
    const [gl, gr] = panGains(Math.sin(TAU * 1.5 * t) * 0.5);
    o.l[i] += sq * e * gl + slide;
    o.r[i] += sq * e * gr + slide;
  }
  // Choc de la roue
  const thud = renderBump(sr, r);
  mixInto(o.l, thud, 0, 0.6);
  mixInto(o.r, thud, 0, 0.6);
  return finish(o, sr, 0.8);
}

// Choc sourd (roue sur la banane, bosse).
export function renderBump(sr, r) {
  const len = secs(sr, 0.22);
  const out = new Float32Array(len);
  const lp = new Filter('lowpass', 420, 0.8, sr);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    ph += (60 + 50 * Math.exp(-t / 0.02)) / sr;
    out[i] = Math.sin(TAU * ph) * Math.exp(-t / 0.06) + lp.process(r() * 2 - 1) * Math.exp(-t / 0.02) * 0.8;
  }
  return fadeEdges(normalize(out, 0.85), sr, 1);
}

// Dépassement : souffle stéréo qui passe d'un côté à l'autre (dir = 1 : de gauche à droite).
export function renderWhoosh(sr, r, { dir = 1, dur = 0.7 } = {}) {
  const o = stereo(sr, dur);
  sweep(o, sr, r, 0, dur, 500, 700, {
    q: 0.9,
    amp: 0.9,
    exp: false,
    env: (u) => Math.exp(-(((u - 0.5) / 0.22) ** 2)),
    pan: (u) => dir * (u * 2 - 1) * 0.9,
  });
  // Bande médiane qui « monte et redescend » (effet Doppler)
  sweep(o, sr, r, 0, dur, 900, 1700, { q: 1.6, amp: 0.4, env: (u) => Math.exp(-(((u - 0.45) / 0.15) ** 2)), pan: (u) => dir * (u * 2 - 1) });
  return finish(o, sr, 0.8);
}

// Tour bouclé : carillon de deux notes montantes (quarte).
export function renderLapChime(sr, r) {
  const o = stereo(sr, 1.8);
  glock(o, sr, 0, mtof(88), { amp: 0.8, dur: 1.3, pan: -0.15 });
  glock(o, sr, Math.round(0.14 * sr), mtof(93), { amp: 0.9, dur: 1.5, pan: 0.15 });
  return finish(o, sr, 0.8);
}

// Dernier tour : « ta-da-da-DAAA » aux cuivres, doublé de cloches, cymbale.
export function renderFinalLap(sr, r) {
  const o = stereo(sr, 2.2);
  const seq = [[67, 0, 0.1], [72, 0.13, 0.1], [76, 0.26, 0.1], [79, 0.39, 0.9]];
  for (const [m, t, d] of seq) {
    brass(o, sr, Math.round(t * sr), m, d, { vel: 0.9, pan: -0.2 });
    brass(o, sr, Math.round(t * sr), m - 12, d, { vel: 0.6, pan: 0.2 });
    glock(o, sr, Math.round(t * sr), mtof(m + 12), { amp: 0.35, dur: 0.6 });
  }
  brass(o, sr, Math.round(0.39 * sr), 76, 0.9, { vel: 0.7, pan: 0.3 });
  brass(o, sr, Math.round(0.39 * sr), 72, 0.9, { vel: 0.7, pan: -0.3 });
  cymbal(o, sr, r, Math.round(0.39 * sr), { amp: 0.35, dur: 1.6 });
  return finish(o, sr, 0.85);
}

// Arrivée : fanfare de cuivres (do majeur), timbales et cymbale, cloches en cascade.
export function renderFanfare(sr, r) {
  const o = stereo(sr, 3.6);
  const C = [60, 64, 67, 72];
  const hits = [[0, 0.16, C], [0.2, 0.16, C], [0.4, 0.16, C], [0.62, 0.36, [65, 69, 72, 77]], [1.02, 0.36, [67, 71, 74, 79]], [1.42, 1.6, [60, 64, 67, 72, 76]]];
  for (const [t, d, chord] of hits) {
    chord.forEach((m, i) => brass(o, sr, Math.round(t * sr), m, d, { vel: 0.75, pan: -0.5 + (i / (chord.length - 1)) * 1 }));
    brass(o, sr, Math.round(t * sr), chord[0] - 12, d, { vel: 0.6, bright: 0.6 });
  }
  timpani(o, sr, r, 0, 36);
  timpani(o, sr, r, Math.round(0.62 * sr), 41, { amp: 0.6 });
  timpani(o, sr, r, Math.round(1.02 * sr), 43, { amp: 0.6 });
  timpani(o, sr, r, Math.round(1.42 * sr), 36);
  cymbal(o, sr, r, Math.round(1.42 * sr), { amp: 0.5, dur: 2.1 });
  [84, 88, 91, 96, 100, 103].forEach((m, i) => glock(o, sr, Math.round((1.5 + i * 0.07) * sr), mtof(m), { amp: 0.3, dur: 1.4, pan: -0.6 + i * 0.24 }));
  return finish(o, sr, 0.9);
}

// Écran des résultats : victoire (éclatant), podium (chaleureux) ou simple arrivée (encourageant, doux).
export function renderSting(sr, r, { kind = 'win' } = {}) {
  const o = stereo(sr, 3.2);
  if (kind === 'win') {
    [72, 76, 79, 84].forEach((m, i) => {
      brass(o, sr, Math.round(i * 0.1 * sr), m, i === 3 ? 1.6 : 0.09, { vel: 0.85 });
      glock(o, sr, Math.round(i * 0.1 * sr), mtof(m + 12), { amp: 0.4, dur: 1 });
    });
    [60, 67, 72, 74, 76].forEach((m, i) => brass(o, sr, Math.round(0.3 * sr), m, 1.6, { vel: 0.55, pan: -0.6 + i * 0.3, bright: 0.7 }));
    cymbal(o, sr, r, Math.round(0.3 * sr), { amp: 0.4, dur: 2.4 });
    timpani(o, sr, r, Math.round(0.3 * sr), 36);
  } else if (kind === 'podium') {
    [[65, 69, 72, 76], [60, 64, 67, 74]].forEach((chord, k) => chord.forEach((m, i) => {
      glock(o, sr, Math.round((k * 0.55 + i * 0.05) * sr), mtof(m + 12), { amp: 0.45, dur: 1.4, pan: -0.5 + i * 0.33 });
      brass(o, sr, Math.round(k * 0.55 * sr), m, k ? 1.5 : 0.45, { vel: 0.45, bright: 0.5, pan: -0.5 + i * 0.33 });
    }));
  } else {
    // Accords doux au piano électrique : la min 7, fa maj 7, do (pas de « défaite » lugubre)
    [[57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 64, 67]].forEach((chord, k) => chord.forEach((m, i) => {
      const note = renderNote(sr, r, { instrument: 'keys', midi: m + 12 });
      const [gl, gr] = panGains(-0.4 + i * 0.27);
      mixInto(o.l, note, Math.round((k * 0.7 + i * 0.02) * sr), 0.35 * gl);
      mixInto(o.r, note, Math.round((k * 0.7 + i * 0.02) * sr), 0.35 * gr);
    }));
  }
  return finish(o, sr, kind === 'other' ? 0.6 : 0.85);
}

// Changement de vitesse : clic sec du dérailleur, puis la chaîne qui tombe sur le pignon.
export function renderGearClick(sr, r) {
  const len = secs(sr, 0.16);
  const out = new Float32Array(len);
  const ring = (at, f, amp, tau) => {
    for (let i = 0; at + i < len; i++) out[at + i] += Math.sin((TAU * f * i) / sr) * amp * Math.exp(-i / (sr * tau));
  };
  ring(0, 3200, 0.6, 0.006);
  ring(0, 5100, 0.4, 0.004);
  const at = Math.round(0.035 * sr);
  ring(at, 900, 0.7, 0.018);
  ring(at, 1650, 0.4, 0.012);
  const hp = new Filter('highpass', 2500, 0.7, sr);
  for (let i = 0; i < sr * 0.002; i++) out[i] += hp.process(r() * 2 - 1) * 0.7;
  const lp = new Filter('lowpass', 1800, 0.7, sr);
  for (let i = 0; i < sr * 0.012; i++) out[at + i] += lp.process(r() * 2 - 1) * 0.5 * (1 - i / (sr * 0.012));
  return fadeEdges(normalize(out, 0.8), sr, 1);
}

// =====================================================================
// Interface (menus)
// =====================================================================
export function renderUi(sr, r, { kind = 'tick' } = {}) {
  if (kind === 'open' || kind === 'close') {
    const o = stereo(sr, 0.32);
    const up = kind === 'open';
    sweep(o, sr, r, 0, 0.3, up ? 450 : 2600, up ? 2600 : 450, { q: 1.1, amp: 0.6, env: (u) => Math.sin(Math.PI * u) ** 1.5, pan: (u) => (up ? -0.3 + u * 0.6 : 0.3 - u * 0.6) });
    return finish(o, sr, 0.6);
  }
  const notes = { tick: [[2350, 0, 0.03]], confirm: [[1318.5, 0, 0.09], [1975.5, 0.055, 0.22]], back: [[1568, 0, 0.08], [1046.5, 0.05, 0.18]] }[kind] || [[2350, 0, 0.03]];
  const len = secs(sr, 0.35);
  const out = new Float32Array(len);
  for (const [f, t, d] of notes) {
    const at = Math.round(t * sr);
    const tau = kind === 'tick' ? 0.006 : d / 3;
    for (let i = 0; at + i < len; i++) {
      const tt = i / sr;
      const e = Math.min(1, tt / 0.0015) * Math.exp(-tt / tau);
      out[at + i] += (Math.sin(TAU * f * tt) + 0.18 * Math.sin(TAU * 2.76 * f * tt) * Math.exp(-tt / 0.01)) * e;
    }
  }
  if (kind === 'tick') {
    const hp = new Filter('highpass', 4000, 0.7, sr);
    for (let i = 0; i < sr * 0.0015; i++) out[i] += hp.process(r() * 2 - 1) * 0.25;
  }
  if (kind === 'back') new Filter('lowpass', 3000, 0.7, sr).run(out);
  return fadeEdges(normalize(out, kind === 'tick' ? 0.5 : 0.7), sr, 1);
}

// =====================================================================
// Kayak (mode en préparation) : portes, sprint, tourbillon
// =====================================================================
export function renderGateDing(sr, r) {
  const o = stereo(sr, 1.5);
  glock(o, sr, 0, mtof(91), { amp: 0.9, dur: 1.2, bright: 1.2 });
  glock(o, sr, Math.round(0.07 * sr), mtof(98), { amp: 0.45, dur: 1, pan: 0.2 });
  sweep(o, sr, r, 0, 0.4, 6000, 10000, { q: 0.8, amp: 0.08, env: (u) => Math.exp(-u * 5) });
  return finish(o, sr, 0.8);
}

export function renderGateBuzz(sr, r) {
  const len = secs(sr, 0.55);
  const out = new Float32Array(len);
  const a = new Osc(sr, 0);
  const b = new Osc(sr, 0.3);
  const lp = new Filter('lowpass', 1400, 0.9, sr);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const on = (t < 0.19 ? arEnv(t / 0.19, 0.03, 0.08) : 0) + (t > 0.27 && t < 0.5 ? arEnv((t - 0.27) / 0.23, 0.03, 0.1) : 0);
    out[i] = lp.process(Math.tanh((a.square(110) + b.square(116.5)) * 0.8)) * on;
  }
  return fadeEdges(normalize(out, 0.75), sr, 2);
}

export function renderSprintWhoosh(sr, r) {
  const o = stereo(sr, 1.4);
  sweep(o, sr, r, 0, 0.55, 400, 4200, { q: 1.4, amp: 0.8, env: (u) => smoothstep(0, 0.4, u) * (1 - smoothstep(0.75, 1, u)) });
  const osc = new Osc(sr, 0);
  const lp = new Filter('lowpass', 1500, 1, sr);
  const n = secs(sr, 0.55);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const v = lp.process(osc.saw(300 * Math.pow(4, t / 0.55))) * 0.25 * arEnv(t / 0.55, 0.2, 0.3);
    o.l[i] += v;
    o.r[i] += v;
  }
  [91, 96, 100].forEach((m, i) => glock(o, sr, Math.round((0.5 + i * 0.06) * sr), mtof(m), { amp: 0.55, dur: 0.8, pan: -0.3 + i * 0.3 }));
  return finish(o, sr, 0.85);
}

export function renderSprintFail(sr, r) {
  const len = secs(sr, 0.8);
  const out = new Float32Array(len);
  const osc = new Osc(sr, 0);
  const lp = new Filter('lowpass', 800, 1.2, sr);
  const lo = new Filter('lowpass', 600, 0.7, sr);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    ph += (40 + 35 * Math.exp(-t / 0.06)) / sr;
    const thud = Math.sin(TAU * ph) * Math.exp(-t / 0.12) + lo.process(r() * 2 - 1) * Math.exp(-t / 0.04) * 0.7;
    const womp = lp.process(osc.saw(220 * Math.pow(0.5, smoothstep(0.1, 0.7, t)))) * 0.45 * arEnv((t - 0.08) / 0.65, 0.1, 0.4) * (t > 0.08 ? 1 : 0);
    out[i] = thud + womp;
  }
  return fadeEdges(normalize(out, 0.85), sr, 2);
}

// Tourbillon : remous qui tournent autour de la tête, gargouillis et vidange qui descend.
export function renderWhirlpool(sr, r, { dur = 2.5 } = {}) {
  const o = stereo(sr, dur);
  const n = o.l.length;
  const bl = new Filter('bandpass', 500, 2, sr);
  const br = new Filter('bandpass', 500, 2, sr);
  const swirl = range(r, 1.5, 2.4);
  const rot = range(r, 0.7, 1);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = i / n;
    if ((i & 31) === 0) {
      const f = 600 + 300 * Math.sin(TAU * swirl * t);
      bl.set(f, 2);
      br.set(f * 1.05, 2);
    }
    const e = arEnv(u, 0.2, 0.3);
    const a = TAU * rot * t;
    ph += (400 * Math.pow(0.4, u)) / sr;
    const drain = Math.sin(TAU * ph) * 0.15 * (0.6 + 0.4 * Math.sin(TAU * 6 * t));
    o.l[i] += (bl.process(r() * 2 - 1) * 2.2 * (0.6 + 0.4 * Math.cos(a)) + drain) * e;
    o.r[i] += (br.process(r() * 2 - 1) * 2.2 * (0.6 + 0.4 * Math.sin(a)) + drain) * e;
  }
  const g = renderBubbles(sr, r, { seconds: dur, rate: 60, fmin: 200, fmax: 700, loop: false, env: (u) => arEnv(u, 0.2, 0.3) });
  mixInto(o.l, g, 0, 0.5);
  mixInto(o.r, g, Math.round(sr * 0.01), 0.5);
  return finish(o, sr, 0.8);
}

export function renderKayakSplash(sr, r) {
  return renderSplash(sr, r, { size: 1.6 });
}

// =====================================================================
// Batterie de la musique
// =====================================================================
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800]; // fréquences « 808 » : cymbale métallique inharmonique

export function renderDrum(sr, r, { kind = 'kick' } = {}) {
  let len;
  let out;
  switch (kind) {
    case 'kick': {
      len = secs(sr, 0.5);
      out = new Float32Array(len);
      let ph = 0;
      const hp = new Filter('highpass', 3000, 0.7, sr);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        ph += (48 + 105 * Math.exp(-t / 0.045)) / sr;
        out[i] = Math.sin(TAU * ph) * Math.exp(-t / 0.32) + (i < sr * 0.002 ? hp.process(r() * 2 - 1) * 0.3 : 0);
      }
      softClip(out, 1.6);
      break;
    }
    case 'snare': {
      len = secs(sr, 0.3);
      out = new Float32Array(len);
      const bp = new Filter('bandpass', 3500, 0.6, sr);
      const hp = new Filter('highpass', 1400, 0.7, sr);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        out[i] = (Math.sin(TAU * 185 * t) * Math.exp(-t / 0.05) + 0.5 * Math.sin(TAU * 330 * t) * Math.exp(-t / 0.03)) * 0.6 + hp.process(bp.process(r() * 2 - 1)) * Math.exp(-t / 0.075) * 2.2;
      }
      break;
    }
    case 'clap': {
      len = secs(sr, 0.3);
      out = new Float32Array(len);
      const bp = new Filter('bandpass', 1150, 1.1, sr);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        let e = 0;
        for (const at of [0, 0.009, 0.019]) if (t >= at) e = Math.max(e, Math.exp(-(t - at) / 0.006));
        if (t >= 0.025) e = Math.max(e, 0.55 * Math.exp(-(t - 0.025) / 0.06));
        out[i] = bp.process(r() * 2 - 1) * e * 2.5;
      }
      break;
    }
    case 'hat':
    case 'openhat': {
      const tau = kind === 'hat' ? 0.022 : 0.16;
      len = secs(sr, kind === 'hat' ? 0.12 : 0.6);
      out = new Float32Array(len);
      const oscs = METAL.map((_, k) => new Osc(sr, k * 0.17));
      const hp = new Filter('highpass', 7000, 0.7, sr);
      const bp = new Filter('bandpass', 10000, 1, sr);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        let s = 0;
        for (let k = 0; k < 6; k++) s += oscs[k].square(METAL[k] * 1.6);
        out[i] = bp.process(hp.process(s * 0.3 + (r() * 2 - 1) * 0.5)) * Math.min(1, t / 0.0008) * Math.exp(-t / tau);
      }
      break;
    }
    case 'shaker': {
      len = secs(sr, 0.14);
      out = new Float32Array(len);
      const bp = new Filter('bandpass', 7000, 1, sr);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        out[i] = bp.process(r() * 2 - 1) * smoothstep(0, 0.012, t) * Math.exp(-t / 0.035);
      }
      break;
    }
    case 'rim': {
      len = secs(sr, 0.08);
      out = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        out[i] = (Math.sin(TAU * 1700 * t) + 0.6 * Math.sin(TAU * 470 * t) + (r() * 2 - 1) * 0.4 * Math.exp(-t / 0.002)) * Math.exp(-t / 0.018);
      }
      break;
    }
    case 'conga': {
      len = secs(sr, 0.35);
      out = new Float32Array(len);
      let ph = 0;
      const bp = new Filter('bandpass', 1800, 1, sr);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        ph += (300 + 40 * Math.exp(-t / 0.02)) / sr;
        out[i] = Math.sin(TAU * ph) * Math.exp(-t / 0.15) + bp.process(r() * 2 - 1) * Math.exp(-t / 0.008) * 0.6;
      }
      break;
    }
    default: {
      // Balai sur caisse claire (musique du menu)
      len = secs(sr, 0.25);
      out = new Float32Array(len);
      const lp = new Filter('lowpass', 4500, 0.7, sr);
      const hp = new Filter('highpass', 900, 0.7, sr);
      for (let i = 0; i < len; i++) {
        const u = i / len;
        out[i] = hp.process(lp.process(r() * 2 - 1)) * Math.sin(Math.PI * Math.min(1, u * 1.6)) ** 2;
      }
    }
  }
  return fadeEdges(normalize(dcBlock(out, sr), 0.9), sr, 1);
}

// =====================================================================
// Notes d'instruments (une par hauteur, gardées en cache par le moteur)
//   pluck : guitare claire (Karplus-Strong) ; marimba ; bell : kalimba / célesta ;
//   keys : piano électrique (synthèse FM) ; synth : pluck électronique filtré
// =====================================================================
export function renderNote(sr, r, { instrument = 'pluck', midi = 60, dur } = {}) {
  const f = mtof(midi);
  const D = dur ?? { pluck: 1.8, marimba: 1.1, bell: 1.6, keys: 2.4, synth: 0.9 }[instrument] ?? 1.5;
  const len = secs(sr, D);
  const out = new Float32Array(len);
  if (instrument === 'pluck') {
    // Corde pincée : ligne à retard rebouclée sur une moyenne (amortit les aigus), retard fractionnaire juste.
    const N = sr / f;
    const size = Math.ceil(N) + 2;
    const line = new Float32Array(size);
    const pick = new OnePole(3500, sr);
    for (let i = 0; i < size; i++) line[i] = pick.process(r() * 2 - 1);
    let w = 0;
    const loss = Math.pow(0.5, 1 / (f * 1.6)); // ~ -6 dB par 0,6 s selon la hauteur
    let prev = 0;
    for (let i = 0; i < len; i++) {
      let rp = w - N;
      while (rp < 0) rp += size;
      const i0 = Math.floor(rp);
      const fr = rp - i0;
      const a = line[i0 % size];
      const b = line[(i0 + 1) % size];
      const y = a + (b - a) * fr;
      const v = (y + prev) * 0.5 * loss;
      prev = y;
      line[w] = v;
      w = (w + 1) % size;
      out[i] = v;
    }
    new Filter('peaking', 220, 1, sr, 3).run(out);
    new Filter('peaking', 2600, 1.5, sr, 2).run(out);
  } else if (instrument === 'marimba') {
    const lp = new Filter('lowpass', 2500, 0.7, sr);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const e = Math.min(1, t / 0.002);
      out[i] = e * (Math.sin(TAU * f * t) * Math.exp(-t / (0.25 + 60 / f)) + 0.35 * Math.sin(TAU * 4 * f * t) * Math.exp(-t / 0.05) + 0.1 * Math.sin(TAU * 9.9 * f * t) * Math.exp(-t / 0.015)) + lp.process(r() * 2 - 1) * Math.exp(-t / 0.003) * 0.3;
    }
  } else if (instrument === 'bell') {
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const e = Math.min(1, t / 0.002);
      out[i] = e * (Math.sin(TAU * f * t) * Math.exp(-t / 0.55) + 0.3 * Math.sin(TAU * 2.76 * f * t) * Math.exp(-t / 0.2) + 0.12 * Math.sin(TAU * 5.4 * f * t) * Math.exp(-t / 0.08) + 0.15 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / 0.35));
    }
  } else if (instrument === 'keys') {
    // Piano électrique : porteuse + modulateur au même rapport, indice qui retombe (lame qui sonne puis s'adoucit)
    let pc = 0;
    let pm = 0;
    let pt = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const idx = 0.3 + 2.2 * Math.exp(-t / 0.35);
      pm += f / sr;
      pt += (f * 14) / sr;
      pc += f / sr;
      const tine = Math.sin(TAU * pt) * 0.15 * Math.exp(-t / 0.02);
      out[i] = (Math.sin(TAU * pc + idx * Math.sin(TAU * pm)) + tine) * Math.min(1, t / 0.003) * Math.exp(-t / (0.9 + 80 / f));
    }
  } else {
    const a = new Osc(sr, 0);
    const b = new Osc(sr, 0.5);
    const lp = new Filter('lowpass', 3000, 2, sr);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if ((i & 31) === 0) lp.set(400 + 3200 * Math.exp(-t / 0.12) + f, 2.5);
      out[i] = lp.process(a.saw(f * 1.004) + b.saw(f * 0.996)) * Math.min(1, t / 0.003) * Math.exp(-t / 0.3);
    }
  }
  return fadeEdges(normalize(dcBlock(out, sr), 0.85), sr, 2);
}

// =====================================================================
// Réverbération : réponses impulsionnelles générées (pas de fichier)
//   queue diffuse (bruit qui décroît, aigus amortis avec le temps, comme l'air), premières réflexions
//   (sol, berges) et, en montagne ou dans un canyon, de vrais échos renvoyés par les parois.
// =====================================================================
export const REVERB_PRESETS = {
  meadow: { t60: 0.9, pre: 0.008, damp: 3000, early: [[0.004, 0.5], [0.011, 0.25]], echoes: [] },
  alpine: { t60: 1.5, pre: 0.02, damp: 2400, early: [[0.007, 0.4], [0.019, 0.2]], echoes: [[0.38, 0.9, 2600], [0.82, 0.6, 1900], [1.35, 0.38, 1300], [1.95, 0.22, 900]] },
  coast: { t60: 0.7, pre: 0.006, damp: 4200, early: [[0.004, 0.45]], echoes: [] },
  lake: { t60: 1.5, pre: 0.012, damp: 3200, early: [[0.006, 0.6], [0.014, 0.3]], echoes: [[0.55, 0.18, 2000]] },
  river: { t60: 1.3, pre: 0.01, damp: 3000, early: [[0.005, 0.5], [0.012, 0.35]], echoes: [[0.22, 0.32, 2600], [0.47, 0.16, 1800]] },
};

export function renderImpulse(sr, r, preset = 'meadow') {
  const p = REVERB_PRESETS[preset] || REVERB_PRESETS.meadow;
  const tail = Math.max(p.t60, ...p.echoes.map((e) => e[0] + 0.6));
  const len = secs(sr, tail + p.pre + 0.1);
  const ch = [new Float32Array(len), new Float32Array(len)];
  for (const out of ch) {
    const lp = new Filter('lowpass', 9000, 0.6, sr);
    const start = Math.round(p.pre * sr);
    for (let i = start; i < len; i++) {
      const t = (i - start) / sr;
      if ((i & 255) === 0) lp.set(9000 * Math.pow(p.damp / 9000, Math.min(1, t / p.t60)), 0.6);
      out[i] = lp.process(r() * 2 - 1) * Math.exp((-6.907755 * t) / p.t60) * smoothstep(0, 0.012, t);
    }
    for (const [t, g] of p.early) {
      const at = Math.round((t + range(r, -0.0015, 0.0015)) * sr);
      if (at < len) out[at] += g * (r() < 0.5 ? -1 : 1);
    }
    for (const [t, g, f] of p.echoes) {
      const at = Math.round((t + range(r, -0.01, 0.01)) * sr);
      const blp = new Filter('lowpass', f, 0.7, sr);
      const n = Math.round(sr * 0.06);
      for (let i = 0; i < n && at + i < len; i++) out[at + i] += blp.process(r() * 2 - 1) * g * Math.exp(-i / (sr * 0.015)) * 1.4;
    }
  }
  return { l: ch[0], r: ch[1] };
}

// Bruits de base (boucles stéréo décorrélées) pour les nappes et les boucles du joueur.
export function renderNoiseLoop(sr, r, { seconds = 6, color = 'pink' } = {}) {
  const len = secs(sr, seconds);
  const make = () => normalize(color === 'white' ? white(len, r) : color === 'brown' ? brown(len, r, true) : pink(len, r, true), 0.9);
  return { l: make(), r: make() };
}

// =====================================================================
// Météo
// =====================================================================
// Crépitement de pluie en boucle stéréo (sans raccord) : milliers d'impacts brefs. kind 'leaves' : gouttes
// sur les feuilles et les herbes (claquements secs, aigus) ; 'road' : impacts sur l'asphalte mouillé et
// petites éclaboussures (plus mats, avec des bulles).
export function renderRain(sr, r, { seconds = 4, kind = 'leaves' } = {}) {
  const len = secs(sr, seconds);
  const o = { l: new Float32Array(len), r: new Float32Array(len) };
  const leaves = kind === 'leaves';
  const n = Math.round((leaves ? 1100 : 1500) * seconds);
  const imp = secs(sr, 0.006);
  for (let k = 0; k < n; k++) {
    const at = Math.floor(r() * len);
    const pan = range(r, -1, 1);
    const [gl, gr] = panGains(pan);
    const amp = Math.pow(r(), 2.2) * (leaves ? 0.9 : 0.6);
    const tau = (leaves ? range(r, 0.0006, 0.0018) : range(r, 0.0012, 0.004)) * sr;
    for (let i = 0; i < imp * 3; i++) {
      const v = (r() * 2 - 1) * amp * Math.exp(-i / tau);
      const j = (at + i) % len;
      o.l[j] += v * gl;
      o.r[j] += v * gr;
    }
    if (!leaves && r() < 0.06) {
      addBubble(r() < 0.5 ? o.l : o.r, sr, at, logRange(r, 1500, 4500), amp * 0.5, true);
    }
  }
  // Timbre : feuilles claires (on coupe les graves), route plus sourde.
  const hpF = leaves ? 1800 : 500;
  const lpF = leaves ? 9000 : 5200;
  loopFilter(o.l, new Filter('highpass', hpF, 0.6, sr), new Filter('lowpass', lpF, 0.6, sr));
  loopFilter(o.r, new Filter('highpass', hpF, 0.6, sr), new Filter('lowpass', lpF, 0.6, sr));
  normalizeStereo(o.l, o.r, 0.8);
  return o;
}

// Tonnerre lointain : craquement (parfois), puis grondements qui roulent, plus graves et plus longs à mesure
// que l'écho revient des collines. Durée 5 à 8 s.
export function renderThunder(sr, r, { near = 0.5 } = {}) {
  const dur = range(r, 5, 8);
  const len = secs(sr, dur);
  const o = { l: new Float32Array(len), r: new Float32Array(len) };
  const base = brown(len, r);
  const base2 = brown(len, r);
  const lp = new Filter('lowpass', 180 + 500 * near, 0.7, sr);
  const lp2 = new Filter('lowpass', 140 + 400 * near, 0.7, sr);
  // Roulements : quelques bosses d'amplitude aux instants tirés au sort.
  const rolls = [];
  let t = range(r, 0.05, 0.3);
  while (t < dur * 0.8) {
    rolls.push([t, range(r, 0.4, 1), range(r, 0.3, 1.2)]);
    t += range(r, 0.25, 1.4);
  }
  const crack = near > 0.4;
  for (let i = 0; i < len; i++) {
    const u = i / sr;
    let env = 0;
    for (const [t0, a, w] of rolls) {
      const x = (u - t0) / w;
      if (x > -1 && x < 4) env += a * (x < 0 ? (1 + x) * (1 + x) : Math.exp(-x * 1.2));
    }
    env *= Math.min(1, u / 0.04) * (1 - smoothstep(dur * 0.7, dur, u));
    let vl = lp.process(base[i]) * env;
    let vr = lp2.process(base2[i]) * env;
    if (crack && u < 0.35) {
      const c = (r() * 2 - 1) * Math.exp(-u / 0.06) * 0.7 * near;
      vl += c;
      vr += c * 0.8;
    }
    o.l[i] = vl;
    o.r[i] = vr;
  }
  return finish(o, sr, 0.8);
}
