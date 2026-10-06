// Musique procédurale (module pur, testé dans tests/audio.test.js) : chaque niveau tire de sa graine une
// tonalité, un tempo, une grille d'accords, des rythmes de batterie, de basse et d'arpège. La lecture
// (music.js) programme les notes à l'avance sur l'horloge audio : calendrier calculé ici.
import { rng, hashSeed, range, irange, pick, chance } from './random.js';

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

// Grilles (degrés de la gamme, 0 = tonique) éprouvées en pop / indie / électro.
const PROGRESSIONS = {
  major: [[0, 4, 5, 3], [5, 3, 0, 4], [0, 5, 3, 4], [0, 2, 3, 4], [3, 4, 0, 5], [0, 3, 5, 4], [3, 0, 4, 5]],
  minor: [[0, 5, 2, 6], [0, 3, 6, 2], [0, 6, 5, 6], [5, 6, 0, 0], [0, 3, 4, 0]],
  dorian: [[0, 3, 0, 3], [0, 6, 3, 0], [0, 2, 3, 6]],
  mixolydian: [[0, 6, 3, 0], [0, 3, 6, 3], [0, 6, 4, 3]],
  lydian: [[0, 1, 0, 1], [0, 1, 4, 3], [0, 4, 1, 5]],
};

// Ambiances par niveau : tempo, modes, tonique (MIDI), instrument mélodique, style de batterie.
export const MOODS = {
  meadow: { bpm: [108, 116], modes: ['major', 'major', 'lydian'], roots: [62, 64, 65, 67], instrument: 'pluck', feel: 'indie', swing: [0.04, 0.1] },
  alpine: { bpm: [96, 104], modes: ['mixolydian', 'major'], roots: [62, 63, 65, 67], instrument: 'bell', feel: 'airy', swing: [0, 0.06] },
  coast: { bpm: [114, 120], modes: ['major', 'dorian'], roots: [60, 62, 65, 67], instrument: 'marimba', feel: 'tropical', swing: [0.08, 0.16] },
  lake: { bpm: [122, 126], modes: ['minor', 'dorian'], roots: [57, 59, 60, 62], instrument: 'synth', feel: 'drive', swing: [0, 0.04] },
  forest: { bpm: [118, 124], modes: ['dorian', 'mixolydian'], roots: [57, 59, 62, 64], instrument: 'pluck', feel: 'indie', swing: [0.02, 0.08] },
  river: { bpm: [126, 132], modes: ['minor', 'dorian'], roots: [57, 58, 60, 62], instrument: 'synth', feel: 'drive', swing: [0, 0.03] },
  menu: { bpm: [80, 88], modes: ['major', 'lydian'], roots: [60, 62, 63, 65], instrument: 'keys', feel: 'calm', swing: [0.05, 0.12] },
};

// Accord (notes MIDI) bâti sur un degré : triade, plus septième ou neuvième pour la couleur.
export function chordNotes(root, scale, degree, { seventh = false, add9 = false } = {}) {
  const at = (k) => {
    const oct = Math.floor(k / scale.length);
    return root + scale[((k % scale.length) + scale.length) % scale.length] + 12 * oct;
  };
  const notes = [at(degree), at(degree + 2), at(degree + 4)];
  if (seventh) notes.push(at(degree + 6));
  if (add9) notes.push(at(degree + 8));
  return notes;
}

// Voicing proche (les notes bougent peu d'un accord à l'autre) dans une tessiture donnée.
export function voiceLead(notes, center = 64) {
  return notes.map((n) => {
    let m = n;
    while (m < center - 7) m += 12;
    while (m > center + 6) m -= 12;
    return m;
  }).sort((a, b) => a - b);
}

const pattern = (str) => [...str].map((c) => (c === 'x' ? 1 : c === 'o' ? 0.55 : c === '.' ? 0 : Number(c) / 9));

