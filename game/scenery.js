// Décor du circuit, style « livre d'images » : ciel peint, collines douces, route texturée, arbres ronds,
// prairies fleuries, clôtures, maisons, lac, montagnes enneigées et nuages. Tout est généré (aucun fichier).
// Niveaux de qualité : 'high' (ordinateur), 'medium' (tablette, téléphone), 'low'.
import * as THREE from 'three';
import { ROAD_HALF, rng, mod } from './track.js';
import { mergeGeometries, paint, indexify } from './geom.js';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// --- Bruit (valeur + fBm), déterministe ---
function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
export function fbm(x, z, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * f, z * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

// Point du tracé le plus proche, précis (recherche grossière puis affinée).
function nearestFine(track, x, z) {
  let best = Infinity;
  let bi = 0;
  for (let i = 0; i < track.count; i += 6) {
    const d = (track.x[i] - x) ** 2 + (track.z[i] - z) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  for (let j = -6; j <= 6; j++) {
    const i = mod(bi + j, track.count);
    const d = (track.x[i] - x) ** 2 + (track.z[i] - z) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  return { index: bi, dist: Math.sqrt(best), y: track.y[bi] };
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

const C = (hex) => new THREE.Color(hex);

// --- Ciel ---

export const SUN_DIR = new THREE.Vector3(-0.5, 0.62, 0.6).normalize();
export const HORIZON = C('#d6ecff');

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: C('#3a86e0') },
      mid: { value: C('#8cc4f5') },
      horizon: { value: HORIZON.clone() },
      ground: { value: C('#b9d3b0') },
      sunDir: { value: SUN_DIR.clone() },
      sunColor: { value: C('#fff1d0') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top, mid, horizon, ground, sunDir, sunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, top, smoothstep(0.15, 0.75, h));
        col = mix(col, ground, smoothstep(0.0, -0.2, h));
        float s = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12);
        col += vec3(1.0, 0.78, 0.5) * pow(s, 3.0) * (1.0 - smoothstep(0.0, 0.3, abs(h))) * 0.18;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1900, 48, 24), mat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}

// Carte d'environnement (reflets du ciel sur l'eau, le métal et les cadres de vélo).
function makeEnvironment(renderer, sky) {
  const envScene = new THREE.Scene();
  envScene.add(sky.clone());
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0, 1, 4000);
  pmrem.dispose();
  return rt.texture;
}

// --- Terrain ---

function findLake(track) {
  const b = track.bounds;
  let best = { dist: 0 };
  for (let x = b.minX + 40; x < b.maxX - 40; x += 12) {
    for (let z = b.minZ + 40; z < b.maxZ - 40; z += 12) {
      const n = nearestFine(track, x, z);
      if (n.dist > best.dist) best = { x, z, dist: n.dist };
    }
  }
  if (best.dist < 60) return null;
  return { x: best.x, z: best.z, r: Math.min(62, best.dist - 34) };
}

function makeGround(track, lake) {
  const base = (x, z, near) => {
    const d = near.dist;
    const roadY = near.y - 0.45;
    const t = smoothstep(ROAD_HALF + 2.2, ROAD_HALF + 42, d);
    const hills = fbm(x * 0.0042, z * 0.0042, 4) * 17 + fbm(x * 0.017 + 11, z * 0.017 - 7, 3) * 3.2;
    const far = Math.max(0, d - 150) * 0.3;
    return roadY + t * (hills + 2.5 + far);
  };
  let lakeY = 0;
  if (lake) {
    let m = Infinity;
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      const x = lake.x + Math.cos(a) * lake.r * 1.3;
      const z = lake.z + Math.sin(a) * lake.r * 1.3;
      m = Math.min(m, base(x, z, nearestFine(track, x, z)));
    }
    lakeY = m - 0.7;
    lake.y = lakeY;
  }
  const height = (x, z) => {
    const near = nearestFine(track, x, z);
    let h = base(x, z, near);
    if (lake) {
      const dl = Math.hypot(x - lake.x, z - lake.z);
      h += (lakeY - 2.6 - h) * smoothstep(lake.r * 1.3, lake.r * 0.8, dl);
    }
    return { h, near };
  };
  return height;
}

