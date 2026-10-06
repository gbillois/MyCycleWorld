// Effets du jeu, sons d'interface, sons du kayak, batterie et instruments de la musique, réponses
// impulsionnelles de réverbération. Tout est calculé ici dans des Float32Array (module pur, testé dans
// tests/audio.test.js), puis joué comme échantillon par le moteur.
// Esthétique : timbres ronds et chauds (sinus, triangles, dents de scie filtrées bas), attaques douces de
// quelques millisecondes, pas d'énergie superflue entre 2 et 6 kHz ni de souffle aigu, cloches une octave
// sous leur registre « jouet » d'origine. Chaque son finit par un fondu (aucun clic) sans composante continue.
import { TAU, smoothstep, mtof, Filter, OnePole, Osc, arEnv, addDecaySine, mixInto, normalize, normalizeStereo, fadeEdges, dcBlock, panGains, white, pink, brown, softClip, loopFilter } from './dsp.js';
import { addBubble, renderSplash, renderBubbles } from './voices.js';
import { range, logRange } from './random.js';

const secs = (sr, s) => Math.max(1, Math.round(sr * s));
const stereo = (sr, s) => ({ l: new Float32Array(secs(sr, s)), r: new Float32Array(secs(sr, s)) });

// Attaque en arc de sinus carré (aucune marche, aucun clic) sur n échantillons.
const rise = (i, n) => (i >= n ? 1 : Math.sin((Math.PI / 2) * (i / n)) ** 2);

// Passe-bas appliqué aux deux canaux d'un son stéréo (adoucit le haut du spectre).
function lowpassStereo(o, sr, f, q = 0.6) {
  new Filter('lowpass', f, q, sr).run(o.l);
  new Filter('lowpass', f, q, sr).run(o.r);
  return o;
}

// --- Petits instruments réutilisés ---
// Cloche douce (partiels de glockenspiel : 1, 2,76, 5,4), écrite dans un son stéréo. Les partiels au-delà de
// 9 kHz sont omis et l'attaque dure quelques millisecondes : timbre de célesta plutôt que de jouet.
function glock(o, sr, at, f, { amp = 1, dur = 1.2, pan = 0, bright = 0.6, attack = 0.004 } = {}) {
  const [gl, gr] = panGains(pan);
  const P = [[1, 1, dur], [2.76, 0.3 * bright, dur * 0.4], [5.4, 0.1 * bright, dur * 0.2], [8.93, 0.03 * bright, dur * 0.1]];
  const n = Math.max(0, Math.min(o.l.length - at, secs(sr, dur * 1.2)));
  const tmp = new Float32Array(n);
  for (const [q, a, t60] of P) if (f * q < 9000) addDecaySine(tmp, 0, sr, f * q, a * amp, 6.907755 / t60, n);
  const att = Math.round(sr * attack);
  for (let i = 0; i < n; i++) {
    const v = tmp[i] * rise(i, att);
    o.l[at + i] += v * gl;
    o.r[at + i] += v * gr;
  }
}

// Note de cuivres feutrés : deux dents de scie désaccordées dans un passe-bas qui s'entrouvre à l'attaque,
// puis un second passe-bas fixe (pas d'éclat métallique), vibrato qui arrive après un instant.
function brass(o, sr, at, midi, dur, { vel = 1, pan = 0, bright = 1 } = {}) {
  const f = mtof(midi);
  const n = Math.min(o.l.length - at, secs(sr, dur + 0.2));
  const a = new Osc(sr, Math.random());
  const b = new Osc(sr, Math.random());
  const lp = new Filter('lowpass', 800, 0.7, sr);
  const soft = new OnePole(3200, sr);
  const [gl, gr] = panGains(pan);
  const rel = 0.16;
  let vib = 1;
  let e = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 31) === 0) {
      const att = smoothstep(0, 0.06, t);
      const cut = 250 + 1300 * vel * bright * (0.6 + 0.4 * Math.exp(-t / 0.15)) * att + f * 1.1;
      lp.set(Math.min(cut, sr * 0.45), 0.7);
      vib = 1 + 0.004 * smoothstep(0.2, 0.45, t) * Math.sin(TAU * 5.2 * t);
      e = smoothstep(0, 0.04, t) * (t > dur ? Math.max(0, 1 - (t - dur) / rel) ** 2 : 1) * (0.88 + 0.12 * Math.exp(-t / 0.08));
    }
    const s = a.saw(f * vib * 1.003) + b.saw(f * vib * 0.997);
    const v = soft.process(lp.process(s)) * e * vel * 0.5;
    o.l[at + i] += v * gl;
    o.r[at + i] += v * gr;
  }
}

// Bruit filtré dont la fréquence glisse de f0 à f1 (souffles, « whoosh »). Le bruit est d'abord adouci
// (passe-bas à un pôle) : souffle feutré plutôt que chuintement.
function sweep(o, sr, r, at, dur, f0, f1, { q = 1.2, amp = 1, env = (u) => Math.sin(Math.PI * u), pan = () => 0, exp = true, lp = 4500 } = {}) {
  const n = Math.min(o.l.length - at, secs(sr, dur));
  const bl = new Filter('bandpass', f0, q, sr);
  const br = new Filter('bandpass', f0, q, sr);
  const sl = new OnePole(lp, sr);
  const sr2 = new OnePole(lp, sr);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if ((i & 31) === 0) {
      const f = exp ? f0 * Math.pow(f1 / f0, u) : f0 + (f1 - f0) * u;
      bl.set(f, q);
      br.set(f, q);
    }
    const e = env(u) * amp;
    const [gl, gr] = panGains(pan(u));
    o.l[at + i] += bl.process(sl.process(r() * 2 - 1)) * e * gl * 1.6;
    o.r[at + i] += br.process(sr2.process(r() * 2 - 1)) * e * gr * 1.6;
  }
}

// Cymbale douce (frottée plutôt que frappée) : bruit entre 3 et 8 kHz, attaque de quelques ms, longue queue.
function cymbal(o, sr, r, at, { amp = 0.3, dur = 2.2 } = {}) {
  const n = Math.min(o.l.length - at, secs(sr, dur));
  const f = [0, 1].map(() => [new Filter('highpass', 3000, 0.6, sr), new Filter('lowpass', 8000, 0.6, sr)]);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const e = amp * smoothstep(0, 0.008, t) * (0.5 * Math.exp(-t / 0.18) + 0.5 * Math.exp(-t / (dur * 0.35))) * Math.min(1, (n - i) / (sr * 0.2));
    o.l[at + i] += f[0][1].process(f[0][0].process(r() * 2 - 1)) * e;
    o.r[at + i] += f[1][1].process(f[1][0].process(r() * 2 - 1)) * e;
  }
}

