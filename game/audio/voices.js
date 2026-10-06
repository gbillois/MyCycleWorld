// Sons de la nature et des animaux, calculés dans des Float32Array (module pur, testé dans tests/audio.test.js).
// Oiseaux (sinus à contour de fréquence), animaux de la ferme (source glottale + formants), cloches
// (synthèse modale à partiels inharmoniques), eau (bulles de Minnaert), insectes, foule.
// Chaque fonction : (sr, r, options) -> Float32Array (mono) ou { l, r } (stéréo). r = générateur 0..1.
import { TAU, smoothstep, Filter, OnePole, Osc, arEnv, addDecaySine, mixInto, normalize, normalizeStereo, fadeEdges, dcBlock, panGains, white, pink, loopFilter } from './dsp.js';
import { contour, songDuration } from './patterns.js';
import { range, irange, logRange, pick, chance } from './random.js';

const secs = (sr, s) => Math.max(1, Math.round(sr * s));

// =====================================================================
// Oiseaux
// =====================================================================
export function renderSong(sr, notes, { gain = 0.9 } = {}) {
  const len = secs(sr, songDuration(notes) + 0.05);
  const out = new Float32Array(len);
  for (const n of notes) {
    const start = Math.round(n.t * sr);
    const count = secs(sr, n.d);
    let ph = 0;
    for (let i = 0; i < count && start + i < len; i++) {
      const u = i / count;
      const t = i / sr;
      let f = contour(n, u);
      if (n.fm) f *= 1 + n.fm[1] * Math.sin(TAU * n.fm[0] * t);
      ph += f / sr;
      ph -= Math.floor(ph);
      let s = Math.sin(TAU * ph) + n.h2 * Math.sin(2 * TAU * ph) + n.h2 * 0.3 * Math.sin(3 * TAU * ph);
      let e = arEnv(u, n.att, n.rel) * n.a;
      if (n.am) e *= 1 - n.am[1] * (0.5 + 0.5 * Math.sin(TAU * n.am[0] * t));
      out[start + i] += s * e;
    }
  }
  return fadeEdges(normalize(out, gain), sr, 2);
}

// =====================================================================
// Voix à formants (vache, mouton, coq, canard, goéland, rapace, foule)
// =====================================================================
// o : { dur, f0(u, t), formants(u) -> [[f, q, gain], ...], env(u), breath, jitter, am(t), tilt }
export function renderVoice(sr, r, o) {
  const len = secs(sr, o.dur);
  const out = new Float32Array(len);
  const osc = new Osc(sr, r());
  const nf = o.formants(0).length;
  const filters = Array.from({ length: nf }, () => new Filter('bandpass', 1000, 4, sr));
  const tilt = new OnePole(o.tilt || 3500, sr);
  const gains = new Float32Array(nf);
  let jit = 0;
  let jitTarget = 0;
  const jitter = o.jitter ?? 0.012;
  const breath = o.breath ?? 0.08;
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const t = i / sr;
    if ((i & 31) === 0) {
      const fm = o.formants(u);
      for (let k = 0; k < nf; k++) {
        filters[k].set(fm[k][0], fm[k][1]);
        gains[k] = fm[k][2];
      }
      // Gigue de la hauteur : une voix naturelle n'est jamais parfaitement stable.
      if ((i & 511) === 0) jitTarget = (r() * 2 - 1) * jitter;
    }
    jit += (jitTarget - jit) * 0.002;
    const f = o.f0(u, t) * (1 + jit);
    let src = osc.saw(f) * (1 - breath) + (r() * 2 - 1) * breath * 1.6;
    if (o.am) src *= o.am(t, u);
    src = tilt.process(src);
    let y = 0;
    for (let k = 0; k < nf; k++) y += filters[k].process(src) * gains[k];
    out[i] = y * o.env(u, t);
  }
  return fadeEdges(normalize(dcBlock(out, sr), o.gain ?? 0.85), sr, 3);
}

export function renderCow(sr, r) {
  const dur = range(r, 1.3, 2.2);
  const b = range(r, 92, 118);
  const vib = range(r, 4, 5.5);
  return renderVoice(sr, r, {
    dur,
    jitter: 0.02,
    breath: 0.07,
    tilt: 2200,
    f0: (u, t) => b * (0.82 + 0.34 * smoothstep(0, 0.25, u) - 0.22 * smoothstep(0.68, 1, u)) * (1 + 0.015 * Math.sin(TAU * vib * t)),
    // « mmm » bouche fermée, puis « ôô-euh » qui s'ouvre et se referme
    formants: (u) => {
      const open = smoothstep(0.05, 0.4, u) * (1 - 0.4 * smoothstep(0.75, 1, u));
      return [[250 + 420 * open, 5, 1], [700 + 450 * open, 8, 0.5 * (0.3 + open)], [2300, 12, 0.15 * open], [180, 2, 0.5]];
    },
    env: (u) => arEnv(u, 0.18, 0.25),
  });
}

