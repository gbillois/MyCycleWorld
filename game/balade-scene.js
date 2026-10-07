// Décor de la Grande Balade (zones de game/balade.js), en graphismes détaillés et simples.
//   baladeTerrain(track) : reliefs propres à la zone (collines des maisons, butte de la tour en ruine, colline de
//     la halle, parois des vallons et des cols, rivière sous le pont, gué...) et lac au bord de la route
//   buildBalade(group, ctx, opts) : décors stylisés (maisons-collines, moulin, village, tour en ruine, pierres
//     levées, villas et cascades, entrée de mine, forêt dorée et cabanes perchées, château, fort du défilé, halle,
//     géants du lac, grande muraille, ruines, volcan...). Formes simples, couleurs dans les sommets : quelques
//     maillages fusionnés pour toute la zone, plus les lueurs (lanternes, lave, lucioles) et l'eau.
// Tout est généré par le code : aucune image ni modèle.
import * as THREE from 'three';
import { ROAD_HALF, rng } from './track.js';
import { mergeGeometries, paint, indexify } from './geom.js';
import { makeWater } from './water.js';

const C = (hex) => new THREE.Color(hex);
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hash(ix, iz, k = 0) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(k, 2147483587)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z, k = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, k);
  const b = hash(ix + 1, iz, k);
  const c = hash(ix, iz + 1, k);
  const d = hash(ix + 1, iz + 1, k);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

// --- Reliefs de la zone ---

// Bosse ronde (1 au centre, 0 au bord) ; top : fraction du rayon aplanie (plateau de la colline de la halle).
const bump = (d, r, top = 0) => (d >= r ? 0 : d <= r * top ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (d - r * top)) / (r * (1 - top))));

// Reliefs de la zone, appliqués par la fonction de hauteur du terrain (détaillé : scenery.js, simple : track.js).
export function baladeTerrain(track) {
  const course = track.course;
  const L = track.length;
  const mounds = [];
  const channels = [];
  const walls = [];
  const f = {};
  const at = (u, side, dist) => track.frame(u * L, side * dist, {});
  for (const [kind, u, side, dist] of course.sights || []) {
    const p = at(u, side, dist);
    const m = (r, h, top = 0, gate = 26) => mounds.push({ x: p.x, z: p.z, r, h, top, gate });
    if (kind === 'hillhouse') m(13, 4.6);
    else if (kind === 'bighillhouse') m(44, 12);
    else if (kind === 'ruinedtower') m(175, 82, 0.12, 60);
    else if (kind === 'hillhall') m(105, 30, 0.34, 40);
    else if (kind === 'belvedere') m(80, 48, 0.1, 40);
    else if (kind === 'bridge' || kind === 'ford') {
      // Rivière en travers de la route (le Brandevin sous son pont, la Bruinen au gué).
      track.frame(u * L, 0, f);
      const ford = kind === 'ford';
      channels.push({ x: f.x, z: f.z, dx: f.rx, dz: f.rz, w: ford ? 6 : 13, len: 520, water: f.y + (ford ? 0.07 : -2.4), bed: f.y + (ford ? -0.9 : -4.2), ford });
    }
  }
  // Parois de part et d'autre (vallon des villas, col, lacets de basalte, rochers gris), d'après la zone.
  for (const [u0, u1, h, w0, w1] of course.walls || []) walls.push({ u0, u1, h, w0, w1 });

  let lake = null;
  if (course.lake) {
    const { u, side, dist, r } = course.lake;
    const p = at(u, side, dist);
    lake = { x: p.x, z: p.z, r };
  }

  const n = track.count;
  // h : altitude du terrain sans reliefs ; near : point de la route le plus proche ({ index, dist, y }).
  const apply = (x, z, near, h) => {
    const roadGate = (g) => smoothstep(ROAD_HALF + 3, ROAD_HALF + g, near.dist);
    for (const m of mounds) {
      const d = Math.hypot(x - m.x, z - m.z);
      if (d < m.r) h += m.h * bump(d, m.r, m.top) * roadGate(m.gate) * (1 + vnoise(x * 0.05, z * 0.05, 3) * 0.06);
    }
    if (walls.length) {
      const u = track.fractionOf(near.index);
      for (const w of walls) {
        const k = smoothstep(w.u0 - 0.03, w.u0 + 0.02, u) * (1 - smoothstep(w.u1 - 0.02, w.u1 + 0.03, u));
        if (k <= 0) continue;
        // Crêtes irrégulières : hauteur et pied de la paroi varient (pas de mur plat).
        const n1 = (vnoise(x * 0.018, z * 0.018, 5) + 1) / 2;
        const n2 = (vnoise(x * 0.06, z * 0.06, 6) + 1) / 2;
        const foot = w.w0 + (n2 - 0.5) * 20;
        h += k * w.h * (0.45 + n1 * 0.75 + n2 * 0.15) * smoothstep(foot, w.w1 + n1 * 40, near.dist);
      }
    }
    for (const c of channels) {
      const ox = x - c.x;
      const oz = z - c.z;
      const along = ox * c.dx + oz * c.dz;
      if (Math.abs(along) > c.len) continue;
      const meander = Math.sin(along * 0.012) * 18 * smoothstep(30, 120, Math.abs(along));
      const across = Math.abs(ox * -c.dz + oz * c.dx - meander);
      if (across > c.w * 1.6) continue;
      const bed = c.bed + (c.water - c.bed) * (across / c.w) ** 2;
      const k = smoothstep(c.w * 1.6, c.w * 0.85, across);
      if (bed < h) h += (bed - h) * k;
    }
    return h;
  };
  return { apply, lake, mounds, channels, walls, count: n };
}

// --- Petites briques géométriques (couleur dans les sommets) ---

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpV = new THREE.Vector3();

function tintNoise(geo, base, amount = 0.08, freq = 0.7, seed = 1) {
  const c0 = C(base);
  return paint(geo, (c, x, y, z) => c.copy(c0).multiplyScalar(1 + vnoise(x * freq + seed, z * freq + y * freq * 0.7, seed) * amount));
}
const box = (w, h, d, col, x = 0, y = 0, z = 0) => tintNoise(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), col, 0.06, 0.9);
const cyl = (rt, rb, h, col, x = 0, y = 0, z = 0, seg = 10) => tintNoise(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z), col, 0.05);
const cone = (r, h, col, x = 0, y = 0, z = 0, seg = 8) => tintNoise(new THREE.ConeGeometry(r, h, seg).translate(x, y + h / 2, z), col, 0.06);
const ball = (r, col, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, detail = 1) => tintNoise(indexify(new THREE.IcosahedronGeometry(r, detail)).scale(sx, sy, sz).translate(x, y, z), col, 0.1, 0.5);

// Rocher irrégulier.
function rock(r, col, seed = 1, sy = 0.7) {
  const g = indexify(new THREE.IcosahedronGeometry(r, 1));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    tmpV.set(p.getX(i), p.getY(i), p.getZ(i));
    const k = 1 + vnoise(tmpV.x * 0.9 / r + seed, tmpV.z * 0.9 / r + tmpV.y / r, seed) * 0.28;
    p.setXYZ(i, tmpV.x * k, tmpV.y * k * sy, tmpV.z * k);
  }
  g.computeVertexNormals();
  return tintNoise(g, col, 0.14, 0.4, seed);
}

// Géométrie posée dans le monde : rotation (lacet, puis tangage et roulis), échelle, position.
function put(g, x, y, z, yaw = 0, scale = 1, pitch = 0, roll = 0) {
  tmpM.compose(tmpV.set(x, y, z), tmpQ.setFromEuler(tmpE.set(pitch, yaw, roll, 'YXZ')), typeof scale === 'number' ? tmpS.setScalar(scale) : scale);
  return g.applyMatrix4(tmpM);
}
// Pièces d'un objet, en coordonnées locales, posées ensemble.
function group(parts, x, y, z, yaw = 0, scale = 1) {
  return parts.map((g) => put(g, x, y, z, yaw, scale));
}
// Cylindre entre deux points (membres des statues, branches).
function limb(a, b, r0, r1, col, seg = 7) {
  const len = a.distanceTo(b);
  const g = tintNoise(new THREE.CylinderGeometry(r1, r0, len, seg).translate(0, len / 2, 0), col, 0.05);
  tmpQ.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tmpV.copy(b).sub(a).normalize());
  tmpM.compose(a, tmpQ, tmpS.setScalar(1));
  return g.applyMatrix4(tmpM);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Prisme de toit à deux pans (faîtage selon X), du bas des pans (y = 0) au faîte (h).
