// Circuit : spline fermée dans le plan XZ + profil d'altitude maîtrisé (montée, descente, plat).
// La logique de course n'utilise que des distances (s, en m) et des décalages latéraux.
import * as THREE from 'three';
import { buildProfile, buildOpenProfile } from '../src/core/profile.js';
import { courseById, surfaceAtFraction } from './courses.js';
import { baladeTerrain, buildBalade } from './balade-scene.js';

export const ROAD_HALF = 4; // demi-largeur de la route par défaut (m) ; chaque circuit peut avoir la sienne (track.half)
export const LATERAL_LIMIT = ROAD_HALF + 2.5; // on peut rouler un peu dans l'herbe, pas plus

const smooth = (t) => t * t * (3 - 2 * t);

export const mod = (a, n) => ((a % n) + n) % n;

// Un circuit (voir courses.js) : tracé, profil d'altitude, revêtements.
// Parcours ouvert (course.open, zones de la Grande Balade) : du départ à l'arrivée, sans boucle. La route
// continue de course.lead = [avant, après] mètres de part et d'autre (caméra au départ, roue libre après la ligne) ;
// s = 0 reste la ligne de départ et this.length la distance à parcourir, comme pour un tour de circuit.
export class Track {
  constructor(course = courseById('vallee')) {
    this.course = course;
    this.open = !!course.open;
    // Demi-largeur de la route de ce circuit (un sentier de VTT est étroit) et écart latéral maximal.
    this.half = course.roadHalf ?? ROAD_HALF;
    this.lateralLimit = this.half + 2.5;
    const pts = course.control.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(pts, !this.open, 'centripetal');
    const total = this.curve.getLength();
    const [lead0, lead1] = this.open ? course.lead || [0, 0] : [0, 0];
    this.total = total; // longueur de toute la route dessinée (avec les prolongements d'un parcours ouvert)
    this.s0 = lead0; // position de la ligne de départ sur la route dessinée
    this.length = total - lead0 - lead1;
    const n = Math.ceil(total);
    this.count = n;
    this.step = total / n;
    this.x = new Float32Array(n + 1);
    this.z = new Float32Array(n + 1);
    this.tx = new Float32Array(n + 1);
    this.tz = new Float32Array(n + 1);
    this.y = new Float32Array(n + 1);
    this.grade = new Float32Array(n + 1);

    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const u = this.open ? i / n : (i % n) / n;
      this.curve.getPointAt(u, p);
      this.curve.getTangentAt(u, t);
      const len = Math.hypot(t.x, t.z) || 1;
      this.x[i] = p.x;
      this.z[i] = p.z;
      this.tx[i] = t.x / len;
      this.tz[i] = t.z / len;
    }

    if (this.open) {
      // Parcours ouvert : pentes telles quelles (l'arrivée n'a pas à revenir à l'altitude du départ).
      const prof = buildOpenProfile(course.profile, n, this.step, (i) => this.fractionOf(i));
      this.grade.set(prof.grade);
      this.y.set(prof.y);
    } else {
      // Pentes et altitudes : montées telles quelles, descentes ajustées pour boucler.
      const prof = buildProfile(course.profile, n, this.step);
      this.grade.set(prof.grade);
      this.y.set(prof.y);
    }
    // Revêtement de chaque mètre (asphalte, passerelle, sable).
    this.surf = Array.from({ length: n + 1 }, (_, i) => surfaceAtFraction(course, this.fractionOf(i)));