export function renderSheep(sr, r) {
  const dur = range(r, 0.6, 1.1);
  const b = range(r, 270, 370);
  const trem = range(r, 7, 9.5);
  return renderVoice(sr, r, {
    dur,
    jitter: 0.02,
    breath: 0.12,
    tilt: 4000,
    // Le bêlement chevrotant : la voix pulse 7 à 9 fois par seconde, en hauteur et en force.
    f0: (u, t) => b * (1 - 0.1 * smoothstep(0.6, 1, u)) * (1 + 0.035 * Math.sin(TAU * trem * t)),
    formants: () => [[650, 5, 1], [1750, 8, 0.6], [2600, 10, 0.3]],
    am: (t) => 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(TAU * trem * t)),
    env: (u) => arEnv(u, 0.12, 0.3),
  });
}

export function renderRooster(sr, r) {
  const k = range(r, 0.92, 1.08);
  const dur = range(r, 1.4, 1.7);
  // « co-co-ri-coooo » : quatre syllabes, la dernière longue et chevrotante.
  const syl = [[0, 0.1, 520], [0.12, 0.22, 610], [0.25, 0.38, 770], [0.42, 1, 720]];
  return renderVoice(sr, r, {
    dur,
    jitter: 0.015,
    breath: 0.16,
    tilt: 5000,
    f0: (u, t) => {
      let f = 520;
      for (const [a, , ff] of syl) if (u >= a) f = ff;
      if (u > 0.42) f = 720 - 120 * smoothstep(0.5, 1, u) + 14 * Math.sin(TAU * 6 * t);
      return f * k;
    },
    formants: (u) => [[u > 0.42 ? 760 : 820, 4, 1], [1500, 6, 0.6], [2900, 8, 0.35]],
    am: (t) => 1 - 0.3 * (0.5 + 0.5 * Math.sin(TAU * 90 * t)),
    env: (u) => {
      let e = 0;
      for (const [a, b] of syl) if (u >= a && u <= b) e = arEnv((u - a) / (b - a), 0.15, 0.2);
      return e;
    },
  });
}

export function renderQuack(sr, r, { amp = 1, pitch = 1 } = {}) {
  const b = range(r, 250, 290) * pitch;
  return renderVoice(sr, r, {
    dur: range(r, 0.12, 0.17),
    jitter: 0.03,
    breath: 0.22,
    tilt: 4500,
    f0: (u) => b * (1.05 - 0.2 * u),
    formants: () => [[1000, 3, 1], [2300, 5, 0.7], [3300, 6, 0.25]],
    am: (t) => 1 - 0.35 * (0.5 + 0.5 * Math.sin(TAU * 45 * t)),
    env: (u) => arEnv(u, 0.08, 0.35) * amp,
    gain: 0.85 * amp,
  });
}

// Canard colvert : « COIN coin coin coin », chaque cri plus faible et plus grave.
export function renderDuck(sr, r) {
  const n = irange(r, 2, 5);
  const parts = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    parts.push([t, renderQuack(sr, r, { amp: 1 - i * 0.14, pitch: 1 - i * 0.03 })]);
    t += range(r, 0.17, 0.24);
  }
  const out = new Float32Array(secs(sr, t + 0.25));
  for (const [at, buf] of parts) mixInto(out, buf, Math.round(at * sr));
  return normalize(out, 0.85);
}

// Goéland : long cri « kyaaou » puis « ha-ha-ha » qui retombe (le rire des ports).
export function renderGull(sr, r) {
  const k = range(r, 0.9, 1.12);
  const mew = chance(r, 0.3);
  const syl = [];
  if (mew) syl.push({ d: range(r, 0.5, 0.7), f: (u) => (1600 - 700 * u) * k });
  else {
    syl.push({ d: range(r, 0.38, 0.5), f: (u) => (u < 0.15 ? 700 + 800 * smoothstep(0, 0.15, u) : 1500 - 400 * smoothstep(0.15, 1, u)) * k });
    const n = irange(r, 3, 6);
    for (let i = 0; i < n; i++) syl.push({ d: range(r, 0.09, 0.13), f: (u) => (1250 - 200 * u - i * 25) * k, amp: 0.85 - i * 0.07 });
  }
  const parts = [];
  let t = 0;
  for (const s of syl) {
    parts.push([t, renderVoice(sr, r, {
      dur: s.d,
      jitter: 0.02,
      breath: 0.16,
      tilt: 6000,
      f0: (u) => s.f(u),
      formants: () => [[1800, 4, 1], [3000, 5, 0.6], [900, 3, 0.35]],
      am: (tt) => 1 - 0.25 * (0.5 + 0.5 * Math.sin(TAU * 55 * tt)),
      env: (u) => arEnv(u, 0.08, 0.3),
      gain: 0.85 * (s.amp ?? 1),
    })]);
    t += s.d + range(r, 0.05, 0.09);
  }
  const out = new Float32Array(secs(sr, t + 0.1));
  for (const [at, buf] of parts) mixInto(out, buf, Math.round(at * sr));
  return normalize(out, 0.85);
}

