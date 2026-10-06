// Hasard reproductible et horloges d'événements (module pur, testé dans tests/audio.test.js).
// Les sons d'ambiance ne doivent jamais boucler de façon audible : délais, positions et paramètres tirés au sort.

// Générateur pseudo-aléatoire rapide (mulberry32), même graine = même suite.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Graine numérique à partir d'un texte (FNV-1a) : 'meadow' donne toujours la même musique.
export function hashSeed(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const range = (r, a, b) => a + (b - a) * r();
export const irange = (r, a, b) => Math.floor(a + (b - a + 1) * r());
export const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
export const chance = (r, p) => r() < p;
// Tirage log-uniforme (fréquences, distances) : autant de chances par octave.
export const logRange = (r, a, b) => a * Math.pow(b / a, r());

// Choix pondéré : [[valeur, poids], ...]
export function weighted(r, entries) {
  let total = 0;
  for (const [, w] of entries) total += w;
  let x = r() * total;
  for (const [v, w] of entries) {
    x -= w;
    if (x <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

// Délai avant le prochain événement : loi exponentielle (processus de Poisson) bornée,
// pour des rencontres naturelles (deux oiseaux peuvent chanter presque ensemble, puis plus rien).
export function nextDelay(r, mean, min = mean * 0.25, max = mean * 3) {
  const x = -Math.log(1 - Math.min(0.999999, r())) * mean;
  return Math.max(min, Math.min(max, x));
}

// Horloge d'un type d'événement : appeler tick(dt) à chaque image, renvoie le nombre d'événements à jouer.
export class EventClock {
  constructor(r, mean, { min, max, first } = {}) {
    this.r = r;
    this.mean = mean;
    this.min = min ?? mean * 0.25;
    this.max = max ?? mean * 3;
    this.left = first ?? nextDelay(r, mean, this.min, this.max) * 0.6;
  }
  tick(dt, rate = 1) {
    if (rate <= 0) return 0;
    this.left -= dt * rate;
    let n = 0;
    while (this.left <= 0 && n < 4) {
      n++;
      this.left += nextDelay(this.r, this.mean, this.min, this.max);
    }
    return n;
  }
}

// Marche aléatoire lissée entre deux bornes (rafales de vent, houle) : nouvelle cible à intervalles irréguliers.
export class Wander {
  constructor(r, lo, hi, { every = [1.5, 5], start } = {}) {
    this.r = r;
    this.lo = lo;
    this.hi = hi;
    this.every = every;
    this.value = start ?? range(r, lo, hi);
    this.target = this.value;
    this.left = 0;
  }
  // Renvoie une nouvelle cible quand il est temps d'en changer (sinon null), et la durée prévue.
  tick(dt) {
    this.left -= dt;
    if (this.left > 0) return null;
    this.left = range(this.r, this.every[0], this.every[1]);
    // Les grands écarts sont rares : moyenne de deux tirages.
    this.target = this.lo + (this.hi - this.lo) * (this.r() * 0.5 + this.r() * 0.5);
    return { target: this.target, time: this.left };
  }
}
