// Profil d'altitude d'un circuit (module pur, testable sans Three.js).
// À partir de clés [fraction du tour, pente %], interpolées en douceur, on calcule la pente et l'altitude
// de chaque mètre. Les descentes sont mises à l'échelle pour que la boucle revienne à la même altitude.

const smooth = (t) => t * t * (3 - 2 * t);

export function profileGrade(profile, u) {
  for (let i = 1; i < profile.length; i++) {
    const [u1, g1] = profile[i];
    if (u <= u1) {
      const [u0, g0] = profile[i - 1];
      return g0 + (g1 - g0) * smooth((u - u0) / (u1 - u0 || 1));
    }
  }
  return 0;
}

// n échantillons de longueur step (m). Renvoie { grade, y } de taille n + 1 (le dernier = le premier).
export function buildProfile(profile, n, step) {
  const raw = Array.from({ length: n }, (_, i) => profileGrade(profile, i / n));
  const up = raw.reduce((a, g) => a + Math.max(0, g), 0);
  const down = raw.reduce((a, g) => a - Math.min(0, g), 0);
  const k = down > 0 ? up / down : 1;
  const grade = new Float32Array(n + 1);
  const y = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) grade[i] = raw[i] > 0 ? raw[i] : raw[i] * k;
  grade[n] = grade[0];
  let h = 0;
  for (let i = 0; i < n; i++) {
    y[i] = h;
    h += (grade[i] / 100) * step;
  }
  y[n] = y[0];
  return { grade, y, closure: h };
}

// Parcours ouvert (n échantillons de longueur step) : pentes telles quelles, sans retour à l'altitude de départ.
// fractionOf(i) donne la fraction du parcours de l'échantillon i (bornée à 0 et 1 sur les prolongements).
export function buildOpenProfile(profile, n, step, fractionOf = (i) => i / n) {
  const grade = new Float32Array(n + 1);
  const y = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) grade[i] = profileGrade(profile, fractionOf(i));
  for (let i = 0; i < n; i++) y[i + 1] = y[i] + ((grade[i] + grade[i + 1]) / 200) * step;
  return { grade, y };
}

// Dénivelé positif total (m) d'un profil construit.
export function elevationGain(grade, step) {
  let gain = 0;
  for (let i = 0; i < grade.length - 1; i++) gain += Math.max(0, grade[i]) / 100 * step;
  return gain;
}