// Buse / aigle : « pii-yaaa » perçant qui retombe, très loin au-dessus des cols.
export function renderRaptor(sr, r) {
  const n = irange(r, 1, 3);
  const parts = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const top = range(r, 2500, 2900);
    parts.push([t, renderVoice(sr, r, {
      dur: range(r, 0.8, 1.1),
      jitter: 0.02,
      breath: 0.25,
      tilt: 7000,
      f0: (u, tt) => (u < 0.14 ? 1500 + (top - 1500) * smoothstep(0, 0.14, u) : top - (top - 1250) * smoothstep(0.14, 1, u)) * (1 + 0.01 * Math.sin(TAU * 18 * tt)),
      formants: () => [[2500, 3, 1], [4200, 4, 0.45], [1500, 3, 0.3]],
      am: (tt) => 1 - 0.2 * (0.5 + 0.5 * Math.sin(TAU * 30 * tt)),
      env: (u) => arEnv(u, 0.06, 0.45),
    })]);
    t += range(r, 1.4, 2.2);
  }
  const out = new Float32Array(secs(sr, t));
  for (const [at, buf] of parts) mixInto(out, buf, Math.round(at * sr));
  return normalize(out, 0.85);
}

// Cheval : ébrouement (lèvres qui vibrent) ou, plus rarement, hennissement.
export function renderHorse(sr, r) {
  if (chance(r, 0.25)) {
    return renderVoice(sr, r, {
      dur: range(r, 1.1, 1.4),
      jitter: 0.03,
      breath: 0.2,
      tilt: 5000,
      f0: (u, t) => (u < 0.15 ? 900 + 400 * smoothstep(0, 0.15, u) : 1300 - 800 * smoothstep(0.15, 1, u)) * (1 + 0.08 * Math.sin(TAU * 10 * t)),
      formants: () => [[1100, 4, 1], [2400, 5, 0.5], [600, 3, 0.4]],
      env: (u) => arEnv(u, 0.05, 0.4),
    });
  }
  const len = secs(sr, range(r, 0.6, 0.9));
  const out = new Float32Array(len);
  const n = pink(len, r);
  const bp1 = new Filter('bandpass', range(r, 600, 800), 1.2, sr);
  const bp2 = new Filter('bandpass', 1800, 2, sr);
  const lo = new Filter('bandpass', 250, 1.5, sr);
  const flutter = range(r, 26, 34);
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const t = i / sr;
    const am = 1 - 0.85 * (0.5 + 0.5 * Math.sin(TAU * flutter * t + 2 * Math.sin(TAU * 3 * t)));
    const x = n[i] * 4;
    out[i] = (bp1.process(x) + 0.5 * bp2.process(x) + 0.6 * lo.process(x)) * am * arEnv(u, 0.06, 0.5) * (1 - 0.4 * u);
  }
  return fadeEdges(normalize(out, 0.8), sr, 3);
}

// Bourdon qui passe (stéréo) : battements d'ailes ~220 Hz, effet Doppler et panoramique.
export function renderBee(sr, r) {
  const dur = range(r, 1.8, 3);
  const len = secs(sr, dur);
  const l = new Float32Array(len);
  const rr = new Float32Array(len);
  const osc = new Osc(sr, r());
  const lp = new Filter('lowpass', 1800, 0.7, sr);
  const body = new Filter('peaking', 450, 2, sr, 6);
  const f0 = range(r, 190, 240);
  const dir = chance(r, 0.5) ? 1 : -1;
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const t = i / sr;
    const x = dir * (u * 2 - 1); // position latérale -1..1
    const doppler = 1 + 0.05 * Math.cos(Math.PI * u) * 1; // approche (plus aigu) puis éloignement
    const f = f0 * doppler * (1 + 0.02 * Math.sin(TAU * 7 * t + Math.sin(TAU * 1.3 * t)));
    const s0 = osc.saw(f);
    const s = body.process(lp.process(s0 + 0.3 * s0 * s0 * s0));
    const near = Math.exp(-((u - 0.5) ** 2) / 0.05);
    const [gl, gr] = panGains(x);
    const e = s * near * arEnv(u, 0.1, 0.1);
    l[i] = e * gl;
    rr[i] = e * gr;
  }
  return normalizeStereo(l, rr, 0.7);
}

// =====================================================================
// Cloches (synthèse modale : partiels inharmoniques, chacun avec sa durée de résonance)
// =====================================================================
// Ajoute un partiel « doublet » (deux modes très proches qui battent, comme une vraie cloche).
function partial(out, sr, start, f, amp, t60, beat, phase) {
  const n = Math.min(out.length - start, secs(sr, t60 * 1.1));
  const d = 6.907755 / t60;
  addDecaySine(out, start, sr, f * (1 - beat), amp * 0.5, d, n, 0, false, phase);
  addDecaySine(out, start, sr, f * (1 + beat), amp * 0.5, d, n, 0, false, phase * 1.7);
}

