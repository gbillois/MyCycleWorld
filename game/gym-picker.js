// Écran « Sur quelle machine ? » (appli iOS, carte des salles) : entre le choix du niveau et le départ, le
// plan du lieu montre les machines repérées par l'appli ; la plus proche clignote (celle devant laquelle on
// se tient). On touche sa machine, puis « Lancer » : le jeu demande à l'appli de s'y brancher et attend ses
// données pour partir (voir main.js, attente du départ). Logique pure : src/core/gym.js.
import { KIND_LABELS, placeById, rankMachines, nearestId, proximity, loadChoices, saveChoice, lastChoice } from '../src/core/gym.js';


const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ICONS = { bike: 'i-bike', cross: 'i-cross', rower: 'i-row', treadmill: 'i-route', power: 'i-bolt' };
const icon = (kind) => ICONS[kind] || 'i-dumbbell';
const PLAY_LABELS = { bike: 'vélo', cross: 'elliptique', row: 'rameur' };

// Plan du lieu en SVG (unités : mètres). Machines placées seulement ; la sélection et la plus proche ressortent.
export function gymMapSvg(place, { selected = null, nearest = null, fitOf = () => 'yes' } = {}) {
  const W = place.width;
  const D = place.depth;
  const big = Math.max(W, D);
  const r = Math.max(0.42, big / 38);
  const fs = r * 0.95;
  let grid = '';
  for (let x = 1; x < W; x++) grid += `<line x1="${x}" y1="0" x2="${x}" y2="${D}" class="${x % 5 ? 'g1' : 'g5'}"/>`;
  for (let y = 1; y < D; y++) grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" class="${y % 5 ? 'g1' : 'g5'}"/>`;
  const door = `<rect x="${W / 2 - 1}" y="${D - 0.14}" width="2" height="0.14" class="door"/><text x="${W / 2}" y="${D - 0.35}" class="door-t" font-size="${fs}">Entrée</text>`;
  const top = (m) => (m.id === selected ? 2 : m.id === nearest ? 1 : 0);
  const marks = place.machines
    .filter((m) => m.x !== null)
    .sort((a, b) => top(a) - top(b))
    .map((m) => {
      const cls = ['gm', `k-${m.kind || 'none'}`, `fit-${fitOf(m)}`, m.id === selected ? 'sel' : '', m.id === nearest ? 'near' : ''].join(' ');
      const err = m.err && m.err > r ? `<circle class="gm-err" r="${Math.min(big / 2, m.err).toFixed(2)}"/>` : '';
      const ring = m.id === nearest ? `<circle class="gm-near" r="${(r * 1.55).toFixed(2)}"/>` : '';
      // Nom seulement pour la machine choisie et la plus proche : en salle, les machines sont côte à côte et
      // les noms se chevaucheraient (la liste les donne tous). Nom complet au survol.
      const label = m.id === selected || m.id === nearest ? `<text y="${(r + fs * 1.05).toFixed(2)}" font-size="${fs.toFixed(2)}">${esc(m.title)}</text>` : '';
      return `<g class="${cls}" data-id="${m.id}" transform="translate(${m.x.toFixed(2)} ${m.y.toFixed(2)})"><title>${esc(m.title)}</title>${err}${ring}<circle class="gm-dot" r="${r.toFixed(2)}"/><use href="#${icon(m.kind)}" x="${(-r * 0.62).toFixed(2)}" y="${(-r * 0.62).toFixed(2)}" width="${(r * 1.24).toFixed(2)}" height="${(r * 1.24).toFixed(2)}"/>${label}</g>`;
    })
    .join('');
  const pad = r * 2.2;
  return `<svg viewBox="${-pad} ${-pad} ${W + 2 * pad} ${D + 2 * pad}" role="img" aria-label="Plan de ${esc(place.name)}"><rect x="0" y="0" width="${W}" height="${D}" rx="${(r * 0.6).toFixed(2)}" class="room"/>${grid}${door}${marks}</svg>`;
}

