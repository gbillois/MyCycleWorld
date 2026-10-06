// Nature des graphismes détaillés : arbres (feuillus, sapins, buissons, palmiers) avec niveaux de détail
// qui suivent le joueur, balancement dans le vent (dans le shader), herbe dense et fleurs calculées sur la
// carte graphique autour de la caméra (un nombre fixe d'instances recyclées), cartes du terrain
// (altitude, couleur du sol, distance à la route) partagées par l'herbe et l'eau.
import * as THREE from 'three';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const C = (hex) => new THREE.Color(hex);

// Petit bruit 3D déterministe (déformation des feuillages, rochers).
function hash3(x, y, z) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  ) * 2 - 1;
}

// --- Fusion de pièces (position, normale, couleur, uv) avec un groupe par matière ---
// Chaque pièce porte userData.group (0 = bois / feuillage plein, 1 = cartes de feuilles à transparence).
export function mergeParts(parts) {
  const sorted = [...parts].sort((a, b) => (a.userData.group || 0) - (b.userData.group || 0));
  let vCount = 0;
  let iCount = 0;
  for (const g of sorted) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3).fill(1);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  const out = new THREE.BufferGeometry();
  let vo = 0;
  let io = 0;
  let groupStart = 0;
  let current = sorted.length ? sorted[0].userData.group || 0 : 0;
  for (const g of sorted) {
    const grp = g.userData.group || 0;
    if (grp !== current) {
      out.addGroup(groupStart, io - groupStart, current);
      groupStart = io;
      current = grp;
    }
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    if (!g.attributes.normal) g.computeVertexNormals();
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[io + k] = g.index.array[k] + vo;
    else for (let k = 0; k < n; k++) idx[io + k] = k + vo;
    io += g.index ? g.index.count : n;
    vo += n;
  }
  out.addGroup(groupStart, io - groupStart, current);
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

function tag(g, group) {
  g.userData.group = group;
  return g;
}

// Couleur par sommet selon une fonction (x, y, z, nx, ny, nz).
function shade(geo, fn) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(c, p.getX(i), p.getY(i), p.getZ(i), n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// --- Atlas de feuilles (canvas) : grappe de feuilles à gauche, palme à droite ---
let atlasCache = null;
export function leafAtlas() {
  if (atlasCache) return atlasCache;
  const W = 512;
  const H = 256;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Grappe de feuilles (gris clair : la couleur vient des sommets)
  for (let i = 0; i < 420; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 108;
    const x = 128 + Math.cos(a) * d;
    const y = 128 + Math.sin(a) * d;
    const v = Math.round(150 + r() * 105);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r() * Math.PI * 2);
    ctx.beginPath();
    ctx.ellipse(0, 0, 9 + r() * 6, 4 + r() * 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Palme : nervure centrale et folioles qui retombent
  ctx.save();
  ctx.translate(256, 0);
  ctx.strokeStyle = 'rgb(200,200,190)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.stroke();
  for (let i = 0; i < 46; i++) {
    const y = 4 + i * 5.4;
    const len = 118 * Math.sin(Math.PI * Math.min(1, 0.12 + (i / 46) * 0.95)) + 6;
    for (const s of [-1, 1]) {
      const v = Math.round(170 + r() * 70);
      ctx.strokeStyle = `rgb(${v},${v},${v})`;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(128, y);
      ctx.quadraticCurveTo(128 + s * len * 0.6, y + 6, 128 + s * len, y + 22);
      ctx.stroke();
    }
  }
  ctx.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  atlasCache = tex;
  return tex;
}

// Carte de feuilles : quad orienté (normale fournie), uv dans une région de l'atlas.
function card(center, normal, size, rot, region, color) {
  const g = new THREE.PlaneGeometry(size, size);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
  g.rotateZ(rot);
  g.applyQuaternion(q);
  g.translate(center.x, center.y, center.z);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, region[0] + uv.getX(i) * (region[2] - region[0]), region[1] + uv.getY(i) * (region[3] - region[1]));
  return g;
}

// --- Arbres ---

const BARK = C('#5e4532');
const BARK_LIGHT = C('#7d634c');

function trunk(r0, r1, h, seg = 7, bend = 0.25) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 4, true).translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h;
    p.setX(i, p.getX(i) + Math.sin(t * 2.4) * bend * t);
  }
  g.computeVertexNormals();
  return shade(g, (c, x, y) => c.copy(BARK).lerp(BARK_LIGHT, 0.3 + 0.3 * Math.sin(y * 7 + x * 3)));
}