function gable(w, d, h, col) {
  const s = new THREE.Shape();
  s.moveTo(-d / 2, 0);
  s.lineTo(d / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  return tintNoise(g, col, 0.08, 1.2);
}

// Grande montagne (relief en crêtes) : rayon r, hauteur h, neige au-dessus de snow (fraction), cratère éventuel.
function mountain({ r, h, seed = 1, snow = 2, rockCol = '#6f665b', lowCol = '#56604a', snowCol = '#eef2f7', crater = 0, seg = 48, rings = 22 }) {
  const pos = [];
  const col = [];
  const idx = [];
  const c = new THREE.Color();
  const lowC = C(lowCol);
  const rockC = C(rockCol);
  const snowC = C(snowCol);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const ridge = 1 - Math.abs(vnoise(Math.cos(a) * 3 + seed, Math.sin(a) * 3 + t * 4, seed));
      const rr = r * t * (0.86 + ridge * 0.22);
      let y = h * Math.pow(1 - t, 1.25) * (0.88 + ridge * 0.18);
      if (crater && t < crater) y = h * Math.pow(1 - crater, 1.25) * (0.88 + ridge * 0.18) - (crater - t) * h * 0.6;
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      const rel = y / h;
      c.copy(lowC).lerp(rockC, smoothstep(0.08, 0.35, rel + ridge * 0.1));
      c.lerp(snowC, smoothstep(snow, snow + 0.08, rel + (ridge - 0.5) * 0.12));
      c.multiplyScalar(0.8 + ridge * 0.3);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + seg + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Plan d'eau simple (graphismes simples, gué, mares).
function waterPlane(geo, detailed, ctx, y, colors = {}) {
  if (detailed && ctx.maps) {
    return makeWater(geo, { mood: ctx.mood, maps: ctx.maps, waterY: y, shared: ctx.shared, chop: 0.24, shallow: colors.shallow || '#4aa9b0', deep: colors.deep || '#164f6e', sand: '#9e8c66', depthScale: 0.5, foam: 0.6 });
  }
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: colors.flat || '#3b8fc0', transparent: true, opacity: 0.88 }));
}

// --- Monuments ---
// Chaque fonction reçoit B (listes solid, glow, et fonctions d'aide) et la position au bord de la route.

// Grande maison-colline avec un chêne au sommet et un portail.
function bigHillHouse(B, p, yawFace, r) {
  hillHouse(B, { x: p.x + Math.sin(yawFace) * 22, z: p.z + Math.cos(yawFace) * 22 }, yawFace, r);
  const top = B.heightAt(p.x, p.z);
  tree(B, p.x - 6, top - 0.5, p.z + 4, 1.8, '#4f7d31', r);
  const gx = p.x + Math.sin(yawFace) * 38;
  const gz = p.z + Math.cos(yawFace) * 38;
  B.solid.push(...group([box(0.12, 1.2, 0.12, '#6c4a2c', -0.6, 0, 0), box(0.12, 1.2, 0.12, '#6c4a2c', 0.6, 0, 0), box(1.6, 0.12, 0.08, '#8a6a46', 0, 0.9, 0), box(1.6, 0.12, 0.08, '#8a6a46', 0, 0.5, 0)], gx, B.heightAt(gx, gz), gz, yawFace));
}

// Arbre feuillu (tronc + houppier en boules), échelle sc.
function tree(B, x, y, z, sc, leaf, r) {
  const parts = [cyl(0.35, 0.55, 4.5, '#5b4330', 0, 0, 0, 7)];
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05 + r();
    parts.push(ball(1.8 + r() * 0.8, leaf, Math.cos(a) * 1.6, 5 + r() * 1.8, Math.sin(a) * 1.6, 1, 0.8, 1, 1));
  }
  parts.push(ball(2.2, leaf, 0, 6.8, 0, 1, 0.8, 1, 1));
  B.solid.push(...group(parts, x, y, z, r() * 6, sc));
}

// Grand arbre de fête : lampions dans les branches et chapiteau à côté.
function bigTree(B, p, yawFace, r) {
  const y = B.heightAt(p.x, p.z);
  tree(B, p.x, y - 0.3, p.z, 2.6, '#55913a', r);
  // Lampions accrochés et pavillon de fête.
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    B.glow.push(put(ball(0.22, ['#ff9a3c', '#ffd34f', '#ff6f6f', '#9fe07a'][k % 4], 0, 0, 0, 1, 1, 1, 0), p.x + Math.cos(a) * 6.5, y + 9 + Math.sin(k * 2.1) * 0.6, p.z + Math.sin(a) * 6.5));
  }
  const tx = p.x + Math.sin(yawFace) * 14;
  const tz = p.z + Math.cos(yawFace) * 14;
  B.solid.push(...group([
    box(9, 0.08, 6, '#efe7d2', 0, 3.2, 0),
    gable(9, 6.2, 1.6, '#f4efe2').translate(0, 3.25, 0),
    ...[[-4.4, -2.9], [4.4, -2.9], [-4.4, 2.9], [4.4, 2.9]].map(([a, b]) => cyl(0.08, 0.08, 3.3, '#c9bba0', a, 0, b, 5)),
    box(5, 0.8, 1, '#8a6a46', 0, 0, 0),
  ], tx, B.heightAt(tx, tz), tz, yawFace + Math.PI / 2));
}

// Maison à colombages : rez en pierre, étage blanc et poutres sombres, toit pentu.
function timberHouse(B, x, y, z, yaw, r, big = false) {
  const w = big ? 12 : 8 + r() * 2;
  const d = big ? 8 : 6;
  const parts = [
    box(w, 2.6, d, '#8d8270', 0, -0.6, 0),
    box(w + 0.3, 2.8, d + 0.3, '#ece3cf', 0, 2.0, 0),
    gable(w + 1.2, d + 1.6, big ? 4.6 : 3.8, '#5b4a3a').translate(0, 4.75, 0),
    box(1.3, 2.2, 0.2, '#5a3a22', 0, -0.1, d / 2 + 0.05),
    box(0.8, 3.2, 0.8, '#7a6e5e', w / 2 - 1.2, 4.5, 0),
  ];
  for (let k = -2; k <= 2; k++) parts.push(box(0.22, 2.8, 0.1, '#3d2c1e', (k * w) / 5, 2.0, d / 2 + 0.16));
  parts.push(box(w + 0.3, 0.22, 0.1, '#3d2c1e', 0, 3.4, d / 2 + 0.16));
  for (const k of [-1, 1]) parts.push(box(1.1, 1, 0.12, '#ffdf8a', k * (w / 4), 2.6, d / 2 + 0.18));
  B.solid.push(...group(parts, x, y, z, yaw));
  for (const k of [-1, 1]) B.glow.push(put(box(0.9, 0.8, 0.06, '#ffcf70', k * (w / 4), 2.7, d / 2 + 0.25), x, y, z, yaw));
}

function villageGate(B, s) {
  const f = B.frame(s, 0);
  const yaw = Math.atan2(f.tx, f.tz);
  const parts = [];
  for (const side of [-1, 1]) {
    parts.push(box(0.9, 7, 0.9, '#5e4630', side * (ROAD_HALF + 1), 0, 0));
    // Haie et talus du village de part et d'autre.
    parts.push(box(70, 2.6, 4, '#3c6a2c', side * (ROAD_HALF + 37), -0.6, 0), box(70, 1.2, 6, '#5b4a35', side * (ROAD_HALF + 37), -1.2, 2.5));
  }
  parts.push(box(ROAD_HALF * 2 + 3.4, 0.8, 0.8, '#5e4630', 0, 6.2, 0));
  parts.push(box(3.6, 1.2, 0.2, '#d8c9a0', 0, 4.8, 0.5));
  B.solid.push(...group(parts, f.x, f.y, f.z, yaw));
  for (const side of [-1, 1]) B.glow.push(put(ball(0.3, '#ffb65c', 0, 0, 0, 1, 1.2, 1, 0), f.x + f.rx * side * (ROAD_HALF + 1), f.y + 7.4, f.z + f.rz * side * (ROAD_HALF + 1)));
}

// Moulin à eau près de la mare (la roue tourne).
function mill(B, p, yawFace) {
  const y = B.heightAt(p.x, p.z);
  B.solid.push(...group([
    box(8, 4.4, 7, '#cdbb98', 0, -0.4, 0),
    gable(9, 8, 3.6, '#7a3d2a').translate(0, 4, 0),
    box(1.2, 2.2, 0.2, '#4a3220', 0, 0, 3.55),
  ], p.x, y, p.z, yawFace));
  const wheel = mergeGeometries([
    cyl(2.6, 2.6, 0.5, '#5a3f28', 0, -0.25, 0, 16),
    ...Array.from({ length: 10 }, (_, k) => box(0.3, 1, 0.9, '#6b4c32', 0, -0.5, 0).translate(2.6, 0, 0).rotateY((k / 10) * Math.PI * 2)),
  ]).rotateZ(Math.PI / 2);
  const mesh = new THREE.Mesh(wheel, B.solidMat);
  const ax = p.x + Math.cos(yawFace) * 4.6;
  const az = p.z - Math.sin(yawFace) * 4.6;
  mesh.position.set(ax, y + 1.6, az);
  mesh.rotation.y = yawFace;
  mesh.castShadow = B.cast;
  B.add(mesh);
  B.anim.push((dt) => (mesh.rotation.x += dt * 0.6));
}

