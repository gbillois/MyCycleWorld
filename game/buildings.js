// Bâtiments des graphismes détaillés : boîte à outils commune (textures, matière, géométrie, niveaux de détail).
// - Textures : un tableau de textures (une couche par famille de matière : enduit, pierre, bois, tuiles, ardoise,
//   bardeaux, tôle, verre...) peint une seule fois sur des toiles, en mosaïque, avec sa carte de normales
//   (relief calculé depuis une carte de hauteur) et sa rugosité. Chaque sommet choisit sa couche.
// - Matière : une seule MeshStandardMaterial pour tous les bâtiments d'un décor (une instruction de dessin par
//   paquet), teinte et occlusion ambiante cuites dans les sommets, salissures au pied des murs, verre qui
//   reflète le ciel, vitraux légèrement lumineux, ombres des nuages.
// - Géométrie : petites primitives (faces, boîtes, murs percés d'ouvertures, toits épais, cylindres, tours)
//   écrites directement dans des tableaux, puis fusionnées par case de terrain ; les détails fins (garde-corps
//   sculptés, fleurs, bûches...) vont dans un second maillage masqué au loin.
// - Fumées de cheminée : particules calculées dans le shader (une instruction de dessin).
// - Panneaux et banderoles : un atlas de textes partagé (une instruction de dessin).
import * as THREE from 'three';
import { LAYER_COUNT, generateBuildingTextures } from './building-textures.js';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// =====================================================================
// Couches de texture
// =====================================================================

export const L = {
  PLASTER: 0, STONE: 1, ASHLAR: 2, WOODV: 3, WOODH: 4, TILE: 5, SLATE: 6, SHINGLE: 7, METAL: 8,
  GLASS: 9, PLAIN: 10, CONCRETE: 11, STRIPES: 12, STRAW: 13, CLOCK: 14, STAINED: 15, LOGS: 16,
};
// Taille (m) d'une répétition de chaque couche.
const TILE_M = [2.4, 2.2, 2.0, 2.0, 2.0, 2.0, 2.4, 2.0, 1.6, 1.2, 2.0, 4.0, 1.6, 1.4, 1, 1, 1.1];

// Tableau de textures des bâtiments, mis en cache par taille. Les couches sont calculées dans un Worker quand
// c'est possible (aucun temps pris au fil principal) : en attendant, une petite texture neutre les remplace et
// les matières déjà créées reçoivent les vraies textures dès qu'elles sont prêtes. Sans Worker (ou en cas
// d'échec), calcul direct. Les textures restent en mémoire d'un décor à l'autre (réutilisées, jamais recréées).
const texCache = new Map();
function arrayTexture(data, S, depth, srgb) {
  const t = new THREE.DataArrayTexture(data, S, S, depth);
  t.format = THREE.RGBAFormat;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = S > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = S > 1;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
function placeholderTextures() {
  const a = new Uint8ClampedArray(4 * LAYER_COUNT);
  const n = new Uint8ClampedArray(4 * LAYER_COUNT);
  for (let i = 0; i < LAYER_COUNT; i++) {
    a.set([232, 232, 232, 255], i * 4);
    n.set([128, 128, 255, 220], i * 4);
  }
  a.set([200, 205, 210, 255], L.GLASS * 4);
  n.set([128, 128, 255, 15], L.GLASS * 4);
  return { map: arrayTexture(a, 1, LAYER_COUNT, true), normal: arrayTexture(n, 1, LAYER_COUNT, false) };
}
export function buildingTextures(S = 256) {
  if (texCache.has(S)) return texCache.get(S);
  const h = { size: S, ready: false, listeners: new Set(), ...placeholderTextures() };
  texCache.set(S, h);
  const finish = ({ alb, nrm, times }) => {
    h.map = arrayTexture(alb, S, LAYER_COUNT, true);
    h.normal = arrayTexture(nrm, S, LAYER_COUNT, false);
    h.times = times;
    h.ready = true;
    for (const fn of h.listeners) fn(h);
    h.listeners.clear();
  };
  const sync = () => finish(generateBuildingTextures(S));
  let worker = null;
  try {
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && !buildingTextures.sync) {
      worker = new Worker(new URL('./building-tex-worker.js', import.meta.url), { type: 'module' });
    }
  } catch {
    worker = null;
  }
  if (!worker) {
    sync();
    return h;
  }
  worker.onmessage = (e) => {
    worker.terminate();
    if (e.data && e.data.alb) finish(e.data);
    else sync();
  };
  worker.onerror = () => {
    worker.terminate();
    if (!h.ready) sync();
  };
  worker.postMessage({ S });
  return h;
}
// Attend que les textures d'une taille soient prêtes (tests, captures).
export function buildingTexturesReady(S) {
  const h = texCache.get(S);
  if (!h || h.ready) return Promise.resolve();
  return new Promise((res) => h.listeners.add(() => res()));
}

// =====================================================================
// Matière commune des bâtiments
// =====================================================================