function branch(from, to, r) {
  const d = new THREE.Vector3().subVectors(to, from);
  const g = new THREE.CylinderGeometry(r * 0.6, r, d.length(), 5, 1, true).translate(0, d.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate(from.x, from.y, from.z);
  return shade(g, (c) => c.copy(BARK));
}

// Lobe de feuillage : icosaèdre déformé par un bruit, normales adoucies vers l'extérieur du houppier.
function lobe(center, r, detail, canopyC, canopyR, colors, seed) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + noise3(v.x * 1.7 + seed, v.y * 1.7, v.z * 1.7 - seed) * 0.22;
    v.multiplyScalar(k).add(center);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const n = g.attributes.normal;
  const radial = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    radial.set(p.getX(i) - canopyC.x, (p.getY(i) - canopyC.y) * 0.8, p.getZ(i) - canopyC.z).normalize();
    v.fromBufferAttribute(n, i).lerp(radial, 0.55).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return shade(g, (c, x, y, z) => {
    const out = Math.min(1, Math.hypot(x - canopyC.x, (y - canopyC.y) * 1.1, z - canopyC.z) / canopyR);
    const up = smoothstep(canopyC.y - canopyR, canopyC.y + canopyR, y);
    c.copy(colors[0]).lerp(colors[1], up * 0.8 + out * 0.2).lerp(colors[2], Math.max(0, up - 0.55) * out);
    c.multiplyScalar(0.55 + 0.45 * smoothstep(0.45, 1.0, out));
  });
}

const LEAF = [C('#26501f'), C('#4a8a32'), C('#9cc95c')];

// Feuillu : tronc, branches, houppier de lobes ; en high, des cartes de feuilles donnent une silhouette
// découpée. lod : 0 = proche, 1 = lointain.
export function deciduousGeometry(lod = 0, cards = false) {
  const canopyC = new THREE.Vector3(0, 4.2, 0);
  const R = 2.1;
  const parts = [];
  if (lod === 0) {
    parts.push(tag(trunk(0.32, 0.17, 3.4, 8), 0));
    for (const [a, h] of [[0.4, 2.3], [2.5, 2.7], [4.4, 2.5]]) {
      parts.push(tag(branch(new THREE.Vector3(0.1, h, 0), new THREE.Vector3(Math.cos(a) * 1.3, h + 1.3, Math.sin(a) * 1.3), 0.09), 0));
    }
    const lobes = [[0, 0.2, 0, 1.3], [1.05, -0.2, 0.3, 1.0], [-0.95, -0.15, -0.35, 1.05], [0.25, -0.25, -1.0, 0.95], [-0.3, -0.1, 1.0, 1.0], [0.3, 0.95, 0.2, 0.95], [-0.6, 0.7, -0.4, 0.8], [0.8, 0.6, -0.5, 0.75], [0.0, -0.75, 0.0, 0.9]];
    lobes.forEach(([x, y, z, r], k) => {
      const c = new THREE.Vector3(x, y, z).multiplyScalar(cards ? 0.92 : 1).add(canopyC);
      parts.push(tag(lobe(c, r * (cards ? 0.92 : 1.0), 1, canopyC, R, LEAF, k * 3.1), 0));
    });
    if (cards) {
      let s = 11;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const n = new THREE.Vector3();
      const cpos = new THREE.Vector3();
      for (let i = 0; i < 64; i++) {
        const u = rnd() * 2 - 1;
        const a = rnd() * Math.PI * 2;
        const rr = Math.sqrt(1 - u * u);
        n.set(rr * Math.cos(a), u * 0.85 + 0.12, rr * Math.sin(a)).normalize();
        cpos.set(n.x * R * 0.98, n.y * R * 0.82, n.z * R * 0.98).add(canopyC);
        const g = card(cpos, n.clone().add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.7)), 1.25 + rnd() * 0.5, rnd() * 6.28, [0, 0, 0.5, 1], null);
        const nn = g.attributes.normal;
        for (let k = 0; k < nn.count; k++) nn.setXYZ(k, n.x, n.y, n.z);
        const up = smoothstep(canopyC.y - R, canopyC.y + R, cpos.y);
        const col = LEAF[0].clone().lerp(LEAF[1], 0.35 + up * 0.55).lerp(LEAF[2], Math.max(0, up - 0.5) * 0.7);
        parts.push(tag(shade(g, (c) => c.copy(col)), 1));
      }
    }
  } else {
    parts.push(tag(trunk(0.3, 0.2, 3.0, 5, 0.1), 0));
    for (const [x, y, z, r] of [[0, 0.15, 0, 1.6], [0.9, -0.25, 0.3, 1.15], [-0.85, -0.2, -0.3, 1.2], [0.1, 0.85, -0.1, 1.1]]) {
      parts.push(tag(lobe(new THREE.Vector3(x, y, z).add(canopyC), r, 0, canopyC, R, LEAF, x * 7), 0));
    }
  }
  return mergeParts(parts);
}

