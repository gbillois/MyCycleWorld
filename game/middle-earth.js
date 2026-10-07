// Balade en Terre du Milieu : huit étapes à vélo, de la Comté à la Montagne du Destin (données pures, testées
// dans tests/middle-earth.test.js ; décor dans game/middle-earth-scene.js).
//
// L'itinéraire suit, dans l'ordre et dans la bonne direction, la route du film « Journey Through Middle-Earth »
// du projet map-of-middle-earth (https://github.com/earthwalker17/map-of-middle-earth, data/tour/route.json et
// data/world/places.json : positions des lieux en km de la grille ME-GIS, x vers l'est, y vers le nord).
// Ces coordonnées sont reprises ci-dessous (JOURNEY, PLACES) sous la licence MIT de ce projet :
//   MIT License, Copyright (c) 2026 earthwalker17. Permission is hereby granted, free of charge, to any person
//   obtaining a copy of this software and associated documentation files (the "Software"), to deal in the
//   Software without restriction, including without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions: The above copyright notice and this permission
//   notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED
//   "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
// Le relief réel (ME-DEM, ME-GIS) n'est pas utilisé : ses auteurs demandent qu'on les consulte avant toute
// réutilisation. Le terrain des étapes est généré par le jeu, région par région.
//
// Chaque étape est un parcours ouvert (Track.open) de 2,5 à 3,5 km : la distance réelle (environ 1 700 km) est
// très compressée, la route serpente, et le cap de départ suit la direction réelle de l'étape sur la carte.
// Une étape est un circuit comme les autres (COURSES), avec en plus :
//   ride     : balade sans adversaires ni boîtes à objets, sur un chemin de terre (baseSurface 'path')
//   open     : parcours ouvert ; lead = [avant, après] mètres de route dessinée de part et d'autre
//   theme    : ambiance sonore et climat (meadow, alpine, coast : ceux des circuits)
//   region   : décor de la Terre du Milieu (couleurs, relief, arbres, lumière : middle-earth-scene.js)
//   places   : [fraction, nom] lieux annoncés en chemin
//   sights   : monuments [type, fraction, côté (+1 droite, -1 gauche), distance à la route (m), options]
//   lake     : lac au bord de la route { u, side, dist, r } (Nen Hithoel, Kheled-zâram)
//   tints    : tronçons au sol d'une autre couleur [début, fin, région] (marais au milieu de l'Ithilien)
import { COURSES, road } from './courses.js';

export const LEAD = [70, 200];

// Lieux de l'itinéraire : nom français, position (km ME-GIS) et étape.
export const PLACES = {
  hobbiton: { name: 'Hobbitebourg', km: [518.2, 1045.2] },
  'bucklebury-ferry': { name: 'Bac de Fertébouc', km: [570, 1043] },
  bree: { name: 'Bree', km: [598.3, 1045.2] },
  weathertop: { name: 'Montauvent', km: [673.2, 1049.1] },
  trollshaws: { name: 'Bois aux Trolls', km: [820, 1060] },
  'ford-of-bruinen': { name: 'Gué de la Bruinen', km: [866, 1047] },
  rivendell: { name: 'Fondcombe', km: [881.1, 1054.4] },
  caradhras: { name: 'Caradhras', km: [872, 934] },
  moria: { name: 'Porte de la Moria', km: [847.3, 921] },
  'dimrill-dale': { name: 'Ruisselombre', km: [887.5, 929.5] },
  lothlorien: { name: 'Lothlórien', km: [969.3, 921.8] },
  fangorn: { name: 'Fangorn', km: [878.3, 836.5] },
  isengard: { name: 'Isengard', km: [806, 812.5] },
  'helms-deep': { name: 'Gouffre de Helm', km: [805.4, 748.1] },
  edoras: { name: 'Edoras', km: [863.7, 723.4] },
  argonath: { name: 'Argonath', km: [1080.5, 764.5] },
  rauros: { name: 'Chutes de Rauros', km: [1074.6, 744.5] },
  'dead-marshes': { name: 'Marais des Morts', km: [1142.7, 753.8] },
  'black-gate': { name: 'Porte Noire', km: [1181.5, 723.2] },
  'henneth-annun': { name: 'Henneth Annûn', km: [1140.3, 678.9] },
  osgiliath: { name: 'Osgiliath', km: [1138.6, 629.5] },
  'minas-tirith': { name: 'Minas Tirith', km: [1120.7, 618.9] },
  'minas-morgul': { name: 'Minas Morgul', km: [1169.7, 637.4] },
  'cirith-ungol': { name: 'Cirith Ungol', km: [1186.5, 640.5] },
  'mount-doom': { name: 'Montagne du Destin', km: [1240.1, 663.4] },
  'barad-dur': { name: 'Barad-dûr', km: [1253.3, 671.2] },
};

