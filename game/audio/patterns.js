// Logique pure du son (testée dans tests/audio.test.js) : chants d'oiseaux par espèce, revêtement -> bruit
// des pneus, compte à rebours, dépassements, souffle, intensité de la musique, foule.
import { range, irange, pick, chance, logRange, weighted } from './random.js';

// =====================================================================
// Chants d'oiseaux : une suite de notes { t, d, f0, f1, peak, curve, a, am, fm, h2, att, rel }
//   t, d : début et durée (s) ; f0 -> f1 : fréquences de départ et d'arrivée (Hz)
//   curve : 'lin', 'exp', 'arch' (monte vers peak puis redescend) ou 'dip' (creux)
//   am / fm : [fréquence, profondeur] de modulation d'amplitude (roulades, grésillement) ou de fréquence (vibrato)
//   h2 : part d'harmonique 2 (sifflement pur ≈ 0, cri plus rauque ≈ 0.4)
// Les contours imitent des espèces européennes (sonogrammes) sans copier d'enregistrement.
// =====================================================================

const note = (o) => ({ curve: 'lin', a: 1, am: null, fm: null, h2: 0.08, att: 0.15, rel: 0.3, peak: 0, ...o });

function blackbird(r) {
  // Merle noir : phrases flûtées graves et variées, souvent terminées par un gazouillis aigu.
  const out = [];
  let t = 0;
  const n = irange(r, 4, 8);
  for (let i = 0; i < n; i++) {
    const d = range(r, 0.08, 0.24);
    const f0 = logRange(r, 1400, 2600);
    const f1 = f0 * range(r, 0.8, 1.35);
    out.push(note({ t, d, f0, f1, peak: Math.max(f0, f1) * range(r, 1.05, 1.25), curve: pick(r, ['arch', 'lin', 'arch', 'dip']), a: range(r, 0.6, 1), fm: [range(r, 18, 30), range(r, 0.008, 0.025)], h2: 0.12, att: 0.2, rel: 0.35 }));
    t += d + range(r, 0.03, 0.12);
  }
  if (chance(r, 0.7)) {
    const m = irange(r, 2, 5);
    for (let i = 0; i < m; i++) {
      const d = range(r, 0.025, 0.055);
      const f0 = logRange(r, 4500, 7000);
      out.push(note({ t, d, f0, f1: f0 * range(r, 0.7, 1.2), a: range(r, 0.25, 0.45), att: 0.1, rel: 0.4 }));
      t += d + range(r, 0.01, 0.035);
    }
  }
  return out;
}

function greatTit(r) {
  // Mésange charbonnière : « ti-tu ti-tu ti-tu », note aiguë puis grave, très régulier.
  const out = [];
  const hi = range(r, 5400, 6600);
  const lo = range(r, 3100, 3900);
  const period = range(r, 0.24, 0.32);
  const n = irange(r, 3, 6);
  for (let i = 0; i < n; i++) {
    const t = i * period;
    out.push(note({ t, d: 0.065, f0: hi, f1: hi * 0.93, a: 0.85, att: 0.12, rel: 0.3 }));
    out.push(note({ t: t + 0.1, d: 0.09, f0: lo * 1.02, f1: lo * 0.96, a: 0.75, att: 0.15, rel: 0.35 }));
  }
  return out;
}

function chaffinch(r) {
  // Pinson des arbres : trille descendante qui accélère, puis fioriture finale.
  const out = [];
  let t = 0;
  const k1 = irange(r, 5, 8);
  const top = range(r, 5000, 6000);
  for (let i = 0; i < k1; i++) {
    const f0 = top * (1 - i * 0.03);
    out.push(note({ t, d: 0.042, f0, f1: f0 * 0.66, a: 0.7 + 0.03 * i, att: 0.1, rel: 0.3 }));
    t += 0.042 + 0.036;
  }
  const k2 = irange(r, 3, 5);
  for (let i = 0; i < k2; i++) {
    const f0 = 4200 - i * 120;
    out.push(note({ t, d: 0.05, f0, f1: f0 * 0.62, a: 0.9, att: 0.1, rel: 0.3 }));
    t += 0.05 + 0.028;
  }
  out.push(note({ t, d: 0.22, f0: 2600, peak: range(r, 4800, 5600), f1: 2200, curve: 'arch', a: 1, att: 0.08, rel: 0.4, h2: 0.1 }));
  return out;
}

