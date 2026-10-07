// Les circuits du jeu (données pures, testées dans tests/courses.test.js).
//   control  : points de passage du tracé (m), boucle fermée
//   profile  : pente (%) selon la fraction du tour ; les descentes sont ajustées pour que la boucle se referme
//   surfaces : revêtements particuliers [début, fin, type] (fractions du tour), le reste est en asphalte
//              (ou baseSurface s'il est donné : la terre d'un sentier de VTT)
//   theme    : décor (meadow = prairie, alpine = montagne, coast = bord de mer, forest = forêt, VTT)
//   roadHalf : demi-largeur de la route (m, 4 par défaut ; un sentier de VTT est bien plus étroit)
//   mtb      : règles du VTT (src/core/mtb.js) : sauts [fraction de la lèvre, hauteur (m), longueur de rampe (m)]

export const SURFACES = {
  asphalt: { label: 'Asphalte', crr: 0.004, gradeExtra: 0 },
  // Chemin de terre bien tassé (Grande Balade) : à peine plus lent que l'asphalte.
  path: { label: 'Chemin de terre', crr: 0.005, gradeExtra: 0 },
  boardwalk: { label: 'Passerelle en bois', crr: 0.006, gradeExtra: 0.2 },
  // Le sable freine beaucoup : en jeu (résistance au roulement) et dans les jambes (pente équivalente au trainer).
  sand: { label: 'Sable', crr: 0.03, gradeExtra: 2.6 },
  // Sentier de VTT : terre tassée, racines, pierrier, gravier, boue et gué dans le ruisseau.
  dirt: { label: 'Terre', crr: 0.009, gradeExtra: 0.4 },
  roots: { label: 'Racines', crr: 0.014, gradeExtra: 1 },
  rock: { label: 'Pierrier', crr: 0.022, gradeExtra: 1.8 },
  gravel: { label: 'Gravier', crr: 0.012, gradeExtra: 0.8 },
  mud: { label: 'Boue', crr: 0.032, gradeExtra: 2.8 },
  creek: { label: 'Ruisseau', crr: 0.038, gradeExtra: 3 },
};

// Tracé décrit comme au volant, pour les routes de montagne pleines de lacets :
//   un nombre = ligne droite (m) ; [rayon (m), angle (°)] = virage, angle > 0 à droite, < 0 à gauche.
// heading : cap de départ en degrés dans le plan x/z (0 = vers +x, 90 = vers +z, 180 = vers -x).
// Renvoie les points de contrôle [x, z] (un tous les 40 m au plus, et tous les 20° dans les virages) ;
// le dernier point, qui retombe sur le départ, est omis puisque la boucle se referme d'elle-même
// (sauf pour un parcours ouvert, { open: true } : le point d'arrivée est gardé).
export function road([x, z], heading, parts, { open = false } = {}) {
  let a = (heading * Math.PI) / 180;
  const pts = [];
  for (const part of parts) {
    if (typeof part === 'number') {
      const k = Math.max(1, Math.ceil(part / 40));
      for (let i = 0; i < k; i++) {
        pts.push([x, z]);
        x += (Math.cos(a) * part) / k;
        z += (Math.sin(a) * part) / k;
      }
    } else {
      const [r, deg] = part;
      const da = (deg * Math.PI) / 180;
      const k = Math.max(1, Math.ceil(Math.max(Math.abs(deg) / 20, (r * Math.abs(da)) / 40)));
      const chord = 2 * r * Math.sin(Math.abs(da / k) / 2);
      for (let i = 0; i < k; i++) {
        pts.push([x, z]);
        a += da / k / 2;
        x += Math.cos(a) * chord;
        z += Math.sin(a) * chord;
        a += da / k / 2;
      }
    }
  }
  if (open) pts.push([x, z]);
  return pts.map(([px, pz]) => [Math.round(px * 10) / 10, Math.round(pz * 10) / 10]);
}

