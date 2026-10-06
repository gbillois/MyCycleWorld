// Rivière du mode kayak : terrain creusé par la rivière (berges de galets, falaises dans les gorges), eau qui
// descend et coule (courant, eau blanche dans les rapides), portes de slalom suspendues à un câble, arches des
// portes sprint avec leur rideau de lumière, passerelle basse de la porte glisse, ponton de départ, arche
// d'arrivée et spectateurs, rochers, forêt, ciel et montagnes.
// Graphismes détaillés : shaders du décor (terrain, eau à courant, forêt avec niveaux de détail, herbe) ;
// graphismes simples : mêmes formes, matières standard et arbres en cônes. Tout est généré (aucun fichier).
import * as THREE from 'three';
import { makeSky, disposeTree, terrainMaterial, fanGeometry, fanMaterial, mountainRingAround, fbm } from './scenery.js';
import { MOODS, applyMood, installFog, makeSkyDome, makeEnvironment as makeSkyEnvironment, noiseTexture, makeBirds } from './atmosphere.js';
import { Forest, deciduousGeometry, pineGeometry, bushGeometry, rockGeometry, windMaterial, leafAtlas, makeFieldMaps, makeGrassField, crispAlpha } from './nature.js';
import { makeWater, waterNormalTexture } from './water.js';
import { mergeGeometries, colored, paint, indexify } from './geom.js';
import { rng } from './track.js';

const C = (hex) => new THREE.Color(hex);
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Ambiance et couleurs du terrain selon la rivière.
const THEMES = {
  gorge: {
    mood: 'meadow', grass: ['#4b8a31', '#5f9b3a', '#7aa744', '#93b04f'], rock: '#a39a88', sand: '#b9b19c', dirt: '#6f6047',
    cliff: [14, 26], hills: 22, pine: 0.4, mountains: { h: [160, 260], snow: 0.7 },
    shallow: '#3f9f95', deep: '#13505a', bed: '#9a9378',
  },
  torrent: {
    mood: 'alpine', grass: ['#3a6e2a', '#4c8233', '#669340', '#819e4b'], rock: '#8d877c', sand: '#a8a497', dirt: '#5e5140',
    cliff: [18, 34], hills: 36, pine: 0.8, mountains: { h: [300, 400], snow: 0.42 },
    shallow: '#4aa7a6', deep: '#0f4a5e', bed: '#8b8a80',
  },
};

// Champ d'altitude : la rivière (lit, berges, falaises) et les collines autour. Pur calcul, réutilisé par le
// maillage du terrain, les arbres, les mâts des portes et les spectateurs.
function makeHeight(river, theme) {
  const n = river.count;
  const near = {};
  const b = river.bounds;
  const margin = 460;
  // Niveau de l'eau « vu de loin » : flouté, pour qu'il n'y ait pas de marche entre deux méandres.
  const cell = 12;
  const x0 = b.minX - margin;
  const z0 = b.minZ - margin;
  const nx = Math.ceil((b.maxX - b.minX + margin * 2) / cell) + 1;
  const nz = Math.ceil((b.maxZ - b.minZ + margin * 2) / cell) + 1;
  let g = new Float32Array(nx * nz);
  const levelAt = (x, z, out) => {
    river.nearest(x, z, out);
    const i = out.index;
    // Au-delà des deux bouts, la rivière continue tout droit (le décor ne s'arrête pas net).
    const along = (x - river.x[i]) * river.tx[i] + (z - river.z[i]) * river.tz[i];
    out.beyond = (i === 0 && along < 0) || (i === n && along > 0) ? along : 0;
    out.wy = river.y[i] - out.beyond * 0.003;
    return out;
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = levelAt(x0 + i * cell, z0 + j * cell, near).wy;
  const tmp = new Float32Array(nx * nz);
  const R = 5;
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let k = -R; k <= R; k++) s += g[j * nx + Math.min(nx - 1, Math.max(0, i + k))];
      tmp[j * nx + i] = s / (2 * R + 1);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let k = -R; k <= R; k++) s += tmp[Math.min(nz - 1, Math.max(0, j + k)) * nx + i];
      g[j * nx + i] = s / (2 * R + 1);
    }
  }
  const field = (x, z) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / cell));
    const fz = Math.min(nz - 1.001, Math.max(0, (z - z0) / cell));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = g[j * nx + i] + (g[j * nx + i + 1] - g[j * nx + i]) * u;
    const c = g[(j + 1) * nx + i] + (g[(j + 1) * nx + i + 1] - g[(j + 1) * nx + i]) * u;
    return a + (c - a) * v;
  };
  const [c0, c1] = theme.cliff;
  // out (facultatif) reçoit d (distance à la berge, < 0 dans l'eau), wy (niveau de l'eau), gorge, rapid, index.
  const height = (x, z, out = near) => {
    levelAt(x, z, out);
    const i = out.index;
    const hw = river.half[i];
    const lat = Math.abs(out.lateral);
    const d = lat - hw;
    const gorge = river.gorge[i];
    const rapid = river.rapid[i];
    out.d = d;
    out.gorge = gorge;
    out.rapid = rapid;
    let y;
    if (d < 0) {
      // Lit : plus profond au milieu, moins dans les rapides (cailloux)
      const k = lat / hw;
      const depth = lerp(2.2, 1.0, rapid) * Math.sqrt(Math.max(0, 1 - k * k));
      y = out.wy - 0.3 - depth + fbm(x * 0.15, z * 0.15, 2) * 0.25 * rapid;
    } else {
      const base = lerp(out.wy, field(x, z), smoothstep(10, 80, d));
      // Berge en pente douce (plage de galets puis prairie) ou falaise dans les gorges
      const bank = 1.3 * smoothstep(0, 5, d) + 2.8 * smoothstep(4, 34, d);
      const cliffH = lerp(c0, c1, (fbm(x * 0.006 + 3, z * 0.006, 3) + 1) / 2);
      const wall = smoothstep(0.4, 5 + 4 * (fbm(x * 0.03, z * 0.03, 2) + 1), d);
      const cliff = cliffH * wall + Math.max(0, fbm(x * 0.08, z * 0.08, 2)) * 2.5 * wall;
      const hills = (fbm(x * 0.0042, z * 0.0042, 4) * theme.hills + fbm(x * 0.017 + 11, z * 0.017 - 7, 3) * 3.5) * smoothstep(18, 150, d);
      const far = Math.max(0, d - 170) * 0.28;
      y = base - 0.3 + lerp(bank, cliff, gorge) + Math.max(-2, hills) * lerp(1, 0.6, gorge) + far;
    }
    return y;
  };
  height.extent = { x0: b.minX - margin + 40, z0: b.minZ - margin + 40, x1: b.maxX + margin - 40, z1: b.maxZ + margin - 40 };
  return height;
}