const BLD_CLOUD = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
float bCloudShade( vec2 p ) {
  float n = texture2D( uNoise, p * 0.0011 + uTime * vec2( 0.0016, 0.0007 ) ).r;
  return mix( 1.0, 0.5, smoothstep( 0.55, 0.75, n ) );
}`;

export function buildingMaterial(tex, shared) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const f = (n) => n.toFixed(1);
  const uBMap = { value: tex.map };
  const uBNrm = { value: tex.normal };
  if (!tex.ready) {
    tex.listeners.add((h) => {
      uBMap.value = h.map;
      uBNrm.value = h.normal;
    });
  }
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBMap = uBMap;
    sh.uniforms.uBNrm = uBNrm;
    sh.uniforms.uNoise = { value: shared.noise };
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aInfo;\nvarying vec3 vBInfo;\nvarying vec2 vBUv;\nvarying vec3 vBWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBUv = uv;\nvBInfo = aInfo;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${BLD_CLOUD}
        precision highp sampler2DArray;
        uniform sampler2DArray uBMap, uBNrm;
        varying vec3 vBInfo;
        varying vec2 vBUv;
        varying vec3 vBWorld;
        // Repère tangent tiré des dérivées écran (pas d'attribut de tangente).
        mat3 bTangentFrame( vec3 p, vec3 n, vec2 uv ) {
          vec3 q0 = dFdx( p );
          vec3 q1 = dFdy( p );
          vec2 st0 = dFdx( uv );
          vec2 st1 = dFdy( uv );
          vec3 q1perp = cross( q1, n );
          vec3 q0perp = cross( n, q0 );
          vec3 T = q1perp * st0.x + q0perp * st1.x;
          vec3 B = q1perp * st0.y + q0perp * st1.y;
          float det = max( dot( T, T ), dot( B, B ) );
          float s = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
          return mat3( T * s, B * s, n );
        }`)
      .replace('#include <color_fragment>', `
        float bLayer = floor( vBInfo.x + 0.5 );
        vec4 bAlb = texture( uBMap, vec3( vBUv, bLayer ) );
        vec4 bNrm = texture( uBNrm, vec3( vBUv, bLayer ) );
        diffuseColor.rgb *= bAlb.rgb * mix( vec3( 1.0 ), vColor, bAlb.a );
        // Salissures et remontées d'humidité au pied des murs, nuances à grande échelle
        float bN = texture2D( uNoise, vBWorld.xz * 0.06 + vBWorld.y * 0.04 ).g;
        float bGrime = ( 1.0 - smoothstep( 0.0, 1.5, vBInfo.y ) ) * smoothstep( 0.3, 0.7, bN + 0.2 );
        diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.62, 0.57, 0.48 ), bGrime * 0.6 );
        diffuseColor.rgb *= 0.92 + 0.16 * texture2D( uNoise, vBWorld.xz * 0.013 + vBWorld.y * 0.02 ).a;
        diffuseColor.rgb *= vBInfo.z;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = bNrm.a;')
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = abs( bLayer - ${f(L.GLASS)} ) < 0.5 ? 0.9 : ( abs( bLayer - ${f(L.METAL)} ) < 0.5 ? 0.35 : 0.0 );`)
      .replace('#include <normal_fragment_maps>', `
        vec3 bMapN = bNrm.xyz * 2.0 - 1.0;
        normal = normalize( bTangentFrame( - vViewPosition, normal, vBUv ) * bMapN );`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if ( abs( bLayer - ${f(L.STAINED)} ) < 0.5 ) totalEmissiveRadiance += diffuseColor.rgb * ( 1.0 - bNrm.a ) * 0.9;`)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= bCloudShade( vBWorld.xz );',
      ));
  };
  mat.customProgramCacheKey = () => 'buildings';
  return mat;
}

// =====================================================================
// Géométrie : écriture directe de faces dans des tableaux
// =====================================================================

class GeoBuf {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.c = [];
    this.inf = [];
    this.ix = [];
    this.count = 0;
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(this.c), 3, true));
    g.setAttribute('aInfo', new THREE.BufferAttribute(new Float32Array(this.inf), 3));
    g.setIndex(new THREE.BufferAttribute(this.count > 65535 ? new Uint32Array(this.ix) : new Uint16Array(this.ix), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const _c = new THREE.Color();
// Couleur linéaire (0..1) depuis un code hexadécimal, éventuellement éclaircie ou assombrie.
export function tint(hex, k = 1) {
  _c.set(hex);
  return [_c.r * k, _c.g * k, _c.b * k];
}

const _v = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Pinceau : repère courant (pile de matrices), teinte, couche ; écrit dans le tampon courant.
export class Kit {
  constructor() {
    this.g = null;
    this.m = new THREE.Matrix4();
    this.stack = [];
    this.col = [1, 1, 1];
    this.baseY = 0;
    this.groundAO = true;
    this.uvOff = [0, 0];
  }
  push() {
    this.stack.push(this.m.clone());
    return this;
  }
  pop() {
    this.m.copy(this.stack.pop());
    return this;
  }
  move(x, y, z) {
    this.m.multiply(_m4.makeTranslation(x, y, z));
    return this;
  }
  rotY(a) {
    this.m.multiply(_m4.makeRotationY(a));
    return this;
  }
  rotX(a) {
    this.m.multiply(_m4.makeRotationX(a));
    return this;
  }
  rotZ(a) {
    this.m.multiply(_m4.makeRotationZ(a));
    return this;
  }
  color(c) {
    this.col = c;
    return this;
  }
  // Un sommet (coordonnées locales), transformé dans le repère courant.
  vert(x, y, z, nx, ny, nz, u, v, layer, ao) {
    const e = this.m.elements;
    const g = this.g;
    const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
    const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
    let tx = e[0] * nx + e[4] * ny + e[8] * nz;
    let ty = e[1] * nx + e[5] * ny + e[9] * nz;
    let tz = e[2] * nx + e[6] * ny + e[10] * nz;
    const l = 1 / (Math.hypot(tx, ty, tz) || 1);
    tx *= l;
    ty *= l;
    tz *= l;
    const h = wy - this.baseY;
    if (this.groundAO) ao *= 0.5 + 0.5 * smoothstep(-0.15, 1.1, h);
    g.p.push(wx, wy, wz);
    g.n.push(tx, ty, tz);
    g.uv.push(u + this.uvOff[0], v + this.uvOff[1]);
    const c = this.col;
    g.c.push(Math.min(255, c[0] * 255) | 0, Math.min(255, c[1] * 255) | 0, Math.min(255, c[2] * 255) | 0);
    g.inf.push(layer, h, ao);
    return g.count++;
  }
  // Face plane de 3 ou 4 points (sens trigonométrique vu de devant). Coordonnées de texture projetées sur la
  // face (continues d'une face à l'autre d'un même plan) ou étirées sur la face (o.fit = [u0, v0, u1, v1]).
  face(pts, layer, o = {}) {
    let [a, b, c] = pts;
    _u.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _w.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_u, _w).normalize();
    // o.out : direction extérieure souhaitée (l'ordre des points est inversé si besoin)
    if (o.out && _n.x * o.out[0] + _n.y * o.out[1] + _n.z * o.out[2] < 0) {
      pts = pts.slice().reverse();
      if (Array.isArray(o.ao)) o = { ...o, ao: o.ao.slice().reverse() };
      _n.negate();
      [a, b, c] = pts;
    }
    if (o.flip) _n.negate();
    const tile = (o.tile || TILE_M[layer]) * (o.scale || 1);
    let U;
    if (o.U) U = _u.set(...o.U);
    else if (Math.abs(_n.y) > 0.999) U = _u.set(1, 0, 0);
    else U = _u.crossVectors(UP, _n).normalize();
    const V = _w.crossVectors(_n, U);
    const ou = o.uo || 0;
    let ov = o.vo || 0;
    if (o.v0At) ov -= (o.v0At[0] * V.x + o.v0At[1] * V.y + o.v0At[2] * V.z) / tile;
    const base = this.g.count;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      let u;
      let v;
      if (o.fit) {
        const f = o.fit;
        // Coordonnées exactes (le décalage aléatoire du bâtiment ne s'applique pas)
        u = (k === 0 || k === 3 ? f[0] : f[2]) - this.uvOff[0];
        v = (k < 2 ? f[1] : f[3]) - this.uvOff[1];
      } else {
        u = (p[0] * U.x + p[1] * U.y + p[2] * U.z) / tile + ou;
        v = (p[0] * V.x + p[1] * V.y + p[2] * V.z) / tile + ov;
      }
      const ao = o.ao === undefined ? 1 : typeof o.ao === 'number' ? o.ao : typeof o.ao === 'function' ? o.ao(p) : o.ao[k];
      this.vert(p[0], p[1], p[2], _n.x, _n.y, _n.z, u, v, layer, ao);
    }
    const ix = this.g.ix;
    if (pts.length === 3) ix.push(base, base + 1, base + 2);
    else ix.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }
  // Boîte alignée sur les axes locaux. o.skip : faces omises parmi 'px nx py ny pz nz' (ny par défaut).
  // o.ao : { b (bas), t (haut) } occlusion aux sommets du bas et du haut des faces latérales.
  box(x0, y0, z0, x1, y1, z1, layer, o = {}) {
    const skip = o.skip ?? 'ny';
    const ab = o.ao?.b ?? 1;
    const at = o.ao?.t ?? 1;
    const side = [ab, ab, at, at];
    const fo = { tile: o.tile, scale: o.scale, uo: o.uo, vo: o.vo };
    const fy = o.topU ? { ...fo, U: o.topU } : fo;
    if (!skip.includes('pz')) this.face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], layer, { ...fo, ao: side });
    if (!skip.includes('nz')) this.face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], layer, { ...fo, ao: side });
    if (!skip.includes('px')) this.face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], layer, { ...fo, ao: side });
    if (!skip.includes('nx')) this.face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], layer, { ...fo, ao: side });
    if (!skip.includes('py')) this.face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], layer, { ...fy, ao: o.ao?.top ?? at });
    if (!skip.includes('ny')) this.face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], layer, { ...fy, ao: o.ao?.bottom ?? ab });
    return this;
  }
  // Boîte centrée (cx, cz) posée en y0.
  cbox(cx, y0, cz, w, h, d, layer, o) {
    return this.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, layer, o);
  }
  // Cylindre ou tronc de cône vertical (axe Y), facettes lissées. o.caps : 't' haut, 'b' bas.
  cyl(cx, y0, cz, r0, r1, h, seg, layer, o = {}) {
    const tile = (o.tile || TILE_M[layer]) * (o.scale || 1);
    const a0 = o.a0 || 0;
    const arc = o.arc || Math.PI * 2;
    const base = this.g.count;
    const slope = (r0 - r1) / h;
    const ny = slope / Math.hypot(1, slope);
    const nr = 1 / Math.hypot(1, slope);
    const circ = arc * Math.max(r0, r1);
    const ab = o.ao?.b ?? 1;
    const at = o.ao?.t ?? 1;
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * arc;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const u = ((i / seg) * circ) / tile;
      this.vert(cx + ca * r0, y0, cz + sa * r0, ca * nr, ny, sa * nr, u, y0 / tile, layer, ab);
      this.vert(cx + ca * r1, y0 + h, cz + sa * r1, ca * nr, ny, sa * nr, u, (y0 + h) / tile, layer, at);
    }
    const ix = this.g.ix;
    for (let i = 0; i < seg; i++) {
      const k = base + i * 2;
      ix.push(k, k + 1, k + 3, k, k + 3, k + 2);
    }
    const caps = o.caps ?? 't';
    if (caps.includes('t') && r1 > 0) this.disc(cx, y0 + h, cz, r1, seg, layer, 1, a0, arc, at);
    if (caps.includes('b') && r0 > 0) this.disc(cx, y0, cz, r0, seg, layer, -1, a0, arc, ab);
    return this;
  }
  disc(cx, y, cz, r, seg, layer, dir = 1, a0 = 0, arc = Math.PI * 2, ao = 1) {
    const tile = TILE_M[layer];
    const base = this.g.count;
    this.vert(cx, y, cz, 0, dir, 0, cx / tile, cz / tile, layer, ao);
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * arc;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      this.vert(x, y, z, 0, dir, 0, x / tile, z / tile, layer, ao);
    }
    const ix = this.g.ix;
    for (let i = 0; i < seg; i++) {
      if (dir > 0) ix.push(base, base + i + 2, base + i + 1);
      else ix.push(base, base + i + 1, base + i + 2);
    }
    return this;
  }
  // Révolution autour de Y d'un profil [[rayon, y], ...] (du bas vers le haut), normales lissées.
  lathe(prof, seg, layer, o = {}) {
    const tile = (o.tile || TILE_M[layer]) * (o.scale || 1);
    const base = this.g.count;
    const n = prof.length;
    let along = 0;
    const vs = [0];
    for (let j = 1; j < n; j++) {
      along += Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]);
      vs.push(along);
    }
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (let j = 0; j < n; j++) {
        const p0 = prof[Math.max(0, j - 1)];
        const p1 = prof[Math.min(n - 1, j + 1)];
        const dr = p1[0] - p0[0];
        const dy = p1[1] - p0[1];
        const l = Math.hypot(dr, dy) || 1;
        const nr = dy / l;
        const ny = -dr / l;
        const [r, y] = prof[j];
        const ao = o.ao ? o.ao(j / (n - 1)) : 1;
        this.vert(ca * r, y, sa * r, ca * nr, ny, sa * nr, ((i / seg) * Math.PI * 2 * (o.ur || 1)) / tile, vs[j] / tile, layer, ao);
      }
    }
    const ix = this.g.ix;
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < n - 1; j++) {
        const a = base + i * n + j;
        const b = a + n;
        ix.push(a, a + 1, b + 1, a, b + 1, b);
      }
    }
    return this;
  }
  // Barre (prisme à seg faces) entre deux points.
  rod(p0, p1, r, seg, layer, o = {}) {
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz);
    _v.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(UP, _v);
    this.push();
    this.m.multiply(_m4.compose(_t.set(p0[0], p0[1], p0[2]), _q, _s.set(1, 1, 1)));
    this.cyl(0, 0, 0, r, o.r1 ?? r, len, seg, layer, { caps: o.caps ?? '', tile: o.tile, ao: o.ao });
    this.pop();
    return this;
  }
  // Petit volume à 8 faces (fleurs, feuillage, boutons).
  blob(x, y, z, r, layer = L.PLAIN, sy = 1) {
    const P = [[x + r, y, z], [x - r, y, z], [x, y + r * sy, z], [x, y - r * sy * 0.6, z], [x, y, z + r], [x, y, z - r]];
    const F = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
    for (const [a, b, c] of F) this.face([P[a], P[b], P[c]], layer, { ao: [1, 1, 1] });
    return this;
  }
  // Planche découpée symétrique (profil [[y, demi-largeur], ...] de bas en haut) dans le plan XY, épaisseur t.
  board(prof, t, layer, o = {}) {
    const z0 = -t / 2;
    const z1 = t / 2;
    for (let j = 0; j < prof.length - 1; j++) {
      const [ya, wa] = prof[j];
      const [yb, wb] = prof[j + 1];
      this.face([[-wa, ya, z1], [wa, ya, z1], [wb, yb, z1], [-wb, yb, z1]], layer, o);
      if (!o.front) this.face([[wa, ya, z0], [-wa, ya, z0], [-wb, yb, z0], [wb, yb, z0]], layer, o);
      this.face([[wa, ya, z1], [wa, ya, z0], [wb, yb, z0], [wb, yb, z1]], layer, o);
      this.face([[-wa, ya, z0], [-wa, ya, z1], [-wb, yb, z1], [-wb, yb, z0]], layer, o);
    }
    const [yt, wt] = prof[prof.length - 1];
    this.face([[-wt, yt, z1], [wt, yt, z1], [wt, yt, z0], [-wt, yt, z0]], layer, o);
    return this;
  }
  // Fuseau le long de Z (coques de bateaux) : section elliptique (sx, sy), pointu aux deux bouts.
  spindle(len, r, seg, rings, sx, sy, layer, o = {}) {
    const base = this.g.count;
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const z = (t - 0.5) * len;
      const k = Math.pow(Math.sin(Math.PI * t), 0.6);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const y = sa * r * sy * k * (sa < 0 ? 1 : o.deck ?? 1);
        this.vert(ca * r * sx * k, y, z, ca / sx, sa / sy, (0.5 - t) * 0.3, i / seg, t * 4, layer, 1);
      }
    }
    const ix = this.g.ix;
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = base + j * (seg + 1) + i;
        const b = a + seg + 1;
        ix.push(a, b + 1, b, a, a + 1, b + 1);
      }
    }
    return this;
  }
  // Mur plan (plan z = 0, normale +Z, x de x0 à x1, y de y0 à y1) percé d'ouvertures rectangulaires
  // [x0, y0, x1, y1] ; découpé aussi en hauteur aux cotes de o.ybreaks pour le dégradé d'occlusion o.ao(y).
  wall(x0, x1, y0, y1, holes, layer, o = {}) {
    const xs = new Set([x0, x1]);
    for (const h of holes) {
      xs.add(Math.max(x0, Math.min(x1, h[0])));
      xs.add(Math.max(x0, Math.min(x1, h[2])));
    }
    const X = [...xs].sort((a, b) => a - b);
    const yb = (o.ybreaks || []).filter((y) => y > y0 && y < y1);
    const ao = o.ao || (() => 1);
    for (let i = 0; i < X.length - 1; i++) {
      const xa = X[i];
      const xb = X[i + 1];
      if (xb - xa < 1e-4) continue;
      const xm = (xa + xb) / 2;
      const cut = holes.filter((h) => h[0] < xm && h[2] > xm).map((h) => [h[1], h[3]]).sort((a, b) => a[0] - b[0]);
      const ys = [y0];
      for (const [ha, hb] of cut) ys.push(ha, hb);
      ys.push(y1);
      for (let k = 0; k < ys.length; k += 2) {
        const ya = Math.max(y0, ys[k]);
        const yz = Math.min(y1, ys[k + 1]);
        if (yz - ya < 1e-4) continue;
        const rows = [ya, ...yb.filter((y) => y > ya && y < yz), yz];
        for (let r = 0; r < rows.length - 1; r++) {
          const a = rows[r];
          const b = rows[r + 1];
          this.face([[xa, a, 0], [xb, a, 0], [xb, b, 0], [xa, b, 0]], layer, { ao: [ao(a), ao(a), ao(b), ao(b)], tile: o.tile });
        }
      }
    }
    return this;
  }
  // Dalle épaisse (toit d'appentis, auvent, marquise) : quatre coins du dessus dans le sens trigonométrique vu
  // d'au-dessus, épaisseur t vers le bas. o : { under: teinte de la sous-face, edge: teinte des chants, underLayer }
  slab(pts, t, layer, o = {}) {
    const [a, b, , d] = pts;
    _u.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _w.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    _n.crossVectors(_u, _w).normalize();
    if (_n.y < 0) {
      pts = pts.slice().reverse();
      _n.negate();
    }
    const nx = _n.x * t;
    const ny = _n.y * t;
    const nz = _n.z * t;
    const low = pts.map((p) => [p[0] - nx, p[1] - ny, p[2] - nz]);
    const col = this.col;
    this.face(pts, layer, { v0At: o.v0At, ao: o.ao, U: o.U, tile: o.tile });
    this.col = o.under || col;
    this.face(low.slice().reverse(), o.underLayer ?? L.WOODH, { ao: o.underAO ?? 0.55, scale: 0.6 });
    this.col = o.edge || col;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.face([low[i], low[j], pts[j], pts[i]], o.edgeLayer ?? L.WOODV, { ao: 0.85, scale: 0.5 });
    }
    this.col = col;
    return this;
  }
  // Polygone convexe plan (éventail depuis le premier point).
  poly(pts, layer, o = {}) {
    for (let k = 1; k < pts.length - 1; k++) this.face([pts[0], pts[k], pts[k + 1]], layer, o.aoFn ? { ...o, ao: [o.aoFn(pts[0]), o.aoFn(pts[k]), o.aoFn(pts[k + 1])] } : o);
    return this;
  }
}
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _t = new THREE.Vector3();
const _s = new THREE.Vector3();

// =====================================================================
// Fumées de cheminée (particules animées dans le shader)
// =====================================================================

function makeSmoke(shared, sources, perSource) {
  const n = sources.length * perSource;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n * 2);
  let k = 0;
  sources.forEach(([x, y, z], si) => {
    for (let i = 0; i < perSource; i++, k++) {
      pos.set([x, y, z], k * 3);
      seed[k * 2] = i / perSource;
      seed[k * 2 + 1] = si * 0.37 + i * 0.13;
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
  const uPx = { value: 400 };
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uPx },
    vertexShader: /* glsl */ `
      uniform float uTime, uPx;
      attribute vec2 aSeed;
      varying float vA;
      varying float vT;
      void main() {
        float t = fract( uTime * 0.075 + aSeed.x + aSeed.y * 0.21 );
        vT = t;
        vec3 p = position;
        float s = aSeed.y * 6.2831;
        p += vec3( 1.6 * t + sin( s + t * 5.0 ) * 0.5 * t, t * 7.5, 0.9 * t + cos( s * 1.3 + t * 4.0 ) * 0.5 * t );
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        float d = -mv.z;
        float size = 0.55 + t * 3.2;
        vA = smoothstep( 0.0, 0.08, t ) * pow( 1.0 - t, 1.6 ) * ( 1.0 - smoothstep( 260.0, 520.0, d ) );
        gl_PointSize = min( 256.0, size * uPx / max( d, 0.5 ) );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      varying float vT;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float r = length( q );
        float a = smoothstep( 0.5, 0.15, r ) * vA * 0.42;
        if ( a < 0.004 ) discard;
        vec3 c = mix( vec3( 0.78, 0.78, 0.8 ), vec3( 0.93, 0.93, 0.95 ), vT ) * ( 1.0 - q.y * 0.25 );
        gl_FragColor = vec4( c, a );
      }`,
    transparent: true,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  const size = new THREE.Vector2();
  pts.onBeforeRender = (renderer, scene, camera) => {
    renderer.getDrawingBufferSize(size);
    uPx.value = (size.y * camera.projectionMatrix.elements[5]) / 2;
  };
  pts.renderOrder = 2;
  pts.frustumCulled = false;
  return pts;
}

// =====================================================================
// Atlas des panneaux et banderoles (textes)
// =====================================================================

// Cases de l'atlas (pixels, toile 1024 × 1024) : [x, y, largeur, hauteur].
export const SIGN = {
  brand: [0, 0, 1024, 128], // MyCycleWorld
  sponsor0: [0, 128, 256, 128], sponsor1: [256, 128, 256, 128], sponsor2: [512, 128, 256, 128], sponsor3: [768, 128, 256, 128],
  start: [0, 256, 512, 128], finish: [512, 256, 512, 128],
  clock: [0, 384, 256, 64], rescue: [256, 384, 512, 64], cafe: [768, 384, 256, 64],
  club: [0, 448, 1024, 64],
  checker: [0, 512, 512, 64], brandSmall: [512, 512, 512, 64],
  flag0: [0, 576, 128, 448], flag1: [128, 576, 128, 448], flag2: [256, 576, 128, 448], flag3: [384, 576, 128, 448],
  lifebuoy: [512, 576, 128, 128], menu: [640, 576, 128, 128],
};
let signCache = null;
export function signAtlas() {
  if (signCache) return signCache;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1024;
  const c = cv.getContext('2d');
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  const text = (s, x, y, w, h, fg, px, weight = 900, italic = '') => {
    c.fillStyle = fg;
    c.font = `${italic} ${font(weight, px)}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    let size = px;
    while (c.measureText(s).width > w * 0.9 && size > 10) {
      size -= 2;
      c.font = `${italic} ${font(weight, size)}`;
    }
    c.fillText(s, x + w / 2, y + h / 2 + size * 0.05);
  };
  const band = (r, bg, bg2) => {
    const g = c.createLinearGradient(0, r[1], 0, r[1] + r[3]);
    g.addColorStop(0, bg);
    g.addColorStop(1, bg2 || bg);
    c.fillStyle = g;
    c.fillRect(r[0], r[1], r[2], r[3]);
  };
  // Marque principale : blanc, liseré orange, texte orange et bleu
  let r = SIGN.brand;
  band(r, '#ffffff', '#eef1f6');
  c.fillStyle = '#ff5a1f';
  c.fillRect(r[0], r[1], r[2], 10);
  c.fillRect(r[0], r[1] + r[3] - 10, r[2], 10);
  c.font = font(900, 84);
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  c.fillStyle = '#ff5a1f';
  c.fillText('MyCycle', 520, 68);
  c.textAlign = 'left';
  c.fillStyle = '#1f4fd1';
  c.fillText('World', 524, 68);
  // Partenaires (marques imaginaires)
  const sp = [
    ['TURBO', '#14161c', '#ffd23f', 'italic'], ['VéloVert', '#2f9e44', '#ffffff', ''], ['Fromages du Col', '#ffffff', '#c4202f', ''], ['PÉDALE+', '#1f4fd1', '#ffffff', 'italic'],
  ];
  sp.forEach(([s, bg, fg, it], i) => {
    const q = SIGN[`sponsor${i}`];
    band(q, bg);
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 4;
    c.strokeRect(q[0] + 6, q[1] + 6, q[2] - 12, q[3] - 12);
    text(s, q[0], q[1], q[2], q[3], fg, 54, 900, it);
  });
  r = SIGN.start;
  band(r, '#2b6cff', '#1d4fc4');
  text('DÉPART', r[0], r[1], r[2], r[3], '#ffffff', 84);
  r = SIGN.finish;
  band(r, '#ffffff', '#e9e9e9');
  text('ARRIVÉE', r[0], r[1], r[2], r[3], '#ff5a1f', 84);
  // Chronomètre (affichage à segments)
  r = SIGN.clock;
  band(r, '#101216');
  c.fillStyle = '#ff3b2f';
  c.font = `700 46px ui-monospace, Menlo, Consolas, monospace`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('00:00.0', r[0] + r[2] / 2, r[1] + r[3] / 2 + 2);
  r = SIGN.rescue;
  band(r, '#e0384b');
  text('POSTE DE SECOURS', r[0], r[1], r[2], r[3], '#ffffff', 40);
  r = SIGN.cafe;
  band(r, '#2d4a33');
  c.strokeStyle = '#d9b75a';
  c.lineWidth = 3;
  c.strokeRect(r[0] + 5, r[1] + 5, r[2] - 10, r[3] - 10);
  text('CAFÉ DES ALPES', r[0], r[1], r[2], r[3], '#f3e7c4', 30, 800);
  r = SIGN.club;
  band(r, '#f4f1e8');
  text("CLUB D'AVIRON DU LAC BLEU", r[0], r[1], r[2], r[3], '#1f3f7a', 44, 800);
  // Damier
  r = SIGN.checker;
  for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
    c.fillStyle = (x + y) % 2 ? '#141414' : '#f5f5f5';
    c.fillRect(r[0] + x * 32, r[1] + y * 32, 32, 32);
  }
  r = SIGN.brandSmall;
  band(r, '#ff5a1f', '#e94d14');
  text('MyCycleWorld', r[0], r[1], r[2], r[3], '#ffffff', 44, 900, 'italic');
  // Drapeaux « plume » (texte vertical)
  const flags = [['#ff5a1f', '#ffffff', 'MyCycleWorld'], ['#1f4fd1', '#ffd23f', 'TURBO'], ['#2f9e44', '#ffffff', 'VéloVert'], ['#ffd23f', '#14161c', 'PÉDALE+']];
  flags.forEach(([bg, fg, s], i) => {
    const q = SIGN[`flag${i}`];
    band(q, bg);
    c.save();
    c.translate(q[0] + q[2] / 2, q[1] + q[3] / 2);
    c.rotate(-Math.PI / 2);
    text(s, -q[3] / 2, -q[2] / 2, q[3], q[2], fg, 64, 900, 'italic');
    c.restore();
  });
  // Bouée et ardoise du menu
  r = SIGN.lifebuoy;
  c.fillStyle = '#f4f4f2';
  c.fillRect(r[0], r[1], r[2], r[3]);
  r = SIGN.menu;
  band(r, '#2b2b2b');
  c.fillStyle = '#f2f2f2';
  c.font = font(700, 20);
  c.textAlign = 'center';
  c.fillText('MENU', r[0] + 64, r[1] + 26);
  c.font = font(400, 14);
  ['Café 2,00', 'Chocolat 3,50', 'Tarte 4,00', 'Crêpe 3,00'].forEach((s, i) => c.fillText(s, r[0] + 64, r[1] + 52 + i * 18));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  signCache = tex;
  return tex;
}