const GRASS = [C('#4f9a3a'), C('#6cbd4b'), C('#94cc52'), C('#b8d65e')];
const GRAVEL = C('#bcae8f');
const SAND = C('#e3d3a1');
const ROCK = C('#9a968a');
const DIRT = C('#8a7a55');

function buildTerrain(track, height, lake, quality) {
  const b = track.bounds;
  const margin = 520;
  const cell = quality === 'high' ? 4.5 : quality === 'medium' ? 6 : 8;
  const w = b.maxX - b.minX + margin * 2;
  const d = b.maxZ - b.minZ + margin * 2;
  const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w / cell), Math.ceil(d / cell));
  geo.rotateX(-Math.PI / 2);
  geo.translate((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  const p = geo.attributes.position;
  const dist = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const { h, near } = height(p.getX(i), p.getZ(i));
    p.setY(i, h);
    dist[i] = near.dist;
  }
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  const tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const y = p.getY(i);
    // Prairie : mélange de verts et de jaunes selon un bruit lent, plus des taches de fleurs.
    const k = (fbm(x * 0.012, z * 0.012, 3) + 1) / 2;
    const idx = Math.min(GRASS.length - 1.001, Math.max(0, k * (GRASS.length - 1) * 1.15));
    c.copy(GRASS[Math.floor(idx)]).lerp(GRASS[Math.ceil(idx)], idx % 1);
    c.multiplyScalar(0.92 + fbm(x * 0.08, z * 0.08, 2) * 0.12);
    // Bas-côtés en gravier, terre près de la route.
    c.lerp(tmp.copy(DIRT), smoothstep(ROAD_HALF + 4.5, ROAD_HALF + 2.2, dist[i]) * 0.55);
    c.lerp(GRAVEL, smoothstep(ROAD_HALF + 2.6, ROAD_HALF + 1.2, dist[i]));
    // Pentes raides : roche.
    c.lerp(ROCK, smoothstep(0.86, 0.7, n.getY(i)) * 0.8);
    // Rives du lac : sable.
    if (lake) c.lerp(SAND, smoothstep(lake.y + 1.1, lake.y + 0.2, y));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  mesh.receiveShadow = true;
  return mesh;
}

// --- Route ---