// Terrain : grille régulière (carte d'altitude pour l'eau et l'herbe), couleurs et couches dans les sommets.
function buildTerrain(river, height, theme, { quality, detailed, shared }) {
  const cell = detailed ? (quality === 'high' ? 6.5 : quality === 'medium' ? 7.5 : 10) : 11;
  const e = height.extent;
  const TW = e.x1 - e.x0;
  const TD = e.z1 - e.z0;
  const gx = Math.ceil(TW / cell);
  const gz = Math.ceil(TD / cell);
  const geo = new THREE.PlaneGeometry(TW, TD, gx, gz).rotateX(-Math.PI / 2).translate((e.x0 + e.x1) / 2, 0, (e.z0 + e.z1) / 2);
  const P = geo.attributes.position;
  const heights = new Float32Array(P.count);
  const info = new Float32Array(P.count * 3); // d, wy, gorge
  const o = {};
  for (let i = 0; i < P.count; i++) {
    const h = height(P.getX(i), P.getZ(i), o);
    P.setY(i, h);
    heights[i] = h;
    info[i * 3] = o.d;
    info[i * 3 + 1] = o.wy;
    info[i * 3 + 2] = o.gorge;
  }
  geo.computeVertexNormals();
  const N = geo.attributes.normal;
  const col = new Float32Array(P.count * 3);
  const mix = new Float32Array(P.count * 4);
  const wet = new Float32Array(P.count);
  const ground = new Uint8Array(P.count * 4);
  const G = theme.grass.map(C);
  const c = new THREE.Color();
  const pebble = C(theme.sand);
  const rockC = C(theme.rock);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i);
    const z = P.getZ(i);
    const y = P.getY(i);
    const [d, wy, gorge] = [info[i * 3], info[i * 3 + 1], info[i * 3 + 2]];
    const k = (fbm(x * 0.012, z * 0.012, 3) + 1) / 2;
    const idx = Math.min(G.length - 1.001, Math.max(0, k * (G.length - 1) * 1.15));
    c.copy(G[Math.floor(idx)]).lerp(G[Math.ceil(idx)], idx % 1).multiplyScalar(0.92 + fbm(x * 0.08, z * 0.08, 2) * 0.12);
    const above = y - wy;
    const ny = N.getY(i);
    const rock = Math.max(smoothstep(0.84, 0.62, ny), gorge * smoothstep(1.5, 6, above) * smoothstep(0.93, 0.8, ny));
    const sand = smoothstep(1.6, 0.4, above) * (1 - rock * 0.6); // galets au bord de l'eau
    const dirt = smoothstep(0.35, 0.75, fbm(x * 0.05 + 5, z * 0.05, 2) + 0.5) * 0.4 * (1 - sand);
    mix.set([rock, sand, dirt, 0], i * 4);
    wet[i] = smoothstep(0.5, -0.1, above);
    if (!detailed) {
      // Graphismes simples : couleur finale directement dans les sommets.
      c.lerp(pebble, sand).lerp(rockC, rock);
      if (above < 0) c.lerp(C('#6f7f7a'), 0.6);
    }
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    const dens = smoothstep(0.9, 2.2, above) * (1 - rock) * (1 - sand) * (d > 2 ? 1 : 0);
    ground.set([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), Math.round(dens * 255)], i * 4);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  let mesh;
  let maps = null;
  if (detailed) {
    geo.setAttribute('aMix', new THREE.BufferAttribute(mix, 4));
    geo.setAttribute('aWet', new THREE.BufferAttribute(wet, 1));
    mesh = new THREE.Mesh(geo, terrainMaterial({ rock: theme.rock, sand: theme.sand, dirt: theme.dirt }, shared, quality));
    maps = makeFieldMaps({ heights, nx: gx + 1, nz: gz + 1, x0: e.x0, z0: e.z0, cellX: TW / gx, cellZ: TD / gz, ground });
    // Pas de route ici : distance constante (loin de toute route) pour l'herbe.
    const noRoad = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat);
    noRoad.needsUpdate = true;
    maps.uniforms.uRoad.value = noRoad;
  } else {
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  }
  mesh.receiveShadow = true;
  return { mesh, maps };
}