// Sapin : étages en étoile qui retombent (silhouette découpée), dessous sombre.
export function pineGeometry(lod = 0) {
  const parts = [tag(trunk(0.26, 0.12, lod ? 2.2 : 2.6, lod ? 5 : 7, 0.05), 0)];
  const tiers = lod ? 3 : 7;
  const K = lod ? 6 : 9;
  const dark = C('#173a25');
  const mid = C('#2b5f3a');
  const tip = C('#4f8a55');
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const yb = 1.2 + f * (lod ? 4.0 : 4.6);
    const h = (lod ? 2.6 : 2.0) - f * 0.7;
    const R = 2.05 * (1 - f * 0.8) + 0.3;
    const pos = [];
    const col = [];
    const rot = t * 0.9;
    pos.push(0, yb + h, 0);
    col.push(tip.r * 0.9, tip.g * 0.9, tip.b * 0.9);
    const ring = 2 * K;
    for (let j = 0; j < ring; j++) {
      const a = (j / ring) * Math.PI * 2 + rot;
      const outer = j % 2 === 0;
      const rr = outer ? R * (0.92 + 0.16 * hash3(t, j, 3)) : R * 0.58;
      pos.push(Math.cos(a) * rr, yb - (outer ? 0.28 * R * 0.5 : -0.05), Math.sin(a) * rr);
      const c = outer ? mid.clone().lerp(tip, 0.55 + f * 0.3) : dark.clone().lerp(mid, 0.4);
      col.push(c.r, c.g, c.b);
    }
    pos.push(0, yb + h * 0.3, 0);
    col.push(dark.r * 0.7, dark.g * 0.7, dark.b * 0.7);
    const idx = [];
    const centre = ring + 1;
    for (let j = 0; j < ring; j++) {
      const a = 1 + j;
      const b = 1 + ((j + 1) % ring);
      idx.push(0, b, a);
      idx.push(centre, a, b);
    }
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g = g.toNonIndexed();
    g.computeVertexNormals();
    // Normales adoucies (vers l'extérieur et le haut) : volume lisible sans facettes dures.
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const v = new THREE.Vector3();
    const o = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      o.set(p.getX(i), 0.6, p.getZ(i)).normalize();
      v.fromBufferAttribute(n, i).lerp(o, 0.5).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
    parts.push(tag(g, 0));
  }
  return mergeParts(parts);
}

export function bushGeometry(lod = 0) {
  const canopyC = new THREE.Vector3(0, 0.55, 0);
  const parts = [];
  const list = lod ? [[0, 0.45, 0, 0.8], [0.5, 0.3, 0.2, 0.55]] : [[0, 0.5, 0, 0.75], [0.55, 0.35, 0.2, 0.55], [-0.5, 0.35, -0.1, 0.58], [0.1, 0.32, -0.55, 0.5], [-0.15, 0.85, 0.15, 0.5]];
  for (const [x, y, z, r] of list) parts.push(tag(lobe(new THREE.Vector3(x, y, z), r, lod ? 0 : 1, canopyC, 1.1, LEAF, x * 5 + z), 0));
  return mergeParts(parts);
}

// Palmier : tronc annelé courbé, palmes en arc (cartes de feuilles) ; version lointaine pleine.
export function palmGeometry(lod = 0) {
  const parts = [];
  const H = 6.2;
  const tr = new THREE.CylinderGeometry(0.17, 0.27, H, lod ? 5 : 9, lod ? 3 : 12, true).translate(0, H / 2, 0);
  const p = tr.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + Math.pow(p.getY(i) / H, 2) * 1.3);
  tr.computeVertexNormals();
  parts.push(tag(shade(tr, (c, x, y) => c.set('#8a6c48').lerp(C('#b39466'), (Math.sin(y * 10) + 1) * 0.25)), 0));
  const top = new THREE.Vector3(1.3, H, 0);
  if (lod === 0) {
    const N = 11;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2 + (k % 2) * 0.2;
      const len = 3.4 + (k % 3) * 0.4;
      const lift = 0.9 - (k % 2) * 0.5;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const pos = [];
      const uv = [];
      const nor = [];
      const SEG = 6;
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        const c = top.clone().addScaledVector(dir, t * len);
        c.y += lift * t * 1.6 - t * t * (1.6 + lift * 1.3);
        const w = 0.55 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.9));
        const l = c.clone().addScaledVector(side, -w);
        const rr = c.clone().addScaledVector(side, w);
        l.y -= w * 0.35;
        rr.y -= w * 0.35;
        pos.push(l.x, l.y, l.z, rr.x, rr.y, rr.z);
        uv.push(0.5, 1 - t, 1.0, 1 - t);
        nor.push(0, 1, 0, 0, 1, 0);
      }
      const idx = [];
      for (let i = 0; i < SEG; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      parts.push(tag(shade(g, (c, x, y) => c.set('#2f6d2c').lerp(C('#86b84e'), smoothstep(H - 1.5, H + 0.8, y))), 1));
    }
    for (let k = 0; k < 3; k++) {
      parts.push(tag(shade(new THREE.SphereGeometry(0.17, 7, 5).translate(top.x + Math.cos(k * 2.1) * 0.25, H - 0.25, Math.sin(k * 2.1) * 0.25), (c) => c.set('#5b4024')), 0));
    }
  } else {
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const frond = new THREE.ConeGeometry(0.42, 3.4, 4).scale(1, 1, 0.18).translate(0, 1.7, 0);
      frond.rotateX(Math.PI / 2 - 0.55);
      frond.rotateY(a);
      frond.translate(top.x, H, 0);
      parts.push(tag(shade(frond, (c, x, y) => c.set('#2f6d2c').lerp(C('#7cb34e'), smoothstep(H - 1, H + 0.6, y))), 0));
    }
  }
  return mergeParts(parts);
}