// Timbale : sinus grave légèrement descendant et peau qui frappe (sans claquement).
function timpani(o, sr, r, at, midi, { amp = 0.8 } = {}) {
  const f = mtof(midi);
  const n = Math.min(o.l.length - at, secs(sr, 1.4));
  let ph = 0;
  const lp = new Filter('lowpass', 500, 0.7, sr);
  const att = Math.round(sr * 0.003);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (f * (1 + 0.03 * Math.exp(-t / 0.05))) / sr;
    const v = ((Math.sin(TAU * ph) + 0.25 * Math.sin(TAU * ph * 1.5)) * Math.exp(-t / 0.45) * amp + lp.process(r() * 2 - 1) * Math.exp(-t / 0.03) * amp * 0.4) * rise(i, att);
    o.l[at + i] += v;
    o.r[at + i] += v;
  }
}

const finish = (o, sr, target = 0.75) => {
  normalizeStereo(dcBlock(o.l, sr), dcBlock(o.r, sr), target);
  fadeEdges(o.l, sr, 4);
  fadeEdges(o.r, sr, 4);
  return o;
};

// =====================================================================
// Départ
// =====================================================================
// Bip du compte à rebours : sinus rond, attaque de 8 ms, décroissance de cloche (court, jamais perçant).
// Le « partez » (dur longue) ajoute la quinte et l'octave graves : accord doux plutôt que bip aigu.
export function renderBeep(sr, r, { f = 660, dur = 0.24 } = {}) {
  const len = secs(sr, dur + 0.3);
  const out = new Float32Array(len);
  const chord = dur >= 0.4;
  const att = Math.round(sr * 0.008);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const e = rise(i, att) * Math.exp(-Math.max(0, t - 0.03) / (dur * 0.5));
    let v = Math.sin(TAU * f * t) + 0.1 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / 0.05) + 0.12 * Math.sin(TAU * 0.5 * f * t);
    if (chord) v += 0.45 * Math.sin(TAU * f * (2 / 3) * t) + 0.25 * Math.sin(TAU * f * 0.5 * t);
    out[i] = v * e;
  }
  return fadeEdges(normalize(out, 0.7), sr, 4);
}

// Corne de départ (corne à air) : deux anches en tierce, à peine saturées, filtrées bas ; petite montée de hauteur.
export function renderHorn(sr, r) {
  const dur = 0.95;
  const len = secs(sr, dur + 0.3);
  const out = new Float32Array(len);
  const oscs = [new Osc(sr, 0.1), new Osc(sr, 0.4), new Osc(sr, 0.7), new Osc(sr, 0.2)];
  const fr = [370, 371.2, 466, 467.4];
  const lp = new Filter('lowpass', 1500, 0.7, sr);
  const soft = new OnePole(2600, sr);
  const body = new Filter('peaking', 700, 1, sr, 3);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const bend = 0.95 + 0.05 * smoothstep(0, 0.08, t);
    let s = 0;
    for (let k = 0; k < 4; k++) s += oscs[k].saw(fr[k] * bend);
    const e = smoothstep(0, 0.05, t) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.25) ** 2 : 1);
    out[i] = body.process(soft.process(lp.process(Math.tanh(s * 0.3)))) * e;
  }
  return fadeEdges(normalize(dcBlock(out, sr), 0.75), sr, 4);
}

// Sifflet d'arbitre (à bille) : sifflement roulé par la bille, adouci (moins aigu, peu de souffle).
export function renderWhistle(sr, r) {
  const dur = 0.5;
  const len = secs(sr, dur + 0.08);
  const out = new Float32Array(len);
  const trill = range(r, 34, 44);
  const bp = new Filter('bandpass', 2500, 2, sr);
  const lp = new Filter('lowpass', 4000, 0.6, sr);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = 2500 * (1 + 0.03 * Math.sin(TAU * trill * t));
    ph += f / sr;
    const e = smoothstep(0, 0.02, t) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.06) : 1);
    out[i] = lp.process(Math.sin(TAU * ph) * (0.8 + 0.2 * Math.sin(TAU * trill * t)) + bp.process(r() * 2 - 1) * 0.15) * e;
  }
  return fadeEdges(normalize(out, 0.6), sr, 4);
}

// =====================================================================
// Objets et incidents de course
// =====================================================================
// Boîte à objet : petite roulette de célesta (notes pentatoniques qui défilent) puis arpège qui se pose.
export function renderPickup(sr, r) {
  const o = stereo(sr, 1.5);
  const scale = [72, 74, 76, 79, 81, 84, 86];
  let t = 0;
  for (let k = 0; k < 12; k++) {
    const gap = 0.034 + 0.026 * Math.abs(k - 4) / 8; // accélère puis ralentit, comme une roue
    glock(o, sr, Math.round(t * sr), mtof(scale[Math.floor(r() * scale.length)]), { amp: 0.32, dur: 0.2, pan: k % 2 ? 0.25 : -0.25, bright: 0.45 });
    t += gap;
  }
  const end = t + 0.04;
  [72, 76, 79, 84, 88].forEach((m, i) => glock(o, sr, Math.round((end + i * 0.04) * sr), mtof(m), { amp: 0.55, dur: 0.85, pan: -0.35 + i * 0.17, bright: 0.45 }));
  return finish(o, sr, 0.7);
}