// Eau : ruban le long de la rivière (prolongé tout droit aux deux bouts), un peu plus large que le lit.
function buildWater(river, theme, mood, { detailed, maps, shared }) {
  const ext = 420;
  const step = 2;
  const cols = 10;
  const pos = [];
  const flow = [];
  const uv = [];
  const col = [];
  const idx = [];
  const f = {};
  const n0 = Math.floor(-ext / step);
  const n1 = Math.ceil((river.length + ext) / step);
  const white = C('#e8f1f4');
  const blue = C(theme.deep).lerp(C(theme.shallow), 0.45);
  const c = new THREE.Color();
  let rows = 0;
  for (let k = n0; k <= n1; k++) {
    const s = k * step;
    const inside = Math.min(river.length, Math.max(0, s));
    river.frame(inside, 0, f);
    const beyond = s - inside;
    const cx = f.x + f.tx * beyond;
    const cz = f.z + f.tz * beyond;
    const wy = f.y - beyond * 0.003;
    const hw = river.halfWidthAt(inside) + 3.2;
    const rapid = river.rapidAt(inside);
    for (let j = 0; j <= cols; j++) {
      const lat = -hw + (2 * hw * j) / cols;
      pos.push(cx + f.rx * lat, wy, cz + f.rz * lat);
      const cur = river.currentAt(inside, lat);
      flow.push(f.tx * cur, f.tz * cur, rapid);
      uv.push(lat / 9, s / 9);
      c.copy(blue).lerp(white, rapid * (0.35 + 0.35 * Math.max(0, fbm(cx * 0.2 + lat, cz * 0.2, 2))));
      col.push(c.r, c.g, c.b);
    }
    rows++;
  }
  // Triangles tournés vers le ciel (la « droite » de la rivière est à gauche de l'écran vue d'en haut).
  for (let r = 0; r < rows - 1; r++) {
    for (let j = 0; j < cols; j++) {
      const a = r * (cols + 1) + j;
      const b = a + cols + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (detailed) {
    geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 3));
    const water = makeWater(geo, { mood, maps, waterY: 0, shared, chop: 0.17, foam: 0.55, shallow: theme.shallow, deep: theme.deep, sand: theme.bed, depthScale: 0.6, flow: true });
    water.renderOrder = 0;
    return { mesh: water, normal: null };
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const normal = waterNormalTexture().clone();
  normal.needsUpdate = true;
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.05, normalMap: normal, normalScale: new THREE.Vector2(0.45, 0.45) }));
  mesh.receiveShadow = true;
  return { mesh, normal };
}

// Planche de numéros des portes (atlas) : chiffres noirs sur fond blanc, liseré vert.
function numberAtlas(count) {
  const W = 128;
  return canvasTexture(W * count, 96, (ctx) => {
    for (let i = 0; i < count; i++) {
      const x = i * W;
      ctx.fillStyle = '#1f8f4a';
      ctx.fillRect(x, 0, W, 96);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 7, 7, W - 14, 82);
      ctx.fillStyle = '#14161c';
      ctx.font = '900 66px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x + W / 2, 52);
    }
  });
}

