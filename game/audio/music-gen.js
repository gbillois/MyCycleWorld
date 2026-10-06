// Musique : plan d'un morceau (module pur, testé dans tests/audio.test.js). Lit une partition de
// music-songs.js (accords, mélodie, rythmes) et la découpe en cellules d'une ou plusieurs mesures par couche
// (nappe, claviers, basse, groove, batterie, mélodie). Chaque cellule distincte est rendue une seule fois hors
// ligne (music-render.js), puis le lecteur (music.js) les enchaîne sur l'horloge audio, mesure après mesure,
// en dosant les couches selon l'intensité de la course. Les cellules qui se répètent (même accord, même
// rythme) ne sont calculées et gardées qu'une fois : peu de mémoire pour un morceau long et varié.
import { rng, hashSeed } from './random.js';
import { SONGS } from './music-songs.js';

export const MUSIC_SR = 32000;
export const MOODS = SONGS;

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

export const LAYERS = ['pad', 'keys', 'bass', 'groove', 'drums', 'lead'];

// Couches selon l'intensité (0..3) : seuil d'entrée de chaque couche, fondu sur LAYER_FADE d'intensité.
// Compte à rebours (0,6) : nappe et claviers ; effort léger : + basse et groove ; effort normal : + mélodie
// (refrains) ; effort soutenu, dernier tour, turbo : + batterie complète.
export const LAYER_THRESHOLDS = { pad: -1, keys: 0.25, bass: 0.7, groove: 1.15, lead: 1.45, drums: 2.0 };
export const LAYER_FADE = 0.45;
// Au-delà de cette intensité, le pont sans batterie (section C) est sauté.
export const SKIP_BRIDGE = 2.3;

export function layerLevel(intensity, layer, th = LAYER_THRESHOLDS) {
  const t = th[layer] ?? 0;
  const u = Math.max(0, Math.min(1, (intensity - t) / LAYER_FADE));
  return u * u * (3 - 2 * u);
}

// Gain de chaque couche pour une intensité : niveau d'entrée, et la nappe se retire un peu quand tout joue.
export function layerGains(song, intensity) {
  const g = {};
  for (const l of LAYERS) g[l] = layerLevel(intensity, l, song.th);
  g.pad *= 1 - 0.18 * Math.max(0, Math.min(1, (intensity - 2.1) / 0.6));
  return g;
}

// --- Accords ---
const NUMS = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };
const MAJOR = SCALES.major;