export class GymPicker {
  constructor({ devices, storage, onLaunch, onSkip, onEdit }) {
    this.devices = devices;
    this.storage = storage;
    this.onLaunch = onLaunch;
    this.onSkip = onSkip;
    this.onEdit = onEdit;
    this.panel = $('machinePanel');
    this.play = 'bike';
    this.title = '';
    this.placeId = null;
    this.selected = null;
    this.userPicked = false;
    this.order = [];
    this.open_ = false;
    devices.addEventListener('gym', () => this.open_ && this.refresh());
    // Écran fermé (retour, Échap, départ) : l'appli arrête d'écouter les machines autour.
    new MutationObserver(() => {
      if (this.panel.hidden && this.open_) this.stop();
    }).observe(this.panel, { attributes: true, attributeFilter: ['hidden'] });
    $('gymPlaces').addEventListener('click', (e) => {
      const b = e.target.closest('[data-place]');
      if (!b) return;
      this.placeId = b.dataset.place;
      this.order = [];
      this.choose(lastChoice(loadChoices(this.storage), this.placeId, this.play), false);
    });
    const pick = (e) => {
      const el = e.target.closest('[data-id]');
      if (el) this.choose(el.dataset.id, true);
    };
    $('gymMap').addEventListener('click', pick);
    $('gymList').addEventListener('click', pick);
    $('gymNearest').addEventListener('click', pick);
    $('gymGo').addEventListener('click', () => this.launch());
    $('gymSkip').addEventListener('click', () => {
      this.stop();
      this.onSkip?.();
    });
    $('gymEdit').addEventListener('click', () => this.onEdit?.());
  }

  get gym() {
    return this.devices.gym;
  }

  // Écran utile : appli qui sait choisir une machine, et au moins une machine sur une carte.
  get available() {
    return !!this.devices.canUseGym && !!this.gym?.places.some((p) => p.machines.length);
  }

  get place() {
    return placeById(this.gym, this.placeId);
  }

  open({ play = 'bike', title = '' } = {}) {
    this.play = play;
    this.title = title;
    this.open_ = true;
    const gym = this.gym;
    // Lieu par défaut, sauf si on se tient devant une machine d'un autre lieu (club de vacances…).
    const heardFirst = gym?.nearby[0];
    const here = heardFirst && heardFirst.rssi >= -67 ? gym.places.find((p) => p.machines.some((m) => m.id === heardFirst.id)) : null;
    this.placeId = (here || placeById(gym, gym?.defaultPlace))?.id ?? null;
    this.order = [];
    this.choose(lastChoice(loadChoices(this.storage), this.placeId, play), false);
    this.devices.gymScan(true);
    this.render(true);
  }

  stop() {
    this.open_ = false;
    this.devices.gymScan(false);
  }

  choose(id, byUser) {
    this.selected = id;
    if (byUser) this.userPicked = true;
    else this.userPicked = false;
    if (this.open_) this.render(false);
  }

  launch() {
    const row = this.rows().find((m) => m.id === this.selected);
    if (!row) return;
    saveChoice(this.storage, this.place?.id, this.play, row.id);
    this.stop();
    this.onLaunch?.({ id: row.id, kind: row.kind, title: row.title, placeId: this.place?.id ?? null });
  }

  rows() {
    return rankMachines(this.gym, this.place, this.play);
  }

  // Mise à jour en direct (signaux des machines, chaque seconde) : l'ordre de la liste ne bouge pas, seules
  // les distances, la machine la plus proche et le plan changent.
  refresh() {
    const near = this.nearest();
    // Personne n'a encore choisi : on propose la machine juste devant soi.
    if (!this.userPicked && near && near.rssi >= -60 && this.selected !== near.id) this.selected = near.id;
    this.render(false);
  }

  // Machine du plan entendue le plus fort, si elle est dans la salle (pas une machine lointaine).
  nearest() {
    const id = nearestId(this.gym, this.place);
    const rssi = id ? this.gym.nearby.find((n) => n.id === id)?.rssi : null;
    return id && rssi >= -80 ? { id, rssi } : null;
  }