function bannerTexture(text, bg, fg, sub = '') {
  return canvasTexture(512, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, bg[0]);
    g.addColorStop(1, bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg;
    ctx.font = `900 ${sub ? 60 : 72}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, sub ? 50 : 68);
    if (sub) {
      ctx.font = '800 30px system-ui, sans-serif';
      ctx.fillText(sub, w / 2, 102);
    }
  });
}

// Plan texturé avec une case d'atlas (u0..u1), orienté vers l'amont (normale = -tangente).
function boardPlane(w, h, cx, cy, cz, tx, tz, u0, u1) {
  const g = new THREE.PlaneGeometry(w, h);
  g.rotateY(Math.atan2(-tx, -tz));
  g.translate(cx, cy, cz);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + (u1 - u0) * uv.getX(i));
  return g;
}

// Cylindre (rayon r) entre deux points.
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
function rod(p0, p1, r, seg = 6, rings = 1) {
  _a.set(...p0);
  _b.set(...p1);
  const len = _a.distanceTo(_b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, rings).translate(0, len / 2, 0);
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _b.clone().sub(_a).normalize());
  g.applyQuaternion(_q);
  g.translate(_a.x, _a.y, _a.z);
  return g;
}

// Fusion de plans texturés (position, normale, uv) en un seul maillage.
function mergeUv(list) {
  let n = 0;
  let ni = 0;
  for (const g of list) {
    n += g.attributes.position.count;
    ni += g.index.count;
  }
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const idx = new Uint32Array(ni);
  let o = 0;
  let io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    for (let k = 0; k < g.index.count; k++) idx[io + k] = g.index.array[k] + o;
    o += g.attributes.position.count;
    io += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

const merged = (list) => mergeGeometries(list.map((g) => indexify(g)));

// Portes de slalom : câble tendu entre deux mâts, deux fiches rayées vert et blanc, planche numérotée,
// voyant (blanc à passer, vert passée, rouge manquée).
function buildGates(river, height, group, { cast }) {
  const solids = [];
  const boards = [];
  const gates = river.gates.filter((g) => g.kind === 'normal');
  const atlas = numberAtlas(Math.max(1, gates.length));
  const lampMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), Math.max(1, gates.length));
  lampMesh.count = gates.length;
  const lampIndex = new Map();
  const f = {};
  const m4 = new THREE.Matrix4();
  const white = C('#f4f4f2');
  const green = C('#1f9a52');
  const o = {};
  gates.forEach((g, k) => {
    river.frame(g.s, 0, f);
    const wy = f.y;
    const hw = river.halfWidthAt(g.s);
    const wireY = wy + 4.6;
    const at = (lat) => [f.x + f.rx * lat, f.z + f.rz * lat];
    const [lx, lz] = at(-(hw + 2.2));
    const [rx, rz] = at(hw + 2.2);
    solids.push(colored(rod([lx, wireY, lz], [rx, wireY, rz], 0.012, 4), '#2a2c31'));
    for (const [mx, mz] of [[lx, lz], [rx, rz]]) {
      const gy = height(mx, mz, o);
      if (gy < wireY - 0.5) solids.push(colored(rod([mx, gy - 0.5, mz], [mx, wireY + 0.3, mz], 0.08, 8), '#c9cdd4'));
    }
    for (const side of [-1, 1]) {
      const [px, pz] = at(g.lateral + side * g.half);
      const pole = rod([px, wy + 0.22, pz], [px, wy + 2.62, pz], 0.042, 8, 12);
      paint(pole, (cc, x, y) => cc.copy(Math.floor((y - wy - 0.22) / 0.2) % 2 ? white : green));
      solids.push(pole);
      solids.push(colored(rod([px, wy + 2.62, pz], [px, wireY, pz], 0.006, 3), '#30333a'));
    }
    const [bx, bz] = at(g.lateral);
    boards.push(boardPlane(0.78, 0.58, bx, wy + 3.55, bz, f.tx, f.tz, k / gates.length, (k + 1) / gates.length));
    solids.push(colored(rod([bx, wy + 3.84, bz], [bx, wireY, bz], 0.006, 3), '#30333a'));
    m4.makeTranslation(bx, wy + 3.98, bz);
    lampMesh.setMatrixAt(k, m4);
    lampMesh.setColorAt(k, C('#ffffff'));
    lampIndex.set(g.id, k);
  });
  const poleMesh = new THREE.Mesh(merged(solids), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1 }));
  poleMesh.castShadow = cast;
  group.add(poleMesh);
  if (boards.length) group.add(new THREE.Mesh(mergeUv(boards), new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.6, side: THREE.DoubleSide })));
  group.add(lampMesh);
  const colors = { idle: C('#ffffff'), ok: C('#3dff7f'), miss: C('#ff3b3b') };
  return {
    setState(id, state) {
      const k = lampIndex.get(id);
      if (k === undefined) return;
      lampMesh.setColorAt(k, colors[state] || colors.idle);
      lampMesh.instanceColor.needsUpdate = true;
    },
    reset() {
      for (const k of lampIndex.values()) lampMesh.setColorAt(k, colors.idle);
      if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;
    },
  };
}

// Rideau de lumière des portes sprint : cordes lumineuses verticales qui se relèvent quand l'effort monte.
function curtainTexture() {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) {
      const g = ctx.createLinearGradient(x + 6, 0, x + 26, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + 6, 0, 20, h);
    }
    // Perles lumineuses le long des cordes
    ctx.fillStyle = 'rgba(255,255,255,1)';
    for (let x = 16; x < w; x += 32) for (let y = 6; y < h; y += 18) ctx.fillRect(x - 4, y, 8, 8);
  });
}

// Portes sprint (arche orange lumineuse et rideau) et porte glisse (passerelle basse en bois).
function buildChallenges(river, height, group, { cast, detailed }) {
  const f = {};
  const o = {};
  const solids = [];
  const glow = [];
  const banners = [];
  const curtains = new Map();
  const sprintTex = bannerTexture('PORTE SPRINT', ['#ffb21f', '#ff6a00'], '#1a1206', 'ACCÉLÈRE !');
  const glideTex = bannerTexture('BAISSE-TOI', ['#ffd23f', '#f2b705'], '#1a1406', 'ARRÊTE DE RAMER');
  const cTex = curtainTexture();
  cTex.wrapS = THREE.RepeatWrapping;
  for (const g of river.gates) {
    if (g.kind === 'normal') continue;
    river.frame(g.s, 0, f);
    const wy = f.y;
    const hw = river.halfWidthAt(g.s);
    const at = (lat) => [f.x + f.rx * lat, f.z + f.rz * lat];
    const yaw = Math.atan2(f.tx, f.tz);
    if (g.kind === 'sprint') {
      const span = hw + 1.4;
      const topY = wy + 6.6;
      for (const side of [-1, 1]) {
        const [px, pz] = at(side * span);
        const gy = Math.min(height(px, pz, o), wy + 0.2);
        solids.push(colored(new THREE.BoxGeometry(0.7, topY - gy + 0.6, 0.7).rotateY(yaw).translate(px, (topY + gy) / 2, pz), '#2a2d36'));
        const [ix, iz] = at(side * (span - 0.4));
        glow.push(new THREE.BoxGeometry(0.12, topY - wy - 0.4, 0.12).rotateY(yaw).translate(ix, (topY + wy) / 2, iz));
      }
      const beam = new THREE.BoxGeometry(span * 2 + 0.7, 1.3, 0.55).rotateY(yaw).translate(f.x, topY + 0.3, f.z);
      solids.push(colored(beam, '#2a2d36'));
      glow.push(new THREE.BoxGeometry(span * 2 - 0.4, 0.12, 0.12).rotateY(yaw).translate(f.x, topY - 0.42, f.z));
      // Banderoles avant et arrière (toute la largeur, répétées)
      const reps = Math.max(1, Math.round((span * 2) / 6));
      for (const face of [-1, 1]) {
        const pl = new THREE.PlaneGeometry(span * 2 - 0.2, 1.1);
        const uvA = pl.attributes.uv;
        for (let i = 0; i < uvA.count; i++) uvA.setX(i, uvA.getX(i) * reps);
        pl.rotateY(yaw + (face < 0 ? Math.PI : 0));
        pl.translate(f.x - f.tx * 0.29 * face * -1, topY + 0.3, f.z - f.tz * 0.29 * face * -1);
        banners.push(pl);
      }
      // Rideau : origine en haut, il se replie vers le haut (échelle verticale)
      const H = topY - 0.36 - (wy + 0.5);
      const cg = new THREE.PlaneGeometry(span * 2 - 0.8, H).translate(0, -H / 2, 0);
      const cuv = cg.attributes.uv;
      for (let i = 0; i < cuv.count; i++) cuv.setX(i, cuv.getX(i) * Math.round(span * 0.9));
      const cm = new THREE.MeshBasicMaterial({ map: cTex, color: '#ffa31f', transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const curtain = new THREE.Mesh(cg, cm);
      curtain.position.set(f.x, topY - 0.36, f.z);
      curtain.rotation.y = yaw;
      curtain.renderOrder = 4;
      group.add(curtain);
      curtains.set(g.id, curtain);
    } else {
      // Passerelle basse en bois : tablier, garde-corps, câbles vers les rives, bande jaune et noire dessous
      const span = hw + 4;
      const deckY = wy + 1.2;
      const deck = new THREE.BoxGeometry(span * 2, 0.22, 2.2).rotateY(yaw).translate(f.x, deckY + 0.11, f.z);
      solids.push(colored(deck, '#8a5d38'));
      for (let k = -span; k <= span; k += 1.1) {
        const [px, pz] = at(k);
        for (const e of [-0.95, 0.95]) {
          solids.push(colored(new THREE.BoxGeometry(0.08, 0.95, 0.08).translate(px + f.tx * e, deckY + 0.69, pz + f.tz * e), '#6e4528'));
        }
      }
      for (const e of [-0.95, 0.95]) {
        for (const yy of [0.62, 1.12]) {
          const [ax, az] = at(-span);
          const [bx, bz] = at(span);
          solids.push(colored(rod([ax + f.tx * e, deckY + yy, az + f.tz * e], [bx + f.tx * e, deckY + yy, bz + f.tz * e], 0.035, 5), '#6e4528'));
        }
      }
      // Bande de danger sous le tablier (côté amont)
      const stripes = 14;
      for (let k = 0; k < stripes; k++) {
        const lat = -span + ((k + 0.5) * span * 2) / stripes;
        const [px, pz] = at(lat);
        solids.push(colored(new THREE.BoxGeometry((span * 2) / stripes, 0.22, 0.05).rotateY(yaw).translate(px - f.tx * 1.12, deckY + 0.11, pz - f.tz * 1.12), k % 2 ? '#15161a' : '#ffd23f'));
      }
      // Piles sur les berges
      for (const side of [-1, 1]) {
        const [px, pz] = at(side * (hw + 2.5));
        const gy = height(px, pz, o);
        solids.push(colored(new THREE.BoxGeometry(0.6, Math.max(0.4, deckY - gy + 0.4), 1.8).rotateY(yaw).translate(px, (deckY + gy) / 2, pz), '#7b7468'));
      }
      // Panneau « BAISSE-TOI » au-dessus du tablier, face à l'amont
      const pl = new THREE.PlaneGeometry(4.2, 1.05).rotateY(yaw + Math.PI).translate(f.x - f.tx * 1.15, deckY + 2.35, f.z - f.tz * 1.15);
      banners.push(pl);
      pl.userData.glide = true;
      for (const side of [-1, 1]) {
        const [px, pz] = at(side * 1.9);
        solids.push(colored(new THREE.BoxGeometry(0.08, 2.0, 0.08).translate(px - f.tx * 1.15, deckY + 1.65, pz - f.tz * 1.15), '#4b3a28'));
      }
    }
  }
  if (solids.length) {
    const m = new THREE.Mesh(merged(solids), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 }));
    m.castShadow = cast;
    m.receiveShadow = detailed;
    group.add(m);
  }
  if (glow.length) group.add(new THREE.Mesh(merged(glow), new THREE.MeshBasicMaterial({ color: '#ffb84a', toneMapped: false })));
  const sprintPl = banners.filter((b) => !b.userData.glide);
  const glidePl = banners.filter((b) => b.userData.glide);
  if (sprintPl.length) {
    sprintTex.wrapS = THREE.RepeatWrapping;
    group.add(new THREE.Mesh(mergeUv(sprintPl), new THREE.MeshBasicMaterial({ map: sprintTex, toneMapped: false })));
  } else sprintTex.dispose();
  if (glidePl.length) group.add(new THREE.Mesh(mergeUv(glidePl), new THREE.MeshStandardMaterial({ map: glideTex, roughness: 0.6 })));
  else glideTex.dispose();
  if (!curtains.size) cTex.dispose();
  const tints = { charge: C('#ffa31f'), boost: C('#3dff9a'), slow: C('#ff4a3a'), done: C('#ffa31f') };
  return {
    // open : 0 (fermé) à 1 (relevé) ; mood : charge | boost | slow
    setCurtain(id, open, mood = 'charge') {
      const c = curtains.get(id);
      if (!c) return;
      c.scale.y = Math.max(0.06, 1 - open * 0.94);
      c.material.color.copy(tints[mood] || tints.charge);
      c.visible = open < 0.999;
    },
    reset() {
      for (const c of curtains.values()) {
        c.scale.y = 1;
        c.visible = true;
        c.material.color.copy(tints.charge);
      }
    },
  };
}

// Départ (ponton sur la rive gauche, arche « DÉPART ») et arrivée (arche « ARRIVÉE » et spectateurs).
function buildStartFinish(river, height, group, { cast, detailed, shared, quality }) {
  const f = {};
  const o = {};
  const solids = [];
  const banners = [];
  const startTex = bannerTexture('DÉPART', ['#2b6cff', '#1d4fc4'], '#ffffff');
  const finishTex = bannerTexture('ARRIVÉE', ['#ffffff', '#e8e8e8'], '#ff5a1f');
  for (const [s, color, key] of [[river.start, '#2b6cff', 'start'], [river.finish, '#ff5a1f', 'finish']]) {
    river.frame(s, 0, f);
    const wy = f.y;
    const hw = river.halfWidthAt(s);
    const yaw = Math.atan2(f.tx, f.tz);
    const span = hw + 1.6;
    const topY = wy + 7.5;
    for (const side of [-1, 1]) {
      const px = f.x + f.rx * side * span;
      const pz = f.z + f.rz * side * span;
      const gy = Math.min(height(px, pz, o), wy);
      solids.push(colored(new THREE.BoxGeometry(0.8, topY - gy + 0.4, 0.8).rotateY(yaw).translate(px, (topY + gy) / 2, pz), color));
    }
    solids.push(colored(new THREE.BoxGeometry(span * 2 + 0.8, 1.6, 0.5).rotateY(yaw).translate(f.x, topY, f.z), color));
    const reps = Math.max(1, Math.round((span * 2) / 6.5));
    for (const face of [0, Math.PI]) {
      const pl = new THREE.PlaneGeometry(span * 2 - 0.2, 1.35);
      const uvA = pl.attributes.uv;
      for (let i = 0; i < uvA.count; i++) uvA.setX(i, uvA.getX(i) * reps);
      pl.rotateY(yaw + face + Math.PI);
      const off = face ? 0.27 : -0.27;
      pl.translate(f.x + f.tx * off, topY, f.z + f.tz * off);
      pl.userData.key = key;
      banners.push(pl);
    }
    if (key === 'start') {
      // Ponton flottant le long de la rive gauche, avec ses bittes d'amarrage
      for (let k = -14; k <= 6; k += 2) {
        river.frame(s + k, 0, f);
        const lat = -(river.halfWidthAt(s + k) - 1.6);
        solids.push(colored(new THREE.BoxGeometry(3.4, 0.25, 2.05).rotateY(Math.atan2(f.tx, f.tz)).translate(f.x + f.rx * (lat - 0.9), f.y + 0.2, f.z + f.rz * (lat - 0.9)), k % 4 ? '#a77b4f' : '#94693f'));
        if (k % 6 === 0) solids.push(colored(new THREE.CylinderGeometry(0.1, 0.12, 0.45, 8).translate(f.x + f.rx * (lat + 0.6), f.y + 0.5, f.z + f.rz * (lat + 0.6)), '#3b3d42'));
      }
    }
  }
  const m = new THREE.Mesh(merged(solids), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
  m.castShadow = cast;
  m.receiveShadow = detailed;
  group.add(m);
  startTex.wrapS = finishTex.wrapS = THREE.RepeatWrapping;
  group.add(new THREE.Mesh(mergeUv(banners.filter((b) => b.userData.key === 'start')), new THREE.MeshStandardMaterial({ map: startTex, roughness: 0.6 })));
  group.add(new THREE.Mesh(mergeUv(banners.filter((b) => b.userData.key === 'finish')), new THREE.MeshStandardMaterial({ map: finishTex, roughness: 0.6 })));
  // Spectateurs sur les deux rives à l'arrivée (graphismes détaillés)
  if (detailed) {
    const r = rng(77);
    const fans = [];
    for (let tries = 0; tries < 900 && fans.length < (quality === 'low' ? 60 : 140); tries++) {
      const s = river.finish - 40 + r() * 60;
      const side = r() < 0.5 ? -1 : 1;
      river.frame(s, 0, f);
      const lat = side * (river.halfWidthAt(s) + 4 + r() * 9);
      const x = f.x + f.rx * lat;
      const z = f.z + f.rz * lat;
      const y = height(x, z, o);
      if (y - f.y > 6 || o.d < 3) continue;
      fans.push([x, y, z, Math.atan2(-f.rx * side, -f.rz * side), r()]);
    }
    const shirts = ['#e0384b', '#2b6cff', '#ffd23f', '#3ccf7a', '#ffffff', '#ff7aa8', '#ff5a1f'].map(C);
    const mat = fanMaterial(shared);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    [fans.filter((x) => x[4] < 0.8), fans.filter((x) => x[4] >= 0.8)].forEach((list, k) => {
      if (!list.length) return;
      const fm = new THREE.InstancedMesh(fanGeometry(k === 1), mat, list.length);
      list.forEach(([x, y, z, yaw, rk], i) => {
        fm.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y - 0.05, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), new THREE.Vector3(1, 1, 1).multiplyScalar(0.95 + rk * 0.1)));
        fm.setColorAt(i, shirts[Math.floor(rk * 977) % shirts.length]);
      });
      fm.castShadow = quality === 'high';
      group.add(fm);
    });
  }
}

// Écume en anneau autour des rochers au milieu de l'eau (étirée vers l'aval).
function foamTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h * 0.38, 6, w / 2, h * 0.5, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.0)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

// Rochers : ceux du milieu des rapides (les mêmes que la physique) et des blocs le long des berges.
function buildRocks(river, height, group, { detailed, quality, cast }) {
  const r = rng(19);
  const f = {};
  const o = {};
  const list = [];
  for (const rock of river.rocks) {
    river.frame(rock.s, rock.lateral, f);
    list.push([f.x, f.y - 0.18, f.z, rock.r * 1.05, rock.r * 0.75, rock.r * 1.15, r() * 6.28]);
  }
  const nBank = detailed ? (quality === 'high' ? 260 : quality === 'medium' ? 180 : 110) : 120;
  for (let tries = 0; tries < nBank * 8 && list.length < nBank + river.rocks.length; tries++) {
    const s = r() * river.length;
    const k = Math.round(s);
    const wild = Math.max(river.rapid[k], river.gorge[k]);
    if (r() > 0.25 + wild * 0.75) continue;
    const side = r() < 0.5 ? -1 : 1;
    river.frame(s, 0, f);
    const lat = side * (river.half[k] + (r() - 0.35) * 3.2);
    const x = f.x + f.rx * lat;
    const z = f.z + f.rz * lat;
    const y = height(x, z, o);
    const sc = 0.5 + Math.pow(r(), 2) * 1.9;
    list.push([x, Math.max(y, f.y - 0.6) - sc * 0.25, z, sc, sc * (0.6 + r() * 0.3), sc * (0.8 + r() * 0.5), r() * 6.28]);
  }
  const geo = detailed ? rockGeometry(quality === 'high' ? 2 : 1) : new THREE.IcosahedronGeometry(1, 0);
  const mat = detailed ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }) : new THREE.MeshStandardMaterial({ color: '#8f8a80', roughness: 1, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  list.forEach(([x, y, z, sx, sy, sz, rot], i) => mesh.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot), new THREE.Vector3(sx, sy, sz))));
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  group.add(mesh);
  // Écume autour des rochers du milieu
  if (river.rocks.length) {
    const fm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: foamTexture(), transparent: true, depthWrite: false, opacity: 0.85 }), river.rocks.length);
    river.rocks.forEach((rock, i) => {
      river.frame(rock.s + rock.r * 0.6, rock.lateral, f);
      const yaw = Math.atan2(f.tx, f.tz);
      fm.setMatrixAt(i, m4.compose(new THREE.Vector3(f.x, f.y + 0.03, f.z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), new THREE.Vector3(rock.r * 3.2, 1, rock.r * 4.2)));
    });
    fm.renderOrder = 1;
    group.add(fm);
  }
}

// Arbres : forêt détaillée (niveaux de détail) ou cônes en graphismes simples.
function buildTrees(river, height, theme, group, { detailed, quality, shared }) {
  const r = rng(23);
  const e = height.extent;
  const o = {};
  const round = [];
  const pines = [];
  const bushes = [];
  const want = detailed ? (quality === 'high' ? 2800 : quality === 'medium' ? 1800 : 900) : 700;
  for (let tries = 0; tries < want * 14 && round.length + pines.length < want; tries++) {
    // Plus d'arbres près de la rivière (là où on les voit)
    const s = r() * river.length;
    const side = r() < 0.5 ? -1 : 1;
    const k = Math.round(s);
    const dist = river.half[k] + 7 + Math.pow(r(), 1.7) * 380;
    const x = river.x[k] - river.tz[k] * side * dist;
    const z = river.z[k] + river.tx[k] * side * dist;
    if (x < e.x0 || x > e.x1 || z < e.z0 || z > e.z1) continue;
    const y = height(x, z, o);
    if (o.d < 6 || y - o.wy < 1.2) continue;
    if (o.gorge > 0.3 && o.d < 15) continue; // pas d'arbres sur les parois des gorges
    if (fbm(x * 0.008 + 3, z * 0.008, 3) < -0.15 && r() > 0.2) continue; // clairières
    const sc = 0.8 + r() * 0.7;
    if (r() < theme.pine) pines.push([x, y, z, sc * 1.1, r()]);
    else round.push([x, y, z, sc, r()]);
  }
  for (let tries = 0; tries < want * 4 && bushes.length < want * 0.35; tries++) {
    const s = r() * river.length;
    const side = r() < 0.5 ? -1 : 1;
    const k = Math.round(s);
    const dist = river.half[k] + 3 + r() * 14;
    const x = river.x[k] - river.tz[k] * side * dist;
    const z = river.z[k] + river.tx[k] * side * dist;
    const y = height(x, z, o);
    if (o.d < 2.5 || y - o.wy < 0.7 || (o.gorge > 0.3 && o.d < 15)) continue;
    bushes.push([x, y, z, 0.7 + r() * 0.8, r()]);
  }
  if (detailed) {
    const solidMat = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }), shared, { key: 'solid' });
    const cards = quality === 'high';
    const leafMat = crispAlpha(windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, map: leafAtlas(), alphaTest: 0.5, side: THREE.DoubleSide }), shared, { key: 'leaf', flutter: 0.035, noFlip: true }));
    if (cards) leafMat.alphaToCoverage = true;
    const tints = ['#ffffff', '#f2ffe0', '#e4f7d6', '#fff2c4', '#e8fff0'].map(C);
    return new Forest(group, [
      { near: deciduousGeometry(0, cards), impostor: 'deciduous', items: round, cast: quality !== 'low', tints, nearMaterial: cards ? [solidMat, leafMat] : solidMat, material: solidMat },
      { near: pineGeometry(0), impostor: 'pine', items: pines, cast: quality !== 'low', tints: null, material: solidMat },
      { near: bushGeometry(0), impostor: 'bush', items: bushes, cast: false, tints, material: solidMat },
    ], quality === 'high' ? { close: 60, mid: 130 } : quality === 'medium' ? { close: 40, mid: 90 } : { close: 0.1, mid: 50 });
  }
  // Graphismes simples : cônes et troncs
  const all = [...round, ...pines];
  const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 7, 7).translate(0, 5.2, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), all.length);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2, 5).translate(0, 1, 0), new THREE.MeshStandardMaterial({ color: '#6b4a30' }), all.length);
  const greens = ['#2f7a35', '#3b8a3f', '#2a6b34', '#4b9a45'].map(C);
  const m4 = new THREE.Matrix4();
  all.forEach(([x, y, z, sc], i) => {
    m4.makeScale(sc, sc, sc).setPosition(x, y - 0.2, z);
    leaves.setMatrixAt(i, m4);
    trunks.setMatrixAt(i, m4);
    leaves.setColorAt(i, greens[i % greens.length]);
  });
  group.add(leaves, trunks);
  return null;
}

export function buildKayakWorld(scene, river, { quality = 'high', renderer = null, detailed = true } = {}) {
  const theme = THEMES[river.def.theme] || THEMES.gorge;
  const group = new THREE.Group();
  group.userData.tag = 'scenery';
  scene.add(group);
  const shared = { uTime: { value: 0 }, uWind: { value: 0.8 }, noise: noiseTexture() };
  const prevFog = scene.fog;
  const cast = detailed && quality !== 'low';
  const mood = MOODS[theme.mood];
  let sky;
  let envTex = null;
  if (detailed) {
    installFog();
    applyMood(scene, mood);
    sky = makeSkyDome(mood, quality);
    if (renderer) {
      envTex = makeSkyEnvironment(renderer, sky);
      scene.environment = envTex;
      scene.environmentIntensity = mood.env;
    }
  } else {
    sky = makeSky(['#2f7fdc', '#8cc8f7', '#e0f1ff']);
    scene.fog = new THREE.Fog(C('#e0f1ff'), 260, 1300);
  }
  scene.add(sky);

  const height = makeHeight(river, theme);
  const terrain = buildTerrain(river, height, theme, { quality, detailed, shared });
  group.add(terrain.mesh);
  const water = buildWater(river, theme, mood, { detailed, maps: terrain.maps, shared });
  group.add(water.mesh);
  const gates = buildGates(river, height, group, { cast });
  const challenges = buildChallenges(river, height, group, { cast, detailed });
  buildStartFinish(river, height, group, { cast, detailed, shared, quality });
  buildRocks(river, height, group, { detailed, quality, cast });
  const forest = buildTrees(river, height, theme, group, { detailed, quality, shared });
  let grass = null;
  if (detailed && quality !== 'low') {
    grass = makeGrassField(terrain.maps, shared, { quality });
    group.add(grass.mesh);
  }
  // Montagnes au loin
  const b = river.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
  if (detailed) {
    group.add(mountainRingAround({ cx, cz, r0: span + 420, r1: span + 2000, baseY: river.y[river.count] - 20, h: theme.mountains.h, snow: theme.mountains.snow }));
    group.add(makeBirds(shared, new THREE.Vector3(cx, river.y[0], cz), quality === 'low' ? 8 : 18));
  } else {
    const r = rng(5);
    const mts = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#7f9bb5', roughness: 1, flatShading: true }), 26);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const d = span + 700 + r() * 300;
      m4.makeScale(240 + r() * 160, 150 + r() * 220, 240 + r() * 160).setPosition(cx + Math.cos(a) * d, -20, cz + Math.sin(a) * d);
      mts.setMatrixAt(i, m4);
    }
    group.add(mts);
  }

  let time = 0;
  const skyU = sky.userData.uniforms;
  return {
    group,
    sky,
    height,
    gates,
    challenges,
    update(dt, camera) {
      time += dt;
      shared.uTime.value = time;
      if (skyU) skyU.uTime.value = time;
      sky.position.copy(camera.position);
      if (forest) forest.update(camera.position.x, camera.position.z, camera.position.y);
      if (grass) grass.update(camera);
      if (water.normal) water.normal.offset.set(0, -time * 0.12);
    },
    dispose() {
      for (const root of [group, sky]) {
        scene.remove(root);
        disposeTree(root);
      }
      if (terrain.maps) terrain.maps.dispose();
      if (envTex) envTex.userData.release();
      scene.environment = null;
      scene.fog = prevFog;
    },
  };
}