// Turbo : coup sourd, souffle qui monte et note ronde qui grimpe (réacteur feutré).
export function renderTurbo(sr, r) {
  const o = stereo(sr, 1.4);
  const n = o.l.length;
  let ph = 0;
  const osc = new Osc(sr, 0);
  const lp = new Filter('lowpass', 400, 0.7, sr);
  const att = Math.round(sr * 0.004);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (45 + 50 * Math.exp(-t / 0.05)) / sr;
    const thump = Math.sin(TAU * ph) * Math.exp(-t / 0.12) * 0.8 * rise(i, att);
    const f = 120 * Math.pow(3.5, smoothstep(0, 0.85, t));
    if ((i & 31) === 0) lp.set(Math.min(f * 2.5, sr * 0.45), 0.7);
    const tone = lp.process(osc.tri(f * (1 + 0.008 * Math.sin(TAU * 7 * t)))) * 0.35 * arEnv(t / 1.35, 0.15, 0.45);
    o.l[i] += thump + tone;
    o.r[i] += thump + tone;
  }
  sweep(o, sr, r, 0, 1.2, 220, 1800, { q: 0.9, amp: 0.55, lp: 3000, env: (u) => smoothstep(0, 0.3, u) * (1 - smoothstep(0.55, 1, u)) });
  return finish(o, sr, 0.75);
}

// Peau de banane posée : « splotch » mouillé, rond, suivi de quelques bulles graves.
export function renderBananaDrop(sr, r) {
  const len = secs(sr, 0.45);
  const out = new Float32Array(len);
  const bp = new Filter('bandpass', 1200, 1.8, sr);
  const att = Math.round(sr * 0.004);
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const t = i / sr;
    if ((i & 31) === 0) bp.set(1200 * Math.pow(280 / 1200, smoothstep(0, 0.5, u)), 1.8);
    out[i] = bp.process(r() * 2 - 1) * 2.2 * rise(i, att) * Math.exp(-t / 0.07) * (0.65 + 0.35 * Math.sin(TAU * 30 * t));
  }
  addBubble(out, sr, 0, range(r, 160, 200), 0.8);
  for (let k = 0; k < 5; k++) addBubble(out, sr, Math.floor(r() * sr * 0.12), logRange(r, 400, 1000), range(r, 0.1, 0.25));
  new Filter('lowpass', 3500, 0.6, sr).run(out);
  return fadeEdges(normalize(dcBlock(out, sr), 0.75), sr, 4);
}

// Glissade sur la banane : frottement du pneu, puis petite sirène à coulisse qui descend (clin d'œil dessin
// animé). Crissement grave et feutré, jamais strident.
export function renderSkid(sr, r) {
  const o = stereo(sr, 1.3);
  const n = o.l.length;
  let ph = 0;
  let jit = 0;
  const bp = new Filter('bandpass', 1600, 1.2, sr);
  let ph2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 255) === 0) jit = (r() * 2 - 1) * 0.04;
    const f = (1500 - 450 * smoothstep(0, 0.9, t)) * (1 + jit);
    ph += f / sr;
    const sq = (Math.sin(TAU * ph) + 0.15 * Math.sin(2 * TAU * ph)) * 0.3 + bp.process(r() * 2 - 1) * 0.35;
    const e = smoothstep(0, 0.03, t) * (1 - smoothstep(0.5, 0.95, t));
    const fw = 900 - 550 * smoothstep(0.45, 1.15, t);
    ph2 += (fw * (1 + 0.03 * Math.sin(TAU * 7 * t))) / sr;
    const slide = Math.sin(TAU * ph2) * 0.25 * smoothstep(0.42, 0.52, t) * (1 - smoothstep(1.05, 1.25, t));
    const [gl, gr] = panGains(Math.sin(TAU * 1.5 * t) * 0.4);
    o.l[i] += sq * e * gl + slide;
    o.r[i] += sq * e * gr + slide;
  }
  // Choc de la roue
  const thud = renderBump(sr, r);
  mixInto(o.l, thud, 0, 0.6);
  mixInto(o.r, thud, 0, 0.6);
  lowpassStereo(o, sr, 3500);
  return finish(o, sr, 0.72);
}

// Choc sourd (roue sur la banane, bosse).
export function renderBump(sr, r) {
  const len = secs(sr, 0.24);
  const out = new Float32Array(len);
  const lp = new Filter('lowpass', 380, 0.7, sr);
  const att = Math.round(sr * 0.003);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    ph += (60 + 45 * Math.exp(-t / 0.02)) / sr;
    out[i] = (Math.sin(TAU * ph) * Math.exp(-t / 0.06) + lp.process(r() * 2 - 1) * Math.exp(-t / 0.02) * 0.6) * rise(i, att);
  }
  return fadeEdges(normalize(dcBlock(out, sr), 0.8), sr, 4);
}

// Dépassement : souffle stéréo feutré qui passe d'un côté à l'autre (dir = 1 : de gauche à droite).
export function renderWhoosh(sr, r, { dir = 1, dur = 0.7 } = {}) {
  const o = stereo(sr, dur);
  sweep(o, sr, r, 0, dur, 450, 650, {
    q: 0.8,
    amp: 0.9,
    exp: false,
    lp: 2500,
    env: (u) => Math.exp(-(((u - 0.5) / 0.22) ** 2)),
    pan: (u) => dir * (u * 2 - 1) * 0.9,
  });
  // Bande médiane qui « monte et redescend » (effet Doppler)
  sweep(o, sr, r, 0, dur, 800, 1300, { q: 1.2, amp: 0.3, lp: 2500, env: (u) => Math.exp(-(((u - 0.45) / 0.15) ** 2)), pan: (u) => dir * (u * 2 - 1) });
  return finish(o, sr, 0.7);
}

// Tour bouclé : carillon de deux notes montantes (quarte), registre médium.
export function renderLapChime(sr, r) {
  const o = stereo(sr, 1.8);
  glock(o, sr, 0, mtof(76), { amp: 0.8, dur: 1.3, pan: -0.15, bright: 0.5 });
  glock(o, sr, Math.round(0.14 * sr), mtof(81), { amp: 0.9, dur: 1.5, pan: 0.15, bright: 0.5 });
  return finish(o, sr, 0.72);
}

