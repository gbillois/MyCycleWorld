// Transforme les boutons Zwift Play en vraies touches clavier (événements keydown/keyup).
// Le jeu n'a donc qu'à écouter le clavier : ça marche pareil avec un clavier ou les manettes.

export const KEYS = {
  ArrowUp: { key: 'ArrowUp', label: '↑' },
  ArrowDown: { key: 'ArrowDown', label: '↓' },
  ArrowLeft: { key: 'ArrowLeft', label: '←' },
  ArrowRight: { key: 'ArrowRight', label: '→' },
  Space: { key: ' ', label: 'Espace' },
  Enter: { key: 'Enter', label: 'Entrée' },
  Escape: { key: 'Escape', label: 'Échap' },
  Tab: { key: 'Tab', label: 'Tab' },
  ShiftLeft: { key: 'Shift', label: 'Maj' },
  Minus: { key: '-', label: '-' },
  Equal: { key: '=', label: '=' },
  KeyQ: { key: 'q', label: 'Q' },
  KeyE: { key: 'e', label: 'E' },
  KeyR: { key: 'r', label: 'R' },
  KeyP: { key: 'p', label: 'P' },
  KeyM: { key: 'm', label: 'M' },
  KeyZ: { key: 'z', label: 'Z' },
  KeyX: { key: 'x', label: 'X' },
  KeyC: { key: 'c', label: 'C' },
  none: { key: null, label: '(rien)' },
};

// Actions prévues pour le jeu, et la touche clavier associée par défaut.
export const ACTIONS = {
  ArrowLeft: 'Tourner à gauche',
  ArrowRight: 'Tourner à droite',
  ArrowUp: 'Menu haut',
  ArrowDown: 'Menu bas',
  Minus: 'Vitesse −',
  Equal: 'Vitesse +',
  Space: 'Utiliser l’objet',
  ShiftLeft: 'Dérapage',
  KeyR: 'Regarder derrière',
  Enter: 'Valider',
  Escape: 'Retour / pause',
  Tab: 'Menu',
};

export const DEFAULT_KEYMAP = {
  L_LEFT: 'ArrowLeft',
  L_RIGHT: 'ArrowRight',
  L_UP: 'ArrowUp',
  L_DOWN: 'ArrowDown',
  L_SHIFT: 'Minus',
  L_SHIFT2: 'Minus',
  L_PADDLE: 'ShiftLeft',
  L_ON: 'Escape',
  L_POWERUP: 'Space',
  R_A: 'Enter',
  R_B: 'Escape',
  R_Y: 'KeyR',
  R_Z: 'Space',
  R_SHIFT: 'Equal',
  R_SHIFT2: 'Equal',
  R_PADDLE: 'Space',
  R_ON: 'Tab',
  R_POWERUP: 'Space',
};

const STORAGE_KEY = 'mycycleworld.keymap';

export function loadKeymap() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULT_KEYMAP, ...saved };
  } catch {
    return { ...DEFAULT_KEYMAP };
  }
}

export function saveKeymap(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* stockage indisponible : tant pis, on garde en mémoire */
  }
}

export class KeyEmitter {
  constructor(map = loadKeymap(), target = window) {
    this.map = map;
    this.target = target;
    this.down = new Map(); // code -> nombre de boutons qui le tiennent
  }

  fire(type, code) {
    const k = KEYS[code];
    if (!k || !k.key) return;
    const ev = new KeyboardEvent(type, { key: k.key, code, bubbles: true, cancelable: true });
    // Permet au jeu de savoir que la touche vient d'une manette.
    Object.defineProperty(ev, 'fromController', { value: true });
    this.target.dispatchEvent(ev);
  }

  buttonDown(button) {
    const code = this.map[button];
    if (!code || code === 'none') return;
    const n = this.down.get(code) || 0;
    this.down.set(code, n + 1);
    if (n === 0) this.fire('keydown', code);
  }

  buttonUp(button) {
    const code = this.map[button];
    if (!code || code === 'none') return;
    const n = this.down.get(code) || 0;
    if (n <= 1) {
      this.down.delete(code);
      if (n === 1) this.fire('keyup', code);
    } else this.down.set(code, n - 1);
  }

  // Branche une manette : ses boutons deviennent des touches.
  attach(controller) {
    controller.addEventListener('buttondown', (e) => this.buttonDown(e.detail));
    controller.addEventListener('buttonup', (e) => this.buttonUp(e.detail));
  }
}
