// Les rivières du mode kayak (données pures, utilisées par src/core/kayak.js et testées dans tests/kayak.test.js).
//   heading  : cap de départ en degrés dans le plan x/z (0 = vers +x, 90 = vers +z), comme road() dans courses.js
//   path     : tracé décrit comme au volant : un nombre = ligne droite (m), [rayon (m), angle (°)] = virage
//              (angle > 0 à droite). Les virages sont adoucis (courbure lissée) avant l'intégration.
//   lead     : mètres de rivière avant le départ et après l'arrivée (le décor continue au-delà)
//   widths   : largeur (m) selon la fraction de la rivière [u, largeur], interpolée en douceur
//   sections : courant par tronçon [début, fin, type] (fractions de la rivière) : calm = bassin calme,
//              flow = courant régulier, rapid = rapide (le courant pousse, l'eau est blanche)
//   gorge    : tronçons encaissés entre deux falaises [début, fin] (fractions de la rivière)
//   gates    : portes [u, décalage] (u = fraction de la course, décalage = fraction de la demi-largeur, + = à droite)
//              ou ['sprint', u] pour une porte sprint (toute la largeur de la rivière), ['glide', u] pour une
//              porte glisse (passerelle basse : arrêter de ramer pour passer dessous)
//   gateGap  : demi-écart entre les deux fiches d'une porte (m)
//   boxes    : rangées de boîtes à objets (fractions de la course)
//   rocks    : nombre de rochers au milieu des rapides (placés au hasard, mais toujours au même endroit)
//   theme    : ambiance (gorge = vallée verte et falaises claires, torrent = montagne)

export const RIVERS = {
  gorges: {
    id: 'gorges',
    name: 'Rivière des Gorges',
    tagline: 'Méandres tranquilles, un passage encaissé et deux petits rapides',
    level: 'Débutant',
    difficulty: 2,
    theme: 'gorge',
    heading: 0,
    lead: 80,
    path: [
      110, [120, 35], 90, [90, -60], 70, [140, 40], 60, [75, -80], 50, [100, 70], 110,
      [85, -45], 60, [110, 50], 90, [80, -70], 80, [130, 30], 120,
    ],
    widths: [[0, 30], [0.18, 26], [0.24, 21], [0.3, 22], [0.42, 19], [0.52, 27], [0.6, 26], [0.66, 20], [0.74, 24], [0.88, 28], [1, 30]],
    sections: [[0, 0.11, 'calm'], [0.11, 0.21, 'flow'], [0.21, 0.29, 'rapid'], [0.29, 0.5, 'flow'], [0.5, 0.6, 'calm'], [0.6, 0.69, 'rapid'], [0.69, 0.86, 'flow'], [0.86, 1, 'calm']],
    gorge: [[0.3, 0.52]],
    gateGap: 2.2,
    gates: [
      [0.05, -0.25], [0.1, 0.3], [0.15, -0.3], ['sprint', 0.24], [0.3, 0.3], [0.35, -0.35], [0.41, 0.25],
      ['glide', 0.44], [0.48, -0.3], [0.53, 0.35], ['sprint', 0.6], [0.66, -0.3], [0.72, 0.3], [0.78, -0.35], [0.85, 0.3], [0.92, -0.2],
    ],
    boxes: [0.08, 0.27, 0.38, 0.63, 0.81],
    rocks: 6,
  },
  torrent: {
    id: 'torrent',
    name: 'Rapides du Torrent',
    tagline: 'Torrent de montagne : virages serrés, rochers et longs rapides',
    level: 'Confirmé',
    difficulty: 4,
    theme: 'torrent',
    heading: 0,
    lead: 80,
    path: [
      100, [60, -50], 60, [55, 75], 50, [70, -60], 90, [50, -70], 45, [60, 90], 80, [90, -40], 60,
      [48, -85], 50, [62, 70], 100, [55, 60], 50, [80, -75], 70, [50, 80], 60, [100, -30], 130,
    ],
    widths: [[0, 24], [0.12, 20], [0.2, 15], [0.28, 17], [0.36, 22], [0.44, 16], [0.52, 14], [0.6, 19], [0.7, 15], [0.8, 17], [0.9, 21], [1, 24]],
    sections: [
      [0, 0.09, 'calm'], [0.09, 0.16, 'flow'], [0.16, 0.27, 'rapid'], [0.27, 0.34, 'flow'], [0.34, 0.4, 'calm'],
      [0.4, 0.55, 'rapid'], [0.55, 0.63, 'flow'], [0.63, 0.75, 'rapid'], [0.75, 0.86, 'flow'], [0.86, 1, 'calm'],
    ],
    gorge: [[0.14, 0.3], [0.42, 0.58], [0.66, 0.76]],
    gateGap: 1.8,
    gates: [
      [0.04, 0.3], [0.08, -0.35], [0.12, 0.35], [0.17, -0.3], ['sprint', 0.22], [0.27, 0.35], [0.3, -0.4], ['glide', 0.335],
      [0.37, 0.3], [0.41, -0.35], [0.45, 0.4], ['sprint', 0.5], [0.55, -0.35], [0.59, 0.35], [0.64, -0.3],
      [0.68, 0.35], ['sprint', 0.73], [0.78, -0.35], [0.82, 0.3], [0.87, -0.3], [0.93, 0.25],
    ],
    boxes: [0.06, 0.2, 0.32, 0.48, 0.62, 0.76, 0.9],
    rocks: 14,
  },
};

export const RIVER_ORDER = ['gorges', 'torrent'];

export function riverById(id) {
  return RIVERS[id] || RIVERS.gorges;
}
