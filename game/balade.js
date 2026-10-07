// La Grande Balade : huit zones à vélo qui s'enchaînent comme les circuits d'un monde ouvert (données pures,
// testées dans tests/balade.test.js ; décor dans game/balade-scene.js).
//
// Chaque zone est un parcours ouvert (Track.open) d'environ 2 à 2,5 km : départ et arrivée distincts, sans
// adversaires ni objets, sur un chemin de terre. On peut rouler une zone seule ou faire le Grand Tour : à
// l'arrivée d'une zone, la suivante se charge et l'on repart lancé, chrono et distance cumulés.
// La carte du monde (worldMap) met les huit routes bout à bout : elle est tirée des tracés eux-mêmes.
//
// Une zone est un circuit comme les autres (COURSES), avec en plus :
//   ride     : balade sans adversaires ni boîtes à objets, sur un chemin de terre (baseSurface 'path')
//   open     : parcours ouvert ; lead = [avant, après] mètres de route dessinée de part et d'autre
//   heading  : cap de départ (degrés, 0 = +x, 90 = +z), comme road() dans courses.js
//   theme    : ambiance sonore et climat (meadow, alpine : ceux des circuits)
//   region   : décor (couleurs, relief, arbres, lumière : balade-scene.js, scenery.js)
//   places   : [fraction, nom] lieux annoncés en chemin
//   sights   : décors [type, fraction, côté (+1 droite, -1 gauche), distance à la route (m), options]
//   walls    : parois de part et d'autre [début, fin, hauteur (m), pied (m), haut (m)] (vallons, cols, gorges)
//   lake     : lac au bord de la route { u, side, dist, r }
//   tints    : tronçons au sol d'une autre couleur [début, fin, région] (marais, lande caillouteuse)
import { COURSES, road } from './courses.js';

export const LEAD = [70, 200];
export const TOUR_ID = 'grand-tour'; // meilleur temps du Grand Tour (les huit zones d'affilée)