// Dernier tour : « ta-da-da-DAAA » aux cuivres feutrés, doublé de cloches, cymbale frottée.
export function renderFinalLap(sr, r) {
  const o = stereo(sr, 2.3);
  const seq = [[67, 0, 0.1], [72, 0.13, 0.1], [76, 0.26, 0.1], [79, 0.39, 0.9]];
  for (const [m, t, d] of seq) {
    brass(o, sr, Math.round(t * sr), m, d, { vel: 0.85, pan: -0.2 });
    brass(o, sr, Math.round(t * sr), m - 12, d, { vel: 0.6, pan: 0.2 });
    glock(o, sr, Math.round(t * sr), mtof(m), { amp: 0.22, dur: 0.6, bright: 0.4 });
  }
  brass(o, sr, Math.round(0.39 * sr), 76, 0.9, { vel: 0.65, pan: 0.3 });
  brass(o, sr, Math.round(0.39 * sr), 72, 0.9, { vel: 0.65, pan: -0.3 });
  cymbal(o, sr, r, Math.round(0.39 * sr), { amp: 0.12, dur: 1.6 });
  return finish(o, sr, 0.75);
}

// Arrivée : fanfare de cuivres feutrés (do majeur), timbales, cymbale frottée, cloches en cascade.
export function renderFanfare(sr, r) {
  const o = stereo(sr, 3.6);
  const C = [60, 64, 67, 72];
  const hits = [[0, 0.16, C], [0.2, 0.16, C], [0.4, 0.16, C], [0.62, 0.36, [65, 69, 72, 77]], [1.02, 0.36, [67, 71, 74, 79]], [1.42, 1.6, [60, 64, 67, 72, 76]]];
  for (const [t, d, chord] of hits) {
    chord.forEach((m, i) => brass(o, sr, Math.round(t * sr), m, d, { vel: 0.7, pan: -0.5 + (i / (chord.length - 1)) * 1 }));
    brass(o, sr, Math.round(t * sr), chord[0] - 12, d, { vel: 0.6, bright: 0.6 });
  }
  timpani(o, sr, r, 0, 36);
  timpani(o, sr, r, Math.round(0.62 * sr), 41, { amp: 0.6 });
  timpani(o, sr, r, Math.round(1.02 * sr), 43, { amp: 0.6 });
  timpani(o, sr, r, Math.round(1.42 * sr), 36);
  cymbal(o, sr, r, Math.round(1.42 * sr), { amp: 0.15, dur: 2.1 });
  [72, 76, 79, 84, 88, 91].forEach((m, i) => glock(o, sr, Math.round((1.5 + i * 0.08) * sr), mtof(m), { amp: 0.22, dur: 1.4, pan: -0.6 + i * 0.24, bright: 0.4 }));
  return finish(o, sr, 0.78);
}