// Pont de pierre : parapets, arches et piles ; la rivière passe dessous.
function bridge(B, s, ch) {
  const parts = [];
  for (let k = -8; k <= 8; k++) {
    const f = B.frame(s + k * 1.6, 0);
    const yaw = Math.atan2(f.tx, f.tz);
    for (const side of [-1, 1]) {
      parts.push(put(box(0.6, 1.1, 1.7, '#9d9282', 0, 0, 0), f.x + f.rx * side * (ROAD_HALF + 0.3), f.y, f.z + f.rz * side * (ROAD_HALF + 0.3), yaw));
      // Tablier sous la route jusqu'à la rivière.
      parts.push(put(box(0.5, Math.abs(k) < 5 ? 3.5 : 2.4, 1.7, '#8c8273', 0, 0, 0), f.x + f.rx * side * (ROAD_HALF + 0.3), f.y - (Math.abs(k) < 5 ? 3.5 : 2.4), f.z + f.rz * side * (ROAD_HALF + 0.3), yaw));
    }
    parts.push(put(box(ROAD_HALF * 2, 0.5, 1.7, '#7f7668', 0, 0, 0), f.x, f.y - 0.55, f.z, yaw));
  }
  B.solid.push(...parts);
  channelWater(B, ch);
}

// Eau d'une rivière en travers de la route (ruban le long de son lit, avec ses méandres).
function channelWater(B, ch) {
  const pos = [];
  const idx = [];
  const N = 120;
  for (let i = 0; i <= N; i++) {
    const along = -ch.len + (2 * ch.len * i) / N;
    const meander = Math.sin(along * 0.012) * 18 * smoothstep(30, 120, Math.abs(along));
    const cx = ch.x + ch.dx * along - ch.dz * meander;
    const cz = ch.z + ch.dz * along + ch.dx * meander;
    const w = ch.w * 1.05;
    pos.push(cx + ch.dz * w, 0, cz - ch.dx * w, cx - ch.dz * w, 0, cz + ch.dx * w);
    if (i) idx.push((i - 1) * 2, (i - 1) * 2 + 1, i * 2, (i - 1) * 2 + 1, i * 2 + 1, i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const water = waterPlane(g, B.detailed, B.ctx, ch.water, { shallow: '#5aa9a2', deep: '#1d5866', flat: '#4b8fb0' });
  water.material.side = THREE.DoubleSide;
  water.position.y = ch.water;
  B.add(water);
}

// Bac : radeau sur la rivière, en amont du pont (côté gauche de la route).
function ferry(B, ch) {
  const along = -70;
  const meander = Math.sin(along * 0.012) * 18 * smoothstep(30, 120, Math.abs(along));
  const p = { x: ch.x + ch.dx * along - ch.dz * meander, z: ch.z + ch.dz * along + ch.dx * meander };
  const yawFace = Math.atan2(ch.dx, ch.dz);
  B.solid.push(...group([
    box(6, 0.5, 3.4, '#7d5a3a', 0, 0, 0),
    ...[-2.6, 2.6].map((a) => box(0.15, 0.8, 3.4, '#5b4129', a, 0.4, 0)),
    box(0.2, 1.6, 0.2, '#5b4129', -2.6, 0.4, 1.5),
    box(0.4, 0.9, 0.4, '#3d6b9e', 0, 0.5, 0),
  ], p.x, ch.water - 0.2, p.z, yawFace));
}

// Tour de guet en ruine au sommet d'une colline : pans de murs ronds, pierres tombées, feu de camp.
function ruinedTower(B, p) {
  const top = B.heightAt(p.x, p.z);
  const parts = [];
  for (let k = 0; k < 16; k++) {
    if (k % 6 === 4) continue;
    const a = (k / 16) * Math.PI * 2;
    const h = 4 + hash(k, 7) * 9 + (k < 5 ? 8 : 0);
    parts.push(put(box(4.4, h, 1.8, '#8d8a80', 0, 0, 0), p.x + Math.cos(a) * 9, top - 1.5, p.z + Math.sin(a) * 9, -a + Math.PI / 2));
  }
  for (let k = 0; k < 14; k++) parts.push(put(rock(0.8 + hash(k, 3) * 0.9, '#8a867c', k), p.x + (hash(k, 1) - 0.5) * 40, top - 2.5, p.z + (hash(k, 2) - 0.5) * 40));
  B.solid.push(...parts);
  B.glow.push(put(ball(0.6, '#ff9b42', 0, 0, 0, 1, 1, 1, 0), p.x + 3, top + 0.6, p.z - 2));
  B.smoke.push([p.x + 3, top + 1, p.z - 2, 1.4]);
}

// Cercle de pierres levées au bord de la route, couvertes de lichen.
function standingStones(B, s, side, dist) {
  const c = B.frame(s, side * dist);
  const y0 = B.heightAt(c.x, c.z);
  const parts = [];
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * Math.PI * 2;
    const x = c.x + Math.cos(a) * 9;
    const z = c.z + Math.sin(a) * 9;
    const h = 2.6 + hash(k, 11) * 2.4;
    parts.push(put(box(1.3, h, 0.8, k % 3 ? '#8a877d' : '#7c8070', 0, 0, 0), x, B.heightAt(x, z) - 0.4, z, -a, 1, (hash(k, 12) - 0.5) * 0.12, (hash(k, 13) - 0.5) * 0.12));
  }
  parts.push(put(box(2.6, 0.8, 1.4, '#8a877d', 0, 0, 0), c.x, y0 - 0.2, c.z, 0.4));
  B.solid.push(...parts);
}

// Gué : eau peu profonde sur la route, galets.
function ford(B, s, ch) {
  channelWater(B, ch);
  for (let k = 0; k < 18; k++) {
    const f = B.frame(s + (hash(k, 4) - 0.5) * 24, (hash(k, 5) - 0.5) * 40);
    if (Math.abs((hash(k, 5) - 0.5) * 40) < ROAD_HALF + 1) continue;
    B.solid.push(put(rock(0.5 + hash(k, 6) * 0.8, '#8b8f8c', k), f.x, B.heightAt(f.x, f.z) + 0.1, f.z));
  }
}

// Villa du vallon : murs blancs, colonnade, toit de tuiles, parfois une tour carrée.
function villa(B, x, y, z, yaw, r, big = false) {
  const w = big ? 18 : 10;
  const d = big ? 10 : 7;
  const roofC = '#b5603e';
  const parts = [
    box(w + 2, 0.6, d + 4, '#d9d2bf', 0, -0.4, 1),
    box(w, 4.2, d, '#ece6d6', 0, 0.2, 0),
    gable(w + 2.4, d + 2.6, 2.2, roofC).translate(0, 4.4, 0),
  ];
  for (let k = 0; k <= (big ? 7 : 4); k++) parts.push(cyl(0.18, 0.22, 4.2, '#f2eee3', -w / 2 + (k * w) / (big ? 7 : 4), 0.2, d / 2 + 1.6, 8));
  if (big || r() < 0.6) parts.push(box(3.4, 9, 3.4, '#ece6d6', w / 2 - 1.2, 0.2, -d / 2 + 1.2), gable(4, 4, 1.6, roofC).translate(w / 2 - 1.2, 9.2, -d / 2 + 1.2));
  B.solid.push(...group(parts, x, y, z, yaw));
  for (let k = 0; k < (big ? 6 : 3); k++) B.glow.push(put(box(0.9, 1.6, 0.1, '#ffe7b0', -w / 2 + 1.5 + k * 2.6, 1.4, d / 2 + 0.06), x, y, z, yaw));
}

// Cascade sur une paroi : falaise, nappe d'eau qui défile, bassin d'écume.
function waterfall(B, p, yawFace, h = 40, w = 8) {
  const y = B.heightAt(p.x, p.z);
  B.solid.push(...group([rock(w * 1.2, '#7d7a70', 3, 2.2).translate(0, h * 0.45, -w * 0.9)], p.x, y, p.z, yawFace, 1));
  const sheet = new THREE.PlaneGeometry(w, h, 1, 8).translate(0, h / 2, 0);
  const mesh = new THREE.Mesh(sheet, B.fallMat);
  mesh.position.set(p.x, y - 1, p.z);
  mesh.rotation.y = yawFace;
  B.add(mesh);
  B.solid.push(put(ball(w * 0.55, '#eef4f6', 0, 0, 0, 1.4, 0.3, 1, 1), p.x + Math.sin(yawFace) * 1.5, y, p.z + Math.cos(yawFace) * 1.5));
}

function holly(B, s0, side, dist, r) {
  for (let k = 0; k < 16; k++) {
    const f = B.frame(s0 + (k - 8) * 9 + r() * 4, side * (dist + r() * 14));
    const y = B.heightAt(f.x, f.z);
    const sc = 0.9 + r() * 0.6;
    const parts = [cone(2.2, 6, '#1f4a2a', 0, 0.6, 0, 9), cyl(0.3, 0.35, 1, '#4a3a2a', 0, 0, 0, 6)];
    for (let b = 0; b < 6; b++) parts.push(ball(0.2, '#c8262c', Math.cos(b * 1.3) * 1.3, 2 + b * 0.5, Math.sin(b * 1.3) * 1.3, 1, 1, 1, 0));
    B.solid.push(...group(parts, f.x, y - 0.2, f.z, r() * 6, sc));
  }
}

function ruin(B, p, yawFace) {
  const y = B.heightAt(p.x, p.z);
  const parts = [];
  for (let k = 0; k < 6; k++) parts.push(cyl(0.7, 0.8, 3 + hash(k, 9) * 6, '#b9b2a2', (k - 2.5) * 4, 0, 0, 10));
  parts.push(box(10, 1.2, 1.6, '#b9b2a2', -6, 8.6, 0), box(30, 0.6, 9, '#a39d8f', 0, -0.3, 0));
  for (let k = 0; k < 5; k++) parts.push(rock(1 + hash(k, 2), '#aaa395', k).translate((hash(k, 3) - 0.5) * 24, 0.3, 4 + hash(k, 4) * 5));
  B.solid.push(...group(parts, p.x, y - 0.2, p.z, yawFace));
}

function bigMountain(B, x, z, opts) {
  const g = mountain(opts);
  g.translate(x, opts.base ?? B.track.minY - 30, z);
  B.add(new THREE.Mesh(g, B.farMat));
}

// Entrée de la vieille mine : falaise en travers de la route après l'arrivée, boisage, rails, lanternes, wagonnet.
function mineGate(B) {
  const end = B.frame(B.track.length + 32, 0);
  const yaw = Math.atan2(end.tx, end.tz) + Math.PI; // façade tournée vers le cycliste
  const cliff = [];
  for (let k = 0; k < 9; k++) cliff.push(rock(16 + hash(k, 1) * 10, '#6b6760', k, 1.6).translate((k - 4) * 22, 14 + hash(k, 2) * 14, -12 - hash(k, 3) * 10));
  cliff.push(box(200, 70, 20, '#5f5b55', 0, -10, -26));
  const wood = '#6b4a2c';
  const mine = [
    box(10, 9, 2, '#16171a', 0, 0, -2.2), // ouverture sombre
    box(1, 9.5, 1, wood, -5.4, 0, -1.2), box(1, 9.5, 1, wood, 5.4, 0, -1.2), box(12.4, 1.1, 1.2, wood, 0, 9.4, -1.2),
    box(1, 6, 0.4, wood, 0, 9.6, -1.8).rotateZ(0),
  ];
  for (const sx of [-0.8, 0.8]) mine.push(box(0.15, 0.12, 40, '#7a7068', sx, 0.05, 16)); // rails
  for (let k = 0; k < 12; k++) mine.push(box(2.4, 0.12, 0.3, '#5b4129', 0, 0, -1 + k * 3.2)); // traverses
  mine.push(box(2.2, 1.2, 3, '#5a5a5e', 0, 0.4, 6), box(2.4, 0.2, 3.2, '#3e3e42', 0, 0.3, 6)); // wagonnet
  B.solid.push(...group([...cliff, ...mine], end.x, end.y - 0.3, end.z, yaw));
  for (const sx of [-1, 1]) B.glow.push(...group([ball(0.35, '#ffb65c', sx * 6.6, 6.2, -0.4, 1, 1.3, 1, 0)], end.x, end.y - 0.3, end.z, yaw));
  // Deux grands sapins de part et d'autre.
  for (const sx of [-1, 1]) {
    const hx = end.x + end.rx * sx * 14;
    const hz = end.z + end.rz * sx * 14;
    B.solid.push(...group([cone(4, 14, '#1f4a2a', 0, 1, 0, 10), cyl(0.5, 0.7, 2, '#4a3a2a', 0, 0, 0, 6)], hx, B.heightAt(hx, hz) - 0.2, hz));
  }
}

// Le serpent du lac : trois bosses et une tête qui ondulent à la surface, l'air débonnaire.
function lakeSerpent(B, lake) {
  if (!lake) return;
  const col = '#3f7a5a';
  const parts = [];
  for (let k = 0; k < 3; k++) parts.push(ball(1.6, col, k * 4.2, 0, 0, 1.2, 1, 0.9, 1));
  parts.push(limb(V(-1.4, 0, 0), V(-3.2, 4.2, 0), 0.8, 0.6, col), ball(1.1, col, -3.6, 4.8, 0, 1.4, 0.9, 0.9, 1));
  parts.push(ball(0.2, '#f6f2e6', -4.6, 5.1, 0.6, 1, 1, 1, 0), ball(0.2, '#f6f2e6', -4.6, 5.1, -0.6, 1, 1, 1, 0));
  const mesh = new THREE.Mesh(mergeGeometries(parts), B.solidMat);
  const y0 = (lake.y ?? B.track.minY) - 0.4;
  mesh.position.set(lake.x, y0, lake.z);
  B.add(mesh);
  B.anim.push((dt, t) => {
    mesh.position.y = y0 + Math.sin(t * 0.9) * 0.35;
    mesh.rotation.y = t * 0.05;
  });
}

// Arche de bois à l'entrée du bois, lanternes de part et d'autre.
function woodArch(B, s) {
  const f = B.frame(s, 0);
  const yaw = Math.atan2(f.tx, f.tz);
  const parts = [];
  for (const side of [-1, 1]) parts.push(box(0.8, 7, 0.8, '#6b4a2c', side * (ROAD_HALF + 1.2), 0, 0));
  for (let k = 0; k <= 12; k++) {
    const a = Math.PI * (k / 12);
    parts.push(box(1, 0.5, 0.6, '#7d5a36', -Math.cos(a) * (ROAD_HALF + 1.2), 6.6 + Math.sin(a) * 1.8, 0));
  }
  B.solid.push(...group(parts, f.x, f.y, f.z, yaw));
  for (const side of [-1, 1]) B.glow.push(put(ball(0.35, '#ffd88a', 0, 0, 0, 1, 1.4, 1, 0), f.x + f.rx * side * (ROAD_HALF + 1.2), f.y + 5.4, f.z + f.rz * side * (ROAD_HALF + 1.2)));
}

// Arbres noueux et moussus de la vieille forêt.
function oldForest(B, u0, u1, r) {
  const L = B.track.length;
  for (let s = u0 * L; s < Math.min(u1, 1.05) * L; s += 6) {
    for (const side of [-1, 1]) {
      const f = B.frame(s + r() * 4, side * (ROAD_HALF + 5 + r() * 45));
      if (!B.freeSpot(f.x, f.z, 6)) continue;
      const y = B.heightAt(f.x, f.z);
      const lean = (r() - 0.5) * 0.5;
      const h = 10 + r() * 7;
      const parts = [limb(V(0, -0.5, 0), V(lean * 4, h * 0.6, lean * 2), 1.4, 0.8, '#4c3d2c', 8), limb(V(lean * 4, h * 0.6, lean * 2), V(-lean * 3, h, 1), 0.8, 0.4, '#4c3d2c', 7)];
      for (let k = 0; k < 4; k++) parts.push(limb(V(lean * 4, h * 0.5, lean * 2), V(Math.cos(k * 1.6) * 5, h * (0.7 + r() * 0.2), Math.sin(k * 1.6) * 5), 0.4, 0.15, '#4c3d2c', 5));
      for (let k = 0; k < 5; k++) parts.push(ball(2.6 + r() * 1.5, ['#2f4a26', '#3b5a2c', '#2a3f22'][k % 3], Math.cos(k * 1.3) * 3.5, h * (0.75 + r() * 0.25), Math.sin(k * 1.3) * 3.5, 1, 0.7, 1, 1));
      for (let k = 0; k < 3; k++) parts.push(limb(V(0, 0.4, 0), V(Math.cos(k * 2.1) * 2.6, -0.4, Math.sin(k * 2.1) * 2.6), 0.5, 0.2, '#4c3d2c', 5));
      B.solid.push(...group(parts, f.x, y, f.z, r() * 6, 0.9 + r() * 0.5));
      B.reserve(f.x, f.z, 4);
    }
  }
}

// Château aux quatre tours rondes et son donjon, sur une butte au loin, fanions au vent.
function castle(B, p) {
  const y = B.heightAt(p.x, p.z);
  const st = '#a39d92';
  const parts = [];
  const S = 46;
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push(cyl(8, 9, 34, st, a * S, -2, b * S, 14), cone(9.5, 12, '#5d4a7a', a * S, 32, b * S, 14));
  }
  for (const [x, z, w, d] of [[0, -S, S * 2, 5], [0, S, S * 2, 5], [-S, 0, 5, S * 2], [S, 0, 5, S * 2]]) {
    parts.push(box(w, 22, d, st, x, -2, z));
    for (let k = -8; k <= 8; k++) parts.push(box(w > d ? 3 : 5.6, 2.6, w > d ? 5.6 : 3, st, x + (w > d ? k * 5.4 : 0), 20, z + (w > d ? 0 : k * 5.4)));
  }
  parts.push(box(30, 52, 30, '#b3ada2', 0, -2, 0), gable(32, 32, 12, '#5d4a7a').translate(0, 50, 0));
  B.solid.push(...group(parts, p.x, y, p.z, 0.3));
  for (let k = 0; k < 3; k++) B.glow.push(put(box(2, 3.4, 0.4, '#ffd27a', 0, 0, 0), p.x + (k - 1) * 8, y + 30, p.z + 15.3, 0.3));
}