const ZONE_DEFS = [
  {
    id: 'tour-collines',
    name: 'Les Collines Fleuries',
    tagline: 'Maisons nichées dans les collines, moulin, pont de pierre et village',
    region: 'collines',
    theme: 'meadow',
    heading: -150,
    path: [
      90, [140, 25], 140, [110, -50], 110, [160, 30], 170, [100, -35], 90, [120, 45], 160, [150, -25], 140,
      [110, -40], 120, [130, 50], 150, [100, -30], 130, [140, 20], 180,
    ],
    profile: [[0, 0], [0.06, 0], [0.1, 3], [0.18, 2], [0.22, -3], [0.3, -2], [0.36, 1], [0.44, 4], [0.5, 0], [0.56, -3], [0.64, 0], [0.72, 3], [0.8, 1], [0.86, -2], [0.92, 0], [1, 0]],
    surfaces: [],
    places: [[0, 'Bourg-des-Collines'], [0.35, 'Le Moulin'], [0.45, 'Pont-de-Pierre'], [0.55, 'Le Bac'], [0.86, 'Hautes-Haies']],
    sights: [
      ['hillhouse', 0.02, -1, 26], ['hillhouse', 0.05, 1, 30], ['hillhouse', 0.08, -1, 34], ['bighillhouse', 0.11, 1, 60],
      ['bigtree', 0.15, -1, 32], ['hillhouse', 0.2, 1, 28], ['hillhouse', 0.3, -1, 40], ['mill', 0.37, 1, 34],
      ['bridge', 0.45, 0, 0], ['ferry', 0.55, -1, 36], ['hillhouse', 0.65, 1, 32],
      ['villagegate', 0.86, 0, 0], ['timberhouse', 0.89, -1, 18], ['inn', 0.92, 1, 18], ['timberhouse', 0.95, -1, 20], ['timberhouse', 0.97, 1, 22],
    ],
    lake: { u: 0.37, side: 1, dist: 105, r: 55 },
  },
  {
    id: 'tour-foret',
    name: 'La Forêt d’Or',
    tagline: 'Bouleaux dorés, village de cabanes perchées, puis la vieille forêt',
    region: 'foretdor',
    theme: 'meadow',
    heading: -75,
    path: [
      100, [150, 35], 140, [120, -40], 160, [180, 25], 140, [110, -50], 120, [140, 40], 170, [120, -30], 110,
      [100, 45], 140, [150, -35], 130, [120, 25], 170,
    ],
    profile: [[0, 0], [0.04, 0], [0.08, -3], [0.16, -2], [0.24, 0], [0.32, 2], [0.4, 0], [0.5, 1], [0.6, -2], [0.7, 0], [0.78, 3], [0.86, 2], [0.94, 0], [1, 0]],
    surfaces: [],
    places: [[0, 'La Lisière'], [0.18, 'Le Bois Doré'], [0.42, 'Village des Cabanes'], [0.74, 'La Vieille Forêt']],
    sights: [
      ['goldforest', 0.15, 0, 0, { to: 0.62 }], ['treehouse', 0.4, 1, 20], ['treehouse', 0.44, -1, 24], ['treehouse', 0.48, 1, 26],
      ['woodarch', 0.18, 0, 0], ['oldforest', 0.74, 0, 0, { to: 1 }],
    ],
  },
  {
    id: 'tour-lac',
    name: 'Le Lac des Géants',
    tagline: 'Deux statues géantes gardent le lac, belvédère et grandes chutes',
    region: 'lac',
    theme: 'meadow',
    heading: 30,
    path: [
      120, [160, -25], 170, [140, 30], 160, [200, -20], 180, [130, 35], 140, [180, -30], 200, [160, 25], 180,
      [140, -20], 160, [120, 30], 160,
    ],
    profile: [[0, 0], [0.04, 0], [0.12, 2], [0.2, 0], [0.28, -2], [0.38, 0], [0.5, 1], [0.6, 0], [0.7, -1], [0.8, 0], [0.9, 2], [1, 0]],
    surfaces: [],
    places: [[0, 'Rive Verte'], [0.55, 'Les Géants'], [0.68, 'Lac Miroir'], [0.9, 'Les Grandes Chutes']],
    sights: [
      ['horses', 0.12, -1, 70], ['giants', 0.6, 1, 50], ['belvedere', 0.9, -1, 120], ['bigfalls', 0.94, 1, 150],
    ],
    lake: { u: 0.7, side: 1, dist: 180, r: 120 },
  },
  {
    id: 'tour-plaines',
    name: 'Les Plaines Dorées',
    tagline: 'Hautes herbes, château aux quatre tours, fort du défilé et halle sur la colline',
    region: 'plaines',
    theme: 'meadow',
    heading: 75,
    path: [
      120, [200, 25], 200, [160, -30], 180, [140, 35], 160, [220, -25], 200, [150, 40], 160, [180, -30], 140,
      [120, 35], 150, [60, -80], 70, [60, 80], 120,
    ],
    profile: [[0, 0], [0.04, 0], [0.1, 2], [0.18, 0], [0.26, -2], [0.34, 0], [0.42, 2], [0.5, 1], [0.58, -1], [0.66, 0], [0.74, 2], [0.82, 4], [0.9, 6], [0.97, 2], [1, 0]],
    surfaces: [],
    walls: [[0.3, 0.42, 30, 90, 200]],
    places: [[0, 'Château du Vent'], [0.36, 'Fort du Défilé'], [0.84, 'Haute-Halle']],
    sights: [
      ['castle', 0.13, -1, 280], ['horses', 0.22, 1, 70], ['canyonfort', 0.45, -1, 170], ['horses', 0.6, -1, 80],
      ['hillhall', 1.05, 1, 105], ['pennant', 0.8, -1, 8], ['pennant', 0.8, 1, 8],
    ],
  },
  {
    id: 'tour-landes',
    name: 'Les Landes et le Val Blanc',
    tagline: 'Tour brisée, pierres levées, gué, puis un vallon de villas et de cascades',
    region: 'landes',
    theme: 'meadow',
    heading: -165,
    path: [
      120, [180, -20], 160, [130, 40], 120, [150, -45], 140, [200, 25], 200, [120, -40], 100, [140, 50], 110,
      [110, -45], 150, [160, 30], 130, [90, -50], 80, [100, 40], 160,
    ],
    profile: [[0, 0], [0.05, 0], [0.1, 2], [0.2, 4], [0.27, 1], [0.32, -3], [0.4, -2], [0.46, 2], [0.56, 5], [0.62, 2], [0.68, -2], [0.74, -4], [0.8, 0], [0.84, 3], [0.9, -2], [0.96, -3], [1, 0]],
    surfaces: [[0.775, 0.79, 'creek']],
    walls: [[0.88, 1.05, 70, 55, 120]],
    places: [[0, 'La Lande'], [0.24, 'La Tour Brisée'], [0.52, 'Les Pierres Levées'], [0.78, 'Le Gué'], [0.9, 'Le Val Blanc']],
    sights: [
      ['ruinedtower', 0.31, -1, 200], ['standingstones', 0.53, 1, 22], ['ford', 0.782, 0, 0],
      ['villa', 0.9, 1, 30], ['villa', 0.92, -1, 34], ['villa', 0.945, 1, 38], ['villa', 0.965, -1, 30],
      ['bigvilla', 0.99, -1, 40], ['villa', 0.995, 1, 34], ['waterfall', 0.93, 1, 95], ['waterfall', 0.975, -1, 90],
    ],
  },
  {
    id: 'tour-marais',
    name: 'Marais et Ruines',
    tagline: 'Rochers gris, marais aux lucioles, grande muraille et arches en ruine',
    region: 'vertbois',
    theme: 'meadow',
    heading: -105,
    path: [
      110, [150, -30], 150, [130, 40], 160, [170, -25], 150, [120, 45], 130, [160, -35], 170, [140, 30], 140,
      [110, -40], 150, [150, 35], 130, [130, -25], 170,
    ],
    profile: [[0, 0], [0.05, 0], [0.1, 2], [0.14, -2], [0.2, 0], [0.4, 0], [0.48, 2], [0.56, 0], [0.64, -2], [0.72, 0], [0.8, 2], [0.88, -1], [1, 0]],
    surfaces: [[0.2, 0.38, 'boardwalk']],
    walls: [[-0.05, 0.15, 26, 20, 70]],
    tints: [[0.15, 0.44, 'marsh'], [0.44, 0.58, 'ash']],
    places: [[0, 'Les Rochers Gris'], [0.2, 'Marais aux Lucioles'], [0.5, 'La Grande Muraille'], [0.62, 'Le Bois Vert'], [0.88, 'Les Arches']],
    sights: [
      ['crags', 0.04, 0, 0, { to: 0.14 }], ['marsh', 0.2, 0, 0, { to: 0.38 }], ['greatwall', 0.58, 1, 240],
      ['ruins', 0.9, 0, 0], ['rockcastle', 1, -1, 1500],
    ],
  },
  {
    id: 'tour-neiges',
    name: 'Le Col des Neiges',
    tagline: 'Houx et sapins, lacets sous le Pic Blanc, jusqu’à la vieille mine',
    region: 'neiges',
    theme: 'alpine',
    heading: -120,
    path: [
      110, [160, -30], 140, [120, 45], 120, [150, -25], 160, [110, 35], 130, [30, 170], 40, [30, -170], 60,
      [32, 175], 50, [120, -40], 130, [140, 30], 120, [100, -45], 160, [130, 20], 140,
    ],
    profile: [[0, 0], [0.05, 0], [0.1, 3], [0.22, 4], [0.3, 2], [0.36, 5], [0.42, 7], [0.58, 7], [0.62, 3], [0.7, 4], [0.8, 2], [0.88, 0], [0.92, -2], [1, 0]],
    surfaces: [],
    walls: [[0.36, 0.62, 55, 45, 130], [0.82, 1.06, 80, 60, 160]],
    places: [[0, 'Le Bois de Houx'], [0.2, 'Les Vieux Piliers'], [0.45, 'Lacets du Col'], [0.9, 'La Vieille Mine']],
    sights: [
      ['holly', 0.16, -1, 14], ['holly', 0.2, 1, 14], ['ruin', 0.28, 1, 40], ['peak', 0.5, 1, 1300],
      ['minegate', 1, 0, 0], ['lakeserpent', 0.93, 0, 0],
    ],
    lake: { u: 0.93, side: -1, dist: 90, r: 50 },
  },
  {
    id: 'tour-feu',
    name: 'Les Terres de Feu',
    tagline: 'Vallée des cendres, lacets de basalte, fumerolles et volcan en éruption',
    region: 'feu',
    theme: 'alpine',
    heading: -15,
    path: [
      110, [140, 30], 120, [30, -170], 50, [30, 175], 50, [30, -175], 60, [120, 30], 140, [160, -25], 200,
      [140, 30], 180, [150, -20], 160, [34, 170], 70, [34, -170], 60, [34, 165], 80,
    ],
    profile: [[0, 0], [0.04, 0], [0.08, 4], [0.14, 8], [0.26, 8], [0.3, 3], [0.34, 0], [0.4, -3], [0.46, -1], [0.56, 0], [0.66, 1], [0.72, 3], [0.78, 7], [0.95, 8], [1, 0]],
    surfaces: [],
    walls: [[0.06, 0.36, 65, 40, 110]],
    places: [[0, 'Vallée des Cendres'], [0.12, 'Lacets de Basalte'], [0.4, 'Champ de Fumerolles'], [0.74, 'Pied du Volcan']],
    sights: [
      ['spires', 0.05, 0, 0, { to: 0.4 }], ['fumaroles', 0.42, 0, 0, { to: 0.7 }], ['volcano', 1, 0, 0],
    ],
  },
];

