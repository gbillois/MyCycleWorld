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
    tagline: 'Grands cols, descentes rapides et village de chalets',
    theme: 'alpine',
    laps: 2,
    control: [
      [0, 0], [195, -26], [351, 39], [416, 195], [338, 312], [416, 442], [325, 585],
      [143, 611], [0, 520], [52, 377], [-65, 273], [-208, 338], [-325, 221], [-260, 65], [-130, -13],
    ],
    profile: [
      [0, 0], [0.05, 0], [0.09, 8], [0.28, 9], [0.33, 3], [0.37, 0], [0.47, 0],
      [0.5, 5], [0.6, 8], [0.62, 8], [0.65, 0], [0.67, -8], [0.92, -10], [0.97, -3], [1, 0],
    ],
    surfaces: [],
    features: { village: { from: 0.375, to: 0.465 }, cows: true },
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
