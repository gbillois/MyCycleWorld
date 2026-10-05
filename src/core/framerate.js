// Régulation de la fluidité (module pur, testé dans tests/framerate.test.js) :
//  - plafond d'images par seconde (60 par défaut : inutile de calculer 120 images/s sur un iPad ProMotion),
//  - résolution de rendu adaptative : on baisse la définition quand les images tardent, on la remonte quand
//    il reste de la marge, pour garder au moins ~50 images/s sans jamais descendre sous 40.

export const FRAME = {
  target: 60, // images/s visées (plafond)
  slowFps: 50, // en dessous : on baisse la résolution
  fastFps: 57, // au-dessus : on peut la remonter
  window: 1500, // ms d'observation entre deux décisions
  down: 0.85,
  up: 1.07,
};

// Faut-il dessiner cette image ? (tolérance de 2 ms pour ne pas sauter d'images à 60 Hz)
export function frameDue(now, last, target = FRAME.target) {
  return now - last >= 1000 / target - 2;
}

// Nouvelle échelle de résolution d'après la durée moyenne d'une image (ms).
export function nextScale(scale, avgMs, { min = 0.55, max = 1 } = {}) {
  const fps = 1000 / avgMs;
  if (fps < FRAME.slowFps) return Math.max(min, scale * FRAME.down);
  if (fps > FRAME.fastFps && scale < max) return Math.min(max, scale * FRAME.up);
  return scale;
}

export class FrameGovernor {
  constructor({ target = FRAME.target, min = 0.55, max = 1, onScale = () => {} } = {}) {
    Object.assign(this, { target, min, max, onScale });
    this.scale = max;
    this.last = -Infinity;
    this.sum = 0;
    this.count = 0;
    this.windowStart = null;
    this.fps = 0;
  }

  // À appeler au début de chaque requestAnimationFrame : false = on saute cette image.
  allow(now) {
    if (!frameDue(now, this.last, this.target)) return false;
    if (this.last > 0) this.sample(now - this.last, now);
    this.last = now;
    return true;
  }

  sample(dtMs, now) {
    if (dtMs > 250) return; // onglet en arrière-plan, chargement : on ignore
    this.windowStart ??= now;
    this.sum += dtMs;
    this.count++;
    if (now - this.windowStart < FRAME.window) return;
    const avg = this.sum / this.count;
    this.fps = 1000 / avg;
    const next = nextScale(this.scale, avg, { min: this.min, max: this.max });
    this.sum = 0;
    this.count = 0;
    this.windowStart = now;
    if (Math.abs(next - this.scale) > 0.01) {
      this.scale = next;
      this.onScale(next);
    }
  }
}