// Chevaux qui paissent.
function horses(B, p, r) {
  for (let k = 0; k < 9; k++) {
    const x = p.x + (r() - 0.5) * 60;
    const z = p.z + (r() - 0.5) * 60;
    const y = B.heightAt(x, z);
    const col = ['#6b4128', '#3d2a1e', '#e8e2d6', '#8a5a34', '#5a4a3e'][Math.floor(r() * 5)];
    const graze = r() < 0.6;
    const head = graze ? V(1.9, 0.6, 0) : V(1.8, 2.5, 0);
    const parts = [
      ball(0.8, col, 0, 1.6, 0, 1.6, 0.75, 0.6, 1),
      limb(V(1, 1.8, 0), head, 0.32, 0.22, col),
      ball(0.32, col, head.x + 0.25, head.y - 0.05, 0, 1.6, 0.8, 0.8, 0),
      limb(V(-1.1, 1.6, 0), V(-1.5, 0.6, 0), 0.12, 0.08, '#2a2018'),
    ];
    for (const [lx, lz] of [[-0.9, -0.3], [-0.9, 0.3], [0.9, -0.3], [0.9, 0.3]]) parts.push(limb(V(lx, 1.3, lz), V(lx, 0, lz), 0.13, 0.1, col));
    B.solid.push(...group(parts, x, y, z, r() * 6));
  }
}

