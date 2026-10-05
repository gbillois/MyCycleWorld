// Menu principal façon jeu : navigation au clavier, à la souris, au doigt ou avec les manettes Zwift
// (▲ ▼ pour choisir, A = Entrée pour valider, B = Échap pour revenir), panneaux secondaires et pastilles d'état.

const visible = (el) => el && !el.hidden && el.offsetParent !== null;

export class TitleMenu {
  constructor(root) {
    this.root = root;
    this.panel = null;
    this.openers = new Map();
    for (const btn of root.querySelectorAll('[data-panel]')) btn.addEventListener('click', () => this.open(btn.dataset.panel, btn));
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

  // opener : bouton qui ouvre le panneau (on y revient au retour). Un panneau avec data-parent est une
  // sous-page : « Retour » et Échap ramènent au panneau parent.
  open(id, opener = null) {
    const panel = document.getElementById(id);
    if (!panel) return;
    if (this.panel && this.panel !== panel) this.panel.hidden = true;
    if (opener) this.openers.set(id, opener);
    this.panel = panel;
    panel.hidden = false;
    this.root.classList.add('panel-open');
    this.focusDefault();
  }

  close(refocus = true) {
    if (!this.panel) return;
    const panel = this.panel;
    const parent = panel.dataset.parent;
    panel.hidden = true;
    this.panel = null;
    const opener = this.openers.get(panel.id);
    if (parent && refocus) {
      this.open(parent);
      if (opener && !opener.closest('[hidden]')) opener.focus({ preventScroll: true });
      return;
    }
    this.root.classList.remove('panel-open');
    if (refocus) (opener || this.root.querySelector(`[data-panel="${panel.id}"]`))?.focus({ preventScroll: true });
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
    const opt = this.root.querySelector('#optionsSummary');
    if (opt) opt.textContent = [parts.length ? `connectés : ${parts.join(', ')}` : 'connexions', gfxLabel].filter(Boolean).join(' · ');
  }
}
