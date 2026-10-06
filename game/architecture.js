// Architecture des graphismes détaillés : maisons de campagne, ferme (grange, silo, corps de ferme), chalets,
// église à bulbe, fontaine, café et sa terrasse, cabines de plage, poste de secours, hangar à bateaux, tribune,
// portiques de départ et d'arrivée, passerelle de corde, ponton. Tout est construit avec le pinceau de
// buildings.js (une couche de texture par matière, teinte et occlusion dans les sommets) ; chaque bâtiment
// tire ses variantes (couleurs, toit, fenêtres, balcons...) d'un générateur pseudo-aléatoire.
// Repère local d'un bâtiment : origine au sol, au centre ; +Z = façade principale (vers la route), +Y en haut.
import { L, tint, SIGN } from './buildings.js';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
const vary = (r, hex, amt = 0.08) => tint(hex, 1 - amt + r() * amt * 2);

// --- Palettes ---
const PLASTERS = ['#f3e8d2', '#eedcbc', '#f7f2e8', '#ecd5b5', '#f2d2a2', '#e8e3d4', '#f4e4b0', '#ecc9b8', '#dfe2d2', '#f0dcc0'];
const STONES = ['#cfc6b6', '#c2b49c', '#d6cfc2', '#bcb1a0', '#c9bda6'];
const TILES = ['#b2563b', '#a5472f', '#be6a43', '#9c5538', '#b9704c', '#8f4c33'];
const SLATES = ['#5f6772', '#555d69', '#6b707a', '#4f5660'];
const SHUTTERS = ['#4f7a5a', '#3f6f8f', '#7d939e', '#a2463a', '#5b6d48', '#d9d3c2', '#6a8fb5', '#8a6a4a'];
const WOODS = ['#9a6034', '#8a5129', '#a8703f', '#7b4826', '#b07a46'];
const FLOWERS = ['#e0384b', '#ff6fa0', '#ffd23f', '#f2f2f2', '#c43dd6', '#ff7a2a'];
const LEAF = '#3f7d2e';

const WHITE = tint('#f2efe8');
const DARK = tint('#2a2622');
const IRON = tint('#2c2e33');
const GOLD = tint('#d4a637');

// Occlusion d'un mur : sombre sous l'avant-toit (le pied du mur est géré par le pinceau).
const eaveAO = (top, k = 0.32) => (y) => 1 - k * smoothstep(top - 1.2, top, y);

// =====================================================================
// Ouvertures (dans le repère d'un mur : plan z = 0, normale +Z, x le long du mur)
// =====================================================================

// o : { x, y (appui), w, h, dp (profondeur), wallLayer, wallCol, frame (teinte), frameLayer, glass, panes: [c, r],
//       sill, surround, lintel, shutters (teinte), box (jardinière), door (teinte du battant), arch }
export function opening(B, o) {
  const K = B.kit;
  const dp = o.dp ?? 0.14;
  const x0 = o.x - o.w / 2;
  const x1 = o.x + o.w / 2;
  const y0 = o.y;
  const y1 = o.y + o.h;
  // Tableaux (côtés de l'embrasure)
  K.color(o.revealCol || o.wallCol);
  const rl = o.revealLayer ?? o.wallLayer;
  K.face([[x0, y0, 0], [x0, y0, -dp], [x0, y1, -dp], [x0, y1, 0]], rl, { ao: [0.9, 0.55, 0.55, 0.9] });
  K.face([[x1, y0, -dp], [x1, y0, 0], [x1, y1, 0], [x1, y1, -dp]], rl, { ao: [0.55, 0.9, 0.9, 0.55] });
  K.face([[x0, y1, 0], [x0, y1, -dp], [x1, y1, -dp], [x1, y1, 0]], rl, { ao: [0.75, 0.45, 0.45, 0.75] });
  if (!o.door) K.face([[x0, y0, -dp], [x0, y0, 0], [x1, y0, 0], [x1, y0, -dp]], rl, { ao: [0.6, 0.9, 0.9, 0.6] });
  const fz = -dp + 0.02;
  const ft = o.ft ?? 0.07;
  const frameL = o.frameLayer ?? L.PLAIN;
  if (o.door) {
    // Battant de porte en planches, petite imposte vitrée éventuelle
    const top = o.transom ? y1 - 0.45 : y1;
    K.color(o.door);
    K.face([[x0, y0, fz], [x1, y0, fz], [x1, top, fz], [x0, top, fz]], L.WOODV, { ao: [0.6, 0.6, 0.8, 0.8], scale: 0.6 });
    // Cadre
    K.color(o.frame);
    K.box(x0, y0, fz, x0 + ft, y1, fz + 0.08, frameL, { skip: 'ny nz', ao: { b: 0.6, t: 0.8 } });
    K.box(x1 - ft, y0, fz, x1, y1, fz + 0.08, frameL, { skip: 'ny nz', ao: { b: 0.6, t: 0.8 } });
    K.box(x0, y1 - ft, fz, x1, y1, fz + 0.08, frameL, { skip: 'nz', ao: { b: 0.7, t: 0.7 } });
    if (o.transom) {
      K.color(o.glass || tint('#7f9fb5'));
      K.face([[x0 + ft, top, fz], [x1 - ft, top, fz], [x1 - ft, y1 - ft, fz], [x0 + ft, y1 - ft, fz]], L.GLASS, { fit: [0, 0, 1, 0.4], ao: 0.85 });
      K.color(o.frame);
      K.box(x0, top - 0.03, fz, x1, top + 0.03, fz + 0.08, frameL, { skip: 'nz' });
    }
    // Ferrures et poignée
    B.detail();
    K.color(IRON);
    for (const hy of [y0 + 0.35, top - 0.35]) K.box(x0 + 0.05, hy - 0.025, fz, x0 + o.w * 0.55, hy + 0.025, fz + 0.025, L.PLAIN, { skip: 'ny nz' });
    K.color(GOLD);
    K.blob(x1 - 0.14, y0 + 1.0, fz + 0.05, 0.035);
    B.shell();
    // Marche
    if (o.step !== false) {
      K.color(o.stepCol || tint('#b9b2a5'));
      K.box(x0 - 0.15, -0.3, 0, x1 + 0.15, y0, 0.42, L.ASHLAR, { ao: { b: 0.7, t: 1 } });
    }
  } else {
    // Vitre et menuiseries (petits bois)
    K.color(o.glass || tint('#7593a8'));
    K.face([[x0, y0, fz], [x1, y0, fz], [x1, y1, fz], [x0, y1, fz]], L.GLASS, { fit: [0, 0, 1, 1], ao: 0.9 });
    K.color(o.frame);
    const fd = fz + 0.06;
    K.box(x0, y0, fz, x0 + ft, y1, fd, frameL, { skip: 'ny nz' });
    K.box(x1 - ft, y0, fz, x1, y1, fd, frameL, { skip: 'ny nz' });
    K.box(x0, y1 - ft, fz, x1, y1, fd, frameL, { skip: 'nz' });
    K.box(x0, y0, fz, x1, y0 + ft, fd, frameL, { skip: 'nz ny' });
    const [pc, pr] = o.panes || [2, 3];
    const bw = 0.035;
    for (let i = 1; i < pc; i++) {
      const bx = x0 + (o.w * i) / pc;
      K.box(bx - bw, y0, fz, bx + bw, y1, fd - 0.01, frameL, { skip: 'ny nz py' });
    }
    for (let j = 1; j < pr; j++) {
      const by = y0 + (o.h * j) / pr;
      K.box(x0, by - bw * 0.8, fz, x1, by + bw * 0.8, fd - 0.015, frameL, { skip: 'nz' });
    }
    // Appui
    if (o.sill !== false) {
      K.color(o.sillCol || tint('#d8d0c0'));
      K.box(x0 - 0.07, y0 - 0.08, -0.03, x1 + 0.07, y0, 0.11, o.sillLayer ?? L.ASHLAR, { ao: { b: 0.8, t: 1 } });
    }
  }
  // Encadrement en pierre de taille ou en bois peint, linteau
  if (o.surround) {
    const sw = o.surroundW ?? 0.16;
    K.color(o.surround);
    const sl = o.surroundLayer ?? L.ASHLAR;
    K.box(x0 - sw, y0, 0, x0, y1 + sw, 0.035, sl, { skip: 'ny nz' });
    K.box(x1, y0, 0, x1 + sw, y1 + sw, 0.035, sl, { skip: 'ny nz' });
    K.box(x0, y1, 0, x1, y1 + sw, 0.035, sl, { skip: 'ny nz' });
  } else if (o.lintel) {
    K.color(o.lintel);
    K.box(x0 - 0.18, y1, 0, x1 + 0.18, y1 + 0.2, 0.05, o.lintelLayer ?? L.WOODH, { skip: 'nz' });
  }
  // Volets ouverts rabattus contre le mur (barres et écharpe visibles)
  if (o.shutters) {
    const sw = o.w / 2;
    for (const s of [-1, 1]) {
      const sx0 = s < 0 ? x0 - sw - 0.05 - (o.surround ? 0.16 : 0) : x1 + 0.05 + (o.surround ? 0.16 : 0);
      const sx1 = sx0 + sw;
      K.color(o.shutters);
      K.box(sx0, y0 + 0.02, 0.01, sx1, y1 - 0.02, 0.05, L.WOODV, { skip: 'ny nz', scale: 0.5, ao: { b: 0.85, t: 1 } });
      if (B.lite) continue;
      B.detail();
      K.color(o.shutters.map((c) => c * 0.85));
      for (const by of [y0 + 0.22, y1 - 0.22]) K.box(sx0 + 0.04, by - 0.05, 0.05, sx1 - 0.04, by + 0.05, 0.075, L.WOODV, { skip: 'ny nz', scale: 0.5 });
      K.color(IRON);
      for (const by of [y0 + 0.22, y1 - 0.22]) K.box(s < 0 ? sx1 - 0.03 : sx0, by - 0.02, 0.05, s < 0 ? sx1 + 0.04 : sx0 + 0.03, by + 0.02, 0.08, L.PLAIN, { skip: 'ny nz' });
      B.shell();
    }
  }
  // Jardinière fleurie sous la fenêtre
  if (o.box) {
    B.detail();
    K.color(o.boxCol || tint('#7a4e2c'));
    K.box(x0 - 0.02, y0 - 0.28, 0.08, x1 + 0.02, y0 - 0.08, 0.3, L.WOODH, { scale: 0.4 });
    flowers(B, x0 + 0.06, x1 - 0.06, y0 - 0.06, 0.19, o.box);
    B.shell();
  }
}

// Rangée de fleurs (feuillage et pétales) le long de x, à la hauteur y, profondeur z.
function flowers(B, x0, x1, y, z, palette) {
  const K = B.kit;
  const n = Math.max(2, Math.round((x1 - x0) / (B.lite ? 0.24 : 0.16)));
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) / n) * (x1 - x0);
    const jit = ((i * 37) % 7) / 7;
    if (i % 2 === 0) {
      K.color(tint(LEAF, 0.8 + jit * 0.4));
      K.blob(x + 0.08, y + 0.04, z + (jit - 0.5) * 0.06, 0.15, L.PLAIN, 0.7);
    }
    K.color(tint(palette[(i * 5 + (i >> 1)) % palette.length]));
    K.blob(x + (jit - 0.5) * 0.05, y + 0.15 + jit * 0.05, z + 0.03 + (jit - 0.5) * 0.08, 0.06 + jit * 0.025);
  }
}

// =====================================================================
// Murs d'un volume (quatre façades, bandes de matière par étage, ouvertures)
// =====================================================================

// Façades d'un volume w × d : bands [{ y0, y1, layer, col, grow, tile }], open : { front, right, back, left }
// listes d'ouvertures (x le long du mur vu de dehors), eaves : façades sous un avant-toit (occlusion).
export function walls(B, w, d, bands, open, o = {}) {
  const K = B.kit;
  const sides = [['front', w, d / 2], ['right', d, w / 2], ['back', w, d / 2], ['left', d, w / 2]];
  sides.forEach(([name, W, half], i) => {
    if (o.skip && o.skip.includes(name)) return;
    const list = open[name] || [];
    const holes = list.map((p) => [p.x - p.w / 2, p.y, p.x + p.w / 2, p.y + p.h]);
    for (const band of bands) {
      const g = band.grow || 0;
      K.push().rotY((i * Math.PI) / 2).move(0, 0, half + g);
      K.color(band.col);
      const top = o.eaveTop && (o.eaves || []).includes(name) ? o.eaveTop : null;
      const inBand = holes.filter((h) => h[1] < band.y1 && h[3] > band.y0);
      K.wall(-W / 2 - g, W / 2 + g, band.y0, band.y1, inBand, band.layer, {
        ybreaks: [band.y0 + 1.0, top ? top - 1.0 : band.y1 - 0.6], ao: top ? eaveAO(top) : () => 1, tile: band.tile,
      });
      for (const p of list) {
        if (p.y >= band.y0 - 0.01 && p.y < band.y1) opening(B, { wallLayer: band.layer, wallCol: band.col, ...p });
      }
      K.pop();
    }
  });
}

// Chaînage d'angle en pierre de taille (harpes alternées) sur les quatre arêtes verticales.
function quoins(B, w, d, y0, y1, col) {
  const K = B.kit;
  K.color(col);
  const h = 0.42;
  const out = 0.035;
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const cx = (sx * w) / 2;
    const cz = (sz * d) / 2;
    let k = 0;
    for (let y = y0; y < y1 - 0.05; y += h, k++) {
      const yt = Math.min(y1, y + h - 0.035);
      const a = k % 2 ? 0.46 : 0.26;
      const b = k % 2 ? 0.26 : 0.46;
      // Pierre sur la façade avant / arrière, puis sur la façade latérale
      const xa = cx - sx * a;
      const xb = cx + sx * out;
      K.box(Math.min(xa, xb), y, Math.min(cz - sz * 0.02, cz + sz * out), Math.max(xa, xb), yt, Math.max(cz - sz * 0.02, cz + sz * out), L.ASHLAR, { skip: sz > 0 ? 'ny nz' : 'ny pz' });
      const za = cz - sz * b;
      K.box(Math.min(cx - sx * 0.02, cx + sx * out), y, Math.min(za, cz), Math.max(cx - sx * 0.02, cx + sx * out), yt, Math.max(za, cz), L.ASHLAR, { skip: sx > 0 ? 'ny nx' : 'ny px' });
    }
  }
}

// =====================================================================
// Toits épais (faîtage le long de Z dans le repère du toit)
// =====================================================================

