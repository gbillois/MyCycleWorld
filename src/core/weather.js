// Météo d'une course (module pur, testé dans tests/weather.test.js, aucune dépendance au navigateur).
//
// Au départ, une graine tire le temps du jour selon le climat du décor : force et direction du vent,
// rafales, averses qui commencent puis s'arrêtent. Pendant la course, weatherAt(plan, t) donne la pluie,
// la couverture nuageuse et le vent à l'instant t (sans rien allouer). Le vent ressenti par le coureur est
// sa composante le long de la route (tangente du tracé) : il change donc le long d'une boucle, de dos dans
// une portion (il aide), de face dans l'autre (il freine). La route mouille vite sous la pluie et sèche
// lentement ensuite.
//
// Conventions : vitesses en m/s, temps en secondes de course, direction du vent = sens vers lequel il
// souffle, angle a dans le plan XZ : vecteur (sin a, cos a). Vent arrière (tailwind) > 0 : il pousse.

import { DEFAULTS } from './physics.js';

export const WEATHER_MODES = ['random', 'fair', 'rain', 'wind', 'off'];
export const WEATHER_LABELS = { random: 'Aléatoire', fair: 'Toujours beau', rain: 'Pluie', wind: 'Vent', off: 'Désactivée' };
export const weatherMode = (v) => (WEATHER_MODES.includes(v) ? v : 'random');

// Petit générateur pseudo-aléatoire déterministe (même graine = même météo).
export function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Climat de chaque décor.
//   rain   : probabilité qu'il pleuve pendant la course (mode aléatoire)
//   wind   : force habituelle du vent [min, max] (m/s) ; calm : probabilité d'un jour sans vent
//   gust   : force des rafales (0 = vent régulier, 1 = très irrégulier)
//   dir    : direction imposée (rad) ou null (au hasard) ; spread : écart autour de cette direction
//   veer   : le vent tourne lentement de ± veer (rad) pendant la course
export const CLIMATES = {
  // Prairie : surtout beau, petit vent, rare averse.
  meadow: { rain: 0.15, wind: [0.8, 4], calm: 0.3, gust: 0.3, dir: null, spread: 0, veer: 0.25, cloud: 0.1, forecast: 'plutôt beau, vent faible, averse rare' },
  // Montagne : plus de vent, en rafales, et des averses fréquentes.
  alpine: { rain: 0.4, wind: [2.5, 7.5], calm: 0.08, gust: 0.55, dir: null, spread: 0, veer: 0.35, cloud: 0.25, forecast: 'averses fréquentes, vent en rafales' },
  // Bord de mer : brise de mer régulière, de la mer (au sud, z > 0) vers la terre.
  coast: { rain: 0.15, wind: [4, 6.5], calm: 0, gust: 0.15, dir: Math.PI, spread: 0.35, veer: 0.12, cloud: 0.1, forecast: 'brise de mer régulière, rarement de la pluie' },
  // Bassin d'aviron : lac abrité, vent faible à modéré, pas de pluie.
  lake: { rain: 0, wind: [0.5, 4], calm: 0.3, gust: 0.25, dir: null, spread: 0, veer: 0.2, cloud: 0.1, forecast: 'vent faible à modéré' },
  river: { rain: 0.2, wind: [0.5, 3], calm: 0.4, gust: 0.3, dir: null, spread: 0, veer: 0.2, cloud: 0.15, forecast: 'vent faible' },
};
export const climateOf = (theme) => CLIMATES[theme] || CLIMATES.meadow;

// Effets de la route mouillée : un peu plus de résistance au roulement, moins d'adhérence dans les virages.
export const WET = Object.freeze({
  crr: 0.12, // +12 % de résistance au roulement sur route trempée (eau à chasser)
  lean: 0.2, // −20 % d'inclinaison possible (moins d'adhérence)
  roll: 0.35, // +35 % de temps de réponse de l'inclinaison (on tourne plus prudemment)
  radius: 0.3, // +30 % de rayon de braquage minimal
  rise: 18, // s : la route se mouille (constante de temps)
  dry: 140, // s : elle sèche lentement après la pluie
});

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Averse : montée (ramp), plateau, fin (fade) ; intensité maximale peak (0..1).
function shower(r, t0, minDur, maxDur, minPeak) {
  const dur = minDur + r() * (maxDur - minDur);
  return { t0, t1: t0 + dur, ramp: 18 + r() * 22, fade: 25 + r() * 35, peak: minPeak + r() * (1 - minPeak) };
}

/**
 * Tire la météo d'une course. Renvoie null en mode « Désactivée » (aucun effet, comportement d'origine).
 * mode : random | fair | rain | wind | off ; theme : meadow | alpine | coast | lake | river.
 */