// Accord en degré romain -> { root, tones (demi-tons au-dessus de la tonique, fondamentale d'abord), bass }.
export function parseChord(sym) {
  const [main, slash] = sym.split('/');
  const m = /^([b#]?)(vii|vi|v|iv|iii|ii|i|VII|VI|V|IV|III|II|I)(.*)$/.exec(main);
  if (!m) throw new Error(`accord inconnu : ${sym}`);
  const acc = m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0;
  const minor = m[2] === m[2].toLowerCase();
  const root = (MAJOR[NUMS[m[2].toLowerCase()]] + acc + 12) % 12;
  const q = m[3];
  let iv = minor ? [0, 3, 7] : [0, 4, 7];
  if (q.includes('o')) iv = [0, 3, 6];
  if (q.includes('sus2')) iv = [0, 2, 7];
  if (q.includes('sus4')) iv = [0, 5, 7];
  const add9 = q.includes('add9');
  const nine = /9/.test(q) && !add9;
  const seventh = /7/.test(q) || nine;
  if (q.includes('6')) iv.push(9);
  if (seventh) iv.push(q.includes('maj') ? 11 : 10);
  if (nine || add9) iv.push(14);
  let bass = 0;
  if (slash === '3') bass = iv[1];
  else if (slash === '5') bass = iv[2];
  else if (slash === '7') bass = iv[3] ?? 10;
  return { sym, root, tones: iv.map((x) => root + x), bass: (root + bass) % 12, third: iv[1] };
}

// Voicing d'un accord dans une tessiture : notes proches de l'accord précédent (conduite des voix), pas de
// grappe dans le grave. pcs : demi-tons au-dessus de la tonique (fondamentale d'abord), key : tonique MIDI.
export function voiceChord(pcs, key, { voices = 4, range = [55, 76], rootless = false } = {}, prev = null) {
  const [lo, hi] = range;
  const uniq = [...new Set(pcs.map((p) => ((p % 12) + 12) % 12))];
  // Priorité : tierce, septième, neuvième ou sixte, fondamentale, quinte
  const root = uniq[0];
  const order = [uniq[1], uniq[3], uniq[4], rootless && uniq.length >= 4 ? null : root, uniq[2], ...uniq.slice(5)].filter((x) => x !== undefined && x !== null);
  const core = order.slice(0, voices);
  // Plus de voix que de notes : on essaie chaque doublure (fondamentale, quinte, tierce ; jamais la
  // fondamentale dans un voicing sans fondamentale)
  const dbl = [rootless && uniq.length >= 4 ? null : root, uniq[2], uniq[1]].filter((x) => x !== undefined && x !== null);
  let choices = [core];
  while (choices[0].length < voices) choices = choices.flatMap((c) => dbl.map((d) => [...c, d]));
  const center = (lo + hi) / 2;
  const maxSpan = voices >= 5 ? 24 : 19;
  let best = null;
  let bestScore = Infinity;
  const cur = [];
  for (const sel of choices) {
    const opts = sel.map((pc) => {
      const out = [];
      for (let mm = lo + ((((key + pc - lo) % 12) + 12) % 12); mm <= hi; mm += 12) out.push(mm);
      return out;
    });
    const walk = (k) => {
      if (k === opts.length) {
        const s = [...cur].sort((a, b) => a - b);
        for (let i = 1; i < s.length; i++) if (s[i] === s[i - 1]) return;
        if (s[s.length - 1] - s[0] > maxSpan) return;
        if (s[0] < 60 && s[1] - s[0] < 3) return;
        const mean = s.reduce((a, b) => a + b, 0) / s.length;
        let score = Math.abs(mean - center) * (prev ? 0.35 : 1);
        // Voix serrées : un trou de plus d'une quinte entre deux voisines sonne creux
        for (let i = 1; i < s.length; i++) score += Math.max(0, s[i] - s[i - 1] - 7) * 0.8;
        if (prev && prev.length === s.length) for (let i = 0; i < s.length; i++) score += Math.abs(s[i] - prev[i]);
        if (score < bestScore - 1e-9) {
          bestScore = score;
          best = s;
        }
        return;
      }
      for (const mm of opts[k]) {
        cur.push(mm);
        walk(k + 1);
        cur.pop();
      }
    };
    walk(0);
  }
  const sel = choices[0];
  return best || sel.map((pc) => lo + ((((key + pc - lo) % 12) + 12) % 12)).sort((a, b) => a - b);
}

// --- Notation ---
const DEG = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, A: 9, B: 10, C: 11, D: 12, a: -7, b: -6, c: -5, d: -4, e: -3, f: -2, g: -1 };
const VEL = { x: 1, X: 1.2, o: 0.62, g: 0.33 };
const velOf = (c) => VEL[c] ?? (c >= '1' && c <= '9' ? Number(c) / 9 : 0);

// Jetons d'un motif : [{ s: pas de départ, len: durée en pas, ch }] ('-' prolonge, '.' coupe).
export function tokens(str) {
  const out = [];
  let last = null;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '-') {
      if (last) last.len++;
      continue;
    }
    if (c === '.' || c === ' ') {
      last = null;
      continue;
    }
    last = { s: i, len: 1, ch: c };
    out.push(last);
  }
  return out;
}