// r : { w (largeur entre murs, en X), d (longueur entre pignons, en Z), wallH, prof (profil de sous-face pour
//       x > 0, de l'égout vers le faîtage : [[x, y], ..., [0, yFaîtage]]), ohG (débord de pignon), t (épaisseur),
//       layer, col, fascia, soffit, cap, gable: { layer, col } | null, gableOpen: [...] }
export function roof(B, r) {
  const K = B.kit;
  const P = r.prof;
  const t = r.t ?? 0.22;
  const Lz = r.d / 2 + (r.ohG ?? 0.4);
  const n = P.length;
  // Normales des segments (vers le haut et l'extérieur) et sommets décalés de l'épaisseur
  const segN = [];
  for (let j = 0; j < n - 1; j++) {
    const dx = P[j + 1][0] - P[j][0];
    const dy = P[j + 1][1] - P[j][1];
    const l = Math.hypot(dx, dy);
    segN.push([dy / l, -dx / l]);
  }
  const top = P.map((p, j) => {
    if (j === 0) return [p[0] + segN[0][0] * t, p[1] + segN[0][1] * t];
    if (j === n - 1) return [0, p[1] + t / segN[n - 2][1]];
    const a = segN[j - 1];
    const b = segN[j];
    let mx = a[0] + b[0];
    let my = a[1] + b[1];
    const ml = Math.hypot(mx, my);
    mx /= ml;
    my /= ml;
    const k = t / (mx * b[0] + my * b[1]);
    return [p[0] + mx * k, p[1] + my * k];
  });
  for (const s of [1, -1]) {
    const q = (pts, layer, o) => K.face(s > 0 ? pts : pts.slice().reverse(), layer, o);
    for (let j = 0; j < n - 1; j++) {
      const A = [s * P[j][0], P[j][1]];
      const Bb = [s * P[j + 1][0], P[j + 1][1]];
      const A2 = [s * top[j][0], top[j][1]];
      const B2 = [s * top[j + 1][0], top[j + 1][1]];
      // Dessus (couverture), rangées calées sur l'égout
      K.color(r.col);
      const aoTop = j === 0 ? [0.92, 1, 1, 0.92] : 1;
      q([[A2[0], A2[1], -Lz], [B2[0], B2[1], -Lz], [B2[0], B2[1], Lz], [A2[0], A2[1], Lz]], r.layer, { v0At: [A2[0], A2[1], -Lz], ao: s > 0 ? aoTop : [0.92, 1, 1, 0.92].reverse() });
      // Sous-face (voliges), sombre
      K.color(r.soffit || tint('#8a6a4a'));
      q([[A[0], A[1], Lz], [Bb[0], Bb[1], Lz], [Bb[0], Bb[1], -Lz], [A[0], A[1], -Lz]], L.WOODH, { ao: 0.5, scale: 0.6 });
      // Rives (planches de bord) aux deux pignons
      K.color(r.fascia || r.col);
      const fl = r.fasciaLayer ?? L.WOODV;
      q([[A2[0], A2[1], Lz], [B2[0], B2[1], Lz], [Bb[0], Bb[1], Lz], [A[0], A[1], Lz]], fl, { ao: 0.85, scale: 0.5 });
      q([[A[0], A[1], -Lz], [Bb[0], Bb[1], -Lz], [B2[0], B2[1], -Lz], [A2[0], A2[1], -Lz]], fl, { ao: 0.85, scale: 0.5 });
    }
    // Planche d'égout
    const A = [s * P[0][0], P[0][1]];
    const A2 = [s * top[0][0], top[0][1]];
    K.color(r.fascia || r.col);
    q([[A[0], A[1], Lz], [A[0], A[1], -Lz], [A2[0], A2[1], -Lz], [A2[0], A2[1], Lz]], r.fasciaLayer ?? L.WOODV, { ao: 0.8, scale: 0.5 });
  }
  // Pignons (sous la sous-face, entre les murs)
  if (r.gable) {
    const inner = P.filter((p) => p[0] < r.w / 2 - 1e-3);
    const ring = [[-r.w / 2, r.wallH], [r.w / 2, r.wallH], ...inner.map((p) => [p[0], p[1]]), ...inner.slice(0, -1).reverse().map((p) => [-p[0], p[1]])];
    K.color(r.gable.col);
    for (const z of [r.d / 2, -r.d / 2]) {
      const pts = ring.map(([x, y]) => [x, y, z]);
      const peak = P[n - 1][1];
      const aoFn = (p) => 1 - 0.3 * smoothstep(r.wallH, peak, p[1]) * 0.6;
      K.poly(z > 0 ? pts : pts.slice().reverse(), r.gable.layer, { aoFn, tile: r.gable.tile });
    }
  }
  // Faîtage (tuiles faîtières en demi-cylindre)
  if (r.cap !== false) {
    const yr = top[n - 1][1];
    const rad = r.capR ?? 0.16;
    K.color(r.cap || r.col.map((c) => c * 0.82));
    K.push().move(0, yr - rad * 0.45, 0).rotX(Math.PI / 2);
    K.cyl(0, -Lz - 0.04, 0, rad, rad, Lz * 2 + 0.08, 6, r.capLayer ?? r.layer, { a0: Math.PI, arc: Math.PI, caps: 'tb', tile: 1 });
    K.pop();
  }
  return { ridgeY: top[n - 1][1], top };
}

// Profil d'un toit à deux pans : pente p (hauteur / demi-largeur), débord d'égout oh.
export const gableProfile = (w, wallH, p, oh) => [[w / 2 + oh, wallH - oh * p], [0, wallH + (w / 2) * p]];

// Cheminée en pierre ou enduite, chapeau, fumée éventuelle.
function chimney(B, x, z, y0, y1, o = {}) {
  const K = B.kit;
  const w = o.w ?? 0.7;
  const d = o.d ?? 0.6;
  K.color(o.col || tint('#c9c0b0'));
  K.box(x - w / 2, y0, z - d / 2, x + w / 2, y1, z + d / 2, o.layer ?? L.STONE, { skip: 'ny', ao: { b: 0.7, t: 1 } });
  K.color(tint('#6e6a64'));
  K.box(x - w / 2 - 0.08, y1, z - d / 2 - 0.08, x + w / 2 + 0.08, y1 + 0.12, z + d / 2 + 0.08, L.ASHLAR, { skip: '' });
  K.color(DARK);
  K.box(x - w / 2 + 0.12, y1 + 0.12, z - d / 2 + 0.12, x + w / 2 - 0.12, y1 + 0.2, z + d / 2 - 0.12, L.PLAIN, { skip: 'ny' });
  if (o.cap) {
    K.color(o.cap);
    for (const s of [-1, 1]) K.box(x - w / 2 - 0.05 + (s > 0 ? w - 0.05 : 0), y1 + 0.12, z - 0.05, x - w / 2 + (s > 0 ? w + 0.05 : 0.1), y1 + 0.45, z + 0.05, L.ASHLAR);
    K.box(x - w / 2 - 0.12, y1 + 0.45, z - d / 2 - 0.12, x + w / 2 + 0.12, y1 + 0.55, z + d / 2 + 0.12, L.SLATE, { skip: '' });
  }
  if (o.smoke) B.smoke(x, y1 + 0.4, z);
}

// Lucarne sur le pan avant (repère du toit, faîtage le long de Z, pan x > 0) : jouées, fenêtre, petit toit.
function dormer(B, xFront, z, yBase, w, h, o) {
  const K = B.kit;
  const depth = 2.2;
  // Façade de la lucarne (plan x = xFront, normale +X)
  K.push().move(xFront, 0, z).rotY(Math.PI / 2);
  K.color(o.wallCol);
  const hole = [[-w / 2 + 0.18, yBase + 0.15, w / 2 - 0.18, yBase + h - 0.05]];
  K.wall(-w / 2, w / 2, yBase - 0.6, yBase + h, hole, o.wallLayer, {});
  opening(B, { x: 0, y: yBase + 0.15, w: w - 0.36, h: h - 0.2, dp: 0.1, wallLayer: o.wallLayer, wallCol: o.wallCol, frame: o.frame, panes: [2, 2], sill: false });
  K.pop();
  // Jouées (côtés)
  K.color(o.wallCol);
  for (const s of [-1, 1]) {
    const zz = z + (s * w) / 2;
    const pts = [[xFront, yBase - 0.6, zz], [xFront - depth, yBase - 0.6, zz], [xFront - depth, yBase + h, zz], [xFront, yBase + h, zz]];
    K.face(s > 0 ? pts : pts.slice().reverse(), o.wallLayer);
  }
  // Toit à deux pans de la lucarne (faîtage le long de X)
  K.push().move(xFront - depth / 2, 0, z).rotY(Math.PI / 2);
  roof(B, { w, d: depth, wallH: yBase + h, prof: gableProfile(w, yBase + h, 0.8, 0.18), ohG: 0.22, t: 0.14, layer: o.roofLayer, col: o.roofCol, fascia: o.fascia, gable: { layer: o.wallLayer, col: o.wallCol }, capR: 0.1 });
  K.pop();
}

// =====================================================================
// Maison de campagne (Vallée Verte) et corps de ferme
// =====================================================================

export function cottage(B, x, y, z, yaw, r, o = {}) {
  const K = B.begin(x, y, z, yaw, r());
  const longere = o.kind ? o.kind === 'longere' : r() < 0.42;
  const w = longere ? 9.5 + r() * 2 : 7.6 + r() * 1.4;
  const d = longere ? 6.0 + r() * 0.6 : 6.4 + r() * 0.8;
  const wallH = longere ? 3.0 : 5.7;
  const stone = o.stone ?? r() < 0.32;
  const wallCol = stone ? vary(r, pick(r, STONES), 0.05) : vary(r, pick(r, PLASTERS), 0.03);
  const wallLayer = stone ? L.STONE : L.PLASTER;
  const slate = r() < 0.22;
  const roofCol = slate ? vary(r, pick(r, SLATES), 0.06) : vary(r, pick(r, TILES), 0.06);
  const roofLayer = slate ? L.SLATE : L.TILE;
  const pitch = longere ? 0.9 + r() * 0.15 : 0.72 + r() * 0.14;
  const shut = tint(pick(r, SHUTTERS));
  const frame = r() < 0.75 ? WHITE : shut.map((c) => Math.min(1, c * 1.15));
  const surround = !stone && r() < 0.6 ? vary(r, '#e2dccd', 0.04) : null;
  const plinthH = 0.55;
  const plinthCol = vary(r, '#a8a090', 0.06);
  const flowerPal = [pick(r, FLOWERS), pick(r, FLOWERS), '#e0384b'];
  // Socle
  K.color(plinthCol);
  K.box(-w / 2 - 0.06, -1.6, -d / 2 - 0.06, w / 2 + 0.06, plinthH, d / 2 + 0.06, L.STONE, { skip: 'ny', ao: { b: 0.8, t: 1 } });
  K.color(plinthCol.map((c) => c * 1.1));
  K.box(-w / 2 - 0.1, plinthH - 0.06, -d / 2 - 0.1, w / 2 + 0.1, plinthH + 0.04, d / 2 + 0.1, L.ASHLAR, { skip: 'ny' });
  // Ouvertures de la façade (fenêtres régulières, porte)
  const floorsY = longere ? [plinthH + 0.45] : [plinthH + 0.45, 3.4];
  const nWin = Math.max(2, Math.floor((w - 1.4) / 1.9));
  const doorSlot = Math.floor(r() * nWin);
  const front = [];
  const back = [];
  const win = (xx, yy, ww = 0.95, hh = 1.25) => ({
    x: xx, y: yy, w: ww, h: hh, frame, panes: [2, 3], shutters: shut, surround, box: r() < 0.55 ? flowerPal : null,
    sillCol: stone ? tint('#cfc6b6') : tint('#d9d2c4'), dp: stone ? 0.22 : 0.15,
  });
  for (let i = 0; i < nWin; i++) {
    const xx = -w / 2 + ((i + 0.5) * w) / nWin;
    if (i === doorSlot) front.push({ x: xx, y: plinthH, w: 1.05, h: 2.15, door: tint(pick(r, ['#5a3a26', '#3f5a6e', '#6a2f2a', '#47603e', '#7a5a3a'])), frame, surround, transom: r() < 0.5, glass: tint('#7f9fb5'), stepCol: plinthCol });
    else front.push(win(xx, floorsY[0]));
    if (!longere) front.push(win(xx, floorsY[1], 0.9, 1.15));
    if (r() < 0.6) back.push(win(xx, floorsY[0], 0.8, 1.0));
  }
  const side = [];
  if (!longere) side.push(win(0, floorsY[1], 0.8, 1.0));
  walls(B, w, d, [{ y0: plinthH, y1: wallH, layer: wallLayer, col: wallCol }], { front, back, right: side, left: r() < 0.5 ? side : [] }, { eaves: ['front', 'back'], eaveTop: wallH });
  if (!stone && r() < 0.55) quoins(B, w, d, plinthH, wallH, vary(r, '#ddd5c5', 0.04));
  // Bandeau d'étage
  if (!longere) {
    K.color(surround || tint('#ddd5c5'));
    K.box(-w / 2 - 0.05, 3.05, -d / 2 - 0.05, w / 2 + 0.05, 3.2, d / 2 + 0.05, L.ASHLAR, { skip: 'ny' });
  }
  // Toit (faîtage parallèle à la façade : repère du toit tourné)
  const ohE = 0.45;
  K.push().rotY(-Math.PI / 2);
  const rf = roof(B, { w: d, d: w, wallH, prof: gableProfile(d, wallH, pitch, ohE), ohG: 0.3, t: 0.2, layer: roofLayer, col: roofCol, fascia: frame === WHITE ? tint('#e8e2d6') : tint('#6e5038'), gable: { layer: wallLayer, col: wallCol }, soffit: tint('#9a7a5a') });
  // Lucarnes de la longère
  if (longere && r() < 0.8) {
    const nd = r() < 0.5 ? 1 : 2;
    for (let i = 0; i < nd; i++) {
      const zz = nd === 1 ? 0 : (i - 0.5) * w * 0.45;
      dormer(B, d / 2 - 0.25, zz, wallH + 0.1, 1.3, 1.3, { wallLayer, wallCol, frame, roofLayer, roofCol, fascia: tint('#e8e2d6') });
    }
  }
  K.pop();
  // Cheminées aux pignons
  const smoke = o.smoke ?? r() < 0.6;
  const nc = r() < 0.4 ? 2 : 1;
  for (let i = 0; i < nc; i++) {
    const cx = (i === 0 ? 1 : -1) * (w / 2 - 0.55);
    chimney(B, cx, -d * 0.12, wallH, rf.ridgeY + 0.75, { col: stone ? wallCol : vary(r, '#d8cfbf', 0.04), smoke: smoke && i === 0, layer: stone ? L.STONE : L.PLASTER, w: 0.75, d: 0.62 });
  }
  // Appentis sur un côté (bûcher, remise)
  if (o.annex ?? r() < 0.35) {
    const aw = 3.0;
    const ah = 2.4;
    const ad = d - 1.0;
    const s = r() < 0.5 ? 1 : -1;
    const annexCol = vary(r, '#8a6440', 0.08);
    K.push().move(s * (w / 2 + aw / 2), 0, -0.4);
    K.color(plinthCol);
    K.box(-aw / 2, -1.2, -ad / 2, aw / 2, 0.3, ad / 2, L.STONE, { skip: 'ny' });
    walls(B, aw, ad, [{ y0: 0.3, y1: ah, layer: L.WOODV, col: annexCol }], {
      front: [{ x: 0, y: 0.3, w: 1.6, h: 1.85, door: vary(r, '#6a4a30', 0.1), frame: tint('#5a3e28'), step: false }],
    }, { skip: [s > 0 ? 'left' : 'right'] });
    const xi = -s * aw / 2;
    const xo = s * (aw / 2 + 0.35);
    const yh = ah + aw * 0.32;
    const yl = ah - 0.12;
    const Z = ad / 2 + 0.25;
    K.color(roofCol);
    K.slab([[xi, yh, -Z], [xi, yh, Z], [xo, yl, Z], [xo, yl, -Z]], 0.15, roofLayer, { under: tint('#8a6a4a'), edge: tint('#6e5038'), v0At: [xo, yl, -Z] });
    K.color(annexCol);
    for (const zz of [ad / 2, -ad / 2]) K.face([[s * aw / 2, ah, zz], [xi, ah, zz], [xi, yh - 0.16, zz]], L.WOODV, { out: [0, 0, zz] });
    K.pop();
  }
  // Détails : banc, bûches, gouttières, lanterne, boîte aux lettres
  B.detail();
  const zf = d / 2;
  K.color(tint('#8a6a48'));
  const bx = front.find((p) => p.door)?.x ?? 0;
  const bench = bx + (bx > 0 ? -1.6 : 1.6);
  K.box(bench - 0.7, 0.42, zf + 0.25, bench + 0.7, 0.48, zf + 0.62, L.WOODH, { skip: '' });
  for (const s of [-0.6, 0.6]) K.box(bench + s - 0.04, 0, zf + 0.28, bench + s + 0.04, 0.42, zf + 0.6, L.WOODH);
  K.box(bench - 0.7, 0.48, zf + 0.2, bench + 0.7, 0.9, zf + 0.25, L.WOODH);
  K.color(tint('#8a8f96'));
  for (const s of [-1, 1]) K.cyl(s * (w / 2 - 0.12), 0.1, zf + 0.12, 0.05, 0.05, wallH - 0.25, 6, L.PLAIN, { caps: '' });
  K.push().move(0, wallH - ohE * pitch - 0.06, zf + ohE - 0.04).rotZ(Math.PI / 2);
  K.cyl(0, -w / 2 - 0.3, 0, 0.07, 0.07, w + 0.6, 6, L.PLAIN, { caps: '', a0: Math.PI / 2, arc: Math.PI });
  K.pop();
  if (r() < 0.6) {
    K.color(tint('#6a4a2a'));
    const s = -Math.sign(bx || 1);
    K.push().move(s * (w / 2 + 0.5), 0, -0.6).rotY(Math.PI / 2);
    K.box(-1.2, 0, -0.3, 1.2, 1.3, 0.3, L.LOGS, { skip: 'ny' });
    K.color(roofCol);
    K.box(-1.35, 1.3, -0.45, 1.35, 1.38, 0.45, roofLayer, { skip: '' });
    K.pop();
  }
  K.color(IRON);
  K.box(bx + 0.75, 2.2, zf, bx + 0.8, 2.35, zf + 0.25, L.PLAIN);
  K.color(tint('#ffe9a8'));
  K.cbox(bx + 0.78, 1.95, zf + 0.25, 0.16, 0.25, 0.16, L.GLASS, { skip: '' });
  // Lierre grimpant sur un angle de la façade
  if (r() < 0.35) {
    const ix = (bx > 0 ? -1 : 1) * (w / 2 - 0.5);
    const top = wallH * (0.55 + r() * 0.35);
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      K.color(tint(LEAF, 0.7 + r() * 0.5));
      K.blob(ix + (r() - 0.5) * (1.4 - t * 0.6), plinthH + t * (top - plinthH), zf + 0.08 + r() * 0.08, 0.22 + r() * 0.12, L.PLAIN, 0.8);
    }
  }
  B.shell();
  // Marquise au-dessus de la porte
  if (r() < 0.45) {
    const yc = plinthH + 2.45;
    K.color(roofCol);
    K.slab([[bx - 0.85, yc + 0.28, zf], [bx + 0.85, yc + 0.28, zf], [bx + 0.85, yc, zf + 0.85], [bx - 0.85, yc, zf + 0.85]], 0.08, roofLayer, { under: tint('#f0ebe0'), edge: tint('#6e5038') });
    K.color(IRON);
    for (const s of [-0.75, 0.75]) K.rod([bx + s, yc - 0.45, zf], [bx + s, yc - 0.02, zf + 0.75], 0.02, 4, L.PLAIN);
  }
  return { w, d, wallH };
}