// Itinéraire complet (km ME-GIS), de Hobbitebourg au cratère de la Montagne du Destin (route.json, legs à plat ;
// la boucle de Fondcombe et le détour par le Rohan y sont).
export const JOURNEY = [
  [518.2, 1045.2], [540, 1043], [570, 1043], [585, 1045], [598.3, 1045.2], [640, 1050], [673.2, 1049.1],
  [760, 1046], [820, 1060], [848, 1062], [868, 1059], [876.5, 1055], [880.5, 1054.4], [876.5, 1053.6],
  [873.5, 1049.5], [866, 1047], [863.5, 1036], [866, 1020], [847, 990], [820, 966], [800, 951], [814, 930],
  [836, 914], [847.3, 921], [868, 925], [887.5, 929.5], [930, 925], [969.3, 921.8], [935, 885], [878.3, 836.5],
  [850, 815], [823, 804], [806, 803.5], [808.5, 790], [808.5, 775], [805.6, 766], [804.8, 758], [806.1, 752.3],
  [809.6, 754.8], [813.2, 759.5], [820, 765], [839, 759], [856, 745], [863.7, 723.4], [930, 758], [1000, 786],
  [1050, 800], [1083, 803], [1080.5, 764.5], [1074.6, 744.5], [1080, 742.5], [1086, 739], [1098, 738.5],
  [1122, 748], [1142.7, 753.8], [1164, 741], [1171, 739.5], [1181.5, 723.2], [1166, 723], [1151, 716],
  [1139, 701], [1137.3, 678.9], [1138.6, 629.5], [1150, 640], [1169.7, 637.4], [1186.5, 640.5], [1208, 645],
  [1233, 642], [1248.5, 650], [1256.5, 654.5], [1241.7, 661.1],
];

// Cap (degrés, plan x/z du jeu : 0 = est, 90 = sud) d'un lieu à un autre sur la carte (y nord = -z).
export function bearing(from, to) {
  const [x0, y0] = PLACES[from].km;
  const [x1, y1] = PLACES[to].km;
  return Math.round((Math.atan2(-(y1 - y0), x1 - x0) * 180) / Math.PI);
}

