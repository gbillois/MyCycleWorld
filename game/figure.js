// Outils partagés par les coureurs (rider.js) et les rameurs (boat.js) : construction de géométries
// lisses (balayages, membres arrondis), fusion par matériau, table PBR, squelette humain « skinné »
// (un seul appel de dessin pour tout le corps) et maillots peints sur canvas aux couleurs de chaque équipe.
// Tout est construit une fois puis mis en cache : les instances partagent géométries et textures.
import * as THREE from 'three';
import { wantsTouch } from './touch.js';

// Qualité par défaut (même logique que main.js) quand l'appelant ne la précise pas.
export function defaultQuality() {
  const params = new URLSearchParams(location.search);
  const q = params.get('quality');
  if (['high', 'medium', 'low'].includes(q)) return q;
  let gfx = params.get('gfx');
  if (!gfx) {
    try {
      gfx = localStorage.getItem('mycycleworld.gfx');
    } catch {
      gfx = null;
    }
  }
  if (gfx === 'simple') return 'low';
  return wantsTouch(params) ? 'medium' : 'high';
}

// Ressource partagée entre instances : disposeTree() ne doit jamais la libérer.
export function keep(obj) {
  obj.dispose = () => {};
  return obj;
}

// --- Table PBR : chaque pièce pointe (attribut uv1) vers un texel qui donne vernis, rugosité et métal ---
// R = vernis (clearcoat), G = rugosité, B = métal. Un seul matériau rend ainsi caoutchouc, carbone et chrome.
export const PBR = { paint: 0, carbon: 1, rubber: 2, chrome: 3, alu: 4, plastic: 5, fabric: 6, decal: 7, matte: 8, glass: 9, satin: 10 };
const LUT_VALUES = [
  [1, 0.34, 0.25], // peinture métallisée vernie
  [1, 0.42, 0.05], // carbone verni
  [0, 0.86, 0], // caoutchouc
  [0, 0.2, 1], // chrome
  [0, 0.38, 0.85], // alu anodisé
  [0, 0.48, 0], // plastique satiné
  [0, 0.72, 0], // tissu, guidoline
  [1, 0.3, 0], // autocollant verni
  [0, 0.62, 0.05], // mat
  [0.6, 0.05, 0.2], // verre, écran
  [0.4, 0.3, 0.1], // satin brillant
];
const LUT_N = 16;
let lutTex = null;
export function pbrLut() {
  if (lutTex) return lutTex;
  const data = new Uint8Array(LUT_N * 4);
  LUT_VALUES.forEach(([c, r, m], i) => data.set([c * 255, r * 255, m * 255, 255], i * 4));
  lutTex = keep(new THREE.DataTexture(data, LUT_N, 1));
  lutTex.magFilter = lutTex.minFilter = THREE.NearestFilter;
  lutTex.channel = 1;
  lutTex.needsUpdate = true;
  return lutTex;
}
const lutU = (cls) => (cls + 0.5) / LUT_N;

// --- Assemblage de pièces en une seule géométrie (position, normale, couleur, uv, uv1, os) ---
const _c = new THREE.Color();
export class Parts {
  constructor() {
    this.list = [];
  }