// Note de la gamme d'un degré (0 = tonique, négatif = en dessous) à partir de la tonique base.
export function scaleNote(scale, base, degree) {
  const n = scale.length;
  const k = ((degree % n) + n) % n;
  return base + scale[k] + 12 * Math.floor(degree / n);
}

// Instruments de la batterie : nature du coup, réglage, niveau et position dans l'image stéréo.
export const DRUM_ROWS = {
  kick: { kind: 'kick', g: 1, pan: 0 },
  snare: { kind: 'snare', g: 0.62, pan: 0.04 },
  rim: { kind: 'rimshot', g: 0.55, pan: 0.04 },
  clap: { kind: 'clap', g: 0.5, pan: -0.04 },
  snap: { kind: 'snap', g: 0.35, pan: 0.12 },
  hat: { kind: 'hat', g: 0.26, pan: 0.3 },
  ohat: { kind: 'openhat', g: 0.13, pan: 0.32 },
  shaker: { kind: 'shaker', g: 0.24, pan: -0.35 },
  tamb: { kind: 'tamb', g: 0.16, pan: -0.25 },
  tomH: { kind: 'tom', f: 196, g: 0.55, pan: 0.3 },
  tomM: { kind: 'tom', f: 147, g: 0.6, pan: 0 },
  tomL: { kind: 'tom', f: 104, g: 0.65, pan: -0.3 },
  taiko: { kind: 'taiko', f: 72, g: 0.8, pan: 0 },
  conga: { kind: 'conga', f: 245, g: 0.35, pan: 0.35 },
  congaL: { kind: 'conga', f: 185, g: 0.35, pan: 0.25 },
  bongo: { kind: 'bongo', f: 390, g: 0.3, pan: -0.3 },
  block: { kind: 'block', f: 820, g: 0.22, pan: -0.4 },
  brush: { kind: 'brush', g: 0.3, pan: 0.1 },
  crash: { kind: 'crash', g: 0.22, pan: -0.25 },
  riser: { kind: 'riser', g: 0.18, pan: 0 },
};

// Humanisation (gaussienne approchée) : quelques millisecondes de jeu, nuances qui respirent.
const gauss = (r) => (r() + r() + r() - 1.5) * 1.15;
const TIMING = { kick: 0.008, snare: 0.018, rim: 0.018, clap: 0.02, hat: 0.035, ohat: 0.03, shaker: 0.04, tamb: 0.035 };