// Étapes. path : tracé « au volant » (voir road() dans courses.js), sans les prolongements (LEAD).
const STAGE_DEFS = [
  {
    id: 'me-comte',
    name: 'La Comté',
    tagline: 'De Hobbitebourg à Bree : collines, smials et haies',
    region: 'shire',
    theme: 'meadow',
    from: 'hobbiton',
    to: 'bree',
    path: [
      90, [140, 25], 140, [110, -50], 110, [160, 30], 170, [100, -35], 90, [120, 45], 160, [150, -25], 140,
      [110, -40], 120, [130, 50], 150, [100, -30], 130, [140, 20], 180,
    ],
    profile: [[0, 0], [0.06, 0], [0.1, 3], [0.18, 2], [0.22, -3], [0.3, -2], [0.36, 1], [0.44, 4], [0.5, 0], [0.56, -3], [0.64, 0], [0.72, 3], [0.8, 1], [0.86, -2], [0.92, 0], [1, 0]],
    surfaces: [],
    places: [[0, 'Hobbitebourg'], [0.45, 'Pont du Brandevin'], [0.55, 'Bac de Fertébouc'], [0.86, 'Bree']],
    sights: [
      ['smial', 0.02, -1, 26], ['smial', 0.05, 1, 30], ['smial', 0.08, -1, 34], ['bagend', 0.11, 1, 60],
      ['partytree', 0.15, -1, 32], ['smial', 0.2, 1, 28], ['smial', 0.3, -1, 40], ['mill', 0.37, 1, 34],
      ['bridge', 0.45, 0, 0], ['ferry', 0.55, -1, 36], ['smial', 0.65, 1, 32],
      ['breegate', 0.86, 0, 0], ['breehouse', 0.89, -1, 18], ['pony', 0.92, 1, 18], ['breehouse', 0.95, -1, 20], ['breehouse', 0.97, 1, 22],
    ],
    lake: { u: 0.37, side: 1, dist: 105, r: 55 },
  },
  {
    id: 'me-route-est',
    name: 'La Route de l’Est',
    tagline: 'Bree, Montauvent, les trolls de pierre puis Fondcombe',
    region: 'wilds',
    theme: 'meadow',
    from: 'bree',
    to: 'rivendell',
    path: [
      120, [180, -20], 160, [130, 40], 120, [150, -45], 140, [200, 25], 200, [120, -40], 100, [140, 50], 110,
      [110, -45], 150, [160, 30], 130, [90, -50], 80, [100, 40], 160,
    ],
    profile: [[0, 0], [0.05, 0], [0.1, 2], [0.2, 4], [0.27, 1], [0.32, -3], [0.4, -2], [0.46, 2], [0.56, 5], [0.62, 2], [0.68, -2], [0.74, -4], [0.8, 0], [0.84, 3], [0.9, -2], [0.96, -3], [1, 0]],
    surfaces: [[0.775, 0.79, 'creek']],
    places: [[0, 'Bree'], [0.24, 'Montauvent'], [0.52, 'Bois aux Trolls'], [0.78, 'Gué de la Bruinen'], [0.9, 'Fondcombe']],
    sights: [
      ['weathertop', 0.31, -1, 200], ['trolls', 0.53, 1, 16], ['ford', 0.782, 0, 0],
      ['elfhouse', 0.9, 1, 30], ['elfhouse', 0.92, -1, 34], ['elfhouse', 0.945, 1, 38], ['elfhouse', 0.965, -1, 30],
      ['elfhall', 0.99, -1, 40], ['elfhouse', 0.995, 1, 34], ['waterfall', 0.93, 1, 95], ['waterfall', 0.975, -1, 90],
    ],
  },
  {
    id: 'me-moria',
    name: 'Les Monts Brumeux',
    tagline: 'Par la Houssaye jusqu’à la Porte de la Moria, sous le Caradhras',
    region: 'misty',
    theme: 'alpine',
    from: 'rivendell',
    to: 'moria',
    path: [
      110, [160, -30], 140, [120, 45], 120, [150, -25], 160, [110, 35], 130, [30, 170], 40, [30, -170], 60,
      [32, 175], 50, [120, -40], 130, [140, 30], 120, [100, -45], 160, [130, 20], 140,
    ],
    profile: [[0, 0], [0.05, 0], [0.1, 3], [0.22, 4], [0.3, 2], [0.36, 5], [0.42, 7], [0.58, 7], [0.62, 3], [0.7, 4], [0.8, 2], [0.88, 0], [0.92, -2], [1, 0]],
    surfaces: [],
    places: [[0, 'Fondcombe'], [0.2, 'Houssaye'], [0.45, 'Col du Caradhras'], [0.9, 'Porte de la Moria']],
    sights: [
      ['holly', 0.16, -1, 14], ['holly', 0.2, 1, 14], ['ruin', 0.28, 1, 40], ['caradhras', 0.5, 1, 1300],
      ['moriagate', 1, 0, 0],
    ],
    lake: { u: 0.93, side: -1, dist: 90, r: 50 },
  },
  {
    id: 'me-lorien',
    name: 'La Lórien',
    tagline: 'Sous les mallorns dorés, puis l’ombre de Fangorn',
    region: 'lorien',
    theme: 'meadow',
    from: 'dimrill-dale',
    to: 'fangorn',
    path: [
      100, [150, 35], 140, [120, -40], 160, [180, 25], 140, [110, -50], 120, [140, 40], 170, [120, -30], 110,
      [100, 45], 140, [150, -35], 130, [120, 25], 170,
    ],
    profile: [[0, 0], [0.04, 0], [0.08, -3], [0.16, -2], [0.24, 0], [0.32, 2], [0.4, 0], [0.5, 1], [0.6, -2], [0.7, 0], [0.78, 3], [0.86, 2], [0.94, 0], [1, 0]],
    surfaces: [],
    places: [[0, 'Ruisselombre'], [0.18, 'Lothlórien'], [0.42, 'Caras Galadhon'], [0.74, 'Fangorn']],
    sights: [
      ['mallorns', 0.15, 0, 0, { to: 0.62 }], ['flet', 0.4, 1, 20], ['flet', 0.44, -1, 24], ['flet', 0.48, 1, 26],
      ['elfgate', 0.18, 0, 0], ['fangorn', 0.74, 0, 0, { to: 1 }], ['ent', 0.86, -1, 22],
    ],
  },
  {
    id: 'me-rohan',
    name: 'Le Rohan',
    tagline: 'Les plaines dorées d’Isengard au Gouffre de Helm et à Edoras',
    region: 'rohan',
    theme: 'meadow',
    from: 'isengard',
    to: 'edoras',
    path: [
      120, [200, 25], 200, [160, -30], 180, [140, 35], 160, [220, -25], 200, [150, 40], 160, [180, -30], 140,
      [120, 35], 150, [60, -80], 70, [60, 80], 120,
    ],
    profile: [[0, 0], [0.04, 0], [0.1, 2], [0.18, 0], [0.26, -2], [0.34, 0], [0.42, 2], [0.5, 1], [0.58, -1], [0.66, 0], [0.74, 2], [0.82, 4], [0.9, 6], [0.97, 2], [1, 0]],
    surfaces: [],
    places: [[0, 'Isengard'], [0.36, 'Gouffre de Helm'], [0.84, 'Edoras']],
    sights: [
      ['orthanc', 0.13, -1, 280], ['horses', 0.22, 1, 70], ['helmsdeep', 0.45, -1, 170], ['horses', 0.6, -1, 80],
      ['edoras', 1.05, 1, 105], ['banner', 0.8, -1, 8], ['banner', 0.8, 1, 8],
    ],
  },
  {
    id: 'me-anduin',
    name: 'L’Anduin',
    tagline: 'Le long du Nen Hithoel, entre les rois de l’Argonath, jusqu’à Rauros',
    region: 'anduin',
    theme: 'coast',
    from: 'edoras',
    to: 'rauros',
    path: [
      120, [160, -25], 170, [140, 30], 160, [200, -20], 180, [130, 35], 140, [180, -30], 200, [160, 25], 180,
      [140, -20], 160, [120, 30], 160,
    ],
    profile: [[0, 0], [0.04, 0], [0.12, 2], [0.2, 0], [0.28, -2], [0.38, 0], [0.5, 1], [0.6, 0], [0.7, -1], [0.8, 0], [0.9, 2], [1, 0]],
    surfaces: [],
    places: [[0, 'Edoras'], [0.3, 'L’Anduin'], [0.55, 'Argonath'], [0.68, 'Nen Hithoel'], [0.9, 'Chutes de Rauros']],
    sights: [
      ['horses', 0.12, -1, 70], ['argonath', 0.6, 1, 50], ['amonhen', 0.9, -1, 120], ['rauros', 0.94, 1, 150],
    ],
    lake: { u: 0.7, side: 1, dist: 180, r: 120 },
  },
  {
    id: 'me-marais',
    name: 'Des Marais à l’Ithilien',
    tagline: 'Les Marais des Morts, la Porte Noire, l’Ithilien jusqu’à Osgiliath',
    region: 'ithilien',
    theme: 'meadow',
    from: 'rauros',
    to: 'osgiliath',
    path: [
      110, [150, -30], 150, [130, 40], 160, [170, -25], 150, [120, 45], 130, [160, -35], 170, [140, 30], 140,
      [110, -40], 150, [150, 35], 130, [130, -25], 170,
    ],
    profile: [[0, 0], [0.05, 0], [0.1, 2], [0.14, -2], [0.2, 0], [0.4, 0], [0.48, 2], [0.56, 0], [0.64, -2], [0.72, 0], [0.8, 2], [0.88, -1], [1, 0]],
    surfaces: [[0.2, 0.38, 'boardwalk']],
    tints: [[0.15, 0.44, 'marsh'], [0.44, 0.58, 'ash']],
    places: [[0, 'Emyn Muil'], [0.2, 'Marais des Morts'], [0.5, 'Porte Noire'], [0.62, 'Ithilien'], [0.88, 'Osgiliath']],
    sights: [
      ['crags', 0.04, 0, 0, { to: 0.14 }], ['marsh', 0.2, 0, 0, { to: 0.38 }], ['blackgate', 0.58, 1, 240],
      ['ithilien', 0.6, 0, 0, { to: 0.86 }], ['osgiliath', 0.9, 0, 0], ['minastirith', 1, -1, 1500],
    ],
  },
  {
    id: 'me-mordor',
    name: 'Le Mordor',
    tagline: 'Minas Morgul, l’escalier de Cirith Ungol et la Montagne du Destin',
    region: 'mordor',
    theme: 'alpine',
    from: 'minas-morgul',
    to: 'mount-doom',
    path: [
      110, [140, 30], 120, [30, -170], 50, [30, 175], 50, [30, -175], 60, [120, 30], 140, [160, -25], 200,
      [140, 30], 180, [150, -20], 160, [34, 170], 70, [34, -170], 60, [34, 165], 80,
    ],
    profile: [[0, 0], [0.04, 0], [0.08, 4], [0.14, 8], [0.26, 8], [0.3, 3], [0.34, 0], [0.4, -3], [0.46, -1], [0.56, 0], [0.66, 1], [0.72, 3], [0.78, 7], [0.95, 8], [1, 0]],
    surfaces: [],
    places: [[0, 'Minas Morgul'], [0.12, 'Escalier de Cirith Ungol'], [0.4, 'Gorgoroth'], [0.74, 'Montagne du Destin'], [0.99, 'Sammath Naur']],
    sights: [
      ['morgul', 0.09, -1, 170], ['cirithungol', 0.35, 1, 55], ['orcpits', 0.42, 0, 0, { to: 0.7 }],
      ['mountdoom', 1, 0, 0], ['baraddur', 0.6, -1, 1400], ['sammath', 1, 0, 0],
    ],
  },
];

