// Circuit : spline fermée dans le plan XZ + profil d'altitude maîtrisé (montée, descente, plat).
// La logique de course n'utilise que des distances (s, en m) et des décalages latéraux.
import * as THREE from 'three';

export const ROAD_HALF = 4; // demi-largeur de la route (m)
export const LATERAL_LIMIT = ROAD_HALF + 2.5; // on peut rouler un peu dans l'herbe, pas plus

// Points de passage du tracé (m).
const CONTROL = [
  [0, 0], [130, -30], [250, 10], [320, 120], [290, 240], [180, 290],
  [60, 250], [-30, 310], [-170, 290], [-250, 180], [-220, 60], [-120, 10],
];

// Profil de pente (%) en fonction de la fraction du tour, interpolé en douceur entre les clés.
// Les pentes négatives sont ensuite mises à l'échelle pour que la boucle se referme à la même altitude.
const PROFILE = [
  [0, 0], [0.14, 0], [0.2, 7], [0.38, 7], [0.42, 1.5], [0.48, 0],
  [0.52, -6], [0.7, -6], [0.75, -1], [0.8, 0], [0.86, 2], [0.9, 2], [0.94, 0], [1, 0],
];

const smooth = (t) => t * t * (3 - 2 * t);

function profileGrade(u) {
  for (let i = 1; i < PROFILE.length; i++) {
    const [u1, g1] = PROFILE[i];
    if (u <= u1) {
      const [u0, g0] = PROFILE[i - 1];
      return g0 + (g1 - g0) * smooth((u - u0) / (u1 - u0));
    }
  }
  return 0;
}

export const mod = (a, n) => ((a % n) + n) % n;

export class Track {
  constructor() {
    const pts = CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = this.curve.getLength();
    const n = Math.ceil(this.length);
    this.count = n;
    this.step = this.length / n;
    this.x = new Float32Array(n + 1);
    this.z = new Float32Array(n + 1);
    this.tx = new Float32Array(n + 1);
    this.tz = new Float32Array(n + 1);
    this.y = new Float32Array(n + 1);
    this.grade = new Float32Array(n + 1);

    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const u = (i % n) / n;
      this.curve.getPointAt(u, p);
      this.curve.getTangentAt(u, t);
      const len = Math.hypot(t.x, t.z) || 1;
      this.x[i] = p.x;
      this.z[i] = p.z;
      this.tx[i] = t.x / len;
      this.tz[i] = t.z / len;
    }