// Cloche de vache (sonnaille) : son métallique, creux et un peu ferraillant, double coup du battant possible.
export function renderCowbell(sr, r, { f0 = 650, double = false } = {}) {
  const len = secs(sr, 1.5);
  const out = new Float32Array(len);
  const ratios = [1, 1.59, 2.14, 2.68, 3.37, 4.12, 5.2];
  const amps = [1, 0.62, 0.48, 0.36, 0.26, 0.16, 0.1];
  const t60 = [1.25, 0.95, 0.7, 0.52, 0.4, 0.3, 0.22];
  const hits = double ? [[0, 1], [Math.round(sr * range(r, 0.045, 0.085)), 0.45]] : [[0, 1]];
  for (const [at, g] of hits) {
    ratios.forEach((q, k) => partial(out, sr, at, f0 * q * range(r, 0.995, 1.005), amps[k] * g * range(r, 0.7, 1.1), t60[k] * range(r, 0.85, 1.15), 0.0025 + r() * 0.003, r() * TAU));
    // Claquement du battant sur la tôle
    const click = Math.round(sr * 0.004);
    const hp = new Filter('highpass', 2200, 0.8, sr);
    for (let i = 0; i < click && at + i < len; i++) out[at + i] += hp.process(r() * 2 - 1) * g * 0.5 * (1 - i / click);
  }
  return fadeEdges(normalize(out, 0.85), sr, 1);
}

// Cloche d'église : bourdon (hum), fondamentale, tierce mineure, quinte, nominale et partiels aigus.
export function renderChurchBell(sr, r, { nominal = 440, dur = 8 } = {}) {
  const len = secs(sr, dur);
  const out = new Float32Array(len);
  const P = [
    [0.5, 0.6, 15], [1, 0.5, 10], [1.19, 0.65, 8], [1.5, 0.3, 5.5], [2, 1, 5],
    [2.5, 0.35, 3], [2.66, 0.3, 2.6], [3.01, 0.28, 2.2], [4.06, 0.18, 1.5], [5.4, 0.1, 1], [6.1, 0.06, 0.8],
  ];
  for (const [q, a, t] of P) partial(out, sr, 0, nominal * q, a * range(r, 0.85, 1.1), t * range(r, 0.9, 1.1), 0.0012 + r() * 0.002, r() * TAU);
  // Frappe du battant : quelques partiels très aigus et brefs, plus un souffle métallique
  for (const q of [7.3, 8.9, 11.2]) partial(out, sr, 0, nominal * q, 0.12, 0.08, 0.004, r() * TAU);
  const hp = new Filter('bandpass', 3500, 1, sr);
  const click = Math.round(sr * 0.012);
  for (let i = 0; i < click; i++) out[i] += hp.process(r() * 2 - 1) * 0.4 * (1 - i / click);
  // Fin du son : fondu long, la résonance s'éteint au lieu d'être coupée
  const tail = Math.round(sr * 1.5);
  for (let i = 0; i < tail; i++) out[len - tail + i] *= Math.cos((Math.PI / 2) * (i / tail));
  return fadeEdges(normalize(out, 0.85), sr, 2);
}

// =====================================================================
// Bois et eau
// =====================================================================
// Latte de la passerelle sous la roue : « tok » creux (bois sur pilotis).
export function renderWoodTok(sr, r, { f = 200 } = {}) {
  const len = secs(sr, 0.16);
  const out = new Float32Array(len);
  partial(out, sr, 0, f, 1, 0.09, 0.003, 0);
  partial(out, sr, 0, f * 2.57, 0.45, 0.05, 0.004, 1);
  partial(out, sr, 0, f * 4.2, 0.25, 0.03, 0.005, 2);
  partial(out, sr, 0, 115, 0.6, 0.12, 0.002, 0); // caisson creux sous les planches
  const lp = new Filter('lowpass', 2200, 0.7, sr);
  const click = Math.round(sr * 0.005);
  for (let i = 0; i < click; i++) out[i] += lp.process(r() * 2 - 1) * 0.6 * (1 - i / click);
  return fadeEdges(normalize(out, 0.8), sr, 1);
}

// Bulles de Minnaert (modèle de van den Doel) : chaque bulle sonne à sa fréquence, s'amortit et monte
// légèrement en hauteur. Des centaines de bulles font un ruisseau, une gerbe ou un clapotis.
// loop : bulles écrites en boucle (raccord parfait), pour les nappes continues.
export function addBubble(out, sr, at, f, amp, wrap = false) {
  const d = 0.043 * f + 0.0014 * Math.pow(f, 1.5); // amortissement (1/s)
  const n = Math.min(secs(sr, 3.5 / d), sr);
  addDecaySine(out, at, sr, f, amp, d, n, 0.1 * d, wrap);
}