export function farmhouse(B, x, y, z, yaw, r) {
  return cottage(B, x, y, z, yaw, r, { kind: 'maison', stone: true, smoke: true, annex: true });
}

// =====================================================================
// Ferme : grange rouge à toit brisé, silo, tracteur, bottes de foin
// =====================================================================

export function barn(B, x, y, z, yaw, r, o = {}) {
  const K = B.begin(x, y, z, yaw, r());
  const w = 12;
  const d = 15;
  const wallH = 5.2;
  const red = vary(r, '#a3342a', 0.05);
  const trim = tint('#f1ece2');
  const roofCol = vary(r, '#5b5f66', 0.05);
  // Fondations
  K.color(tint('#a39b8c'));
  K.box(-w / 2 - 0.1, -1.6, -d / 2 - 0.1, w / 2 + 0.1, 0.6, d / 2 + 0.1, L.STONE, { skip: 'ny', ao: { b: 0.8, t: 1 } });
  const front = [
    { x: 0, y: 0.6, w: 4.4, h: 4.2, door: red, frame: trim, step: false, dp: 0.25 },
  ];
  const sideWins = [-4.5, -1.5, 1.5, 4.5].map((xx) => ({ x: xx, y: 2.3, w: 0.9, h: 0.9, frame: trim, panes: [2, 2], glass: tint('#6f8798'), sill: false, surround: trim, surroundW: 0.12, surroundLayer: L.PLAIN }));
  const prof = [[w / 2 + 0.5, wallH - 0.5 * 1.35], [w / 2 * 0.58, wallH + (w / 2 * 0.42) * 1.35], [0, wallH + (w / 2 * 0.42) * 1.35 + (w / 2 * 0.58) * 0.42]];
  walls(B, w, d, [{ y0: 0.6, y1: wallH, layer: L.WOODV, col: red }], { front, right: sideWins, left: sideWins, back: [{ x: 0, y: 0.6, w: 3.2, h: 3.4, door: red, frame: trim, step: false }] }, { eaves: ['right', 'left'], eaveTop: wallH });
  // Grandes portes : croix de Saint-André et cadres blancs
  K.color(trim);
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -2.2 : 0;
    const x1 = s < 0 ? 0 : 2.2;
    const zf = d / 2 - 0.25 + 0.03;
    K.box(x0, 0.6, zf, x0 + 0.16, 4.8, zf + 0.06, L.PLAIN);
    K.box(x1 - 0.16, 0.6, zf, x1, 4.8, zf + 0.06, L.PLAIN);
    K.box(x0, 0.6, zf, x1, 0.76, zf + 0.06, L.PLAIN);
    K.box(x0, 4.64, zf, x1, 4.8, zf + 0.06, L.PLAIN);
    K.box(x0, 2.62, zf, x1, 2.78, zf + 0.06, L.PLAIN);
    const L2 = Math.hypot(2.2 - 0.3, 1.86);
    for (const [ya, yb] of [[0.76, 2.62], [2.78, 4.64]]) {
      const a = Math.atan2(yb - ya, x1 - x0 - 0.32);
      for (const sg of [1, -1]) {
        K.push().move((x0 + x1) / 2, (ya + yb) / 2, zf + 0.03).rotZ(sg * a);
        K.box(-L2 / 2, -0.07, 0, L2 / 2, 0.07, 0.05, L.PLAIN, { skip: 'nz' });
        K.pop();
      }
    }
  }
  // Porte du fenil (en applique sur le pignon), foin visible
  K.color(tint('#1e1712'));
  K.face([[-1.0, 6.2, d / 2 + 0.01], [1.0, 6.2, d / 2 + 0.01], [1.0, 7.9, d / 2 + 0.01], [-1.0, 7.9, d / 2 + 0.01]], L.PLAIN, { ao: 0.6 });
  K.color(tint('#e9c46a'));
  K.box(-0.95, 6.2, d / 2 - 0.1, 0.95, 6.95, d / 2 + 0.12, L.STRAW, { skip: 'ny nz' });
  K.color(trim);
  K.box(-1.15, 6.05, d / 2, 1.15, 6.2, d / 2 + 0.1, L.PLAIN);
  K.box(-1.15, 7.9, d / 2, 1.15, 8.05, d / 2 + 0.1, L.PLAIN);
  K.box(-1.15, 6.2, d / 2, -1.0, 7.9, d / 2 + 0.1, L.PLAIN);
  K.box(1.0, 6.2, d / 2, 1.15, 7.9, d / 2 + 0.1, L.PLAIN);
  // Planches d'angle blanches
  K.color(trim);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const xa = sx * (w / 2 + 0.05);
    const xb = sx * (w / 2 - 0.22);
    const za = sz * (d / 2 + 0.05);
    const zb = sz * (d / 2 - 0.22);
    K.box(Math.min(xa, xb), 0.6, Math.min(za, zb), Math.max(xa, xb), wallH, Math.max(za, zb), L.PLAIN, { skip: 'ny py' });
  }
  // Toit brisé (à la Mansart)
  const rf = roof(B, { w, d, wallH, prof, ohG: 0.45, t: 0.24, layer: L.METAL, col: roofCol, fascia: trim, fasciaLayer: L.PLAIN, gable: { layer: L.WOODV, col: red }, soffit: tint('#7a5a40'), capLayer: L.METAL, capR: 0.18 });
  // Lanterneau d'aération et girouette
  const ry = rf.ridgeY;
  K.color(trim);
  K.cbox(0, ry - 0.3, 0, 1.4, 1.3, 1.4, L.WOODV, { skip: 'ny', scale: 0.5 });
  K.color(DARK);
  for (let i = 0; i < 4; i++) {
    K.push().rotY((i * Math.PI) / 2);
    K.box(-0.45, ry + 0.25, 0.7, 0.45, ry + 0.85, 0.72, L.PLAIN);
    K.pop();
  }
  K.push().move(0, 0, 0);
  roof(B, { w: 1.4, d: 1.4, wallH: ry + 1.0, prof: gableProfile(1.4, ry + 1.0, 0.8, 0.2), ohG: 0.15, t: 0.1, layer: L.METAL, col: roofCol, fascia: trim, fasciaLayer: L.PLAIN, gable: { layer: L.WOODV, col: trim }, capR: 0.06 });
  K.pop();
  B.detail();
  K.color(IRON);
  K.rod([0, ry + 1.6, 0], [0, ry + 3.0, 0], 0.03, 4, L.PLAIN);
  K.rod([-0.5, ry + 2.5, 0], [0.5, ry + 2.5, 0], 0.015, 3, L.PLAIN);
  K.rod([0, ry + 2.5, -0.5], [0, ry + 2.5, 0.5], 0.015, 3, L.PLAIN);
  K.push().move(0, ry + 2.75, 0);
  K.board([[0, 0.05], [0.12, 0.2], [0.25, 0.16], [0.36, 0.06]], 0.03, L.PLAIN);
  K.pop();
  // Poulie du fenil
  K.color(tint('#6a4a30'));
  K.box(-0.1, 8.4, d / 2 - 0.2, 0.1, 8.6, d / 2 + 1.3, L.WOODH);
  K.color(IRON);
  K.rod([0, 8.4, d / 2 + 1.15], [0, 6.9, d / 2 + 1.15], 0.012, 3, L.PLAIN);
  B.shell();
  // Appentis ouvert sur un côté, rempli de bottes
  const lean = o.lean ?? 1;
  K.push().move(lean * (w / 2 + 2.2), 0, -2.5).rotY(lean > 0 ? 0 : Math.PI);
  K.color(tint('#6e4c30'));
  for (const zz of [-3.5, 0, 3.5]) K.box(1.85, 0, zz - 0.12, 2.1, 3.0, zz + 0.12, L.WOODV);
  K.color(roofCol);
  K.slab([[-2.2, 4.3, -4.0], [-2.2, 4.3, 4.0], [2.6, 3.0, 4.0], [2.6, 3.0, -4.0]], 0.12, L.METAL, { under: tint('#7a5a40'), edge: trim, edgeLayer: L.PLAIN, v0At: [2.6, 3.0, -4.0] });
  K.color(tint('#e9c46a'));
  for (let i = 0; i < 6; i++) K.box(-1.6 + (i % 2) * 1.6, Math.floor(i / 2) * 0.8, -3 + (i % 3) * 0.1, -0.1 + (i % 2) * 1.6, Math.floor(i / 2) * 0.8 + 0.78, 3 - (i % 3) * 0.1, L.STRAW, { skip: '' });
  K.pop();
  return rf;
}

export function silo(B, x, y, z, r) {
  const K = B.begin(x, y, z, r() * 6.28, r());
  const R = 2.2;
  const H = 11.5;
  K.color(tint('#b7b0a2'));
  K.cyl(0, -1.2, 0, R + 0.35, R + 0.35, 1.7, 20, L.CONCRETE, { caps: 't', ao: { b: 0.8, t: 1 } });
  K.color(vary(r, '#c6ced6', 0.04));
  K.cyl(0, 0.5, 0, R, R, H, 24, L.METAL, { caps: '', ao: { b: 0.75, t: 1 }, scale: 1.2 });
  K.color(tint('#8a96a3'));
  for (let yy = 1.5; yy < H; yy += 2.4) K.cyl(0, yy, 0, R + 0.04, R + 0.04, 0.12, 24, L.PLAIN, { caps: '' });
  K.color(tint('#9aa6b2'));
  K.push().move(0, H + 0.5, 0);
  const dome = [];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    dome.push([Math.cos(a) * (R + 0.12), Math.sin(a) * 1.6]);
  }
  dome[6] = [0.001, 1.6];
  K.lathe(dome, 24, L.METAL, { ao: (t) => 1 - (1 - t) * 0.15 });
  K.color(tint('#6a737d'));
  K.cyl(0, 1.5, 0, 0.45, 0.4, 0.4, 10, L.PLAIN, { caps: 't' });
  K.pop();
  // Échelle à crinoline
  B.detail();
  K.color(tint('#7d858d'));
  const lz = R + 0.25;
  for (const s of [-0.25, 0.25]) K.rod([s, 0.5, lz], [s, H + 1.2, lz], 0.025, 4, L.PLAIN);
  for (let yy = 0.8; yy < H + 1.1; yy += 0.35) K.rod([-0.25, yy, lz], [0.25, yy, lz], 0.015, 3, L.PLAIN);
  for (let yy = 2.5; yy < H + 1.1; yy += 1.2) {
    K.push().move(0, yy, lz + 0.35);
    K.cyl(0, 0, 0, 0.42, 0.42, 0.05, 8, L.PLAIN, { caps: '', a0: Math.PI * 1.05, arc: Math.PI * 0.9 });
    K.pop();
  }
  B.shell();
}