    // Pentes : montées telles quelles, descentes ajustées pour boucler.
    const raw = Array.from({ length: n }, (_, i) => profileGrade(i / n));
    const up = raw.reduce((a, g) => a + Math.max(0, g), 0);
    const down = raw.reduce((a, g) => a - Math.min(0, g), 0);
    const k = down > 0 ? up / down : 1;
    for (let i = 0; i < n; i++) this.grade[i] = raw[i] > 0 ? raw[i] : raw[i] * k;
    this.grade[n] = this.grade[0];
    let h = 0;
    for (let i = 0; i < n; i++) {
      this.y[i] = h;
      h += (this.grade[i] / 100) * this.step;
    }
    this.y[n] = this.y[0];

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
      for (let j = -W; j <= W; j++) sum += rawK[mod(i + j, n)];
      this.curv[i] = sum / (2 * W + 1);
    }
    this.curv[n] = this.curv[0];

    this.minY = Math.min(...this.y);
    this.maxY = Math.max(...this.y);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, this.x[i]); maxX = Math.max(maxX, this.x[i]);
      minZ = Math.min(minZ, this.z[i]); maxZ = Math.max(maxZ, this.z[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
  }

  // Index + fraction pour une distance s (m), quel que soit le tour.
  locate(s) {
    const f = mod(s, this.length) / this.step;
    const i = Math.min(this.count - 1, Math.floor(f));
    return [i, f - i];
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
export function makeTerrainHeight(track) {
  return (x, z) => {
    const near = track.nearest(x, z);
    const base = near.y - 0.3;
    const t = smooth(Math.min(1, Math.max(0, (near.dist - ROAD_HALF - 3) / 45)));
    const far = Math.max(0, near.dist - 120) * 0.25;
    return base + t * (bumps(x, z) + 2 + far);
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

export function buildScenery(scene, track) {
  const group = new THREE.Group();
  scene.add(group);
  const terrainHeight = makeTerrainHeight(track);
  const vc = (opts = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...opts });

  // Route, bordures rouges et blanches, ligne médiane pointillée.
  const road = ribbon(track, -ROAD_HALF, ROAD_HALF, 0.02, 2, (k) => (k % 2 ? '#4a4d55' : '#474a52'));
  group.add(new THREE.Mesh(road, vc()));
  const curb = (k) => (k % 2 ? '#e8e8e8' : '#d6322b');
  group.add(new THREE.Mesh(ribbon(track, ROAD_HALF, ROAD_HALF + 0.7, 0.05, 3, curb), vc()));
  group.add(new THREE.Mesh(ribbon(track, -ROAD_HALF - 0.7, -ROAD_HALF, 0.05, 3, curb), vc()));
  const dashes = ribbon(track, -0.12, 0.12, 0.04, 3, () => '#f2f2f2');
  // On ne garde qu'un tronçon sur deux pour faire les pointillés.
  const dp = dashes.attributes.position.array;
  const keep = [];
  for (let q = 0; q < dp.length / 18; q++) if (q % 2 === 0) keep.push(...dp.slice(q * 18, q * 18 + 18));
  const dashGeo = new THREE.BufferGeometry();
  dashGeo.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  dashGeo.computeVertexNormals();
  group.add(new THREE.Mesh(dashGeo, new THREE.MeshLambertMaterial({ color: '#f2f2f2' })));

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
  const grass = ['#5f9e3c', '#67a843', '#579436', '#6fae4a', '#4f8a31'].map((h) => new THREE.Color(h));
  for (let i = 0; i < fp.count; i += 3) {
    const c = grass[Math.floor(r() * grass.length)];
    for (let v = 0; v < 3; v++) colors.set([c.r, c.g, c.b], (i + v) * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  flat.computeVertexNormals();
  group.add(new THREE.Mesh(flat, vc()));

  // Arbres et rochers (instanciés : un seul appel de dessin par type).
  const trees = [];
  const rocks = [];
  for (let tries = 0; tries < 4000 && trees.length < 320; tries++) {
    const x = b.minX - 160 + r() * (w - 200);
    const z = b.minZ - 160 + r() * (d - 200);
    const near = track.nearest(x, z);
    if (near.dist < ROAD_HALF + 6) continue;
    if (r() < 0.8) trees.push([x, z, 0.8 + r() * 0.8, r()]);
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
  const leafColors = ['#2f7a3a', '#3b8a3f', '#2a6b34', '#4b9a45'].map((h) => new THREE.Color(h));
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
  const mountains = new THREE.InstancedMesh(mountainGeo, new THREE.MeshLambertMaterial({ color: '#7d93a8', flatShading: true }), 28);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + r() * 0.1;
    const dist = 900 + r() * 250;
    const hgt = 120 + r() * 160;
    m4.compose(v3.set(cx + Math.cos(a) * dist, hgt / 2 - 20, cz + Math.sin(a) * dist), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r() * 3), s3.set(180 + r() * 120, hgt, 180 + r() * 120));
    mountains.setMatrixAt(i, m4);
  }
  group.add(mountains);

  // Ligne de départ en damier + arche.
  const checker = canvasTexture(256, 32, (ctx, cw, ch) => {
    const sq = ch / 2;
    for (let x = 0; x < cw / sq; x++) for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      ctx.fillRect(x * sq, y * sq, sq, sq);
    }
  });
  const start = track.frame(0);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 1), new THREE.MeshLambertMaterial({ map: checker }));
  line.rotation.set(-Math.PI / 2, Math.atan2(start.tx, start.tz), 0, 'YXZ');
  line.position.set(start.x, start.y + 0.06, start.z);
  group.add(line);
  const arch = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: '#2b2f3a', flatShading: true });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), postMat);
    post.position.set(side * (ROAD_HALF + 1), 3, 0);
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
  const banner = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 2.5, 1.1, 0.3), [
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

  // Ciel en dégradé (sphère suivant la caméra) et quelques nuages.
  const skyGeo = new THREE.SphereGeometry(1800, 24, 12);
  const sp = skyGeo.attributes.position;
  const skyCol = new Float32Array(sp.count * 3);
  const top = new THREE.Color('#3f86d8');
  const horizon = new THREE.Color('#cfe6fb');
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
    new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#aebbd0', flatShading: true, fog: false }),
    18,
  );
  for (let i = 0; i < 18; i++) {
    const a = r() * Math.PI * 2;
    const dist = 550 + r() * 550;
    m4.compose(v3.set(cx + Math.cos(a) * dist, 230 + r() * 90, cz + Math.sin(a) * dist), q.identity(), s3.set(40 + r() * 40, 10 + r() * 6, 20 + r() * 20));
    clouds.setMatrixAt(i, m4);
  }
  group.add(clouds);

  return { group, sky, terrainHeight, center: new THREE.Vector3(cx, (track.minY + track.maxY) / 2, cz) };
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