  // opts : color (hex ou fonction (c, x, y, z, u, v)), pbr (classe), rect [x, y, w, h] de l'atlas (sinon texel blanc),
  // bone (indice) ou skin (fonction (x, y, z) -> [i0, i1, w1]).
  add(geo, opts = {}) {
    if (!geo.index) {
      const n = geo.attributes.position.count;
      geo.setIndex(Array.from({ length: n }, (_, i) => i));
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    this.list.push({ geo, ...opts });
    return geo;
  }

  build({ skinned = false, white = [0.004, 0.996] } = {}) {
    let vCount = 0;
    let iCount = 0;
    for (const p of this.list) {
      vCount += p.geo.attributes.position.count;
      iCount += p.geo.index.count;
    }
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const col = new Float32Array(vCount * 3);
    const uv = new Float32Array(vCount * 2);
    const uv1 = new Float32Array(vCount * 2);
    const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
    const si = skinned ? new Uint16Array(vCount * 4) : null;
    const sw = skinned ? new Float32Array(vCount * 4) : null;
    let vo = 0;
    let io = 0;
    for (const p of this.list) {
      const g = p.geo;
      const P = g.attributes.position;
      const N = g.attributes.normal;
      const UV = g.attributes.uv;
      const n = P.count;
      pos.set(P.array.subarray(0, n * 3), vo * 3);
      nor.set(N.array.subarray(0, n * 3), vo * 3);
      const colorFn = typeof p.color === 'function' ? p.color : null;
      if (!colorFn) _c.set(p.color ?? '#ffffff');
      const lu = lutU(p.pbr ?? PBR.matte);
      for (let i = 0; i < n; i++) {
        const k = vo + i;
        const u = UV ? UV.getX(i) : 0;
        const v = UV ? UV.getY(i) : 0;
        if (colorFn) colorFn(_c, P.getX(i), P.getY(i), P.getZ(i), u, v);
        col[k * 3] = _c.r;
        col[k * 3 + 1] = _c.g;
        col[k * 3 + 2] = _c.b;
        if (p.uvFn) {
          const r = p.uvFn(P.getX(i), P.getY(i), P.getZ(i), u, v);
          uv[k * 2] = r[0];
          uv[k * 2 + 1] = r[1];
        } else if (p.rect && UV) {
          const [rx, ry, rw, rh] = p.rect;
          uv[k * 2] = rx + Math.min(0.995, Math.max(0.005, u)) * rw;
          uv[k * 2 + 1] = 1 - (ry + (1 - Math.min(0.995, Math.max(0.005, v))) * rh);
        } else {
          uv[k * 2] = white[0];
          uv[k * 2 + 1] = white[1];
        }
        uv1[k * 2] = lu;
        uv1[k * 2 + 1] = 0.5;
        if (skinned) {
          if (p.skin) {
            const [a, b, w] = p.skin(P.getX(i), P.getY(i), P.getZ(i));
            si[k * 4] = a;
            si[k * 4 + 1] = b;
            sw[k * 4] = 1 - w;
            sw[k * 4 + 1] = w;
          } else {
            si[k * 4] = p.bone ?? 0;
            sw[k * 4] = 1;
          }
        }
      }
      const I = g.index.array;
      for (let k = 0; k < g.index.count; k++) idx[io + k] = I[k] + vo;
      io += g.index.count;
      vo += n;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    if (skinned) {
      out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    }
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }
}

// Normales lissées entre sommets confondus (coutures des membres, pôles des calottes).
export function fixSeams(geo) {
  const P = geo.attributes.position;
  const N = geo.attributes.normal;
  const map = new Map();
  for (let i = 0; i < P.count; i++) {
    const key = `${Math.round(P.getX(i) * 1e5)},${Math.round(P.getY(i) * 1e5)},${Math.round(P.getZ(i) * 1e5)}`;
    let e = map.get(key);
    if (!e) map.set(key, (e = { x: 0, y: 0, z: 0, ids: [] }));
    e.x += N.getX(i);
    e.y += N.getY(i);
    e.z += N.getZ(i);
    e.ids.push(i);
  }
  for (const e of map.values()) {
    if (e.ids.length < 2) continue;
    const l = Math.hypot(e.x, e.y, e.z) || 1;
    for (const i of e.ids) N.setXYZ(i, e.x / l, e.y / l, e.z / l);
  }
  return geo;
}

// Retourne les triangles si leurs normales géométriques s'opposent aux normales des sommets.
export function fixWinding(geo) {
  const P = geo.attributes.position;
  const N = geo.attributes.normal;
  const I = geo.index.array;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let score = 0;
  for (let k = 0; k < I.length; k += 3) {
    a.fromBufferAttribute(P, I[k]);
    b.fromBufferAttribute(P, I[k + 1]).sub(a);
    c.fromBufferAttribute(P, I[k + 2]).sub(a);
    b.cross(c);
    score += b.x * N.getX(I[k]) + b.y * N.getY(I[k]) + b.z * N.getZ(I[k]);
  }
  if (score < 0) {
    for (let k = 0; k < I.length; k += 3) {
      const t = I[k + 1];
      I[k + 1] = I[k + 2];
      I[k + 2] = t;
    }
  }
  return geo;
}

// Balayage d'une section elliptique (rx latéral, ry dans le plan) le long d'une courbe.
// ref : direction de référence pour l'axe rx (X pour les tubes du cadre, dans le plan YZ).
const _T = new THREE.Vector3();
const _N = new THREE.Vector3();
const _B = new THREE.Vector3();
const _P = new THREE.Vector3();
export function sweep(curve, { segs = 16, radial = 10, radius = () => [0.01, 0.01], ref = new THREE.Vector3(1, 0, 0), caps = false } = {}) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const ring = (t) => {
    curve.getPointAt(t, _P);
    curve.getTangentAt(t, _T).normalize();
    _N.copy(ref).addScaledVector(_T, -ref.dot(_T));
    if (_N.lengthSq() < 1e-8) _N.set(0, 1, 0).addScaledVector(_T, -_T.y);
    _N.normalize();
    _B.crossVectors(_T, _N);
    return radius(t);
  };
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const [rx, ry] = ring(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pos.push(_P.x + _N.x * c * rx + _B.x * s * ry, _P.y + _N.y * c * rx + _B.y * s * ry, _P.z + _N.z * c * rx + _B.z * s * ry);
      const nx = _N.x * c * ry + _B.x * s * rx;
      const ny = _N.y * c * ry + _B.y * s * rx;
      const nz = _N.z * c * ry + _B.z * s * rx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / l, ny / l, nz / l);
      uv.push(t, j / radial);
    }
  }
  const R = radial + 1;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * R + j;
      const b = a + R;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  if (caps) {
    for (const [t, sgn] of [[0, -1], [1, 1]]) {
      const [rx, ry] = ring(t);
      const base = pos.length / 3;
      pos.push(_P.x, _P.y, _P.z);
      nor.push(_T.x * sgn, _T.y * sgn, _T.z * sgn);
      uv.push(t, 0);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        pos.push(_P.x + _N.x * c * rx + _B.x * s * ry, _P.y + _N.y * c * rx + _B.y * s * ry, _P.z + _N.z * c * rx + _B.z * s * ry);
        nor.push(_T.x * sgn, _T.y * sgn, _T.z * sgn);
        uv.push(t, j / radial);
      }
      for (let j = 0; j < radial; j++) {
        if (sgn > 0) idx.push(base, base + 1 + j, base + 2 + j);
        else idx.push(base, base + 2 + j, base + 1 + j);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return fixWinding(g);
}

// Interpolation lisse d'un profil [[t, a, b, c...]] trié selon t.
export function profileAt(prof, t) {
  if (t <= prof[0][0]) return prof[0].slice(1);
  for (let k = 1; k < prof.length; k++) {
    if (t <= prof[k][0]) {
      const p = prof[k - 1];
      const q = prof[k];
      let f = (t - p[0]) / (q[0] - p[0]);
      f = f * f * (3 - 2 * f);
      return p.slice(1).map((v, i) => v + (q[i + 1] - v) * f);
    }
  }
  return prof[prof.length - 1].slice(1);
}

// Membre arrondi le long de -Y (de l'articulation vers l'extrémité), sections elliptiques
// prof = [[t, rx, rz, cz]] ; calottes hémisphériques aux deux bouts : les articulations restent pleines quel que soit l'angle.
// uv : u autour (0.5 = devant, +Z), v = 1 en haut, 0 en bas.
export function limbGeo(len, prof, radial = 12, rings = 10, capRings = 4) {
  const rows = [];
  const [ax, az, acz] = profileAt(prof, 0);
  const [bx, bz, bcz] = profileAt(prof, 1);
  const rTop = (ax + az) / 2;
  const rBot = (bx + bz) / 2;
  for (let k = 0; k < capRings; k++) {
    const phi = (Math.PI / 2) * (1 - k / capRings);
    rows.push([rTop * Math.sin(phi), ax * Math.cos(phi), az * Math.cos(phi), acz]);
  }
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    const [rx, rz, cz] = profileAt(prof, t);
    rows.push([-t * len, rx, rz, cz]);
  }
  for (let k = 1; k <= capRings; k++) {
    const phi = (Math.PI / 2) * (k / capRings);
    rows.push([-len - rBot * Math.sin(phi), bx * Math.cos(phi), bz * Math.cos(phi), bcz]);
  }
  // v par longueur d'arc approximative
  const acc = [0];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    acc.push(acc[i - 1] + Math.hypot(a[0] - b[0], (a[1] + a[2]) / 2 - (b[1] + b[2]) / 2));
  }
  const total = acc[acc.length - 1];
  const pos = [];
  const uv = [];
  const idx = [];
  rows.forEach(([y, rx, rz, cz], i) => {
    for (let j = 0; j <= radial; j++) {
      const A = (j / radial) * Math.PI * 2;
      pos.push(-rx * Math.sin(A), y, cz - rz * Math.cos(A));
      uv.push(j / radial, 1 - acc[i] / total);
    }
  });
  const R = radial + 1;
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * R + j;
      const b = a + R;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return fixSeams(g);
}

