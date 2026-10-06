// Physique du vélo, pure et testable (aucune dépendance au navigateur).
//
// Équation du mouvement le long de la route :
//   m · dv/dt = P / v − (m·g·Crr·cos θ + m·g·sin θ + ½·ρ·CdA·va·|va|)
// avec θ = atan(pente / 100) et va = v − vent arrière (vitesse de l'air par rapport au coureur ; sans vent,
// va = v). Les vitesses sont en m/s, les puissances en W, les pentes en %.

export const DEFAULTS = Object.freeze({
  mass: 83, // kg, cycliste + vélo
  crr: 0.004, // résistance au roulement (route)
  cda: 0.32, // m², surface frontale × coefficient de traînée
  rho: 1.225, // kg/m³, densité de l'air
  g: 9.81,
});

// En dessous de cette vitesse, la force de propulsion P / v est plafonnée (sinon elle tend vers l'infini).
export const MIN_SPEED = 1;
// Pas d'intégration maximal (s) : on découpe les grands dt pour rester stable.
export const MAX_STEP = 0.02;

// Aspiration : réduction de CdA derrière un autre coureur.
export const DRAFT = Object.freeze({
  reduction: 0.3, // −30 % de CdA dans la zone pleine
  minGap: 0.3, // m : trop près (ou à côté), pas d'effet
  fullGap: 3, // m : aspiration maximale jusqu'à cette distance
  maxGap: 4.5, // m : plus rien au-delà
  fullLateral: 0.6, // m : même ligne
  maxLateral: 1.2, // m : décalage au-delà duquel on ne profite plus de l'abri
});

export function gradeToAngle(gradePercent) {
  return Math.atan(gradePercent / 100);
}

// Somme des forces qui s'opposent à l'avancement (N). Négative en descente raide.
// params.tailwind (m/s) : vent le long de la route, > 0 de dos (il pousse), < 0 de face (voir src/core/weather.js).
// L'aspiration (cda réduit) s'applique aussi à la vitesse relative de l'air.
export function resistiveForce(v, gradePercent, params = {}) {
  const { mass, crr, cda, rho, g, tailwind = 0 } = { ...DEFAULTS, ...params };
  const theta = gradeToAngle(gradePercent);
  const va = v - tailwind;
  return mass * g * crr * Math.cos(theta) + mass * g * Math.sin(theta) + 0.5 * rho * cda * va * Math.abs(va);
}

// Force de propulsion (N) fournie par le cycliste.
export function propulsiveForce(power, v) {
  if (!(power > 0)) return 0;
  return power / Math.max(v, MIN_SPEED);
}

// Accélération (m/s²) à la vitesse v.
export function acceleration(v, power, gradePercent, params = {}) {
  const mass = params.mass ?? DEFAULTS.mass;
  return (propulsiveForce(power, v) - resistiveForce(v, gradePercent, params)) / mass;
}

// Fait avancer la vitesse de dt secondes (Euler semi-implicite par sous-pas). Jamais négative :
// à l'arrêt en montée sans pédaler, on reste immobile (pas de marche arrière).
export function stepSpeed(v, power, gradePercent, dt, params = {}) {
  if (!(dt > 0)) return v;
  const n = Math.max(1, Math.ceil(dt / MAX_STEP));
  const h = dt / n;
  let speed = Math.max(0, v || 0);
  for (let i = 0; i < n; i++) {
    speed += acceleration(speed, power, gradePercent, params) * h;
    if (speed < 0) speed = 0;
  }
  return speed;
}

// Vitesse d'équilibre (m/s) pour une puissance et une pente données (recherche par dichotomie).
// La fonction P / v − F(v) est strictement décroissante, donc la racine est unique.
export function steadySpeed(power, gradePercent, params = {}) {
  const f = (v) => propulsiveForce(power, v) - resistiveForce(v, gradePercent, params);
  let lo = 0.001;
  let hi = 60;
  if (f(lo) <= 0) return 0;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Multiplicateur de CdA dû à l'aspiration derrière UN coureur.
// gap : distance (m) entre moi et le coureur devant (positive s'il est devant).
// lateral : écart latéral (m) entre nos deux lignes.
export function draftFactor(gap, lateral) {
  const d = DRAFT;
  const lat = Math.abs(lateral);
  if (!(gap > d.minGap) || gap >= d.maxGap || lat >= d.maxLateral) return 1;
  const along = gap <= d.fullGap ? 1 : 1 - (gap - d.fullGap) / (d.maxGap - d.fullGap);
  const side = lat <= d.fullLateral ? 1 : 1 - (lat - d.fullLateral) / (d.maxLateral - d.fullLateral);
  return 1 - d.reduction * along * side;
}

// Meilleure aspiration parmi plusieurs coureurs : leaders = [{ gap, lateral }].
export function bestDraftFactor(leaders) {
  let best = 1;
  for (const l of leaders) best = Math.min(best, draftFactor(l.gap, l.lateral));
  return best;
}

export const msToKmh = (v) => v * 3.6;
