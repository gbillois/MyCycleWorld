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
  // bone (indice) ou skin (fonction (x, y, z) -> [i0, i1, w1]), uv1y (fonction (u, v) : code libre dans uv1.y,
  // la table PBR n'ayant qu'une ligne ; sert par exemple à repérer et animer la chaîne).
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
        uv1[k * 2 + 1] = p.uv1y ? p.uv1y(u, v) : 0.5;
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
// Os supplémentaires : queue de cheval (hair), lunettes (glass, sur le nez ou relevées sur le casque)
// et bidon (bottle, dans son porte-bidon ou à la main). Un os mis à l'échelle 0 cache sa pièce.
// ---------------------------------------------------------------------------------------------
export const B = {
  pelvis: 0, chest: 1, head: 2, upperL: 3, foreL: 4, handL: 5, upperR: 6, foreR: 7, handR: 8, thighL: 9, shinL: 10, footL: 11,
  thighR: 12, shinR: 13, footR: 14, oarL: 15, oarR: 16, seat: 17, hair: 18, glass: 19, bottle: 20,
};
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
// Centre de la tête et points de pivot (pose de liaison) : lunettes relevées, queue de cheval.
const HC = [0, BODY.headY + 0.1, 0.012];
const GLASS_PIVOT = new THREE.Vector3(0, HC[1] - 0.005 - BODY.headY, HC[2] - 0.05);
const HAIR_PIVOT = new THREE.Vector3(0, HC[1] - 0.035 - BODY.headY, HC[2] - 0.085);
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
  list[B.oarL] = list[B.oarR] = list[B.seat] = list[B.bottle] = [0, 0, 0];
  list[B.hair] = list[B.glass] = [0, headY, 0];
  extra.forEach(([i, p]) => (list[i] = p));
  return list.map((p) => new THREE.Vector3(...p));
}

// Accessoires de tête : lunettes (sur le nez, relevées sur le casque ou absentes) et queue de cheval qui se balance.
// À appeler après avoir placé l'os de la tête. glasses : 0 = sur le nez, 1 = relevées, -1 = aucune.
const _gq = new THREE.Quaternion();
const _gv = new THREE.Vector3();
const _gw = new THREE.Vector3();
const _ge = new THREE.Euler();
function pivotBone(bone, head, pivot, euler) {
  _gq.setFromEuler(euler);
  _gv.copy(pivot).applyQuaternion(_gq);
  _gw.copy(pivot).sub(_gv).applyQuaternion(head.quaternion);
  bone.position.copy(head.position).add(_gw);
  bone.quaternion.copy(head.quaternion).multiply(_gq);
}
export function poseHeadGear(bones, glasses = 0, pony = false, swingX = 0, swingZ = 0) {
  const head = bones[B.head];
  const g = bones[B.glass];
  if (glasses < 0) g.scale.setScalar(0);
  else {
    g.scale.setScalar(1);
    pivotBone(g, head, GLASS_PIVOT, _ge.set(-0.98 * glasses, 0, 0));
  }
  const h = bones[B.hair];
  if (!pony) h.scale.setScalar(0);
  else {
    h.scale.setScalar(1);
    pivotBone(h, head, HAIR_PIVOT, _ge.set(swingX, 0, swingZ));
  }
}

// Queue de cheval : pendule amorti (angles avant / arrière et de côté) excité par les secousses du corps.
export class HairSwing {
  constructor() {
    this.x = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
  }
  step(dt, pushX, pushZ) {
    if (dt <= 0) return;
    const k = 60;
    const c = 5;
    this.vx += (-k * (this.x - pushX) - c * this.vx) * dt;
    this.vz += (-k * (this.z - pushZ) - c * this.vz) * dt;
    this.x = Math.max(-0.9, Math.min(0.9, this.x + this.vx * dt));
    this.z = Math.max(-0.7, Math.min(0.7, this.z + this.vz * dt));
  }
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
  eye: [0.875, 0.5, 0.0625, 0.0625],
  hair: [0.9375, 0.5, 0.0625, 0.0625],
  skin: [0.875, 0.5625, 0.0625, 0.0625],
  lip: [0.9375, 0.5625, 0.0625, 0.0625],
  oar: [0.5, 0.625, 0.5, 0.125],
  blade: [0.5, 0.75, 0.25, 0.25],
  seat: [0.75, 0.75, 0.125, 0.125],
  bottle: [0.875, 0.75, 0.125, 0.125],
  finger: [0.75, 0.875, 0.125, 0.125],
  frame: [0.875, 0.875, 0.125, 0.125],
};

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// Texel fixe d'une région, et projection d'une région entière (u, v de la géométrie)
const texel = (rect, fx = 0.5, fy = 0.5) => () => [rect[0] + fx * rect[2], 1 - (rect[1] + fy * rect[3])];
const fitUV = (rect) => (x, y, z, u, v) => [rect[0] + (0.02 + 0.96 * u) * rect[2], 1 - (rect[1] + (1 - (0.02 + 0.96 * v)) * rect[3])];

// Tête : u selon l'angle autour de Y, resserré à l'arrière pour donner plus de texels au visage.
const FACE_FRONT = 1.05;
export function headU(theta) {
  const a = Math.min(Math.PI, Math.abs(theta));
  const g = a < FACE_FRONT ? (0.36 * a) / FACE_FRONT : 0.36 + (0.14 * (a - FACE_FRONT)) / (Math.PI - FACE_FRONT);
  return 0.5 + Math.sign(theta) * g;
}
const headV = (uy) => 1 - Math.acos(Math.max(-1, Math.min(1, uy))) / Math.PI;