// Sphère déformée par une fonction (x, y, z unitaires) -> [x, y, z] ; uv de SphereGeometry (u = 0.25 devant).
export function blobGeo(wSeg, hSeg, fn) {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const r = fn(P.getX(i), P.getY(i), P.getZ(i));
    P.setXYZ(i, r[0], r[1], r[2]);
  }
  g.computeVertexNormals();
  return fixSeams(g);
}

// --- Cinématique ---
const _d = new THREE.Vector3();
const _b = new THREE.Vector3();
// IK à deux segments : renvoie le point milieu (genou, coude) ; end reçoit l'extrémité atteinte (cible bornée).
export function ik2(A, T, l1, l2, pole, outMid, outEnd) {
  _d.subVectors(T, A);
  const raw = _d.length() || 1e-6;
  const dist = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, raw));
  _d.divideScalar(raw);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _b.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  outMid.copy(A).addScaledVector(_d, a).addScaledVector(_b, h);
  if (outEnd) outEnd.copy(A).addScaledVector(_d, dist);
  return outMid;
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
// Oriente un os : son axe +Y local suit yDir, son +Z local se rapproche de zHint.
export function orient(bone, pos, yDir, zHint) {
  _y.copy(yDir).normalize();
  _z.copy(zHint).addScaledVector(_y, -zHint.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  bone.quaternion.setFromRotationMatrix(_m);
  bone.position.copy(pos);
}

// Couleurs utilitaires
export function shade(hex, f) {
  const c = new THREE.Color(hex);
  if (f >= 0) c.lerp(new THREE.Color('#ffffff'), f);
  else c.multiplyScalar(1 + f);
  return '#' + c.getHexString();
}
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
const luminance = (hex) => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};
export const contrast = (hex) => (luminance(hex) > 0.35 ? '#15161b' : '#ffffff');
export const SKINS = ['#f2c9a6', '#e2ad86', '#c98a62', '#9a6646', '#f0bf98'];

// ---------------------------------------------------------------------------------------------
// Corps humain « skinné » : un maillage, un matériau, des os placés à chaque image (IK).
// Pose de liaison : debout, bras le long du corps, face à +Z, bassin à l'origine.
// ---------------------------------------------------------------------------------------------
export const B = { pelvis: 0, chest: 1, head: 2, upperL: 3, foreL: 4, handL: 5, upperR: 6, foreR: 7, handR: 8, thighL: 9, shinL: 10, footL: 11, thighR: 12, shinR: 13, footR: 14, oarL: 15, oarR: 16, seat: 17 };
export const BODY = {
  chestY: 0.2,
  headY: 0.575,
  shoulder: [0.172, 0.44],
  upper: 0.3,
  fore: 0.27,
  hip: [0.085, -0.045],
  thigh: 0.44,
  shin: 0.44,
};
export function bindPositions(extra = []) {
  const { chestY, headY, shoulder, upper, fore, hip, thigh, shin } = BODY;
  const list = [];
  list[B.pelvis] = [0, 0, 0];
  list[B.chest] = [0, chestY, 0];
  list[B.head] = [0, headY, 0];
  for (const [s, u, f, h] of [[1, B.upperL, B.foreL, B.handL], [-1, B.upperR, B.foreR, B.handR]]) {
    list[u] = [s * shoulder[0], shoulder[1], 0];
    list[f] = [s * shoulder[0], shoulder[1] - upper, 0];
    list[h] = [s * shoulder[0], shoulder[1] - upper - fore, 0];
  }
  for (const [s, t, k, f] of [[1, B.thighL, B.shinL, B.footL], [-1, B.thighR, B.shinR, B.footR]]) {
    list[t] = [s * hip[0], hip[1], 0];
    list[k] = [s * hip[0], hip[1] - thigh, 0];
    list[f] = [s * hip[0], hip[1] - thigh - shin, 0];
  }
  extra.forEach(([i, p]) => (list[i] = p));
  return list.map((p) => new THREE.Vector3(...p));
}