function asphaltTexture(anisotropy) {
  const tex = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#4b4e56';
    ctx.fillRect(0, 0, w, h);
    const r = rng(3);
    // Granulat
    for (let i = 0; i < 26000; i++) {
      const v = 60 + Math.floor(r() * 50);
      ctx.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + r() * 0.35})`;
      ctx.fillRect(r() * w, r() * h, 1 + r() * 1.6, 1 + r() * 1.6);
    }
    // Traces de pneus plus sombres et usées
    for (const u of [0.3, 0.7]) {
      const g = ctx.createLinearGradient(u * w - 40, 0, u * w + 40, 0);
      g.addColorStop(0, 'rgba(20,22,26,0)');
      g.addColorStop(0.5, 'rgba(20,22,26,0.22)');
      g.addColorStop(1, 'rgba(20,22,26,0)');
      ctx.fillStyle = g;
      ctx.fillRect(u * w - 40, 0, 80, h);
    }
    // Lignes de rive continues et ligne médiane en pointillés (3 m sur 8 m)
    ctx.fillStyle = '#f3f1ea';
    ctx.fillRect(w * 0.025, 0, w * 0.016, h);
    ctx.fillRect(w * (1 - 0.041), 0, w * 0.016, h);
    ctx.fillRect(w * 0.492, 0, w * 0.016, h * 0.375);
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

function buildRoad(track, anisotropy) {
  const n = track.count;
  const TILE = 8; // longueur (m) d'une répétition de la texture
  const SH = ROAD_HALF + 2.4; // bord extérieur des accotements
  const roadPos = [];
  const roadUv = [];
  const shPos = [];
  const shCol = [];
  const inner = GRAVEL;
  const outer = C('#6faa4c');
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    const x = track.x[k];
    const z = track.z[k];
    const y = track.y[k];
    const rx = -track.tz[k];
    const rz = track.tx[k];
    const v = (i * track.step) / TILE;
    roadPos.push(x - rx * ROAD_HALF, y + 0.04, z - rz * ROAD_HALF, x + rx * ROAD_HALF, y + 0.04, z + rz * ROAD_HALF);
    roadUv.push(0, v, 1, v);
    for (const side of [-1, 1]) {
      shPos.push(x + rx * side * (ROAD_HALF - 0.05), y + 0.035, z + rz * side * (ROAD_HALF - 0.05));
      shPos.push(x + rx * side * SH, y - 0.5, z + rz * side * SH);
      shCol.push(inner.r, inner.g, inner.b, outer.r, outer.g, outer.b);
    }
  }
  const roadIdx = [];
  const shIdx = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    roadIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); // sens trigonométrique vu du dessus : face visible vers le haut
    const s = i * 4;
    // côté gauche (points s, s+1) puis côté droit (s+2, s+3)
    shIdx.push(s, s + 1, s + 4, s + 1, s + 5, s + 4);
    shIdx.push(s + 2, s + 6, s + 3, s + 3, s + 6, s + 7);
  }
  const road = new THREE.BufferGeometry();
  road.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
  road.setAttribute('uv', new THREE.Float32BufferAttribute(roadUv, 2));
  road.setIndex(roadIdx);
  road.computeVertexNormals();
  const roadMesh = new THREE.Mesh(road, new THREE.MeshStandardMaterial({ map: asphaltTexture(anisotropy), roughness: 0.92, metalness: 0 }));
  roadMesh.receiveShadow = true;
  const sh = new THREE.BufferGeometry();
  sh.setAttribute('position', new THREE.Float32BufferAttribute(shPos, 3));
  sh.setAttribute('color', new THREE.Float32BufferAttribute(shCol, 3));
  sh.setIndex(shIdx);
  sh.computeVertexNormals();
  const shMesh = new THREE.Mesh(sh, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  shMesh.receiveShadow = true;
  return [roadMesh, shMesh];
}

// --- Végétation ---

function roundTreeGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 2.2, 7).translate(0, 1.1, 0);
  parts.push(paint(trunk, (c) => c.set('#7b5537')));
  for (const [x, y, z, r] of [[0, 3.4, 0, 1.55], [0.85, 2.9, 0.3, 1.1], [-0.75, 3.0, -0.35, 1.15], [0.1, 4.3, 0.2, 1.05]]) {
    const g = new THREE.IcosahedronGeometry(r, 2).translate(x, y, z);
    parts.push(paint(g, (c, px, py) => c.copy(C('#2f7a35')).lerp(C('#8fd166'), smoothstep(1.9, 5.2, py))));
  }
  return mergeGeometries(parts.map(indexify));
}

function pineGeometry() {
  const parts = [paint(new THREE.CylinderGeometry(0.14, 0.22, 1.6, 6).translate(0, 0.8, 0), (c) => c.set('#6b4a30'))];
  for (const [y, r, h] of [[1.6, 1.7, 2.6], [2.9, 1.35, 2.3], [4.0, 0.95, 2.0]]) {
    parts.push(paint(new THREE.ConeGeometry(r, h, 9).translate(0, y + h / 2 - 0.2, 0), (c, px, py) => c.copy(C('#1f5e33')).lerp(C('#4f9a52'), smoothstep(1.2, 6, py))));
  }
  return mergeGeometries(parts.map((g) => (g.index ? g : indexify(g))));
}

function bushGeometry() {
  const parts = [];
  for (const [x, y, z, r] of [[0, 0.45, 0, 0.75], [0.55, 0.35, 0.2, 0.5], [-0.5, 0.35, -0.1, 0.55]]) {
    parts.push(paint(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z), (c, px, py) => c.copy(C('#2d6e2f')).lerp(C('#7cc35a'), smoothstep(0, 1.1, py))));
  }
  return mergeGeometries(parts.map(indexify));
}

function blobShadowTexture() {
  const tex = canvasTexture(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  return tex;
}

// --- Construction du décor ---

export function buildScenery(scene, track, { quality = 'high', renderer = null } = {}) {
  const group = new THREE.Group();
  scene.add(group);
  const density = quality === 'high' ? 1 : quality === 'medium' ? 0.65 : 0.4;
  const castTrees = quality === 'high';
  const anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  const r = rng(11);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s3 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const e = new THREE.Euler();

  // Ciel, brume et environnement
  const sky = makeSky();
  scene.add(sky);
  scene.fog = new THREE.Fog(HORIZON, 260, 1600);
  if (renderer) {
    scene.environment = makeEnvironment(renderer, sky);
    scene.environmentIntensity = 0.55;
  }

  // Terrain, lac, route
  const lake = findLake(track);
  const height = makeGround(track, lake);
  const heightAt = (x, z) => height(x, z).h;
  group.add(buildTerrain(track, height, lake, quality));
  group.add(...buildRoad(track, anisotropy));
  if (lake) {
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(lake.r * 1.32, 72).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#3b9ad6', roughness: 0.06, metalness: 0.05, transparent: true, opacity: 0.9 }),
    );
    water.position.set(lake.x, lake.y, lake.z);
    water.receiveShadow = true;
    group.add(water);
  }

  // Emplacements libres (loin de la route, hors du lac, hors de l'aire de départ)
  const b = track.bounds;
  const start = track.frame(0);
  const free = (x, z, minRoad) => {
    const near = nearestFine(track, x, z);
    if (near.dist < minRoad) return null;
    if (lake && Math.hypot(x - lake.x, z - lake.z) < lake.r * 1.4) return null;
    if (Math.hypot(x - start.x, z - start.z) < 14) return null;
    return near;
  };
  const randomPoint = (spread) => [b.minX - spread + r() * (b.maxX - b.minX + spread * 2), b.minZ - spread + r() * (b.maxZ - b.minZ + spread * 2)];

  // Arbres : bosquets (bruit) + arbres isolés ; feuillus ronds et sapins.
  const round = [];
  const pines = [];
  const bushes = [];
  const shadows = [];
  const wantTrees = Math.round(700 * density);
  for (let tries = 0; tries < 20000 && round.length + pines.length < wantTrees; tries++) {
    const [x, z] = randomPoint(320);
    const forest = fbm(x * 0.008 + 40, z * 0.008, 3);
    if (forest < 0.05 && r() > 0.12) continue; // surtout en bosquets
    const near = free(x, z, ROAD_HALF + 7);
    if (!near) continue;
    const y = heightAt(x, z);
    const sc = 0.75 + r() * 0.75;
    if (near.dist > 140 && r() < 0.55) pines.push([x, y, z, sc * 1.1, r()]);
    else round.push([x, y, z, sc, r()]);
    shadows.push([x, y, z, sc * 2.4]);
  }
  for (let tries = 0; tries < 8000 && bushes.length < Math.round(500 * density); tries++) {
    const [x, z] = randomPoint(120);
    const near = free(x, z, ROAD_HALF + 3.5);
    if (!near || near.dist > 90) continue;
    bushes.push([x, heightAt(x, z), z, 0.6 + r() * 0.9, r()]);
  }
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const tints = ['#ffffff', '#f2ffe0', '#e4f7d6', '#fff2c4', '#ffd9a8', '#e8fff0'].map(C);
  const placeAll = (geo, list, cast, tintList) => {
    const mesh = new THREE.InstancedMesh(geo, treeMat, list.length);
    list.forEach(([x, y, z, sc, rot], i) => {
      m4.compose(v3.set(x, y - 0.15, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot * 6.28), s3.set(sc, sc * (0.9 + rot * 0.25), sc));
      mesh.setMatrixAt(i, m4);
      if (tintList) mesh.setColorAt(i, tintList[Math.floor(rot * 997) % tintList.length]);
    });
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  placeAll(roundTreeGeometry(), round, castTrees, tints);
  placeAll(pineGeometry(), pines, castTrees, null);
  placeAll(bushGeometry(), bushes, castTrees, tints);
  const blob = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    shadows.length,
  );
  shadows.forEach(([x, y, z, sc], i) => {
    m4.compose(v3.set(x, y + 0.06, z), q.identity(), s3.set(sc, 1, sc));
    blob.setMatrixAt(i, m4);
  });
  blob.renderOrder = 1;
  group.add(blob);

  // Prairie : touffes d'herbe et fleurs près de la route (là où la caméra les voit de près).
  const tuftGeo = mergeGeometries([0, 1, 2].map((k) => {
    const a = (k / 3) * Math.PI * 2;
    const g = new THREE.ConeGeometry(0.05, 0.42, 3).translate(0, 0.2, 0);
    g.rotateZ(0.35 * Math.cos(a));
    g.rotateX(0.35 * Math.sin(a));
    return paint(g, (c, px, py) => c.copy(C('#3f8a2c')).lerp(C('#a7d65d'), smoothstep(0, 0.4, py)));
  }));
  const tufts = [];
  const flowers = [];
  const FLOWER = ['#ffffff', '#ffe14d', '#ff7aa8', '#b78cff', '#ff6b4a'].map(C);
  for (let i = 0; i < Math.round(5200 * density); i++) {
    const s = r() * track.length;
    const side = r() < 0.5 ? -1 : 1;
    const lat = side * (ROAD_HALF + 2.6 + Math.pow(r(), 1.6) * 34);
    const f = track.frame(s, lat);
    if (!free(f.x, f.z, ROAD_HALF + 2.4)) continue;
    const y = heightAt(f.x, f.z);
    if (fbm(f.x * 0.05, f.z * 0.05, 2) > 0.1 && flowers.length < 2600 * density) flowers.push([f.x, y, f.z, r()]);
    else tufts.push([f.x, y, f.z, r()]);
  }
  const tuftMesh = new THREE.InstancedMesh(tuftGeo, treeMat, tufts.length);
  tufts.forEach(([x, y, z, k], i) => {
    m4.compose(v3.set(x, y - 0.03, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, k * 6.28), s3.setScalar(0.8 + k * 0.9));
    tuftMesh.setMatrixAt(i, m4);
  });
  group.add(tuftMesh);
  const flowerMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.075, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: '#222222' }),
    flowers.length,
  );
  flowers.forEach(([x, y, z, k], i) => {
    m4.compose(v3.set(x, y + 0.22 + k * 0.12, z), q.identity(), s3.setScalar(0.8 + k * 0.7));
    flowerMesh.setMatrixAt(i, m4);
    flowerMesh.setColorAt(i, FLOWER[Math.floor(k * 1000) % FLOWER.length]);
  });
  group.add(flowerMesh);

  // Rochers
  const rocks = [];
  for (let tries = 0; tries < 3000 && rocks.length < Math.round(90 * density); tries++) {
    const [x, z] = randomPoint(200);
    if (!free(x, z, ROAD_HALF + 5)) continue;
    rocks.push([x, heightAt(x, z), z, 0.5 + r() * 1.8, r()]);
  }
  const rockGeo = paint(indexify(new THREE.IcosahedronGeometry(1, 1)), (c, x, y) => c.copy(C('#8f8b80')).lerp(C('#c2bdb0'), smoothstep(-1, 1, y)));
  const rockMesh = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), rocks.length);
  rocks.forEach(([x, y, z, sc, k], i) => {
    m4.compose(v3.set(x, y - sc * 0.25, z), q.setFromEuler(e.set(k * 3, k * 9, k * 2)), s3.set(sc, sc * 0.65, sc * 1.1));
    rockMesh.setMatrixAt(i, m4);
  });
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  group.add(rockMesh);

  // Clôtures en bois le long de certains tronçons
  const posts = [];
  const rails = [];
  for (const side of [-1, 1]) {
    for (let s = 20; s < track.length - 20; s += 2.6) {
      if (fbm(s * 0.006 + side * 13, side * 7, 2) < 0.12) continue;
      const a = track.frame(s, side * (ROAD_HALF + 3.4));
      const c2 = track.frame(s + 2.6, side * (ROAD_HALF + 3.4));
      if (lake && Math.hypot(a.x - lake.x, a.z - lake.z) < lake.r * 1.4) continue;
      const ya = heightAt(a.x, a.z);
      const yc = heightAt(c2.x, c2.z);
      posts.push([a.x, ya, a.z]);
      const len = Math.hypot(c2.x - a.x, c2.z - a.z);
      const yaw = Math.atan2(c2.x - a.x, c2.z - a.z);
      const pitch = -Math.atan2(yc - ya, len);
      for (const hgt of [0.45, 0.85]) rails.push([(a.x + c2.x) / 2, (ya + yc) / 2 + hgt, (a.z + c2.z) / 2, yaw, pitch, len]);
    }
  }
  const wood = new THREE.MeshStandardMaterial({ color: '#a7774c', roughness: 0.9 });
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 1.1, 0.13).translate(0, 0.5, 0), wood, posts.length);
  posts.forEach(([x, y, z], i) => {
    m4.compose(v3.set(x, y - 0.05, z), q.identity(), s3.set(1, 1, 1));
    postMesh.setMatrixAt(i, m4);
  });
  const railMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.09, 1), wood, rails.length);
  rails.forEach(([x, y, z, yaw, pitch, len], i) => {
    m4.compose(v3.set(x, y, z), q.setFromEuler(e.set(pitch, yaw, 0, 'YXZ')), s3.set(1, 1, len));
    railMesh.setMatrixAt(i, m4);
  });
  for (const mesh of [postMesh, railMesh]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Maisons de campagne
  const houses = [];
  for (let tries = 0; tries < 4000 && houses.length < 8; tries++) {
    const s = r() * track.length;
    const side = r() < 0.5 ? -1 : 1;
    const f = track.frame(s, side * (ROAD_HALF + 16 + r() * 30));
    if (!free(f.x, f.z, ROAD_HALF + 12)) continue;
    if (houses.some((h) => Math.hypot(h.x - f.x, h.z - f.z) < 70)) continue;
    houses.push({ x: f.x, z: f.z, yaw: Math.atan2(-side * f.rx, -side * f.rz), k: r() });
  }
  const wallColors = ['#f6ead2', '#f1dcc0', '#fbf6ee', '#e9d8bf'];
  const roofColors = ['#c8553f', '#b3473a', '#d06a3c', '#8c5a3c'];
  for (const h of houses) {
    const house = new THREE.Group();
    const wMat = new THREE.MeshStandardMaterial({ color: wallColors[Math.floor(h.k * 4)], roughness: 0.9 });
    const rMat = new THREE.MeshStandardMaterial({ color: roofColors[Math.floor(h.k * 7) % 4], roughness: 0.75 });
    const dark = new THREE.MeshStandardMaterial({ color: '#4a3a30', roughness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: '#9fd0ef', roughness: 0.15, metalness: 0.2 });
    const walls = new THREE.Mesh(new THREE.BoxGeometry(7, 3.4, 5.5), wMat);
    walls.position.y = 1.7;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 7.8, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6), rMat);
    roof.scale.set(1, 0.62, 1);
    roof.position.y = 4.4;
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.6, 0.7), rMat);
    chimney.position.set(2.2, 5.4, -0.8);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 0.1), dark);
    door.position.set(-1.6, 1.05, 2.78);
    house.add(walls, roof, chimney, door);
    for (const x of [0.6, 2.4]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.1), glass);
      win.position.set(x, 2, 2.78);
      house.add(win);
    }
    house.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    house.position.set(h.x, heightAt(h.x, h.z) - 0.2, h.z);
    house.rotation.y = h.yaw;
    group.add(house);
  }

  // Bottes de foin dans les champs
  const bales = [];
  for (let tries = 0; tries < 2000 && bales.length < Math.round(24 * density); tries++) {
    const [x, z] = randomPoint(60);
    const near = free(x, z, ROAD_HALF + 10);
    if (!near || near.dist > 70) continue;
    bales.push([x, heightAt(x, z), z, r()]);
  }
  const baleMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.75, 0.75, 1.2, 16).rotateZ(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#e6c25c', roughness: 1 }),
    bales.length,
  );
  bales.forEach(([x, y, z, k], i) => {
    m4.compose(v3.set(x, y + 0.65, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, k * 6.28), s3.setScalar(1));
    baleMesh.setMatrixAt(i, m4);
  });
  baleMesh.castShadow = true;
  group.add(baleMesh);

  // Montagnes enneigées à l'horizon
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const mountainGeo = new THREE.ConeGeometry(1, 1, 16, 6);
  mountainGeo.translate(0, 0.5, 0);
  const mp = mountainGeo.attributes.position;
  for (let i = 0; i < mp.count; i++) {
    const y = mp.getY(i);
    const a = Math.atan2(mp.getZ(i), mp.getX(i));
    const wob = 1 + 0.18 * Math.sin(a * 3 + y * 5) + 0.1 * Math.sin(a * 7);
    mp.setX(i, mp.getX(i) * wob);
    mp.setZ(i, mp.getZ(i) * wob);
  }
  mountainGeo.computeVertexNormals();
  paint(mountainGeo, (c, x, y) => {
    c.copy(C('#6f8fae')).lerp(C('#9db6cc'), smoothstep(0, 0.6, y));
    c.lerp(C('#ffffff'), smoothstep(0.62, 0.72, y));
  });
  const mountains = new THREE.InstancedMesh(mountainGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }), 34);
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + r() * 0.12;
    const dist = 950 + r() * 420;
    const hgt = 150 + r() * 230;
    m4.compose(v3.set(cx + Math.cos(a) * dist, -30, cz + Math.sin(a) * dist), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r() * 6), s3.set(230 + r() * 180, hgt, 230 + r() * 180));
    mountains.setMatrixAt(i, m4);
  }
  group.add(mountains);

  // Nuages cotonneux qui dérivent lentement
  const cloudParts = [];
  for (const [x, y, z, rad] of [[0, 0, 0, 1], [1.2, -0.15, 0.2, 0.75], [-1.15, -0.2, -0.1, 0.8], [0.4, 0.45, -0.2, 0.7], [-0.5, 0.35, 0.3, 0.6], [2.1, -0.35, 0, 0.5], [-2, -0.35, 0.1, 0.5]]) {
    cloudParts.push(paint(indexify(new THREE.IcosahedronGeometry(rad, 2)).translate(x, y, z), (c, px, py) => c.copy(C('#c9d6e6')).lerp(C('#ffffff'), smoothstep(-0.6, 0.5, py))));
  }
  const cloudGeo = mergeGeometries(cloudParts);
  const clouds = new THREE.InstancedMesh(cloudGeo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), 22);
  for (let i = 0; i < 22; i++) {
    const a = r() * Math.PI * 2;
    const dist = 500 + r() * 700;
    const sc = 26 + r() * 26;
    m4.compose(v3.set(Math.cos(a) * dist, 260 + r() * 140, Math.sin(a) * dist), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r() * 6), s3.set(sc * 1.6, sc * 0.75, sc));
    clouds.setMatrixAt(i, m4);
  }
  const cloudGroup = new THREE.Group();
  cloudGroup.position.set(cx, 0, cz);
  cloudGroup.add(clouds);
  scene.add(cloudGroup);

  // Ligne de départ en damier + arche gonflable
  const checker = canvasTexture(256, 32, (ctx, cw, ch) => {
    const sq = ch / 2;
    for (let x = 0; x < cw / sq; x++) for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#141414' : '#f5f5f5';
      ctx.fillRect(x * sq, y * sq, sq, sq);
    }
  });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 1.2), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.8 }));
  line.rotation.set(-Math.PI / 2, Math.atan2(start.tx, start.tz), 0, 'YXZ');
  line.position.set(start.x, start.y + 0.06, start.z);
  line.receiveShadow = true;
  group.add(line);
  const arch = new THREE.Group();
  // Le tore (demi-anneau) est dans le plan XY local : X = travers de la route, Y = haut.
  const archMesh = new THREE.Mesh(
    new THREE.TorusGeometry(ROAD_HALF + 1.4, 0.6, 14, 48, Math.PI),
    new THREE.MeshStandardMaterial({ color: '#ff5a1f', roughness: 0.5 }),
  );
  arch.add(archMesh);
  const bannerTex = canvasTexture(1024, 160, (ctx, cw, ch) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#ff5a1f';
    ctx.font = '900 92px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MyCycleWorld', cw / 2, ch / 2 + 6);
  });
  for (const face of [1, -1]) {
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1), new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.7 }));
    banner.position.set(0, ROAD_HALF + 1.4, face * 0.62);
    if (face < 0) banner.rotation.y = Math.PI;
    arch.add(banner);
  }
  arch.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  // Axe local Z = sens de la course : l'arche enjambe la route, les banderoles regardent les coureurs.
  arch.position.set(start.x, start.y, start.z);
  arch.rotation.y = Math.atan2(start.tx, start.tz);
  group.add(arch);

  const update = (dt, camera) => {
    sky.position.copy(camera.position);
    cloudGroup.rotation.y += dt * 0.004;
  };

  return { group, sky, heightAt, lake, update, center: new THREE.Vector3(cx, (track.minY + track.maxY) / 2, cz) };
}