// Écran des résultats : victoire (éclatant mais rond), podium (chaleureux) ou simple arrivée (doux).
export function renderSting(sr, r, { kind = 'win' } = {}) {
  const o = stereo(sr, 3.2);
  if (kind === 'win') {
    [72, 76, 79, 84].forEach((m, i) => {
      brass(o, sr, Math.round(i * 0.1 * sr), m, i === 3 ? 1.6 : 0.09, { vel: 0.8 });
      glock(o, sr, Math.round(i * 0.1 * sr), mtof(m), { amp: 0.3, dur: 1, bright: 0.4 });
    });
    [60, 67, 72, 74, 76].forEach((m, i) => brass(o, sr, Math.round(0.3 * sr), m, 1.6, { vel: 0.5, pan: -0.6 + i * 0.3, bright: 0.6 }));
    cymbal(o, sr, r, Math.round(0.3 * sr), { amp: 0.12, dur: 2.4 });
    timpani(o, sr, r, Math.round(0.3 * sr), 36);
  } else if (kind === 'podium') {
    [[65, 69, 72, 76], [60, 64, 67, 74]].forEach((chord, k) => chord.forEach((m, i) => {
      glock(o, sr, Math.round((k * 0.55 + i * 0.05) * sr), mtof(m + 12), { amp: 0.35, dur: 1.4, pan: -0.5 + i * 0.33, bright: 0.35 });
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
  return finish(o, sr, kind === 'other' ? 0.6 : 0.75);
}

// Changement de vitesse : petit clic feutré du dérailleur, puis la chaîne qui tombe sur le pignon.
export function renderGearClick(sr, r) {
  const len = secs(sr, 0.17);
  const out = new Float32Array(len);
  const ring = (at, f, amp, tau) => {
    for (let i = 0; at + i < len; i++) out[at + i] += Math.sin((TAU * f * i) / sr) * amp * Math.exp(-i / (sr * tau));
  };
  ring(0, 1400, 0.5, 0.006);
  ring(0, 2200, 0.2, 0.004);
  const at = Math.round(0.035 * sr);
  ring(at, 700, 0.6, 0.016);
  ring(at, 1150, 0.3, 0.01);
  const lp = new Filter('lowpass', 2500, 0.7, sr);
  const n1 = Math.round(sr * 0.002);
  for (let i = 0; i < n1; i++) out[i] += lp.process(r() * 2 - 1) * 0.3 * Math.sin((Math.PI * i) / n1);
  const lp2 = new Filter('lowpass', 1500, 0.7, sr);
  const n2 = Math.round(sr * 0.012);
  for (let i = 0; i < n2; i++) out[at + i] += lp2.process(r() * 2 - 1) * 0.35 * Math.sin((Math.PI * i) / n2);
  return fadeEdges(normalize(out, 0.6), sr, 2);
}

// Souffle du cycliste dans l'effort : inspiration légère, expiration plus grave et appuyée (bruit rose filtré).
export function renderBreath(sr, r, { dur = 1.6 } = {}) {
  const len = secs(sr, dur);
  const out = new Float32Array(len);
  const n = pink(len, r);
  const inh = new Filter('bandpass', range(r, 1100, 1400), 0.9, sr);
  const exh = new Filter('bandpass', range(r, 600, 720), 0.8, sr);
  const lp = new Filter('lowpass', 2400, 0.6, sr);
  const a = range(r, 0.34, 0.4);
  const b = a + 0.05;
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const ei = u < a ? Math.sin((Math.PI * u) / a) ** 2 * 0.35 : 0;
    const ue = (u - b) / (1 - b);
    const ee = ue > 0 && ue < 1 ? smoothstep(0, 0.08, ue) * Math.exp(-ue * 3.2) * (1 - smoothstep(0.85, 1, ue)) : 0;
    if ((i & 31) === 0 && ue > 0) exh.set(680 - 160 * Math.min(1, ue), 0.8);
    out[i] = lp.process(inh.process(n[i]) * ei * 3 + exh.process(n[i]) * ee * 3);
  }
  return fadeEdges(normalize(out, 0.7), sr, 6);
}

// =====================================================================
// Interface (menus) : petits sons ronds et brefs, registre médium, attaque douce
// =====================================================================
export function renderUi(sr, r, { kind = 'tick' } = {}) {
  if (kind === 'open' || kind === 'close') {
    const o = stereo(sr, 0.32);
    const up = kind === 'open';
    sweep(o, sr, r, 0, 0.3, up ? 350 : 1400, up ? 1400 : 350, { q: 0.9, amp: 0.5, lp: 2500, env: (u) => Math.sin(Math.PI * u) ** 1.5, pan: (u) => (up ? -0.25 + u * 0.5 : 0.25 - u * 0.5) });
    return finish(o, sr, 0.5);
  }
  // Notes : [fréquence, départ, durée] ; petit maillet de bois (sinus et un soupçon de troisième harmonique)
  const notes = { tick: [[1100, 0, 0.03]], confirm: [[784, 0, 0.09], [1175, 0.06, 0.2]], back: [[880, 0, 0.08], [659, 0.05, 0.16]] }[kind] || [[1100, 0, 0.03]];
  const len = secs(sr, 0.35);
  const out = new Float32Array(len);
  for (const [f, t, d] of notes) {
    const at = Math.round(t * sr);
    const tau = kind === 'tick' ? 0.012 : d / 3;
    const att = Math.round(sr * (kind === 'tick' ? 0.002 : 0.004));
    for (let i = 0; at + i < len; i++) {
      const tt = i / sr;
      const e = rise(i, att) * Math.exp(-tt / tau);
      out[at + i] += (Math.sin(TAU * f * tt) + 0.12 * Math.sin(TAU * 2 * f * tt) * Math.exp(-tt / 0.01) + 0.06 * Math.sin(TAU * 3 * f * tt) * Math.exp(-tt / 0.02)) * e;
    }
  }
  new Filter('lowpass', 3500, 0.6, sr).run(out);
  return fadeEdges(normalize(out, kind === 'tick' ? 0.45 : 0.6), sr, 2);
}

// =====================================================================
// Kayak : portes, sprint, tourbillon
// =====================================================================
export function renderGateDing(sr, r) {
  const o = stereo(sr, 1.5);
  glock(o, sr, 0, mtof(79), { amp: 0.9, dur: 1.2, bright: 0.6 });
  glock(o, sr, Math.round(0.07 * sr), mtof(86), { amp: 0.4, dur: 1, pan: 0.2, bright: 0.5 });
  return finish(o, sr, 0.72);
}

// Porte manquée : bourdon grave et rond (deux dents de scie très filtrées qui battent), deux fois.
export function renderGateBuzz(sr, r) {
  const len = secs(sr, 0.6);
  const out = new Float32Array(len);
  const a = new Osc(sr, 0);
  const b = new Osc(sr, 0.3);
  const lp = new Filter('lowpass', 650, 0.7, sr);
  const lp2 = new OnePole(1200, sr);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const on = (t < 0.19 ? arEnv(t / 0.19, 0.08, 0.15) : 0) + (t > 0.27 && t < 0.5 ? arEnv((t - 0.27) / 0.23, 0.08, 0.2) : 0);
    out[i] = lp2.process(lp.process(a.saw(110) + b.saw(116.5))) * on;
  }
  return fadeEdges(normalize(dcBlock(out, sr), 0.65), sr, 4);
}

export function renderSprintWhoosh(sr, r) {
  const o = stereo(sr, 1.4);
  sweep(o, sr, r, 0, 0.55, 300, 2200, { q: 1, amp: 0.6, lp: 3000, env: (u) => smoothstep(0, 0.4, u) * (1 - smoothstep(0.75, 1, u)) });
  const osc = new Osc(sr, 0);
  const lp = new Filter('lowpass', 1200, 0.7, sr);
  const n = secs(sr, 0.55);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const v = lp.process(osc.tri(220 * Math.pow(3, t / 0.55))) * 0.25 * arEnv(t / 0.55, 0.2, 0.3);
    o.l[i] += v;
    o.r[i] += v;
  }
  [79, 84, 88].forEach((m, i) => glock(o, sr, Math.round((0.5 + i * 0.06) * sr), mtof(m), { amp: 0.5, dur: 0.8, pan: -0.3 + i * 0.3, bright: 0.45 }));
  return finish(o, sr, 0.75);
}

export function renderSprintFail(sr, r) {
  const len = secs(sr, 0.85);
  const out = new Float32Array(len);
  const osc = new Osc(sr, 0);
  const lp = new Filter('lowpass', 600, 0.7, sr);
  const lo = new Filter('lowpass', 500, 0.7, sr);
  const att = Math.round(sr * 0.004);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    ph += (40 + 30 * Math.exp(-t / 0.06)) / sr;
    const thud = (Math.sin(TAU * ph) * Math.exp(-t / 0.12) + lo.process(r() * 2 - 1) * Math.exp(-t / 0.04) * 0.5) * rise(i, att);
    const womp = lp.process(osc.saw(220 * Math.pow(0.5, smoothstep(0.1, 0.7, t)))) * 0.45 * (t > 0.08 ? arEnv((t - 0.08) / 0.65, 0.1, 0.4) : 0);
    out[i] = thud + womp;
  }
  return fadeEdges(normalize(dcBlock(out, sr), 0.75), sr, 4);
}

// Tourbillon : remous qui tournent autour de la tête, gargouillis et vidange qui descend.
export function renderWhirlpool(sr, r, { dur = 2.5 } = {}) {
  const o = stereo(sr, dur);
  const n = o.l.length;
  const bl = new Filter('bandpass', 500, 1.6, sr);
  const br = new Filter('bandpass', 500, 1.6, sr);
  const swirl = range(r, 1.5, 2.4);
  const rot = range(r, 0.7, 1);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = i / n;
    if ((i & 31) === 0) {
      const f = 550 + 250 * Math.sin(TAU * swirl * t);
      bl.set(f, 1.6);
      br.set(f * 1.05, 1.6);
    }
    const e = arEnv(u, 0.2, 0.3);
    const a = TAU * rot * t;
    ph += (400 * Math.pow(0.4, u)) / sr;
    const drain = Math.sin(TAU * ph) * 0.15 * (0.6 + 0.4 * Math.sin(TAU * 6 * t));
    o.l[i] += (bl.process(r() * 2 - 1) * 2 * (0.6 + 0.4 * Math.cos(a)) + drain) * e;
    o.r[i] += (br.process(r() * 2 - 1) * 2 * (0.6 + 0.4 * Math.sin(a)) + drain) * e;
  }
  const g = renderBubbles(sr, r, { seconds: dur, rate: 60, fmin: 200, fmax: 650, loop: false, env: (u) => arEnv(u, 0.2, 0.3) });
  mixInto(o.l, g, 0, 0.5);
  mixInto(o.r, g, Math.round(sr * 0.01), 0.5);
  lowpassStereo(o, sr, 3000);
  return finish(o, sr, 0.72);
}

