// Menu principal façon jeu : navigation au clavier, à la souris, au doigt ou avec les manettes Zwift
// (▲ ▼ pour choisir, A = Entrée pour valider, B = Échap pour revenir), panneaux secondaires et pastilles d'état.

const visible = (el) => el && !el.hidden && el.offsetParent !== null;

export class TitleMenu {
  constructor(root) {
    this.root = root;
    this.panel = null;
    for (const btn of root.querySelectorAll('[data-panel]')) btn.addEventListener('click', () => this.open(btn.dataset.panel));
    for (const btn of root.querySelectorAll('[data-close]')) btn.addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  get active() {
    return !this.root.hidden;
  }

  focusables() {
    const scope = this.panel || this.root.querySelector('.menu');
    return [...scope.querySelectorAll('button, a[href]')].filter(visible);
  }

  // Met le focus sur « Jouer » (ou, dans un panneau, sur l'élément courant ou le premier).
  focusDefault() {
    const list = this.focusables();
    (list.find((el) => el.getAttribute('aria-current') === 'true') || list[0])?.focus({ preventScroll: true });
  }

  open(id) {
    this.close(false);
    this.panel = document.getElementById(id);
    if (!this.panel) return;
    this.panel.hidden = false;
    this.root.classList.add('panel-open');
    this.focusDefault();
  }

  close(refocus = true) {
    if (!this.panel) return;
    const id = this.panel.id;
    this.panel.hidden = true;
    this.panel = null;
    this.root.classList.remove('panel-open');
    if (refocus) this.root.querySelector(`[data-panel="${id}"]`)?.focus({ preventScroll: true });
  }

  onKey(e) {
    if (!this.active) return;
    const list = this.focusables();
    const i = list.indexOf(document.activeElement);
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      const step = e.code === 'ArrowDown' ? 1 : -1;
      const next = list[(i + step + list.length) % list.length] || list[0];
      next?.focus({ preventScroll: true });
    } else if (e.code === 'Escape') {
      if (this.panel) {
        e.preventDefault();
        this.close();
      }
    } else if ((e.code === 'Enter' || e.code === 'Space') && !e.isTrusted) {
      // Touche envoyée par une manette : le navigateur ne « clique » pas tout seul.
      if (i >= 0) {
        e.preventDefault();
        list[i].click();
      }
    }
  }

  // Pastilles d'état et résumé des appareils.
  setStatus({ trainer = false, hr = false, controllers = 0, gfxLabel = '' }) {
    this.root.querySelector('#chipTrainer')?.classList.toggle('ok', trainer);
    this.root.querySelector('#chipHr')?.classList.toggle('ok', hr);
    this.root.querySelector('#chipZwift')?.classList.toggle('ok', controllers > 0);
    const parts = [];
    if (trainer) parts.push('trainer');
    if (hr) parts.push('cardio');
    if (controllers) parts.push(`${controllers} manette${controllers > 1 ? 's' : ''}`);
    const summary = this.root.querySelector('#devicesSummary');
    if (summary) summary.textContent = parts.length ? `connectés : ${parts.join(', ')}` : 'aucun appareil connecté';
    const opt = this.root.querySelector('#optionsSummary');
    if (opt && gfxLabel) opt.textContent = gfxLabel;
  }
}