// Circuit (au sens de COURSES) d'une zone : prolongements, tracé ouvert.
function zoneCourse(def, index) {
  return {
    ...def,
    index,
    ride: true,
    open: true,
    baseSurface: 'path',
    lead: LEAD,
    laps: 1,
    control: road([0, 0], def.heading, [LEAD[0], ...def.path, LEAD[1]], { open: true }),
  };
}

export const STAGES = ZONE_DEFS.map(zoneCourse);
export const STAGE_ORDER = STAGES.map((s) => s.id);
for (const s of STAGES) COURSES[s.id] = s; // les zones se chargent comme des circuits (courseById)

export const isStage = (id) => STAGE_ORDER.includes(id);
export const stageById = (id) => STAGES.find((s) => s.id === id) || null;
export const nextStage = (id) => STAGES[STAGE_ORDER.indexOf(id) + 1] || null;

// Lieu annoncé à la fraction u de la zone (le dernier passé), ou null avant le premier.
export function placeAt(stage, u) {
  let name = null;
  for (const [at, n] of stage.places) if (u >= at) name = n;
  return name;
}

// Région au sol à la fraction u (teinte d'un tronçon, sinon la région de la zone).
export function regionAt(stage, u) {
  for (const [a, b, region] of stage.tints || []) if (u >= a && u < b) return region;
  return stage.region;
}