// Tracteur (pièces peintes)
export function tractor(B, x, y, z, yaw) {
  const K = B.begin(x, y, z, yaw);
  const green = tint('#2f8f3a');
  K.color(green);
  K.box(-0.6, 0.55, -0.9, 0.6, 1.45, 1.3, L.PLAIN, { skip: '' });
  K.box(-0.5, 1.45, -1.0, 0.5, 2.05, 0.2, L.PLAIN);
  K.color(tint('#1f5f27'));
  K.box(-0.68, 2.2, -1.1, 0.68, 2.3, 0.3, L.PLAIN, { skip: '' });
  K.color(tint('#1d1e22'));
  for (const xx of [-0.6, 0.6]) for (const zz of [-1.0, 0.2]) K.box(xx - 0.03, 1.45, zz - 0.03, xx + 0.03, 2.2, zz + 0.03, L.PLAIN);
  K.color(tint('#a8d4ee'));
  K.face([[-0.5, 1.5, 0.21], [0.5, 1.5, 0.21], [0.5, 2.1, 0.21], [-0.5, 2.1, 0.21]], L.GLASS, { fit: [0, 0, 1, 1] });
  K.color(tint('#3a3a3a'));
  K.cyl(0.35, 1.45, 0.95, 0.06, 0.05, 0.8, 6, L.PLAIN);
  for (const s of [-1, 1]) {
    K.push().move(s * 0.78, 0.72, -0.6).rotZ(Math.PI / 2);
    K.color(tint('#1d1e22'));
    K.cyl(0, -0.21, 0, 0.72, 0.72, 0.42, 16, L.PLAIN, { caps: 'tb' });
    K.color(tint('#e2b43c'));
    K.cyl(0, -0.24, 0, 0.36, 0.36, 0.48, 10, L.PLAIN, { caps: 'tb' });
    K.pop();
    K.push().move(s * 0.68, 0.42, 0.95).rotZ(Math.PI / 2);
    K.color(tint('#1d1e22'));
    K.cyl(0, -0.15, 0, 0.42, 0.42, 0.3, 12, L.PLAIN, { caps: 'tb' });
    K.color(tint('#e2b43c'));
    K.cyl(0, -0.17, 0, 0.2, 0.2, 0.34, 8, L.PLAIN, { caps: 'tb' });
    K.pop();
  }
}

// Botte de foin ronde (couchée, axe le long de X)
export function hayBale(B, x, y, z, yaw) {
  const K = B.begin(x, y, z, yaw);
  K.color(tint('#e7c35e'));
  K.push().move(0, 0.75, 0).rotZ(Math.PI / 2);
  K.cyl(0, -0.6, 0, 0.75, 0.75, 1.2, 14, L.STRAW, { caps: 'tb', tile: 1.2 });
  K.pop();
}

// =====================================================================
// Col des Chalets : chalets, église à bulbe, fontaine, café
// =====================================================================

// Garde-corps sculpté (planches découpées) le long de x0..x1 à la hauteur y (repère courant).
function carvedRail(B, x0, x1, y, z, col, h = 1.0) {
  const K = B.kit;
  K.color(col);
  // Lisses haute et basse (toujours visibles)
  K.box(x0, y + h - 0.12, z - 0.06, x1, y + h, z + 0.06, L.WOODH, { skip: '', scale: 0.5 });
  K.box(x0, y, z - 0.05, x1, y + 0.1, z + 0.05, L.WOODH, { skip: '', scale: 0.5 });
  B.detail();
  const bw = 0.2;
  const n = Math.max(2, Math.floor((x1 - x0) / bw));
  const step = (x1 - x0) / n;
  const hb = h - 0.22;
  // Planches découpées : les vides entre elles dessinent des motifs (cœurs, losanges)
  const prof = B.lite ? [[0, 0.095], [hb * 0.5, 0.04], [hb, 0.095]] : [[0, 0.085], [hb * 0.28, 0.095], [hb * 0.5, 0.04], [hb * 0.72, 0.095], [hb, 0.085]];
  for (let i = 0; i < n; i++) {
    K.push().move(x0 + (i + 0.5) * step, y + 0.1, z);
    K.board(prof, 0.035, L.WOODV, { scale: 0.4, front: true });
    K.pop();
  }
  B.shell();
}

export function chalet(B, x, y, z, yaw, r, o = {}) {
  const K = B.begin(x, y, z, yaw, r());
  const w = 7.6 + r() * 1.6;
  const d = 8.0 + r() * 1.4;
  const g0 = 2.7;
  const floors = r() < 0.45 ? 2 : 1;
  const wallH = g0 + floors * 2.5;
  const wood = vary(r, pick(r, WOODS), 0.06);
  const stoneCol = vary(r, pick(r, ['#bdb6aa', '#c9c1b2', '#b0a898', '#d4cdc0']), 0.04);
  const plasterGround = r() < 0.35;
  const groundLayer = plasterGround ? L.PLASTER : L.STONE;
  const groundCol = plasterGround ? vary(r, '#efe7d6', 0.03) : stoneCol;
  const shingle = r() < 0.5;
  const roofLayer = shingle ? L.SHINGLE : L.SLATE;
  const roofCol = shingle ? vary(r, '#7a6a5c', 0.1) : vary(r, '#7c7d80', 0.08);
  const pitch = 0.42 + r() * 0.1;
  const shut = tint(pick(r, ['#3f6f3f', '#a2463a', '#2f5a7a', '#d9d3c2', '#5b6d48', '#7a2f2a']));
  const frame = r() < 0.6 ? tint('#f2ede2') : wood.map((c) => c * 0.8);
  const flowerPal = r() < 0.6 ? ['#e0384b', '#ff4f6a', '#c4202f'] : ['#ff6fa0', '#e0384b', '#f2f2f2'];
  const balDepth = 1.25;
  // Socle
  K.color(stoneCol.map((c) => c * 0.92));
  K.box(-w / 2 - 0.08, -2.2, -d / 2 - 0.08, w / 2 + 0.08, 0.35, d / 2 + 0.08, L.STONE, { skip: 'ny', ao: { b: 0.8, t: 1 } });
  // Ouvertures
  const front = [];
  const back = [];
  const side = [];
  const sideB = [];
  const doorFront = r() < 0.6;
  const stoneWin = (xx) => ({ x: xx, y: 1.05, w: 0.75, h: 0.95, frame, panes: [2, 2], dp: plasterGround ? 0.18 : 0.3, sillCol: tint('#cfc8ba'), surround: plasterGround ? tint('#d8d0c0') : null, shutters: plasterGround ? shut : null, box: r() < 0.5 ? flowerPal : null });
  if (doorFront) {
    front.push({ x: -w * 0.22, y: 0.35, w: 1.1, h: 2.1, door: wood.map((c) => c * 0.75), frame: wood.map((c) => c * 0.6), step: true, stepCol: stoneCol, surround: plasterGround ? null : tint('#d6cfc0'), surroundW: 0.2 });
    front.push(stoneWin(w * 0.22));
  } else {
    front.push(stoneWin(-w * 0.22), stoneWin(w * 0.22));
    side.push({ x: d * 0.2, y: 0.35, w: 1.05, h: 2.05, door: wood.map((c) => c * 0.75), frame: wood.map((c) => c * 0.6), step: true, stepCol: stoneCol });
  }
  side.push(stoneWin(-d * 0.2));
  sideB.push(stoneWin(0));
  const upWin = (xx, yy, ww = 0.95, hh = 1.2, doorLike = false) => ({
    x: xx, y: yy, w: ww, h: hh, frame, panes: doorLike ? [2, 4] : [2, 3], shutters: shut, dp: 0.16,
    wallLayer: L.WOODH, sill: !doorLike, sillLayer: L.WOODH, sillCol: wood.map((c) => c * 0.85), box: !doorLike && r() < 0.7 ? flowerPal : null, lintel: wood.map((c) => c * 0.8),
  });
  for (let f = 0; f < floors; f++) {
    const yy = g0 + f * 2.5 + 0.55;
    const nfw = w > 8.4 ? 3 : 2;
    for (let i = 0; i < nfw; i++) {
      const xx = -w / 2 + ((i + 0.5) * w) / nfw;
      const balconyDoor = f === 0 && i === Math.floor(nfw / 2);
      front.push(balconyDoor ? upWin(xx, g0 + 0.15, 0.95, 2.05, true) : upWin(xx, yy));
    }
    for (const xx of [-d * 0.25, d * 0.25]) {
      side.push(upWin(xx, yy, 0.85, 1.1));
      sideB.push(upWin(xx, yy, 0.85, 1.1));
    }
    back.push(upWin(0, yy, 0.85, 1.1));
  }
  back.push(stoneWin(-w * 0.25));
  const bands = [{ y0: 0.35, y1: g0, layer: groundLayer, col: groundCol }, { y0: g0, y1: wallH, layer: L.WOODH, col: wood, grow: 0.1 }];
  walls(B, w, d, bands, { front, back, right: side, left: sideB }, { eaves: ['right', 'left'], eaveTop: wallH });
  // Sablière (poutre à la jonction pierre / bois)
  K.color(wood.map((c) => c * 0.75));
  K.box(-w / 2 - 0.2, g0 - 0.18, -d / 2 - 0.2, w / 2 + 0.2, g0 + 0.04, d / 2 + 0.2, L.WOODH, { skip: '', scale: 0.5 });
  // Toit à faible pente, grands débords, pignon en bois côté route
  const ohE = 1.05 + r() * 0.2;
  const ohG = 1.3 + r() * 0.3;
  const wr = w + 0.2;
  const rf = roof(B, { w: wr, d: d + 0.2, wallH, prof: gableProfile(wr, wallH, pitch, ohE), ohG, t: 0.34, layer: roofLayer, col: roofCol, fascia: wood.map((c) => c * 0.7), gable: { layer: L.WOODV, col: wood.map((c) => c * 1.05) }, soffit: wood.map((c) => c * 0.8), capR: 0.2, cap: roofCol.map((c) => c * 0.75) });
  // Fenêtres du pignon (en applique, petites)
  const gy = wallH + 0.35;
  for (const zz of [d / 2 + 0.1, -d / 2 - 0.1]) {
    K.push().move(0, 0, zz).rotY(zz > 0 ? 0 : Math.PI);
    K.color(tint('#7593a8'));
    K.face([[-0.45, gy, 0.02], [0.45, gy, 0.02], [0.45, gy + 0.9, 0.02], [-0.45, gy + 0.9, 0.02]], L.GLASS, { fit: [0, 0, 1, 1] });
    K.color(frame);
    K.box(-0.53, gy - 0.08, 0, 0.53, gy, 0.08, L.PLAIN);
    K.box(-0.53, gy + 0.9, 0, 0.53, gy + 0.98, 0.08, L.PLAIN);
    K.box(-0.53, gy, 0, -0.45, gy + 0.9, 0.08, L.PLAIN);
    K.box(0.45, gy, 0, 0.53, gy + 0.9, 0.08, L.PLAIN);
    K.box(-0.03, gy, 0.02, 0.03, gy + 0.9, 0.07, L.PLAIN);
    K.pop();
  }
  // Balcon(s) en façade
  const balconies = [g0];
  if (floors === 2 && r() < 0.6) balconies.push(g0 + 2.5);
  for (const by of balconies) {
    const z0 = d / 2 + 0.1;
    K.color(wood.map((c) => c * 0.85));
    K.box(-w / 2 - 0.1, by - 0.05, z0, w / 2 + 0.1, by + 0.12, z0 + balDepth, L.WOODH, { skip: '', scale: 0.6, ao: { b: 0.7, t: 1, bottom: 0.55 } });
    carvedRail(B, -w / 2 - 0.1, w / 2 + 0.1, by + 0.12, z0 + balDepth - 0.05, wood.map((c) => c * 0.95));
    // Retours latéraux
    for (const s of [-1, 1]) {
      K.push().move(s * (w / 2 + 0.05), 0, z0 + balDepth / 2).rotY(Math.PI / 2);
      carvedRail(B, -balDepth / 2, balDepth / 2 - 0.08, by + 0.12, 0, wood.map((c) => c * 0.95));
      K.pop();
    }
    // Consoles (jambes de force) sous le balcon
    B.detail();
    K.color(wood.map((c) => c * 0.7));
    for (const xx of [-w / 2 + 0.3, -w / 6, w / 6, w / 2 - 0.3]) {
      K.box(xx - 0.07, by - 1.1, z0, xx + 0.07, by - 0.05, z0 + 0.14, L.WOODV, { scale: 0.4 });
      K.rod([xx, by - 1.0, z0 + 0.07], [xx, by - 0.1, z0 + balDepth * 0.8], 0.06, 4, L.WOODV, { tile: 0.8 });
    }
    // Jardinières de géraniums sur la lisse
    K.color(wood.map((c) => c * 0.6));
    K.box(-w / 2 + 0.2, by + 1.12, z0 + balDepth, w / 2 - 0.2, by + 1.3, z0 + balDepth + 0.24, L.WOODH, { scale: 0.4 });
    flowers(B, -w / 2 + 0.3, w / 2 - 0.3, by + 1.3, z0 + balDepth + 0.12, flowerPal);
    B.shell();
  }
  // Abouts de chevrons sous les avant-toits (détail fin, pas en qualité allégée)
  B.detail();
  if (!B.lite) {
    K.color(wood.map((c) => c * 0.65));
    const rafterY = (xx) => wallH - (Math.abs(xx) - wr / 2) * pitch;
    for (let zz = -d / 2 - ohG + 0.4; zz <= d / 2 + ohG - 0.3; zz += 0.85) {
      for (const s of [-1, 1]) {
        const xe = s * (wr / 2 + ohE - 0.05);
        const xi = s * (wr / 2);
        const y0r = rafterY(xi) - 0.02;
        const y1r = rafterY(xe) - 0.02;
        K.push().move((xe + xi) / 2, (y0r + y1r) / 2 - 0.1, zz).rotZ(s * -Math.atan(pitch));
        K.box(-ohE / 2, -0.09, -0.06, ohE / 2, 0.09, 0.06, L.WOODH, { skip: '', scale: 0.5, ao: { b: 0.6, t: 0.7 } });
        K.pop();
      }
    }
  }
  // Tas de bois sous l'avant-toit, banc, cloche
  const s = r() < 0.5 ? 1 : -1;
  K.push().move(s * (w / 2 + 0.5), 0.35, -d * 0.15).rotY(Math.PI / 2);
  K.color(tint('#ffffff'));
  K.box(-1.6, 0, -0.3, 1.6, 1.7, 0.3, L.LOGS, { skip: 'ny' });
  K.pop();
  K.color(wood.map((c) => c * 0.8));
  const bx = doorFront ? w * 0.05 : -w * 0.1;
  K.box(bx - 0.7, 0.75, d / 2 + 0.3, bx + 0.7, 0.8, d / 2 + 0.65, L.WOODH, { skip: '' });
  for (const sx of [-0.6, 0.6]) K.box(bx + sx - 0.05, 0.35, d / 2 + 0.33, bx + sx + 0.05, 0.75, d / 2 + 0.62, L.WOODH);
  B.shell();
  // Cheminée et fumée
  const cz = -d * 0.18 + r() * d * 0.1;
  const cx = (r() < 0.5 ? -1 : 1) * (w * 0.18);
  chimney(B, cx, cz, wallH - 0.5, rf.ridgeY + 0.6, { col: stoneCol, layer: L.STONE, w: 0.8, d: 0.8, cap: tint('#8a857c'), smoke: o.smoke ?? r() < 0.5 });
  // Pierres posées sur le toit de lauzes (quelques-unes)
  if (!shingle && !B.lite) {
    B.detail();
    K.color(tint('#8f8a82'));
    for (let i = 0; i < 6; i++) {
      const sd = i % 2 ? 1 : -1;
      const xx = sd * (0.8 + r() * (wr / 2 - 0.4));
      const zz = (r() - 0.5) * d;
      const yy = wallH + (wr / 2 - Math.abs(xx)) * pitch + 0.34 / Math.cos(Math.atan(pitch));
      K.blob(xx, yy, zz, 0.22 + r() * 0.1, L.STONE, 0.6);
    }
    B.shell();
  }
  return { w, d, wallH, ridgeY: rf.ridgeY };
}