export function renderKayakSplash(sr, r) {
  return renderSplash(sr, r, { size: 1.6 });
}

// =====================================================================
// Batterie de la musique : kit feutré (grosse caisse ronde, caisse claire au balai, maracas douces).
// Aucun oscillateur carré métallique : les cymbales sont du bruit filtré, attaque de 1 à 2 ms.
// =====================================================================
export function renderDrum(sr, r, { kind = 'kick' } = {}) {
  let len;
  let out;
  const att = (ms) => Math.round((sr * ms) / 1000);
  switch (kind) {
    case 'kick': {
      len = secs(sr, 0.45);
      out = new Float32Array(len);
      let ph = 0;
      const a = att(1.5);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        ph += (50 + 60 * Math.exp(-t / 0.03)) / sr;
        out[i] = Math.sin(TAU * ph) * Math.exp(-t / 0.25) * rise(i, a);
      }
      break;
    }
    case 'snare': {
      len = secs(sr, 0.3);
      out = new Float32Array(len);
      const bp = new Filter('bandpass', 1800, 0.7, sr);
      const lp = new Filter('lowpass', 5000, 0.6, sr);
      const a = att(1.5);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        out[i] = (Math.sin(TAU * 190 * t) * Math.exp(-t / 0.04) * 0.5 + lp.process(bp.process(r() * 2 - 1)) * Math.exp(-t / 0.07) * 1.4) * rise(i, a);
      }
      break;
    }
    case 'clap': {
      len = secs(sr, 0.3);
      out = new Float32Array(len);
      const bp = new Filter('bandpass', 1150, 1.1, sr);
      const lp = new Filter('lowpass', 4000, 0.6, sr);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        let e = 0;
        for (const at of [0, 0.009, 0.019]) if (t >= at) e = Math.max(e, smoothstep(0, 0.0015, t - at) * Math.exp(-(t - at) / 0.006));
        if (t >= 0.025) e = Math.max(e, 0.55 * Math.exp(-(t - 0.025) / 0.06));
        out[i] = lp.process(bp.process(r() * 2 - 1)) * e * 2.5;
      }
      break;
    }
    case 'hat':
    case 'openhat': {
      // Charleston feutré : bruit filtré autour de 6,5 kHz, plafonné à 9 kHz
      const tau = kind === 'hat' ? 0.018 : 0.09;
      len = secs(sr, kind === 'hat' ? 0.1 : 0.4);
      out = new Float32Array(len);
      const bp = new Filter('bandpass', 6500, 1, sr);
      const lp = new Filter('lowpass', 9000, 0.6, sr);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        out[i] = lp.process(bp.process(r() * 2 - 1)) * smoothstep(0, 0.0015, t) * Math.exp(-t / tau);
      }
      break;
    }
    case 'shaker': {
      len = secs(sr, 0.14);
      out = new Float32Array(len);
      const bp = new Filter('bandpass', 5500, 1.2, sr);
      const lp = new Filter('lowpass', 8000, 0.6, sr);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        out[i] = lp.process(bp.process(r() * 2 - 1)) * smoothstep(0, 0.015, t) * Math.exp(-t / 0.04);
      }
      break;
    }
    case 'rim': {
      // Bloc de bois
      len = secs(sr, 0.1);
      out = new Float32Array(len);
      const a = att(1);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        out[i] = (Math.sin(TAU * 900 * t) + 0.4 * Math.sin(TAU * 1430 * t) * Math.exp(-t / 0.012)) * Math.exp(-t / 0.025) * rise(i, a);
      }
      break;
    }
    case 'conga': {
      len = secs(sr, 0.35);
      out = new Float32Array(len);
      let ph = 0;
      const bp = new Filter('bandpass', 1500, 1, sr);
      const a = att(1.5);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        ph += (300 + 30 * Math.exp(-t / 0.02)) / sr;
        out[i] = (Math.sin(TAU * ph) * Math.exp(-t / 0.15) + bp.process(r() * 2 - 1) * Math.exp(-t / 0.008) * 0.3) * rise(i, a);
      }
      break;
    }
    default: {
      // Balai sur caisse claire (musique du menu)
      len = secs(sr, 0.25);
      out = new Float32Array(len);
      const lp = new Filter('lowpass', 3500, 0.7, sr);
      const hp = new Filter('highpass', 800, 0.7, sr);
      for (let i = 0; i < len; i++) {
        const u = i / len;
        out[i] = hp.process(lp.process(r() * 2 - 1)) * Math.sin(Math.PI * Math.min(1, u * 1.6)) ** 2;
      }
    }
  }
  return fadeEdges(normalize(dcBlock(out, sr), 0.85), sr, 2);
}

