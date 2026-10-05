// Commandes tactiles (mobile / tablette) : des boutons à l'écran qui envoient les mêmes touches que le clavier.
// Le jeu n'a rien de spécial à faire : il reçoit des keydown/keyup comme avec un vrai clavier ou les manettes.
import { KEYS } from '../src/core/keymap.js';

// Écran tactile détecté, ou forcé avec ?touch=1 (et désactivé avec ?touch=0).
export function wantsTouch(params = new URLSearchParams(location.search)) {
  if (params.get('touch') === '0') return false;
  if (params.has('touch')) return true;
  return matchMedia('(any-pointer: coarse)').matches;
}

const icon = (id) => `<svg class="ico" aria-hidden="true"><use href="#${id}"/></svg>`;
const LAYOUT = `
  <div class="tc-left">
    <button class="tc steer" data-code="ArrowLeft" aria-label="Aller à gauche">${icon('i-back')}</button>
    <button class="tc steer" data-code="ArrowRight" aria-label="Aller à droite">${icon('i-chev')}</button>
  </div>
  <div class="tc-right">
    <div class="tc-gears">
      <button class="tc gear" data-code="Minus" aria-label="Vitesse moins">−</button>
      <button class="tc gear" data-code="Equal" aria-label="Vitesse plus">+</button>
    </div>
    <div class="tc-actions">
      <button class="tc item" data-code="Space" aria-label="Utiliser l'objet"><span class="tc-glyph">★</span><span class="tc-label">Objet</span></button>
      <button class="tc pedal" data-code="ArrowUp" aria-label="Pédaler (maintenir)">${icon('i-spin')}<span class="tc-label">Pédaler</span></button>
    </div>
  </div>
  <button class="tc pause" data-code="Escape" aria-label="Pause">${icon('i-pause')}</button>
`;

export class TouchControls {
  constructor(parent) {
    this.root = document.createElement('div');
    this.root.className = 'tc-layer';
    this.root.innerHTML = LAYOUT;
    parent.appendChild(this.root);
    this.held = new Map(); // pointerId -> code

    for (const btn of this.root.querySelectorAll('.tc')) {
      const code = btn.dataset.code;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try {
          btn.setPointerCapture(e.pointerId); // le bouton garde le doigt même s'il glisse un peu
        } catch {
          /* pointeur déjà relâché : sans importance */
        }
        this.held.set(e.pointerId, code);
        btn.classList.add('on');
        this.fire('keydown', code);
      });
      const up = (e) => {
        if (!this.held.has(e.pointerId)) return;
        this.held.delete(e.pointerId);
        // Un autre doigt peut encore tenir le même bouton.
        if (![...this.held.values()].includes(code)) {
          btn.classList.remove('on');
          this.fire('keyup', code);
        }
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
    }
    // Pas de menu contextuel ni de loupe sur un appui long.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  fire(type, code) {
    const key = KEYS[code]?.key ?? code;
    const ev = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'fromTouch', { value: true }); // pour l'aide à l'écran : ce n'est pas une manette
    window.dispatchEvent(ev);
  }

  // Relâche tout (pause, fin de course) sans attendre que les doigts se lèvent.
  releaseAll() {
    const codes = new Set(this.held.values());
    this.held.clear();
    this.root.querySelectorAll('.tc.on').forEach((b) => b.classList.remove('on'));
    codes.forEach((c) => this.fire('keyup', c));
  }

  // Le bouton Pédaler ne sert à rien quand le home trainer fournit la puissance.
  setPedalVisible(visible) {
    this.root.classList.toggle('no-pedal', !visible);
  }

  setItemReady(ready) {
    this.root.classList.toggle('has-item', ready);
  }
}