export const COURSES = {
  vallee: {
    id: 'vallee',
    name: 'Vallée Verte',
    tagline: 'Prairies, lac, village et ferme avec ses animaux',
    theme: 'meadow',
    laps: 3,
    control: [
      [0, 0], [130, -30], [250, 10], [320, 120], [290, 240], [180, 290],
      [60, 250], [-30, 310], [-170, 290], [-250, 180], [-220, 60], [-120, 10],
    ],
    profile: [
      [0, 0], [0.14, 0], [0.2, 7], [0.38, 7], [0.42, 1.5], [0.48, 0],
      [0.52, -6], [0.7, -6], [0.75, -1], [0.8, 0], [0.86, 2], [0.9, 2], [0.94, 0], [1, 0],
    ],
    surfaces: [],
    features: { lake: true, cottages: true, farm: { from: 0.78, to: 0.86 } },
  },
  col: {
    id: 'col',
    name: 'Col des Chalets',
    tagline: 'Lacets en épingle, descente sinueuse et village de chalets',
    theme: 'alpine',
    laps: 2,
    // Un vrai col alpin (environ 3,1 km) : épingles empilées à flanc de pente, route qui serpente entre elles.
    control: road([0, 0], 180, [
      // Départ, puis 1re montée : 5 épingles (rayon 24 à 26 m), rampes en S entre elles
      120, [25, 180],
      18, [38, -30], [38, 60], [38, -30], 6, [24, -180],
      6, [38, 30], [38, -60], [38, 30], 20, [26, 180],
      14, [38, -30], [38, 60], [38, -30], 14, [24, -180],
      20, [38, 30], [38, -60], [38, 30], 6, [25, 180],
      // Arrivée sur le plateau, longue traversée du village de chalets
      20, [45, -40], 30, [45, 40], 300,
      // 2e montée : virage en U au-dessus du village, épingle, lacets jusqu'au sommet
      [28, -90], 35, [28, -90], 20, [38, -30], [38, 60], [38, -30], 20, [23, 180],
      60, [30, -60], 20, [30, 60], 64,
      // Descente : S serrés, 5 épingles en cascade, puis la route serpente jusqu'à l'arrivée
      [30, 90], 30, [35, -50], 20, [35, 50], [30, -90],
      30, [24, 180], 50, [23, -180], 34, [25, 180], 52, [24, -180], 38, [24, 180],
      30, [50, -25], [50, 50], [50, -25], 38.6, [50, 25], [50, -50], [50, 25], 40,
      [45, -45], 70.5, [45, 45], 60,
    ]),
    profile: [
      [0, 0], [0.035, 0], [0.07, 8], [0.25, 9], [0.29, 3], [0.32, 0], [0.43, 0],
      [0.455, 6], [0.52, 9], [0.555, 9], [0.575, 0], [0.595, -8], [0.8, -10], [0.86, -4], [0.95, -2], [1, 0],
    ],
    surfaces: [],
    features: { village: { from: 0.335, to: 0.418 }, cows: true },
  },
  plage: {
    id: 'plage',
    name: 'Côte des Dunes',
    tagline: 'Passerelle vers la plage et pédalage dans le sable',
    theme: 'coast',
    laps: 3,
    control: [
      [0, 0], [140, -10], [260, 40], [320, 150], [300, 250], [200, 298],
      [60, 302], [-80, 300], [-200, 282], [-262, 190], [-222, 80], [-120, 20],
    ],
    profile: [
      [0, 0], [0.1, 0], [0.16, -3], [0.24, -5], [0.34, -5], [0.38, 0], [0.62, 0],
      [0.66, 4], [0.8, 6], [0.86, 3], [0.9, 0], [1, 0],
    ],
    surfaces: [
      [0.3, 0.385, 'boardwalk'],
      [0.385, 0.6, 'sand'],
      [0.6, 0.64, 'boardwalk'],
    ],
    features: { coast: { z: 326 } },
  },
};

// Forêt des Crêtes : sentier de VTT tracé « au volant » (voir road()), quatre rangées reliées par des épingles,
// remontée en lacets serrés sur le côté gauche, environ 1,6 km.
COURSES.foret = {
  id: 'foret',
  name: 'Forêt des Crêtes',
  tagline: 'Sentier de VTT : virages serrés, sauts, racines, pierrier et gué',
  theme: 'forest',
  laps: 3,
  roadHalf: 2,
  baseSurface: 'dirt',
  control: road([0, 0], 0, [
    // Départ, montée en S
    45, [14, 40], 16, [14, -80], 16, [14, 40], 30, [11, -55], 12, [11, 55], 35,
    // Épingle de la crête, puis descente : virages relevés et sauts sur les droites
    [10, 90], 24, [10, 90], 35, [12, -60], 15, [12, 60], 42, [11, 60], 12, [11, -60], 25, [12, -50], 12, [12, 50], 40,
    // Épingle à gauche, fond du vallon : gué dans le ruisseau puis pierrier
    [10, -90], 24, [10, -90], 20, [10, -45], 10, [10, 45], 15, [12, 50], 15, [12, -50], 45, [12, -50], 15, [12, 50], 25,
    [11, 55], 12, [11, -55], 32,
    // Épingle à droite : boue, passerelle en bois (North Shore), gravier
    [10, 90], 24, [10, 90], 40, [12, -45], 15, [12, 90], 15, [12, -45], 45, [12, 45], 15, [12, -45], 25, [11, -50], 12,
    [11, 50], 35,
    // Remontée en lacets serrés, dernier saut et arrivée
    [12, 90], 20, [8, -90], 40, [8, 180], 40, [8, -180], 40, [8, 90], 33.2, [12, 90], 25, [12, -40], 14, [12, 40], 44,
  ]),
  profile: [
    [0, 0], [0.03, 0], [0.06, 7], [0.12, 9], [0.14, 2], [0.17, 0], [0.19, -9], [0.33, -10.5], [0.36, -5], [0.39, -8],
    [0.42, -5], [0.435, 0], [0.46, 0], [0.48, 2], [0.52, 4], [0.56, 3], [0.62, 2], [0.64, 0], [0.68, 0], [0.7, 5],
    [0.76, 4], [0.79, 9], [0.92, 9], [0.93, -6], [0.955, -8], [0.97, 0], [1, 0],
  ],
  surfaces: [
    [0.07, 0.1, 'roots'],
    [0.438, 0.456, 'creek'],
    [0.478, 0.506, 'rock'],
    [0.578, 0.6, 'mud'],
    [0.648, 0.672, 'boardwalk'],
    [0.79, 0.81, 'roots'],
    [0.87, 0.895, 'gravel'],
  ],
  mtb: {
    // [fraction de la lèvre, hauteur (m), longueur de la rampe (m)]
    jumps: [[0.188, 0.8, 5], [0.238, 0.9, 5.5], [0.323, 1, 6], [0.744, 0.75, 5], [0.947, 0.85, 5]],
  },
  features: { creek: { from: 0.438, to: 0.456 }, bridge: { from: 0.648, to: 0.672 } },
};

export const COURSE_ORDER = ['vallee', 'col', 'plage', 'foret'];

export function courseById(id) {
  return COURSES[id] || COURSES.vallee;
}

// Revêtement à une fraction u du tour (0..1).
export function surfaceAtFraction(course, u) {
  for (const [a, b, type] of course.surfaces || []) if (u >= a && u < b) return type;
  return course.baseSurface || 'asphalt';
}