// =====================================================================
// Plan d'un morceau
// =====================================================================
export function makeSong(moodName = 'meadow') {
  const mood = SONGS[moodName] ? moodName : 'meadow';
  const def = SONGS[mood];
  const scale = SCALES[def.mode];
  const key = def.key;
  const barLen = Math.round((MUSIC_SR * 240) / def.bpm);
  const song = {
    mood,
    bpm: (MUSIC_SR * 240) / barLen,
    sr: MUSIC_SR,
    barLen,
    barSec: barLen / MUSIC_SR,
    stepSec: barLen / MUSIC_SR / 16,
    key,
    mode: def.mode,
    scale,
    form: def.form,
    loopTo: 1,
    th: { ...LAYER_THRESHOLDS, ...(def.th || {}) },
    mix: { ...(def.mix || {}) },
    fx: def.fx,
    inst: def.inst,
    sections: {},
    cells: {},
  };
  const chords = new Map();
  const chord = (sym) => {
    if (!chords.has(sym)) chords.set(sym, parseChord(sym));
    return chords.get(sym);
  };
  // Voicings : un par accord et par instrument, conduits dans l'ordre où les accords arrivent.
  const order = [];
  for (const name of def.form) order.push(...def.prog[def.sections[name].prog]);
  const voicings = new Map();
  const voicingFor = (instName) => {
    if (voicings.has(instName)) return voicings.get(instName);
    const params = def.inst[instName];
    const map = new Map();
    let prev = null;
    for (const sym of order) {
      if (!map.has(sym)) map.set(sym, voiceChord(chord(sym).tones, key, params, prev));
      prev = map.get(sym);
    }
    voicings.set(instName, map);
    return map;
  };
  const voiced = (instName, sym) => voicingFor(instName).get(sym);

  // Cellules : une par contenu distinct (dédoublonnées), humanisées avec une graine tirée de leur contenu.
  const keyIndex = new Map();
  let count = 0;
  const addCell = (layer, bars, events, extra = {}) => {
    if (!events.length) return null;
    const k = `${layer}|${bars}|${JSON.stringify(events)}`;
    if (keyIndex.has(k)) return keyIndex.get(k);
    const id = `${layer}${count++}`;
    const r = rng(hashSeed(`${mood}|${k}`));
    const swing = (t) => {
      const s = Math.round(t);
      if (Math.abs(t - s) > 1e-6) return t;
      return t + (s % 2 ? def.swing16 || 0 : 0) + (s % 4 === 2 ? def.swing8 || 0 : 0);
    };
    const human = events.map((e) => {
      const sigma = layer === 'drums' || layer === 'groove' ? TIMING[e.row] ?? 0.025 : layer === 'lead' ? 0.02 : layer === 'pad' ? 0 : 0.03;
      const t = Math.max(0, swing(e.t) + (e.t > 0 ? gauss(r) * sigma : Math.abs(gauss(r)) * sigma * 0.3) + (layer === 'lead' ? 0.02 : 0));
      const v = (e.v ?? 1) * (layer === 'pad' ? 1 : 1 + gauss(r) * 0.055);
      return { ...e, t, v };
    });
    const cell = { id, layer, bars, events: human, ...extra };
    if (layer === 'groove' || layer === 'drums') cell.kicks = human.filter((e) => e.row === 'kick').map((e) => e.t);
    song.cells[id] = cell;
    keyIndex.set(k, id);
    return id;
  };

  const firstChordAfter = (formIdx) => {
    const n = formIdx + 1 < def.form.length ? formIdx + 1 : song.loopTo;
    return def.prog[def.sections[def.form[n]].prog][0];
  };
  const place = (pc, lo) => lo + ((((key + pc - lo) % 12) + 12) % 12);
  const neighbor = (m, dir) => {
    for (let k = 1; k <= 3; k++) {
      const c = m + dir * k;
      if (scale.includes((((c - key) % 12) + 12) % 12)) return c;
    }
    return m + dir;
  };

  // --- Couches d'une mesure ---
  const bassBar = (pat, sym, nextSym) => {
    const p = def.inst.bass;
    const lo = p.lo ?? 36;
    const ch = chord(sym);
    const bm = place(ch.bass, lo);
    const rm = place(ch.root, lo) > bm ? place(ch.root, lo) - 12 : place(ch.root, lo);
    const nm = place(chord(nextSym).bass, lo);
    // Note d'approche : un degré de la gamme à côté de la basse suivante, du côté d'où l'on vient
    let app = neighbor(nm, nm > bm ? -1 : 1);
    if (app === bm || nm === bm) app = neighbor(nm, nm > bm ? 1 : -1);
    return tokens(pat).map((t) => {
      let m = bm;
      if (t.ch === 'O') m = bm + 12;
      else if (t.ch === 'F') m = rm + 7;
      else if (t.ch === 'f') m = rm - 5 >= lo - 5 ? rm - 5 : rm + 7;
      else if (t.ch === 'T') m = rm + ch.third;
      else if (t.ch === 'A') m = app;
      const accent = t.s === 0 ? 1 : t.s % 4 === 0 ? 0.9 : 0.78;
      return { t: t.s, n: Math.max(0.5, t.len - 0.25), m, v: accent };
    });
  };

  const keysBar = (parts, sym) => {
    const ev = [];
    for (const part of parts) {
      const v = voiced(part.inst, sym);
      const n = v.length;
      const type = def.inst[part.inst].type;
      for (const t of tokens(part.p)) {
        const accent = t.s % 4 === 0 ? 1 : t.s % 2 === 0 ? 0.85 : 0.72;
        const dur = t.len - 0.1;
        const push = (m, dt, vel, idx) => ev.push({ inst: part.inst, t: t.s + dt, n: Math.max(0.4, dur - dt), m, v: vel, pan: type === 'ep' ? 0 : -0.4 + (0.8 * idx) / Math.max(1, n - 1) });
        if (t.ch === 'C') v.forEach((m, i) => push(m, 0, accent * 0.8, i));
        else if (t.ch === 'D') v.forEach((m, i) => push(m, i * 0.09, accent * 0.85, i));
        else if (t.ch === 'U') v.slice(-3).reverse().forEach((m, i) => push(m, i * 0.07, accent * 0.6, n - 1 - i));
        else if (DEG[t.ch] !== undefined && t.ch >= '1' && t.ch <= '9') {
          const k = Number(t.ch) - 1;
          push(v[k % n] + 12 * Math.floor(k / n), 0, accent * 0.85, k % n);
        }
      }
    }
    return ev;
  };

  const drumBar = (pat, extra = null) => {
    const ev = [];
    const rows = { ...pat, ...(extra || {}) };
    for (const [row, str] of Object.entries(rows)) {
      if (!DRUM_ROWS[row]) throw new Error(`instrument de batterie inconnu : ${row}`);
      for (let s = 0; s < str.length; s++) {
        const v = velOf(str[s]);
        if (v > 0) ev.push({ t: s, row, v });
      }
    }
    return ev.sort((a, b) => a.t - b.t || (a.row < b.row ? -1 : 1));
  };

  def.form.forEach((name, formIdx) => {
    if (song.sections[name]) return;
    const S = def.sections[name];
    const prog = def.prog[S.prog];
    const nb = prog.length;
    const layers = Object.fromEntries(LAYERS.map((l) => [l, new Array(nb).fill(null)]));
    // Nappe : un accord tenu tant qu'il ne change pas (jusqu'à 4 mesures)
    for (let b = 0; b < nb; ) {
      let L = 1;
      while (b + L < nb && prog[b + L] === prog[b] && L < 4) L++;
      layers.pad[b] = addCell('pad', L, [{ t: 0, n: L * 16, notes: voiced('pad', prog[b]), v: 1 }]);
      b += L;
    }
    for (let b = 0; b < nb; b++) {
      const sym = prog[b];
      const nextSym = b + 1 < nb ? prog[b + 1] : firstChordAfter(formIdx);
      if (S.keys && def.keys[S.keys]) layers.keys[b] = addCell('keys', 1, keysBar(def.keys[S.keys], sym));
      if (S.bass && def.bass[S.bass]) layers.bass[b] = addCell('bass', 1, bassBar(def.bass[S.bass], sym, nextSym));
      if (S.groove && def.groove[S.groove] && b >= (S.grooveFrom ?? 0)) layers.groove[b] = addCell('groove', 1, drumBar(def.groove[S.groove]));
      let dp = S.drums ? def.drums[S.drums] : null;
      let extra = null;
      if (S.crash && b === 0 && dp) extra = { crash: 'x...............' };
      if (S.fill && b === nb - 1 && def.drums.fill) dp = def.drums.fill;
      if (S.build) dp = b === nb - 1 ? def.drums.build : null;
      if (dp) layers.drums[b] = addCell('drums', 1, drumBar(dp, extra));
    }
    // Mélodie : notes enchaînées sur toute la section, découpée en cellules aux barres de mesure libres
    if (S.lead && def.lead[S.lead]) {
      const p = def.inst.lead;
      const bars = def.lead[S.lead];
      const notes = tokens(bars.join('')).map((t, i, all) => {
        const next = all[i + 1];
        const joined = next && next.s === t.s + t.len;
        const legato = joined && t.len === 1;
        return { t: t.s, n: legato ? t.len : Math.max(0.6, t.len - (joined ? 0.12 : 0.05)), m: scaleNote(scale, p.base, DEG[t.ch]), v: t.s % 16 === 0 ? 0.95 : t.s % 4 === 0 ? 0.85 : 0.78, deg: DEG[t.ch], len: t.len };
      });
      // Second refrain : une seconde voix sous la mélodie (note de l'accord la plus proche, entre une tierce
      // mineure et une sixte plus bas ; tierce de la gamme sur les notes de passage), plus douce.
      if (S.harmony) {
        for (const n of [...notes]) {
          const tones = new Set(chord(prog[Math.min(nb - 1, Math.floor(n.t / 16))]).tones.map((x) => (x + key) % 12));
          let h = null;
          if (n.len > 1) for (let d = 3; d <= 9 && h === null; d++) if (tones.has((((n.m - d) % 12) + 12) % 12) && scale.includes((((n.m - d - key) % 12) + 12) % 12)) h = n.m - d;
          if (h === null) h = scaleNote(scale, p.base, n.deg - 2);
          notes.push({ ...n, m: h, v: n.v * 0.55, voice: 1 });
        }
        notes.sort((a, b) => a.t - b.t || (a.voice ?? 0) - (b.voice ?? 0));
      }
      for (const n of notes) {
        delete n.deg;
        delete n.len;
      }
      let b = 0;
      while (b < nb) {
        let e = b + 1;
        // une note qui déborde sur la mesure suivante soude les deux mesures dans la même cellule
        for (;;) {
          const end = e * 16;
          const crossing = notes.some((n) => n.t < end && n.t + n.n > end + 0.01);
          if (!crossing || e >= nb) break;
          e++;
        }
        const ev = notes.filter((n) => n.t >= b * 16 && n.t < e * 16).map((n) => ({ ...n, t: n.t - b * 16 }));
        layers.lead[b] = addCell('lead', e - b, ev);
        b = e;
      }
    }
    song.sections[name] = { name, bars: nb, prog, layers };
  });
  return song;
}