// =====================================================================
// Notes d'instruments (une par hauteur, gardées en cache par le moteur), toutes adoucies dans l'aigu.
//   pluck : guitare nylon (Karplus-Strong) ; marimba ; bell : kalimba / célesta ;
//   keys : piano électrique (synthèse FM douce) ; synth : pluck électronique feutré
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
    const pick = new OnePole(2200, sr);
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
    new Filter('peaking', 220, 1, sr, 2).run(out);
    new Filter('lowpass', 4500, 0.6, sr).run(out);
  } else if (instrument === 'marimba') {
    const lp = new Filter('lowpass', 2500, 0.7, sr);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const e = rise(i, Math.round(sr * 0.002));
      out[i] = e * (Math.sin(TAU * f * t) * Math.exp(-t / (0.25 + 60 / f)) + 0.25 * Math.sin(TAU * 4 * f * t) * Math.exp(-t / 0.04) + 0.03 * Math.sin(TAU * 9.9 * f * t) * Math.exp(-t / 0.012)) + lp.process(r() * 2 - 1) * Math.exp(-t / 0.003) * 0.12;
    }
  } else if (instrument === 'bell') {
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const e = rise(i, Math.round(sr * 0.003));
      out[i] = e * (Math.sin(TAU * f * t) * Math.exp(-t / 0.55) + 0.15 * Math.sin(TAU * 2.76 * f * t) * Math.exp(-t / 0.2) + 0.04 * Math.sin(TAU * 5.4 * f * t) * Math.exp(-t / 0.08) + 0.12 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / 0.35));
    }
  } else if (instrument === 'keys') {
    // Piano électrique : porteuse + modulateur au même rapport, indice qui retombe (lame qui sonne puis s'adoucit)
    let pc = 0;
    let pm = 0;
    let pt = 0;
    const a = Math.round(sr * 0.004);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const idx = 0.2 + 1.3 * Math.exp(-t / 0.3);
      pm += f / sr;
      pt += (f * 7) / sr;
      pc += f / sr;
      const tine = Math.sin(TAU * pt) * 0.03 * Math.exp(-t / 0.015);
      out[i] = (Math.sin(TAU * pc + idx * Math.sin(TAU * pm)) + tine) * rise(i, a) * Math.exp(-t / (0.9 + 80 / f));
    }
    new Filter('lowpass', 4500, 0.6, sr).run(out);
  } else {
    const a = new Osc(sr, 0);
    const b = new Osc(sr, 0.5);
    const lp = new Filter('lowpass', 1500, 0.8, sr);
    const att = Math.round(sr * 0.005);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if ((i & 31) === 0) lp.set(300 + 1400 * Math.exp(-t / 0.12) + f * 0.8, 0.8);
      out[i] = lp.process(a.saw(f * 1.003) + b.saw(f * 0.997)) * rise(i, att) * Math.exp(-t / 0.3);
    }
  }
  return fadeEdges(normalize(dcBlock(out, sr), 0.8), sr, 3);
}

// =====================================================================
// Réverbération : réponses impulsionnelles générées (pas de fichier)
//   queue diffuse (bruit qui décroît, aigus amortis avec le temps, comme l'air), premières réflexions
//   (sol, berges) et, en montagne ou dans un canyon, de vrais échos renvoyés par les parois.
// =====================================================================
export const REVERB_PRESETS = {
  meadow: { t60: 0.9, pre: 0.008, damp: 2500, early: [[0.004, 0.5], [0.011, 0.25]], echoes: [] },
  alpine: { t60: 1.5, pre: 0.02, damp: 2000, early: [[0.007, 0.4], [0.019, 0.2]], echoes: [[0.38, 0.9, 2400], [0.82, 0.6, 1700], [1.35, 0.38, 1200], [1.95, 0.22, 850]] },
  coast: { t60: 0.7, pre: 0.006, damp: 3000, early: [[0.004, 0.45]], echoes: [] },
  lake: { t60: 1.5, pre: 0.012, damp: 2600, early: [[0.006, 0.6], [0.014, 0.3]], echoes: [[0.55, 0.18, 1800]] },
  river: { t60: 1.3, pre: 0.01, damp: 2600, early: [[0.005, 0.5], [0.012, 0.35]], echoes: [[0.22, 0.32, 2400], [0.47, 0.16, 1700]] },
  // Sous-bois : réflexions denses et proches sur les troncs, queue sourde.
  forest: { t60: 1.1, pre: 0.01, damp: 2000, early: [[0.006, 0.45], [0.013, 0.32], [0.021, 0.22], [0.034, 0.14]], echoes: [] },
};

export function renderImpulse(sr, r, preset = 'meadow') {
  const p = REVERB_PRESETS[preset] || REVERB_PRESETS.meadow;
  const tail = Math.max(p.t60, ...p.echoes.map((e) => e[0] + 0.6));
  const len = secs(sr, tail + p.pre + 0.1);
  const ch = [new Float32Array(len), new Float32Array(len)];
  for (const out of ch) {
    const lp = new Filter('lowpass', 6000, 0.6, sr);
    const start = Math.round(p.pre * sr);
    for (let i = start; i < len; i++) {
      const t = (i - start) / sr;
      if ((i & 255) === 0) lp.set(6000 * Math.pow(p.damp / 6000, Math.min(1, t / p.t60)), 0.6);
      out[i] = lp.process(r() * 2 - 1) * Math.exp((-6.907755 * t) / p.t60) * smoothstep(0, 0.012, t);
    }
    // Premières réflexions : petites bouffées adoucies plutôt qu'impulsions d'un seul échantillon
    for (const [t, g] of p.early) {
      const at = Math.round((t + range(r, -0.0015, 0.0015)) * sr);
      const s = r() < 0.5 ? -1 : 1;
      const w = Math.round(sr * 0.0006);
      for (let i = -w; i <= w; i++) if (at + i >= 0 && at + i < len) out[at + i] += (g * s * Math.cos((Math.PI / 2) * (i / (w + 1)))) / Math.sqrt(w + 1);
    }
    for (const [t, g, f] of p.echoes) {
      const at = Math.round((t + range(r, -0.01, 0.01)) * sr);
      const blp = new Filter('lowpass', f, 0.7, sr);
      const n = Math.round(sr * 0.06);
      for (let i = 0; i < n && at + i < len; i++) out[at + i] += blp.process(r() * 2 - 1) * g * smoothstep(0, 0.003, i / sr) * Math.exp(-i / (sr * 0.015)) * 1.4;
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
  // Craquement filtré (passe-bas ~1,8 kHz) et attaque de 6 ms : impressionnant sans claquer dans les oreilles.
  const kc = 1 - Math.exp((-TAU * 1800) / sr);
  let cs = 0;
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
      cs += ((r() * 2 - 1) - cs) * kc;
      const c = cs * Math.exp(-u / 0.06) * Math.min(1, u / 0.006) * 0.9 * near;
      vl += c;
      vr += c * 0.8;
    }
    o.l[i] = vl;
    o.r[i] = vr;
  }
  return finish(o, sr, 0.8);
}

// =====================================================================
// VTT (circuit en forêt) : saut, réception, chute, boue, pic-vert
// =====================================================================

