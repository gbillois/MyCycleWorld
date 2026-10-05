// Les circuits du jeu (données pures, testées dans tests/courses.test.js).
//   control  : points de passage du tracé (m), boucle fermée
//   profile  : pente (%) selon la fraction du tour ; les descentes sont ajustées pour que la boucle se referme
//   surfaces : revêtements particuliers [début, fin, type] (fractions du tour), le reste est en asphalte
//   theme    : décor (meadow = prairie, alpine = montagne, coast = bord de mer)

export const SURFACES = {
  asphalt: { label: 'Asphalte', crr: 0.004, gradeExtra: 0 },
  boardwalk: { label: 'Passerelle en bois', crr: 0.006, gradeExtra: 0.2 },
  // Le sable freine beaucoup : en jeu (résistance au roulement) et dans les jambes (pente équivalente au trainer).
  sand: { label: 'Sable', crr: 0.03, gradeExtra: 2.6 },
};

// Tracé décrit comme au volant, pour les routes de montagne pleines de lacets :
//   un nombre = ligne droite (m) ; [rayon (m), angle (°)] = virage, angle > 0 à droite, < 0 à gauche.
// heading : cap de départ en degrés dans le plan x/z (0 = vers +x, 90 = vers +z, 180 = vers -x).
// Renvoie les points de contrôle [x, z] (un tous les 40 m au plus, et tous les 20° dans les virages) ;
// le dernier point, qui retombe sur le départ, est omis puisque la boucle se referme d'elle-même.
export function road([x, z], heading, parts) {
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

export const COURSE_ORDER = ['vallee', 'col', 'plage'];

export function courseById(id) {
  return COURSES[id] || COURSES.vallee;
}

// Revêtement à une fraction u du tour (0..1).
export function surfaceAtFraction(course, u) {
  for (const [a, b, type] of course.surfaces || []) if (u >= a && u < b) return type;
  return 'asphalt';
}
