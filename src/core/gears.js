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

// Sans home trainer (clavier, tapotements, démo) : la vitesse choisie compte quand même.
// Pente ressentie confortable (environ 0 à 5 %) : toute la puissance. Trop dure (grosse vitesse en côte) :
// on écrase les pédales, cadence basse, puissance en baisse. Trop facile (petite vitesse en descente) :
// on mouline dans le vide, cadence très haute, puissance en baisse aussi.
export function simulatedEffort(feltGrade) {
  const hard = Math.max(0, feltGrade - 5);
  const easy = Math.max(0, -1 - feltGrade);
  const factor = Math.max(0.35, Math.min(1, 1 - 0.06 * hard - 0.07 * easy));
  const cadence = Math.max(40, Math.min(130, 90 - 4.5 * (feltGrade - 2)));
  return { factor, cadence };
}