export function renderBubbles(sr, r, { seconds = 4, rate = 200, fmin = 300, fmax = 2500, loop = true, noise = 0, noiseLp = 1200, env = null } = {}) {
  const len = secs(sr, seconds);
  const out = new Float32Array(len);
  const count = Math.round(rate * seconds);
  for (let k = 0; k < count; k++) {
    const at = Math.floor(r() * len);
    const u = at / len;
    const e = env ? env(u) : 1;
    if (e <= 0.001) continue;
    const f = logRange(r, fmin, fmax);
    // Les grosses bulles (graves) sont plus fortes, les petites plus nombreuses.
    const amp = e * Math.pow(fmin / f, 0.5) * range(r, 0.2, 1);
    addBubble(out, sr, at, f, amp, loop);
  }
  if (noise > 0) {
    const nb = pink(len, r);
    const lp = new Filter('lowpass', noiseLp, 0.6, sr);
    const hp = new Filter('highpass', 120, 0.6, sr);
    if (loop) loopFilter(nb, lp, hp);
    else {
      lp.run(nb);
      hp.run(nb);
    }
    const base = rmsOf(out) || 0.05;
    for (let i = 0; i < len; i++) out[i] += nb[i] * noise * base * 6 * (env ? env(i / len) : 1);
  }
  return loop ? normalize(out, 0.8) : fadeEdges(normalize(out, 0.8), sr, 2);
}

function rmsOf(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i += 4) s += buf[i] * buf[i];
  return Math.sqrt(s / (buf.length / 4));
}

// Boucle stéréo de bulles : deux tirages indépendants à gauche et à droite (largeur naturelle).
export function renderWaterLoop(sr, r, opts) {
  return { l: renderBubbles(sr, r, opts), r: renderBubbles(sr, r, opts) };
}

// Clapotis du lac : vaguelettes douces contre les berges et la coque (boucle stéréo).
export function renderLapping(sr, r, { seconds = 8 } = {}) {
  const len = secs(sr, seconds);
  const ch = [new Float32Array(len), new Float32Array(len)];
  for (const out of ch) {
    let t = r() * 0.8;
    while (t < seconds) {
      const at = Math.floor(t * sr);
      const dur = range(r, 0.25, 0.55);
      const n = secs(sr, dur);
      const lp = new Filter('lowpass', range(r, 450, 900), 0.9, sr);
      const amp = range(r, 0.3, 1);
      for (let i = 0; i < n; i++) {
        const u = i / n;
        out[(at + i) % len] += lp.process(r() * 2 - 1) * amp * (u < 0.15 ? u / 0.15 : Math.exp(-(u - 0.15) * 5));
      }
      const nb = irange(r, 2, 8);
      for (let k = 0; k < nb; k++) addBubble(out, sr, at + Math.floor(r() * n * 0.7), logRange(r, 350, 1400), amp * range(r, 0.05, 0.25), true);
      t += range(r, 0.6, 2.4);
    }
  }
  return normalizeStereo(ch[0], ch[1], 0.8);
}

// Éclaboussure de l'aviron à l'attaque : gerbe bruitée, « plouf » grave et pluie de petites bulles.
export function renderSplash(sr, r, { size = 1 } = {}) {
  const len = secs(sr, 0.45);
  const out = new Float32Array(len);
  const bp = new Filter('bandpass', range(r, 1000, 1500) / Math.sqrt(size), 0.7, sr);
  const hp = new Filter('highpass', 350, 0.7, sr);
  const tau = 0.04 * size;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    out[i] = hp.process(bp.process(r() * 2 - 1)) * Math.min(1, t / 0.003) * Math.exp(-t / tau) * 2.2;
  }
  addBubble(out, sr, Math.round(sr * 0.004), range(r, 280, 420) / Math.sqrt(size), 0.9);
  const nb = irange(r, 10, 20);
  for (let k = 0; k < nb; k++) addBubble(out, sr, Math.floor(r() * sr * 0.18), logRange(r, 900, 3200), range(r, 0.05, 0.25));
  return fadeEdges(normalize(out, 0.85), sr, 2);
}

// Glouglou de la pale pendant la propulsion : bulles et eau poussée.
export function renderGurgle(sr, r, { dur = 0.8 } = {}) {
  return renderBubbles(sr, r, { seconds: dur, rate: 140, fmin: 280, fmax: 1500, loop: false, noise: 0.5, noiseLp: 700, env: (u) => Math.sin(Math.PI * Math.min(1, u * 1.2)) ** 1.5 });
}

// Dégagé de la pale : petite gerbe puis gouttes qui retombent.
export function renderDrips(sr, r) {
  const len = secs(sr, 0.6);
  const out = new Float32Array(len);
  mixInto(out, renderSplash(sr, r, { size: 0.5 }), 0, 0.5);
  const n = irange(r, 3, 7);
  for (let k = 0; k < n; k++) addBubble(out, sr, Math.floor(range(r, 0.06, 0.45) * sr), logRange(r, 1100, 3200), range(r, 0.15, 0.45));
  return fadeEdges(normalize(out, 0.8), sr, 2);
}