// Panneaux texturés (atlas) : quads posés dans le repère courant d'un Kit.
class SignBuf {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.ix = [];
  }
  // Quad de largeur w et hauteur h centré en (x, y, z) local, normale +Z, case rect (o.rot : texte vertical).
  quad(kit, x, y, z, w, h, rect, o = {}) {
    const e = kit.m.elements;
    const T = (px, py, pz) => [e[0] * px + e[4] * py + e[8] * pz + e[12], e[1] * px + e[5] * py + e[9] * pz + e[13], e[2] * px + e[6] * py + e[10] * pz + e[14]];
    const nx = e[8];
    const ny = e[9];
    const nz = e[10];
    const l = Math.hypot(nx, ny, nz) || 1;
    const rep = o.repeat || 1;
    const [rx, ry, rw, rh] = rect;
    const u0 = rx / 1024;
    const u1 = (rx + rw) / 1024;
    const v0 = 1 - (ry + rh) / 1024;
    const v1 = 1 - ry / 1024;
    const segs = rep;
    for (let s = 0; s < segs; s++) {
      const xa = x - w / 2 + (w * s) / segs;
      const xb = x - w / 2 + (w * (s + 1)) / segs;
      const b = this.p.length / 3;
      this.p.push(...T(xa, y - h / 2, z), ...T(xb, y - h / 2, z), ...T(xb, y + h / 2, z), ...T(xa, y + h / 2, z));
      for (let k = 0; k < 4; k++) this.n.push(nx / l, ny / l, nz / l);
      if (o.rot) this.uv.push(u1, v0, u1, v1, u0, v1, u0, v0);
      else this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      this.ix.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    return this;
  }
  toMesh() {
    if (!this.ix.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setIndex(this.ix);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: signAtlas(), roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1 }));
    m.receiveShadow = true;
    return m;
  }
}