// Régions de l'atlas (x, y, w, h en fraction, origine en haut à gauche du canvas)
export const ATLAS = {
  torso: [0, 0, 0.5, 0.5],
  head: [0.5, 0, 0.25, 0.25],
  helmet: [0.75, 0, 0.25, 0.25],
  upper: [0.5, 0.25, 0.125, 0.25],
  fore: [0.625, 0.25, 0.125, 0.25],
  hand: [0.75, 0.25, 0.125, 0.125],
  glass: [0.875, 0.25, 0.125, 0.125],
  shoe: [0.75, 0.375, 0.25, 0.125],
  thigh: [0, 0.5, 0.25, 0.5],
  shin: [0.25, 0.5, 0.25, 0.5],
  dark: [0.5, 0.5, 0.125, 0.125],
  metal: [0.625, 0.5, 0.125, 0.125],
  accent: [0.75, 0.5, 0.125, 0.125],
  oar: [0.5, 0.625, 0.5, 0.125],
  blade: [0.5, 0.75, 0.25, 0.25],
  seat: [0.75, 0.75, 0.125, 0.125],
};

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Géométrie du corps (partagée par toutes les instances d'un même type et d'une même qualité).
const bodyCache = new Map();
// extra(parts, quality) : pièces supplémentaires liées à d'autres os (avirons, siège du rameur…).
export function bodyGeometry(kind, quality, extra = null) {
  const key = kind + quality;
  if (bodyCache.has(key)) return bodyCache.get(key);
  const hi = quality === 'high';
  const lo = quality === 'low';
  const rad = hi ? 14 : lo ? 8 : 10;
  const rings = hi ? 10 : lo ? 4 : 6;
  const cap = hi ? 5 : lo ? 2 : 3;
  const parts = new Parts();
  const { chestY, headY, shoulder, upper, fore, hip, thigh, shin } = BODY;

  // Buste (maillot + cuissard) : poids mélangés bassin / poitrine le long de la colonne.
  const torsoTop = 0.535;
  const torsoLen = 0.66;
  const torso = limbGeo(
    torsoLen,
    [
      [0, 0.055, 0.05, 0],
      [0.06, 0.13, 0.082, -0.006],
      [0.12, 0.178, 0.1, 0],
      [0.2, 0.182, 0.114, 0.012],
      [0.32, 0.168, 0.115, 0.014],
      [0.46, 0.15, 0.102, 0.004],
      [0.6, 0.146, 0.098, -0.004],
      [0.75, 0.152, 0.098, -0.01],
      [0.87, 0.142, 0.1, -0.016],
      [1, 0.07, 0.058, -0.01],
    ],
    hi ? 22 : lo ? 12 : 16,
    hi ? 16 : lo ? 8 : 12,
    cap,
  ).translate(0, torsoTop, 0);
  parts.add(torso, { rect: ATLAS.torso, pbr: PBR.fabric, skin: (x, y) => [B.pelvis, B.chest, smooth(0.06, 0.3, y)] });

  // Cou : de la poitrine vers la tête
  const neck = limbGeo(0.11, [[0, 0.052, 0.056, 0.006], [1, 0.06, 0.062, -0.004]], rad, 3, 2).translate(0, headY + 0.035, 0);
  parts.add(neck, { rect: ATLAS.head, uvFn: () => [ATLAS.head[0] + 0.02, 1 - ATLAS.head[1] - 0.2], pbr: PBR.matte, skin: (x, y) => [B.chest, B.head, smooth(0.5, headY + 0.01, y)] });

  // Tête : crâne, mâchoire, nez, oreilles
  const hc = [0, headY + 0.1, 0.012];
  const head = blobGeo(hi ? 24 : lo ? 12 : 16, hi ? 16 : lo ? 8 : 10, (x, y, z) => {
    let sx = 0.077;
    let sy = 0.104;
    let sz = 0.096;
    if (y < 0) {
      sx *= 1 - 0.28 * -y; // mâchoire plus étroite
      sz *= 1 - 0.12 * -y;
    }
    let px = x * sx;
    let py = y * sy;
    let pz = z * sz;
    // nez et menton
    pz += 0.022 * Math.exp(-((x / 0.18) ** 2) - ((y + 0.15) / 0.2) ** 2) * Math.max(0, z);
    pz += 0.01 * Math.exp(-((x / 0.35) ** 2) - ((y + 0.85) / 0.2) ** 2) * Math.max(0, z);
    // arcades
    pz += 0.006 * Math.exp(-(((y - 0.18) / 0.12) ** 2)) * Math.max(0, z);
    return [px + hc[0], py + hc[1], pz + hc[2]];
  });
  parts.add(head, { rect: ATLAS.head, pbr: PBR.matte, bone: B.head });
  for (const s of [-1, 1]) {
    const ear = new THREE.SphereGeometry(1, 8, 6).scale(0.012, 0.03, 0.02).translate(s * 0.077, hc[1] - 0.005, hc[2] - 0.01);
    parts.add(ear, { rect: ATLAS.head, uvFn: () => [ATLAS.head[0] + 0.02, 1 - ATLAS.head[1] - 0.2], bone: B.head });
  }

  if (kind === 'cyclist') {
    // Casque profilé : coque allongée, nervures entre les aérations, queue vers l'arrière
    const helmet = blobGeo(hi ? 36 : lo ? 14 : 22, hi ? 14 : lo ? 6 : 9, (x, y, z) => {
      const yy = Math.max(-0.05, y);
      const ang = Math.atan2(x, z);
      const rib = hi || !lo ? 0.006 * Math.max(0, Math.cos(ang * 7)) * smooth(0.2, 0.6, yy) : 0;
      const tail = Math.max(0, -z) * 0.035 * (1 - yy);
      return [x * (0.103 + rib), hc[1] + 0.018 + yy * (0.112 + rib) - tail * 0.6, hc[2] - 0.012 + z * (0.132 + rib) - tail * 0.5];
    });
    parts.add(helmet, { rect: ATLAS.helmet, pbr: PBR.satin, bone: B.head });
    // Lunettes enveloppantes : verre courbe + monture
    const lens = new THREE.CylinderGeometry(0.094, 0.09, 0.042, hi ? 20 : 10, 1, true, -1.15, 2.3);
    lens.translate(0, hc[1] + 0.012, hc[2] + 0.005);
    parts.add(lens, { rect: ATLAS.glass, pbr: PBR.glass, bone: B.head });
    // Sangles
    for (const s of [-1, 1]) {
      const strap = sweep(new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(s * 0.09, hc[1] - 0.005, hc[2] - 0.02),
        new THREE.Vector3(s * 0.082, hc[1] - 0.08, hc[2] + 0.0),
        new THREE.Vector3(s * 0.02, hc[1] - 0.11, hc[2] + 0.045),
      ), { segs: 6, radial: 4, radius: () => [0.004, 0.0015] });
      parts.add(strap, { rect: ATLAS.dark, bone: B.head, pbr: PBR.fabric });
    }
  } else {
    // Casquette de rameur avec visière
    const capG = blobGeo(hi ? 24 : 14, hi ? 10 : 6, (x, y, z) => {
      const yy = Math.max(0.05, y);
      return [x * 0.085, hc[1] + 0.012 + yy * 0.1, hc[2] - 0.006 + z * 0.1];
    });
    parts.add(capG, { rect: ATLAS.accent, pbr: PBR.fabric, bone: B.head });
    const visor = new THREE.CylinderGeometry(0.11, 0.11, 0.006, hi ? 16 : 8, 1, false, -0.9, 1.8).scale(0.85, 1, 1).rotateX(0.14).translate(0, hc[1] + 0.03, hc[2] - 0.0);
    parts.add(visor, { rect: ATLAS.accent, pbr: PBR.fabric, bone: B.head });
    const lens = new THREE.CylinderGeometry(0.091, 0.089, 0.03, hi ? 16 : 8, 1, true, -1.0, 2.0).translate(0, hc[1] + 0.008, hc[2] + 0.004);
    parts.add(lens, { rect: ATLAS.glass, pbr: PBR.glass, bone: B.head });
  }

  // Bras
  for (const [s, bu, bf, bh] of [[1, B.upperL, B.foreL, B.handL], [-1, B.upperR, B.foreR, B.handR]]) {
    const sx = s * shoulder[0];
    const up = limbGeo(upper, [[0, 0.054, 0.056, 0], [0.3, 0.046, 0.05, 0.002], [0.75, 0.04, 0.042, 0], [1, 0.035, 0.035, 0]], rad, rings, cap).translate(sx, shoulder[1], 0);
    parts.add(up, { rect: ATLAS.upper, pbr: PBR.fabric, bone: bu });
    const fo = limbGeo(fore, [[0, 0.035, 0.035, 0], [0.25, 0.04, 0.036, 0], [0.7, 0.032, 0.028, 0], [1, 0.026, 0.021, 0]], rad, rings, cap).translate(sx, shoulder[1] - upper, 0);
    parts.add(fo, { rect: ATLAS.fore, pbr: PBR.matte, bone: bf });
    // Main gantée (moufle légèrement refermée) : le pouce vers +Z
    const wy = shoulder[1] - upper - fore;
    const hand = blobGeo(hi ? 14 : 8, hi ? 10 : 6, (x, y, z) => {
      const t = (1 - y) / 2; // 0 au poignet, 1 au bout des doigts
      const w = 0.042 * (1 - 0.15 * t);
      const th = 0.02 * (1 - 0.25 * t);
      return [sx + x * th, wy - 0.012 - t * 0.095, z * w];
    });
    parts.add(hand, { rect: ATLAS.hand, uvFn: (x, y, z, u, v) => [ATLAS.hand[0] + (0.1 + 0.8 * u) * ATLAS.hand[2], 1 - (ATLAS.hand[1] + (1 - v) * ATLAS.hand[3])], pbr: PBR.fabric, bone: bh });
    const thumb = limbGeo(0.05, [[0, 0.011, 0.011, 0], [1, 0.009, 0.009, 0]], 6, 2, 2).rotateX(0.5).translate(sx, wy - 0.025, 0.03);
    parts.add(thumb, { rect: ATLAS.hand, uvFn: () => [ATLAS.hand[0] + 0.02, 1 - ATLAS.hand[1] - 0.11], pbr: PBR.matte, bone: bh });
  }

  // Jambes
  for (const [s, bt, bk, bf] of [[1, B.thighL, B.shinL, B.footL], [-1, B.thighR, B.shinR, B.footR]]) {
    const hx = s * hip[0];
    const th = limbGeo(thigh, [[0, 0.078, 0.082, 0], [0.25, 0.077, 0.082, 0.008], [0.6, 0.066, 0.07, 0.004], [0.9, 0.054, 0.055, 0], [1, 0.051, 0.052, 0]], rad, rings + 2, cap).translate(hx, hip[1], 0);
    parts.add(th, { rect: ATLAS.thigh, pbr: PBR.fabric, bone: bt });
    const sh = limbGeo(shin, [[0, 0.051, 0.052, 0], [0.25, 0.051, 0.058, -0.012], [0.6, 0.041, 0.044, -0.006], [0.9, 0.032, 0.034, 0], [1, 0.031, 0.033, 0]], rad, rings + 2, cap).translate(hx, hip[1] - thigh, 0);
    parts.add(sh, { rect: ATLAS.shin, pbr: PBR.fabric, bone: bk });
    // Chaussure : semelle plate, bout effilé, talon
    const ay = hip[1] - thigh - shin;
    const shoe = blobGeo(hi ? 20 : lo ? 10 : 14, hi ? 12 : lo ? 6 : 8, (x, y, z) => {
      const zz = 0.065 + z * 0.135;
      const toe = smooth(0.0, 0.2, zz);
      const w = 0.046 * (1 - 0.4 * toe * toe) * (zz < -0.03 ? 0.88 : 1);
      const yy = y > 0 ? y * (0.052 - 0.03 * toe) : Math.max(-1, y * 1.4) * 0.05;
      return [hx + x * w, ay - 0.02 + yy, zz];
    });
    parts.add(shoe, { rect: ATLAS.shoe, uvFn: (x, y, z) => [ATLAS.shoe[0] + Math.min(0.99, Math.max(0.01, (z + 0.075) / 0.28)) * ATLAS.shoe[2], 1 - (ATLAS.shoe[1] + Math.min(0.99, Math.max(0.01, (ay + 0.035 - y) / 0.105)) * ATLAS.shoe[3])], pbr: PBR.satin, bone: bf });
    if (kind === 'cyclist') {
      // Pédale automatique sous la cale + axe vers la manivelle
      const pedal = new THREE.BoxGeometry(0.068, 0.014, 0.085, 1, 1, 1).translate(hx, ay - 0.083, 0.1);
      parts.add(pedal, { rect: ATLAS.dark, pbr: PBR.carbon, bone: bf });
      const axle = new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6).rotateZ(Math.PI / 2).translate(hx - s * 0.035, ay - 0.083, 0.1);
      parts.add(axle, { rect: ATLAS.metal, pbr: PBR.chrome, bone: bf });
    }
  }
  if (extra) extra(parts, quality);
  const geo = keep(parts.build({ skinned: true }));
  bodyCache.set(key, geo);
  return geo;
}