// Église alpine : nef blanche, chœur arrondi, clocher carré avec cadrans, abat-sons et bulbe en cuivre.
export function church(B, x, y, z, yaw, r) {
  const K = B.begin(x, y, z, yaw, r());
  const W = 8.4;
  const D = 14;
  const nz = -2.2; // centre de la nef
  const wallH = 6.4;
  const white = tint('#f4efe4');
  const stone = tint('#cbc3b3');
  const slate = tint('#5d6470');
  const copper = tint('#5f9c86');
  K.color(stone.map((c) => c * 0.9));
  K.box(-W / 2 - 0.12, -1.8, nz - D / 2 - 0.12, W / 2 + 0.12, 0.6, nz + D / 2 + 0.12, L.STONE, { skip: 'ny', ao: { b: 0.8, t: 1 } });
  K.push().move(0, 0, nz);
  const sw = (xx) => ({ x: xx, y: 2.2, w: 1.2, h: 3.0, stained: true });
  const sideWins = [-4.2, 0, 4.2].map(sw);
  walls(B, W, D, [{ y0: 0.6, y1: wallH, layer: L.PLASTER, col: white }], { right: [], left: [] }, { eaves: ['right', 'left'], eaveTop: wallH });
  // Vitraux (en applique dans une embrasure peinte dans la texture)
  for (const s of [-1, 1]) {
    K.push().rotY(s * Math.PI / 2).move(0, 0, W / 2);
    for (const p of sideWins) {
      K.color(tint('#ffffff'));
      K.face([[p.x - 0.75, p.y - 0.2, 0.025], [p.x + 0.75, p.y - 0.2, 0.025], [p.x + 0.75, p.y + p.h + 0.4, 0.025], [p.x - 0.75, p.y + p.h + 0.4, 0.025]], L.STAINED, { fit: [0, 0, 1, 1] });
      K.color(stone);
      K.box(p.x - 0.85, p.y - 0.32, 0, p.x + 0.85, p.y - 0.2, 0.12, L.ASHLAR);
    }
    K.pop();
  }
  quoins(B, W, D, 0.6, wallH, stone);
  // Contreforts
  K.color(stone);
  for (const s of [-1, 1]) for (const zz of [-2.1, 2.1]) K.box(s * W / 2 - (s > 0 ? 0 : 0.5), 0, zz - 0.3, s * W / 2 + (s > 0 ? 0.5 : 0), 3.2, zz + 0.3, L.ASHLAR, { skip: 'ny' });
  roof(B, { w: W, d: D, wallH, prof: gableProfile(W, wallH, 1.05, 0.4), ohG: 0.35, t: 0.22, layer: L.SLATE, col: slate, fascia: tint('#e8e2d6'), gable: { layer: L.PLASTER, col: white }, soffit: tint('#9a8a74'), capR: 0.14, capLayer: L.METAL, cap: copper });
  // Chœur arrondi (abside) et son toit conique
  K.push().move(0, 0, -D / 2);
  K.color(white);
  K.cyl(0, 0.6, 0, 3.0, 3.0, wallH - 1.0 - 0.6, 10, L.PLASTER, { caps: '', a0: Math.PI, arc: Math.PI, ao: { b: 1, t: 0.75 } });
  K.color(stone.map((c) => c * 0.9));
  K.cyl(0, -1.8, 0, 3.12, 3.12, 2.4, 10, L.STONE, { caps: 't', a0: Math.PI, arc: Math.PI });
  K.color(slate);
  K.cyl(0, wallH - 1.0, 0, 3.4, 0.05, 2.8, 10, L.SLATE, { caps: '', a0: Math.PI, arc: Math.PI });
  K.color(tint('#ffffff'));
  for (const a of [Math.PI * 1.25, Math.PI * 1.5, Math.PI * 1.75]) {
    K.push().rotY(-a + Math.PI / 2).move(0, 0, 3.02);
    K.face([[-0.4, 2.2, 0], [0.4, 2.2, 0], [0.4, 4.4, 0], [-0.4, 4.4, 0]], L.STAINED, { fit: [0, 0, 1, 1] });
    K.pop();
  }
  K.pop();
  K.pop();
  // Clocher (devant, côté route)
  const T = 3.8;
  const tz = nz + D / 2 + T / 2 - 0.2;
  const tH = 15.5;
  K.push().move(0, 0, tz);
  K.color(stone.map((c) => c * 0.9));
  K.box(-T / 2 - 0.12, -1.8, -T / 2 - 0.12, T / 2 + 0.12, 0.6, T / 2 + 0.12, L.STONE, { skip: 'ny' });
  const tower = { front: [{ x: 0, y: 0.6, w: 1.6, h: 2.8, door: tint('#5a3420'), frame: tint('#3a2416'), surround: stone, surroundW: 0.25, transom: false, stepCol: stone }] };
  const belfry = (xx) => ({ x: xx, y: 11.6, w: 1.3, h: 2.0, door: tint('#2c2621'), frame: tint('#4a3a2c'), step: false, surround: stone, surroundW: 0.18, dp: 0.4 });
  for (const sd of ['front', 'right', 'back', 'left']) (tower[sd] ||= []).push(belfry(0));
  walls(B, T, T, [{ y0: 0.6, y1: tH, layer: L.PLASTER, col: white }], tower, {});
  quoins(B, T, T, 0.6, tH, stone);
  // Abat-sons des baies du beffroi
  B.detail();
  K.color(tint('#5a4636'));
  for (let i = 0; i < 4; i++) {
    K.push().rotY((i * Math.PI) / 2).move(0, 0, T / 2 - 0.25);
    for (let k = 0; k < 6; k++) {
      K.push().move(0, 11.85 + k * 0.3, 0).rotX(0.6);
      K.box(-0.62, -0.02, -0.12, 0.62, 0.02, 0.12, L.WOODH, { skip: '' });
      K.pop();
    }
    K.pop();
  }
  B.shell();
  // Cadrans d'horloge et corniches
  for (let i = 0; i < 4; i++) {
    K.push().rotY((i * Math.PI) / 2).move(0, 0, T / 2);
    K.color(tint('#ffffff'));
    K.face([[-0.85, 8.9, 0.04], [0.85, 8.9, 0.04], [0.85, 10.6, 0.04], [-0.85, 10.6, 0.04]], L.CLOCK, { fit: [0, 1, 1, 0] });
    K.pop();
  }
  K.color(stone);
  K.cbox(0, 7.6, 0, T + 0.3, 0.25, T + 0.3, L.ASHLAR, { skip: 'ny' });
  K.cbox(0, tH, 0, T + 0.5, 0.35, T + 0.5, L.ASHLAR, { skip: '' });
  // Bulbe : tambour octogonal, bulbe, lanternon, petit bulbe, flèche, boule et croix
  K.push().move(0, tH + 0.35, 0);
  K.color(white);
  K.cyl(0, 0, 0, 1.75, 1.75, 1.1, 8, L.PLASTER, { caps: '' });
  K.color(copper);
  const onion = [[1.7, 1.08], [1.95, 1.05], [2.15, 1.3], [2.2, 1.7], [2.0, 2.3], [1.5, 2.9], [0.8, 3.4], [0.42, 3.8], [0.4, 4.1]];
  K.lathe(onion, 16, L.METAL, { ao: (t) => 0.8 + 0.2 * t });
  K.color(white);
  K.cyl(0, 4.1, 0, 0.55, 0.55, 1.0, 8, L.PLASTER, { caps: '' });
  K.color(DARK);
  for (let i = 0; i < 4; i++) {
    K.push().rotY((i * Math.PI) / 2 + Math.PI / 8);
    K.box(-0.16, 4.3, 0.5, 0.16, 4.9, 0.53, L.PLAIN);
    K.pop();
  }
  K.color(copper);
  K.lathe([[0.5, 5.1], [0.62, 5.05], [0.8, 5.35], [0.7, 5.75], [0.35, 6.1], [0.1, 6.5], [0.05, 7.4]], 12, L.METAL);
  K.color(GOLD);
  K.blob(0, 7.45, 0, 0.18, L.METAL);
  K.box(-0.04, 7.55, -0.04, 0.04, 8.5, 0.04, L.METAL);
  K.box(-0.3, 8.0, -0.035, 0.3, 8.08, 0.035, L.METAL);
  K.pop();
  K.pop();
  // Parvis
  K.color(tint('#b8b0a2'));
  K.box(-3, -0.4, tz + T / 2, 3, 0.25, tz + T / 2 + 2.6, L.ASHLAR, { skip: 'ny' });
  return { tz, tH };
}

// Fontaine de village : bassin octogonal, pilier, vasque, becs, eau ; place pavée.
export function fountain(B, x, y, z, r) {
  const K = B.begin(x, y, z, r() * 0.8, r());
  K.groundAO = false;
  const stone = tint('#c9c1b2');
  K.color(tint('#a9a296'));
  K.lathe([[6.4, -0.9], [5.7, 0.04], [5.5, 0.1], [3, 0.1], [0.01, 0.1]], 28, L.ASHLAR, { tile: 1.4 });
  K.groundAO = true;
  K.baseY = y + 0.1;
  K.color(stone);
  K.cyl(0, 0.1, 0, 2.0, 2.0, 0.65, 8, L.ASHLAR, { caps: '' });
  K.cyl(0, 0.1, 0, 1.75, 1.75, 0.65, 8, L.ASHLAR, { caps: '' });
  K.color(stone.map((c) => c * 1.05));
  K.push().move(0, 0.75, 0);
  K.lathe([[2.08, 0], [2.08, 0.06], [1.68, 0.06], [1.68, 0]], 8, L.ASHLAR);
  K.pop();
  K.color(tint('#4a93ad'));
  K.disc(0, 0.62, 0, 1.75, 8, L.GLASS, 1);
  K.color(stone);
  K.cyl(0, 0.1, 0, 0.3, 0.26, 1.9, 8, L.ASHLAR, { caps: '' });
  K.push().move(0, 1.95, 0);
  K.lathe([[0.25, 0], [0.7, 0.18], [0.78, 0.3], [0.7, 0.32]], 10, L.ASHLAR);
  K.color(tint('#4a93ad'));
  K.disc(0, 0.28, 0, 0.66, 10, L.GLASS, 1);
  K.color(stone);
  K.lathe([[0.18, 0.28], [0.2, 0.7], [0.32, 0.85], [0.001, 1.0]], 8, L.ASHLAR);
  K.pop();
  B.detail();
  K.color(tint('#b08a3a'));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    K.rod([Math.cos(a) * 0.25, 1.4, Math.sin(a) * 0.25], [Math.cos(a) * 0.6, 1.35, Math.sin(a) * 0.6], 0.03, 4, L.METAL);
    K.color(tint('#cfe8f4'));
    K.rod([Math.cos(a) * 0.62, 1.32, Math.sin(a) * 0.62], [Math.cos(a) * 0.95, 0.62, Math.sin(a) * 0.95], 0.025, 4, L.GLASS);
    K.color(tint('#b08a3a'));
  }
  // Bacs à fleurs autour
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    K.push().move(Math.cos(a) * 3.6, 0.1, Math.sin(a) * 3.6);
    K.color(stone);
    K.cyl(0, 0, 0, 0.4, 0.45, 0.5, 8, L.ASHLAR, { caps: '' });
    K.color(tint('#4a3a2a'));
    K.disc(0, 0.45, 0, 0.38, 8, L.PLAIN, 1);
    for (let k = 0; k < 6; k++) {
      const b = (k / 6) * Math.PI * 2;
      K.color(tint(LEAF, 0.9));
      K.blob(Math.cos(b) * 0.22, 0.55, Math.sin(b) * 0.22, 0.14, L.PLAIN);
      K.color(tint(FLOWERS[(i + k) % 3]));
      K.blob(Math.cos(b) * 0.24, 0.68, Math.sin(b) * 0.24, 0.07);
    }
    K.pop();
  }
  B.shell();
}