// Fort du défilé : combe entre deux falaises, rempart en travers et tour ronde.
function canyonFort(B, p, yawFace) {
  const y = B.heightAt(p.x, p.z);
  const parts = [];
  for (const side of [-1, 1]) for (let k = 0; k < 6; k++) parts.push(rock(22 + k * 2, '#6f6a62', k + side * 7, 1.8).translate(side * (42 + k * 8), 18 + k * 5, -k * 26));
  for (let k = -4; k <= 4; k++) parts.push(box(10.5, 12, 6, '#8d877c', k * 9.5, -1, -40 - Math.abs(k) * 1.5));
  for (let k = -9; k <= 9; k++) parts.push(box(2, 1.8, 6.4, '#8d877c', k * 4.6, 11, -40 - Math.abs(k * 0.5) * 1.5));
  parts.push(cyl(9, 11, 32, '#99938a', 30, 0, -54, 14), cone(10, 9, '#5e4636', 30, 32, -54, 14), box(24, 22, 18, '#8f897e', 18, 0, -62));
  B.solid.push(...group(parts, p.x, y - 2, p.z, yawFace));
  B.glow.push(put(ball(0.8, '#ffb35c', 0, 0, 0, 1, 1, 1, 0), p.x - Math.sin(yawFace) * 54 + Math.cos(yawFace) * 30, y + 26, p.z - Math.cos(yawFace) * 54 - Math.sin(yawFace) * 30));
}

// Village sur la colline : palissade, maisons sur la pente et grande halle de bois au sommet.
function hillHall(B, p, yawFace, r) {
  const top = B.heightAt(p.x, p.z);
  const parts = [];
  for (let k = 0; k < 70; k++) {
    const a = (k / 70) * Math.PI * 2;
    const x = p.x + Math.cos(a) * 72;
    const z = p.z + Math.sin(a) * 72;
    parts.push(put(cone(0.5, 4.4, '#6e5236', 0, 0, 0, 5), x, B.heightAt(x, z) - 0.4, z));
  }
  for (let k = 0; k < 16; k++) {
    const a = r() * Math.PI * 2;
    const d = 30 + r() * 30;
    const x = p.x + Math.cos(a) * d;
    const z = p.z + Math.sin(a) * d;
    parts.push(...group([box(7, 3, 5, '#a58a62', 0, -0.5, 0), gable(8, 6.4, 3.4, '#8a6a3a').translate(0, 2.5, 0)], x, B.heightAt(x, z), z, a));
  }
  const hall = [
    box(40, 1.6, 18, '#8e877a', 0, -0.8, 0),
    box(34, 7, 14, '#a0784c', 0, 0.8, 0),
    gable(38, 17, 9, '#6f4f2e').translate(0, 7.6, 0),
    box(5, 5, 0.4, '#5a3a20', 0, 0.8, 7.1),
  ];
  for (let k = -5; k <= 5; k++) hall.push(cyl(0.35, 0.4, 7, '#8a6438', k * 3.2, 0.8, 8.6, 8));
  parts.push(...group(hall, p.x, top, p.z, yawFace + Math.PI / 2));
  B.solid.push(...parts);
  for (let k = 0; k < 4; k++) B.glow.push(put(ball(0.5, '#ffbf6a', 0, 0, 0, 1, 1, 1, 0), p.x + (k - 1.5) * 6, top + 4, p.z));
  B.smoke.push([p.x + 20, top + 4, p.z + 18, 1.2]);
}

// Fanion rayé au bord de la route ; il flotte au vent.
function pennant(B, s, side, dist) {
  const f = B.frame(s, side * (ROAD_HALF + dist * 0.4));
  const y = B.heightAt(f.x, f.z);
  B.solid.push(put(cyl(0.12, 0.14, 7, '#6e5236', 0, 0, 0, 6), f.x, y - 0.2, f.z));
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.2, 4, 1).translate(0.8, 0, 0), B.bannerMat);
  cloth.position.set(f.x, y + 5, f.z);
  B.add(cloth);
  B.anim.push((dt, t) => (cloth.rotation.y = Math.atan2(f.tx, f.tz) + Math.sin(t * 1.3 + s) * 0.35));
}

// Belvédère de pierre au sommet de la butte.
function belvedere(B, p, yawFace) {
  const top = B.heightAt(p.x, p.z);
  B.solid.push(...group([
    box(10, 1, 10, '#a8a296', 0, -0.6, 0),
    ...[[-4, -4], [4, -4], [-4, 4], [4, 4]].map(([a, b]) => cyl(0.6, 0.7, 7, '#b5afa2', a, 0, b, 8)),
    box(10, 1, 10, '#a8a296', 0, 7, 0),
    cone(7.4, 3, '#7a6a5a', 0, 8, 0, 4),
  ], p.x, top, p.z, yawFace));
}

// Grandes chutes : large nappe d'eau qui tombe d'une falaise au bout du lac.
function bigFalls(B, p, yawFace) {
  const y = B.lake?.y ?? B.heightAt(p.x, p.z);
  const cliff = [];
  for (let k = -3; k <= 3; k++) cliff.push(rock(16, '#76716a', k + 20, 2).translate(k * 22, 14, -14));
  B.solid.push(...group(cliff, p.x, y - 6, p.z, yawFace));
  const sheet = new THREE.PlaneGeometry(70, 34, 1, 8).translate(0, 17, 0);
  const mesh = new THREE.Mesh(sheet, B.fallMat);
  mesh.position.set(p.x, y - 0.5, p.z);
  mesh.rotation.y = yawFace;
  B.add(mesh);
  for (let k = 0; k < 8; k++) B.smoke.push([p.x + Math.cos(yawFace) * (k - 3.5) * 9, y + 1, p.z - Math.sin(yawFace) * (k - 3.5) * 9, 3.5, '#f2f6f8']);
}

// Rochers gris anguleux.
function crags(B, u0, u1, r) {
  const L = B.track.length;
  for (let s = u0 * L; s < u1 * L; s += 7) {
    for (const side of [-1, 1]) {
      if (r() < 0.35) continue;
      const f = B.frame(s, side * (ROAD_HALF + 6 + r() * 40));
      const sc = 2 + r() * 5;
      B.solid.push(put(rock(sc, '#7a746a', Math.floor(r() * 99), 1.3), f.x, B.heightAt(f.x, f.z) + sc * 0.2, f.z, r() * 6));
    }
  }
}

// Marais : mares sombres, roseaux, lucioles au ras de l'eau.
function marsh(B, u0, u1, r) {
  const L = B.track.length;
  const pools = [];
  for (let s = u0 * L; s < u1 * L; s += 16) {
    for (const side of [-1, 1]) {
      const f = B.frame(s + r() * 8, side * (ROAD_HALF + 6 + r() * 30));
      const rad = 4 + r() * 7;
      const y = B.heightAt(f.x, f.z);
      pools.push(put(new THREE.CircleGeometry(rad, 14).rotateX(-Math.PI / 2), f.x, y + 0.12, f.z));
      for (let k = 0; k < 6; k++) B.solid.push(put(cone(0.08, 1.6 + r(), '#6a6a3a', 0, 0, 0, 4), f.x + (r() - 0.5) * rad * 2, y, f.z + (r() - 0.5) * rad * 2));
      if (r() < 0.6) {
        const light = put(ball(0.18, '#ffe27a', 0, 0, 0, 1, 1, 1, 0), f.x + (r() - 0.5) * rad, y + 0.5, f.z + (r() - 0.5) * rad);
        B.wisps.push(light);
      }
    }
  }
  if (pools.length) {
    const g = mergeGeometries(pools);
    B.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#3c4a3a', transparent: true, opacity: 0.85 })));
  }
  // Piquets du chemin de planches.
  for (let s = u0 * L; s < u1 * L; s += 3) {
    for (const side of [-1, 1]) {
      const f = B.frame(s, side * (ROAD_HALF + 0.2));
      B.solid.push(put(box(0.18, 1.6, 0.18, '#4a3a28', 0, 0, 0), f.x, f.y - 1.2, f.z));
    }
  }
}