// Matériau du corps : texture d'équipe + table rugosité / métal partagée (même disposition d'atlas).
let roughAtlas = null;
function roughnessAtlas() {
  if (roughAtlas) return roughAtlas;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const fill = (rect, rough, metal) => {
    ctx.fillStyle = `rgb(0, ${Math.round(rough * 255)}, ${Math.round(metal * 255)})`;
    ctx.fillRect(rect[0] * S - 1, rect[1] * S - 1, rect[2] * S + 2, rect[3] * S + 2);
  };
  fill([0, 0, 1, 1], 0.7, 0);
  fill(ATLAS.torso, 0.62, 0);
  fill(ATLAS.head, 0.55, 0);
  fill(ATLAS.helmet, 0.28, 0.05);
  fill(ATLAS.glass, 0.08, 0.7);
  fill(ATLAS.shoe, 0.32, 0);
  fill(ATLAS.fore, 0.55, 0);
  fill(ATLAS.dark, 0.35, 0.2);
  fill(ATLAS.metal, 0.25, 1);
  fill(ATLAS.oar, 0.35, 0.1);
  fill(ATLAS.blade, 0.3, 0);
  fill(ATLAS.seat, 0.5, 0);
  roughAtlas = keep(new THREE.CanvasTexture(cv));
  return roughAtlas;
}

