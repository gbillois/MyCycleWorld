// Partitions de la musique (données pures) : un morceau écrit par ambiance de niveau, joué par
// music-gen.js (plan des cellules) puis rendu hors ligne par music-render.js.
//
// Notation (une mesure = 16 doubles-croches) :
//   accords      : degrés romains par rapport à la tonique, majuscule = majeur, minuscule = mineur,
//                  b/# = altération par rapport à la gamme majeure, suffixes 7, maj7, 9, add9, sus2, sus4, 6,
//                  basse sous la barre (/3 = tierce à la basse).
//   mélodies     : '1'..'7' degrés de la gamme dans l'octave de base, '8' '9' 'A' 'B' 'C' l'octave du dessus,
//                  'a'..'g' l'octave du dessous ; '-' prolonge la note, '.' silence.
//   basses       : R fondamentale, O octave, F quinte, f quinte en dessous, T tierce, A note d'approche de
//                  l'accord suivant ; '-' prolonge, '.' silence.
//   claviers     : '1'..'9' notes de l'accord de bas en haut (au-delà : octave suivante), C accord plaqué,
//                  D accord gratté vers le bas, U vers le haut (cordes aiguës) ; '-' prolonge, '.' étouffe.
//   batterie     : une ligne par instrument : x fort, X accent, o moyen, g fantôme, 1..9 nuance, '.' rien.
//
// Forme : intro (une fois), puis A B A2 B2 C en boucle (C, le pont sans batterie, est sauté si l'effort est fort).
// Couches (suivent l'intensité de la course) : pad (nappe), keys (claviers, guitare, arpèges), bass,
// groove (grosse caisse et petites percussions), drums (caisse claire, charleston, breaks), lead (mélodie).

const FORM = ['intro', 'A', 'B', 'A2', 'B2', 'C'];
// Sections type d'un morceau de course (les ambiances peuvent les compléter).
const RACE_SECTIONS = {
  intro: { prog: 'intro', keys: 'intro' },
  A: { prog: 'A', keys: 'A', bass: 'A', groove: 'A', drums: 'A', fill: true },
  B: { prog: 'B', keys: 'B', bass: 'B', groove: 'B', drums: 'B', lead: 'B', crash: true, fill: true },
  A2: { prog: 'A', keys: 'A2', bass: 'A', groove: 'A', drums: 'A2', fill: true },
  B2: { prog: 'B', keys: 'B2', bass: 'B', groove: 'B', drums: 'B', lead: 'B', harmony: true, crash: true, fill: true },
  C: { prog: 'C', keys: 'C', bass: 'C', groove: 'C', grooveFrom: 4, build: true },
};