const DRUMS = {
  indie: {
    kick: ['x.....x.x.......', 'x......xx...x...', 'x.....x...x.....'],
    snare: ['....x.......x...', '....x.......x..o'],
    hat: ['x.o.x.o.x.o.x.o.', 'xoxoxoxoxoxoxoxo'],
  },
  airy: {
    kick: ['x.......x.......', 'x.....x.........'],
    snare: ['........x.......', '....x.......x...'],
    hat: ['..x...x...x...x.', 'x.o.x.o.x.o.x.o.'],
  },
  tropical: {
    kick: ['x...x...x...x...', 'x...x...x...x..o'],
    snare: ['....x.......x...', '...x..x....x..x.'],
    hat: ['..x...x...x...x.', '.ox.ox.ox.ox.ox.'],
  },
  drive: {
    kick: ['x...x...x...x...', 'x...x...x...x.o.'],
    snare: ['....x.......x...'],
    hat: ['oxoxoxoxoxoxoxox', '..x...x...x...x.'],
  },
  calm: {
    kick: ['................'],
    snare: ['....5.......5...'],
    hat: ['3.2.3.2.3.2.3.2.'],
  },
};

const BASS = {
  indie: ['x.....x.x...x...', 'x..x..x...x.x...'],
  airy: ['x.......x.......', 'x.....x.....x...'],
  tropical: ['x..x..x...x..x..', 'x..x....x..x....'],
  drive: ['.x.x.x.x.x.x.x.x', 'xxoxxoxoxxoxxoxo'],
  calm: ['x...............', 'x.......x.......'],
};

const ARP = ['0.1.2.1.0.1.2.3.', '0..1..2..1..0..2', '0.2.1.3.0.2.1.3.', '2.1.0.1.2.1.0...', '0...1...2...3...'];

export function makeSong(seedText, moodName = 'meadow') {
  const mood = MOODS[moodName] || MOODS.meadow;
  const r = rng(hashSeed(`${seedText}|${moodName}`));
  const mode = pick(r, mood.modes);
  const scale = SCALES[mode];
  const root = pick(r, mood.roots);
  const bpm = Math.round(range(r, mood.bpm[0], mood.bpm[1]));
  const progA = pick(r, PROGRESSIONS[mode]);
  let progB = pick(r, PROGRESSIONS[mode]);
  if (progB === progA) progB = [...progA].reverse();
  const color = { seventh: chance(r, 0.6), add9: chance(r, 0.35) };
  // 16 mesures : A A B B (grille de 4 accords, une mesure chacun)
  const bars = [];
  for (let b = 0; b < 16; b++) {
    const prog = b < 8 ? progA : progB;
    const degree = prog[b % 4];
    const notes = chordNotes(root, scale, degree, color);
    bars.push({ degree, notes: voiceLead(notes, moodName === 'menu' ? 62 : 64), bass: root - 24 + scale[degree % 7] + (degree >= 7 ? 12 : 0) });
  }
  const d = DRUMS[mood.feel];
  const drums = {
    kick: [pattern(pick(r, d.kick)), pattern(pick(r, d.kick))],
    snare: [pattern(pick(r, d.snare)), pattern(pick(r, d.snare))],
    hat: [pattern(pick(r, d.hat)), pattern(pick(r, d.hat))],
    open: pattern(pick(r, ['......x.......x.', '..............x.', '......x.........'])),
    perc: pattern(pick(r, ['...x..x....x..x.', '..x..x..x..x....', '.x...x...x...x..'])),
  };
  const bassRhythm = [pattern(pick(r, BASS[mood.feel])), pattern(pick(r, BASS[mood.feel]))];
  // Basse : tonique, parfois la quinte ou l'octave pour faire rebondir
  const bassNotes = [0, 1].map(() => Array.from({ length: 16 }, (_, i) => (i === 0 ? 0 : weightedOffset(r))));
  const arp = [pick(r, ARP), pick(r, ARP)].map((s) => [...s].map((c) => (c === '.' ? null : Number(c))));
  // Motif mélodique de deux mesures (rythme et contour), rejoué avec variations
  const motif = [];
  let step = 0;
  let deg = irange(r, 2, 4);
  while (step < 32) {
    const len = pick(r, [2, 2, 4, 4, 6, 8]);
    if (chance(r, 0.75)) motif.push({ step, len, deg });
    deg = Math.max(0, Math.min(9, deg + pick(r, [-2, -1, -1, 1, 1, 2, 0])));
    step += len;
  }
  return {
    mood: moodName,
    feel: mood.feel,
    instrument: mood.instrument,
    mode,
    scale,
    root,
    bpm,
    swing: range(r, mood.swing[0], mood.swing[1]),
    bars,
    drums,
    bassRhythm,
    bassNotes,
    arp,
    arpOctave: moodName === 'menu' ? 0 : pick(r, [0, 12]),
    motif,
  };
}