// Cours (au sens de COURSES) d'une étape : prolongements, cap réel, tracé ouvert.
function stageCourse(def, index) {
  const heading = bearing(def.from, def.to);
  return {
    ...def,
    index,
    ride: true,
    open: true,
    baseSurface: 'path',
    lead: LEAD,
    laps: 1,
    heading,
    control: road([0, 0], heading, [LEAD[0], ...def.path, LEAD[1]], { open: true }),
  };
}

export const STAGES = STAGE_DEFS.map(stageCourse);
export const STAGE_ORDER = STAGES.map((s) => s.id);
for (const s of STAGES) COURSES[s.id] = s; // les étapes se chargent comme des circuits (courseById)

export const isStage = (id) => STAGE_ORDER.includes(id);
export const stageById = (id) => STAGES.find((s) => s.id === id) || null;
export const nextStage = (id) => STAGES[STAGE_ORDER.indexOf(id) + 1] || null;

// Lieu annoncé à la fraction u de l'étape (le dernier passé), ou null avant le premier.
export function placeAt(stage, u) {
  let name = null;
  for (const [at, n] of stage.places) if (u >= at) name = n;
  return name;
}

// Région au sol à la fraction u (teinte d'un tronçon, sinon la région de l'étape).
export function regionAt(stage, u) {
  for (const [a, b, region] of stage.tints || []) if (u >= a && u < b) return region;
  return stage.region;
}

// Progression enregistrée (meilleur temps par étape) : { [id]: secondes }.
export const PROGRESS_KEY = 'mycycleworld.middle-earth';
export function readProgress(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(PROGRESS_KEY) || '{}');
    const out = {};
    for (const id of STAGE_ORDER) if (Number.isFinite(raw[id]) && raw[id] > 0) out[id] = raw[id];
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