// La grande muraille : rempart de pierre entre deux falaises, tours crénelées, portes de bois.
function greatWall(B, p, yawFace) {
  const y = B.heightAt(p.x, p.z);
  const st = '#8e877c';
  const parts = [box(150, 30, 14, st, 0, -4, 0), box(26, 22, 3, '#6a4a2c', 0, -4, 7.6), box(0.6, 22, 3.4, '#3d2c1e', 0, -4, 7.8)];
  for (let k = -12; k <= 12; k++) parts.push(box(3, 3, 14.4, st, k * 6, 26, 0));
  for (const sx of [-1, 1]) {
    parts.push(rock(50, '#77726a', sx * 3, 1.6).translate(sx * 115, 26, -10));
    parts.push(cyl(11, 12, 48, st, sx * 26, -4, 6, 14));
    for (let k = 0; k < 10; k++) parts.push(box(3, 3, 3, st, sx * 26 + Math.cos(k * 0.63) * 11, 44, 6 + Math.sin(k * 0.63) * 11));
  }
  B.solid.push(...group(parts, p.x, y - 2, p.z, yawFace));
}

// Ruines des arches : arches brisées par-dessus la route, colonnes et murs effondrés.
function ruins(B, s0, r) {
  const parts = [];
  for (const ds of [0, 55]) {
    const f = B.frame(s0 + ds, 0);
    const yaw = Math.atan2(f.tx, f.tz);
    const arch = [];
    for (const side of [-1, 1]) arch.push(box(2.6, 11, 3, '#c9c2b2', side * (ROAD_HALF + 2.2), 0, 0));
    for (let k = 0; k <= 10; k++) {
      if (ds && k > 6) continue; // la seconde arche est à moitié écroulée
      const a = Math.PI * (k / 10);
      arch.push(box(2.2, 1.4, 3, '#c9c2b2', -Math.cos(a) * (ROAD_HALF + 2.2), 10.5 + Math.sin(a) * 4.5, 0));
    }
    parts.push(...group(arch, f.x, f.y - 0.2, f.z, yaw));
  }
  for (let k = 0; k < 26; k++) {
    const side = k % 2 ? 1 : -1;
    const f = B.frame(s0 - 40 + r() * 140, side * (ROAD_HALF + 6 + r() * 40));
    const y = B.heightAt(f.x, f.z);
    if (r() < 0.5) parts.push(put(cyl(0.9, 1, 3 + r() * 10, '#cfc8b8', 0, 0, 0, 10), f.x, y - 0.3, f.z));
    else parts.push(put(box(4 + r() * 10, 2 + r() * 7, 1.6, '#bdb5a4', 0, 0, 0), f.x, y - 0.5, f.z, r() * 3));
    parts.push(put(rock(0.8 + r(), '#b3ab9a', k), f.x + 3, y, f.z + 2));
  }
  B.solid.push(...parts);
}

// Citadelle du Rocher : château fort perché sur un éperon, au loin.
function rockCastle(B, p, yawFace) {
  bigMountain(B, p.x - Math.sin(yawFace) * 260, p.z - Math.cos(yawFace) * 260, { r: 420, h: 480, seed: 21, snow: 0.74, rockCol: '#7d7a73', lowCol: '#5b6a4a' });
  const base = B.track.minY - 20;
  const parts = [rock(90, '#7a756c', 8, 1.4).translate(0, 50, 0)];
  parts.push(box(90, 40, 60, '#c9c3b6', 0, 110, 0), box(40, 50, 40, '#d6d0c4', 10, 150, 0));
  for (const [a, b] of [[-45, -30], [45, -30], [-45, 30], [45, 30]]) parts.push(cyl(9, 10, 60, '#d0cabe', a, 100, b, 12), cone(11, 18, '#5a6a8a', a, 160, b, 12));
  B.solid.push(...group(parts, p.x, base, p.z, yawFace));
}

// Champ de fumerolles : trous qui rougeoient et fument, rochers de basalte.
function fumaroles(B, u0, u1, r) {
  const L = B.track.length;
  for (let s = u0 * L; s < u1 * L; s += 26) {
    const side = r() < 0.5 ? -1 : 1;
    const f = B.frame(s, side * (ROAD_HALF + 14 + r() * 60));
    const y = B.heightAt(f.x, f.z);
    B.glow.push(put(new THREE.CircleGeometry(2 + r() * 2, 12).rotateX(-Math.PI / 2), f.x, y + 0.15, f.z));
    B.smoke.push([f.x, y + 0.5, f.z, 2.2, '#bdb3a6']);
    for (let k = 0; k < 3; k++) B.solid.push(put(rock(1.5 + r() * 3, '#3d3632', Math.floor(r() * 99), 1.6), f.x + (r() - 0.5) * 16, y, f.z + (r() - 0.5) * 16, r() * 6));
  }
}

// Aiguilles de basalte noir, brillantes, au bord des lacets.
function spires(B, u0, u1, r) {
  const L = B.track.length;
  for (let s = u0 * L; s < u1 * L; s += 18) {
    const side = r() < 0.5 ? -1 : 1;
    const f = B.frame(s, side * (ROAD_HALF + 8 + r() * 40));
    const y = B.heightAt(f.x, f.z);
    const parts = [];
    for (let k = 0; k < 4; k++) parts.push(cone(1 + r() * 1.4, 5 + r() * 9, '#26222a', (r() - 0.5) * 6, -0.5, (r() - 0.5) * 6, 5));
    B.solid.push(...group(parts, f.x, y, f.z, r() * 6));
  }
}

// Le volcan, après l'arrivée : cône de cendres, coulées de lave, panache de fumée.
function volcano(B) {
  // Au-delà de l'arrivée, dans l'axe de la dernière ligne droite si le cône n'y recouvre pas la route (sinon on
  // tourne peu à peu la direction jusqu'à trouver la place : les lacets de la fin reviennent sur leurs pas).
  const tr = B.track;
  const end = B.frame(tr.length, 0);
  const R = 700;
  const D = 820;
  const clear = (x, z) => {
    for (let i = 0; i <= tr.count; i += 4) if (Math.hypot(tr.x[i] - x, tr.z[i] - z) < R * 1.1 && i * tr.step < tr.s0 + tr.length) return false;
    return true;
  };
  const a0 = Math.atan2(end.tz, end.tx);
  let cx = end.x + end.tx * D;
  let cz = end.z + end.tz * D;
  for (let k = 0; k <= 12; k++) {
    const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.26;
    const x = end.x + Math.cos(a) * D;
    const z = end.z + Math.sin(a) * D;
    if (clear(x, z)) {
      cx = x;
      cz = z;
      break;
    }
  }
  const base = end.y - 12;
  const g = mountain({ r: R, h: 520, seed: 33, snow: 2, rockCol: '#3a3230', lowCol: '#2c2624', crater: 0.08, seg: 64, rings: 26 });
  g.translate(cx, base, cz);
  B.add(new THREE.Mesh(g, B.farMat));
  // Coulées de lave : rubans du cratère vers le pied.
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05 + 2.4;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = 0.08 + (i / 12) * 0.8;
      const ar = a + Math.sin(i * 0.8 + k) * 0.06;
      pts.push(V(cx + Math.cos(ar) * 700 * t, base + 520 * Math.pow(1 - t, 1.25) * 0.93 + 2, cz + Math.sin(ar) * 700 * t));
    }
    B.glow.push(tintNoise(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 3 + k * 0.6, 5, false), '#ff5a14', 0.25, 0.05));
  }
  B.glow.push(put(ball(30, '#ff6a1a', 0, 0, 0, 1, 0.3, 1, 1), cx, base + 482, cz));
  for (let k = 0; k < 10; k++) B.smoke.push([cx + (hash(k, 1) - 0.5) * 60, base + 500 + k * 40, cz + (hash(k, 2) - 0.5) * 60, 40 + k * 10, '#2b2422']);
}

const DOORS = ['#2f6b3a', '#d1a43a', '#2c5f9e', '#a8322e', '#3e7d6f'];