// Café du village : rez-de-chaussée vitré, auvent rayé, étage en bois et balcon ; terrasse devant
// (plancher, tables, chaises, parasols, ardoise).
export function cafe(B, x, y, z, yaw, r) {
  const K = B.begin(x, y, z, yaw, r());
  const w = 9;
  const d = 8;
  const g0 = 3.0;
  const wallH = g0 + 2.6;
  const wood = tint('#94592f');
  const plaster = tint('#efe4cc');
  const awning = tint('#b8242c');
  const frame = tint('#2d4a33');
  K.color(tint('#a8a090'));
  K.box(-w / 2 - 0.08, -2, -d / 2 - 0.08, w / 2 + 0.08, 0.35, d / 2 + 0.08, L.STONE, { skip: 'ny' });
  const front = [
    { x: -2.9, y: 0.75, w: 1.9, h: 1.75, frame, panes: [3, 2], sill: true, sillCol: tint('#d8d0c0'), dp: 0.2 },
    { x: 0, y: 0.35, w: 1.25, h: 2.3, door: frame, frame, transom: true, glass: tint('#86a6bc') },
    { x: 2.9, y: 0.75, w: 1.9, h: 1.75, frame, panes: [3, 2], sill: true, sillCol: tint('#d8d0c0'), dp: 0.2 },
  ];
  const shut = tint('#2d4a33');
  for (const xx of [-2.6, 0, 2.6]) front.push({ x: xx, y: g0 + 0.5, w: 0.95, h: 1.2, frame: tint('#f2ede2'), shutters: shut, wallLayer: L.WOODH, sillLayer: L.WOODH, sillCol: wood, box: ['#e0384b', '#ff6fa0', '#f2f2f2'], lintel: wood.map((c) => c * 0.8), dp: 0.16 });
  const side = [{ x: 0, y: 0.9, w: 1.0, h: 1.3, frame, panes: [2, 2] }, { x: 0, y: g0 + 0.5, w: 0.9, h: 1.1, frame: tint('#f2ede2'), shutters: shut, wallLayer: L.WOODH }];
  walls(B, w, d, [{ y0: 0.35, y1: g0, layer: L.PLASTER, col: plaster }, { y0: g0, y1: wallH, layer: L.WOODH, col: wood, grow: 0.1 }], { front, right: side, left: side, back: [] }, { eaves: ['right', 'left'], eaveTop: wallH });
  K.color(wood.map((c) => c * 0.75));
  K.box(-w / 2 - 0.2, g0 - 0.18, -d / 2 - 0.2, w / 2 + 0.2, g0 + 0.04, d / 2 + 0.2, L.WOODH, { skip: '' });
  const rf = roof(B, { w: w + 0.2, d: d + 0.2, wallH, prof: gableProfile(w + 0.2, wallH, 0.45, 1.1), ohG: 1.4, t: 0.34, layer: L.SHINGLE, col: tint('#7a6a5c'), fascia: wood.map((c) => c * 0.7), gable: { layer: L.WOODV, col: wood }, soffit: wood.map((c) => c * 0.8), capR: 0.2 });
  chimney(B, -w * 0.2, -d * 0.2, wallH - 0.5, rf.ridgeY + 0.6, { col: tint('#bdb6aa'), w: 0.8, d: 0.8, cap: tint('#8a857c'), smoke: true });
  // Enseigne
  B.signs.quad(K, 0, g0 - 0.38, d / 2 + 0.04, 2.6, 0.62, SIGN.cafe);
  // Auvent rayé (pente vers la rue) et lambrequin
  const az = d / 2;
  K.color(awning);
  const ay0 = g0 - 0.25;
  const ay1 = g0 - 1.05;
  const ad = 2.2;
  K.face([[-w / 2 + 0.3, ay1, az + ad], [w / 2 - 0.3, ay1, az + ad], [w / 2 - 0.3, ay0, az], [-w / 2 + 0.3, ay0, az]], L.STRIPES, { U: [1, 0, 0], tile: 1.2 });
  K.face([[w / 2 - 0.3, ay1, az + ad], [-w / 2 + 0.3, ay1, az + ad], [-w / 2 + 0.3, ay0, az], [w / 2 - 0.3, ay0, az]], L.STRIPES, { U: [-1, 0, 0], tile: 1.2, ao: 0.6 });
  K.face([[-w / 2 + 0.3, ay1 - 0.28, az + ad], [w / 2 - 0.3, ay1 - 0.28, az + ad], [w / 2 - 0.3, ay1, az + ad], [-w / 2 + 0.3, ay1, az + ad]], L.STRIPES, { U: [1, 0, 0], tile: 1.2 });
  K.color(IRON);
  for (const s of [-1, 1]) K.rod([s * (w / 2 - 0.35), ay0 - 0.05, az], [s * (w / 2 - 0.35), ay1 - 0.02, az + ad], 0.025, 4, L.PLAIN);
  // Balcon de l'étage
  K.color(wood.map((c) => c * 0.85));
  K.box(-w / 2, g0 - 0.02, d / 2 + 0.1, w / 2, g0 + 0.1, d / 2 + 0.9, L.WOODH, { skip: '', ao: { b: 0.7, t: 1, bottom: 0.6 } });
  carvedRail(B, -w / 2, w / 2, g0 + 0.1, d / 2 + 0.85, wood.map((c) => c * 0.95), 0.9);
  // Terrasse
  K.push().move(0, 0, d / 2 + 0.4);
  K.groundAO = false;
  K.color(tint('#a77b4f'));
  K.box(-w / 2, -0.6, 0, w / 2, 0.22, 4.6, L.WOODH, { skip: 'ny', ao: { b: 0.7, t: 1 } });
  K.groundAO = true;
  const tables = [[-2.8, 1.6], [0.2, 3.0], [2.9, 1.5]];
  for (const [tx, tz] of tables) {
    K.color(tint('#2d2d2d'));
    K.cyl(tx, 0.22, tz, 0.05, 0.05, 0.72, 6, L.PLAIN, { caps: '' });
    K.cyl(tx, 0.22, tz, 0.3, 0.3, 0.03, 8, L.PLAIN, { caps: 't' });
    K.color(tint('#f4f1ea'));
    K.cyl(tx, 0.94, tz, 0.42, 0.42, 0.04, 12, L.PLAIN, { caps: 't' });
    B.detail();
    for (const a of [0.3, Math.PI + 0.3]) {
      const cx = tx + Math.cos(a) * 0.7;
      const cz = tz + Math.sin(a) * 0.7;
      K.push().move(cx, 0.22, cz).rotY(-a + Math.PI / 2);
      K.color(tint(pick(r, ['#2d4a33', '#b8242c', '#3a3a3a'])));
      K.box(-0.2, 0.42, -0.2, 0.2, 0.46, 0.2, L.PLAIN, { skip: '' });
      K.box(-0.2, 0.46, -0.22, 0.2, 0.9, -0.18, L.PLAIN, { skip: '' });
      for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) K.box(lx - 0.02, 0, lz - 0.02, lx + 0.02, 0.42, lz + 0.02, L.PLAIN);
      K.pop();
    }
    K.color(tint('#ffffff'));
    K.cyl(tx + 0.1, 0.98, tz, 0.04, 0.035, 0.08, 6, L.PLAIN);
    B.shell();
  }
  // Parasols rayés
  for (const [px, pz] of [[-2.8, 1.6], [2.9, 1.5]]) {
    K.color(tint('#e8e4da'));
    K.cyl(px, 0.98, pz, 0.035, 0.035, 1.6, 6, L.PLAIN, { caps: '' });
    K.color(tint(pick(r, ['#b8242c', '#2d4a33', '#e07b1a'])));
    K.push().move(px, 2.2, pz);
    K.lathe([[1.5, 0], [1.1, 0.25], [0.5, 0.48], [0.02, 0.6]], 8, L.STRIPES, { tile: Math.PI * 2 });
    K.lathe([[0.02, 0.58], [0.5, 0.46], [1.1, 0.23], [1.5, -0.02]], 8, L.STRIPES, { tile: Math.PI * 2 });
    K.pop();
  }
  // Ardoise du menu et bacs de fleurs
  K.color(tint('#4a3a2a'));
  K.push().move(w / 2 - 0.6, 0.22, 4.2).rotY(-0.4);
  K.box(-0.32, 0, -0.03, 0.32, 1.0, 0.03, L.WOODH);
  B.signs.quad(K, 0, 0.62, 0.035, 0.5, 0.5, SIGN.menu);
  K.pop();
  B.detail();
  for (const s of [-1, 1]) {
    K.push().move(s * (w / 2 - 0.4), 0.22, 4.3);
    K.color(tint('#8a5a34'));
    K.box(-0.3, 0, -0.3, 0.3, 0.5, 0.3, L.WOODV, { scale: 0.4 });
    flowers(B, -0.25, 0.25, 0.5, -0.08, ['#e0384b', '#ffd23f']);
    flowers(B, -0.25, 0.25, 0.5, 0.1, ['#ff6fa0', '#e0384b']);
    K.pop();
  }
  B.shell();
  K.pop();
}

// =====================================================================
// Côte des Dunes : cabines de plage rayées, poste de secours
// =====================================================================

export function beachHut(B, x, y, z, yaw, r, k) {
  const K = B.begin(x, y, z, yaw, r());
  const cols = ['#e0384b', '#2b6cff', '#f2b705', '#2f9e44', '#ff6fa0', '#ff7a1a', '#3fb6c8'];
  const c = tint(cols[k % cols.length]);
  const w = 1.9 + r() * 0.3;
  const d = 1.9;
  const h = 2.25;
  const striped = r() < 0.7;
  const roofCol = r() < 0.5 ? WHITE : c.map((v) => v * 0.9);
  // Plancher surélevé sur pieux
  K.color(tint('#b08a60'));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(sx * (w / 2 - 0.05) - 0.06, -0.6, sz * (d / 2 + 0.2) - 0.06, sx * (w / 2 - 0.05) + 0.06, 0.3, sz * (d / 2 + 0.2) + 0.06, L.WOODV);
  K.box(-w / 2 - 0.05, 0.3, -d / 2 - 0.05, w / 2 + 0.05, 0.4, d / 2 + 0.6, L.WOODH, { skip: '', scale: 0.5 });
  K.box(-0.5, 0.0, d / 2 + 0.6, 0.5, 0.18, d / 2 + 0.95, L.WOODH, { skip: 'ny', scale: 0.5 });
  const door = { x: 0, y: 0.4, w: 0.8, h: 1.75, door: striped ? WHITE : c.map((v) => v * 0.8), frame: WHITE, step: false, dp: 0.06 };
  const port = { x: 0, y: 1.25, w: 0.5, h: 0.5, frame: WHITE, panes: [1, 1], sill: false, dp: 0.05 };
  walls(B, w, d, [{ y0: 0.4, y1: h, layer: striped ? L.STRIPES : L.WOODV, col: c, tile: striped ? 1.6 : 2.0 }], { front: [door], right: [port], left: k % 2 ? [port] : [] }, {});
  K.color(WHITE);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) K.box(sx * w / 2 - 0.06, 0.4, sz * d / 2 - 0.06, sx * w / 2 + 0.06, h, sz * d / 2 + 0.06, L.PLAIN, { skip: 'ny' });
  roof(B, { w, d, wallH: h, prof: gableProfile(w, h, 0.62, 0.22), ohG: 0.35, t: 0.12, layer: L.PLAIN, col: roofCol, fascia: WHITE, fasciaLayer: L.PLAIN, gable: { layer: L.PLAIN, col: WHITE }, capR: 0.07, capLayer: L.PLAIN, cap: WHITE });
  // Serviette suspendue, numéro
  B.detail();
  K.color(tint(pick(r, ['#ffd23f', '#3fb6c8', '#ffffff', '#ff6fa0'])));
  K.box(w / 2 + 0.03, 0.9, -0.3, w / 2 + 0.05, 1.7, 0.3, L.STRIPES, { scale: 0.4 });
  K.color(tint('#3a2a20'));
  K.box(-0.12, 2.0, d / 2 + 0.06, 0.12, 2.15, d / 2 + 0.08, L.PLAIN);
  B.shell();
}

export function lifeguardTower(B, x, y, z, yaw) {
  const K = B.begin(x, y, z, yaw);
  const red = tint('#e0384b');
  const white = tint('#f4f2ec');
  const wood = tint('#cdb48c');
  const P = 2.9;
  const top = 2.7;
  // Pieds et croisillons
  K.color(white);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.rod([sx * 1.25, -0.4, sz * 1.25], [sx * 1.05, top, sz * 1.05], 0.09, 6, L.PLAIN);
  for (let i = 0; i < 4; i++) {
    K.push().rotY((i * Math.PI) / 2);
    K.rod([-1.18, 0.3, 1.18], [1.1, top - 0.2, 1.1], 0.04, 4, L.PLAIN);
    K.rod([1.18, 0.3, 1.18], [-1.1, top - 0.2, 1.1], 0.04, 4, L.PLAIN);
    K.pop();
  }
  // Plateforme, garde-corps
  K.color(wood);
  K.box(-P / 2, top, -P / 2, P / 2, top + 0.14, P / 2, L.WOODH, { skip: '', scale: 0.5, ao: { b: 0.8, t: 1, bottom: 0.6 } });
  K.color(white);
  for (let i = 0; i < 4; i++) {
    K.push().rotY((i * Math.PI) / 2);
    for (let k = -2; k <= 2; k++) if (!(i === 2 && Math.abs(k) < 1)) K.box(k * 0.68 - 0.03, top + 0.14, P / 2 - 0.06, k * 0.68 + 0.03, top + 1.05, P / 2, L.PLAIN);
    if (i !== 2) K.box(-P / 2, top + 0.98, P / 2 - 0.07, P / 2, top + 1.06, P / 2 + 0.01, L.PLAIN, { skip: '' });
    K.pop();
  }
  // Cabine
  K.push().move(0, top + 0.14, -0.2);
  const hw = 2.0;
  const hd = 1.7;
  const hh = 1.95;
  const glass = (xx, ww) => ({ x: xx, y: 0.85, w: ww, h: 0.8, frame: white, panes: [2, 1], sill: false, dp: 0.06, glass: tint('#8fb7cf') });
  walls(B, hw, hd, [{ y0: 0, y1: hh, layer: L.WOODV, col: red }], { front: [glass(0, 1.4)], right: [glass(0, 1.0)], left: [glass(0, 1.0)], back: [{ x: 0.3, y: 0, w: 0.7, h: 1.7, door: white, frame: white, step: false, dp: 0.05 }] }, {});
  K.color(white);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) K.box(sx * hw / 2 - 0.05, 0, sz * hd / 2 - 0.05, sx * hw / 2 + 0.05, hh, sz * hd / 2 + 0.05, L.PLAIN, { skip: 'ny' });
  K.color(white);
  K.box(-hw / 2 - 0.45, hh, -hd / 2 - 0.45, hw / 2 + 0.45, hh + 0.14, hd / 2 + 0.55, L.PLAIN, { skip: '', ao: { b: 1, t: 1, bottom: 0.55 } });
  K.color(red);
  K.box(-hw / 2 - 0.47, hh - 0.02, hd / 2 + 0.53, hw / 2 + 0.47, hh + 0.16, hd / 2 + 0.57, L.PLAIN);
  B.signs.quad(K, 0, hh + 0.38, hd / 2 + 0.4, 1.9, 0.26, SIGN.rescue);
  K.color(white);
  K.box(-0.95, hh + 0.14, hd / 2 + 0.36, 0.95, hh + 0.62, hd / 2 + 0.39, L.PLAIN);
  K.pop();
  // Rampe d'accès (marches)
  K.color(wood);
  for (let k = 0; k < 9; k++) {
    const yy = top - (k + 1) * 0.3;
    K.box(-0.45, yy, -P / 2 - 0.25 - k * 0.32, 0.45, yy + 0.06, -P / 2 - k * 0.32 + 0.05, L.WOODH, { skip: '' });
  }
  K.color(white);
  for (const s of [-0.5, 0.5]) {
    K.rod([s, top, -P / 2], [s, -0.1, -P / 2 - 2.9], 0.05, 4, L.PLAIN);
    K.rod([s, top + 0.9, -P / 2], [s, 0.8, -P / 2 - 2.9], 0.03, 4, L.PLAIN);
  }
  // Mât et drapeau, bouée
  K.color(white);
  K.cyl(1.3, top, 1.3, 0.05, 0.04, 4.6, 6, L.PLAIN, { caps: 't' });
  const fy = top + 3.8;
  const flag = (y0, y1, col) => {
    K.color(col);
    const pts = [];
    for (let i = 0; i <= 6; i++) pts.push([1.33 + i * 0.22, Math.sin(i * 1.1) * 0.08]);
    for (let i = 0; i < 6; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      K.face([[ax, y0, 1.3 + az], [bx, y0, 1.3 + bz], [bx, y1, 1.3 + bz], [ax, y1, 1.3 + az]], L.PLAIN);
      K.face([[bx, y0, 1.3 + bz], [ax, y0, 1.3 + az], [ax, y1, 1.3 + az], [bx, y1, 1.3 + bz]], L.PLAIN);
    }
  };
  flag(fy, fy + 0.4, tint('#ffd23f'));
  flag(fy + 0.4, fy + 0.8, red);
  B.detail();
  K.push().move(P / 2 + 0.02, top + 0.55, 0.6).rotZ(Math.PI / 2);
  K.color(red);
  K.lathe([[0.28, 0], [0.36, 0.06], [0.42, 0], [0.36, -0.06], [0.28, 0]].map(([a, b]) => [a, b]), 12, L.PLAIN);
  K.pop();
  K.color(tint('#e8dcc0'));
  K.box(-1.2, top + 0.14, 0.9, -0.5, top + 0.55, 1.3, L.PLAIN);
  B.shell();
}