function robin(r) {
  // Rouge-gorge : notes fines et aiguës, glissades rapides, quelques notes tenues.
  const out = [];
  let t = 0;
  const n = irange(r, 5, 10);
  for (let i = 0; i < n; i++) {
    const held = chance(r, 0.2);
    const d = held ? range(r, 0.12, 0.2) : range(r, 0.03, 0.1);
    const f0 = logRange(r, 2600, 7600);
    const f1 = held ? f0 * range(r, 0.95, 1.05) : f0 * range(r, 0.6, 1.5);
    out.push(note({ t, d, f0, f1: Math.min(8500, f1), curve: held ? 'lin' : pick(r, ['lin', 'exp', 'arch']), peak: Math.min(8800, Math.max(f0, f1) * 1.15), a: range(r, 0.4, 0.95), fm: held ? [range(r, 40, 70), 0.012] : null, att: 0.12, rel: 0.35 }));
    t += d + range(r, 0.02, 0.14);
  }
  return out;
}

function skylark(r) {
  // Alouette des champs : longue roulade continue et aiguë, tombée de très haut dans le ciel.
  const out = [];
  let t = 0;
  const dur = range(r, 3.5, 6);
  while (t < dur) {
    const d = range(r, 0.03, 0.08);
    const f0 = logRange(r, 2600, 6200);
    out.push(note({ t, d, f0, f1: f0 * range(r, 0.7, 1.35), peak: f0 * 1.3, curve: pick(r, ['lin', 'arch', 'exp']), a: 0.45 + 0.4 * Math.sin((t / dur) * Math.PI) * range(r, 0.6, 1), am: chance(r, 0.15) ? [range(r, 40, 80), 0.5] : null, att: 0.12, rel: 0.3 }));
    t += d + range(r, 0.008, 0.04);
  }
  return out;
}

function swallow(r) {
  // Hirondelle : gazouillis rapide, une note grésillante au milieu.
  const out = [];
  let t = 0;
  const n = irange(r, 8, 16);
  for (let i = 0; i < n; i++) {
    const buzz = i === Math.floor(n * 0.6);
    const d = buzz ? 0.18 : range(r, 0.02, 0.06);
    const f0 = buzz ? 3800 : logRange(r, 3000, 7000);
    out.push(note({ t, d, f0, f1: buzz ? 3500 : f0 * range(r, 0.75, 1.3), a: buzz ? 0.5 : range(r, 0.4, 0.85), am: buzz ? [range(r, 55, 75), 0.7] : null, att: 0.1, rel: 0.3 }));
    t += d + range(r, 0.012, 0.05);
  }
  return out;
}

function cuckoo(r) {
  // Coucou gris : « cou-cou » grave et doux, tierce descendante, répété avec une seconde d'écart.
  const out = [];
  const c = range(r, 640, 720);
  const n = irange(r, 3, 6);
  const period = range(r, 0.95, 1.15);
  for (let i = 0; i < n; i++) {
    const t = i * period;
    out.push(note({ t, d: 0.2, f0: c * 1.01, f1: c * 0.97, a: 1, h2: 0.14, att: 0.25, rel: 0.4 }));
    out.push(note({ t: t + 0.3, d: 0.32, f0: c * 0.81, f1: c * 0.78, a: 0.9, h2: 0.14, att: 0.2, rel: 0.5 }));
  }
  return out;
}

function chough(r) {
  // Chocard à bec jaune (montagne) : sifflements glissés « tchiip », un peu grésillants, en groupe.
  const out = [];
  let t = 0;
  const n = irange(r, 1, 4);
  for (let i = 0; i < n; i++) {
    const d = range(r, 0.14, 0.24);
    const f0 = range(r, 2300, 3000);
    out.push(note({ t, d, f0, peak: range(r, 4100, 5000), f1: range(r, 2500, 3200), curve: 'arch', a: range(r, 0.7, 1), am: [range(r, 60, 90), 0.22], h2: 0.28, att: 0.1, rel: 0.35 }));
    t += d + range(r, 0.22, 0.5);
  }
  return out;
}

function marmot(r) {
  // Marmotte : sifflet d'alarme bref, perçant et légèrement descendant (l'écho des falaises le répète).
  const out = [];
  let t = 0;
  const n = irange(r, 1, 3);
  for (let i = 0; i < n; i++) {
    const f0 = range(r, 2850, 3250);
    out.push(note({ t, d: range(r, 0.09, 0.15), f0, f1: f0 * 0.88, a: 1, h2: 0.35, att: 0.05, rel: 0.3 }));
    t += range(r, 0.55, 0.95);
  }
  return out;
}

function dipper(r) {
  // Cincle plongeur (torrents) : « zit zit » secs et aigus au-dessus du bruit de l'eau.
  const out = [];
  let t = 0;
  const n = irange(r, 2, 6);
  for (let i = 0; i < n; i++) {
    const f0 = range(r, 6000, 7800);
    out.push(note({ t, d: range(r, 0.03, 0.05), f0, f1: f0 * 0.8, a: 0.9, att: 0.08, rel: 0.4 }));
    t += range(r, 0.09, 0.2);
  }
  return out;
}