// Maison nichée dans une colline au toit d'herbe : façade de pierre, porte en bois, fenêtres à volets.
function hillHouse(B, p, yawFace, r) {
  const { x, z } = p;
  const dx = Math.sin(yawFace);
  const dz = Math.cos(yawFace);
  // Façade à mi-pente, tournée vers la route.
  const fx = x + dx * 7.2;
  const fz = z + dz * 7.2;
  const y = B.heightAt(fx, fz);
  const door = DOORS[Math.floor(r() * DOORS.length)];
  const parts = [
    box(7, 3.2, 0.8, '#8a7a5c', 0, -0.4, -0.3), // mur de pierre
    box(7.6, 0.35, 1.2, '#6e5a40', 0, 2.8, -0.1), // linteau de bois
    box(1.3, 2.1, 0.25, door, 0, 0, 0.15),
    box(1.5, 0.15, 0.3, '#5a4630', 0, 2.1, 0.15),
    ball(0.07, '#d9c27a', 0.4, 1.05, 0.32, 1, 1, 1, 0),
    box(0.06, 2.0, 0.3, '#3d2c1e', 0, 0, 0.16),
    box(1, 0.9, 0.2, '#ffe2a0', -2.2, 1.1, 0.1), box(1, 0.9, 0.2, '#ffe2a0', 2.2, 1.1, 0.1),
    box(0.4, 1, 0.12, door, -2.95, 1.05, 0.2), box(0.4, 1, 0.12, door, -1.45, 1.05, 0.2),
    box(0.4, 1, 0.12, door, 1.45, 1.05, 0.2), box(0.4, 1, 0.12, door, 2.95, 1.05, 0.2),
    box(1.2, 0.08, 4.5, '#b6a586', 0, 0, 2.6), // allée
  ];
  // Clôture basse et fleurs devant.
  for (let k = -3; k <= 3; k++) if (k !== 0) parts.push(box(0.12, 0.8, 0.12, '#f1ede2', k * 1.2, 0, 5.8));
  parts.push(box(7.4, 0.08, 0.06, '#f1ede2', 0, 0.62, 5.8), box(7.4, 0.08, 0.06, '#f1ede2', 0, 0.32, 5.8));
  for (let k = 0; k < 10; k++) parts.push(ball(0.28, ['#e05c8a', '#f2d13a', '#8f6ce0', '#ef7a3a'][k % 4], -3.2 + k * 0.7, 0.35, 4.9 + (k % 2) * 0.3, 1, 0.7, 1, 0));
  B.solid.push(...group(parts, fx, y - 0.25, fz, yawFace));
  // Cheminée au sommet de la colline.
  const top = B.heightAt(x, z);
  B.solid.push(...group([cyl(0.45, 0.55, 1.6, '#8c7f6a', 0, 0, 0, 8), cyl(0.5, 0.5, 0.2, '#6e624f', 0, 1.6, 0, 8)], x - dx * 1.5, top - 0.3, z - dz * 1.5));
  B.smoke.push([x - dx * 1.5, top + 1.6, z - dz * 1.5, 0.6]);
  // Lanterne près de la porte.
  B.glow.push(put(ball(0.18, '#ffd27a', 0, 0, 0, 1, 1, 1, 0), fx + Math.cos(yawFace) * 1.2, y + 2.4, fz - Math.sin(yawFace) * 1.2));
}

// Bouleau doré : tronc blanc tacheté, houppier jaune d'or étagé.
function goldTree(B, x, y, z, sc, r) {
  const h = 22 + r() * 10;
  const parts = [cyl(0.6, 1.1, h, '#e8e4da', 0, -0.5, 0, 8)];
  for (let k = 0; k < 5; k++) parts.push(box(1.3, 0.25, 1.3, '#3d3a36', 0, 2 + k * 3.7 + r(), 0).rotateY(r() * 3));
  for (let k = 0; k < 4; k++) {
    const yy = h * (0.55 + k * 0.14);
    const rr = 5.5 - k * 1.1;
    for (let b = 0; b < 4; b++) {
      const a = b * 1.57 + k * 0.6 + r();
      parts.push(ball(rr * 0.75, ['#e3b52f', '#efc94a', '#d99a2a', '#c9c24a'][(b + k) % 4], Math.cos(a) * rr * 0.7, yy, Math.sin(a) * rr * 0.7, 1, 0.6, 1, 1));
    }
  }
  B.solid.push(...group(parts, x, y - 0.4, z, r() * 6, sc));
}

// Forêt dorée : bouleaux de part et d'autre de la route.
function goldForest(B, u0, u1, r) {
  const L = B.track.length;
  for (let s = u0 * L; s < u1 * L; s += 9) {
    for (const side of [-1, 1]) {
      const dist = ROAD_HALF + 9 + r() * 55;
      const f = B.frame(s + r() * 6, side * dist);
      if (!B.freeSpot(f.x, f.z, 8)) continue;
      goldTree(B, f.x, B.heightAt(f.x, f.z), f.z, 0.8 + r() * 0.5, r);
      B.reserve(f.x, f.z, 6);
    }
  }
}

// Cabane perchée : plateforme autour du tronc, petite cabane au toit pointu, échelle de corde, lanternes.
function treeHouse(B, p) {
  const y = B.heightAt(p.x, p.z);
  goldTree(B, p.x, y, p.z, 1.15, rng(7));
  const parts = [
    cyl(5, 5, 0.4, '#8a6a46', 0, 12, 0, 14),
    box(4, 3, 3.4, '#a07a52', 1.5, 12.4, 0),
    gable(4.6, 4, 2, '#5f7a3a').translate(1.5, 15.4, 0),
    box(1, 1.8, 0.1, '#5a3a22', 1.5, 12.4, 1.75),
  ];
  for (let k = 0; k < 16; k++) parts.push(box(0.1, 0.8, 0.1, '#8a6a46', Math.cos(k * 0.39) * 4.9, 12.4, Math.sin(k * 0.39) * 4.9));
  for (let k = 0; k < 10; k++) parts.push(box(0.9, 0.08, 0.08, '#c8b08a', -1.2, 1 + k * 1.15, 4.9));
  parts.push(box(0.06, 12, 0.06, '#c8b08a', -1.6, 0, 4.9), box(0.06, 12, 0.06, '#c8b08a', -0.8, 0, 4.9));
  B.solid.push(...group(parts, p.x, y, p.z));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    B.glow.push(put(ball(0.3, '#ffd88a', 0, 0, 0, 1, 1.3, 1, 0), p.x + Math.cos(a) * 5, y + 13.6, p.z + Math.sin(a) * 5));
  }
}

// Les deux géants du lac : gardiens de pierre debout, les mains posées sur une lance plantée devant eux.
function giants(B, s, side, dist) {
  const lake = B.lake;
  for (const k of [0, 1]) {
    const lat = k ? dist + 190 : dist;
    const f = B.frame(s, side * lat);
    const yaw = Math.atan2(-f.tx, -f.tz); // face au cycliste qui arrive
    const base = k ? (lake?.y ?? f.y) - 2 : B.heightAt(f.x, f.z) - 1;
    const st = '#9a958a';
    const parts = [
      box(14, 10, 12, '#7d786d', 0, -6, 0),
      cyl(4.6, 6.8, 26, st, 0, 4, 0, 10), // robe
      ball(5, st, 0, 31, 0, 1.25, 0.9, 1, 1), // épaules
      ball(2.6, st, 0, 37.5, 0.4, 1, 1.1, 1, 1), // tête
      cyl(2.9, 2.7, 1.6, '#8a857a', 0, 38.4, 0.4, 12), // bandeau de pierre
      limb(V(4.6, 32, 0), V(2, 25, 5.5), 1.5, 1.2, st), limb(V(-4.6, 32, 0), V(-2, 27, 5.5), 1.5, 1.2, st), // bras vers la lance
      ball(1.3, st, 1.4, 25, 5.8, 1, 1, 1, 0), ball(1.3, st, -1.4, 27, 5.8, 1, 1, 1, 0), // mains
      cyl(0.5, 0.5, 52, '#86817a', 0, -4, 6.2, 8), cone(1.4, 5, '#86817a', 0, 48, 6.2, 4), // lance
    ];
    B.solid.push(...group(parts, f.x, base, f.z, yaw + (k ? 0.12 : -0.12)));
  }
}

// Bornes de départ et d'arrivée de la zone : pierres levées avec une lanterne.
function milestones(B) {
  for (const s of [0, B.track.length]) {
    for (const side of [-1, 1]) {
      const f = B.frame(s, side * (ROAD_HALF + 1.6));
      const y = B.heightAt(f.x, f.z);
      B.solid.push(...group([box(0.9, 2.6, 0.6, '#9a9384', 0, -0.3, 0), cone(0.5, 0.6, '#9a9384', 0, 2.3, 0, 4)], f.x, y, f.z, Math.atan2(f.tx, f.tz)));
      B.glow.push(put(ball(0.22, '#ffd58a', 0, 0, 0, 1, 1.3, 1, 0), f.x, y + 3.1, f.z));
    }
  }
}