// Peinture de la tenue (canvas) : maillot avec panneaux, bande, sponsor et dossard ; cuissard ; peau ; casque…
export function paintKit({ kind = 'cyclist', jersey, helmet, accent, skin, number = 1, size = 512 }) {
  const S = size;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const R = (rect) => [rect[0] * S, rect[1] * S, rect[2] * S, rect[3] * S];
  const box = (rect, color) => {
    const [x, y, w, h] = R(rect);
    ctx.fillStyle = color;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  };
  const clipTo = (rect, fn) => {
    const [x, y, w, h] = R(rect);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    fn(x, y, w, h);
    ctx.restore();
  };
  const dark = shade(jersey, -0.45);
  const shorts = '#17181d';
  const skinShade = (x, y, w, h, top, bottom) => {
    const g = ctx.createLinearGradient(0, y + top * h, 0, y + bottom * h);
    g.addColorStop(0, skin);
    g.addColorStop(1, shade(skin, -0.12));
    ctx.fillStyle = g;
    ctx.fillRect(x, y + top * h, w, (bottom - top) * h);
  };

  // Fond neutre
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);

  // --- Buste : u autour (0.5 = devant), v de haut (cou) en bas (entrejambe)
  clipTo(ATLAS.torso, (x, y, w, h) => {
    const unisuit = kind === 'rower';
    const shortsTop = unisuit ? 1.1 : 0.75;
    // Maillot : dégradé vertical léger
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, shade(jersey, 0.08));
    g.addColorStop(0.5, jersey);
    g.addColorStop(1, shade(jersey, -0.15));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    // Panneaux latéraux sombres (sous les bras)
    ctx.fillStyle = dark;
    for (const c of [0.25, 0.75]) {
      ctx.beginPath();
      ctx.moveTo(x + (c - 0.05) * w, y + 0.12 * h);
      ctx.lineTo(x + (c + 0.05) * w, y + 0.12 * h);
      ctx.lineTo(x + (c + 0.07) * w, y + shortsTop * h);
      ctx.lineTo(x + (c - 0.07) * w, y + shortsTop * h);
      ctx.fill();
    }
    // Bande de poitrine (couleur du casque) avec liserés blancs, en diagonale légère
    ctx.save();
    ctx.translate(x, y);
    const band = (y0, hh, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, (y0 + 0.03) * h);
      ctx.lineTo(w * 0.5, (y0 - 0.02) * h);
      ctx.lineTo(w, (y0 + 0.03) * h);
      ctx.lineTo(w, (y0 + 0.03 + hh) * h);
      ctx.lineTo(w * 0.5, (y0 - 0.02 + hh) * h);
      ctx.lineTo(0, (y0 + 0.03 + hh) * h);
      ctx.fill();
    };
    band(0.25, 0.1, '#ffffff');
    band(0.265, 0.07, helmet === jersey ? accent : helmet);
    ctx.restore();
    // Col et épaules
    ctx.fillStyle = dark;
    ctx.fillRect(x, y, w, 0.035 * h);
    // Fermeture éclair devant
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(x + 0.497 * w, y, 0.006 * w, shortsTop * h * 0.9);
    // Sponsor sur la poitrine (devant) et sous la bande (dos)
    ctx.fillStyle = contrast(jersey);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(h * 0.07)}px system-ui, sans-serif`;
    ctx.fillText('MCW', x + 0.5 * w, y + 0.45 * h);
    ctx.font = `800 ${Math.round(h * 0.045)}px system-ui, sans-serif`;
    ctx.fillText('MY CYCLE', x + 0.0 * w, y + 0.42 * h);
    ctx.fillText('MY CYCLE', x + 1.0 * w, y + 0.42 * h);
    if (!unisuit) {
      // Dossard dans le dos (u = 0 = 1)
      for (const cx of [0, w]) {
        ctx.fillStyle = '#f7f7f2';
        ctx.fillRect(x + cx - 0.085 * w, y + 0.5 * h, 0.17 * w, 0.13 * h);
        ctx.fillStyle = '#111';
        ctx.font = `900 ${Math.round(h * 0.1)}px system-ui, sans-serif`;
        ctx.fillText(String(number), x + cx, y + 0.57 * h);
      }
      // Poches arrière
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = Math.max(1, S / 256);
      ctx.beginPath();
      ctx.moveTo(x, y + 0.645 * h);
      ctx.lineTo(x + 0.2 * w, y + 0.645 * h);
      ctx.moveTo(x + 0.8 * w, y + 0.645 * h);
      ctx.lineTo(x + w, y + 0.645 * h);
      ctx.stroke();
      // Cuissard
      ctx.fillStyle = shorts;
      ctx.fillRect(x, y + shortsTop * h, w, h);
      ctx.fillStyle = accent;
      for (const c of [0.25, 0.75]) ctx.fillRect(x + (c - 0.012) * w, y + (shortsTop + 0.02) * h, 0.024 * w, h);
      // Bas du maillot
      ctx.fillStyle = dark;
      ctx.fillRect(x, y + (shortsTop - 0.02) * h, w, 0.025 * h);
    } else {
      // Combinaison : bande latérale continue
      ctx.fillStyle = helmet;
      for (const c of [0.25, 0.75]) ctx.fillRect(x + (c - 0.015) * w, y + 0.12 * h, 0.03 * w, h);
    }
  });

  // --- Tête : peau, sourcils, bouche (le visage est vers u = 0.25 sur SphereGeometry)
  clipTo(ATLAS.head, (x, y, w, h) => {
    skinShade(x, y, w, h, 0, 1);
    const fx = x + 0.25 * w;
    ctx.fillStyle = shade(skin, -0.3);
    ctx.fillRect(fx - 0.06 * w, y + 0.36 * h, 0.045 * w, 0.02 * h);
    ctx.fillRect(fx + 0.015 * w, y + 0.36 * h, 0.045 * w, 0.02 * h);
    ctx.fillStyle = shade(skin, -0.38);
    ctx.fillRect(fx - 0.03 * w, y + 0.66 * h, 0.06 * w, 0.014 * h);
    ctx.fillStyle = 'rgba(200,80,70,0.12)';
    ctx.beginPath();
    ctx.arc(fx - 0.07 * w, y + 0.56 * h, 0.04 * w, 0, Math.PI * 2);
    ctx.arc(fx + 0.07 * w, y + 0.56 * h, 0.04 * w, 0, Math.PI * 2);
    ctx.fill();
    // Cheveux courts derrière (sous le casque)
    ctx.fillStyle = '#3a2a1e';
    ctx.fillRect(x + 0.6 * w, y + 0.15 * h, 0.3 * w, 0.35 * h);
    ctx.fillRect(x, y, w, 0.2 * h);
  });

  // --- Casque : couleur, aérations sombres, liseré maillot
  clipTo(ATLAS.helmet, (x, y, w, h) => {
    ctx.fillStyle = helmet;
    ctx.fillRect(x, y, w, h);
    const ventCol = '#1a1b20';
    // Aérations : fentes longitudinales (u = angle autour de Y, v du sommet vers le bord)
    ctx.fillStyle = ventCol;
    for (let k = 0; k < 14; k++) {
      const u = (k + 0.5) / 14;
      ctx.beginPath();
      const ww = 0.022 * w;
      ctx.ellipse(x + u * w, y + 0.32 * h, ww, 0.12 * h, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let k = 0; k < 7; k++) {
      ctx.beginPath();
      ctx.ellipse(x + ((k + 0.1) / 7) * w, y + 0.13 * h, 0.018 * w, 0.06 * h, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = jersey;
    ctx.fillRect(x, y + 0.5 * h, w, 0.06 * h);
    ctx.fillStyle = '#16171b';
    ctx.fillRect(x, y + 0.62 * h, w, h);
  });

  // --- Verres : dégradé irisé
  clipTo(ATLAS.glass, (x, y, w, h) => {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#1b1d26');
    g.addColorStop(0.45, shade(helmet === '#ffffff' ? '#2b6cff' : helmet, -0.35));
    g.addColorStop(1, '#ff7a2a');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  });

  // --- Bras (haut) : manche courte puis peau ; bras (bas) : peau
  clipTo(ATLAS.upper, (x, y, w, h) => {
    const sleeve = kind === 'rower' ? 0.14 : 0.62;
    skinShade(x, y, w, h, 0, 1);
    ctx.fillStyle = jersey;
    ctx.fillRect(x, y, w, sleeve * h);
    if (kind !== 'rower') {
      ctx.fillStyle = dark;
      ctx.fillRect(x, y + (sleeve - 0.1) * h, w, 0.1 * h);
      ctx.fillStyle = helmet === jersey ? accent : helmet;
      ctx.fillRect(x, y + (sleeve - 0.08) * h, w, 0.04 * h);
    }
  });
  clipTo(ATLAS.fore, (x, y, w, h) => skinShade(x, y, w, h, 0, 1));

  // --- Gant : dos de la main sombre, doigts nus
  clipTo(ATLAS.hand, (x, y, w, h) => {
    ctx.fillStyle = skin;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#1c1d22';
    ctx.fillRect(x, y, w, 0.62 * h);
    ctx.fillStyle = accent;
    ctx.fillRect(x, y + 0.05 * h, w, 0.08 * h);
  });

  // --- Cuisse : cuissard + bande élastique, puis genou nu
  clipTo(ATLAS.thigh, (x, y, w, h) => {
    skinShade(x, y, w, h, 0, 1);
    const end = kind === 'rower' ? 0.5 : 0.74;
    ctx.fillStyle = kind === 'rower' ? jersey : shorts;
    ctx.fillRect(x, y, w, end * h);
    ctx.fillStyle = kind === 'rower' ? helmet : accent;
    for (const c of [0.25, 0.75]) ctx.fillRect(x + (c - 0.018) * w, y, 0.036 * w, end * h);
    ctx.fillStyle = kind === 'rower' ? dark : '#2a2b31';
    ctx.fillRect(x, y + (end - 0.05) * h, w, 0.05 * h);
  });

  // --- Tibia : peau puis chaussette
  clipTo(ATLAS.shin, (x, y, w, h) => {
    skinShade(x, y, w, h, 0, 1);
    const sockTop = kind === 'rower' ? 0.9 : 0.72;
    ctx.fillStyle = '#f4f4f2';
    ctx.fillRect(x, y + sockTop * h, w, h);
    ctx.fillStyle = jersey;
    ctx.fillRect(x, y + (sockTop + 0.04) * h, w, 0.035 * h);
  });

  // --- Chaussure : vue de côté (talon à gauche, bout à droite), semelle carbone en bas
  clipTo(ATLAS.shoe, (x, y, w, h) => {
    const upperCol = luminance(jersey) > 0.5 ? '#202127' : '#f5f5f3';
    ctx.fillStyle = upperCol;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = jersey;
    ctx.beginPath();
    ctx.moveTo(x + 0.25 * w, y + 0.2 * h);
    ctx.lineTo(x + 0.45 * w, y + 0.2 * h);
    ctx.lineTo(x + 0.62 * w, y + 0.85 * h);
    ctx.lineTo(x + 0.45 * w, y + 0.85 * h);
    ctx.fill();
    ctx.fillStyle = '#1c1c20';
    ctx.beginPath();
    ctx.arc(x + 0.42 * w, y + 0.22 * h, 0.07 * h * 2, 0, Math.PI * 2); // molette de serrage
    ctx.fill();
    ctx.fillStyle = '#121216';
    ctx.fillRect(x, y + 0.84 * h, w, h);
  });

  // Couleurs unies
  box(ATLAS.dark, '#141519');
  box(ATLAS.metal, '#c9ccd2');
  box(ATLAS.accent, jersey);
  box(ATLAS.seat, '#24262c');
  // Aviron : manche (poignée bois/gris, tige carbone) et pelle aux couleurs
  clipTo(ATLAS.oar, (x, y, w, h) => {
    ctx.fillStyle = '#1d1f25';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#b48b5a';
    ctx.fillRect(x, y, 0.1 * w, h);
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(x + 0.28 * w, y, 0.05 * w, h);
  });
  clipTo(ATLAS.blade, (x, y, w, h) => {
    ctx.fillStyle = jersey;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 0.55 * w, y, 0.14 * w, h);
    ctx.fillStyle = helmet;
    ctx.fillRect(x + 0.69 * w, y, 0.1 * w, h);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const kitCache = new Map();
export function bodyMaterial(opts, quality) {
  const key = JSON.stringify(opts) + quality;
  if (kitCache.has(key)) return kitCache.get(key);
  const map = keep(paintKit({ ...opts, size: quality === 'low' ? 256 : 512 }));
  const rough = roughnessAtlas();
  const mat = keep(new THREE.MeshStandardMaterial({ map, roughnessMap: rough, metalnessMap: rough, roughness: 1, metalness: 1 }));
  kitCache.set(key, mat);
  return mat;
}

// Crée le maillage « skinné » et ses os (aplatis : tous enfants du maillage, placés directement en espace maillage).
// Le matériau est une copie propre à l'instance (textures partagées) : sa libération libère aussi la texture des os.
export function makeBody(geometry, material, binds) {
  const own = material.clone();
  const mesh = new THREE.SkinnedMesh(geometry, own);
  const bones = binds.map((p) => {
    const b = new THREE.Bone();
    b.position.copy(p);
    mesh.add(b);
    return b;
  });
  const inverses = binds.map((p) => new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  const skeleton = new THREE.Skeleton(bones, inverses);
  mesh.bind(skeleton, new THREE.Matrix4());
  own.addEventListener('dispose', () => skeleton.dispose());
  // Sphère englobante fixe : évite le recalcul (coûteux) sur les sommets déformés.
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);
  mesh.frustumCulled = true;
  mesh.castShadow = true;
  return { mesh, bones, skeleton };
}