// Note de saut réussi : notes de glockenspiel qui montent, scintillement.
export function renderJumpChime(sr, r) {
  const o = stereo(sr, 1.3);
  [84, 88, 91, 96].forEach((m, i) => glock(o, sr, Math.round(i * 0.055 * sr), mtof(m), { amp: 0.5 + i * 0.1, dur: 0.9, pan: -0.3 + i * 0.2, bright: 1.2 }));
  sweep(o, sr, r, 0, 0.5, 5000, 9500, { q: 0.8, amp: 0.1, env: (u) => Math.exp(-u * 4) });
  return finish(o, sr, 0.8);
}

// Réception : choc sourd des pneus, souffle de la fourche qui s'enfonce, cliquetis de la chaîne.
export function renderLand(sr, r) {
  const len = secs(sr, 0.45);
  const out = new Float32Array(len);
  const lp = new Filter('lowpass', 380, 0.8, sr);
  const bp = new Filter('bandpass', 900, 0.9, sr);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    ph += (48 + 60 * Math.exp(-t / 0.025)) / sr;
    const thud = Math.sin(TAU * ph) * Math.exp(-t / 0.09) + lp.process(r() * 2 - 1) * Math.exp(-t / 0.03) * 0.9;
    const fork = bp.process(r() * 2 - 1) * 0.35 * smoothstep(0.01, 0.04, t) * Math.exp(-t / 0.08);
    out[i] = thud + fork;
  }
  for (let k = 0; k < 5; k++) addDecaySine(out, Math.round(sr * (0.015 + r() * 0.06)), sr, logRange(r, 2800, 5200), range(r, 0.05, 0.12), 90, secs(sr, 0.08));
  return fadeEdges(normalize(out, 0.85), sr, 1);
}

// Chute : choc, glissade dans la terre et les feuilles, vélo qui cliquette en retombant.
export function renderCrash(sr, r) {
  const o = stereo(sr, 1.5);
  const n = o.l.length;
  const lp = new Filter('lowpass', 300, 0.9, sr);
  const scrapeL = new Filter('bandpass', 1400, 0.8, sr);
  const scrapeR = new Filter('bandpass', 1500, 0.8, sr);
  let ph = 0;
  let rough = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (42 + 50 * Math.exp(-t / 0.04)) / sr;
    const thud = Math.sin(TAU * ph) * Math.exp(-t / 0.13) * 0.9 + lp.process(r() * 2 - 1) * Math.exp(-t / 0.05) * 0.8;
    if ((i & 127) === 0) rough = 0.5 + r() * 0.8;
    const slide = smoothstep(0.03, 0.1, t) * (1 - smoothstep(0.55, 1.1, t)) * rough * 0.6;
    const [gl, gr] = panGains(Math.sin(t * 3) * 0.4);
    o.l[i] += thud + scrapeL.process(r() * 2 - 1) * slide * gl * 1.6;
    o.r[i] += thud + scrapeR.process(r() * 2 - 1) * slide * gr * 1.6;
  }
  // Cliquetis métalliques (cadre, chaîne, rayons) qui rebondissent
  for (let k = 0; k < 9; k++) {
    const at = Math.round(sr * (0.05 + Math.pow(r(), 1.4) * 0.7));
    const f = logRange(r, 1800, 6200);
    const a = range(r, 0.05, 0.16) * (1 - at / n);
    addDecaySine(r() < 0.5 ? o.l : o.r, at, sr, f, a, 40, secs(sr, 0.15));
    addDecaySine(r() < 0.5 ? o.l : o.r, at, sr, f * 1.48, a * 0.6, 55, secs(sr, 0.1));
  }
  return finish(o, sr, 0.85);
}

// Boue : succion molle, petites bulles qui éclatent.
export function renderSquelch(sr, r) {
  const len = secs(sr, 0.38);
  const out = new Float32Array(len);
  const bp = new Filter('bandpass', 700, 2.2, sr);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const u = i / len;
    if ((i & 31) === 0) bp.set(700 * Math.pow(220 / 700, smoothstep(0, 0.7, u)), 2.2);
    out[i] = bp.process(r() * 2 - 1) * 3 * Math.min(1, t / 0.01) * Math.exp(-t / 0.1) * (0.7 + 0.3 * Math.sin(TAU * 22 * t));
  }
  addBubble(out, sr, Math.round(sr * range(r, 0.05, 0.12)), range(r, 140, 220), 0.6);
  for (let k = 0; k < 4; k++) addBubble(out, sr, Math.floor(r() * sr * 0.25), logRange(r, 400, 1100), range(r, 0.08, 0.2));
  return fadeEdges(normalize(out, 0.8), sr, 2);
}

// Pic-vert qui tambourine : une rafale de coups secs sur le bois.
export function renderWoodpecker(sr, r) {
  const count = Math.round(range(r, 12, 20));
  const rate = range(r, 14, 18);
  const len = secs(sr, count / rate + 0.25);
  const out = new Float32Array(len);
  const body = range(r, 850, 1250);
  const click = secs(sr, 0.004);
  const rise = Math.max(1, secs(sr, 0.001));
  const kc = 1 - Math.exp((-TAU * 3500) / sr);
  let t = 0;
  for (let k = 0; k < count; k++) {
    const at = Math.round(t * sr);
    const amp = (0.55 + 0.45 * Math.sin((Math.PI * (k + 1)) / (count + 1))) * range(r, 0.85, 1);
    addDecaySine(out, at, sr, body, amp, 160, secs(sr, 0.05));
    addDecaySine(out, at, sr, body * 2.37, amp * 0.45, 260, secs(sr, 0.03));
    addDecaySine(out, at, sr, body * 0.52, amp * 0.5, 120, secs(sr, 0.05));
    // Attaque sèche mais adoucie (bruit passe-bas, montée en 1 ms) : pas de saut d'échantillon qui claque.
    let cs = 0;
    for (let i = 0; i < click; i++) {
      cs += ((r() * 2 - 1) - cs) * kc;
      if (at + i < len) out[at + i] += cs * 0.4 * Math.min(1, i / rise) * (1 - i / click);
    }
    t += (1 / rate) * (1 + 0.15 * Math.sin((Math.PI * k) / count));
  }
  return fadeEdges(normalize(out, 0.8), sr, 2);
}