// Coup de pagaie (kayak) : attaque sourde « toump », traction gargouillante, sortie avec gouttes.
export function renderPaddle(sr, r, { strength = 1 } = {}) {
  const len = secs(sr, 0.9);
  const out = new Float32Array(len);
  const lp = new Filter('lowpass', 1300, 0.8, sr);
  for (let i = 0; i < sr * 0.12; i++) {
    const t = i / sr;
    out[i] += lp.process(r() * 2 - 1) * Math.min(1, t / 0.004) * Math.exp(-t / 0.035) * 1.6 * strength;
  }
  addBubble(out, sr, Math.round(sr * 0.003), range(r, 210, 320), 0.9 * strength);
  mixInto(out, renderGurgle(sr, r, { dur: 0.35 + 0.1 * strength }), Math.round(sr * 0.05), 0.55 * strength);
  mixInto(out, renderDrips(sr, r), Math.round(sr * 0.38), 0.4);
  return fadeEdges(normalize(out, 0.85), sr, 2);
}

// Siège coulissant du rameur : roulettes sur le rail, petite accélération puis freinage.
export function renderSeatSlide(sr, r, { dur = 0.9 } = {}) {
  const len = secs(sr, dur);
  const out = new Float32Array(len);
  const bp = new Filter('bandpass', range(r, 320, 420), 2, sr);
  const bp2 = new Filter('bandpass', 1400, 3, sr);
  const rate = range(r, 60, 85);
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const t = i / sr;
    const speed = Math.sin(Math.PI * u);
    const rough = 0.6 + 0.4 * Math.sin(TAU * rate * speed * t);
    const x = r() * 2 - 1;
    out[i] = (bp.process(x) + 0.25 * bp2.process(x)) * rough * speed;
  }
  return fadeEdges(normalize(out, 0.7), sr, 4);
}

// Dame de nage (pivot de l'aviron) : « clac » bref plastique et métal.
export function renderOarlock(sr, r) {
  const len = secs(sr, 0.12);
  const out = new Float32Array(len);
  partial(out, sr, 0, range(r, 1000, 1250), 1, 0.035, 0.004, 0);
  partial(out, sr, 0, range(r, 2500, 2900), 0.6, 0.025, 0.005, 1);
  const hp = new Filter('highpass', 1500, 0.7, sr);
  for (let i = 0; i < sr * 0.003; i++) out[i] += hp.process(r() * 2 - 1) * 0.6;
  return fadeEdges(normalize(out, 0.8), sr, 1);
}

// =====================================================================
// Textures en boucle (raccord sans couture)
// =====================================================================
// Gravier et herbe sous les pneus : grains de craquements, joués plus ou moins vite selon la vitesse.
export function renderCrunch(sr, r, { seconds = 2 } = {}) {
  const len = secs(sr, seconds);
  const out = new Float32Array(len);
  const count = Math.round(260 * seconds);
  for (let k = 0; k < count; k++) {
    const at = Math.floor(r() * len);
    const n = Math.round(sr * range(r, 0.0008, 0.004));
    const amp = Math.pow(r(), 2.2);
    for (let i = 0; i < n; i++) out[(at + i) % len] += (r() * 2 - 1) * amp * (1 - i / n);
  }
  const bp = new Filter('bandpass', 2600, 0.6, sr);
  const lo = new Filter('peaking', 700, 1, sr, 5);
  loopFilter(out, bp, lo);
  const bed = pink(len, r);
  loopFilter(bed, new Filter('highpass', 3000, 0.7, sr));
  for (let i = 0; i < len; i++) out[i] += bed[i] * 0.35;
  return normalize(out, 0.8);
}

