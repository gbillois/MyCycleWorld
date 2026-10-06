// Cartes et aperçu des niveaux de kayak dans « Jouer > Rameur » : miniature SVG de la rivière (rapides en
// blanc, portes vertes, portes sprint orange, passerelle jaune, départ et arrivée), chiffres clés.
import { River, CURRENTS } from '../src/core/kayak.js';
import { RIVER_ORDER, riverById } from './rivers.js';

const rivers = new Map();
export function riverInfo(id) {
  const def = riverById(id);
  if (!rivers.has(def.id)) rivers.set(def.id, new River(def));
  return rivers.get(def.id);
}

const THEME = { gorge: ['#5aa84a', '#1f5a2c'], torrent: ['#6f8fa0', '#24394a'] };

export function kayakSvg(id, big = false) {
  const river = riverInfo(id);
  const b = river.bounds;
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const pad = 12;
  const k = (100 - pad * 2) / size;
  const ox = pad + ((size - (b.maxX - b.minX)) * k) / 2;
  const oz = pad + ((size - (b.maxZ - b.minZ)) * k) / 2;
  const P = (i) => `${(ox + (river.x[i] - b.minX) * k).toFixed(1)} ${(oz + (river.z[i] - b.minZ) * k).toFixed(1)}`;
  const step = 8;
  let d = '';
  for (let i = 0; i <= river.count; i += step) d += `${i ? 'L' : 'M'}${P(i)} `;
  let rapids = '';
  for (let i = 0; i < river.count; i += step) if (river.rapid[i] > 0.5) rapids += `M${P(i)} L${P(Math.min(river.count, i + step))} `;
  const at = (s) => P(Math.round(Math.min(river.count, Math.max(0, s))));
  const xy = (s) => at(s).split(' ');
  const gates = river.gates.map((g) => {
    const [x, y] = xy(g.s);
    const col = g.kind === 'sprint' ? '#ff9a1f' : g.kind === 'glide' ? '#ffd23f' : '#3ccf7a';
    const r = g.kind === 'normal' ? (big ? 1.3 : 1.7) : big ? 2.6 : 3.2;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" stroke="#0b0e16" stroke-width=".6"/>`;
  }).join('');
  const [sx, sy] = xy(river.start);
  const [fx, fy] = xy(river.finish);
  const [c1, c2] = THEME[river.def.theme] || THEME.gorge;
  const gid = `kv-${river.def.id}-${big ? 'b' : 's'}`;
  // Falaises des gorges : bandes claires de chaque côté
  let cliffs = '';
  for (let i = 0; i < river.count; i += step) if (river.gorge[i] > 0.5) cliffs += `M${P(i)} L${P(Math.min(river.count, i + step))} `;
  const label = big ? '' : `<text x="50" y="94" font-size="10" font-weight="900" text-anchor="middle" fill="#fff" style="paint-order:stroke" stroke="#0b2030" stroke-width="2.5" letter-spacing="1">KAYAK</text>`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="${gid}" cx="35%" cy="30%" r="85%"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient></defs><rect width="100" height="100" fill="url(#${gid})"/>`
    + `<path d="${cliffs}" fill="none" stroke="#d9d2c0" stroke-opacity=".55" stroke-width="${big ? 7 : 9}" stroke-linecap="round"/>`
    + `<path d="${d}" fill="none" stroke="#0b0e16" stroke-opacity=".55" stroke-width="${big ? 5.5 : 7}" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="${d}" fill="none" stroke="#3aa6e0" stroke-width="${big ? 3.4 : 4.2}" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="${rapids}" fill="none" stroke="#f2fbff" stroke-width="${big ? 1.6 : 2}" stroke-linecap="round" stroke-dasharray="1.5 1.5"/>`
    + `${gates}<circle cx="${sx}" cy="${sy}" r="${big ? 3 : 3.6}" fill="#fff" stroke="#11151f" stroke-width="1"/>`
    + `<g transform="translate(${(+fx - 3.5).toFixed(1)} ${(+fy - 3.5).toFixed(1)})"><rect width="7" height="7" rx="1.2" fill="#fff" stroke="#11151f" stroke-width=".8"/><rect width="3.5" height="3.5" fill="#11151f"/><rect x="3.5" y="3.5" width="3.5" height="3.5" fill="#11151f"/></g>${label}</svg>`;
}

function stats(id) {
  const r = riverInfo(id);
  let rapid = 0;
  for (let i = 0; i <= r.count; i++) if (r.rapid[i] > 0.5) rapid++;
  return {
    km: (r.distance / 1000).toFixed(1),
    gates: r.normalGates,
    sprints: r.sprintGates,
    glides: r.glideGates,
    rapid: Math.round((rapid / r.count) * 100),
    maxCurrent: (CURRENTS.rapid * 3.6).toFixed(0),
  };
}

export const KAYAK_LEVELS = RIVER_ORDER;

export function kayakCard(id, stars) {
  const def = riverById(id);
  const x = stats(id);
  return `<button type="button" class="course-card" data-kayak="${def.id}" data-theme="${def.theme === 'torrent' ? 'alpine' : 'meadow'}"><span class="cc-map">${kayakSvg(id)}</span><span class="cc-body"><span class="c-name">${def.name}</span><span class="c-tag">Kayak cross · ${def.tagline}</span><span class="c-stats"><span>${x.km} km</span><span>${x.gates} portes</span><span class="hot">${x.sprints} portes sprint</span><span>6 kayaks</span></span></span>${stars(def.difficulty)}</button>`;
}

export function kayakPreview(id, { stars, icon }) {
  const def = riverById(id);
  const x = stats(id);
  return `<div class="pv" data-theme="${def.theme === 'torrent' ? 'alpine' : 'meadow'}">
    <div class="pv-map">${kayakSvg(id, true)}</div>
    <div class="pv-info">
      <span class="pv-kicker">Rameur · kayak cross · ${def.level}</span>
      <h3>${def.name}</h3>
      <p>${def.tagline}. Passe entre les fiches (+2 s par porte manquée), accélère pour les portes sprint, arrête de ramer sous la passerelle.</p>
      <div class="pv-diff"><span>Difficulté</span>${stars(def.difficulty)}</div>
      <dl class="pv-stats"><div><dt>${icon('i-route')}Descente</dt><dd>${x.km} km</dd></div><div><dt>${icon('i-flag')}Portes</dt><dd>${x.gates}</dd></div><div><dt>${icon('i-bolt')}Portes sprint</dt><dd>${x.sprints}</dd></div><div><dt>${icon('i-wave')}Rapides</dt><dd>${x.rapid} %</dd></div></dl>
      <div class="pv-surf"><span>Courant</span><span>Rochers</span><span>Turbo, tourbillon, bouclier</span><span>Pilote auto</span></div>
      <div class="pv-go"><span class="glyph"><span class="k-kbd">Entrée</span><span class="k-pad pad-a">A</span></span>Lancer la descente</div>
    </div>
  </div>`;
}