// Fumées : sphères sombres ou claires qui montent et se dilatent en boucle (un seul maillage instancié).
function buildSmoke(B) {
  if (!B.smoke.length) return;
  const PER = 5;
  const n = B.smoke.length * PER;
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.32, depthWrite: false });
  const mesh = new THREE.InstancedMesh(indexify(new THREE.IcosahedronGeometry(1, 1)), mat, n);
  const col = new THREE.Color();
  B.smoke.forEach(([, , , , c], i) => {
    for (let k = 0; k < PER; k++) mesh.setColorAt(i * PER + k, col.set(c || '#cfcac2'));
  });
  mesh.frustumCulled = false;
  B.add(mesh);
  B.anim.push((dt, t) => {
    B.smoke.forEach(([x, y, z, sc], i) => {
      for (let k = 0; k < PER; k++) {
        const ph = (t * 0.12 + k / PER + i * 0.37) % 1;
        const r = sc * (0.6 + ph * 2.2);
        tmpM.compose(tmpV.set(x + Math.sin(i + ph * 3) * sc * ph, y + ph * sc * 9, z + Math.cos(i * 2 + ph * 2) * sc * ph), tmpQ.identity(), tmpS.setScalar(r * (1 - ph * 0.3) * smoothstep(0, 0.15, ph)));
        mesh.setMatrixAt(i * PER + k, tmpM);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
}

// --- Construction de l'étape ---
// ctx (scenery.js / track.js) : { track, heightAt, reserve, free?, lake, maps?, mood?, shared?, cast }
// opts : { detailed, quality }. Renvoie la fonction d'animation (dt, t).
export function buildBalade(root, ctx, { detailed = true, quality = 'high' } = {}) {
  const track = ctx.track;
  const course = track.course;
  const r = rng(course.index * 97 + 13);
  const reserved = [];
  const fallTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#cfe4ee';
    g.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(255,255,255,${0.3 + hash(i, 1) * 0.6})`;
      g.fillRect(hash(i, 2) * 64, hash(i, 3) * 256, 1 + hash(i, 4) * 3, 10 + hash(i, 5) * 40);
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const B = {
    ctx,
    track,
    detailed,
    cast: !!ctx.cast,
    lake: ctx.lake,
    heightAt: ctx.heightAt,
    frame: (s, lat) => track.frame(s, lat, {}),
    solid: [],
    glow: [],
    wisps: [],
    smoke: [],
    anim: [],
    reserve: (x, z, rad) => {
      reserved.push([x, z, rad]);
      ctx.reserve?.(x, z, rad);
    },
    freeSpot: (x, z, rad) => !reserved.some(([rx, rz, rr]) => (x - rx) ** 2 + (z - rz) ** 2 < (rr + rad) ** 2) && track.nearest(x, z, 6).dist > ROAD_HALF + 4,
    add: (o) => root.add(o),
    solidMat: detailed
      ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 })
      : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    farMat: detailed
      ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: false })
      : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    glowMat: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    fallMat: new THREE.MeshBasicMaterial({ map: fallTex, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false }),
    bannerMat: (() => {
      const cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 128;
      const g = cv.getContext('2d');
      for (let k = 0; k < 8; k++) {
        g.fillStyle = k % 2 ? '#f2c94c' : '#c0392b';
        g.fillRect(0, k * 16, 64, 16);
      }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.9 });
    })(),
  };
  const L = track.length;
  const mods = ctx.mods;
  for (const [kind, u, side, dist, opt = {}] of course.sights || []) {
    const s = u * L;
    const f = track.frame(s, side * dist, {});
    const yawFace = Math.atan2(-side * f.rx, -side * f.rz); // façade (+Z local) tournée vers la route
    const p = { x: f.x, z: f.z };
    switch (kind) {
      case 'hillhouse': hillHouse(B, p, yawFace, r); B.reserve(p.x, p.z, 16); break;
      case 'bighillhouse': bigHillHouse(B, p, yawFace, r); B.reserve(p.x, p.z, 46); break;
      case 'bigtree': bigTree(B, p, yawFace, r); B.reserve(p.x, p.z, 20); break;
      case 'mill': mill(B, p, yawFace); B.reserve(p.x, p.z, 10); break;
      case 'bridge': bridge(B, s, mods.channels.find((c) => !c.ford)); break;
      case 'ford': ford(B, s, mods.channels.find((c) => c.ford)); break;
      case 'ferry': ferry(B, mods.channels.find((c) => !c.ford)); break;
      case 'villagegate': villageGate(B, s); break;
      case 'timberhouse': timberHouse(B, p.x, B.heightAt(p.x, p.z), p.z, yawFace, r); B.reserve(p.x, p.z, 9); break;
      case 'inn': timberHouse(B, p.x, B.heightAt(p.x, p.z), p.z, yawFace, r, true); B.reserve(p.x, p.z, 11); break;
      case 'ruinedtower': ruinedTower(B, p); B.reserve(p.x, p.z, 40); break;
      case 'standingstones': standingStones(B, s, side, dist); { const g = track.frame(s, side * dist, {}); B.reserve(g.x, g.z, 14); } break;
      case 'villa': villa(B, p.x, B.heightAt(p.x, p.z), p.z, yawFace, r); B.reserve(p.x, p.z, 12); break;
      case 'bigvilla': villa(B, p.x, B.heightAt(p.x, p.z), p.z, yawFace, r, true); B.reserve(p.x, p.z, 16); break;
      case 'waterfall': waterfall(B, p, yawFace, 46, 9); B.reserve(p.x, p.z, 14); break;
      case 'holly': holly(B, s, side, dist, r); break;
      case 'ruin': ruin(B, p, yawFace); B.reserve(p.x, p.z, 18); break;
      case 'peak': bigMountain(B, p.x, p.z, { r: 620, h: 720, seed: 5, snow: 0.45 }); break;
      case 'minegate': mineGate(B); break;
      case 'lakeserpent': lakeSerpent(B, ctx.lake); break;
      case 'goldforest': goldForest(B, u, opt.to, r); break;
      case 'treehouse': treeHouse(B, p); B.reserve(p.x, p.z, 8); break;
      case 'woodarch': woodArch(B, s); break;
      case 'oldforest': oldForest(B, u, opt.to, r); break;
      case 'castle': castle(B, p); B.reserve(p.x, p.z, 70); break;
      case 'horses': horses(B, p, r); break;
      case 'canyonfort': canyonFort(B, p, yawFace); B.reserve(p.x, p.z, 120); break;
      case 'hillhall': hillHall(B, p, yawFace, r); B.reserve(p.x, p.z, 100); break;
      case 'pennant': pennant(B, s, side, dist); break;
      case 'giants': giants(B, s, side, dist); break;
      case 'belvedere': belvedere(B, p, yawFace); B.reserve(p.x, p.z, 30); break;
      case 'bigfalls': bigFalls(B, p, yawFace); break;
      case 'crags': crags(B, u, opt.to, r); break;
      case 'marsh': marsh(B, u, opt.to, r); for (let ss = u * L; ss < opt.to * L; ss += 30) { const g = track.frame(ss, 0, {}); B.reserve(g.x, g.z, 60); } break;
      case 'greatwall': greatWall(B, p, yawFace); B.reserve(p.x, p.z, 150); break;
      case 'ruins': ruins(B, s, r); for (let ss = s - 40; ss < s + 100; ss += 20) { const g = track.frame(ss, 0, {}); B.reserve(g.x, g.z, 50); } break;
      case 'rockcastle': rockCastle(B, p, yawFace); break;
      case 'spires': spires(B, u, opt.to, r); break;
      case 'fumaroles': fumaroles(B, u, opt.to, r); break;
      case 'volcano': volcano(B); break;
      default: break;
    }
  }
  // Terres de feu et marais : arbres morts le long de la route.
  if (course.region === 'feu' || course.tints?.length) {
    const bare = course.region === 'feu' ? [[0, 1]] : course.tints.map(([a, b]) => [a, b]);
    for (const [a, b] of bare) {
      for (let s = a * L; s < b * L; s += 38) {
        const side = r() < 0.5 ? -1 : 1;
        const f = track.frame(s + r() * 20, side * (ROAD_HALF + 6 + r() * 30), {});
        const y = B.heightAt(f.x, f.z);
        const parts = [limb(V(0, -0.3, 0), V(0.4, 5, 0.2), 0.3, 0.12, '#3b302a', 5)];
        for (let k = 0; k < 3; k++) parts.push(limb(V(0.3, 3 + k * 0.6, 0.1), V(Math.cos(k * 2) * 2, 5 + k * 0.5, Math.sin(k * 2) * 2), 0.1, 0.04, '#3b302a', 4));
        B.solid.push(...group(parts, f.x, y, f.z, r() * 6));
      }
    }
  }
  milestones(B);
  buildSmoke(B);

  if (B.solid.length) {
    const mesh = new THREE.Mesh(mergeGeometries(B.solid.map(indexify)), B.solidMat);
    mesh.castShadow = B.cast;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  if (B.glow.length) root.add(new THREE.Mesh(mergeGeometries(B.glow.map(indexify)), B.glowMat));
  if (B.wisps.length) {
    const wmat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.8 });
    const wm = new THREE.Mesh(mergeGeometries(B.wisps), wmat);
    root.add(wm);
    B.anim.push((dt, t) => {
      wmat.opacity = 0.45 + 0.4 * Math.abs(Math.sin(t * 1.7));
      wm.position.y = Math.sin(t * 0.8) * 0.25;
    });
  }
  B.anim.push((dt) => {
    fallTex.offset.y += dt * 1.6;
  });
  let time = 0;
  return (dt) => {
    time += dt;
    for (const a of B.anim) a(dt, time);
  };
}