export function rollWeather({ theme = 'meadow', mode = 'random', seed = 1 } = {}) {
  mode = weatherMode(mode);
  if (mode === 'off') return null;
  const c = climateOf(theme);
  const r = seededRandom(seed);
  // Vent : force, direction et caractère (tirés dans cet ordre, toujours, pour rester reproductible).
  const strength = r();
  const calmRoll = r();
  const dirRoll = r();
  const gustRoll = r();
  const phases = [r(), r(), r(), r(), r()].map((x) => x * Math.PI * 2);
  let speed = c.wind[0] + strength * (c.wind[1] - c.wind[0]);
  if (calmRoll < c.calm) speed *= 0.25;
  let gust = c.gust * (0.7 + gustRoll * 0.6);
  const dir = c.dir === null ? dirRoll * Math.PI * 2 : c.dir + (dirRoll * 2 - 1) * c.spread;
  let cloud = c.cloud * r();
  const showers = [];
  const rainRoll = r();
  if (mode === 'fair') {
    speed = Math.min(speed, c.wind[0] + strength * 1.2); // beau temps : petite brise
    gust *= 0.6;
    cloud *= 0.5;
  } else if (mode === 'wind') {
    speed = 6.5 + strength * 3; // vent fort (23 à 34 km/h)
    gust = Math.max(gust, 0.4);
    cloud = 0.2 + cloud;
  } else if (mode === 'rain') {
    // Il pleut dès le départ (route déjà mouillée), puis l'averse s'arrête et une autre revient.
    const a = shower(r, -90, 150, 300, 0.6);
    showers.push(a);
    showers.push(shower(r, a.t1 + a.fade + 30 + r() * 60, 150, 320, 0.5));
  } else if (rainRoll < c.rain) {
    // Aléatoire : une averse (parfois déjà là au départ), parfois une seconde plus tard.
    const already = r() < 0.3;
    const a = shower(r, already ? -60 : 25 + r() * 240, 80, 300, 0.35);
    showers.push(a);
    if (r() < 0.35) showers.push(shower(r, a.t1 + a.fade + 60 + r() * 140, 60, 200, 0.3));
  }
  return { mode, theme, seed, speed, dir, gust, veer: c.veer, cloud, phases, showers };
}

// Pluie (0..1) et couverture nuageuse (0..1) à l'instant t. Les nuages arrivent avant l'averse et
// repartent après.
export function rainAt(plan, t) {
  if (!plan) return 0;
  let rain = 0;
  for (const s of plan.showers) {
    if (t < s.t0 || t > s.t1 + s.fade) continue;
    const k = smooth(s.t0, s.t0 + s.ramp, t) * (1 - smooth(s.t1, s.t1 + s.fade, t));
    // L'intensité vit un peu (grosses gouttes puis bruine).
    const live = 0.82 + 0.18 * Math.sin(t * 0.13 + plan.phases[4] + s.t0);
    rain = Math.max(rain, s.peak * k * live);
  }
  return clamp(rain, 0, 1);
}

export function cloudAt(plan, t) {
  if (!plan) return 0;
  let cloud = plan.cloud;
  for (const s of plan.showers) {
    const k = smooth(s.t0 - 45, s.t0 + s.ramp, t) * (1 - smooth(s.t1, s.t1 + s.fade + 60, t));
    cloud = Math.max(cloud, k * (0.65 + 0.35 * s.peak));
  }
  return clamp(cloud, 0, 1);
}

// Rafales : multiplicateur de la force du vent (≈ 0,5 à 1,9), irrégulier et lent, avec de vraies rafales
// de temps en temps.
export function gustAt(plan, t) {
  const p = plan.phases;
  const slow = 0.45 * Math.sin(t * 0.13 + p[0]) + 0.3 * Math.sin(t * 0.37 + p[1]);
  const pulse = Math.pow(Math.max(0, Math.sin(t * 0.071 + p[2])), 6) * 1.6;
  return Math.max(0.15, 1 + plan.gust * (slow * 0.8 + pulse));
}

/**
 * État de la météo à l'instant t, écrit dans out (aucune allocation) :
 * { rain, cloud, speed (m/s), dirX, dirZ (vecteur unitaire du sens du vent), gust (multiplicateur) }.
 */
export function weatherAt(plan, t, out = {}) {
  if (!plan) {
    out.rain = 0;
    out.cloud = 0;
    out.speed = 0;
    out.dirX = 0;
    out.dirZ = 1;
    out.gust = 1;
    return out;
  }
  out.rain = rainAt(plan, t);
  out.cloud = cloudAt(plan, t);
  out.gust = gustAt(plan, t);
  // Les grains d'averse amènent du vent.
  out.speed = plan.speed * out.gust * (1 + 0.35 * out.rain);
  const a = plan.dir + plan.veer * Math.sin(t * 0.011 + plan.phases[3]);
  out.dirX = Math.sin(a);
  out.dirZ = Math.cos(a);
  return out;
}