// Polyligne d'un tracé de contrôle sans ses prolongements : points [x, z] tous les ~20 m.
function drivePolyline(control) {
  const dense = [];
  let s = 0;
  for (let i = 0; i < control.length - 1; i++) {
    const [x0, z0] = control[i];
    const [x1, z1] = control[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const k = Math.max(1, Math.ceil(len / 20));
    for (let j = 0; j < k; j++) dense.push([x0 + ((x1 - x0) * j) / k, z0 + ((z1 - z0) * j) / k, s + (len * j) / k]);
    s += len;
  }
  dense.push([...control[control.length - 1], s]);
  return dense.filter(([, , d]) => d >= LEAD[0] && d <= s - LEAD[1]).map(([x, z]) => [x, z]);
}

// Carte du monde : les huit routes mises bout à bout (chaque zone part de l'arrivée de la précédente).
// Renvoie [{ id, points: [[x, z], ...] }] en mètres, dans l'ordre des zones.
export function worldMap() {
  let ox = 0;
  let oz = 0;
  return STAGES.map((s) => {
    const pts = drivePolyline(s.control);
    const [sx, sz] = pts[0];
    const moved = pts.map(([x, z]) => [x - sx + ox, z - sz + oz]);
    [ox, oz] = moved[moved.length - 1];
    return { id: s.id, points: moved };
  });
}

// Progression enregistrée (meilleur temps par zone, et du Grand Tour) : { [id]: secondes }.
export const PROGRESS_KEY = 'mycycleworld.balade';
export function readProgress(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(PROGRESS_KEY) || '{}');
    const out = {};
    for (const id of [...STAGE_ORDER, TOUR_ID]) if (Number.isFinite(raw[id]) && raw[id] > 0) out[id] = raw[id];
    return out;
  } catch {
    return {};
  }
}
export function recordStage(storage, id, seconds) {
  const p = readProgress(storage);
  const best = !p[id] || seconds < p[id];
  if (best) p[id] = Math.round(seconds * 10) / 10;
  try {
    storage?.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* stockage indisponible */
  }
  return { progress: p, best };
}