function weightedOffset(r) {
  const x = r();
  return x < 0.65 ? 0 : x < 0.85 ? 12 : x < 0.95 ? 7 : -5;
}

// Note de la gamme à partir d'un degré (peut dépasser l'octave).
export function scaleNote(song, degree, octave = 0) {
  const n = song.scale.length;
  const k = ((degree % n) + n) % n;
  return song.root + song.scale[k] + 12 * (Math.floor(degree / n) + octave);
}

// Couches selon l'intensité (0..3) : facteur 0..1 pour chaque instrument (fondu sur 0,4 d'intensité).
export const LAYER_THRESHOLDS = { pad: -1, bass: 0.4, arp: 0.9, hat: 1.2, kick: 1.8, snare: 1.8, open: 2.5, perc: 2.5, motif: 2.6 };
export function layerLevel(intensity, layer) {
  const th = LAYER_THRESHOLDS[layer] ?? 0;
  return Math.max(0, Math.min(1, (intensity - th) / 0.4));
}

// Événements à jouer pour un pas de double-croche (16 pas par mesure, 16 mesures par boucle).
export function stepEvents(song, stepIndex, intensity) {
  const bar = Math.floor(stepIndex / 16) % song.bars.length;
  const s = stepIndex % 16;
  const half = bar >= 8 ? 1 : 0;
  const chord = song.bars[bar];
  const ev = [];
  const lv = (k) => layerLevel(intensity, k);
  if (s === 0) ev.push({ type: 'chord', notes: chord.notes, bar });
  const drum = (kind, v) => v > 0 && ev.push({ type: 'drum', kind, vel: v });
  drum('kick', song.drums.kick[half][s] * lv('kick'));
  if (song.feel === 'calm') drum('brush', song.drums.snare[half][s] * Math.max(0.4, lv('hat')));
  else drum(song.feel === 'tropical' || song.feel === 'airy' ? 'clap' : 'snare', song.drums.snare[half][s] * lv('snare'));
  drum(song.feel === 'airy' || song.feel === 'calm' ? 'shaker' : 'hat', song.drums.hat[(bar >> 1) & 1][s] * lv('hat') * 0.8);
  drum('openhat', song.drums.open[s] * lv('open') * 0.6);
  drum(song.feel === 'tropical' ? 'conga' : 'rim', song.drums.perc[s] * lv('perc') * 0.5);
  // Roulement de caisse claire à la fin de chaque section de 8 mesures
  if ((bar % 8 === 7) && s >= 12 && intensity >= 2) drum('snare', 0.35 + (s - 12) * 0.12);
  const b = song.bassRhythm[half][s];
  if (b > 0 && lv('bass') > 0) ev.push({ type: 'bass', midi: chord.bass + song.bassNotes[half][s], vel: b * lv('bass'), len: song.feel === 'drive' ? 0.5 : 1 });
  const a = song.arp[half][s];
  if (a !== null && lv('arp') > 0) {
    const notes = chord.notes;
    ev.push({ type: 'note', midi: notes[a % notes.length] + 12 * Math.floor(a / notes.length) + song.arpOctave, vel: 0.6 * lv('arp') });
  }
  if (lv('motif') > 0) {
    const m = (stepIndex % 32);
    for (const n of song.motif) if (n.step === m && bar % 4 >= 2) ev.push({ type: 'note', midi: scaleNote(song, n.deg, 1), vel: 0.55 * lv('motif'), lead: true });
  }
  return ev;
}

// --- Calendrier (horloge audio) ---
export const stepDuration = (bpm) => 60 / bpm / 4;

// Décalage « swing » des doubles-croches impaires.
export const swingOffset = (step, dur, swing) => (step % 2 ? dur * swing : 0);

// Pas à programmer : tous ceux qui tombent avant now + lookahead. Si l'horloge a pris du retard
// (contexte suspendu, onglet caché), on recale au lieu de jouer d'un coup les notes en retard.
export function planSteps(now, nextTime, dur, lookahead = 0.1, maxSteps = 16) {
  let next = nextTime;
  if (next < now - 0.2) next = now + 0.05;
  const times = [];
  while (next < now + lookahead && times.length < maxSteps) {
    times.push(next);
    next += dur;
  }
  return { times, next };
}