// Rocher : icosaèdre bosselé, mousse sur le dessus.
export function rockGeometry(detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + noise3(v.x * 1.6, v.y * 1.6, v.z * 1.6) * 0.28 + noise3(v.x * 4, v.y * 4, v.z * 4) * 0.08;
    v.multiplyScalar(k);
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return shade(g, (c, x, y, z, nx, ny) => {
    c.set('#8c877c').lerp(C('#b3ada0'), smoothstep(-0.5, 0.8, y) * 0.7);
    c.multiplyScalar(0.85 + noise3(x * 5, y * 5, z * 5) * 0.15);
    c.lerp(C('#5d7a3a'), smoothstep(0.55, 0.9, ny) * 0.55);
  });
}

// --- Vent : balancement des arbres dans le shader (aucun calcul CPU) ---
export function windMaterial(mat, shared, { base = 1.2, amount = 0.0045, flutter = 0.0, key = 'tree', noFlip = false } = {}) {
  mat.onBeforeCompile = (sh) => {
    // Cartes de feuilles vues de dos : normale conservée (sinon le dos des feuilles serait noir).
    if (noFlip) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n\tnormal = normalize( vNormal );');
    sh.uniforms.uTime = shared.uTime;
    sh.uniforms.uWind = shared.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 wSeed = vec2( instanceMatrix[3][0], instanceMatrix[3][2] );
        #else
          vec2 wSeed = vec2( modelMatrix[3][0], modelMatrix[3][2] );
        #endif
        float wH = max( transformed.y - ${base.toFixed(2)}, 0.0 );
        float wPh = uTime * 1.15 + dot( wSeed, vec2( 0.031, 0.027 ) );
        float wBend = ( sin( wPh ) * 0.55 + sin( wPh * 2.31 + 1.7 ) * 0.22 + 0.4 ) * uWind * ${amount.toFixed(5)};
        transformed.xz += vec2( 0.85, 0.5 ) * wBend * wH * wH;
        ${flutter > 0 ? `transformed += objectNormal * sin( uTime * 7.0 + dot( position, vec3( 3.1, 2.3, 4.7 ) ) + wSeed.x ) * ${flutter.toFixed(3)} * step( ${base.toFixed(2)}, transformed.y );` : ''}`);
  };
  mat.customProgramCacheKey = () => `wind-${key}-${base}-${amount}-${flutter}-${noFlip}`;
  return mat;
}

// --- Imposteurs : arbres lointains en panneaux toujours tournés vers la caméra (2 triangles par arbre) ---
// Peints une fois sur un canvas (feuillu, sapin, buisson, palmier), teintés par instance, éclairés et
// pris dans la brume comme le reste.
const IMPOSTOR_CELLS = { deciduous: 0, pine: 1, bush: 2, palm: 3 };
const IMPOSTOR_SIZE = { deciduous: [5.2, 6.9], pine: [4.8, 7.9], bush: [2.7, 1.6], palm: [7.2, 8.2] };
let impostorCache = null;
export function impostorAtlas() {
  if (impostorCache) return impostorCache;
  const CW = 128;
  const CH = 256;
  const cv = document.createElement('canvas');
  cv.width = CW * 4;
  cv.height = CH;
  const ctx = cv.getContext('2d');
  let seed = 3;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blob = (x, y, rad, dark, mid, light) => {
    const g = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.1, x, y, rad);
    g.addColorStop(0, light);
    g.addColorStop(0.55, mid);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  };
  // Feuillu : tronc puis houppier de boules ombrées (lumière en haut à gauche)
  ctx.fillStyle = '#5e4532';
  ctx.fillRect(CW / 2 - 5, CH * 0.6, 10, CH * 0.4);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 34;
    const x = CW / 2 + Math.cos(a) * d * 1.05;
    const y = CH * 0.36 + Math.sin(a) * d * 1.1;
    blob(x, y, 20 + r() * 12, '#1f4419', '#3f7a2c', '#86b850');
  }
  // Sapin : étages dentelés, plus clairs côté soleil
  ctx.save();
  ctx.translate(CW, 0);
  ctx.fillStyle = '#4a3626';
  ctx.fillRect(CW / 2 - 4, CH * 0.8, 8, CH * 0.2);
  for (let t = 0; t < 8; t++) {
    const f = t / 7;
    const yb = CH * (0.86 - f * 0.66);
    const w = 58 * (1 - f * 0.8) + 6;
    const h = 46 - f * 10;
    ctx.beginPath();
    ctx.moveTo(CW / 2, yb - h);
    const teeth = 7;
    for (let k = 0; k <= teeth; k++) {
      const u = k / teeth;
      const x = CW / 2 + (u * 2 - 1) * w;
      ctx.lineTo(x, yb + (k % 2 ? -6 : 3));
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(CW / 2 - w, 0, CW / 2 + w, 0);
    g.addColorStop(0, '#3f7a47');
    g.addColorStop(0.5, '#265635');
    g.addColorStop(1, '#163622');
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.restore();
  // Buisson : quelques boules basses
  ctx.save();
  ctx.translate(CW * 2, 0);
  for (let i = 0; i < 12; i++) blob(CW / 2 + (r() - 0.5) * 70, CH * 0.8 + (r() - 0.5) * 30, 18 + r() * 10, '#1f4419', '#3f7a2c', '#86b850');
  ctx.restore();
  // Palmier : tronc courbé, palmes en arc
  ctx.save();
  ctx.translate(CW * 3, 0);
  ctx.strokeStyle = '#8a6c48';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(CW / 2 - 8, CH);
  ctx.quadraticCurveTo(CW / 2 - 6, CH * 0.45, CW / 2 + 12, CH * 0.26);
  ctx.stroke();
  ctx.lineCap = 'round';
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * Math.PI * 2;
    const dx = Math.cos(a) * 52;
    ctx.strokeStyle = k % 2 ? '#3f7a32' : '#2c5e27';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(CW / 2 + 12, CH * 0.26);
    ctx.quadraticCurveTo(CW / 2 + 12 + dx * 0.6, CH * 0.26 - 30 + Math.sin(a) * 8, CW / 2 + 12 + dx, CH * 0.26 + 18 + Math.abs(Math.sin(a)) * 16);
    ctx.stroke();
  }
  ctx.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  impostorCache = tex;
  return tex;
}

function impostorGeometry(kind) {
  const [w, h] = IMPOSTOR_SIZE[kind];
  const g = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
  const uv = g.attributes.uv;
  const cell = IMPOSTOR_CELLS[kind];
  for (let i = 0; i < uv.count; i++) uv.setX(i, (cell + uv.getX(i)) / 4);
  return g;
}

export function impostorMaterial() {
  const mat = new THREE.MeshStandardMaterial({ map: impostorAtlas(), alphaTest: 0.5, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <beginnormal_vertex>', `
        vec3 bbPos = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );
        vec3 bbTo = cameraPosition - bbPos;
        bbTo.y = 0.0;
        bbTo = normalize( bbTo + vec3( 1e-4, 0.0, 0.0 ) );
        mat3 bbInv = inverse( mat3( instanceMatrix ) );
        vec3 objectNormal = bbInv * normalize( bbTo * 0.55 + vec3( 0.0, 0.8, 0.0 ) );`)
      .replace('#include <begin_vertex>', `
        float bbSx = length( vec3( instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2] ) );
        float bbSy = length( vec3( instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2] ) );
        vec3 bbRight = vec3( bbTo.z, 0.0, - bbTo.x );
        vec3 transformed = bbInv * ( bbRight * position.x * bbSx + vec3( 0.0, position.y * bbSy, 0.0 ) );`);
  };
  mat.customProgramCacheKey = () => 'impostor';
  return mat;
}

// --- Forêt avec niveaux de détail ---
// Pour chaque espèce : arbres proches (détaillés, ombres portées), moyens (détaillés, sans ombre) et
// lointains (imposteurs, ou géométrie simple). La répartition est refaite quand le joueur a bougé de
// quelques mètres.
export class Forest {
  constructor(group, species, { close = 55, mid = 120 } = {}) {
    this.close2 = close * close;
    this.mid2 = mid * mid;
    this.mid = mid;
    this.species = [];
    this.last = new THREE.Vector2(1e9, 1e9);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s3 = new THREE.Vector3();
    const v3 = new THREE.Vector3();
    const white = new THREE.Color(1, 1, 1);
    for (const sp of species) {
      const n = sp.items.length;
      if (!n) continue;
      const mats = new Float32Array(n * 16);
      const cols = new Float32Array(n * 3);
      const xz = new Float32Array(n * 2);
      sp.items.forEach(([x, y, z, sc, rot], i) => {
        m4.compose(v3.set(x, y - 0.15, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot * 6.283), s3.set(sc, sc * (0.9 + rot * 0.25), sc));
        m4.toArray(mats, i * 16);
        const c = sp.tints ? sp.tints[Math.floor(rot * 997) % sp.tints.length] : white;
        cols[i * 3] = c.r;
        cols[i * 3 + 1] = c.g;
        cols[i * 3 + 2] = c.b;
        xz[i * 2] = x;
        xz[i * 2 + 1] = z;
      });
      const make = (geo, mat, cast) => {
        const mesh = new THREE.InstancedMesh(geo, mat, n);
        mesh.count = 0;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.setColorAt(0, white);
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
      };
      const nearMat = sp.nearMaterial || sp.material;
      const entry = {
        n, mats, cols, xz,
        close: make(sp.near, nearMat, sp.cast),
        mid: make(sp.near, nearMat, false),
        far: sp.impostor
          ? make(impostorGeometry(sp.impostor), (this.impostorMat ||= impostorMaterial()), false)
          : make(sp.far || sp.near, sp.material, false),
      };
      entry.close.boundingSphere = new THREE.Sphere(new THREE.Vector3(), close + 15);
      entry.mid.boundingSphere = new THREE.Sphere(new THREE.Vector3(), mid + 15);
      entry.far.frustumCulled = false; // répartis sur toute la carte
      this.species.push(entry);
    }
  }

  update(x, z, y = 0) {
    this.y = y;
    if ((x - this.last.x) ** 2 + (z - this.last.y) ** 2 < 36) return;
    this.last.set(x, z);
    for (const sp of this.species) {
      let nc = 0, nm = 0, nf = 0;
      const { close, mid, far, mats, cols, xz } = sp;
      const cm = close.instanceMatrix.array, mm = mid.instanceMatrix.array, fm = far.instanceMatrix.array;
      const cc = close.instanceColor.array, mc = mid.instanceColor.array, fc = far.instanceColor.array;
      for (let i = 0; i < sp.n; i++) {
        const d2 = (xz[i * 2] - x) ** 2 + (xz[i * 2 + 1] - z) ** 2;
        const src = mats.subarray(i * 16, i * 16 + 16);
        const col = cols.subarray(i * 3, i * 3 + 3);
        if (d2 < this.close2) {
          cm.set(src, nc * 16);
          cc.set(col, nc * 3);
          nc++;
        } else if (d2 < this.mid2) {
          mm.set(src, nm * 16);
          mc.set(col, nm * 3);
          nm++;
        } else {
          fm.set(src, nf * 16);
          fc.set(col, nf * 3);
          nf++;
        }
      }
      for (const [mesh, count] of [[close, nc], [mid, nm], [far, nf]]) {
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
      }
      // Sphères englobantes centrées sur le joueur (les arbres proches et moyens sont autour de lui).
      close.boundingSphere.center.set(x, this.y, z);
      mid.boundingSphere.center.set(x, this.y, z);
    }
  }
}

// --- Cartes du terrain (pour l'herbe et l'eau) ---
// Altitude : texture flottante (lue par texelFetch, interpolée comme les triangles du maillage).
// Sol : couleur de l'herbe + densité d'herbe. Route : distance à l'axe (m × 20, plafonnée à 12,75 m).
export function makeFieldMaps({ heights, nx, nz, x0, z0, cellX, cellZ, ground }) {
  const heightTex = new THREE.DataTexture(heights, nx, nz, THREE.RedFormat, THREE.FloatType);
  heightTex.magFilter = heightTex.minFilter = THREE.NearestFilter;
  heightTex.generateMipmaps = false;
  heightTex.needsUpdate = true;
  const groundTex = new THREE.DataTexture(ground, nx, nz, THREE.RGBAFormat);
  groundTex.magFilter = groundTex.minFilter = THREE.LinearFilter;
  groundTex.generateMipmaps = false;
  groundTex.needsUpdate = true;
  return {
    heightTex, groundTex, nx, nz, x0, z0, cellX, cellZ,
    // Uniforms communs (shader TERRAIN_GLSL)
    uniforms: {
      uHeight: { value: heightTex },
      uGround: { value: groundTex },
      uHField: { value: new THREE.Vector4(x0, z0, 1 / cellX, 1 / cellZ) },
      uHSize: { value: new THREE.Vector2(nx, nz) },
      uRoad: { value: null },
      uRField: { value: new THREE.Vector4(0, 0, 1, 1) },
      uRSize: { value: new THREE.Vector2(1, 1) },
    },
    dispose() {
      heightTex.dispose();
      groundTex.dispose();
      this.uniforms.uRoad.value?.dispose();
    },
  };
}

// Distance à la route sur une grille de 2 m : chaque point du tracé « tamponne » les cases voisines.
export function makeRoadMap(maps, track) {
  const cell = 2;
  const x0 = maps.x0;
  const z0 = maps.z0;
  const nx = Math.ceil(((maps.nx - 1) * maps.cellX) / cell) + 1;
  const nz = Math.ceil(((maps.nz - 1) * maps.cellZ) / cell) + 1;
  const dist = new Float32Array(nx * nz).fill(12.75);
  const R = 12.75;
  const rc = Math.ceil(R / cell);
  for (let k = 0; k < track.count; k++) {
    const px = track.x[k];
    const pz = track.z[k];
    const ci = Math.round((px - x0) / cell);
    const cj = Math.round((pz - z0) / cell);
    for (let j = Math.max(0, cj - rc); j <= Math.min(nz - 1, cj + rc); j++) {
      const dz = z0 + j * cell - pz;
      for (let i = Math.max(0, ci - rc); i <= Math.min(nx - 1, ci + rc); i++) {
        const dx = x0 + i * cell - px;
        const d = Math.sqrt(dx * dx + dz * dz);
        const o = j * nx + i;
        if (d < dist[o]) dist[o] = d;
      }
    }
  }
  const data = new Uint8Array(nx * nz);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(dist[i] * 20);
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  maps.uniforms.uRoad.value = tex;
  maps.uniforms.uRField.value.set(x0, z0, 1 / cell, 1 / cell);
  maps.uniforms.uRSize.value.set(nx, nz);
  maps.roadAt = (x, z) => {
    const i = Math.round((x - x0) / cell);
    const j = Math.round((z - z0) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return 12.75;
    return dist[j * nx + i];
  };
  return tex;
}

// Altitude du terrain dans un shader (mêmes triangles que le maillage).
export const TERRAIN_GLSL = /* glsl */ `
uniform sampler2D uHeight;
uniform sampler2D uGround;
uniform sampler2D uRoad;
uniform vec4 uHField;
uniform vec2 uHSize;
uniform vec4 uRField;
uniform vec2 uRSize;
float terrainH( vec2 p ) {
  vec2 g = ( p - uHField.xy ) * uHField.zw;
  g = clamp( g, vec2( 0.0 ), uHSize - 1.001 );
  ivec2 i = ivec2( floor( g ) );
  vec2 f = g - vec2( i );
  float ha = texelFetch( uHeight, i, 0 ).r;
  float hb = texelFetch( uHeight, i + ivec2( 0, 1 ), 0 ).r;
  float hc = texelFetch( uHeight, i + ivec2( 1, 1 ), 0 ).r;
  float hd = texelFetch( uHeight, i + ivec2( 1, 0 ), 0 ).r;
  return ( f.x + f.y <= 1.0 ) ? ha + ( hd - ha ) * f.x + ( hb - ha ) * f.y : hc + ( hb - hc ) * ( 1.0 - f.x ) + ( hd - hc ) * ( 1.0 - f.y );
}
vec4 groundAt( vec2 p ) {
  return texture2D( uGround, ( ( p - uHField.xy ) * uHField.zw + 0.5 ) / uHSize );
}
float roadDist( vec2 p ) {
  return texture2D( uRoad, ( ( p - uRField.xy ) * uRField.zw + 0.5 ) / uRSize ).r * 12.75;
}`;

// --- Herbe et fleurs sur la carte graphique ---
// Un carré de touffes qui « suit » la caméra : chaque touffe est replacée à la copie la plus proche d'elle
// (mosaïque), posée sur le terrain, masquée sur la route et là où il n'y a pas d'herbe, et rétrécit avec
// la distance. Une seule instruction de dessin, aucun calcul CPU par image.
function bladeClump(blades, height, width, seed) {
  const pos = [];
  const col = [];
  const idx = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 0.28;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const yaw = rnd() * Math.PI;
    const h = height * (0.6 + rnd() * 0.6);
    const lean = (rnd() - 0.5) * 0.5;
    const dx = Math.cos(yaw) * width * 0.5;
    const dz = Math.sin(yaw) * width * 0.5;
    const lx = Math.cos(a) * lean;
    const lz = Math.sin(a) * lean;
    const base = pos.length / 3;
    const seg = [[0, 1], [0.5, 0.75]];
    for (const [t, w] of seg) {
      const y = t * h;
      const ox = cx + lx * t * t * h;
      const oz = cz + lz * t * t * h;
      pos.push(ox - dx * w, y, oz - dz * w, ox + dx * w, y, oz + dz * w);
      const k = 0.38 + t * 0.6;
      col.push(k, k, k, k, k, k);
    }
    pos.push(cx + lx * h, h, cz + lz * h);
    col.push(1.25, 1.3, 1.1);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  return { pos, col, idx };
}

function flowerClump(seed) {
  const pos = [];
  const col = [];
  const idx = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let f = 0; f < 3; f++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 0.22;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const h = 0.28 + rnd() * 0.2;
    const base = pos.length / 3;
    // Tige (un triangle fin, vert : couleur < 0.5 => pas teintée par la fleur)
    pos.push(cx - 0.012, 0, cz, cx + 0.012, 0, cz, cx, h, cz);
    col.push(0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3);
    idx.push(base, base + 1, base + 2);
    // Corolle : petite étoile à 5 pétales (couleur 1 => teintée)
    const c0 = pos.length / 3;
    pos.push(cx, h + 0.01, cz);
    col.push(1.3, 1.3, 1.3);
    for (let k = 0; k < 5; k++) {
      const pa = (k / 5) * Math.PI * 2;
      pos.push(cx + Math.cos(pa) * 0.05, h, cz + Math.sin(pa) * 0.05);
      col.push(1, 1, 1);
    }
    for (let k = 0; k < 5; k++) idx.push(c0, c0 + 1 + ((k + 1) % 5), c0 + 1 + k);
  }
  return { pos, col, idx };
}

export function makeGrassField(maps, shared, { quality = 'high', kind = 'grass' } = {}) {
  const high = quality === 'high';
  const flowers = kind === 'flowers';
  const size = high ? 72 : 50;
  const radius = high ? 34 : 23;
  const count = flowers ? (high ? 2600 : 1100) : high ? 15000 : 5500;
  const clump = flowers ? flowerClump(5) : bladeClump(high ? 5 : 4, 0.55, 0.08, 3);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(clump.pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(clump.col, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(clump.pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(clump.idx);
  const inst = new Float32Array(count * 3);
  let s = flowers ? 99 : 41;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    inst[i * 3] = rnd() * size;
    inst[i * 3 + 1] = rnd() * size;
    inst[i * 3 + 2] = rnd();
  }
  geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 3));
  geo.instanceCount = count;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const center = new THREE.Vector2();
  const uniforms = {
    ...maps.uniforms,
    uTime: shared.uTime,
    uWind: shared.uWind,
    uNoise: { value: shared.noise },
    uCenter: { value: center },
    uSize: { value: size },
    uRadius: { value: radius },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        ${TERRAIN_GLSL}
        attribute vec3 aInst;
        uniform float uTime, uWind, uSize, uRadius;
        uniform vec2 uCenter;
        uniform sampler2D uNoise;`)
      .replace('void main() {', `void main() {
        vec2 gxz = aInst.xy + uSize * floor( ( uCenter - aInst.xy ) / uSize + 0.5 );
        float gr = aInst.z;
        float gDist = distance( gxz, cameraPosition.xz );
        vec4 gGround = groundAt( gxz );
        float gDens = gGround.a * smoothstep( ${(4 + 2.4).toFixed(1)}, ${(4 + 3.6).toFixed(1)}, roadDist( gxz ) );
        ${flowers ? 'gDens *= smoothstep( 0.52, 0.62, texture2D( uNoise, gxz * 0.012 ).g );' : 'gDens *= 0.55 + 0.6 * texture2D( uNoise, gxz * 0.02 ).g;'}
        float gScale = step( fract( gr * 7.13 ), gDens ) * ( 1.0 - smoothstep( uRadius * 0.55, uRadius, gDist ) );
        gScale *= 0.7 + fract( gr * 13.7 ) * 0.6;
        float gH = terrainH( gxz );`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        ${flowers
          ? `vec3 fPal = fract( gr * 31.7 ) < 0.3 ? vec3( 1.0 ) : fract( gr * 31.7 ) < 0.55 ? vec3( 1.0, 0.86, 0.2 ) : fract( gr * 31.7 ) < 0.75 ? vec3( 0.95, 0.42, 0.62 ) : fract( gr * 31.7 ) < 0.9 ? vec3( 0.66, 0.5, 1.0 ) : vec3( 1.0, 0.4, 0.25 );
             vColor.rgb = color.r < 0.5 ? gGround.rgb * 0.8 : fPal * color.r;`
          : 'vColor.rgb *= gGround.rgb * vec3( 1.02, 1.08, 0.95 );'}`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );')
      .replace('#include <begin_vertex>', `
        float gA = gr * 6.2831;
        vec3 transformed = position;
        transformed.xz = mat2( cos( gA ), -sin( gA ), sin( gA ), cos( gA ) ) * transformed.xz;
        transformed *= gScale;
        float wPh = uTime * 1.9 + gxz.x * 0.23 + gxz.y * 0.17;
        float gBend = ( sin( wPh ) * 0.45 + sin( wPh * 2.7 + gxz.y ) * 0.12 + 0.55 ) * uWind;
        float hy = transformed.y;
        transformed.xz += vec2( 0.75, 0.42 ) * gBend * hy * hy * 1.6;
        transformed.y -= gBend * gBend * hy * hy * 0.35;
        transformed += vec3( gxz.x, gH - 0.03, gxz.y );`);
    // Brins vus de dos : on garde la normale vers le haut (pas d'inversion double face).
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n\tnormal = normalize( vNormal );');
  };
  mat.customProgramCacheKey = () => `grass-${kind}-${quality}`;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = high; // ombres portées sur l'herbe : seulement en high (coût par pixel)
  mesh.renderOrder = -1;
  const dir = new THREE.Vector3();
  return {
    mesh,
    update(camera) {
      camera.getWorldDirection(dir);
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      dir.normalize();
      center.set(camera.position.x + dir.x * (size / 2 - 9), camera.position.z + dir.z * (size / 2 - 9));
    },
  };
}