// =====================================================================
// Ensemble de bâtiments d'un décor : cases de terrain, niveaux de détail, fumées, panneaux
// =====================================================================

const QUALITY = {
  high: { tex: 512, detail: 230, castDetail: true, smoke: 14 },
  medium: { tex: 256, detail: 110, castDetail: false, smoke: 9 },
  low: { tex: 256, detail: 70, castDetail: false, smoke: 6 },
};

export class BuildingSet {
  constructor({ quality = 'high', shared, cell = 100, cast = true }) {
    this.q = QUALITY[quality] || QUALITY.high;
    this.quality = quality;
    this.lite = quality !== 'high'; // détails simplifiés (tablette, qualité basse)
    this.shared = shared;
    this.cellSize = cell;
    this.cast = cast && quality !== 'low';
    this.cells = new Map();
    this.kit = new Kit();
    this.smokes = [];
    this.signs = new SignBuf();
    this.sites = [];
    this.cur = null;
    this.chunks = [];
  }
  // Commence un bâtiment posé en (x, y, z) (sol), tourné de yaw ; renvoie le pinceau.
  begin(x, y, z, yaw = 0, uvSeed = 0) {
    const key = `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
    let c = this.cells.get(key);
    if (!c) {
      c = { shell: new GeoBuf(), detail: new GeoBuf() };
      this.cells.set(key, c);
    }
    this.cur = c;
    const k = this.kit;
    k.m.makeRotationY(yaw).setPosition(x, y, z);
    k.stack.length = 0;
    k.baseY = y;
    k.groundAO = true;
    k.col = [1, 1, 1];
    k.uvOff = [((uvSeed * 7.31) % 1) * 3, ((uvSeed * 3.17) % 1) * 3];
    k.g = c.shell;
    return k;
  }
  shell() {
    this.kit.g = this.cur.shell;
    return this.kit;
  }
  detail() {
    this.kit.g = this.cur.detail;
    return this.kit;
  }
  // Source de fumée au point local (x, y, z) du repère courant.
  smoke(x, y, z) {
    const e = this.kit.m.elements;
    this.smokes.push([e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]);
  }
  site(kind, x, y, z) {
    this.sites.push({ kind, p: [x, y, z] });
  }
  // Construit les maillages (une matière pour tout) et les ajoute au groupe.
  build(group) {
    const tex = buildingTextures(this.q.tex);
    const mat = buildingMaterial(tex, this.shared);
    for (const c of this.cells.values()) {
      if (c.shell.count) {
        const m = new THREE.Mesh(c.shell.toGeometry(), mat);
        m.castShadow = this.cast;
        m.receiveShadow = true;
        group.add(m);
      }
      if (c.detail.count) {
        const g = c.detail.toGeometry();
        const m = new THREE.Mesh(g, mat);
        m.castShadow = this.cast && this.q.castDetail;
        m.receiveShadow = true;
        group.add(m);
        this.chunks.push({ mesh: m, center: g.boundingSphere.center, radius: g.boundingSphere.radius });
      }
    }
    this.cells.clear();
    if (this.smokes.length) group.add(makeSmoke(this.shared, this.smokes, this.q.smoke));
    const sm = this.signs.toMesh();
    if (sm) group.add(sm);
    if (this.sites.length) group.userData.sites = this.sites;
    return this;
  }
  // Détails fins visibles seulement à proximité (aucune allocation).
  update(camera) {
    const p = camera.position;
    const d = this.q.detail;
    for (const ch of this.chunks) ch.mesh.visible = p.distanceTo(ch.center) - ch.radius < d;
  }
}