// =====================================================================
// Lac d'aviron : hangar à bateaux, tribune
// =====================================================================

// Hangar : façade longue vers l'eau (+Z local) avec trois grandes portes ouvertes sur les râteliers,
// club-house à l'étage et balcon, ponton en planches, râtelier extérieur.
export function boathouse(B, x, y, z, yaw, r) {
  const K = B.begin(x, y, z, yaw, r());
  const w = 16;
  const d = 10;
  const g0 = 3.6;
  const wallH = g0 + 3.0;
  const boards = tint('#7d3a2c');
  const trim = tint('#f2efe8');
  const hull = ['#f4f4f2', '#ffd23f', '#e0384b', '#2b6cff', '#f4f4f2', '#3ccf7a'].map((h) => tint(h));
  K.color(tint('#a8a090'));
  K.box(-w / 2 - 0.1, -1.6, -d / 2 - 0.1, w / 2 + 0.1, 0.25, d / 2 + 0.1, L.CONCRETE, { skip: 'ny' });
  const bayX = [-5, 0, 5];
  const front = bayX.map((xx) => ({ x: xx, y: 0.25, w: 3.6, h: 3.0, door: tint('#1d1a18'), frame: trim, step: false, dp: 0.15 }));
  for (const xx of [-5.5, -2.2, 2.2, 5.5]) front.push({ x: xx, y: g0 + 0.5, w: 1.3, h: 1.6, frame: trim, panes: [2, 2], dp: 0.12, sillLayer: L.PLAIN, sillCol: trim });
  const side = [{ x: 0, y: g0 + 0.6, w: 1.2, h: 1.3, frame: trim, panes: [2, 2] }, { x: 2.5, y: 0.25, w: 1.0, h: 2.1, door: trim, frame: trim, step: false }];
  walls(B, w, d, [{ y0: 0.25, y1: wallH, layer: L.WOODV, col: boards }], { front, right: side, left: [side[0]], back: [{ x: -3, y: 1.2, w: 1.2, h: 1.0, frame: trim, panes: [2, 2] }, { x: 3, y: 1.2, w: 1.2, h: 1.0, frame: trim, panes: [2, 2] }] }, { eaves: ['front', 'back'], eaveTop: wallH });
  K.color(trim);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) K.box(sx * w / 2 - 0.1, 0.25, sz * d / 2 - 0.1, sx * w / 2 + 0.1, wallH, sz * d / 2 + 0.1, L.PLAIN, { skip: 'ny' });
  K.box(-w / 2 - 0.08, g0 - 0.15, d / 2, w / 2 + 0.08, g0 + 0.05, d / 2 + 0.08, L.PLAIN);
  // Intérieur sombre des travées et râteliers chargés de skiffs
  for (const bx of bayX) {
    K.color(tint('#2a2420'));
    K.box(bx - 1.8, 0.25, d / 2 - 3.2, bx + 1.8, 3.25, d / 2 - 3.15, L.WOODV, { skip: 'ny nz px nx py' });
    K.face([[bx - 1.8, 0.26, d / 2 - 3.2], [bx + 1.8, 0.26, d / 2 - 3.2], [bx + 1.8, 0.26, d / 2 - 0.15], [bx - 1.8, 0.26, d / 2 - 0.15]], L.CONCRETE, { ao: 0.4 });
    B.detail();
    for (let lv = 0; lv < 3; lv++) {
      K.color(tint('#6a5a4a'));
      K.box(bx - 1.6, 0.8 + lv * 0.75, d / 2 - 2.6, bx + 1.6, 0.86 + lv * 0.75, d / 2 - 2.4, L.WOODH);
      for (const s of [-0.8, 0.8]) {
        K.color(hull[(lv * 3 + bayX.indexOf(bx) + (s > 0 ? 1 : 0)) % hull.length]);
        K.push().move(bx + s, 0.98 + lv * 0.75, d / 2 - 2.0).rotY(Math.PI / 2);
        K.spindle(5.5, 0.22, 8, 8, 1, 0.75, L.PLAIN, { deck: 0.4 });
        K.pop();
      }
    }
    B.shell();
  }
  // Enseigne du club
  B.signs.quad(K, 0, g0 + 2.55, d / 2 + 0.06, 6.4, 0.5, SIGN.club);
  // Toit (faîtage parallèle à l'eau)
  K.push().rotY(-Math.PI / 2);
  roof(B, { w: d, d: w, wallH, prof: gableProfile(d, wallH, 0.55, 0.7), ohG: 0.5, t: 0.24, layer: L.SHINGLE, col: tint('#5e5a56'), fascia: trim, fasciaLayer: L.PLAIN, gable: { layer: L.WOODV, col: boards }, soffit: tint('#8a6a4a'), capR: 0.17 });
  K.pop();
  // Balcon du club-house
  K.color(tint('#8a6a4a'));
  K.box(-w / 2 + 1, g0 - 0.05, d / 2 + 0.08, w / 2 - 1, g0 + 0.1, d / 2 + 1.5, L.WOODH, { skip: '', ao: { b: 0.7, t: 1, bottom: 0.55 } });
  K.color(trim);
  K.box(-w / 2 + 1, g0 + 1.0, d / 2 + 1.42, w / 2 - 1, g0 + 1.08, d / 2 + 1.5, L.PLAIN, { skip: '' });
  B.detail();
  for (let xx = -w / 2 + 1.1; xx <= w / 2 - 1; xx += 0.5) K.box(xx - 0.025, g0 + 0.1, d / 2 + 1.44, xx + 0.025, g0 + 1.0, d / 2 + 1.48, L.PLAIN);
  B.shell();
  for (const xx of [-w / 2 + 1.2, 0, w / 2 - 1.2]) K.box(xx - 0.08, 0.25, d / 2 + 1.38, xx + 0.08, g0 - 0.05, d / 2 + 1.5, L.PLAIN);
  // Ponton en planches sur pieux, bittes, bouée, mâts et pavillons
  K.groundAO = false;
  K.color(tint('#a58560'));
  K.box(-w / 2 - 1, -0.15, d / 2 + 0.1, w / 2 + 1, 0.05, d / 2 + 9, L.WOODH, { skip: 'ny', ao: { b: 0.6, t: 1 } });
  K.color(tint('#5a4330'));
  for (let i = 0; i < 6; i++) for (const zz of [d / 2 + 3, d / 2 + 8.8]) K.cyl(-w / 2 + (i * (w + 2)) / 5 - 1, -2.4, zz, 0.15, 0.15, 2.72, 8, L.WOODV, { caps: 't' });
  K.groundAO = true;
  B.detail();
  K.color(IRON);
  for (const xx of [-6, -1, 4]) K.cyl(xx, 0.05, d / 2 + 8.7, 0.08, 0.1, 0.3, 6, L.PLAIN);
  K.color(tint('#6a5a4a'));
  for (const s of [-1, 1]) {
    K.box(s * 2.2 - 0.6, 0.05, d / 2 + 4.5, s * 2.2 + 0.6, 0.6, d / 2 + 4.7, L.WOODH);
  }
  K.color(hull[1]);
  K.push().move(0, 0.75, d / 2 + 4.6).rotY(Math.PI / 2).rotZ(Math.PI);
  K.spindle(7.5, 0.24, 8, 10, 1, 0.75, L.PLAIN, { deck: 0.4 });
  K.pop();
  B.shell();
  // Râtelier extérieur contre le pignon gauche
  K.push().move(-w / 2 - 1.1, 0, 0).rotY(Math.PI / 2);
  K.color(tint('#8a8f96'));
  for (const xx of [-3.5, 0, 3.5]) {
    K.box(xx - 0.06, 0.25, -0.5, xx + 0.06, 2.8, -0.4, L.PLAIN);
    for (let lv = 0; lv < 3; lv++) K.box(xx - 0.05, 0.9 + lv * 0.8, -0.45, xx + 0.05, 0.96 + lv * 0.8, 0.5, L.PLAIN);
  }
  for (let lv = 0; lv < 3; lv++) {
    K.color(hull[(lv + 2) % hull.length]);
    K.push().move(0, 1.08 + lv * 0.8, 0.05).rotY(Math.PI / 2).rotY(Math.PI / 2);
    K.spindle(8.0, 0.21, 8, 10, 1, 0.75, L.PLAIN, { deck: 0.4 });
    K.pop();
  }
  K.pop();
  // Mâts de pavillons
  for (const [fx, col] of [[-w / 2 - 0.5, '#2b6cff'], [w / 2 + 0.5, '#e0384b']]) {
    K.color(trim);
    K.cyl(fx, 0, d / 2 + 8.5, 0.06, 0.05, 8, 6, L.PLAIN, { caps: 't' });
    K.color(tint(col));
    for (let i = 0; i < 5; i++) {
      const a = i * 0.28;
      const b = (i + 1) * 0.28;
      const wa = Math.sin(i * 1.2) * 0.1;
      const wb = Math.sin((i + 1) * 1.2) * 0.1;
      for (const s of [1, -1]) {
        const pts = [[fx + a, 7.0, d / 2 + 8.5 + wa], [fx + b, 7.0, d / 2 + 8.5 + wb], [fx + b, 7.8, d / 2 + 8.5 + wb], [fx + a, 7.8, d / 2 + 8.5 + wa]];
        K.face(s > 0 ? pts : pts.slice().reverse(), L.PLAIN);
      }
    }
  }
}

// Tribune : gradins (marches en béton, bancs colorés), structure métallique et toit en porte-à-faux,
// bandeau publicitaire, garde-corps, murs d'extrémité. Repère : x vers l'arrière (les gradins montent),
// z le long de la berge ; gradins k à x = 2,2 k, dessus à 0,8 (k + 1).
export function grandstand(B, x, y, z) {
  const K = B.begin(x, y, z, 0);
  K.groundAO = false;
  const len = 60;
  const concrete = tint('#cfcabe');
  for (let k = 0; k < 6; k++) {
    const x0 = k * 2.2 - 1.1;
    const top = 0.8 * (k + 1);
    K.color(k % 2 ? concrete : concrete.map((c) => c * 0.95));
    K.box(x0, -1.0, -len / 2, x0 + 2.2, top, len / 2, L.CONCRETE, { skip: 'ny px', ao: { b: 0.7, t: 1 } });
    // Banc à dossier au fond de chaque marche, par sections de couleur
    for (let s = 0; s < 6; s++) {
      const z0 = -len / 2 + s * 10 + 0.3;
      K.color(tint(s % 2 ? '#2b6cff' : '#f4f4f2'));
      K.box(x0 + 1.55, top, z0, x0 + 2.05, top + 0.42, z0 + 9.4, L.PLAIN, { skip: 'ny' });
      K.box(x0 + 1.95, top + 0.42, z0, x0 + 2.12, top + 0.85, z0 + 9.4, L.PLAIN, { skip: 'ny' });
    }
  }
  // Mur arrière
  K.color(concrete.map((c) => c * 0.9));
  K.box(12.1, -1.0, -len / 2, 12.5, 6.2, len / 2, L.CONCRETE, { skip: 'ny' });
  // Murs d'extrémité et escaliers
  for (const s of [-1, 1]) {
    K.color(concrete.map((c) => c * 0.92));
    K.box(-1.1, -1.0, s * len / 2 - (s > 0 ? 0 : 0.4), 12.5, 5.6, s * len / 2 + (s > 0 ? 0.4 : 0), L.CONCRETE, { skip: 'ny' });
    for (let k = 0; k < 14; k++) {
      const zz = s * (len / 2 + 0.4);
      K.box(-1.1 + k * 0.9, -1.0, zz - (s > 0 ? 0 : 1.4), -0.2 + k * 0.9, 0.4 * (k + 1), zz + (s > 0 ? 1.4 : 0), L.CONCRETE, { skip: 'ny' });
    }
  }
  // Garde-corps en façade
  K.color(tint('#9aa0a8'));
  K.box(-1.15, 0.8, -len / 2, -1.08, 1.85, len / 2, L.GLASS, { skip: 'ny' });
  K.box(-1.2, 1.85, -len / 2, -1.02, 1.95, len / 2, L.PLAIN, { skip: '' });
  // Structure : poteaux, consoles en treillis, pannes
  const steel = tint('#4c535e');
  K.color(steel);
  const roofY = (xx) => 10.6 - (12.4 - xx) * 0.1;
  for (const zz of [-29, -19, -9.5, 0, 9.5, 19, 29]) {
    K.box(12.2, -1, zz - 0.18, 12.56, 11.2, zz + 0.18, L.PLAIN);
    K.rod([12.3, 11.0, zz], [-2.5, roofY(-2.5) + 0.05, zz], 0.1, 4, L.PLAIN);
    K.rod([12.3, 7.6, zz], [-2.5, roofY(-2.5) - 0.65, zz], 0.08, 4, L.PLAIN);
    B.detail();
    for (let i = 0; i < 7; i++) {
      const xa = 12.3 - i * 2.11;
      const xb = 12.3 - (i + 1) * 2.11;
      const ya = 7.6 + ((roofY(-2.5) - 0.65 - 7.6) * i) / 7;
      const yb = 11.0 + ((roofY(-2.5) + 0.05 - 11.0) * (i + 1)) / 7;
      K.rod([xa, ya, zz], [xb, yb, zz], 0.04, 4, L.PLAIN);
    }
    B.shell();
  }
  // Couverture en tôle
  K.color(tint('#e8ecf0'));
  K.push().move(5, 0, 0);
  const rx0 = -7.8;
  const rx1 = 7.6;
  const y0r = roofY(rx0 + 5) + 0.1;
  const y1r = roofY(rx1 + 5) + 0.1;
  K.face([[rx0, y0r, len / 2 + 0.6], [rx1, y1r, len / 2 + 0.6], [rx1, y1r, -len / 2 - 0.6], [rx0, y0r, -len / 2 - 0.6]], L.METAL, { U: [0, 0, 1] });
  K.color(tint('#c8ced6'));
  K.face([[rx0, y0r - 0.12, -len / 2 - 0.6], [rx1, y1r - 0.12, -len / 2 - 0.6], [rx1, y1r - 0.12, len / 2 + 0.6], [rx0, y0r - 0.12, len / 2 + 0.6]], L.METAL, { U: [0, 0, 1], ao: 0.6 });
  // Bandeau avant (publicités vers l'eau)
  K.color(tint('#1f4fd1'));
  K.box(rx0 - 0.15, y0r - 1.0, -len / 2 - 0.6, rx0, y0r + 0.15, len / 2 + 0.6, L.PLAIN, { skip: '' });
  K.pop();
  K.push().move(5 + rx0 - 0.16, y0r - 0.43, 0).rotY(-Math.PI / 2);
  const ads = [SIGN.brand, SIGN.sponsor0, SIGN.sponsor1, SIGN.brand, SIGN.sponsor2, SIGN.sponsor3];
  ads.forEach((rect, i) => {
    const wq = rect[2] / rect[3] > 4 ? 14 : 5.5;
    B.signs.quad(K, -len / 2 + 5 + i * 10, 0, 0, wq * 0.75, 0.82, rect);
  });
  K.pop();
}