// Insectes d'été (stéréo) : criquets qui stridulent par phrases, quelques grillons.
// kind 'cicada' : cigales des pins de bord de mer, nappe grésillante qui enfle et retombe.
export function renderInsects(sr, r, { seconds = 8, kind = 'meadow' } = {}) {
  const len = secs(sr, seconds);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  if (kind === 'cicada') {
    const n = 4;
    for (let k = 0; k < n; k++) {
      const pulse = range(r, 170, 260);
      const res = new Filter('bandpass', range(r, 4800, 6200), 7, sr);
      const [gl, gr] = panGains(range(r, -0.9, 0.9));
      const amp = range(r, 0.4, 1);
      // Profil de chant : montée, palier pulsé, descente, silence (en boucle).
      const on = range(r, 0.45, 0.8);
      const offset = r();
      const wob = range(r, 2, 4);
      let ph = 0;
      let g = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < len; i++) {
          ph += pulse / sr;
          let x = 0;
          if (ph >= 1) {
            ph -= 1;
            x = 1;
          }
          const y = res.process(x + (r() * 2 - 1) * 0.08);
          if (pass === 0) continue;
          if ((i & 63) === 0) {
            const u = ((i / len + offset) % 1) / on;
            g = (u > 1 ? 0 : Math.sin(Math.PI * u) ** 0.6) * amp * (0.7 + 0.3 * Math.sin(TAU * wob * (i / sr)));
          }
          const v = y * g;
          L[i] += v * gl;
          R[i] += v * gr;
        }
      }
    }
    return normalizeStereo(L, R, 0.7);
  }
  // Deux textures de stridulation (bruit filtré) partagées par les individus.
  const tex = [6500, 8600].map((f) => loopFilter(white(len, r), new Filter('bandpass', f, 2.2, sr)));
  const n = 6;
  for (let k = 0; k < n; k++) {
    const src = tex[k % 2];
    const rate = range(r, 11, 22); // syllabes par seconde
    const [gl, gr] = panGains(range(r, -1, 1));
    const amp = range(r, 0.3, 1);
    const phrase = range(r, 1.2, 3.5) / seconds;
    const gap = range(r, 0.8, 2.5) / seconds;
    const offset = r();
    const period = phrase + gap;
    let g = 0;
    for (let i = 0; i < len; i++) {
      if ((i & 15) === 0) {
        const u = (i / len + offset) % period;
        const syl = 0.5 + 0.5 * Math.sin(TAU * rate * (i / sr));
        g = u > phrase ? 0 : amp * syl * syl * Math.sin((Math.PI * u) / phrase) ** 0.5;
      }
      if (g === 0) continue;
      const v = src[i] * g;
      L[i] += v * gl;
      R[i] += v * gr;
    }
  }
  // Grillons : trois ou quatre impulsions tonales par chant
  for (let k = 0; k < 2; k++) {
    const f = range(r, 4500, 5000);
    const [gl, gr] = panGains(range(r, -0.8, 0.8));
    const every = range(r, 0.45, 0.7);
    const pulses = irange(r, 3, 4);
    const amp = range(r, 0.15, 0.3);
    for (let t = r() * every; t < seconds; t += every * range(r, 0.95, 1.05)) {
      for (let p = 0; p < pulses; p++) {
        const at = Math.floor((t + p * 0.03) * sr);
        const pn = Math.round(sr * 0.016);
        for (let i = 0; i < pn; i++) {
          const v = Math.sin((TAU * f * i) / sr) * Math.sin((Math.PI * i) / pn) * amp;
          L[(at + i) % len] += v * gl;
          R[(at + i) % len] += v * gr;
        }
      }
    }
  }
  return normalizeStereo(L, R, 0.7);
}

// =====================================================================
// Foule (spectateurs) : voix à formants désaccordées, « allez ! » scandés, sifflets, applaudissements.
// Calcul lourd : découpé en tranches (yieldFn) pour ne jamais bloquer une image.
// =====================================================================
const VOWELS = {
  a: [[750, 1250, 2600], [1, 0.55, 0.25]],
  e: [[400, 2100, 2750], [1, 0.45, 0.25]], // é
  è: [[600, 1800, 2600], [1, 0.5, 0.25]],
  o: [[500, 900, 2500], [1, 0.5, 0.2]],
  ou: [[320, 800, 2400], [1, 0.4, 0.15]],
};

function crowdVoice(sr, r, at, { f0, dur, vowels, pan, amp, chant = false }, L, R) {
  const len = secs(sr, dur);
  const osc = new Osc(sr, r());
  const fs = [0, 1, 2].map(() => new Filter('bandpass', 800, 5, sr));
  const tilt = new OnePole(3000, sr);
  const [gl, gr] = panGains(pan);
  const n = L.length;
  let jit = 0;
  for (let i = 0; i < len; i++) {
    const u = i / len;
    if ((i & 63) === 0) {
      // Interpolation entre les voyelles successives (« ou-ais », « a-llez »)
      const x = u * (vowels.length - 1);
      const k = Math.min(vowels.length - 2, Math.floor(x));
      const a = VOWELS[vowels[Math.max(0, k)]];
      const b = VOWELS[vowels[Math.min(vowels.length - 1, k + 1)]];
      const w = vowels.length > 1 ? smoothstep(0.3, 0.7, x - k) : 0;
      for (let j = 0; j < 3; j++) fs[j].set(a[0][j] + (b[0][j] - a[0][j]) * w, 4 + j * 2);
      fs.gain = a[1];
      if ((i & 1023) === 0) jit = (r() * 2 - 1) * 0.02;
    }
    // Hauteur : montée puis retombée (cri) ; « al-lez » : la deuxième syllabe monte.
    const contourK = chant ? (u < 0.45 ? 1 : 1.18) : 1 + 0.25 * Math.sin(Math.PI * u);
    const src = tilt.process(osc.saw(f0 * contourK * (1 + jit)) * 0.8 + (r() * 2 - 1) * 0.35);
    let y = 0;
    for (let j = 0; j < 3; j++) y += fs[j].process(src) * fs.gain[j];
    let e = arEnv(u, 0.12, 0.25);
    if (chant) e *= 1 - 0.75 * Math.exp(-(((u - 0.45) / 0.06) ** 2)); // le « l » entre les syllabes
    const v = y * e * amp;
    const j = (at + i) % n;
    L[j] += v * gl;
    R[j] += v * gr;
  }
}

// Pause entre deux tranches de calcul : laisse passer au moins une image du jeu.
const yieldSlice = () => new Promise((res) => setTimeout(res, 12));

