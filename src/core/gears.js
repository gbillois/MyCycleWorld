// Vitesses virtuelles pour un home trainer FTMS "classique" (sans virtual shifting natif).
//
// Principe (même idée que qdomyos-zwift) : le vélo reste sur un seul pignon réel, et chaque
// vitesse virtuelle décale la pente envoyée au trainer. Petite vitesse = pente ressentie plus
// douce, grande vitesse = plus dure. La vitesse du vélo dans le jeu, elle, ne dépend que des watts.
//
// pente envoyée = pente du terrain × difficulté + (vitesse − vitesse neutre) × pas

export class VirtualGears extends EventTarget {
  constructor({ count = 24, neutral = 12, stepPercent = 1, difficulty = 1, min = -10, max = 20 } = {}) {
    super();
    this.count = count;
    this.neutral = neutral;
    this.stepPercent = stepPercent;
    this.difficulty = difficulty;
    this.min = min;
    this.max = max;
    this.gear = neutral;
  }

  shift(delta) {
    const next = Math.max(1, Math.min(this.count, this.gear + delta));
    if (next !== this.gear) {
      this.gear = next;
      this.dispatchEvent(new CustomEvent('change', { detail: { gear: next } }));
    }
    return this.gear;
  }

  up() {
    return this.shift(1);
  }

  down() {
    return this.shift(-1);
  }

  effectiveGrade(terrainGrade) {
    const g = terrainGrade * this.difficulty + (this.gear - this.neutral) * this.stepPercent;
    return Math.round(Math.max(this.min, Math.min(this.max, g)) * 100) / 100;
  }
}