  render(reorder) {
    const gym = this.gym;
    const place = this.place;
    if (!place) return;
    const rows = this.rows();
    if (reorder || !this.order.length) this.order = rows.map((r) => r.id);
    else for (const r of rows) if (!this.order.includes(r.id)) this.order.push(r.id); // nouvelle machine entendue
    const byId = new Map(rows.map((r) => [r.id, r]));
    const list = this.order.map((id) => byId.get(id)).filter(Boolean);
    const near = this.nearest()?.id ?? null;

    $('gymTitle').textContent = this.title ? `${this.title} : sur quelle machine ?` : 'Sur quelle machine ?';
    $('gymPlaces').hidden = gym.places.length < 2;
    $('gymPlaces').innerHTML = gym.places
      .map((p) => `<button type="button" class="chip-btn" data-place="${p.id}" aria-pressed="${p.id === place.id}">${esc(p.name)}${p.id === gym.defaultPlace ? ' ★' : ''}</button>`)
      .join('');
    $('gymMap').innerHTML = gymMapSvg(place, { selected: this.selected, nearest: near, fitOf: (m) => byId.get(m.id)?.fit ?? 'maybe' });

    // La plus proche, en grand : c'est presque toujours celle qu'on veut.
    const nearRow = near ? byId.get(near) : null;
    const nearBox = $('gymNearest');
    nearBox.hidden = !nearRow;
    if (nearRow) {
      const html = `<span class="gi-ico k-${nearRow.kind || 'none'}"><svg class="ico"><use href="#${icon(nearRow.kind)}"/></svg></span><span class="gi-text"><span class="gi-kicker">La plus proche de toi</span><span class="c-name">${esc(nearRow.title)}</span><span class="c-tag">${esc(proximity(nearRow.rssi))} · ${nearRow.rssi} dBm</span></span>`;
      const key = `${nearRow.id}|${nearRow.rssi}|${this.selected === nearRow.id}`;
      if (nearBox.dataset.key !== key) {
        nearBox.dataset.key = key;
        nearBox.dataset.id = nearRow.id;
        nearBox.innerHTML = html;
        nearBox.setAttribute('aria-pressed', String(this.selected === nearRow.id));
      }
    }

    // Liste : boutons stables (la navigation à la manette garde son focus), textes mis à jour.
    const box = $('gymList');
    const ids = list.map((r) => r.id).join(',');
    if (box.dataset.ids !== ids) {
      box.dataset.ids = ids;
      const focused = document.activeElement?.closest?.('#gymList [data-id]')?.dataset.id;
      box.innerHTML = list.map((r) => `<button type="button" class="gym-item" data-id="${r.id}"><span class="gi-ico"><svg class="ico"><use href=""/></svg></span><span class="gi-text"><span class="c-name"></span><span class="c-tag"></span></span></button>`).join('');
      if (focused) box.querySelector(`[data-id="${focused}"]`)?.focus({ preventScroll: true });
    }
    for (const el of box.querySelectorAll('[data-id]')) {
      const r = byId.get(el.dataset.id);
      if (!r) continue;
      el.className = `gym-item fit-${r.fit}${r.id === near ? ' near' : ''}`;
      el.setAttribute('aria-pressed', String(r.id === this.selected));
      el.setAttribute('aria-current', String(r.id === this.selected)); // focus de la manette à l'ouverture
      el.querySelector('.gi-ico').className = `gi-ico k-${r.kind || 'none'}`;
      el.querySelector('use').setAttribute('href', `#${icon(r.kind)}`);
      el.querySelector('.c-name').textContent = r.title;
      const bits = [r.kind ? KIND_LABELS[r.kind] : 'type inconnu'];
      if (r.rssi !== null) bits.push(proximity(r.rssi));
      else bits.push('pas entendue (en veille ?)');
      if (!r.mapped) bits.push('pas sur le plan');
      else if (r.x === null) bits.push('pas encore placée');
      if (r.fit === 'no') bits.push(`pas un ${PLAY_LABELS[this.play] || 'vélo'}`);
      el.querySelector('.c-tag').textContent = bits.join(' · ');
    }
    if (!list.length) box.innerHTML = '<p class="panel-note">Aucune machine sur ce plan. Cartographie la salle dans les réglages de l’appli.</p>';

    const chosen = byId.get(this.selected);
    const go = $('gymGo');
    go.disabled = !chosen;
    go.querySelector('.gl').textContent = chosen ? `Lancer sur ${chosen.title}` : 'Touche ta machine sur le plan';
    $('gymNote').textContent = gym.scanning
      ? 'La machine devant laquelle tu te tiens clignote en orange. Une machine en veille n’émet rien : choisis-la sur le plan, le jeu l’attendra.'
      : 'Choisis ta machine sur le plan : le jeu s’y connecte dès qu’elle se réveille et la course part quand elle envoie tes premières données.';
  }
}