// Forme de la tête (sphère unité, +Z devant) : mâchoire, arcades, orbites, pommettes, lèvres, menton.
function headShape(x, y, z) {
  let sx = 0.077;
  const sy = 0.104;
  let sz = 0.096;
  if (y < 0) {
    sx *= 1 - 0.3 * -y * (z > 0 ? 1 : 0.55);
    sz *= 1 - 0.12 * -y;
  }
  if (z < 0) sz *= 1 + 0.07 * -z * Math.max(0, y + 0.3);
  let px = x * sx;
  const py = y * sy;
  let pz = z * sz;
  const front = Math.max(0, z);
  const g = (cx, cy, wx, wy) => Math.exp(-(((x - cx) / wx) ** 2) - (((y - cy) / wy) ** 2));
  pz += 0.0075 * Math.exp(-(((y - 0.25) / 0.09) ** 2)) * front * (1 - 0.7 * x * x); // arcades sourcilières
  pz -= 0.0065 * (g(0.36, 0.07, 0.16, 0.11) + g(-0.36, 0.07, 0.16, 0.11)) * front; // orbites
  px += 0.0045 * Math.sign(x) * (g(0.62, -0.1, 0.2, 0.18) + g(-0.62, -0.1, 0.2, 0.18)); // pommettes
  pz += 0.0035 * g(0, -0.5, 0.22, 0.07) * front; // lèvre supérieure
  pz += 0.003 * g(0, -0.6, 0.18, 0.05) * front; // lèvre inférieure
  pz += 0.009 * g(0, -0.84, 0.26, 0.13) * front; // menton
  return [px + HC[0], py + HC[1], pz + HC[2]];
}
function headGeo(wSeg, hSeg) {
  const geo = new THREE.SphereGeometry(1, wSeg, hSeg).rotateY(-Math.PI / 2); // couture à l'arrière
  const P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const r = headShape(P.getX(i), P.getY(i), P.getZ(i));
    P.setXYZ(i, r[0], r[1], r[2]);
  }
  geo.computeVertexNormals();
  return fixSeams(geo);
}
// Point de la surface du visage dans une direction (x, y unité, devant)
const facePoint = (x, y) => headShape(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y)));

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
  const { headY, shoulder, upper, fore, hip, thigh, shin } = BODY;
  const CR = (pts) => new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const hc = HC;

  // Buste (maillot + cuissard) : poids mélangés bassin / poitrine le long de la colonne.
  const torsoTop = 0.535;
  const torsoLen = 0.66;
  const torsoProf = [
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
  ];
  const torso = limbGeo(torsoLen, torsoProf, hi ? 22 : lo ? 12 : 16, hi ? 16 : lo ? 8 : 12, cap).translate(0, torsoTop, 0);
  const spine = (x, y) => [B.pelvis, B.chest, smooth(0.06, 0.3, y)];
  parts.add(torso, { rect: ATLAS.torso, pbr: PBR.fabric, skin: spine });

  // Gilet de sauvetage du kayakiste : coque de mousse par-dessus le buste, ouverte au cou et à la taille.
  if (kind === 'kayaker') {
    const vy0 = torsoTop - 0.43;
    const vy1 = torsoTop - 0.05;
    const vest = sweep(new THREE.LineCurve3(V3(0, vy0, 0), V3(0, vy1, 0)), {
      segs: hi ? 8 : 5,
      radial: hi ? 20 : 12,
      ref: V3(0, 0, -1),
      radius: (t) => {
        const tt = 1 - (t * (vy1 - vy0) + 0.05) / torsoLen;
        const [rx, rz] = profileAt(torsoProf, tt);
        const top = smooth(0.7, 1, t);
        return [rx + 0.03 - 0.03 * top, rz + 0.032 - 0.012 * top];
      },
    });
    // Centre légèrement avancé (mousse plus épaisse devant)
    const VP = vest.attributes.position;
    for (let i = 0; i < VP.count; i++) VP.setZ(i, VP.getZ(i) + 0.008);
    parts.add(vest, {
      pbr: PBR.fabric,
      skin: spine,
      uvFn: (x, y, z, u, v) => [ATLAS.torso[0] + (0.01 + 0.98 * v) * ATLAS.torso[2], 1 - (ATLAS.torso[1] + (0.06 + 0.66 * (1 - u)) * ATLAS.torso[3])],
    });
  }

  // Cou : de la poitrine vers la tête
  const neck = limbGeo(0.11, [[0, 0.052, 0.056, 0.006], [1, 0.06, 0.062, -0.004]], rad, 3, 2).translate(0, headY + 0.035, 0);
  parts.add(neck, { uvFn: texel(ATLAS.skin), pbr: PBR.matte, skin: (x, y) => [B.chest, B.head, smooth(0.5, headY + 0.01, y)] });

  // Tête : crâne sculpté, nez, yeux, oreilles. Le visage est peint dans une projection resserrée à l'arrière.
  const head = headGeo(hi ? 30 : lo ? 12 : 18, hi ? 22 : lo ? 8 : 12);
  const HR = ATLAS.head;
  parts.add(head, { pbr: PBR.matte, bone: B.head, uvFn: (x, y, z, u, v) => [HR[0] + headU((u - 0.5) * Math.PI * 2) * HR[2], 1 - (HR[1] + (1 - v) * HR[3])] });
  if (!lo) {
    // Nez : arête, pointe et ailes plus larges en bas
    const tipY = -0.27;
    const root = facePoint(0, 0.1);
    const tip = facePoint(0, tipY);
    const nose = blobGeo(hi ? 10 : 8, hi ? 8 : 6, (x, y, z) => {
      const t = (1 - y) / 2; // 0 à la racine, 1 à la pointe
      const w = 0.0068 + 0.0062 * t * t + 0.0035 * smooth(0.75, 1, t);
      const d = 0.003 + 0.0135 * Math.pow(t, 0.9) * (1 - 0.35 * smooth(0.85, 1, t));
      return [x * w, root[1] + (tip[1] - 0.006 - root[1]) * t, root[2] - 0.006 + (tip[2] - root[2]) * t + Math.max(-0.4, z) * d];
    });
    parts.add(nose, { pbr: PBR.matte, bone: B.head, uvFn: texel(ATLAS.skin, 0.5, 0.35) });
    // Yeux : globes peints (iris, pupille, reflet) dans les orbites
    const er = 0.0112;
    for (const s of [-1, 1]) {
      const p = facePoint(s * 0.36, 0.07);
      const c = [p[0] - s * 0.0015, p[1], p[2] - er * 0.62];
      const eye = new THREE.SphereGeometry(er, hi ? 12 : 8, hi ? 10 : 6).translate(c[0], c[1], c[2]);
      const ER = ATLAS.eye;
      parts.add(eye, {
        pbr: PBR.glass,
        bone: B.head,
        uvFn: (x, y, z) => {
          const fx = z > c[2] ? (x - c[0]) / er : Math.sign(x - c[0]) * 0.98;
          const fy = z > c[2] ? (y - c[1]) / er : 0;
          return [ER[0] + (0.5 + 0.48 * fx) * ER[2], 1 - (ER[1] + (0.5 - 0.48 * fy) * ER[3])];
        },
      });
    }
  }
  // Oreilles : pavillon aplati, ourlé, incliné vers l'arrière
  for (const s of [-1, 1]) {
    const ear = blobGeo(hi ? 10 : 6, hi ? 8 : 5, (x, y, z) => {
      const rim = Math.hypot(y, z);
      const cup = x * s > 0 ? -0.35 * (1 - rim) : 0; // creux côté extérieur
      return [x * 0.0105 * (1 + cup), y * 0.03, z * 0.02 * (1 - 0.25 * Math.max(0, -y))];
    });
    ear.rotateY(s * 0.32).rotateX(0.1).translate(s * 0.077, hc[1] - 0.008, hc[2] - 0.012);
    parts.add(ear, { uvFn: texel(ATLAS.skin, 0.5, 0.65), bone: B.head, pbr: PBR.matte });
  }
  // Queue de cheval (os B.hair, cachée chez les coureurs aux cheveux courts) et son élastique
  {
    const tail = sweep(CR([V3(0, hc[1] - 0.005, hc[2] - 0.075), V3(0, hc[1] - 0.04, hc[2] - 0.112), V3(0, hc[1] - 0.095, hc[2] - 0.13), V3(0, hc[1] - 0.15, hc[2] - 0.122), V3(0, hc[1] - 0.19, hc[2] - 0.105)]), {
      segs: hi ? 10 : 6,
      radial: hi ? 8 : 6,
      ref: V3(1, 0, 0),
      radius: (t) => {
        const r = 0.021 * (1 - 0.78 * t) * (1 + 0.25 * Math.sin(Math.min(1, t * 3) * Math.PI)) + 0.002;
        return [r * 1.25, r];
      },
      caps: true,
    });
    parts.add(tail, { bone: B.hair, pbr: PBR.satin, uvFn: (x, y, z, u, v) => [ATLAS.hair[0] + (0.1 + 0.8 * v) * ATLAS.hair[2], 1 - (ATLAS.hair[1] + (0.1 + 0.8 * u) * ATLAS.hair[3])] });
    const tie = new THREE.TorusGeometry(0.017, 0.0045, 4, hi ? 10 : 6).rotateX(1.25).translate(0, hc[1] - 0.034, hc[2] - 0.108);
    parts.add(tie, { bone: B.hair, pbr: PBR.plastic, uvFn: texel(ATLAS.accent) });
  }

  if (kind === 'cyclist') {
    // Casque profilé : coque allongée, nervures entre les aérations, queue vers l'arrière
    const helmet = blobGeo(hi ? 36 : lo ? 14 : 22, hi ? 14 : lo ? 6 : 9, (x, y, z) => {
      const yy = Math.max(-0.05, y);
      const ang = Math.atan2(x, z);
      const rib = !lo ? 0.006 * Math.max(0, Math.cos(ang * 7)) * smooth(0.2, 0.6, yy) : 0;
      const tail = Math.max(0, -z) * 0.035 * (1 - yy);
      return [x * (0.103 + rib), hc[1] + 0.018 + yy * (0.112 + rib) - tail * 0.6, hc[2] - 0.012 + z * (0.132 + rib) - tail * 0.5];
    });
    parts.add(helmet, { rect: ATLAS.helmet, pbr: PBR.satin, bone: B.head });
    // Molette de serrage à l'arrière
    parts.add(new THREE.CylinderGeometry(0.014, 0.014, 0.012, hi ? 12 : 6).rotateX(Math.PI / 2).translate(0, hc[1] - 0.025, hc[2] - 0.112), { uvFn: texel(ATLAS.dark), pbr: PBR.plastic, bone: B.head });
    // Sangles en Y autour des oreilles, jugulaire sous le menton, boucle
    const strap = (pts) => parts.add(sweep(CR(pts), { segs: hi ? 7 : 4, radial: 4, radius: () => [0.0045, 0.0013], ref: V3(1, 0, 0) }), { uvFn: texel(ATLAS.dark), bone: B.head, pbr: PBR.fabric });
    for (const s of [-1, 1]) {
      const J = V3(s * 0.069, hc[1] - 0.058, hc[2] - 0.004);
      strap([V3(s * 0.093, hc[1] + 0.014, hc[2] + 0.055), V3(s * 0.084, hc[1] - 0.02, hc[2] + 0.03), J]);
      strap([V3(s * 0.088, hc[1] + 0.008, hc[2] - 0.078), V3(s * 0.08, hc[1] - 0.03, hc[2] - 0.035), J]);
      strap([J, V3(s * 0.056, hc[1] - 0.084, hc[2] + 0.022), V3(s * 0.03, hc[1] - 0.1, hc[2] + 0.044), V3(0, hc[1] - 0.104, hc[2] + 0.05)]);
      // Arrêtoir de sangle sous l'oreille
      parts.add(new THREE.BoxGeometry(0.004, 0.012, 0.01).translate(J.x + s * 0.002, J.y, J.z), { uvFn: texel(ATLAS.dark), bone: B.head, pbr: PBR.plastic });
    }
    parts.add(new THREE.BoxGeometry(0.022, 0.008, 0.012).rotateX(0.5).translate(-0.024, hc[1] - 0.099, hc[2] + 0.046), { uvFn: texel(ATLAS.dark, 0.2, 0.2), bone: B.head, pbr: PBR.plastic });
  } else if (kind === 'kayaker') {
    // Casque d'eau vive : coque arrondie, courte visière, protège-nuque
    const shell = blobGeo(hi ? 26 : lo ? 12 : 16, hi ? 12 : lo ? 6 : 8, (x, y, z) => {
      // Bord au-dessus des sourcils devant, plus bas sur les tempes et la nuque
      const minY = z > 0 ? -0.12 + 0.34 * smooth(0.25, 0.8, z) : -0.12 - 0.12 * -z;
      const yy = Math.max(minY, y);
      return [x * 0.1, hc[1] + 0.01 + yy * 0.112, hc[2] - 0.01 + z * 0.118];
    });
    parts.add(shell, { rect: ATLAS.helmet, pbr: PBR.satin, bone: B.head });
    const visor = new THREE.CylinderGeometry(0.115, 0.115, 0.006, hi ? 16 : 8, 1, false, -0.85, 1.7).scale(0.85, 1, 1).rotateX(0.18).translate(0, hc[1] + 0.03, hc[2] - 0.004);
    parts.add(visor, { uvFn: texel(ATLAS.dark), pbr: PBR.plastic, bone: B.head });
    for (const s of [-1, 1]) {
      parts.add(sweep(CR([V3(s * 0.09, hc[1] - 0.005, hc[2] - 0.02), V3(s * 0.075, hc[1] - 0.075, hc[2] + 0.01), V3(s * 0.03, hc[1] - 0.108, hc[2] + 0.045), V3(0, hc[1] - 0.112, hc[2] + 0.052)]), { segs: 5, radial: 4, radius: () => [0.0045, 0.0013], ref: V3(1, 0, 0) }), { uvFn: texel(ATLAS.dark), bone: B.head, pbr: PBR.fabric });
    }
  } else if (kind === 'devil') {
    // Diable des montées : tête nue (cornes ajoutées par people.js)
  } else {
    // Casquette de rameur avec visière
    const capG = blobGeo(hi ? 24 : 14, hi ? 10 : 6, (x, y, z) => {
      const yy = Math.max(0.05, y);
      return [x * 0.085, hc[1] + 0.012 + yy * 0.1, hc[2] - 0.006 + z * 0.1];
    });
    parts.add(capG, { rect: ATLAS.accent, pbr: PBR.fabric, bone: B.head });
    const visor = new THREE.CylinderGeometry(0.11, 0.11, 0.006, hi ? 16 : 8, 1, false, -0.9, 1.8).scale(0.85, 1, 1).rotateX(0.14).translate(0, hc[1] + 0.03, hc[2] - 0.0);
    parts.add(visor, { rect: ATLAS.accent, pbr: PBR.fabric, bone: B.head });
  }

  // Lunettes enveloppantes (os B.glass) : écran à deux lobes, échancrure du nez, barre et branches
  {
    const nT = hi ? 18 : lo ? 8 : 12;
    const nR = lo ? 1 : 3;
    const T0 = 1.18;
    const pos = [];
    const uv = [];
    const idx = [];
    const bottomAt = (th) => {
      const a = Math.abs(th);
      return hc[1] - 0.026 + 0.019 * Math.exp(-((th / 0.16) ** 2)) + 0.012 * smooth(0.75, T0, a);
    };
    const topAt = (th) => hc[1] + 0.03 - 0.006 * smooth(0.6, T0, Math.abs(th));
    const lensPt = (th, y) => {
      const rx = 0.088 + 0.004 * Math.cos(th);
      const rz = 0.113;
      const mid = hc[1] + 0.004;
      const bulge = 0.005 * (1 - ((y - mid) / 0.03) ** 2);
      return [Math.sin(th) * (rx + bulge * 0.3), y, hc[2] - 0.004 + Math.cos(th) * (rz + bulge)];
    };
    for (let i = 0; i <= nT; i++) {
      const th = -T0 + (2 * T0 * i) / nT;
      const yb = bottomAt(th);
      const yt = topAt(th);
      for (let j = 0; j <= nR; j++) {
        const y = yb + ((yt - yb) * j) / nR;
        pos.push(...lensPt(th, y));
        uv.push(i / nT, j / nR);
      }
    }
    for (let i = 0; i < nT; i++) {
      for (let j = 0; j < nR; j++) {
        const a = i * (nR + 1) + j;
        const b = a + nR + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const lens = new THREE.BufferGeometry();
    lens.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lens.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    lens.setIndex(idx);
    lens.computeVertexNormals();
    // Normales vers l'extérieur
    const LN = lens.attributes.normal;
    const LP = lens.attributes.position;
    let flip = 0;
    for (let i = 0; i < LN.count; i++) flip += LN.getX(i) * LP.getX(i) + LN.getZ(i) * (LP.getZ(i) - hc[2]);
    if (flip < 0) {
      for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
      lens.setIndex(idx);
      lens.computeVertexNormals();
    }
    parts.add(lens, { rect: ATLAS.glass, pbr: PBR.glass, bone: B.glass });
    if (!lo) {
      const top = [];
      for (let i = 0; i <= 8; i++) {
        const th = -T0 + (2 * T0 * i) / 8;
        const p = lensPt(th, topAt(th) + 0.002);
        top.push(V3(p[0], p[1], p[2]));
      }
      parts.add(sweep(CR(top), { segs: hi ? 20 : 12, radial: 4, radius: () => [0.0035, 0.004], ref: V3(0, 0, 1) }), { uvFn: texel(ATLAS.frame), bone: B.glass, pbr: PBR.plastic });
      for (const s of [-1, 1]) {
        const e = lensPt(s * T0, hc[1] + 0.012);
        parts.add(sweep(CR([V3(e[0], e[1], e[2]), V3(s * 0.091, hc[1] + 0.013, hc[2] - 0.02), V3(s * 0.088, hc[1] + 0.008, hc[2] - 0.06), V3(s * 0.08, hc[1] - 0.012, hc[2] - 0.078)]), { segs: hi ? 6 : 4, radial: 4, radius: () => [0.0022, 0.0045], ref: V3(0, 1, 0) }), { uvFn: texel(ATLAS.frame), bone: B.glass, pbr: PBR.plastic });
      }
    }
  }

  // Bras
  for (const [s, bu, bf, bh] of [[1, B.upperL, B.foreL, B.handL], [-1, B.upperR, B.foreR, B.handR]]) {
    const sx = s * shoulder[0];
    const up = limbGeo(upper, [[0, 0.054, 0.056, 0], [0.3, 0.047, 0.051, 0.002], [0.6, 0.042, 0.046, 0.004], [0.85, 0.038, 0.039, 0], [1, 0.035, 0.035, 0]], rad, rings, cap).translate(sx, shoulder[1], 0);
    parts.add(up, { rect: ATLAS.upper, pbr: PBR.fabric, bone: bu });
    // Avant-bras : renflement du brachio-radial près du coude, poignet fin
    const fo = limbGeo(fore, [[0, 0.035, 0.035, 0], [0.18, 0.042, 0.038, 0.002], [0.4, 0.039, 0.034, 0.001], [0.75, 0.03, 0.025, 0], [1, 0.026, 0.02, 0]], rad, rings, cap).translate(sx, shoulder[1] - upper, 0);
    parts.add(fo, { rect: ATLAS.fore, pbr: PBR.matte, bone: bf });
    // Main : paume (pouce vers +Z, paume vers -s·X) puis doigts repliés en prise (cocotte, aviron, pagaie)
    const wy = shoulder[1] - upper - fore;
    const HR = ATLAS.hand;
    const hand = blobGeo(hi ? 14 : 8, hi ? 10 : 6, (x, y, z) => {
      const t = (1 - y) / 2; // 0 au poignet, 1 aux jointures
      const w = 0.04 * (1 - 0.08 * t) * (t < 0.15 ? 0.85 + t : 1);
      const th = 0.017 * (1 - 0.2 * t) + (x * s < 0 ? 0.004 * Math.sin(t * Math.PI) : 0);
      return [sx + x * th, wy - 0.008 - t * (lo ? 0.095 : 0.072), z * w];
    });
    parts.add(hand, { uvFn: (x, y, z, u, v) => [HR[0] + (0.1 + 0.8 * u) * HR[2], 1 - (HR[1] + (1 - v) * HR[3])], pbr: PBR.fabric, bone: bh });
    if (lo) {
      const thumb = limbGeo(0.05, [[0, 0.011, 0.011, 0], [1, 0.009, 0.009, 0]], 6, 2, 2).rotateX(0.5).translate(sx, wy - 0.025, 0.03);
      parts.add(thumb, { uvFn: texel(ATLAS.finger, 0.5, 0.8), pbr: PBR.matte, bone: bh });
    } else {
      const FR = ATLAS.finger;
      const fingerUV = (x, y, z, u, v) => [FR[0] + (0.1 + 0.8 * v) * FR[2], 1 - (FR[1] + (0.05 + 0.9 * u) * FR[3])];
      const ky = wy - 0.078;
      const segs = hi ? 6 : 4;
      const radial = hi ? 6 : 5;
      [[0.026, 0.044, 0.0082], [0.009, 0.05, 0.0088], [-0.009, 0.047, 0.0085], [-0.025, 0.038, 0.0075]].forEach(([fz, len, r]) => {
        const p = (fx, fy) => V3(sx - s * fx, ky - fy, fz);
        const curve = CR([p(0.002, -0.004), p(0.004, 0.012), p(0.004 + len * 0.22, 0.012 + len * 0.36), p(len * 0.56, len * 0.3), p(len * 0.72, len * 0.04)]);
        parts.add(sweep(curve, { segs, radial, radius: (t) => [r * (1 - 0.18 * t), r * (1 - 0.18 * t) * 0.9], ref: V3(0, 0, 1), caps: true }), { uvFn: fingerUV, pbr: PBR.fabric, bone: bh });
      });
      // Pouce : part du talon de la main côté +Z et se referme vers la paume
      const tp = (fx, fy, fz) => V3(sx - s * fx, wy - fy, fz);
      parts.add(sweep(CR([tp(0.004, 0.02, 0.024), tp(0.012, 0.042, 0.042), tp(0.03, 0.062, 0.04), tp(0.042, 0.072, 0.026)]), { segs, radial, radius: (t) => [0.0105 * (1 - 0.2 * t), 0.0095 * (1 - 0.2 * t)], ref: V3(0, 0, 1), caps: true }), { uvFn: fingerUV, pbr: PBR.fabric, bone: bh });
    }
  }

  // Jambes
  for (const [s, bt, bk, bf] of [[1, B.thighL, B.shinL, B.footL], [-1, B.thighR, B.shinR, B.footR]]) {
    const hx = s * hip[0];
    const th = limbGeo(thigh, [[0, 0.078, 0.082, 0], [0.25, 0.077, 0.082, 0.008], [0.6, 0.066, 0.07, 0.004], [0.85, 0.056, 0.058, 0.002], [1, 0.051, 0.052, 0]], rad, rings + 2, cap).translate(hx, hip[1], 0);
    parts.add(th, { rect: ATLAS.thigh, pbr: PBR.fabric, bone: bt });
    // Mollet : deux chefs du jumeau en haut à l'arrière, cheville fine
    const sh = limbGeo(shin, [[0, 0.051, 0.052, 0], [0.18, 0.052, 0.058, -0.01], [0.32, 0.05, 0.06, -0.015], [0.55, 0.042, 0.046, -0.008], [0.8, 0.032, 0.034, -0.001], [1, 0.031, 0.033, 0]], rad, rings + 2, cap).translate(hx, hip[1] - thigh, 0);
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
      if (!lo) {
        // Molette de serrage (type BOA) et sa bride sur le cou-de-pied
        parts.add(new THREE.CylinderGeometry(0.013, 0.014, 0.01, hi ? 12 : 8).rotateX(-0.45).translate(hx + s * 0.012, ay + 0.026, 0.035), { uvFn: texel(ATLAS.metal, 0.3, 0.3), pbr: PBR.alu, bone: bf });
        parts.add(new THREE.TorusGeometry(0.044, 0.004, 3, hi ? 14 : 8, Math.PI).scale(1.05, 0.9, 1).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).rotateX(-0.45).translate(hx, ay - 0.002, 0.06), { uvFn: texel(ATLAS.dark), pbr: PBR.plastic, bone: bf });
      }
      // Pédale automatique sous la cale + axe vers la manivelle
      const pedal = new THREE.BoxGeometry(0.068, 0.014, 0.085, 1, 1, 1).translate(hx, ay - 0.083, 0.1);
      parts.add(pedal, { rect: ATLAS.dark, pbr: PBR.carbon, bone: bf });
      const axle = new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6).rotateZ(Math.PI / 2).translate(hx - s * 0.035, ay - 0.083, 0.1);
      parts.add(axle, { rect: ATLAS.metal, pbr: PBR.chrome, bone: bf });
    }
  }
  if (kind === 'cyclist') {
    // Bidon (os B.bottle) : dans son porte-bidon, ou à la main quand le coureur boit. Axe le long de +Y.
    const prof = [[0, -0.114], [0.031, -0.114], [0.036, -0.104], [0.036, -0.039], [0.032, -0.019], [0.036, 0.001], [0.036, 0.061], [0.031, 0.078], [0.017, 0.088], [0.013, 0.104], [0.007, 0.112], [0, 0.114]];
    const bottle = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), hi ? 14 : lo ? 8 : 10);
    parts.add(bottle, { pbr: PBR.plastic, bone: B.bottle, uvFn: (x, y, z, u) => [ATLAS.bottle[0] + (0.05 + 0.9 * u) * ATLAS.bottle[2], 1 - (ATLAS.bottle[1] + (0.98 - 0.96 * (y + 0.114) / 0.228) * ATLAS.bottle[3])] });
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
  fill(ATLAS.torso, 0.6, 0);
  fill(ATLAS.head, 0.5, 0);
  fill(ATLAS.helmet, 0.26, 0.05);
  fill(ATLAS.glass, 0.06, 0.85);
  fill(ATLAS.shoe, 0.3, 0);
  fill(ATLAS.fore, 0.5, 0);
  fill(ATLAS.upper, 0.55, 0);
  fill(ATLAS.shin, 0.55, 0);
  fill(ATLAS.dark, 0.35, 0.2);
  fill(ATLAS.metal, 0.25, 1);
  fill(ATLAS.oar, 0.35, 0.1);
  fill(ATLAS.blade, 0.3, 0);
  fill(ATLAS.seat, 0.5, 0);
  fill(ATLAS.eye, 0.12, 0);
  fill(ATLAS.hair, 0.45, 0);
  fill(ATLAS.skin, 0.5, 0);
  fill(ATLAS.lip, 0.35, 0);
  fill(ATLAS.bottle, 0.35, 0);
  fill(ATLAS.finger, 0.6, 0);
  fill(ATLAS.frame, 0.2, 0.1);
  roughAtlas = keep(new THREE.CanvasTexture(cv));
  return roughAtlas;
}