// Composante du vent le long de la route (m/s) : > 0 vent de dos, < 0 vent de face.
// (tx, tz) : tangente unitaire de la route dans le sens de la course.
export function tailwind(speed, dirX, dirZ, tx, tz) {
  return speed * (dirX * tx + dirZ * tz);
}

// Composante de travers (m/s, signe : + = de gauche à droite pour le coureur). Pour l'affichage.
export function crosswind(speed, dirX, dirZ, tx, tz) {
  return speed * (dirX * tz - dirZ * tx);
}

// Route mouillée : monte vers l'intensité de la pluie (un peu au-delà : flaques), redescend lentement.
export function stepWetness(wet, rain, dt) {
  const target = clamp(rain * 1.25, 0, 1);
  const tau = target > wet ? WET.rise : WET.dry;
  return wet + (target - wet) * (1 - Math.exp(-Math.max(0, dt) / tau));
}

// Multiplicateur de la résistance au roulement sur route mouillée.
export const wetCrrFactor = (wet) => 1 + WET.crr * clamp(wet, 0, 1);

// Réglages de direction (voir src/core/steering.js) avec moins d'adhérence : écrit dans out (réutilisé).
export function wetSteer(wet, base, out = {}) {
  const w = clamp(wet, 0, 1);
  Object.assign(out, base);
  out.maxLean = base.maxLean * (1 - WET.lean * w);
  out.driftLean = base.driftLean * (1 - WET.lean * w);
  out.rollTime = base.rollTime * (1 + WET.roll * w);
  out.minRadius = base.minRadius * (1 + WET.radius * w);
  return out;
}

// Pente équivalente (%) au vent : surcroît (ou allègement) de traînée ramené au poids, à la vitesse v.
//   ΔF = ½·ρ·CdA·((v − w)·|v − w| − v²) ; pente = ΔF / (m·g) × 100
// Sert au trainer quand il ne reçoit que la pente (elliptique, rameur, appli iOS) et à la pente ressentie.
export function windGrade(v, tail, params = {}) {
  const { mass, cda, rho, g } = { ...DEFAULTS, ...params };
  const speed = Math.max(0, v || 0);
  const va = speed - (tail || 0);
  const dF = 0.5 * rho * cda * (va * Math.abs(va) - speed * speed);
  return clamp((dF / (mass * g)) * 100, -8, 12);
}

// Champ « vitesse du vent » de la commande FTMS Set Indoor Bike Simulation : positif = vent de face.
// Le trainer calcule alors lui-même la traînée avec (v + vent) ; borné à ± 32 m/s (entier signé 16 bits, 0,001).
export const ftmsWindSpeed = (tail) => Math.round(clamp(-(tail || 0), -32, 32) * 1000) / 1000 + 0; // + 0 : jamais « −0 »

// Vent d'un bateau (aviron) : effet doux, la traînée de l'air ne pèse qu'une petite part de la résistance.
// Multiplicateur de la vitesse visée : ± 1,2 % par m/s, borné à ± 10 %.
export const boatWindFactor = (tail) => clamp(1 + 0.012 * (tail || 0), 0.9, 1.1);

// Libellé du vent pour le coureur : { kind: head | tail | cross | calm, kmh, text }.
export function describeWind(tail, speed) {
  const kmh = Math.round(Math.max(0, speed) * 3.6);
  if (speed < 1) return { kind: 'calm', kmh, text: 'Vent calme' };
  if (Math.abs(tail) < speed * 0.38) return { kind: 'cross', kmh, text: `Vent de côté ${kmh} km/h` };
  return tail < 0 ? { kind: 'head', kmh, text: `Vent de face ${kmh} km/h` } : { kind: 'tail', kmh, text: `Vent de dos ${kmh} km/h` };
}

// Pictogramme du ciel selon la pluie et les nuages.
export function skyIcon(rain, cloud) {
  if (rain > 0.6) return '🌧️';
  if (rain > 0.08) return '🌦️';
  if (cloud > 0.55) return '☁️';
  if (cloud > 0.25) return '⛅';
  return '☀️';
}

// Prévision affichée dans l'aperçu du niveau (avant le tirage).
export function forecast(theme, mode) {
  mode = weatherMode(mode);
  if (mode === 'off') return 'désactivée';
  if (mode === 'fair') return 'toujours beau, brise légère';
  if (mode === 'rain') return 'pluie, route glissante';
  if (mode === 'wind') return 'vent fort en rafales';
  return climateOf(theme).forecast;
}