function reedWarbler(r) {
  // Rousserolle (roselières du lac) : bavardage rauque, syllabes répétées deux ou trois fois.
  const out = [];
  let t = 0;
  const types = Array.from({ length: irange(r, 3, 5) }, () => ({ f0: logRange(r, 2000, 5000), k: range(r, 0.7, 1.4), d: range(r, 0.04, 0.09), buzz: range(r, 90, 150) }));
  const n = irange(r, 6, 12);
  for (let i = 0; i < n; i++) {
    const s = pick(r, types);
    const rep = irange(r, 2, 3);
    for (let j = 0; j < rep; j++) {
      out.push(note({ t, d: s.d, f0: s.f0, f1: s.f0 * s.k, a: range(r, 0.6, 0.9), am: [s.buzz, 0.45], h2: 0.3, att: 0.1, rel: 0.3 }));
      t += s.d + 0.03;
    }
    t += range(r, 0.04, 0.12);
  }
  return out;
}

function coot(r) {
  // Foulque macroule : « kowk » ou « pitt » brefs et métalliques.
  const out = [];
  let t = 0;
  const n = irange(r, 1, 3);
  for (let i = 0; i < n; i++) {
    const f0 = range(r, 850, 1150);
    out.push(note({ t, d: range(r, 0.07, 0.11), f0, peak: f0 * 1.25, f1: f0 * 0.9, curve: 'arch', a: 1, am: [range(r, 140, 190), 0.55], h2: 0.6, att: 0.06, rel: 0.35 }));
    t += range(r, 0.3, 0.7);
  }
  return out;
}

export const BIRDS = { blackbird, greatTit, chaffinch, robin, skylark, swallow, cuckoo, chough, marmot, dipper, reedWarbler, coot };

// Espèces par décor, avec leur poids (fréquence relative des chants).
export const SCENE_BIRDS = {
  meadow: [['blackbird', 3], ['chaffinch', 3], ['robin', 2], ['greatTit', 2], ['swallow', 1.2], ['skylark', 0.8]],
  alpine: [['chough', 3], ['skylark', 1.5], ['chaffinch', 1], ['robin', 0.8]],
  coast: [['swallow', 1], ['greatTit', 0.6], ['skylark', 0.6]],
  lake: [['reedWarbler', 2.5], ['coot', 1.2], ['blackbird', 1.5], ['chaffinch', 1], ['robin', 0.8]],
  river: [['dipper', 2], ['chaffinch', 1], ['robin', 1], ['blackbird', 0.8]],
};

export function birdSong(species, r) {
  return (BIRDS[species] || blackbird)(r);
}

export function pickBird(scene, r) {
  return weighted(r, SCENE_BIRDS[scene] || SCENE_BIRDS.meadow);
}

export function songDuration(notes) {
  let end = 0;
  for (const n of notes) end = Math.max(end, n.t + n.d);
  return end;
}

// Fréquence instantanée d'une note en u = 0..1.
export function contour(n, u) {
  const s = (x) => x * x * (3 - 2 * x);
  switch (n.curve) {
    case 'exp':
      return n.f0 * Math.pow(n.f1 / n.f0, u);
    case 'arch':
    case 'dip': {
      const mid = n.peak || (n.curve === 'arch' ? Math.max(n.f0, n.f1) * 1.2 : Math.min(n.f0, n.f1) * 0.8);
      return u < 0.5 ? n.f0 + (mid - n.f0) * s(u * 2) : mid + (n.f1 - mid) * s(u * 2 - 1);
    }
    default:
      return n.f0 + (n.f1 - n.f0) * u;
  }
}

// =====================================================================
// Revêtement -> bruit des pneus
// =====================================================================

// Poids des couches de roulement (0..1) selon le revêtement sous la roue.
//   hiss : chuintement fin de l'asphalte ; rumble : grondement sourd ; crunch : gravier / herbe qui craque ;
//   wood : résonance creuse de la passerelle (avec claquement des planches) ; sand : sable qui chuinte mollement.
export const SURFACE_MIX = {
  asphalt: { hiss: 1, rumble: 0.7, crunch: 0, wood: 0, sand: 0 },
  grass: { hiss: 0.25, rumble: 0.5, crunch: 1, wood: 0, sand: 0 },
  boardwalk: { hiss: 0.35, rumble: 0.3, crunch: 0, wood: 1, sand: 0 },
  sand: { hiss: 0.15, rumble: 0.35, crunch: 0.25, wood: 0, sand: 1 },
};

export function surfaceMix(surface, offRoad = false) {
  if (offRoad) return SURFACE_MIX.grass;
  return SURFACE_MIX[surface] || SURFACE_MIX.asphalt;
}