// excited : foule qui encourage (cris, « allez ! », sifflets) ; sinon brouhaha calme (tribune, plage).
export async function renderCrowd(sr, r, { seconds = 6, excited = true, voices = 40, yieldFn = yieldSlice } = {}) {
  const len = secs(sr, seconds);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  let budget = performance.now();
  const breathe = async () => {
    if (yieldFn && performance.now() - budget > 4) {
      await yieldFn();
      budget = performance.now();
    }
  };
  const pickF0 = () => pick(r, [[95, 150], [95, 150], [170, 260], [170, 260], [250, 330]]);
  for (let k = 0; k < voices; k++) {
    const [a, b] = pickF0();
    const f0 = range(r, a, b) * (excited ? 1.25 : 1);
    const vowels = excited ? pick(r, [['ou', 'è'], ['a'], ['è'], ['a', 'e'], ['o', 'è'], ['è', 'a']]) : Array.from({ length: irange(r, 3, 6) }, () => pick(r, Object.keys(VOWELS)));
    const dur = excited ? range(r, 0.35, 1.3) : range(r, 0.4, 1.1);
    const dist = r();
    crowdVoice(sr, r, Math.floor(r() * len), { f0, dur, vowels, pan: range(r, -1, 1), amp: (excited ? 0.9 : 0.4) * (0.25 + 0.75 * (1 - dist)) }, L, R);
    await breathe();
  }
  if (excited) {
    // (les « allez ! » scandés sont des événements à part, voir renderChant : ils ne reviennent pas en boucle)
    // Sifflets (doigts dans la bouche) : glissando montant
    const nw = irange(r, 2, 4);
    for (let k = 0; k < nw; k++) {
      const at = Math.floor(r() * len);
      const dur = range(r, 0.35, 0.8);
      const n = secs(sr, dur);
      const f0 = range(r, 2100, 2800);
      const [gl, gr] = panGains(range(r, -0.9, 0.9));
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const u = i / n;
        ph += (f0 * (1 + 0.35 * smoothstep(0, 0.4, u) - 0.1 * smoothstep(0.7, 1, u))) / sr;
        const v = (Math.sin(TAU * ph) + (r() * 2 - 1) * 0.1) * arEnv(u, 0.1, 0.2) * 0.35;
        L[(at + i) % len] += v * gl;
        R[(at + i) % len] += v * gr;
      }
    }
  }
  return normalizeStereo(dcBlock(L, sr), dcBlock(R, sr), 0.8);
}

// « Al-lez ! Al-lez ! Al-lez ! » scandé par un groupe (petits décalages entre les voix), joué de temps en temps
// par les spectateurs les plus excités, jamais au même rythme.
export function renderChant(sr, r, { voices = 8 } = {}) {
  const reps = irange(r, 2, 4);
  const beat = range(r, 0.56, 0.68);
  const len = secs(sr, reps * beat + 0.6);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const pickF0 = () => pick(r, [[95, 150], [95, 150], [170, 260], [170, 260], [250, 330]]);
  for (let v = 0; v < voices; v++) {
    const [a, b] = pickF0();
    const f0 = range(r, a, b) * 1.2;
    const pan = range(r, -0.7, 0.7);
    for (let s = 0; s < reps; s++) {
      crowdVoice(sr, r, Math.floor((0.02 + s * beat + r() * 0.03) * sr), { f0: f0 * range(r, 0.98, 1.02), dur: beat * 0.78, vowels: ['a', 'e'], pan, amp: 0.55, chant: true }, L, R);
    }
  }
  // Pas de raccord en boucle ici : fondu sur les bords
  normalizeStereo(dcBlock(L, sr), dcBlock(R, sr), 0.8);
  return { l: fadeEdges(L, sr, 10), r: fadeEdges(R, sr, 10) };
}

// Applaudissements (stéréo, boucle) : chaque spectateur frappe à son rythme, son timbre et sa place.
export async function renderApplause(sr, r, { seconds = 6, clappers = 36, yieldFn = yieldSlice } = {}) {
  const len = secs(sr, seconds);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  let budget = performance.now();
  for (let k = 0; k < clappers; k++) {
    const period = range(r, 0.2, 0.34);
    const bp = new Filter('bandpass', range(r, 800, 2600), range(r, 1, 2), sr);
    const [gl, gr] = panGains(range(r, -1, 1));
    const amp = range(r, 0.3, 1);
    for (let t = r() * period; t < seconds; t += period * range(r, 0.9, 1.1)) {
      const at = Math.floor(t * sr);
      const n = Math.round(sr * range(r, 0.015, 0.03));
      for (let i = 0; i < n; i++) {
        const e = Math.min(1, i / (sr * 0.0008)) * Math.exp(-i / (sr * 0.006));
        const v = bp.process(r() * 2 - 1) * e * amp;
        L[(at + i) % len] += v * gl;
        R[(at + i) % len] += v * gr;
      }
    }
    if (yieldFn && performance.now() - budget > 4) {
      await yieldFn();
      budget = performance.now();
    }
  }
  return normalizeStereo(L, R, 0.8);
}

