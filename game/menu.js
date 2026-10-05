// Menu principal façon jeu : navigation au clavier, à la souris, au doigt ou avec les manettes Zwift
// (▲ ▼ pour choisir, A = Entrée pour valider, B = Échap pour revenir), écrans secondaires, fil d'Ariane
// et pastilles d'état. Les écrans Pause et Arrivée se pilotent de la même façon.

const visible = (el) => el && !el.hidden && el.offsetParent !== null && !el.disabled;
const isText = (el) => el && el.tagName === 'INPUT' && el.type === 'text';

// Mode de saisie courant (clavier, manette, tactile) : body[data-input] choisit les pictogrammes affichés
// dans les barres d'aide (touches du clavier ou boutons des manettes Zwift Play).
function trackInputMode() {
  const set = (mode) => {
    if (document.body.dataset.input !== mode) document.body.dataset.input = mode;
  };
  // Écran tactile : la classe body.touch arrive juste après la création du menu.
  const checkTouch = () => document.body.classList.contains('touch') && set('touch');
  checkTouch();
  new MutationObserver(checkTouch).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // Les manettes (et l'appli iOS) envoient des touches synthétiques ; un vrai clavier, des touches « fiables ».
  window.addEventListener('keydown', (e) => {
    if (!e.fromTouch) set(e.isTrusted && !e.fromController ? 'kbd' : 'pad');
  }, true);
  window.addEventListener('pointerdown', (e) => {
    if (e.isTrusted) set(e.pointerType === 'mouse' ? 'kbd' : 'touch');
  }, true);
}

// Fait défiler juste ce qu'il faut, et seulement verticalement dans la zone défilante de l'écran,
// pour voir l'élément choisi (listes longues sur téléphone, navigation à la manette).
function reveal(el) {
  el.focus({ preventScroll: true });
  const box = el.closest('.sp-body, .screen');
  if (!box) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const margin = 12;
  if (r.top < b.top + margin) box.scrollTop -= b.top + margin - r.top;
  else if (r.bottom > b.bottom - margin) box.scrollTop += Math.min(r.top - b.top - margin, r.bottom - b.bottom + margin);
}

export class TitleMenu {
  constructor(root) {
    this.root = root;
    this.panel = null;
    this.openers = new Map();
    for (const btn of root.querySelectorAll('[data-panel]')) btn.addEventListener('click', () => this.open(btn.dataset.panel, btn));
    for (const btn of root.querySelectorAll('[data-close]')) btn.addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    trackInputMode();
    // Écrans Pause et Arrivée : focus sur le bouton principal à l'affichage, ▲ ▼ et A comme dans le menu.
    this.screens = ['pause', 'end'].map((id) => document.getElementById(id)).filter(Boolean);
    const watch = new MutationObserver((list) => {
      for (const m of list) if (!m.target.hidden) m.target.querySelector('.btn.play')?.focus({ preventScroll: true });
    });
    for (const s of this.screens) watch.observe(s, { attributes: true, attributeFilter: ['hidden'] });
  }

  get active() {
    return !this.root.hidden;
  }

  // Éléments navigables du niveau courant. Le bouton « Retour » de l'en-tête reste cliquable,
  // mais les flèches l'ignorent : B / Échap font déjà ce travail.
  focusables(scope = this.panel || this.root.querySelector('.menu')) {
    return [...scope.querySelectorAll('button, a[href], input[type="text"]')].filter((el) => visible(el) && !el.hasAttribute('data-close'));
  }

  // Met le focus sur « Jouer » (ou, dans un écran, sur l'élément courant ou le premier).
  focusDefault() {
    const list = this.focusables();
    const el = list.find((x) => x.getAttribute('aria-current') === 'true') || list[0];
    if (el) reveal(el);
  }

  // Fil d'Ariane : Accueil › Jouer › Vélo (libellé pris sur le bouton qui a ouvert l'écran).
  crumbs(panel) {
    const trail = [];
    for (let p = panel; p; p = p.dataset.parent ? document.getElementById(p.dataset.parent) : null) {
      trail.unshift(this.openers.get(p.id)?.dataset.crumb || p.dataset.crumb || p.getAttribute('aria-label'));
    }
    const nav = panel.querySelector('.crumbs');
    if (nav) nav.innerHTML = ['Accueil', ...trail].map((t, i, a) => `<span${i === a.length - 1 ? ' aria-current="page"' : ''}>${t}</span>`).join('');
  }

  // opener : bouton qui ouvre l'écran (on y revient au retour). Un écran avec data-parent est une
  // sous-page : « Retour » et Échap ramènent à l'écran parent.
  open(id, opener = null, dir = 'fwd') {
    const panel = document.getElementById(id);
    if (!panel) return;
    if (this.panel && this.panel !== panel) this.panel.hidden = true;
    if (opener) this.openers.set(id, opener);
    this.panel = panel;
    this.root.dataset.nav = dir; // sens de l'animation d'entrée (vers l'avant ou retour)
    this.crumbs(panel);
    panel.hidden = false;
    const body = panel.querySelector('.sp-body');
    if (body && dir === 'fwd') body.scrollTop = 0;
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
      this.open(parent, null, 'back');
      if (opener && !opener.closest('[hidden]')) reveal(opener);
      return;
    }
    this.root.dataset.nav = 'back';
    this.root.classList.remove('panel-open');
    if (refocus) (opener || this.root.querySelector(`[data-panel="${panel.id}"]`))?.focus({ preventScroll: true });
  }

  // Écran Pause ou Arrivée affiché ?
  overlay() {
    return this.screens.find((s) => !s.hidden) || null;
  }

  onKey(e) {
    const screen = this.active ? null : this.overlay();
    if (!this.active && !screen) return;
    const list = screen ? this.focusables(screen) : this.focusables();
    const cur = document.activeElement;
    const i = list.indexOf(cur);
    const horiz = e.code === 'ArrowLeft' || e.code === 'ArrowRight';
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp' || (horiz && (this.panel || screen) && !isText(cur))) {
      e.preventDefault();
      const step = e.code === 'ArrowDown' || e.code === 'ArrowRight' ? 1 : -1;
      const next = i < 0 ? list[0] : list[(i + step + list.length) % list.length];
      if (next) reveal(next);
    } else if (e.code === 'Escape') {
      if (this.panel) {
        e.preventDefault();
        this.close();
      }
    } else if ((e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') && i >= 0) {
      if (screen) {
        // Pause / Arrivée : le bouton choisi décide seul (le jeu ne doit pas aussi « reprendre » ou « rejouer »).
        if (e.code === 'Space' && e.isTrusted) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        list[i].click();
      } else if (!e.isTrusted && !isText(list[i])) {
        // Touche envoyée par une manette : le navigateur ne « clique » pas tout seul.
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
    const text = [parts.length ? `connectés : ${parts.join(', ')}` : 'connexions', gfxLabel].filter(Boolean).join(' · ');
    if (opt && opt.textContent !== text) opt.textContent = text;
  }
}