// Paramètres continus du roulement à la vitesse v (m/s) : niveaux par couche et fréquences des filtres.
export function tyreParams(speed, surface, offRoad = false) {
  const v = Math.max(0, speed);
  const mix = surfaceMix(surface, offRoad);
  const k = Math.min(1, v / 14); // 50 km/h = plein niveau
  const level = k > 0 ? Math.pow(k, 0.8) : 0;
  return {
    hiss: mix.hiss * level * 0.55,
    rumble: mix.rumble * level * 0.6,
    crunch: mix.crunch * level * 0.9,
    wood: mix.wood * level * 0.8,
    sand: mix.sand * Math.pow(k, 0.6) * 0.75,
    hissFreq: 1400 + v * 170, // le chuintement monte avec la vitesse
    rumbleFreq: 90 + v * 9,
    crunchRate: 0.45 + Math.min(1.4, v / 9), // vitesse de lecture des craquements
    plankRate: surface === 'boardwalk' && !offRoad ? v / PLANK_SPACING : 0, // planches par seconde
  };
}

export const PLANK_SPACING = 1.1; // m entre deux lattes de la passerelle
export const WHEELBASE = 1.0; // m : la roue arrière passe la latte un instant après l'avant

// Roue libre : cliquets du moyeu (18 points d'engagement), roue de 2,1 m de circonférence.
export const freewheelRate = (speed) => (Math.max(0, speed) / 2.1) * 18;
export const isCoasting = (cadence, power, speed) => speed > 1.2 && (cadence < 12 || power < 8);

// Transmission : fréquence d'engrènement de la chaîne (plateau de 50 dents).
export const chainMeshRate = (cadence) => (Math.max(0, cadence) / 60) * 50;

// =====================================================================
// Course : compte à rebours, dépassements, souffle
// =====================================================================

// Renvoie 3, 2 ou 1 si le chrono de course vient de passer -3, -2 ou -1 s (bip du décompte), sinon 0.
export function countdownStep(prev, now) {
  for (const k of [3, 2, 1]) if (prev <= -k && now > -k) return k;
  return 0;
}

// Dépassement entre le joueur et un adversaire : gap = s(adversaire) - s(joueur).
// +1 : le joueur vient de passer devant ; -1 : il vient d'être doublé ; 0 sinon. Seulement de près.
export function passEvent(prevGap, gap, lateralGap = 0, near = 6) {
  if (!Number.isFinite(prevGap) || !Number.isFinite(gap)) return 0;
  if (Math.abs(lateralGap) > 4.5 || Math.abs(gap) > near || Math.abs(prevGap) > near) return 0;
  if (prevGap > 0 && gap <= 0) return 1;
  if (prevGap < 0 && gap >= 0) return -1;
  return 0;
}

// Souffle du cycliste : respirations par minute et niveau selon l'effort (puissance) et la pente.
export function breathing(power, grade = 0, ref = 250) {
  const effort = Math.max(0, power / ref) + Math.max(0, grade - 3) * 0.06;
  if (effort < 0.75) return { rate: 0, level: 0 };
  const k = Math.min(1, (effort - 0.75) / 0.7);
  return { rate: 22 + k * 22, level: 0.25 + k * 0.75 };
}

// =====================================================================
// Musique : intensité 0..3 (couches : 0 nappe et basse, 1 + arpège, 2 + maracas et grosse caisse, 3 tout).
// Effort normal (puissance de référence) : vers 1,8, musique posée ; la batterie entière demande un gros effort,
// le dernier tour, le turbo ou le sprint final.
// =====================================================================
export function musicIntensity({ state = 'race', time = 0, power = 0, speed = 0, turbo = false, finalLap = false, remaining = Infinity, ref = 250 } = {}) {
  if (state === 'home') return 1;
  if (state === 'end') return 1.5;
  if (time < 0) return 0.6; // compte à rebours : nappes seules, la tension monte
  let x = 0.8 + Math.min(1.2, (power / ref) * 0.85) + Math.min(0.3, speed / 40);
  if (finalLap) x = Math.max(x, 2.4);
  if (remaining < 300) x = Math.max(x, 2.8);
  if (turbo) x = 3;
  return Math.max(0, Math.min(3, x));
}

// =====================================================================
// Foule
// =====================================================================
// Excitation d'un groupe de spectateurs selon la distance (m) du coureur : ils s'animent quand il approche.
export function crowdExcitement(dist) {
  if (!Number.isFinite(dist)) return 0;
  if (dist <= 12) return 1;
  if (dist >= 90) return 0.2;
  return 0.2 + 0.8 * (1 - (dist - 12) / 78) ** 1.5;
}