// --- Relief (carte de normales) : muscles, coutures, bords de manches, articulations ---
// Hauteurs peintes en gris sur un canvas à la même disposition que l'atlas, converties en normales
// (espace tangent, repère tiré des dérivées des uv dans le shader : pas d'attribut tangente).
const normalCache = new Map();
export function reliefMap(kind, size) {
  const key = kind + size;
  if (normalCache.has(key)) return normalCache.get(key);
  const S = size;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'lighter';
  const R = (rect) => [rect[0] * S, rect[1] * S, rect[2] * S, rect[3] * S];
  // Bosse douce (u, v dans la région, v = 0 en haut), rayons en fraction de la région, intensité 0..1
  const bump = (rect, u, v, ru, rv, k = 1) => {
    const [x, y, w, h] = R(rect);
    for (const du of u < 0.25 ? [0, 1] : u > 0.75 ? [-1, 0] : [0]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.translate(x + (u + du) * w, y + v * h);
      ctx.scale(ru * w, rv * h);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      const a = Math.round(255 * k);
      g.addColorStop(0, `rgb(${a},${a},${a})`);
      g.addColorStop(0.55, `rgb(${a * 0.55 | 0},${a * 0.55 | 0},${a * 0.55 | 0})`);
      g.addColorStop(1, 'rgb(0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };
  // Arête (couture, ourlet) horizontale ou verticale dans une région
  const ridge = (rect, u0, v0, u1, v1, width, k = 0.6) => {
    const [x, y, w, h] = R(rect);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (let i = 3; i >= 1; i--) {
      const a = Math.round((255 * k) / i);
      ctx.strokeStyle = `rgb(${a},${a},${a})`;
      ctx.lineWidth = Math.max(1, width * S * i * 0.6);
      ctx.beginPath();
      ctx.moveTo(x + u0 * w, y + v0 * h);
      ctx.lineTo(x + u1 * w, y + v1 * h);
      ctx.stroke();
    }
    ctx.restore();
  };
  const A = ATLAS;
  // Mollet (u : 0.5 devant, 0/1 derrière ; v : 0 au genou) : jumeaux, tibial, tendon d'Achille, rotule
  bump(A.shin, 0.06, 0.3, 0.1, 0.2, 0.9);
  bump(A.shin, 0.94, 0.3, 0.1, 0.2, 0.9);
  bump(A.shin, 0.0, 0.42, 0.12, 0.14, 0.5);
  bump(A.shin, 0.62, 0.32, 0.07, 0.25, 0.45);
  bump(A.shin, 0.5, 0.35, 0.03, 0.3, 0.3);
  ridge(A.shin, 0.0, 0.55, 0.0, 0.72, 0.01, 0.45);
  ridge(A.shin, 1.0, 0.55, 1.0, 0.72, 0.01, 0.45);
  bump(A.shin, 0.5, 0.02, 0.1, 0.06, 0.6);
  bump(A.shin, 0.3, 0.71, 0.04, 0.03, 0.5);
  bump(A.shin, 0.7, 0.72, 0.04, 0.03, 0.5);
  // Cuisse : quadriceps (vaste externe, vaste interne en goutte au-dessus du genou), rotule
  bump(A.thigh, 0.5, 0.45, 0.09, 0.3, 0.55);
  bump(A.thigh, 0.36, 0.86, 0.07, 0.09, 0.7);
  bump(A.thigh, 0.7, 0.55, 0.09, 0.3, 0.5);
  bump(A.thigh, 0.5, 0.96, 0.07, 0.06, 0.6);
  // Bras : deltoïde, biceps, triceps ; avant-bras : brachio-radial, fléchisseurs, tendons du poignet
  bump(A.upper, 0.75, 0.12, 0.16, 0.14, 0.6);
  bump(A.upper, 0.25, 0.12, 0.16, 0.14, 0.6);
  bump(A.upper, 0.5, 0.5, 0.12, 0.2, 0.65);
  bump(A.upper, 0.0, 0.45, 0.14, 0.22, 0.55);
  bump(A.fore, 0.66, 0.2, 0.12, 0.2, 0.75);
  bump(A.fore, 0.36, 0.24, 0.12, 0.2, 0.5);
  bump(A.fore, 0.0, 0.3, 0.12, 0.22, 0.4);
  bump(A.fore, 0.46, 0.84, 0.03, 0.12, 0.25);
  bump(A.fore, 0.54, 0.84, 0.03, 0.12, 0.25);
  bump(A.fore, 0.25, 0.93, 0.05, 0.04, 0.5);
  // Main : jointures, bride velcro du gant
  for (let k = 0; k < 4; k++) bump(A.hand, 0.18 + k * 0.1, 0.86, 0.05, 0.05, 0.6);
  // Visage (projection resserrée) : paupières, sillons du nez, lèvres
  const H = A.head;
  const hu = (th) => headU(th);
  const hv = (uy) => 1 - headV(uy);
  for (const s of [-1, 1]) {
    bump(H, hu(s * 0.38), hv(0.2), 0.05, 0.03, 0.35);
    ridge(H, hu(s * 0.15), hv(-0.28), hu(s * 0.27), hv(-0.52), 0.003, 0.35);
  }
  bump(H, 0.5, hv(-0.5), 0.07, 0.025, 0.4);
  bump(H, 0.5, hv(-0.6), 0.06, 0.025, 0.35);
  // Casque : nervures entre les aérations
  for (let k = 0; k < 14; k++) ridge(A.helmet, k / 14, 0.15, k / 14, 0.5, 0.005, 0.5);
  ridge(A.helmet, 0, 0.5, 1, 0.5, 0.006, 0.6);
  // Chaussure : bride, bord de semelle
  ridge(A.shoe, 0.35, 0.15, 0.55, 0.85, 0.01, 0.5);
  ridge(A.shoe, 0, 0.84, 1, 0.84, 0.008, 0.6);
  // Tenue : coutures des panneaux, fermeture éclair, col, bas de maillot, ourlets des manches et du cuissard
  if (kind === 'kayaker') {
    for (let k = 0; k < 6; k++) ridge(A.torso, 0, 0.15 + k * 0.1, 1, 0.15 + k * 0.1, 0.004, 0.7);
    ridge(A.torso, 0.5, 0.05, 0.5, 0.7, 0.006, 0.8);
  } else {
    for (const c of [0.25, 0.75]) {
      ridge(A.torso, c - 0.05, 0.12, c - 0.07, 0.75, 0.0025, 0.5);
      ridge(A.torso, c + 0.05, 0.12, c + 0.07, 0.75, 0.0025, 0.5);
    }
    ridge(A.torso, 0.5, 0.02, 0.5, 0.68, 0.004, 0.55);
    ridge(A.torso, 0, 0.035, 1, 0.035, 0.006, 0.6);
    if (kind === 'cyclist') {
      ridge(A.torso, 0, 0.735, 1, 0.735, 0.006, 0.6);
      ridge(A.torso, 0, 0.645, 0.2, 0.645, 0.004, 0.6);
      ridge(A.torso, 0.8, 0.645, 1, 0.645, 0.004, 0.6);
      for (const c of [0.07, 0.93]) ridge(A.torso, c, 0.645, c, 0.73, 0.003, 0.4);
      // plis du maillot au creux des reins
      for (let k = 0; k < 4; k++) ridge(A.torso, 0.05, 0.55 + k * 0.035, 0.18, 0.56 + k * 0.035, 0.003, 0.25);
      ridge(A.upper, 0, 0.55, 1, 0.55, 0.006, 0.6);
      ridge(A.thigh, 0, 0.7, 1, 0.7, 0.008, 0.6);
    }
  }
  ridge(A.shin, 0, 0.72, 1, 0.72, 0.006, 0.6);
  ctx.globalCompositeOperation = 'source-over';
  // Hauteurs -> normales (différences centrées)
  const src = ctx.getImageData(0, 0, S, S).data;
  const out = ctx.createImageData(S, S);
  const d = out.data;
  const k = (3.2 * S) / 512;
  const h = (x, y) => src[((Math.min(S - 1, Math.max(0, y)) * S + Math.min(S - 1, Math.max(0, x))) * 4)] / 255;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * k;
      const dy = (h(x, y + 1) - h(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      d[i] = (0.5 - (0.5 * dx) / l) * 255;
      d[i + 1] = (0.5 + (0.5 * dy) / l) * 255;
      d[i + 2] = (0.5 + 0.5 / l) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const tex = keep(new THREE.CanvasTexture(cv));
  normalCache.set(key, tex);
  return tex;
}

// Noms d'équipes fictives (sponsor du maillot), choisis selon la couleur.
const TEAMS = ['ALPINA', 'VÉLOCE', 'AZURA', 'SOLÉO', 'RAPIDO', 'FORZA', 'CIMA', 'NORDIK', 'TEMPO', 'GALIBIER'];
const HAIRS = ['#2a1d15', '#3b2a1e', '#5a3d24', '#8a5a33', '#c19a5b', '#1a1714', '#6b6460'];
const IRIS = ['#5a3a1e', '#3d6fa8', '#4f7a45', '#7a5a2a', '#2d2018'];

// Peinture de la tenue (canvas) : maillot avec panneaux, coutures, sponsor, logo, dossard et numéros de hanche ;
// cuissard ; visage (yeux, sourcils, bouche, barbe), cheveux ; gants ; casque ; chaussures ; bidon.
// look : { hair, iris, beard (0 rasé, 1 barbe de 3 jours, 2 barbe, 3 moustache, 4 bouc), team }
export function paintKit({ kind = 'cyclist', jersey, helmet, accent, skin, number = 1, size = 512, look = {} }) {
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
  const seed = hash(`${jersey}|${helmet}|${skin}|${number}`);
  const hairCol = look.hair || HAIRS[seed % HAIRS.length];
  const iris = look.iris || IRIS[(seed >>> 3) % IRIS.length];
  const beard = look.beard ?? 0;
  const team = look.team || (jersey === '#ff5a1f' ? 'MCW' : TEAMS[hash(jersey + helmet) % TEAMS.length]);
  const dark = shade(jersey, -0.45);
  const shorts = '#17181d';
  const band2 = helmet === jersey ? accent : helmet;
  const px = Math.max(1, S / 512);
  const skinShade = (x, y, w, h, top, bottom) => {
    const g = ctx.createLinearGradient(0, y + top * h, 0, y + bottom * h);
    g.addColorStop(0, skin);
    g.addColorStop(1, shade(skin, -0.12));
    ctx.fillStyle = g;
    ctx.fillRect(x, y + top * h, w, (bottom - top) * h);
  };
  // Logo d'équipe : chevron dans un écusson
  const logo = (cx, cy, r, color, bg) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = r * 0.32;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, r * 0.25);
    ctx.lineTo(0, -r * 0.35);
    ctx.lineTo(r * 0.55, r * 0.25);
    ctx.stroke();
    ctx.restore();
  };
  const stitch = (x0, y0, x1, y1, color = 'rgba(0,0,0,0.35)') => {
    ctx.strokeStyle = color;
    ctx.lineWidth = px;
    ctx.setLineDash([2 * px, 2 * px]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const textC = contrast(jersey);

  // Fond neutre
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);

  // --- Buste : u autour (0.5 = devant), v de haut (cou) en bas (entrejambe)
  clipTo(ATLAS.torso, (x, y, w, h) => {
    if (kind === 'kayaker') {
      // Gilet de sauvetage : panneaux de mousse, sangles et boucles, poche zippée, bandes réfléchissantes
      ctx.fillStyle = jersey;
      ctx.fillRect(x, y, w, h);
      for (let k = 0; k < 6; k++) {
        const g = ctx.createLinearGradient(0, y + (0.1 + k * 0.1) * h, 0, y + (0.2 + k * 0.1) * h);
        g.addColorStop(0, shade(jersey, 0.12));
        g.addColorStop(0.85, shade(jersey, -0.08));
        g.addColorStop(1, shade(jersey, -0.3));
        ctx.fillStyle = g;
        ctx.fillRect(x, y + (0.1 + k * 0.1) * h, w, 0.1 * h);
      }
      ctx.fillStyle = '#16181d';
      ctx.fillRect(x, y, w, 0.08 * h);
      for (const c of [0.25, 0.75]) ctx.fillRect(x + (c - 0.05) * w, y, 0.1 * w, h);
      for (const vy of [0.42, 0.62]) {
        ctx.fillStyle = '#1b1d22';
        ctx.fillRect(x, y + vy * h, w, 0.035 * h);
        ctx.fillStyle = '#c9ccd2';
        ctx.fillRect(x + 0.44 * w, y + (vy - 0.01) * h, 0.12 * w, 0.055 * h);
      }
      ctx.fillStyle = shade(jersey, -0.25);
      ctx.fillRect(x + 0.38 * w, y + 0.16 * h, 0.24 * w, 0.18 * h);
      ctx.fillStyle = '#d8dadf';
      ctx.fillRect(x + 0.38 * w, y + 0.16 * h, 0.24 * w, 0.012 * h);
      ctx.fillStyle = 'rgba(235,240,245,0.85)';
      for (const c of [0.12, 0.88]) ctx.fillRect(x + (c - 0.04) * w, y + 0.12 * h, 0.08 * w, 0.03 * h);
      ctx.fillStyle = textC;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${Math.round(h * 0.05)}px system-ui, sans-serif`;
      ctx.fillText('MCW', x + 0.5 * w, y + 0.25 * h);
      ctx.fillText(team, x, y + 0.3 * h);
      ctx.fillText(team, x + w, y + 0.3 * h);
      return;
    }
    if (kind === 'devil') {
      // Costume de diable : rouge uni, ceinture noire, coutures
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, shade(jersey, 0.1));
      g.addColorStop(1, shade(jersey, -0.25));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#16171b';
      ctx.fillRect(x, y + 0.7 * h, w, 0.05 * h);
      ctx.fillStyle = '#d4af37';
      ctx.fillRect(x + 0.47 * w, y + 0.7 * h, 0.06 * w, 0.05 * h);
      for (const c of [0.25, 0.75]) stitch(x + c * w, y + 0.1 * h, x + c * w, y + h);
      return;
    }
    const unisuit = kind === 'rower';
    const shortsTop = unisuit ? 1.1 : 0.75;
    // Maillot : dégradé vertical léger
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, shade(jersey, 0.08));
    g.addColorStop(0.5, jersey);
    g.addColorStop(1, shade(jersey, -0.15));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    // Panneaux latéraux sombres (sous les bras), surpiqûres
    ctx.fillStyle = dark;
    for (const c of [0.25, 0.75]) {
      ctx.beginPath();
      ctx.moveTo(x + (c - 0.05) * w, y + 0.12 * h);
      ctx.lineTo(x + (c + 0.05) * w, y + 0.12 * h);
      ctx.lineTo(x + (c + 0.07) * w, y + shortsTop * h);
      ctx.lineTo(x + (c - 0.07) * w, y + shortsTop * h);
      ctx.fill();
      stitch(x + (c - 0.055) * w, y + 0.12 * h, x + (c - 0.075) * w, y + shortsTop * h);
      stitch(x + (c + 0.055) * w, y + 0.12 * h, x + (c + 0.075) * w, y + shortsTop * h);
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
    band(0.265, 0.07, band2);
    ctx.restore();
    // Col et épaules (coutures d'épaule)
    ctx.fillStyle = dark;
    ctx.fillRect(x, y, w, 0.035 * h);
    ctx.fillStyle = band2;
    ctx.fillRect(x, y + 0.03 * h, w, 0.008 * h);
    for (const c of [0.12, 0.38, 0.62, 0.88]) stitch(x + c * w, y + 0.04 * h, x + c * w, y + 0.12 * h, 'rgba(0,0,0,0.25)');
    // Fermeture éclair devant : dents et curseur au col
    ctx.fillStyle = 'rgba(30,30,34,0.75)';
    ctx.fillRect(x + 0.494 * w, y, 0.012 * w, shortsTop * h * 0.92);
    ctx.fillStyle = 'rgba(200,203,210,0.9)';
    for (let k = 0; k < 40; k++) ctx.fillRect(x + (k % 2 ? 0.497 : 0.5) * w, y + (0.04 + k * 0.017) * h, 0.004 * w, 0.006 * h);
    ctx.fillStyle = '#d6d8de';
    ctx.fillRect(x + 0.493 * w, y + 0.03 * h, 0.014 * w, 0.035 * h);
    ctx.fillStyle = '#25262b';
    ctx.fillRect(x + 0.496 * w, y + 0.06 * h, 0.008 * w, 0.03 * h);
    // Sponsor sur la poitrine, logo, nom d'équipe dans le dos et sur les flancs
    ctx.fillStyle = textC;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(h * 0.065)}px system-ui, sans-serif`;
    ctx.fillText(team, x + 0.5 * w, y + 0.46 * h);
    logo(x + 0.415 * w, y + 0.165 * h, 0.026 * h, contrast(band2) === '#ffffff' ? band2 : '#15161b', '#ffffff');
    ctx.fillStyle = textC;
    ctx.font = `800 ${Math.round(h * 0.028)}px system-ui, sans-serif`;
    ctx.fillText('MY CYCLE WORLD', x + 0.6 * w, y + 0.165 * h);
    ctx.font = `900 ${Math.round(h * 0.05)}px system-ui, sans-serif`;
    ctx.fillText(team, x + 0.0 * w, y + 0.2 * h);
    ctx.fillText(team, x + 1.0 * w, y + 0.2 * h);
    logo(x + 0.02 * w, y + 0.42 * h, 0.03 * h, band2, 'rgba(255,255,255,0.9)');
    logo(x + 0.98 * w, y + 0.42 * h, 0.03 * h, band2, 'rgba(255,255,255,0.9)');
    if (!unisuit) {
      // Dossard dans le dos (u = 0 = 1), épingles aux coins
      for (const cx of [0, w]) {
        ctx.fillStyle = '#f7f7f2';
        ctx.fillRect(x + cx - 0.085 * w, y + 0.5 * h, 0.17 * w, 0.13 * h);
        ctx.fillStyle = '#d0322b';
        ctx.fillRect(x + cx - 0.085 * w, y + 0.5 * h, 0.17 * w, 0.018 * h);
        ctx.fillStyle = '#111';
        ctx.font = `900 ${Math.round(h * 0.09)}px system-ui, sans-serif`;
        ctx.fillText(String(number), x + cx, y + 0.575 * h);
        ctx.fillStyle = '#9aa0a8';
        for (const [ox, oy] of [[-0.078, 0.505], [0.078, 0.505], [-0.078, 0.62], [0.078, 0.62]]) ctx.fillRect(x + cx + ox * w - px, y + oy * h - px, 2 * px, 2 * px);
      }
      // Numéros de hanche des deux côtés (sur les flancs, au-dessus de la ceinture)
      for (const c of [0.25, 0.75]) {
        ctx.save();
        ctx.translate(x + c * w, y + 0.66 * h);
        ctx.fillStyle = '#f7f7f2';
        ctx.fillRect(-0.04 * w, -0.035 * h, 0.08 * w, 0.07 * h);
        ctx.fillStyle = '#111';
        ctx.font = `900 ${Math.round(h * 0.05)}px system-ui, sans-serif`;
        ctx.fillText(String(number), 0, 0.003 * h);
        ctx.restore();
      }
      // Poches arrière (trois, avec surpiqûres)
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = px * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y + 0.645 * h);
      ctx.lineTo(x + 0.2 * w, y + 0.645 * h);
      ctx.moveTo(x + 0.8 * w, y + 0.645 * h);
      ctx.lineTo(x + w, y + 0.645 * h);
      for (const c of [0.07, 0.93]) {
        ctx.moveTo(x + c * w, y + 0.645 * h);
        ctx.lineTo(x + c * w, y + 0.735 * h);
      }
      ctx.stroke();
      ctx.fillStyle = band2;
      ctx.fillRect(x, y + 0.645 * h, 0.2 * w, 0.006 * h);
      ctx.fillRect(x + 0.8 * w, y + 0.645 * h, 0.2 * w, 0.006 * h);
      // Cuissard (bretelles invisibles sous le maillot), bandes latérales et logo
      ctx.fillStyle = shorts;
      ctx.fillRect(x, y + shortsTop * h, w, h);
      ctx.fillStyle = accent;
      for (const c of [0.25, 0.75]) ctx.fillRect(x + (c - 0.012) * w, y + (shortsTop + 0.02) * h, 0.024 * w, h);
      stitch(x, y + (shortsTop + 0.12) * h, x + w, y + (shortsTop + 0.12) * h, 'rgba(255,255,255,0.12)');
      // Bas du maillot (bande élastique siliconée)
      ctx.fillStyle = dark;
      ctx.fillRect(x, y + (shortsTop - 0.02) * h, w, 0.025 * h);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      for (let k = 0; k < 60; k++) ctx.fillRect(x + (k / 60) * w, y + (shortsTop - 0.012) * h, px * 1.5, px * 1.5);
    } else {
      // Combinaison : bande latérale continue, nom d'équipe sur la hanche
      ctx.fillStyle = band2;
      for (const c of [0.25, 0.75]) ctx.fillRect(x + (c - 0.015) * w, y + 0.12 * h, 0.03 * w, h);
      ctx.fillStyle = textC;
      ctx.font = `900 ${Math.round(h * 0.05)}px system-ui, sans-serif`;
      ctx.fillText('MCW', x + 0.5 * w, y + 0.62 * h);
    }
  });

  // --- Tête (projection resserrée, visage au centre) : peau, yeux, sourcils, nez, bouche, barbe, cheveux
  clipTo(ATLAS.head, (x, y, w, h) => {
    skinShade(x, y, w, h, 0, 1);
    const fx = (th) => x + headU(th) * w;
    const fy = (uy) => y + (1 - headV(uy)) * h;
    const dpx = w / 128; // un « pixel » de référence (128 = 512 / 4)
    const ell = (cx, cy, rx, ry, color, rot = 0) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), rot, 0, Math.PI * 2);
      ctx.fill();
    };
    // Volumes : ombre des orbites, joues, menton, sous le nez
    for (const s of [-1, 1]) {
      const g = ctx.createRadialGradient(fx(s * 0.37), fy(0.08), 0, fx(s * 0.37), fy(0.08), 6 * dpx);
      g.addColorStop(0, shade(skin, -0.22));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      const c = ctx.createRadialGradient(fx(s * 0.55), fy(-0.25), 0, fx(s * 0.55), fy(-0.25), 7 * dpx);
      c.addColorStop(0, 'rgba(205,90,80,0.22)');
      c.addColorStop(1, 'rgba(205,90,80,0)');
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    }
    // Paupières supérieures (trait de cils) et pli au-dessus, cerne léger dessous
    for (const s of [-1, 1]) {
      ctx.strokeStyle = shade(hairCol, -0.2);
      ctx.lineWidth = 1.3 * dpx;
      ctx.beginPath();
      ctx.ellipse(fx(s * 0.37), fy(0.06), 4.2 * dpx, 2.6 * dpx, 0, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.strokeStyle = shade(skin, -0.3);
      ctx.lineWidth = 0.7 * dpx;
      ctx.beginPath();
      ctx.ellipse(fx(s * 0.37), fy(0.08), 4.6 * dpx, 3.6 * dpx, 0, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(90,50,60,0.18)';
      ctx.beginPath();
      ctx.ellipse(fx(s * 0.37), fy(0.06), 4 * dpx, 2.8 * dpx, 0, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      // Sourcils : arc épais qui s'affine vers la tempe
      ctx.fillStyle = shade(hairCol, -0.05);
      ctx.beginPath();
      const b0 = s * 0.16;
      const b1 = s * 0.62;
      ctx.moveTo(fx(b0), fy(0.235));
      ctx.quadraticCurveTo(fx(s * 0.38), fy(0.31), fx(b1), fy(0.24));
      ctx.quadraticCurveTo(fx(s * 0.38), fy(0.285), fx(b0), fy(0.205));
      ctx.fill();
    }
    // Nez : ombres des ailes et narines
    for (const s of [-1, 1]) {
      ell(fx(s * 0.075), fy(-0.31), 1.4 * dpx, 0.9 * dpx, shade(skin, -0.5));
      ell(fx(s * 0.13), fy(-0.2), 1.5 * dpx, 4 * dpx, 'rgba(90,50,40,0.18)');
    }
    // Bouche : lèvres (supérieure plus sombre), commissures, fente
    ell(fx(0), fy(-0.5), 7.2 * dpx, 1.6 * dpx, shade(skin, -0.28));
    ell(fx(0), fy(-0.565), 6.4 * dpx, 2 * dpx, 'rgba(190,95,90,0.55)');
    ctx.strokeStyle = shade(skin, -0.6);
    ctx.lineWidth = 0.9 * dpx;
    ctx.beginPath();
    ctx.moveTo(fx(-0.2), fy(-0.53));
    ctx.quadraticCurveTo(fx(0), fy(-0.545), fx(0.2), fy(-0.53));
    ctx.stroke();
    // Barbe : 1 barbe de trois jours, 2 barbe courte, 3 moustache, 4 bouc
    if (beard) {
      const dots = (cond, alpha, n) => {
        ctx.fillStyle = hairCol;
        let r = seed;
        for (let i = 0; i < n; i++) {
          r = Math.imul(r ^ (r >>> 15), 2246822519) >>> 0;
          const th = ((r & 0xffff) / 65535 - 0.5) * 2.9;
          const uy = (((r >>> 16) & 0xffff) / 65535) * 1.0 - 0.98;
          if (!cond(th, uy)) continue;
          ctx.globalAlpha = alpha * (0.4 + 0.6 * ((r >>> 8) & 255) / 255);
          ctx.fillRect(fx(th), fy(uy), dpx * 0.6, dpx * 0.75);
        }
        ctx.globalAlpha = 1;
      };
      const jaw = (th, uy) => uy < -0.18 - 0.12 * Math.abs(th) && Math.abs(th) < 1.45 && !(Math.abs(th) < 0.24 && uy > -0.62 && uy < -0.44);
      const lip = (th, uy) => Math.abs(th) < 0.28 && uy > -0.48 && uy < -0.36;
      const chin = (th, uy) => Math.abs(th) < 0.24 && uy < -0.64;
      if (beard === 1) dots((a, b) => jaw(a, b) || lip(a, b), 0.45, 9000 * (S / 512) ** 2);
      if (beard === 2) dots((a, b) => jaw(a, b) || lip(a, b), 0.9, 16000 * (S / 512) ** 2);
      if (beard === 3) dots(lip, 0.95, 5000 * (S / 512) ** 2);
      if (beard === 4) dots((a, b) => lip(a, b) || chin(a, b), 0.95, 9000 * (S / 512) ** 2);
    }
    // Cheveux : nuque, côtés et pattes (visibles sous le casque ou la casquette)
    ctx.fillStyle = hairCol;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(fx(s * Math.PI), fy(0.62));
      ctx.lineTo(fx(s * 1.35), fy(0.6));
      ctx.lineTo(fx(s * 1.3), fy(0.05));
      ctx.lineTo(fx(s * 1.42), fy(0.05));
      ctx.lineTo(fx(s * 1.75), fy(0.2));
      ctx.lineTo(fx(s * 2.4), fy(-0.18));
      ctx.lineTo(fx(s * Math.PI), fy(-0.3));
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(x, y, w, (1 - headV(0.62)) * h + 1);
    // Mèches : fines stries plus claires
    ctx.strokeStyle = shade(hairCol, 0.18);
    ctx.lineWidth = 0.6 * dpx;
    for (let k = 0; k < 40; k++) {
      const th = 1.4 + (k / 40) * (Math.PI - 1.4);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(fx(s * th), fy(0.5));
        ctx.lineTo(fx(s * (th + 0.05)), fy(-0.1));
        ctx.stroke();
      }
    }
  });

  // --- Yeux : sclérotique, iris, pupille, reflet
  clipTo(ATLAS.eye, (x, y, w, h) => {
    ctx.fillStyle = '#f2ece6';
    ctx.fillRect(x, y, w, h);
    const g = ctx.createRadialGradient(x + w / 2, y + h / 2, w * 0.2, x + w / 2, y + h / 2, w * 0.5);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(160,90,90,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    const ig = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w * 0.23);
    ig.addColorStop(0, shade(iris, 0.35));
    ig.addColorStop(0.7, iris);
    ig.addColorStop(1, shade(iris, -0.5));
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, w * 0.23, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b0b0d';
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, w * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(x + w * 0.44, y + h * 0.43, w * 0.04, 0, Math.PI * 2);
    ctx.fill();
  });
  // --- Cheveux (queue de cheval) : mèches en bandes ; peau unie ; lèvres
  clipTo(ATLAS.hair, (x, y, w, h) => {
    ctx.fillStyle = hairCol;
    ctx.fillRect(x, y, w, h);
    for (let k = 0; k < 12; k++) {
      ctx.fillStyle = k % 2 ? shade(hairCol, 0.2) : shade(hairCol, -0.2);
      ctx.fillRect(x + (k / 12) * w, y, w / 24, h);
    }
  });
  box(ATLAS.skin, skin);
  box(ATLAS.lip, shade(skin, -0.25));

  // --- Casque : couleur, aérations sombres, liseré maillot
  clipTo(ATLAS.helmet, (x, y, w, h) => {
    ctx.fillStyle = helmet;
    ctx.fillRect(x, y, w, h);
    const ventCol = '#1a1b20';
    if (kind === 'kayaker') {
      // Casque d'eau vive : trous ronds, bande et logo
      ctx.fillStyle = ventCol;
      for (let k = 0; k < 10; k++) {
        ctx.beginPath();
        ctx.arc(x + ((k + 0.5) / 10) * w, y + 0.3 * h, 0.022 * w, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = jersey;
      ctx.fillRect(x, y + 0.55 * h, w, 0.08 * h);
      ctx.fillStyle = '#16171b';
      ctx.fillRect(x, y + 0.82 * h, w, h);
      return;
    }
    // Aérations : fentes longitudinales (u = angle autour de Y, v du sommet vers le bord), bord intérieur clair
    for (let k = 0; k < 14; k++) {
      const u = (k + 0.5) / 14;
      ctx.fillStyle = ventCol;
      ctx.beginPath();
      ctx.ellipse(x + u * w, y + 0.32 * h, 0.022 * w, 0.12 * h, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x + (u - 0.024) * w, y + 0.22 * h, 0.006 * w, 0.2 * h);
    }
    ctx.fillStyle = ventCol;
    for (let k = 0; k < 7; k++) {
      ctx.beginPath();
      ctx.ellipse(x + ((k + 0.1) / 7) * w, y + 0.13 * h, 0.018 * w, 0.06 * h, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = jersey;
    ctx.fillRect(x, y + 0.5 * h, w, 0.06 * h);
    ctx.fillStyle = contrast(helmet) === '#ffffff' ? 'rgba(255,255,255,0.85)' : 'rgba(20,20,24,0.8)';
    ctx.font = `italic 900 ${Math.round(h * 0.07)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const u of [0.25, 0.75]) ctx.fillText('MCW', x + u * w, y + 0.455 * h);
    ctx.fillStyle = '#16171b';
    ctx.fillRect(x, y + 0.62 * h, w, h);
  });

  // --- Verres miroir irisés (reflet du ciel en haut, horizon, sol chaud en bas)
  clipTo(ATLAS.glass, (x, y, w, h) => {
    const tint = helmet === '#ffffff' ? '#2b6cff' : helmet;
    const g = ctx.createLinearGradient(0, y + h, 0, y);
    g.addColorStop(0, '#ff9a4a');
    g.addColorStop(0.35, '#e0607a');
    g.addColorStop(0.6, shade(tint, 0.3));
    g.addColorStop(1, shade(tint, 0.05));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  });
  box(ATLAS.frame, '#18191e');

  // --- Bras (haut) : manche courte (bande siliconée) puis peau ; bras (bas) : peau
  clipTo(ATLAS.upper, (x, y, w, h) => {
    if (kind === 'kayaker') {
      ctx.fillStyle = '#1f2833';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = jersey;
      ctx.fillRect(x, y, w, 0.12 * h);
      return;
    }
    const sleeve = kind === 'rower' ? 0.14 : kind === 'devil' ? 1.01 : 0.62;
    skinShade(x, y, w, h, 0, 1);
    ctx.fillStyle = jersey;
    ctx.fillRect(x, y, w, sleeve * h);
    if (kind !== 'rower') {
      ctx.fillStyle = dark;
      ctx.fillRect(x, y + (sleeve - 0.1) * h, w, 0.1 * h);
      ctx.fillStyle = band2;
      ctx.fillRect(x, y + (sleeve - 0.08) * h, w, 0.04 * h);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      for (let k = 0; k < 16; k++) ctx.fillRect(x + (k / 16) * w, y + (sleeve - 0.025) * h, px * 1.5, px * 1.5);
      ctx.fillStyle = textC;
      ctx.font = `900 ${Math.round(h * 0.06)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(team.slice(0, 4), x + 0.75 * w, y + 0.28 * h);
      ctx.fillText(team.slice(0, 4), x + 0.25 * w, y + 0.28 * h);
    }
  });
  clipTo(ATLAS.fore, (x, y, w, h) => {
    if (kind === 'kayaker') {
      ctx.fillStyle = '#1f2833';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = jersey;
      ctx.fillRect(x, y + 0.86 * h, w, 0.06 * h);
      skinShade(x, y, w, h, 0.92, 1);
      return;
    }
    skinShade(x, y, w, h, 0, 1);
    if (kind === 'devil') {
      ctx.fillStyle = jersey;
      ctx.fillRect(x, y, w, 0.9 * h);
    }
    // Veines légères sur l'avant-bras
    ctx.strokeStyle = 'rgba(70,80,120,0.12)';
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.moveTo(x + 0.55 * w, y + 0.3 * h);
    ctx.quadraticCurveTo(x + 0.5 * w, y + 0.6 * h, x + 0.56 * w, y + 0.9 * h);
    ctx.stroke();
  });

  // --- Gant (coureur) : dos en tissu aéré sombre, bride velcro, paume rembourrée ; peau nue sinon
  clipTo(ATLAS.hand, (x, y, w, h) => {
    ctx.fillStyle = skin;
    ctx.fillRect(x, y, w, h);
    if (kind !== 'cyclist') return;
    ctx.fillStyle = '#1c1d22';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) if ((i + j) % 2) ctx.fillRect(x + (i / 10) * w, y + (0.2 + j * 0.07) * h, w / 20, h / 30);
    ctx.fillStyle = accent;
    ctx.fillRect(x, y + 0.05 * h, w, 0.08 * h);
    ctx.fillStyle = '#2c2d33';
    ctx.fillRect(x + 0.5 * w, y + 0.02 * h, 0.45 * w, 0.14 * h);
    ctx.fillStyle = '#6d6a64';
    ctx.fillRect(x + 0.02 * w, y + 0.35 * h, 0.2 * w, 0.5 * h);
  });
  clipTo(ATLAS.finger, (x, y, w, h) => {
    ctx.fillStyle = skin;
    ctx.fillRect(x, y, w, h);
    if (kind === 'cyclist') {
      ctx.fillStyle = '#1c1d22';
      ctx.fillRect(x, y, w, 0.5 * h);
      ctx.fillStyle = '#2c2d33';
      ctx.fillRect(x, y + 0.46 * h, w, 0.05 * h);
    }
    ctx.fillStyle = shade(skin, 0.15);
    ctx.fillRect(x, y + 0.88 * h, w, 0.12 * h);
  });

  // --- Cuisse : cuissard + bande élastique, puis genou nu
  clipTo(ATLAS.thigh, (x, y, w, h) => {
    skinShade(x, y, w, h, 0, 1);
    const end = kind === 'rower' ? 0.5 : kind === 'devil' ? 1.01 : 0.74;
    const suit = kind === 'cyclist' ? shorts : jersey;
    ctx.fillStyle = suit;
    ctx.fillRect(x, y, w, end * h);
    ctx.fillStyle = kind === 'cyclist' ? accent : helmet;
    for (const c of [0.25, 0.75]) ctx.fillRect(x + (c - 0.018) * w, y, 0.036 * w, end * h);
    if (kind === 'cyclist') {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = `900 ${Math.round(w * 0.07)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const c of [0.25, 0.75]) {
        ctx.save();
        ctx.translate(x + (c + 0.07) * w, y + 0.32 * h);
        ctx.rotate(Math.PI / 2);
        ctx.fillText('MCW', 0, 0);
        ctx.restore();
      }
      stitch(x + 0.5 * w, y, x + 0.5 * w, y + end * h, 'rgba(255,255,255,0.12)');
      stitch(x, y, x, y + end * h, 'rgba(255,255,255,0.12)');
    }
    ctx.fillStyle = kind === 'cyclist' ? '#2a2b31' : dark;
    ctx.fillRect(x, y + (end - 0.05) * h, w, 0.05 * h);
    if (kind === 'cyclist') {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      for (let k = 0; k < 24; k++) ctx.fillRect(x + (k / 24) * w, y + (end - 0.03) * h, px * 1.5, px * 1.5);
    }
  });

  // --- Tibia : peau puis chaussette (revers et logo)
  clipTo(ATLAS.shin, (x, y, w, h) => {
    skinShade(x, y, w, h, 0, 1);
    const sockTop = kind === 'rower' || kind === 'kayaker' ? 0.9 : 0.72;
    if (kind === 'devil') {
      ctx.fillStyle = jersey;
      ctx.fillRect(x, y, w, h);
      return;
    }
    ctx.fillStyle = '#f4f4f2';
    ctx.fillRect(x, y + sockTop * h, w, h);
    ctx.fillStyle = jersey;
    ctx.fillRect(x, y + (sockTop + 0.04) * h, w, 0.035 * h);
    ctx.fillStyle = band2 === '#ffffff' ? dark : band2;
    ctx.fillRect(x, y + (sockTop + 0.085) * h, w, 0.012 * h);
    ctx.fillStyle = '#c9cbd0';
    ctx.fillRect(x, y + sockTop * h, w, 0.008 * h);
  });

  // --- Chaussure : vue de côté (talon à gauche, bout à droite), semelle carbone en bas
  clipTo(ATLAS.shoe, (x, y, w, h) => {
    const upperCol = luminance(jersey) > 0.5 || kind === 'devil' ? '#202127' : '#f5f5f3';
    ctx.fillStyle = upperCol;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = jersey;
    ctx.beginPath();
    ctx.moveTo(x + 0.25 * w, y + 0.2 * h);
    ctx.lineTo(x + 0.45 * w, y + 0.2 * h);
    ctx.lineTo(x + 0.62 * w, y + 0.85 * h);
    ctx.lineTo(x + 0.45 * w, y + 0.85 * h);
    ctx.fill();
    // Perforations d'aération sur l'avant
    ctx.fillStyle = upperCol === '#f5f5f3' ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) ctx.fillRect(x + (0.66 + i * 0.045) * w, y + (0.35 + j * 0.13) * h, px * 1.5, px * 1.5);
    ctx.fillStyle = '#1c1c20';
    ctx.beginPath();
    ctx.arc(x + 0.42 * w, y + 0.22 * h, 0.07 * h * 2, 0, Math.PI * 2); // molette de serrage
    ctx.fill();
    ctx.fillStyle = '#121216';
    ctx.fillRect(x, y + 0.84 * h, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(x, y + 0.84 * h, w, 0.025 * h);
  });

  // Couleurs unies
  box(ATLAS.dark, '#141519');
  box(ATLAS.metal, '#c9ccd2');
  box(ATLAS.accent, jersey);
  box(ATLAS.seat, '#24262c');
  // Bidon : blanc, bande aux couleurs, bouchon noir en haut (v du haut vers le bas)
  clipTo(ATLAS.bottle, (x, y, w, h) => {
    ctx.fillStyle = '#f2f2ee';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#1a1b1f';
    ctx.fillRect(x, y, w, 0.16 * h);
    ctx.fillStyle = jersey;
    ctx.fillRect(x, y + 0.35 * h, w, 0.3 * h);
    ctx.fillStyle = textC;
    ctx.font = `900 ${Math.round(h * 0.14)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MCW', x + 0.5 * w, y + 0.5 * h);
  });
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
  const map = keep(paintKit({ ...opts, size: quality === 'low' ? 256 : quality === 'high' ? 1024 : 512 }));
  const rough = roughnessAtlas();
  const mat = keep(new THREE.MeshStandardMaterial({ map, roughnessMap: rough, metalnessMap: rough, roughness: 1, metalness: 1 }));
  if (quality !== 'low') {
    mat.normalMap = reliefMap(opts.kind || 'cyclist', 512);
    mat.normalScale.set(0.9, 0.9);
  }
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