export const SONGS = {
  // Prairie : pop acoustique ensoleillée. Guitare picking puis grattée, basse aux doigts, mélodie sifflée.
  meadow: {
    key: 62, mode: 'major', bpm: 112, swing16: 0.12,
    form: FORM, sections: RACE_SECTIONS,
    prog: {
      intro: ['Iadd9', 'IVmaj7', 'Iadd9', 'IVmaj7'],
      A: ['I', 'V', 'vi7', 'IVmaj7', 'I', 'V', 'ii7', 'V'],
      B: ['IVmaj7', 'V', 'iii7', 'vi7', 'IVmaj7', 'V', 'Isus4', 'I'],
      C: ['vi7', 'IVmaj7', 'I', 'V', 'vi7', 'IVmaj7', 'ii7', 'Vsus4'],
    },
    keys: {
      intro: [{ inst: 'guitar', p: '1-3-4-3-2-3-4-3-' }],
      A: [{ inst: 'guitar', p: '1-3-4-3-2-3-4-3-' }],
      A2: [{ inst: 'guitar', p: '1-3-4-5-2-3-4-5-' }],
      B: [{ inst: 'guitar', p: 'D---D-U---U-D-U-' }],
      B2: [{ inst: 'guitar', p: 'D---D-U-D-U-D-U-' }],
      C: [{ inst: 'guitar', p: '1-------3---4---' }],
    },
    bass: { A: 'R-----R-R-----A-', B: 'R--RR-.RR--RF-A-', C: 'R---------------' },
    groove: {
      A: { kick: 'x.....x.x.......', shaker: 'o.g.o.g.o.g.o.g.' },
      B: { kick: 'x.....x.x...x...', shaker: 'xgogxgogxgogxgog' },
      C: { kick: 'x.......x.......', shaker: '..g...g...g...g.' },
    },
    drums: {
      A: { snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' },
      A2: { snare: '....x.......x..g', hat: 'x.o.x.o.x.o.xoo.' },
      B: { snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.', tamb: '....x.......x...' },
      fill: { snare: '....x...x.......', hat: 'x.o.x.o.........', tomH: '..........xo....', tomM: '............xo..', tomL: '..............xx' },
      build: { snare: '3.3.4.4.55667789', riser: 'x...............' },
    },
    lead: {
      B: ['3--21-2-3---5---', '2-----g-e-------', '2--1g-1-2---3---', '1-----g-f-------', '5-6-5-3-1-2-3---', '4-----3-2---g---', '2-1-------------', '------..........'],
    },
    inst: {
      pad: { type: 'pad', a: 0.45, r: 0.32, cutoff: 1900, swell: 0.5, detune: 8, res: 0.1, voices: 4, range: [57, 76] },
      guitar: { type: 'string', bright: 3600, decay: 2.2, pos: 0.12, sub: 0.12, voices: 4, range: [50, 71], body: true },
      bass: { type: 'mono', kind: 'bass-finger', lo: 38, env: { a: 0.004, d: 0.5, s: 0.55, r: 0.06 }, lp: 1300, gain: 0.6 },
      lead: { type: 'mono', kind: 'whistle', base: 74, env: { a: 0.035, d: 0.6, s: 0.85, r: 0.09 }, vib: 18, vibRate: 5.6, glide: 0.03, breath: 0.05, scoop: 0.3, lp: 5500, gain: 0.5,
        // doublure de glockenspiel feutré une octave au-dessus : la mélodie brille sans siffler
        double: { type: 'modal', oct: 12, gain: 0.3, modes: [[1, 1, 0.6], [3.99, 0.2, 0.15]], attack: 0.003, maxHz: 5200 } },
      kit: { kickHz: 52, kickFrom: 140, kickDecay: 0.28, snareHz: 190, snareDecay: 0.12, hatHz: 6000 },
    },
    mix: {},
    fx: { t60: 1.5, verb: { pad: 0.22, keys: 0.18, lead: 0.26, drums: 0.08, groove: 0.04 }, delay: { beats: 0.75, fb: 0.28, lead: 0.16, keys: 0 }, duck: 0.18 },
  },

  // Montagne : aérien et épique. Grande nappe, célesta, cor en mélodie (canon de Pachelbel), timbales.
  alpine: {
    key: 65, mode: 'major', bpm: 96, swing16: 0,
    form: FORM, sections: { ...RACE_SECTIONS, C: { prog: 'C', keys: 'C', bass: 'C', groove: 'C', grooveFrom: 4, build: true } },
    prog: {
      intro: ['Isus2', 'Isus2', 'IVadd9', 'IVadd9'],
      A: ['vi7', 'IVadd9', 'I', 'V', 'vi7', 'IVadd9', 'I', 'Vsus4'],
      B: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'],
      C: ['IVmaj7', 'IVmaj7', 'I', 'I', 'vi7', 'vi7', 'Vsus4', 'V'],
    },
    keys: {
      intro: [{ inst: 'celesta', p: '1---3---5---3---' }],
      A: [{ inst: 'celesta', p: '1-2-3-4-5-4-3-2-' }],
      A2: [{ inst: 'celesta', p: '1-2-3-4-5-4-3-2-' }],
      B: [{ inst: 'celesta', p: '1-3-4-5-1-3-4-5-' }],
      B2: [{ inst: 'celesta', p: '1-3-4-5-6-5-4-3-' }],
      C: [{ inst: 'celesta', p: '1-------5-------' }],
    },
    bass: { A: 'R-------O-------', B: 'R-------R---F---', C: 'R---------------' },
    groove: {
      A: { taiko: 'x.......x..o....', shaker: '..o...o...o...o.' },
      B: { kick: 'x.......x.......', taiko: 'x.....o.x...o...', shaker: 'o.g.o.g.o.g.o.g.' },
      C: { taiko: 'x.......o.......' },
    },
    drums: {
      A: { snare: '........x.......', hat: 'x.o.x.o.x.o.x.o.' },
      A2: { snare: '........x......g', hat: 'x.o.x.o.x.o.x.o.' },
      B: { snare: '........x.......', hat: 'x.o.x.o.x.o.x.o.', tomL: '......o.........' },
      fill: { snare: '........x.......', hat: 'x.o.x.o.........', tomH: '..........x.....', tomM: '............x...', tomL: '..............x.' },
      build: { taiko: '3...4...5...6.78', snare: '........3.4.5.67', riser: 'x...............' },
    },
    lead: {
      B: ['1-----5-8-------', '7---6---5-------', '6-----5-3-------', '3-----5-7-------', '8-------6---4---', '5---6-5-3-------', '4---6---8---6---', '7-----------....'],
    },
    inst: {
      pad: { type: 'pad', a: 0.9, r: 0.45, cutoff: 2150, swell: 0.6, swellTime: 2, detune: 12, res: 0.08, voices: 5, range: [53, 77] },
      celesta: { type: 'modal', modes: [[1, 1, 0.9], [3.99, 0.16, 0.25], [10.1, 0.025, 0.05]], attack: 0.003, knock: 0.05, voices: 4, range: [62, 79] },
      bass: { type: 'mono', kind: 'bass-sustain', lo: 34, env: { a: 0.03, d: 2, s: 0.8, r: 0.15 }, lp: 900, gain: 0.6 },
      lead: { type: 'mono', kind: 'horn', base: 65, env: { a: 0.08, d: 0.8, s: 0.85, r: 0.14 }, cutoff: 480, envHz: 1800, res: 0.12, vib: 10, vibRate: 5, glide: 0.04, track: 0.4, gain: 0.55 },
      kit: { kickHz: 46, kickDecay: 0.4, snareHz: 170, snareDecay: 0.18 },
    },
    mix: {},
    fx: { t60: 2.6, verb: { pad: 0.3, keys: 0.34, lead: 0.3, drums: 0.22, groove: 0.2 }, delay: { beats: 1.5, fb: 0.3, lead: 0.1, keys: 0.14 }, duck: 0.1 },
  },

  // Côte : house tropicale. Marimba, accords piano en contretemps, flûte de pan, grosse caisse à chaque temps.
  coast: {
    key: 67, mode: 'major', bpm: 116, swing16: 0.18,
    form: FORM, sections: RACE_SECTIONS,
    prog: {
      intro: ['vi7', 'IVmaj7', 'Iadd9', 'V'],
      A: ['vi7', 'IVmaj7', 'Iadd9', 'V', 'vi7', 'IVmaj7', 'Iadd9', 'V'],
      B: ['Iadd9', 'V', 'vi7', 'IVmaj7', 'Iadd9', 'V', 'vi7', 'IVmaj7'],
      C: ['IVmaj7', 'IVmaj7', 'vi7', 'vi7', 'IVmaj7', 'IVmaj7', 'Vsus4', 'V'],
    },
    keys: {
      intro: [{ inst: 'marimba', p: '1-2-3-1-2-3-4-3-' }],
      A: [{ inst: 'stab', p: '..C-..C-..C-..C-' }],
      A2: [{ inst: 'stab', p: '..C-..C-..C-..C-' }, { inst: 'marimba', p: '........1-2-3-5-' }],
      B: [{ inst: 'marimba', p: '1-2-3-1-2-3-4-3-' }],
      B2: [{ inst: 'marimba', p: '5-4-3-5-4-3-2-3-' }, { inst: 'stab', p: '..C-..C-..C-..C-' }],
      C: [{ inst: 'stab', p: 'C-------........' }],
    },
    bass: { A: 'R--R--R-R--R--R-', B: '..R-..O-..R-..O-', C: 'R---------------' },
    groove: {
      A: { kick: 'x...x...x...x...', shaker: 'xgogxgogxgogxgog' },
      B: { kick: 'x...x...x...x...', shaker: 'xgogxgogxgogxgog', conga: '...o..o....o.o..' },
      C: { kick: 'x.......x.......' },
    },
    drums: {
      A: { clap: '....x.......x...', ohat: '..x...x...x...x.' },
      A2: { clap: '....x.......x...', ohat: '..x...x...x...x.', bongo: '.......o.....o.o' },
      B: { clap: '....x.......x...', ohat: '..x...x...x...x.', tamb: '....x.......x...' },
      fill: { clap: '....x...x.x.xxxx', ohat: '..x...x.........' },
      build: { snare: '3.3.4.4.5555667X', riser: 'x...............' },
    },
    lead: {
      B: ['3--3--5-6-5-3---', '2--2--3-2-------', '3--3--5-6-8-6---', '5-----3-1-------', '3--3--5-6-5-3---', '2--2--3-5---3-2-', '6--5--3-5-------', '3-----2-1-------'],
    },
    inst: {
      pad: { type: 'pad', a: 0.35, r: 0.3, cutoff: 1750, swell: 0.4, detune: 10, voices: 4, range: [57, 76] },
      marimba: { type: 'modal', modes: [[1, 1, 0.5], [3.93, 0.3, 0.08], [9.24, 0.05, 0.02]], attack: 0.002, knock: 0.08, knockHz: 1500, voices: 4, range: [60, 79] },
      stab: { type: 'ep', decay: 0.35, index: 1.4, trem: 0.01, tremDepth: 0, r: 0.07, voices: 4, range: [57, 74] },
      bass: { type: 'mono', kind: 'bass-house', lo: 31, env: { a: 0.004, d: 0.25, s: 0.6, r: 0.05 }, cutoff: 260, envHz: 700, res: 0.15, gain: 0.55 },
      lead: { type: 'mono', kind: 'panflute', base: 67, env: { a: 0.04, d: 0.5, s: 0.8, r: 0.1 }, vib: 14, vibRate: 5.3, glide: 0.05, breath: 0.07, chiff: 0.15, scoop: 0.6, lp: 4200, gain: 0.5,
        double: { type: 'modal', oct: 0, gain: 0.4, modes: [[1, 1, 0.5], [3.93, 0.25, 0.08]], attack: 0.002, knock: 0.05, maxHz: 5000 } },
      kit: { kickHz: 50, kickFrom: 160, kickDecay: 0.3, clapHz: 1300 },
    },
    mix: {},
    fx: { t60: 1.4, verb: { pad: 0.2, keys: 0.16, lead: 0.24, drums: 0.08, groove: 0.04 }, delay: { beats: 0.75, fb: 0.3, lead: 0.2, keys: 0.06 }, duck: 0.35 },
  },

  // Lac (aviron) : pulsation calme et régulière. Ré dorien, piano électrique, arpège en doubles-croches.
  lake: {
    key: 62, mode: 'dorian', bpm: 104, swing16: 0,
    form: FORM, sections: RACE_SECTIONS,
    prog: {
      intro: ['i9', 'i9', 'IV9', 'IV9'],
      A: ['i9', 'IV9', 'i9', 'IV9', 'bIIImaj7', 'IV', 'i9', 'v7'],
      B: ['bIIImaj7', 'IV', 'v7', 'i9', 'bIIImaj7', 'IV', 'bVII', 'i'],
      C: ['i9', 'i9', 'bVIImaj7', 'bVIImaj7', 'bIIImaj7', 'bIIImaj7', 'IV', 'IV'],
    },
    keys: {
      intro: [{ inst: 'ep', p: 'C---------------' }],
      A: [{ inst: 'ep', p: 'C-------..C-----' }, { inst: 'pluck', p: '1.3.2.3.1.3.2.3.' }],
      A2: [{ inst: 'ep', p: 'C-------..C-----' }, { inst: 'pluck', p: '1.3.2.3.1.3.2.3.' }],
      B: [{ inst: 'ep', p: 'C-------..C---C-' }, { inst: 'pluck', p: '1325132513251325' }],
      B2: [{ inst: 'ep', p: 'C-------..C---C-' }, { inst: 'pluck', p: '1352135213521352' }],
      C: [{ inst: 'ep', p: 'C---------------' }],
    },
    bass: { A: 'R-------R---R---', B: 'R-----R-R---R-A-', C: 'R---------------' },
    groove: {
      A: { kick: 'x.......x.......', shaker: '..o...o...o...o.' },
      B: { kick: 'x.......x.o.....', shaker: 'o.g.o.g.o.g.o.g.' },
      C: { kick: 'x...............', shaker: '..g...g...g...g.' },
    },
    drums: {
      A: { snap: '....x.......x...', hat: 'o.g.o.g.o.g.o.g.' },
      A2: { snap: '....x.......x...', hat: 'o.goo.g.o.goo.g.' },
      B: { clap: '....x.......x...', hat: 'o.g.o.g.o.g.o.g.' },
      fill: { clap: '....x.......x...', hat: 'o.g.o.g.o.g.....', tomM: '............o...', tomL: '..............o.' },
      build: { snare: '..2...3...4.5.67', riser: 'x...............' },
    },
    lead: {
      B: ['5-------3---2---', '1-----2-4-------', '5-------7---5---', '3-----2-1-------', '5---6-5-3-------', '4-----5-6-------', '7-------4---2---', '1-----------....'],
    },
    inst: {
      pad: { type: 'pad', a: 0.7, r: 0.4, cutoff: 1500, swell: 0.5, detune: 10, voices: 5, range: [55, 76] },
      ep: { type: 'ep', decay: 1.8, index: 1.7, tine: 1.8, trem: 4.2, tremDepth: 0.3, r: 0.15, voices: 4, range: [55, 74], rootless: true },
      pluck: { type: 'pluck', cutoff: 850, envHz: 2600, decay: 0.18, r: 0.08, detune: 6, voices: 4, range: [62, 79] },
      bass: { type: 'mono', kind: 'bass-sub', lo: 33, env: { a: 0.012, d: 1, s: 0.85, r: 0.08 }, gain: 0.6 },
      lead: { type: 'mono', kind: 'soft', base: 74, env: { a: 0.03, d: 0.6, s: 0.85, r: 0.15 }, vib: 12, glide: 0.07, lp: 3600, gain: 0.55,
        double: { type: 'modal', oct: 0, gain: 0.25, modes: [[1, 1, 1.2], [4.0, 0.18, 0.3]], attack: 0.003, tremolo: 4.5, tremDepth: 0.3, maxHz: 5000 } },
      kit: { kickHz: 48, kickDecay: 0.3, kickClick: 0.5 },
    },
    mix: {},
    fx: { t60: 2.2, verb: { pad: 0.25, keys: 0.25, lead: 0.3, drums: 0.12, groove: 0.06 }, delay: { beats: 0.75, fb: 0.38, lead: 0.28, keys: 0.12 }, duck: 0.15 },
  },

  // Rivière (kayak) : énergique. La mineur, ostinato de synthé, basse en croches, lead en dents de scie.
  river: {
    key: 57, mode: 'aeolian', bpm: 128, swing16: 0,
    form: FORM, sections: RACE_SECTIONS,
    prog: {
      intro: ['i', 'i', 'bVI', 'bVII'],
      A: ['i', 'bVII', 'bVI', 'bVII', 'i', 'bVII', 'bVI', 'v'],
      B: ['bVI', 'bVII', 'i', 'bIII', 'bVI', 'bVII', 'v', 'i'],
      C: ['i', 'bVI', 'bIII', 'bVII', 'i', 'bVI', 'bIII', 'bVII'],
    },
    keys: {
      intro: [{ inst: 'pluck', p: '1-4-2-4-3-4-2-4-' }],
      A: [{ inst: 'pluck', p: '1-4-2-4-3-4-2-4-' }],
      A2: [{ inst: 'pluck', p: '1-4-2-5-3-6-2-5-' }],
      B: [{ inst: 'pluck', p: '1424142414241424' }],
      B2: [{ inst: 'pluck', p: '1525152515251525' }],
      C: [{ inst: 'pluck', p: '1-------4-------' }],
    },
    bass: { A: 'R-R-R-R-R-R-O-R-', B: 'R-R-O-R-R-R-O-A-', C: 'R-------R-------' },
    groove: {
      A: { kick: 'x...x...x...x...', shaker: 'xgogxgogxgogxgog' },
      B: { kick: 'x...x...x...x...', shaker: 'xgogxgogxgogxgog' },
      C: { kick: 'x.......x.......' },
    },
    drums: {
      A: { snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' },
      A2: { snare: '....x.......x.g.', hat: 'x.o.x.o.x.o.x.oo' },
      B: { snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.', ohat: '..............x.' },
      fill: { snare: '....x...........', hat: 'x.o.x.o.........', tomH: '........x.x.....', tomM: '............x.x.', tomL: '.............x.x' },
      build: { snare: '4.4.4.4.55556789', riser: 'x...............' },
    },
    lead: {
      B: ['8-8-7-8---5-3---', '7-7-6-7---4-2---', '3-3-2-3---5-8---', '7-------5---3---', '8-8-7-8---5-3---', '7-7-6-7---4-2---', '5-5-4-5---7-9---', '8-----------....'],
    },
    inst: {
      pad: { type: 'pad', a: 0.3, r: 0.3, cutoff: 1350, swell: 0.4, detune: 12, res: 0.15, voices: 4, range: [52, 72] },
      pluck: { type: 'pluck', cutoff: 700, envHz: 2500, decay: 0.12, r: 0.05, detune: 8, voices: 3, range: [57, 72] },
      bass: { type: 'mono', kind: 'bass-drive', lo: 28, env: { a: 0.003, d: 0.3, s: 0.7, r: 0.04 }, cutoff: 240, envHz: 1100, res: 0.2, gain: 0.5 },
      lead: { type: 'mono', kind: 'saw', base: 69, env: { a: 0.012, d: 0.5, s: 0.8, r: 0.1 }, cutoff: 850, envHz: 1600, res: 0.18, vib: 14, glide: 0.03, track: 0.3, gain: 0.5 },
      kit: { kickHz: 50, kickFrom: 170, kickDecay: 0.26, snareHz: 200, snareDecay: 0.14 },
    },
    mix: {},
    fx: { t60: 1.4, verb: { pad: 0.16, keys: 0.12, lead: 0.18, drums: 0.07, groove: 0.03 }, delay: { beats: 0.75, fb: 0.25, lead: 0.15, keys: 0 }, duck: 0.3 },
  },

  // Forêt (VTT) : terrien et rythmé. Mi dorien, guitare étouffée, kalimba, congas, flûte en bois.
  forest: {
    key: 64, mode: 'dorian', bpm: 116, swing16: 0.08,
    form: FORM, sections: RACE_SECTIONS,
    prog: {
      intro: ['i7', 'i7', 'IV', 'IV'],
      A: ['i7', 'IV', 'i7', 'IV', 'bIII', 'IV', 'i7', 'bVII'],
      B: ['bIII', 'bVII', 'IV', 'i7', 'bIII', 'bVII', 'IV', 'IV'],
      C: ['i7', 'i7', 'bVII', 'bVII', 'bIII', 'bIII', 'IV', 'IV'],
    },
    keys: {
      intro: [{ inst: 'kalimba', p: '1--3--2-1--3--4-' }],
      A: [{ inst: 'mute', p: '1.13.1.31.13.1.3' }],
      A2: [{ inst: 'mute', p: '1.13.1.31.13.1.3' }, { inst: 'kalimba', p: '........5---4---' }],
      B: [{ inst: 'kalimba', p: '1-3-4-5-1-3-4-5-' }],
      B2: [{ inst: 'kalimba', p: '1-3-4-5-6-5-4-3-' }, { inst: 'mute', p: '1.1.1.1.1.1.1.1.' }],
      C: [{ inst: 'kalimba', p: '1-------3-------' }],
    },
    bass: { A: 'R--R--F-R--R--A-', B: 'R-.RF-.RR-.RO-A-', C: 'R-------F-------' },
    groove: {
      A: { kick: 'x.....x...x.....', conga: '..o..o....o..o..', shaker: 'o.g.o.g.o.g.o.g.' },
      B: { kick: 'x.....x...x.....', conga: '..o..o....o..o..', congaL: '.......o.......o', shaker: 'xgogxgogxgogxgog' },
      C: { conga: '..o.......o.....', shaker: '..g...g...g...g.' },
    },
    drums: {
      A: { rim: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.' },
      A2: { rim: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.', block: '...o......o.....' },
      B: { snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.o.', tamb: '..x...x...x...x.' },
      fill: { snare: '....x...........', hat: 'x.o.x.o.........', tomH: '........x..x....', tomM: '..........x..x..', tomL: '..............xx' },
      build: { snare: '...3...4..5.6789', riser: 'x...............' },
    },
    lead: {
      B: ['5--43-5-7---5---', '4--32-1-2---4---', '6--54-6-8---6---', '5-----4-3-------', '5--43-5-7---5---', '4--32-1-2---4---', '6--54-6-8---9---', '8-----------....'],
    },
    inst: {
      pad: { type: 'pad', a: 0.5, r: 0.35, cutoff: 1350, swell: 0.4, detune: 9, voices: 4, range: [52, 72] },
      mute: { type: 'string', bright: 2000, decay: 0.3, mute: true, muteT: 0.18, pos: 0.2, voices: 3, range: [52, 67], body: true },
      kalimba: { type: 'modal', modes: [[1, 1, 0.7], [5.1, 0.12, 0.08], [11.2, 0.03, 0.02]], attack: 0.0015, knock: 0.12, knockHz: 1200, voices: 4, range: [64, 81] },
      bass: { type: 'string', bright: 900, decay: 1.4, pos: 0.25, sub: 0.35, lo: 33, gain: 1 },
      lead: { type: 'mono', kind: 'flute', base: 64, env: { a: 0.05, d: 0.6, s: 0.85, r: 0.1 }, vib: 16, vibRate: 5.4, glide: 0.04, breath: 0.06, scoop: 0.5, chiff: 0.08, lp: 3800, gain: 0.5,
        double: { type: 'modal', oct: 12, gain: 0.3, modes: [[1, 1, 0.7], [5.1, 0.12, 0.08]], attack: 0.0015, maxHz: 6000 } },
      kit: { kickHz: 54, kickDecay: 0.26, snareHz: 210 },
    },
    mix: {},
    fx: { t60: 1.6, verb: { pad: 0.2, keys: 0.16, lead: 0.26, drums: 0.1, groove: 0.1 }, delay: { beats: 0.75, fb: 0.22, lead: 0.12, keys: 0 }, duck: 0.15 },
  },

  // Menu : jazz-pop détendu (si bémol majeur, croches swinguées). Piano électrique, contrebasse, balais, vibraphone.
  menu: {
    key: 58, mode: 'major', bpm: 84, swing8: 0.55, swing16: 0,
    form: ['intro', 'A', 'B', 'A2', 'B2'],
    sections: {
      intro: { prog: 'intro', keys: 'intro' },
      A: { prog: 'A', keys: 'A', bass: 'A', groove: 'A' },
      B: { prog: 'B', keys: 'B', bass: 'B', groove: 'A', lead: 'B' },
      A2: { prog: 'A', keys: 'A', bass: 'A', groove: 'A' },
      B2: { prog: 'B', keys: 'B', bass: 'B', groove: 'A', lead: 'B' },
    },
    prog: {
      intro: ['IVmaj7', 'IVmaj7'],
      A: ['Imaj7', 'vi7', 'ii7', 'V7sus4', 'Imaj7', 'vi7', 'ii7', 'V7'],
      B: ['IVmaj7', 'iii7', 'vi7', 'ii7', 'IVmaj7', 'iii7', 'ii7', 'V7sus4'],
    },
    keys: {
      intro: [{ inst: 'ep', p: 'C-------------..' }],
      A: [{ inst: 'ep', p: 'C-------..C-----' }],
      B: [{ inst: 'ep', p: 'C-----C-..C---C-' }],
    },
    bass: { A: 'R-------F-----A-', B: 'R---F---O---A---' },
    groove: {
      A: { brush: '....x.......x...', shaker: 'x.o.x.o.x.o.x.o.', kick: 'o.......o.......' },
    },
    drums: {},
    lead: {
      B: ['3---1---6-----5-', '5-------3---2---', '6---8---6-----5-', '4-------2---1---', '3---5---8---7---', '6-------5---3---', '4---3---2---1---', '2-----------....'],
    },
    inst: {
      pad: { type: 'pad', a: 1.0, r: 0.45, cutoff: 1150, swell: 0.3, detune: 7, voices: 4, range: [55, 72] },
      ep: { type: 'ep', decay: 2.2, index: 1.6, tine: 1.8, trem: 4.5, tremDepth: 0.35, r: 0.15, voices: 4, range: [55, 72], rootless: true },
      bass: { type: 'string', bright: 800, decay: 1.6, pos: 0.25, sub: 0.4, lo: 34, gain: 1 },
      lead: { type: 'modal', base: 70, modes: [[1, 1, 1.8], [4.0, 0.15, 0.4], [10.0, 0.02, 0.06]], attack: 0.003, tremolo: 4.8, tremDepth: 0.35, knock: 0.04, r: 0.25 },
      kit: { shakerHz: 3000, kickHz: 55, kickDecay: 0.25, kickClick: 0.3 },
    },
    mix: { pad: -3 },
    // Au menu, tout joue dès l'intensité 1 (accueil) ; pas de batterie
    th: { pad: -1, keys: -1, bass: 0.3, groove: 0.6, lead: 0.6, drums: 9 },
    fx: { t60: 1.8, verb: { pad: 0.2, keys: 0.22, lead: 0.3, drums: 0, groove: 0.12 }, delay: { beats: 1, fb: 0.2, lead: 0.12, keys: 0 }, duck: 0 },
  },
};