// Section suivante dans la forme (le pont est sauté quand l'effort est fort).
export function nextSection(song, idx, intensity = 1) {
  let n = idx + 1 >= song.form.length ? song.loopTo : idx + 1;
  if (song.form[n] === 'C' && intensity > SKIP_BRIDGE) n = n + 1 >= song.form.length ? song.loopTo : n + 1;
  return n;
}

// Mesures à programmer : toutes celles qui commencent avant now + lookahead. Après une suspension (onglet
// caché, contexte arrêté), on recale sur l'horloge au lieu de rattraper d'un coup les mesures en retard.
export function planBars(now, nextTime, barSec, lookahead = 0.5, maxBars = 4) {
  let next = nextTime;
  let resync = false;
  if (next < now - barSec * 0.5) {
    next = now + 0.1;
    resync = true;
  }
  const times = [];
  while (next < now + lookahead && times.length < maxBars) {
    times.push(next);
    next += barSec;
  }
  return { times, next, resync };
}

// Mémoire d'un morceau rendu (octets) : somme des cellules (32 kHz, Float32, mono ou stéréo).
export const STEREO_LAYERS = { pad: false, keys: false, bass: false, groove: true, drums: true, lead: false };
export const LAYER_TAILS = { pad: 0.9, keys: 0.42, bass: 0.25, groove: 0.5, drums: 0.8, lead: 0.6 };
export function cellLength(song, cell) {
  return cell.bars * song.barLen + Math.round(LAYER_TAILS[cell.layer] * song.sr);
}
export function songBytes(song) {
  let n = 0;
  for (const c of Object.values(song.cells)) n += cellLength(song, c) * (STEREO_LAYERS[c.layer] ? 2 : 1) * 4;
  return n;
}