// =====================================================================
// Portique de départ ou d'arrivée (treillis aluminium, banderoles, chrono)
// =====================================================================

// Repère : x en travers (de -span à +span entre les pieds), z dans le sens de la course, y en haut.
// o : { span, h (dessous de la poutre), front, back (cases d'atlas des banderoles), clock, flags, pillarSign }
export function gantry(B, x, y, z, yaw, o) {
  const K = B.begin(x, y, z, yaw);
  const span = o.span;
  const H = o.h ?? 6.2;
  const bh = o.bh ?? 1.4;
  const alu = tint('#c9ced6');
  const steel = tint('#3a3f48');
  // Pieds en treillis (4 membrures, entretoises en zigzag), lests en béton
  for (const s of [-1, 1]) {
    const px = s * (span + 0.45);
    const fy = o.foot ? o.foot(s) : 0;
    K.color(tint('#9a958c'));
    K.cbox(px, fy - 0.6, 0, 1.4, 1.05, 1.4, L.CONCRETE, { skip: 'ny' });
    K.color(alu);
    const a = 0.32;
    for (const [dx, dz] of [[-a, -a], [a, -a], [-a, a], [a, a]]) K.cyl(px + dx, fy + 0.45, dz, 0.05, 0.05, H + bh - 0.45 - fy, 6, L.METAL, { caps: '' });
    B.detail();
    for (let yy = fy + 0.45, k = 0; yy < H + bh - 0.5; yy += 0.64, k++) {
      for (const [p0, p1] of [[[-a, -a], [a, -a]], [[a, -a], [a, a]], [[a, a], [-a, a]], [[-a, a], [-a, -a]]]) {
        const up = k % 2 ? 0 : 0.64;
        K.rod([px + p0[0], yy + up, p0[1]], [px + p1[0], yy + 0.64 - up, p1[1]], 0.022, 3, L.METAL);
      }
    }
    B.shell();
    // Habillage du pied (bâche verticale)
    if (o.pillarSign) {
      for (const f of [1, -1]) {
        K.push().move(px, 0, f * (a + 0.06)).rotY(f > 0 ? 0 : Math.PI);
        K.color(tint('#ffffff'));
        B.signs.quad(K, 0, 0.9 + (H - 0.9) / 2, 0, 0.62, H - 1.2, o.pillarSign[(s + 1) / 2]);
        K.pop();
      }
    }
  }
  // Poutre en treillis
  const x0 = -span - 0.8;
  const x1 = span + 0.8;
  const dz = 0.42;
  K.color(alu);
  for (const yy of [H, H + bh]) for (const zz of [-dz, dz]) K.rod([x0, yy, zz], [x1, yy, zz], 0.055, 6, L.METAL);
  B.detail();
  const nb = Math.round((x1 - x0) / 0.7);
  for (let i = 0; i < nb; i++) {
    const xa = x0 + ((x1 - x0) * i) / nb;
    const xb = x0 + ((x1 - x0) * (i + 1)) / nb;
    for (const zz of [-dz, dz]) K.rod([xa, i % 2 ? H : H + bh, zz], [xb, i % 2 ? H + bh : H, zz], 0.022, 3, L.METAL);
    K.rod([xa, H + bh, -dz], [xa, H + bh, dz], 0.02, 3, L.METAL);
  }
  B.shell();
  // Panneaux et banderoles (avant / arrière)
  K.color(steel);
  K.box(-span + 0.2, H + 0.12, -0.05, span - 0.2, H + bh - 0.12, 0.05, L.PLAIN, { skip: '' });
  const bw = span * 2 - 0.6;
  const sh = bh - 0.3;
  // Panneaux des partenaires aux deux bouts (o.sponsors : cases d'atlas, format 2:1)
  const sw = o.sponsors ? sh * 1.6 : 0;
  const mw = bw - sw * 2 - (sw ? 0.2 : 0);
  for (const [f, rect] of [[1, o.front], [-1, o.back]]) {
    K.push().move(0, 0, f * 0.06).rotY(f > 0 ? 0 : Math.PI);
    // Banderole principale à ses proportions (sauf motif répété)
    const mh = o.repeat ? sh : Math.min(sh, mw / (rect[2] / rect[3]));
    B.signs.quad(K, 0, H + bh / 2, 0, mw, mh, rect, { repeat: o.repeat || 1 });
    if (o.sponsors) {
      for (const sd of [-1, 1]) B.signs.quad(K, sd * (bw / 2 - sw / 2), H + bh / 2, 0, sw, sh, o.sponsors[(sd + 1 + (f > 0 ? 0 : 1)) % o.sponsors.length]);
    }
    K.pop();
  }
  // Chrono au sommet
  if (o.clock) {
    K.color(tint('#15171c'));
    K.cbox(0, H + bh + 0.06, 0, 2.6, 0.8, 0.5, L.PLAIN, { skip: 'ny' });
    for (const f of [1, -1]) {
      K.push().move(0, 0, f * 0.26).rotY(f > 0 ? 0 : Math.PI);
      B.signs.quad(K, 0, H + bh + 0.46, 0, 2.3, 0.56, SIGN.clock);
      K.pop();
    }
  }
  // Fanions au sommet des pieds
  if (o.flags) {
    const cols = ['#ff5a1f', '#ffd23f', '#1f4fd1', '#2f9e44'];
    for (const s of [-1, 1]) {
      const px = s * (span + 0.45);
      K.color(alu);
      K.cyl(px, H + bh, 0, 0.03, 0.03, 1.6, 5, L.METAL, { caps: 't' });
      K.color(tint(cols[(s + 1) % 4]));
      K.face([[px, H + bh + 1.0, 0], [px + s * 0.9, H + bh + 1.25, 0], [px, H + bh + 1.55, 0]], L.PLAIN);
      K.face([[px + s * 0.9, H + bh + 1.25, 0], [px, H + bh + 1.0, 0], [px, H + bh + 1.55, 0]], L.PLAIN);
    }
  }
}

// Drapeau « plume » publicitaire planté au bord de la route.
export function featherFlag(B, x, y, z, yaw, rect, col) {
  const K = B.begin(x, y, z, yaw);
  K.color(tint('#9aa0a8'));
  K.cbox(0, 0, 0, 0.5, 0.08, 0.5, L.PLAIN, { skip: 'ny' });
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push([Math.sin(t * 1.2) * 0.25, 0.4 + t * 3.0]);
  }
  K.color(tint('#dfe3e8'));
  for (let i = 0; i < 8; i++) K.rod([pts[i][0], pts[i][1], 0], [pts[i + 1][0], pts[i + 1][1], 0], 0.025, 4, L.PLAIN);
  // Voile : bande verticale qui suit le mât, texte de l'atlas
  K.color(col);
  for (const f of [1, -1]) {
    K.push().move(0.38, 2.0, f * 0.01).rotY(f > 0 ? 0 : Math.PI);
    B.signs.quad(K, 0, 0, 0, 0.7, 2.9, rect);
    K.pop();
  }
}

// =====================================================================
// Kayak : passerelle de corde (porte glisse), ponton de départ
// =====================================================================

// Repère : origine au centre de la rivière au niveau de l'eau, x en travers (de -span à +span), z vers l'amont.
export function footbridge(B, x, y, z, yaw, o) {
  const K = B.begin(x, y, z, yaw);
  K.groundAO = false;
  const span = o.span;
  const deckY = o.deckY;
  const wood = tint('#9a6a40');
  const dark = tint('#5e4129');
  // Longerons et tablier en planches (lames dans le sens du courant)
  K.color(dark);
  for (const zz of [-0.8, 0.8]) K.box(-span, deckY - 0.3, zz - 0.12, span, deckY, zz + 0.12, L.WOODH, { skip: '', scale: 0.6, ao: { b: 0.6, t: 0.9, bottom: 0.5 } });
  K.color(wood);
  K.box(-span, deckY, -1.1, span, deckY + 0.12, 1.1, L.WOODH, { skip: 'ny', topU: [0, 0, 1], scale: 0.55, ao: { b: 0.7, t: 1 } });
  K.face([[-span, deckY, 1.1], [span, deckY, 1.1], [span, deckY, -1.1], [-span, deckY, -1.1]].reverse(), L.WOODH, { ao: 0.45 });
  // Bande de danger côté amont
  const stripes = 16;
  for (let k = 0; k < stripes; k++) {
    const xa = -span + (k * span * 2) / stripes;
    K.color(tint(k % 2 ? '#15161a' : '#ffd23f'));
    K.box(xa, deckY - 0.3, 1.1, xa + (span * 2) / stripes, deckY + 0.12, 1.16, L.PLAIN, { skip: 'ny' });
  }
  // Poteaux, mains courantes en corde (chaînettes), filets en losange
  const posts = [];
  for (let px = -span + 0.2; px <= span - 0.2 + 1e-3; px += 1.65) posts.push(px);
  if (posts[posts.length - 1] < span - 0.3) posts.push(span - 0.2);
  K.color(dark);
  for (const px of posts) for (const zz of [-1.0, 1.0]) K.cbox(px, deckY + 0.12, zz, 0.12, 1.15, 0.12, L.WOODV, { skip: 'ny', scale: 0.4 });
  const rope = tint('#c9b38a');
  K.color(rope);
  for (const zz of [-1.0, 1.0]) {
    for (const yy of [1.12, 0.6]) {
      for (let i = 0; i < posts.length - 1; i++) {
        const a = posts[i];
        const b = posts[i + 1];
        const seg = 4;
        for (let k = 0; k < seg; k++) {
          const t0 = k / seg;
          const t1 = (k + 1) / seg;
          const sag = (t) => -Math.sin(Math.PI * t) * 0.09;
          K.rod([a + (b - a) * t0, deckY + yy + sag(t0), zz], [a + (b - a) * t1, deckY + yy + sag(t1), zz], 0.03, 4, L.STRAW, { tile: 0.3 });
        }
      }
    }
  }
  B.detail();
  K.color(rope.map((c) => c * 0.9));
  for (const zz of [-1.0, 1.0]) {
    for (let i = 0; i < posts.length - 1; i++) {
      const a = posts[i];
      const b = posts[i + 1];
      const n = 4;
      for (let k = 0; k < n; k++) {
        const xa = a + ((b - a) * k) / n;
        const xb = a + ((b - a) * (k + 1)) / n;
        K.rod([xa, deckY + 0.15, zz], [xb, deckY + 0.58, zz], 0.012, 3, L.STRAW, { tile: 0.3 });
        K.rod([xb, deckY + 0.15, zz], [xa, deckY + 0.58, zz], 0.012, 3, L.STRAW, { tile: 0.3 });
      }
    }
  }
  B.shell();
  // Culées en pierre sur les berges, haubans vers les rives
  for (const s of [-1, 1]) {
    const gy = o.groundAt(s * (span - 1.0)) - y;
    K.color(tint('#a39b8c'));
    K.box(s * span - 1.4, Math.min(gy, deckY - 1) - 1.2, -1.3, s * span + 0.6, deckY - 0.28, 1.3, L.STONE, { skip: 'ny', ao: { b: 0.7, t: 1 } });
    K.color(dark);
    K.cbox(s * (span + 0.3), deckY - 0.3, 0, 0.3, 2.6, 0.3, L.WOODV);
    K.color(rope);
    for (const zz of [-1.0, 1.0]) K.rod([s * (span + 0.3), deckY + 2.2, 0], [s * (span - 0.2), deckY + 1.12, zz], 0.025, 4, L.STRAW, { tile: 0.3 });
  }
}

// Ponton flottant de départ : planches, flotteurs, bittes, longé contre la rive (liste de cadres).
export function pontoonDeck(B, x, y, z, yaw, len, wdt, cleat = false) {
  const K = B.begin(x, y, z, yaw);
  K.groundAO = false;
  K.color(tint('#a77b4f'));
  K.box(-wdt / 2, 0.1, -len / 2, wdt / 2, 0.3, len / 2, L.WOODH, { skip: 'ny', topU: [1, 0, 0], scale: 0.55, ao: { b: 0.6, t: 1 } });
  K.color(tint('#2b6cff'));
  for (let zz = -len / 2 + 0.6; zz < len / 2; zz += 1.4) {
    for (const s of [-1, 1]) {
      K.push().move(s * (wdt / 2 - 0.35), 0.0, zz).rotX(Math.PI / 2);
      K.cyl(0, -0.55, 0, 0.26, 0.26, 1.1, 8, L.PLAIN, { caps: 'tb' });
      K.pop();
    }
  }
  K.color(tint('#6e4c30'));
  K.box(-wdt / 2 - 0.08, 0.05, -len / 2, -wdt / 2, 0.36, len / 2, L.WOODV);
  K.box(wdt / 2, 0.05, -len / 2, wdt / 2 + 0.08, 0.36, len / 2, L.WOODV);
  if (cleat) {
    K.color(IRON);
    K.cyl(-wdt / 2 + 0.3, 0.3, 0, 0.1, 0.12, 0.42, 8, L.PLAIN);
    K.cyl(-wdt / 2 + 0.3, 0.72, 0, 0.16, 0.16, 0.06, 8, L.PLAIN);
  }
}

// Lampadaire de village en fer forgé (lanterne vitrée sur potence).
export function streetLamp(B, x, y, z, yaw) {
  const K = B.begin(x, y, z, yaw);
  K.color(tint('#a39b8c'));
  K.cyl(0, -0.3, 0, 0.22, 0.2, 0.55, 8, L.ASHLAR, { caps: 't' });
  K.color(IRON);
  K.cyl(0, 0.25, 0, 0.07, 0.05, 3.6, 8, L.PLAIN, { caps: 't' });
  K.rod([0, 3.55, 0], [0, 3.6, 0.75], 0.03, 4, L.PLAIN);
  K.rod([0, 3.1, 0], [0, 3.58, 0.55], 0.02, 4, L.PLAIN);
  K.cbox(0, 3.42, 0.75, 0.05, 0.18, 0.05, L.PLAIN);
  K.push().move(0, 2.95, 0.75);
  K.cbox(0, 0, 0, 0.26, 0.05, 0.26, L.PLAIN, { skip: '' });
  K.color(tint('#ffe6a8'));
  K.cbox(0, 0.05, 0, 0.2, 0.36, 0.2, L.GLASS, { skip: 'ny' });
  K.color(IRON);
  K.lathe([[0.2, 0.41], [0.2, 0.43], [0.05, 0.53], [0.01, 0.58]], 4, L.PLAIN);
  K.pop();
}