    // Courbure (1/m, + = virage à droite) : variation du cap le long du tracé, lissée sur ±6 m.
    const yaw = Array.from({ length: n + 1 }, (_, i) => Math.atan2(this.tx[i], this.tz[i]));
    const rawK = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let d = yaw[i + 1] - yaw[i];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      rawK[i] = -d / this.step;
    }
    this.curv = new Float32Array(n + 1);
    const W = 6;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = -W; j <= W; j++) sum += rawK[this.open ? Math.min(n - 1, Math.max(0, i + j)) : mod(i + j, n)];
      this.curv[i] = sum / (2 * W + 1);
    }
    this.curv[n] = this.open ? this.curv[n - 1] : this.curv[0];

    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i <= n; i++) {
      minY = Math.min(minY, this.y[i]);
      maxY = Math.max(maxY, this.y[i]);
    }
    this.minY = minY;
    this.maxY = maxY;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < (this.open ? n + 1 : n); i++) {
      minX = Math.min(minX, this.x[i]); maxX = Math.max(maxX, this.x[i]);
      minZ = Math.min(minZ, this.z[i]); maxZ = Math.max(maxZ, this.z[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
  }

  // Fraction du parcours (0 = départ, 1 = arrivée) de l'échantillon i ; bornée sur les prolongements.
  fractionOf(i) {
    if (!this.open) return (i % this.count) / this.count;
    return Math.min(1, Math.max(0, (i * this.step - this.s0) / this.length));
  }

  // Indice d'échantillon voisin : bouclé sur un circuit, borné sur un parcours ouvert.
  wrap(i) {
    return this.open ? Math.min(this.count, Math.max(0, i)) : mod(i, this.count);
  }

  // Index + fraction pour une distance s (m), quel que soit le tour.
  locate(s) {
    const f = this.open ? Math.min(this.total - 1e-6, Math.max(0, s + this.s0)) / this.step : mod(s, this.length) / this.step;
    const i = Math.min(this.count - 1, Math.floor(f));
    return [i, f - i];
  }

  surfaceAt(s) {
    return this.surf[this.locate(s)[0]];
  }

  curvatureAt(s) {
    const [i, a] = this.locate(s);
    return this.curv[i] + (this.curv[i + 1] - this.curv[i]) * a;
  }

  gradeAt(s) {
    const [i, a] = this.locate(s);
    return this.grade[i] + (this.grade[i + 1] - this.grade[i]) * a;
  }

  // Position et orientation sur la route. out = { x, y, z, tx, tz, rx, rz, grade }.
  frame(s, lateral = 0, out = {}) {
    const [i, a] = this.locate(s);
    const lerp = (arr) => arr[i] + (arr[i + 1] - arr[i]) * a;
    let tx = lerp(this.tx);
    let tz = lerp(this.tz);
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    // vecteur "droite" (y vers le haut) : avant × haut
    out.rx = -tz;
    out.rz = tx;
    out.tx = tx;
    out.tz = tz;
    out.x = lerp(this.x) + out.rx * lateral;
    out.z = lerp(this.z) + out.rz * lateral;
    out.y = lerp(this.y);
    out.grade = this.grade[i] + (this.grade[i + 1] - this.grade[i]) * a;
    return out;
  }

  // Point de la route le plus proche (recherche grossière, pour construire le décor).
  nearest(x, z, stride = 4) {
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i < this.count; i += stride) {
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    return { index: bi, dist: Math.sqrt(best), y: this.y[bi] };
  }
}

// --- Décor ---

// Petit générateur pseudo-aléatoire déterministe (le décor est identique à chaque partie).
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bumps(x, z) {
  return Math.sin(x * 0.021) * Math.cos(z * 0.017) * 3 + Math.sin(x * 0.053 + z * 0.041) * 1.2;
}

// Altitude du terrain : collé sous la route près du tracé, vallonné plus loin.
// mods : reliefs d'une zone de la Grande Balade (baladeTerrain), lac compris.
export function makeTerrainHeight(track, mods = null) {
  return (x, z) => {
    const near = track.nearest(x, z);
    const base = near.y - 0.3;
    const t = smooth(Math.min(1, Math.max(0, (near.dist - track.half - 3) / 45)));
    const far = Math.max(0, near.dist - 120) * 0.25;
    let h = base + t * (bumps(x, z) + 2 + far);
    if (mods) {
      h = mods.apply(x, z, near, h);
      const lk = mods.lake;
      if (lk) {
        const dl = Math.hypot(x - lk.x, z - lk.z);
        h += (lk.y - 2.4 - h) * smooth(Math.min(1, Math.max(0, (lk.r * 1.3 - dl) / (lk.r * 0.5))));
      }
      return h;
    }
    const coast = track.course.features?.coast;
    if (!coast) return h;
    // Plage puis fond marin sous le niveau de la mer.
    const k = smooth(Math.min(1, Math.max(0, (z - coast.z + 40) / 50))) * Math.min(1, Math.max(0, (near.dist - track.half - 1) / 6));
    return h + (track.minY - 0.3 - (z - coast.z) * 0.06 - h) * k;
  };
}

function ribbon(track, from, to, yOff, step, colorFn) {
  // Bande le long du tracé entre deux décalages latéraux, une couleur par tronçon.
  const pos = [];
  const col = [];
  const c = new THREE.Color();
  const n = track.count;
  for (let i = 0, seg = 0; i < n; i += step, seg++) {
    const j = Math.min(n, i + step);
    const a = (k, lat) => [track.x[k] - track.tz[k] * lat, track.y[k] + yOff, track.z[k] + track.tx[k] * lat];
    const p0 = a(i, from), p1 = a(i, to), p2 = a(j, from), p3 = a(j, to);
    pos.push(...p0, ...p1, ...p2, ...p1, ...p3, ...p2);
    c.set(colorFn(seg));
    for (let v = 0; v < 6; v++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Palettes d'herbe des régions de la Grande Balade (graphismes simples).
const RIDE_GRASS = {
  collines: ['#5c9c38', '#67a843', '#579436', '#6fae4a', '#7cb24e'],
  landes: ['#6c8442', '#7a8c4a', '#5f7a3c', '#87904c', '#7a7448'],
  neiges: ['#4f7a34', '#5a8a3c', '#477030', '#68863e', '#8a8f86'],
  foretdor: ['#9aa83e', '#b7ae48', '#a3963a', '#c2b450', '#8f9a3a'],
  plaines: ['#bba756', '#c9b466', '#a49445', '#d1bc70', '#9a9046'],
  lac: ['#67913e', '#7fa04a', '#5a8a36', '#7a8c50', '#6f9844'],
  vertbois: ['#5a9036', '#73a442', '#4f8a2e', '#88ae4c', '#62983a'],
  feu: ['#4a413b', '#55493f', '#3e3632', '#5d5046', '#463c36'],
};
const RIDE_LEAVES = { foretdor: ['#d7b443', '#e3c45a', '#c9a73a', '#b8c25a'], feu: ['#3b302a'] };

export function buildScenery(scene, track) {
  const group = new THREE.Group();
  scene.add(group);
  const course = track.course;
  // Zone de la Grande Balade : reliefs, lac et décors (balade-scene.js).
  const me = course.ride ? baladeTerrain(track) : null;
  if (me?.lake) {
    // Niveau du lac : un peu sous la route la plus proche de la rive.
    const near = track.nearest(me.lake.x, me.lake.z);
    me.lake.y = near.y - 1.6;
  }
  const terrainHeight = makeTerrainHeight(track, me);
  const vc = (opts = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...opts });

  // Route, bordures rouges et blanches, ligne médiane pointillée.
  const ROAD_COLORS = { asphalt: ['#4a4d55', '#474a52'], boardwalk: ['#a87a4f', '#93683f'], sand: ['#e2cf9a', '#d9c48d'] };
  // Grande Balade : chemin de terre, sans bordures ni ligne médiane.
  const ride = !!track.course.ride;
  const dirt = track.course.region === 'feu' ? ['#5a4a40', '#55463d'] : ['#9a8462', '#94805e'];
  const road = ribbon(track, -track.half, track.half, 0.02, 2, (k) => (ROAD_COLORS[track.surf[k * 2]] || (ride ? dirt : ROAD_COLORS.asphalt))[k % 2]);
  group.add(new THREE.Mesh(road, vc()));
  if (!ride) {
    const curb = (k) => (k % 2 ? '#e8e8e8' : '#d6322b');
    group.add(new THREE.Mesh(ribbon(track, track.half, track.half + 0.7, 0.05, 3, curb), vc()));
    group.add(new THREE.Mesh(ribbon(track, -track.half - 0.7, -track.half, 0.05, 3, curb), vc()));
    const dashes = ribbon(track, -0.12, 0.12, 0.04, 3, () => '#f2f2f2');
    // On ne garde qu'un tronçon sur deux pour faire les pointillés.
    const dp = dashes.attributes.position.array;
    const keep = [];
    for (let q = 0; q < dp.length / 18; q++) if (q % 2 === 0) keep.push(...dp.slice(q * 18, q * 18 + 18));
    const dashGeo = new THREE.BufferGeometry();
    dashGeo.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
    dashGeo.computeVertexNormals();
    group.add(new THREE.Mesh(dashGeo, new THREE.MeshLambertMaterial({ color: '#f2f2f2' })));
  }

  // Terrain en grille, couleurs d'herbe variées, aspect low-poly.
  const b = track.bounds;
  const margin = 260;
  const cell = 7;
  const w = b.maxX - b.minX + margin * 2;
  const d = b.maxZ - b.minZ + margin * 2;
  const nx = Math.ceil(w / cell);
  const nz = Math.ceil(d / cell);
  const tg = new THREE.PlaneGeometry(w, d, nx, nz);
  tg.rotateX(-Math.PI / 2);
  tg.translate((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  const tp = tg.attributes.position;
  const r = rng(7);
  for (let i = 0; i < tp.count; i++) tp.setY(i, terrainHeight(tp.getX(i), tp.getZ(i)));
  const flat = tg.toNonIndexed();
  const fp = flat.attributes.position;
  const colors = new Float32Array(fp.count * 3);
  const theme = track.course.theme;
  const grass = (RIDE_GRASS[course.region] || (theme === 'coast'
    ? ['#a9b862', '#b9c46f', '#c9cd82', '#dccf95', '#e3d3a1']
    : theme === 'alpine'
      ? ['#4f8f3a', '#5a9a42', '#477f34', '#6aa84a', '#8a8f86']
      : ['#5f9e3c', '#67a843', '#579436', '#6fae4a', '#4f8a31'])).map((h) => new THREE.Color(h));
  for (let i = 0; i < fp.count; i += 3) {
    const c = grass[Math.floor(r() * grass.length)];
    for (let v = 0; v < 3; v++) colors.set([c.r, c.g, c.b], (i + v) * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  flat.computeVertexNormals();
  group.add(new THREE.Mesh(flat, vc()));

  // Bord de mer : une grande étendue d'eau au niveau de la plage.
  const coast = track.course.features?.coast;
  if (coast) {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 3000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#2a9fd0' }));
    sea.position.set((b.minX + b.maxX) / 2, track.minY - 0.6, coast.z + 1500);
    group.add(sea);
  }

  // Lac et décors de la zone (avant les arbres, qui évitent leurs emplacements).
  const reserved = [];
  let animate = null;
  if (me) {
    if (me.lake) {
      const water = new THREE.Mesh(new THREE.CircleGeometry(me.lake.r * 1.3, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#2f86b8' }));
      water.position.set(me.lake.x, me.lake.y, me.lake.z);
      group.add(water);
    }
    animate = buildBalade(group, { track, heightAt: terrainHeight, lake: me.lake, mods: me, reserve: (x, z, rad) => reserved.push([x, z, rad]), cast: false }, { detailed: false });
  }
  const isFree = (x, z) => !reserved.some(([rx, rz, rad]) => (x - rx) ** 2 + (z - rz) ** 2 < rad * rad) && !(me?.lake && Math.hypot(x - me.lake.x, z - me.lake.z) < me.lake.r * 1.4);

  // Arbres et rochers (instanciés : un seul appel de dessin par type).
  const trees = [];
  const rocks = [];
  const maxTrees = course.region === 'feu' ? 0 : course.region === 'plaines' ? 60 : 320;
  for (let tries = 0; tries < 4000 && (trees.length < maxTrees || (maxTrees === 0 && rocks.length < 70)); tries++) {
    const x = b.minX - 160 + r() * (w - 200);
    const z = b.minZ - 160 + r() * (d - 200);
    const near = track.nearest(x, z);
    if (near.dist < track.half + 6) continue;
    if (coast && z > coast.z - 30) continue;
    if (me && !isFree(x, z)) continue;
    if (r() < 0.8 && maxTrees > 0) trees.push([x, z, 0.8 + r() * 0.8, r()]);
    else if (rocks.length < 70) rocks.push([x, z, 0.6 + r() * 1.6, r()]);
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s3 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.25, 0.35, 2, 5).translate(0, 1, 0),
    new THREE.MeshLambertMaterial({ color: '#7a5233', flatShading: true }),
    trees.length,
  );
  const leaves = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1.8, 5, 6).translate(0, 4.2, 0),
    new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }),
    trees.length,
  );
  const leafColors = (RIDE_LEAVES[course.region] || ['#2f7a3a', '#3b8a3f', '#2a6b34', '#4b9a45']).map((h) => new THREE.Color(h));
  trees.forEach(([x, z, sc, rot], i) => {
    m4.compose(v3.set(x, terrainHeight(x, z) - 0.2, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot * 6), s3.setScalar(sc));
    trunk.setMatrixAt(i, m4);
    leaves.setMatrixAt(i, m4);
    leaves.setColorAt(i, leafColors[i % leafColors.length]);
  });
  group.add(trunk, leaves);
  const rockMesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshLambertMaterial({ color: '#8d8f94', flatShading: true }),
    rocks.length,
  );
  rocks.forEach(([x, z, sc, rot], i) => {
    m4.compose(v3.set(x, terrainHeight(x, z), z), q.setFromEuler(new THREE.Euler(rot * 3, rot * 7, 0)), s3.set(sc, sc * 0.7, sc));
    rockMesh.setMatrixAt(i, m4);
  });
  group.add(rockMesh);

  // Montagnes lointaines.
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const mountainGeo = new THREE.ConeGeometry(1, 1, 5);
  const mountainColor = course.region === 'feu' ? '#3a2e2a' : '#7d93a8';
  const mountains = new THREE.InstancedMesh(mountainGeo, new THREE.MeshLambertMaterial({ color: mountainColor, flatShading: true }), 28);
  const spanR = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2; // les zones allongées repoussent l'horizon
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + r() * 0.1;
    const dist = Math.max(900, spanR + 520) + r() * 250;
    const hgt = 120 + r() * 160;
    m4.compose(v3.set(cx + Math.cos(a) * dist, hgt / 2 - 20, cz + Math.sin(a) * dist), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r() * 3), s3.set(180 + r() * 120, hgt, 180 + r() * 120));
    mountains.setMatrixAt(i, m4);
  }
  group.add(mountains);

  if (!course.ride) {
    // Ligne de départ en damier + arche.
    const checker = canvasTexture(256, 32, (ctx, cw, ch) => {
      const sq = ch / 2;
      for (let x = 0; x < cw / sq; x++) for (let y = 0; y < 2; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
        ctx.fillRect(x * sq, y * sq, sq, sq);
      }
    });
    const start = track.frame(0);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(track.half * 2, 1), new THREE.MeshLambertMaterial({ map: checker }));
    line.rotation.set(-Math.PI / 2, Math.atan2(start.tx, start.tz), 0, 'YXZ');
    line.position.set(start.x, start.y + 0.06, start.z);
    group.add(line);
    const arch = new THREE.Group();
    const postMat = new THREE.MeshLambertMaterial({ color: '#2b2f3a', flatShading: true });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), postMat);
      post.position.set(side * (track.half + 1), 3, 0);
      arch.add(post);
    }
    const bannerTex = canvasTexture(512, 64, (ctx, cw, ch) => {
      ctx.fillStyle = '#ff5a1f';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 40px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('MyCycleWorld · DÉPART', cw / 2, ch / 2 + 2);
    });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(track.half * 2 + 2.5, 1.1, 0.3), [
      postMat, postMat, postMat, postMat,
      new THREE.MeshLambertMaterial({ map: bannerTex }),
      new THREE.MeshLambertMaterial({ map: bannerTex }),
    ]);
    banner.position.set(0, 5.6, 0);
    arch.add(banner);
    // Les axes locaux de l'arche : X = travers de la route, Z = sens de la course.
    arch.position.set(start.x, start.y, start.z);
    arch.rotation.y = Math.atan2(start.tx, start.tz);
    group.add(arch);
  }

  // Ciel en dégradé (sphère suivant la caméra) et quelques nuages.
  const skyGeo = new THREE.SphereGeometry(1800, 24, 12);
  const sp = skyGeo.attributes.position;
  const skyCol = new Float32Array(sp.count * 3);
  const SKIES = { feu: ['#4a2a22', '#b8653c'], foretdor: ['#4f86d0', '#f0e2b8'], plaines: ['#3f86d8', '#ece0c2'], collines: ['#4a8ad8', '#e6dcc4'] };
  const [topC, horizonC] = SKIES[course.region] || ['#3f86d8', '#cfe6fb'];
  const top = new THREE.Color(topC);
  const horizon = new THREE.Color(horizonC);
  const tmp = new THREE.Color();
  for (let i = 0; i < sp.count; i++) {
    const t = Math.max(0, sp.getY(i) / 1800);
    tmp.copy(horizon).lerp(top, Math.pow(t, 0.6));
    skyCol.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(skyCol, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  scene.add(sky);
  const clouds = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshLambertMaterial({ color: course.region === 'feu' ? '#6a4a40' : '#ffffff', emissive: course.region === 'feu' ? '#3a2420' : '#aebbd0', flatShading: true, fog: false }),
    18,
  );
  for (let i = 0; i < 18; i++) {
    const a = r() * Math.PI * 2;
    const dist = 550 + r() * 550;
    m4.compose(v3.set(cx + Math.cos(a) * dist, 230 + r() * 90, cz + Math.sin(a) * dist), q.identity(), s3.set(40 + r() * 40, 10 + r() * 6, 20 + r() * 20));
    clouds.setMatrixAt(i, m4);
  }
  group.add(clouds);

  // Couleur de la brume (graphismes simples) : celle de l'horizon de la région.
  return { group, sky, terrainHeight, animate, fogColor: horizonC, center: new THREE.Vector3(cx, (track.minY + track.maxY) / 2, cz) };
}

// Tracé 2D pour la mini-carte (points normalisés dans [0,1]).
export function minimapPath(track, every = 6) {
  const b = track.bounds;
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const norm = (x, z) => [(x - b.minX) / size + (1 - (b.maxX - b.minX) / size) / 2, (z - b.minZ) / size + (1 - (b.maxZ - b.minZ) / size) / 2];
  const pts = [];
  for (let i = 0; i <= track.count; i += every) pts.push(norm(track.x[i], track.z[i]));
  return { pts, norm };
}
