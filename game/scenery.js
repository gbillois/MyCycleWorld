// Décor détaillé du circuit : ciel diffusant avec nuages, brume de perspective aérienne, terrain texturé
// (herbe, terre, roche, sable, neige mélangés par hauteur, ombres de nuages), herbe dense et fleurs
// calculées sur la carte graphique, arbres détaillés qui ondulent au vent (niveaux de détail), route
// en enrobé avec flaques, glissières et murets en montagne, spectateurs, montagnes lointaines, oiseaux.
// Tout est généré (aucun fichier). Qualités : 'high' (ordinateur), 'medium' (tablette, iPad), 'low'.
import * as THREE from 'three';
import { ROAD_HALF, rng, mod } from './track.js';
import { mergeGeometries, paint, indexify, colored } from './geom.js';
import { addFarm, addAlpineVillage, addAlpineCows, addCoast, coastZ } from './features.js';
import {
  SUN_DIR as SUN, MOODS, applyMood, installFog, makeSkyDome, makeEnvironment as makeSkyEnvironment,
  noiseTexture, makeHash, periodicFbm, makeBirds, makeMotes,
} from './atmosphere.js';
import {
  Forest, deciduousGeometry, pineGeometry, bushGeometry, palmGeometry, rockGeometry, windMaterial, leafAtlas,
  makeFieldMaps, makeRoadMap, makeGrassField,
} from './nature.js';
import { makeWater } from './water.js';
import { buildCourseCrowd } from './people.js';

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

// --- Thèmes (un par type de circuit) ---
const THEMES = {
  meadow: {
    mood: 'meadow', hills: 17, farSlope: 0.3, grass: ['#43802d', '#559437', '#72a241', '#8fab4c'],
    trees: 4500, pineRatio: 0.55, pineNear: false, palms: false, fences: true, flowers: 2600, rocks: 90, bales: 24,
    mountains: { h: [150, 260], snow: 0.62 }, rock: '#80745f', dirt: '#7d6a4b', sand: '#d9c796',
    walls: false, fans: 1,
  },
  alpine: {
    mood: 'alpine', hills: 34, farSlope: 0.6, grass: ['#356b27', '#477f31', '#62903b', '#7f9c4a'],
    trees: 8500, pineRatio: 0.85, pineNear: true, palms: false, fences: true, flowers: 1800, rocks: 420, bales: 0,
    mountains: { h: [300, 380], snow: 0.4 }, rock: '#7c6f5f', dirt: '#6f6047', sand: '#cfc3a0',
    walls: true, fans: 1.3,
  },
  coast: {
    mood: 'coast', hills: 7, farSlope: 0.12, grass: ['#78a242', '#93b555', '#b0bf68', '#c9c983'],
    trees: 900, pineRatio: 0.6, pineNear: true, palms: true, fences: false, flowers: 900, rocks: 50, bales: 0,
    mountains: { h: [110, 170], snow: 0.95 }, rock: '#9c958a', dirt: '#8a7653', sand: '#e6d4a2',
    walls: false, fans: 0.8,
  },
};

// --- Ciel (version d'origine, gardée pour le bassin d'aviron en graphismes simples) ---

export const SUN_DIR = SUN;
export const HORIZON = C('#d6ecff');
const LEGACY_SUN = new THREE.Vector3(-0.5, 0.62, 0.6).normalize();

export function makeSky(colors = ['#3a86e0', '#8cc4f5', '#d6ecff']) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: C(colors[0]) },
      mid: { value: C(colors[1]) },
      horizon: { value: C(colors[2]) },
      ground: { value: C('#b9d3b0') },
      sunDir: { value: LEGACY_SUN.clone() },
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
export function makeEnvironment(renderer, sky) {
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

// Profil le long du tracé (0..1 par mètre), adouci sur ±ramp mètres : passerelle, zones aplanies.
function alongTrack(track, test, ramp) {
  const n = track.count;
  const raw = Float32Array.from({ length: n }, (_, i) => (test(i) ? 1 : 0));
  const out = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) {
    let m = raw[i];
    if (m < 1) {
      for (let j = 1; j <= ramp; j++) {
        if (raw[mod(i + j, n)] || raw[mod(i - j, n)]) {
          m = 1 - j / (ramp + 1);
          break;
        }
      }
    }
    out[i] = smoothstep(0, 1, m);
  }
  out[n] = out[0];
  return out;
}

// Altitude de la route la plus proche, sur une grille de 8 m, floutée sur ~50 m : une surface continue
// qui relie en douceur des tronçons de route d'altitudes différentes.
function smoothRoadField(track, margin = 560) {
  const b = track.bounds;
  const cell = 8;
  const x0 = b.minX - margin;
  const z0 = b.minZ - margin;
  const nx = Math.ceil((b.maxX - b.minX + margin * 2) / cell) + 1;
  const nz = Math.ceil((b.maxZ - b.minZ + margin * 2) / cell) + 1;
  let g = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell;
      const z = z0 + j * cell;
      let best = Infinity;
      let y = 0;
      for (let k = 0; k < track.count; k += 4) {
        const d = (track.x[k] - x) ** 2 + (track.z[k] - z) ** 2;
        if (d < best) { best = d; y = track.y[k]; }
      }
      g[j * nx + i] = y;
    }
  }
  // Flou en boîte séparable, deux passes (proche d'un flou gaussien).
  const R = 6;
  const tmp = new Float32Array(nx * nz);
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        let sum = 0;
        for (let k = -R; k <= R; k++) sum += g[j * nx + Math.min(nx - 1, Math.max(0, i + k))];
        tmp[j * nx + i] = sum / (2 * R + 1);
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        let sum = 0;
        for (let k = -R; k <= R; k++) sum += tmp[Math.min(nz - 1, Math.max(0, j + k)) * nx + i];
        g[j * nx + i] = sum / (2 * R + 1);
      }
    }
  }
  return (x, z) => {
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
}

function makeGround(track, lake, theme, { coast = null, seaY = 0, flat = [] } = {}) {
  const n = track.count;
  const field = smoothRoadField(track);
  // Sous la passerelle, le sol est plus bas (on voit les pilotis) ; sur les zones aménagées, le relief est adouci.
  const dip = alongTrack(track, (i) => track.surf[i] === 'boardwalk', 12);
  const calm = alongTrack(track, (i) => flat.some(([a, b]) => i / n >= a && i / n <= b), 30);
  const base = (x, z, near) => {
    const d = near.dist;
    // Loin de la route, l'altitude de base vient d'un champ lissé : pas de marche entre deux lacets empilés.
    const y = near.y + (field(x, z) - near.y) * smoothstep(ROAD_HALF + 2, ROAD_HALF + 45, d);
    let roadY = y - 0.45 - dip[near.index] * 1.5;
    if (coast) roadY = Math.max(roadY, Math.min(near.y - 0.45, seaY + 0.35)); // jamais sous le niveau de la mer
    const t = smoothstep(ROAD_HALF + 2.2, ROAD_HALF + 42, d);
    const amp = 1 - calm[near.index] * 0.8 * (1 - smoothstep(60, 140, d));
    const hills = (fbm(x * 0.0042, z * 0.0042, 4) * theme.hills + fbm(x * 0.017 + 11, z * 0.017 - 7, 3) * 3.2) * amp;
    const far = Math.max(0, d - 150) * theme.farSlope;
    let h = roadY + t * (hills + 2.5 + far);
    if (coast) {
      // Plage en pente douce jusqu'au rivage, puis fond marin.
      const zc = coastZ(coast, x);
      const dune = fbm(x * 0.03, z * 0.03, 2) * 0.6;
      const beach = Math.max(seaY - 6, seaY + (zc - z) * 0.075 + (z < zc ? dune * smoothstep(zc, zc - 20, z) : 0));
      const k = smoothstep(zc - 70, zc - 12, z) * smoothstep(ROAD_HALF + 1.5, ROAD_HALF + 9, d);
      h += (beach - h) * Math.max(k, smoothstep(zc, zc + 25, z));
    }
    return h;
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

// --- Textures de détail du sol (générées une fois, en mosaïque) ---
// Détail RGBA : R herbe, G roche (fissures), B sable (grain et rides), A terre et gravillons.
// Normales RGBA : RG roche / terre, BA herbe / sable.
let detailCache = null;
function terrainDetailMaps() {
  if (detailCache) return detailCache;
  const N = 256;
  const hR = makeHash(31), hG = makeHash(32), hG2 = makeHash(35), hB = makeHash(33), hA = makeHash(34), hP = makeHash(36);
  const ch = [0, 1, 2, 3].map(() => new Float32Array(N * N));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const i = y * N + x;
      ch[0][i] = periodicFbm(hR, u * 32, v * 32, 32, 3) * 0.65 + periodicFbm(hR, u * 8, v * 8, 8, 2) * 0.35;
      const rg = periodicFbm(hG, u * 6, v * 6, 6, 5);
      const ridge = 1 - Math.abs(rg * 2 - 1);
      ch[1][i] = ridge * ridge * 0.75 + periodicFbm(hG2, u * 24, v * 24, 24, 2) * 0.25;
      ch[2][i] = 0.5 + 0.18 * Math.sin(Math.PI * 2 * (v * 12 + periodicFbm(hB, u * 4, v * 4, 4, 2) * 2)) + (hP(x, y) - 0.5) * 0.35;
      ch[3][i] = smoothstep(0.42, 0.72, periodicFbm(hA, u * 20, v * 20, 20, 3)) * 0.6 + hP(x >> 1, y >> 1) * 0.4;
    }
  }
  const norm = (arr) => {
    let lo = Infinity, hi = -Infinity;
    for (const a of arr) { lo = Math.min(lo, a); hi = Math.max(hi, a); }
    for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - lo) / (hi - lo || 1);
  };
  ch.forEach(norm);
  const det = new Uint8Array(N * N * 4);
  const nrm = new Uint8Array(N * N * 4);
  const at = (a, x, y) => a[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      for (let c = 0; c < 4; c++) det[i * 4 + c] = Math.round(ch[c][i] * 255);
      const h1 = (xx, yy) => at(ch[1], xx, yy) * 0.7 + at(ch[3], xx, yy) * 0.3;
      const h2 = (xx, yy) => at(ch[0], xx, yy) * 0.6 + at(ch[2], xx, yy) * 0.4;
      const enc = (h, s) => {
        const dx = (h(x + 1, y) - h(x - 1, y)) * s;
        const dy = (h(x, y + 1) - h(x, y - 1)) * s;
        const l = Math.hypot(dx, dy, 1);
        return [Math.round((-dx / l * 0.5 + 0.5) * 255), Math.round((-dy / l * 0.5 + 0.5) * 255)];
      };
      const [a, b] = enc(h1, 6);
      const [c2, d] = enc(h2, 4);
      nrm.set([a, b, c2, d], i * 4);
    }
  }
  const mk = (data) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  detailCache = { map: mk(det), normal: mk(nrm) };
  return detailCache;
}

// Ombres des nuages qui défilent (assombrit seulement la lumière directe du soleil).
const CLOUD_GLSL = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
float cloudShadeAt( vec2 p ) {
  float n = texture2D( uNoise, p * 0.0011 + uTime * vec2( 0.0016, 0.0007 ) ).r;
  return mix( 1.0, 0.5, smoothstep( 0.55, 0.75, n ) );
}`;
const withCloudShade = (frag) => frag.replace(
  '#include <lights_fragment_begin>',
  THREE.ShaderChunk.lights_fragment_begin.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= cloudShade;',
  ),
);

// Matière du terrain : couleur de l'herbe dans les sommets, poids des couches (roche, sable, terre, neige)
// en attributs, détails et normales en texture ; transitions découpées par le relief du détail.
export function terrainMaterial(theme, shared, quality) {
  const detail = terrainDetailMaps();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const uniforms = {
    uDetail: { value: detail.map },
    uDetailN: { value: detail.normal },
    uNoise: { value: shared.noise },
    uTime: shared.uTime,
    uRock: { value: C(theme.rock) },
    uSand: { value: C(theme.sand) },
    uDirt: { value: C(theme.dirt) },
    uSnow: { value: C('#f2f5fa') },
    uWetSand: { value: C('#a8936a') },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aMix;\nattribute float aWet;\nvarying vec4 vMix;\nvarying float vWet;\nvarying vec3 vTPos;\nvarying vec3 vTNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMix = aMix;\nvWet = aWet;\nvTPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvTNormal = normalize( mat3( modelMatrix ) * normal );');
    sh.fragmentShader = withCloudShade(sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${quality === 'high' ? '#define TRIPLANAR' : ''}
        ${CLOUD_GLSL}
        uniform sampler2D uDetail, uDetailN;
        uniform vec3 uRock, uSand, uDirt, uSnow, uWetSand;
        varying vec4 vMix;
        varying float vWet;
        varying vec3 vTPos;
        varying vec3 vTNormal;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 tp = vTPos.xz;
        vec4 d1 = texture2D( uDetail, tp * 0.21 );
        vec4 d2 = texture2D( uDetail, tp * 0.053 + vec2( 0.31, 0.77 ) );
        float macro = texture2D( uNoise, tp * 0.0032 ).g;
        float macro2 = texture2D( uNoise, tp * 0.019 ).a;
        vec3 grass = diffuseColor.rgb * ( 0.74 + d1.r * 0.36 + ( d2.r - 0.5 ) * 0.3 ) * ( 0.78 + macro * 0.4 );
        grass = mix( grass, grass * vec3( 1.18, 1.06, 0.66 ), smoothstep( 0.55, 0.85, macro2 ) * 0.4 );
        #ifdef TRIPLANAR
          vec3 bw = pow( abs( vTNormal ), vec3( 4.0 ) );
          bw /= dot( bw, vec3( 1.0 ) );
          float rk = texture2D( uDetail, vTPos.zy * 0.16 ).g * bw.x + texture2D( uDetail, vTPos.xz * 0.16 ).g * bw.y + texture2D( uDetail, vTPos.xy * 0.16 ).g * bw.z;
        #else
          float rk = mix( d1.g, d2.g, 0.4 );
        #endif
        vec3 rock = uRock * vec3( 1.04, 1.0, 0.94 ) * ( 0.38 + rk * 1.0 ) * ( 0.85 + macro * 0.3 );
        vec3 sand = uSand * ( 0.88 + d1.b * 0.22 );
        sand = mix( sand, uWetSand * ( 0.9 + d1.b * 0.12 ), vWet );
        vec3 dirt = uDirt * ( 0.68 + d1.a * 0.6 );
        vec3 snow = uSnow * ( 0.8 + d1.b * 0.1 ) * ( 0.92 + macro * 0.12 );
        float wR = clamp( ( vMix.x - 0.5 ) * 2.6 + ( rk - 0.5 ) * 1.6 + 0.5, 0.0, 1.0 );
        float wS = clamp( ( vMix.y - 0.5 ) * 3.0 + ( d1.b - 0.5 ) * 0.8 + 0.5, 0.0, 1.0 );
        float wD = clamp( ( vMix.z - 0.5 ) * 2.4 + ( d1.a - 0.5 ) * 1.4 + 0.5, 0.0, 1.0 );
        float wN = clamp( ( vMix.w - 0.5 ) * 3.0 + ( d1.b - 0.5 ) + 0.5, 0.0, 1.0 );
        vec3 ground = mix( grass, dirt, wD );
        ground = mix( ground, sand, wS );
        ground = mix( ground, rock, wR );
        ground = mix( ground, snow, wN );
        diffuseColor.rgb = ground;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix( mix( 0.97, 0.88, wR ), 0.42, vWet * wS );
        roughnessFactor = mix( roughnessFactor, 0.62, wN );`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec4 dn = texture2D( uDetailN, tp * 0.21 );
        vec2 nd = ( dn.ba * 2.0 - 1.0 ) * 0.55 * ( 1.0 - max( wR, wD ) ) * ( 1.0 - wS * 0.7 ) + ( dn.rg * 2.0 - 1.0 ) * ( wR * 1.1 + wD * 0.6 );
        nd *= ( 1.0 - wN * 0.7 ) / ( 1.0 + length( vViewPosition ) * 0.025 );
        vec3 nW = normalize( vTNormal + vec3( nd.x, 0.0, nd.y ) );
        normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
        float cloudShade = cloudShadeAt( tp );`));
  };
  mat.customProgramCacheKey = () => `terrain-${quality}`;
  return mat;
}

const GRAVEL = C('#bcae8f');
const SAND = C('#e3d3a1');
const WOOD = C('#6e4b2e');

function buildTerrain(track, height, lake, quality, theme, coast, seaY, shared) {
  const GRASS = theme.grass.map(C);
  const snowLine = track.maxY + 220; // la neige est surtout sur les sommets lointains
  const b = track.bounds;
  const margin = 520;
  const cell = quality === 'high' ? 4.5 : quality === 'medium' ? 7 : 9;
  const w = b.maxX - b.minX + margin * 2;
  const d = b.maxZ - b.minZ + margin * 2;
  const gx = Math.ceil(w / cell);
  const gz = Math.ceil(d / cell);
  const geo = new THREE.PlaneGeometry(w, d, gx, gz);
  geo.rotateX(-Math.PI / 2);
  geo.translate((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  const p = geo.attributes.position;
  const dist = new Float32Array(p.count);
  const near = new Uint32Array(p.count);
  const heights = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const r = height(p.getX(i), p.getZ(i));
    p.setY(i, r.h);
    heights[i] = r.h;
    dist[i] = r.near.dist;
    near[i] = r.near.index;
  }
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const mix = new Float32Array(p.count * 4);
  const wet = new Float32Array(p.count);
  const ground = new Uint8Array(p.count * 4);
  const c = new THREE.Color();
  const dune = C('#a9a768');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const y = p.getY(i);
    const ny = n.getY(i);
    // Prairie : mélange de verts et de jaunes selon un bruit lent.
    const k = (fbm(x * 0.012, z * 0.012, 3) + 1) / 2;
    const idx = Math.min(GRASS.length - 1.001, Math.max(0, k * (GRASS.length - 1) * 1.15));
    c.copy(GRASS[Math.floor(idx)]).lerp(GRASS[Math.ceil(idx)], idx % 1);
    c.multiplyScalar(0.92 + fbm(x * 0.08, z * 0.08, 2) * 0.12);
    // Couches : terre et gravier au bord de la route, sable, roche sur les pentes raides, neige.
    const onSand = track.surf[near[i]] !== 'asphalt';
    let dirt = onSand ? 0 : Math.max(smoothstep(ROAD_HALF + 3.8, ROAD_HALF + 2.2, dist[i]) * 0.55, smoothstep(ROAD_HALF + 2.6, ROAD_HALF + 1.2, dist[i]));
    let sand = onSand ? smoothstep(ROAD_HALF + 9, ROAD_HALF + 2.2, dist[i]) : 0;
    let rock = smoothstep(0.86, 0.68, ny) * 0.95;
    let snow = 0;
    let wt = 0;
    let dens = 1;
    if (lake) {
      const dl = Math.hypot(x - lake.x, z - lake.z);
      const nearLake = smoothstep(lake.r * 1.6, lake.r * 1.3, dl);
      sand = Math.max(sand, smoothstep(lake.y + 1.1, lake.y + 0.2, y) * nearLake);
      wt = Math.max(wt, smoothstep(lake.y + 0.45, lake.y + 0.05, y) * nearLake);
      dens *= 1 - smoothstep(lake.y + 1.2, lake.y + 0.3, y) * nearLake;
      rock *= smoothstep(lake.r * 1.25, lake.r * 1.55, dl);
    }
    let duneK = 0;
    if (coast) {
      const zc = coastZ(coast, x);
      const sandK = Math.max(smoothstep(zc - 44, zc - 30, z + fbm(x * 0.04, z * 0.04, 2) * 10), smoothstep(seaY + 2.2, seaY + 1.2, y));
      sand = Math.max(sand, sandK);
      wt = Math.max(wt, smoothstep(seaY + 0.5, seaY + 0.05, y));
      // Oyats sur les dunes (pas sur le sable mouillé ni près de l'eau)
      duneK = sandK * smoothstep(seaY + 1.4, seaY + 2.6, y) * smoothstep(zc - 6, zc - 18, z);
      dens *= smoothstep(seaY + 0.4, seaY + 1.4, y);
    }
    if (theme.mood === 'alpine') snow = smoothstep(snowLine, snowLine + 30, y + fbm(x * 0.02, z * 0.02, 2) * 26) * smoothstep(0.6, 0.8, ny) * smoothstep(-0.25, 0.2, fbm(x * 0.012 + 5, z * 0.012, 3));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    mix.set([rock, sand, dirt, snow], i * 4);
    wet[i] = wt;
    dens *= (1 - rock) * (1 - snow) * (1 - dirt * 0.85) * (1 - sand) + duneK * 0.35;
    const gc = duneK > 0 ? c.clone().lerp(dune, Math.min(1, duneK * 1.5)) : c;
    ground[i * 4] = Math.min(255, Math.round(gc.r * 255));
    ground[i * 4 + 1] = Math.min(255, Math.round(gc.g * 255));
    ground[i * 4 + 2] = Math.min(255, Math.round(gc.b * 255));
    ground[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, dens)) * 255);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aMix', new THREE.BufferAttribute(mix, 4));
  geo.setAttribute('aWet', new THREE.BufferAttribute(wet, 1));
  const material = terrainMaterial(theme, shared, quality);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  const x0 = (b.minX + b.maxX) / 2 - w / 2;
  const z0 = (b.minZ + b.maxZ) / 2 - d / 2;
  const maps = makeFieldMaps({ heights, nx: gx + 1, nz: gz + 1, x0, z0, cellX: w / gx, cellZ: d / gz, ground });
  makeRoadMap(maps, track);
  return { mesh, maps, material };
}

// --- Route ---

// Enrobé : granulat, raccords et fissures, traces de pneus lustrées, marquage usé ; normales et rugosité.
let asphaltCache = null;
function asphaltMaps(anisotropy) {
  if (asphaltCache) return asphaltCache;
  const N = 512;
  const hp = makeHash(41);
  const hq = makeHash(42);
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(N, N);
  const hgt = new Float32Array(N * N);
  const rough = new Uint8Array(N * N * 4);
  const lineAt = (u, v) => (u > 0.025 && u < 0.041) || (u > 0.959 && u < 0.975) || (u > 0.492 && u < 0.508 && v < 0.375);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const u = x / N;
      const v = y / N;
      const g = hp(x, y);
      const g2 = hp(x >> 1, y >> 1);
      const g3 = hp(x >> 2, y >> 2);
      const patch = periodicFbm(hq, u * 4, v * 4, 4, 3);
      const tyre = Math.exp(-(((u - 0.3) / 0.07) ** 2)) + Math.exp(-(((u - 0.7) / 0.07) ** 2));
      let val = 46 + g * 14 + g2 * 14 + g3 * 10 + (patch - 0.5) * 30 - tyre * 7;
      if (g > 0.985) val += 40; // éclats de granulat clair
      let paint = 0;
      if (lineAt(u, v)) {
        const wear = periodicFbm(hq, u * 64, v * 16, 16, 2) + tyre * 0.25;
        paint = smoothstep(0.62, 0.45, wear) * (0.85 + g * 0.15);
        val = val * (1 - paint) + 228 * paint;
      }
      hgt[i] = g * 0.45 + g2 * 0.35 + g3 * 0.2 + paint * 0.6;
      img.data[i * 4] = val;
      img.data[i * 4 + 1] = val;
      img.data[i * 4 + 2] = val + 3 * (1 - paint);
      img.data[i * 4 + 3] = 255;
      const r = (0.9 - tyre * 0.14 - paint * 0.3 + (g - 0.5) * 0.08) * 255;
      rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(r)));
      rough[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Fissures et raccords (bandes plus sombres et plus lisses)
  let s = 9;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  ctx.lineCap = 'round';
  for (let k = 0; k < 14; k++) {
    ctx.strokeStyle = `rgba(18,18,20,${0.35 + rnd() * 0.3})`;
    ctx.lineWidth = 1 + rnd() * 1.2;
    let x = rnd() * N;
    let y = rnd() * N;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let j = 0; j < 10; j++) {
      x += (rnd() - 0.5) * 40;
      y += (rnd() - 0.3) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  // Normales du granulat (la peinture du marquage est en léger relief)
  const nd = new Uint8Array(N * N * 4);
  const at = (x, y) => hgt[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      nd[i] = Math.round((-dx / l * 0.5 + 0.5) * 255);
      nd[i + 1] = Math.round((dy / l * 0.5 + 0.5) * 255);
      nd[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      nd[i + 3] = 255;
    }
  }
  const mk = (data) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  const normalMap = mk(nd);
  const roughnessMap = mk(rough);
  for (const t of [map, normalMap, roughnessMap]) {
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
  }
  asphaltCache = { map, normalMap, roughnessMap };
  return asphaltCache;
}

// Passerelle : planches en travers, joints sombres, clous.
function boardwalkTexture(anisotropy) {
  const tex = canvasTexture(256, 512, (ctx, w, h) => {
    const r = rng(5);
    const planks = 16;
    const ph = h / planks;
    for (let k = 0; k < planks; k++) {
      const v = 0.85 + r() * 0.3;
      ctx.fillStyle = `rgb(${Math.round(168 * v)},${Math.round(124 * v)},${Math.round(82 * v)})`;
      ctx.fillRect(0, k * ph, w, ph);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(90,60,35,${0.08 + r() * 0.12})`;
        ctx.fillRect(r() * w, k * ph + r() * ph, 20 + r() * 80, 1);
      }
      ctx.fillStyle = 'rgba(40,26,16,0.85)';
      ctx.fillRect(0, k * ph, w, 2);
      ctx.fillStyle = 'rgba(60,60,60,0.8)';
      for (const u of [0.06, 0.5, 0.94]) ctx.fillRect(u * w - 2, k * ph + ph / 2 - 2, 4, 4);
    }
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

// Sable tassé : grain clair, ondulations et traces de roues.
function sandTexture(anisotropy) {
  const tex = canvasTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#e2cf9a';
    ctx.fillRect(0, 0, w, h);
    const r = rng(9);
    for (let i = 0; i < 14000; i++) {
      const v = r();
      ctx.fillStyle = v < 0.5 ? `rgba(255,248,220,${0.2 + r() * 0.3})` : `rgba(170,140,90,${0.15 + r() * 0.25})`;
      ctx.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5);
    }
    for (let y = 0; y < h; y += 9) {
      ctx.strokeStyle = 'rgba(160,130,80,0.18)';
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.05 + y) * 3);
      ctx.stroke();
    }
    for (const u of [0.32, 0.68]) {
      const g = ctx.createLinearGradient(u * w - 18, 0, u * w + 18, 0);
      g.addColorStop(0, 'rgba(150,120,70,0)');
      g.addColorStop(0.5, 'rgba(150,120,70,0.35)');
      g.addColorStop(1, 'rgba(150,120,70,0)');
      ctx.fillStyle = g;
      ctx.fillRect(u * w - 18, 0, 36, h);
    }
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

// Matière de route : variations de teinte à grande échelle, flaques (sombres, lisses, reflet du ciel)
// sur l'enrobé, ombres des nuages.
function roadMaterial(params, shared, key, puddles) {
  const mat = new THREE.MeshStandardMaterial(params);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNoise = { value: shared.noise };
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = withCloudShade(sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${CLOUD_GLSL}\nvarying vec3 vRPos;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float macroR = texture2D( uNoise, vRPos.xz * 0.031 ).r;
        diffuseColor.rgb *= 0.9 + macroR * 0.2;
        float wet = 0.0;
        ${puddles ? `wet = smoothstep( 0.775, 0.81, texture2D( uNoise, vRPos.xz * 0.016 + 0.3 ).g + ( texture2D( uNoise, vRPos.xz * 0.11 ).a - 0.5 ) * 0.12 );
        diffuseColor.rgb *= mix( 1.0, 0.72, wet );` : ''}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.22, wet );')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize( mix( normal, nonPerturbedNormal, wet * 0.7 ) );\nfloat cloudShade = cloudShadeAt( vRPos.xz );'));
  };
  mat.customProgramCacheKey = () => `road-${key}`;
  return mat;
}

const SURFACE_INDEX = { asphalt: 0, boardwalk: 1, sand: 2 };

function buildRoad(track, anisotropy, shared, terrainMat) {
  const n = track.count;
  const TILE = 8; // longueur (m) d'une répétition de la texture
  const roadPos = [];
  const roadUv = [];
  const shPos = [];
  const shCol = [];
  const shMix = [];
  const outer = C('#6faa4c');
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    const x = track.x[k];
    const z = track.z[k];
    const y = track.y[k];
    const rx = -track.tz[k];
    const rz = track.tx[k];
    const v = (i * track.step) / TILE;
    const surf = track.surf[k];
    roadPos.push(x - rx * ROAD_HALF, y + 0.04, z - rz * ROAD_HALF, x + rx * ROAD_HALF, y + 0.04, z + rz * ROAD_HALF);
    roadUv.push(0, v, 1, v);
    // Accotements (matière du terrain) : gravier puis herbe ; sable sur la plage ; poutre sous la passerelle.
    const deck = surf === 'boardwalk';
    const out = deck ? ROAD_HALF + 0.12 : ROAD_HALF + (surf === 'sand' ? 3.2 : 2.4);
    const drop = deck ? 0.42 : 0.5;
    const ci = deck ? WOOD : surf === 'sand' ? SAND : GRAVEL;
    const co = deck ? WOOD : surf === 'sand' ? SAND : outer;
    const mi = deck ? [0, 0, 0, 0] : surf === 'sand' ? [0, 1, 0, 0] : [0, 0, 1, 0];
    const mo = deck ? [0, 0, 0, 0] : surf === 'sand' ? [0, 1, 0, 0] : [0, 0, 0.55, 0];
    for (const side of [-1, 1]) {
      shPos.push(x + rx * side * (ROAD_HALF - 0.05), y + 0.035, z + rz * side * (ROAD_HALF - 0.05));
      shPos.push(x + rx * side * out, y - drop, z + rz * side * out);
      shCol.push(ci.r, ci.g, ci.b, co.r, co.g, co.b);
      shMix.push(...mi, ...mo);
    }
  }
  const roadIdx = [];
  const groups = [];
  const shIdx = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const m = SURFACE_INDEX[track.surf[i]] ?? 0;
    const last = groups[groups.length - 1];
    if (last && last.m === m) last.count += 6;
    else groups.push({ start: roadIdx.length, count: 6, m });
    roadIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    const s = i * 4;
    shIdx.push(s, s + 1, s + 4, s + 1, s + 5, s + 4);
    shIdx.push(s + 2, s + 6, s + 3, s + 3, s + 6, s + 7);
  }
  const road = new THREE.BufferGeometry();
  road.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
  road.setAttribute('uv', new THREE.Float32BufferAttribute(roadUv, 2));
  road.setIndex(roadIdx);
  for (const g of groups) road.addGroup(g.start, g.count, g.m);
  road.computeVertexNormals();
  const used = new Set(track.surf);
  const am = asphaltMaps(anisotropy);
  const materials = [
    roadMaterial({ map: am.map, normalMap: am.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughnessMap: am.roughnessMap, roughness: 1, metalness: 0 }, shared, 'asphalt', true),
    used.has('boardwalk') ? roadMaterial({ map: boardwalkTexture(anisotropy), roughness: 0.82, metalness: 0 }, shared, 'wood', false) : null,
    used.has('sand') ? roadMaterial({ map: sandTexture(anisotropy), roughness: 1, metalness: 0 }, shared, 'sand', false) : null,
  ].map((m, i, all) => m || all[0]);
  const roadMesh = new THREE.Mesh(road, materials);
  roadMesh.receiveShadow = true;
  const sh = new THREE.BufferGeometry();
  sh.setAttribute('position', new THREE.Float32BufferAttribute(shPos, 3));
  sh.setAttribute('color', new THREE.Float32BufferAttribute(shCol, 3));
  sh.setAttribute('aMix', new THREE.Float32BufferAttribute(shMix, 4));
  sh.setAttribute('aWet', new THREE.Float32BufferAttribute(new Float32Array(shPos.length / 3), 1));
  sh.setIndex(shIdx);
  sh.computeVertexNormals();
  const shMesh = new THREE.Mesh(sh, terrainMat);
  shMesh.receiveShadow = true;
  return [roadMesh, shMesh];
}

// --- Bord de route : bornes, glissières et murets (montagne), spectateurs, barrières et drapeaux ---

function addRoadside(group, ctx, theme, quality, shared, anisotropy) {
  const { track, heightAt, lake, free } = ctx;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const f = {};
  const r = rng(77);
  const density = quality === 'high' ? 1 : quality === 'medium' ? 0.6 : 0.3;
  const asphaltAt = (s) => track.surfaceAt(s) === 'asphalt';

  // Bornes blanches à bande noire et catadioptre (routes françaises), tous les 50 m.
  const posts = [];
  for (let s = 10; s < track.length; s += 50) {
    for (const side of [-1, 1]) {
      if (!asphaltAt(s)) continue;
      track.frame(s, side * (ROAD_HALF + 1.9), f);
      if (lake && Math.hypot(f.x - lake.x, f.z - lake.z) < lake.r * 1.35) continue;
      posts.push([f.x, heightAt(f.x, f.z), f.z, Math.atan2(f.tx, f.tz)]);
    }
  }
  const postGeo = mergeGeometries([
    colored(new THREE.BoxGeometry(0.12, 0.62, 0.12).translate(0, 0.31, 0), '#f4f4f0'),
    colored(new THREE.BoxGeometry(0.125, 0.16, 0.125).translate(0, 0.72, 0), '#1c1c1e'),
    colored(new THREE.BoxGeometry(0.125, 0.08, 0.125).translate(0, 0.84, 0), '#f4f4f0'),
    colored(new THREE.BoxGeometry(0.05, 0.1, 0.13).translate(0, 0.72, 0), '#ff8a1e'),
  ].map(indexify));
  const postMesh = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), posts.length);
  posts.forEach(([x, y, z, yaw], i) => postMesh.setMatrixAt(i, m4.compose(v3.set(x, y - 0.05, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), s3.set(1, 1, 1))));
  postMesh.castShadow = quality === 'high';
  postMesh.receiveShadow = true;
  group.add(postMesh);

  // Montagne : glissières côté ravin, murets de pierre côté talus.
  if (theme.walls) {
    const railPos = [];
    const railIdx = [];
    const railPosts = [];
    const wallPos = [];
    const wallUv = [];
    const wallIdx = [];
    for (const side of [-1, 1]) {
      let prevRail = null;
      let prevWall = null;
      for (let s = 0; s <= track.length; s += 2) {
        const slope = ctx.edgeSlope(s, side);
        const dropK = slope < -2.5;
        const riseK = slope > 3.2;
        // Glissière (lisse en W approchée par deux bandes inclinées)
        if (dropK) {
          const g = track.frame(s, side * (ROAD_HALF + 1.15), {});
          const base = railPos.length / 3;
          const ox = g.rx * side * 0.06;
          const oz = g.rz * side * 0.06;
          railPos.push(g.x, g.y + 0.5, g.z, g.x + ox, g.y + 0.64, g.z + oz, g.x, g.y + 0.78, g.z);
          if (prevRail !== null) railIdx.push(prevRail, base, prevRail + 1, base, base + 1, prevRail + 1, prevRail + 1, base + 1, prevRail + 2, base + 1, base + 2, prevRail + 2);
          prevRail = base;
          if (Math.round(s) % 4 === 0) railPosts.push([g.x - g.rx * side * 0.08, g.y, g.z - g.rz * side * 0.08]);
        } else prevRail = null;
        // Muret de soutènement en pierres sèches
        if (riseK && asphaltAt(s)) {
          const g = track.frame(s, side * (ROAD_HALF + 2.5), {});
          const base = wallPos.length / 3;
          const top = g.y + 0.9;
          const ox = g.rx * side * 0.45;
          const oz = g.rz * side * 0.45;
          wallPos.push(g.x, g.y - 0.6, g.z, g.x, top, g.z, g.x + ox, top, g.z + oz);
          wallUv.push(s / 1.6, 0, s / 1.6, 0.9, s / 1.6, 1.15);
          if (prevWall !== null) {
            if (side > 0) wallIdx.push(prevWall, prevWall + 1, base, base, prevWall + 1, base + 1, prevWall + 1, prevWall + 2, base + 1, base + 1, prevWall + 2, base + 2);
            else wallIdx.push(prevWall, base, prevWall + 1, base, base + 1, prevWall + 1, prevWall + 1, base + 1, prevWall + 2, base + 1, base + 2, prevWall + 2);
          }
          prevWall = base;
        } else prevWall = null;
      }
    }
    if (railIdx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3));
      g.setIndex(railIdx);
      g.computeVertexNormals();
      const rail = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#c3c8cf', metalness: 0.75, roughness: 0.32, side: THREE.DoubleSide }));
      rail.castShadow = quality === 'high';
      rail.receiveShadow = true;
      group.add(rail);
      const rp = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.8, 0.08).translate(0, 0.38, 0), new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.6, roughness: 0.45 }), railPosts.length);
      railPosts.forEach(([x, y, z], i) => rp.setMatrixAt(i, m4.compose(v3.set(x, y, z), q.identity(), s3.set(1, 1, 1))));
      rp.receiveShadow = true;
      group.add(rp);
    }
    if (wallIdx.length) {
      const stone = canvasTexture(256, 128, (c, w, h) => {
        c.fillStyle = '#6d6a63';
        c.fillRect(0, 0, w, h);
        const rr = rng(13);
        for (let row = 0; row < 6; row++) {
          let x = -rr() * 30;
          const y = row * (h / 6);
          while (x < w) {
            const sw = 24 + rr() * 30;
            const v = 120 + rr() * 60;
            c.fillStyle = `rgb(${v},${v * 0.97},${v * 0.9})`;
            c.beginPath();
            c.roundRect(x + 1.5, y + 1.5, sw - 3, h / 6 - 3, 5);
            c.fill();
            x += sw;
          }
        }
      });
      stone.wrapS = THREE.RepeatWrapping;
      stone.anisotropy = anisotropy;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(wallUv, 2));
      g.setIndex(wallIdx);
      g.computeVertexNormals();
      const wall = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: stone, roughness: 0.95, side: THREE.DoubleSide }));
      wall.receiveShadow = true;
      wall.castShadow = quality === 'high';
      group.add(wall);
    }
  }

  // Chevrons rouges et blancs à l'extérieur des virages serrés (montagne)
  if (theme.walls) {
    const chev = [];
    for (let s = 0; s < track.length; s += 6) {
      const k = track.curvatureAt(s);
      if (Math.abs(k) < 1 / 34) continue;
      const side = k > 0 ? -1 : 1; // extérieur du virage
      track.frame(s, side * (ROAD_HALF + 2.0), f);
      chev.push([f.x, heightAt(f.x, f.z), f.z, Math.atan2(-side * f.rx, -side * f.rz)]);
    }
    if (chev.length) {
      const chevTex = canvasTexture(128, 64, (c, w, h) => {
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#d6202a';
        for (let i = 0; i < 3; i++) {
          c.beginPath();
          c.moveTo(14 + i * 38, 8);
          c.lineTo(36 + i * 38, h / 2);
          c.lineTo(14 + i * 38, h - 8);
          c.lineTo(26 + i * 38, h - 8);
          c.lineTo(48 + i * 38, h / 2);
          c.lineTo(26 + i * 38, 8);
          c.closePath();
          c.fill();
        }
      });
      chevTex.anisotropy = anisotropy;
      const g = new THREE.PlaneGeometry(1.2, 0.6).translate(0, 1.1, 0);
      const back = new THREE.PlaneGeometry(1.2, 0.6).rotateY(Math.PI).translate(0, 1.1, -0.01);
      const pole = new THREE.BoxGeometry(0.06, 0.85, 0.06).translate(0, 0.42, -0.03);
      const cm = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ map: chevTex, roughness: 0.5 }), chev.length);
      const bm = new THREE.InstancedMesh(mergeGeometries([colored(back, '#5f646c'), colored(pole, '#5f646c')]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), chev.length);
      chev.forEach(([x, y, z, yaw], i) => {
        m4.compose(v3.set(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), s3.set(1, 1, 1));
        cm.setMatrixAt(i, m4);
        bm.setMatrixAt(i, m4);
      });
      cm.receiveShadow = bm.receiveShadow = true;
      group.add(cm, bm);
    }
  }

  // Inscriptions peintes sur la route dans les montées (comme sur le Tour)
  const words = ['ALLEZ !', 'VAS-Y !', 'COURAGE', 'ALLEZ !'];
  const paintTex = canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = 'rgba(0,0,0,0)';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#f4f2ea';
    c.font = 'italic 900 92px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    words.forEach((wd, i) => c.fillText(wd, w / 2, (i + 0.5) * (h / 4)));
  });
  paintTex.anisotropy = anisotropy;
  const decals = [];
  let wi = 0;
  for (let s = 40; s < track.length - 20 && decals.length < 10; s += 90 + r() * 60) {
    if (!asphaltAt(s) || track.gradeAt(s) < 4.5) continue;
    const lat = (r() - 0.5) * 3;
    track.frame(s, lat, f);
    const g = new THREE.PlaneGeometry(3.4, 0.85).rotateX(-Math.PI / 2);
    // Lisible en montant : le haut du texte vers l'avant de la route.
    g.rotateY(Math.atan2(f.tx, f.tz) + Math.PI);
    g.translate(f.x, f.y + 0.045, f.z);
    const uv = g.attributes.uv;
    const row = wi++ % 4;
    for (let k = 0; k < uv.count; k++) uv.setY(k, (3 - row + uv.getY(k)) / 4);
    decals.push(g);
  }
  if (decals.length) {
    const pos = [];
    const uvs = [];
    const idx = [];
    for (const g of decals) {
      const o = pos.length / 3;
      pos.push(...g.attributes.position.array);
      uvs.push(...g.attributes.uv.array);
      for (const ix of g.index.array) idx.push(ix + o);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    dg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    dg.setIndex(idx);
    dg.computeVertexNormals();
    const dm = new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ map: paintTex, transparent: true, opacity: 0.85, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    dm.receiveShadow = true;
    dm.renderOrder = 1;
    group.add(dm);
  }

  // Spectateurs : le long des montées (comme sur le Tour) et serrés derrière les barrières du départ.
  const fans = [];
  const want = Math.round(320 * density * theme.fans); // figurants lointains très légers (people.js) : foule plus dense
  for (let tries = 0; tries < want * 20 && fans.length < want; tries++) {
    const s0 = r() * track.length;
    if (!asphaltAt(s0)) continue;
    if (track.gradeAt(s0) < 4.5 && r() > 0.08) continue;
    const side = r() < 0.5 ? -1 : 1;
    const n = 2 + Math.floor(r() * 5);
    for (let k = 0; k < n; k++) {
      const s = s0 + (r() - 0.5) * 7;
      track.frame(s, side * (ROAD_HALF + 3.0 + r() * 2.6), f);
      if (!free(f.x, f.z, ROAD_HALF + 2.6)) continue;
      const y = heightAt(f.x, f.z);
      if (Math.abs(y - f.y) > 1.3) continue;
      fans.push([f.x, y, f.z, Math.atan2(-side * f.rx, -side * f.rz) + (r() - 0.5) * 0.9, r()]);
    }
  }
  // Départ : barrières et public des deux côtés avant et après la ligne, en dehors du cercle que décrit
  // la caméra de l'écran titre (rayon 12 m autour de la grille, 6 m avant la ligne).
  const barriers = [];
  for (let s = -44; s <= 40; s += 2.1) {
    if (s > -21 && s < 9) continue;
    for (const side of [-1, 1]) {
      track.frame(s, side * (ROAD_HALF + 0.9), f);
      barriers.push([f.x, heightAt(f.x, f.z), f.z, Math.atan2(f.tx, f.tz)]);
      for (let k = 0; k < (quality === 'low' ? 1 : 2); k++) {
        const g = track.frame(s + r() * 2, side * (ROAD_HALF + 1.6 + k * 0.8 + r() * 0.4), {});
        fans.push([g.x, heightAt(g.x, g.z), g.z, Math.atan2(-side * g.rx, -side * g.rz) + (r() - 0.5) * 0.5, r()]);
      }
    }
  }
  // Foule animée (people.js) : spectateurs du bord de route et du départ, plus les figurants du village,
  // de la ferme, de la plage et du lac ; diable dans la montée la plus raide.
  buildCourseCrowd(group, ctx, fans, quality);
  // Barrières Vauban habillées d'une bâche
  const tarp = canvasTexture(256, 64, (c, w, h) => {
    c.fillStyle = '#f4f4f2';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1f4fd1';
    c.fillRect(0, 0, w, 9);
    c.fillRect(0, h - 9, w, 9);
    c.fillStyle = '#ff5a1f';
    c.font = 'italic 900 26px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('MyCycleWorld', w / 2, h / 2 + 1);
  });
  const barrierGeo = new THREE.BoxGeometry(2.0, 0.55, 0.04).translate(0, 0.62, 0);
  const bMesh = new THREE.InstancedMesh(barrierGeo, new THREE.MeshStandardMaterial({ map: tarp, roughness: 0.7 }), barriers.length);
  barriers.forEach(([x, y, z, yaw], i) => bMesh.setMatrixAt(i, m4.compose(v3.set(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), s3.set(1, 1, 1))));
  bMesh.castShadow = quality !== 'low';
  bMesh.receiveShadow = true;
  group.add(bMesh);
}

// --- Montagnes lointaines : anneau de relief en crêtes, enneigé, fondu dans la brume ---
function mountainRing(track, theme, coast, cx, cz) {
  const b = track.bounds;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
  const mask = coast ? (x, z) => smoothstep(coastZ(coast, x) - 150, coastZ(coast, x) - 650, z) : null;
  return mountainRingAround({ cx, cz, r0: span + 380, r1: span + 1900, baseY: track.minY - 40, h: theme.mountains.h, snow: theme.mountains.snow, mask });
}

export function mountainRingAround({ cx, cz, r0, r1, baseY, h, snow, mask = null, seg = 240 }) {
  const SA = seg;
  const SR = 20;
  const pos = new Float32Array((SA + 1) * (SR + 1) * 3);
  const col = new Float32Array((SA + 1) * (SR + 1) * 3);
  const [h0, h1] = h;
  const ridged = (x, z) => {
    let sum = 0;
    let amp = 0.55;
    let f = 1;
    for (let o = 0; o < 5; o++) {
      const nn = 1 - Math.abs(noise2(x * f, z * f));
      sum += nn * nn * amp;
      f *= 2.1;
      amp *= 0.45;
    }
    return sum;
  };
  for (let i = 0; i <= SR; i++) {
    const t = i / SR;
    const r = r0 + (r1 - r0) * Math.pow(t, 1.4);
    for (let j = 0; j <= SA; j++) {
      const a = (j / SA) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      let env = smoothstep(0, 0.3, t) * (1 - smoothstep(0.8, 1, t) * 0.25);
      if (mask) env *= mask(x, z);
      const n = ridged(x * 0.0019 + 7, z * 0.0019 - 3);
      const o = (i * (SA + 1) + j) * 3;
      pos[o] = x;
      pos[o + 1] = baseY + env * (h0 * 0.4 + n * h1 * 1.1);
      pos[o + 2] = z;
    }
  }
  const idx = [];
  for (let i = 0; i < SR; i++) {
    for (let j = 0; j < SA; j++) {
      const a = i * (SA + 1) + j;
      const bq = a + SA + 1;
      idx.push(a, bq, a + 1, a + 1, bq, bq + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const forest = C('#33502f');
  const rockC = C('#6c675f');
  const snowC = C('#e8eef6');
  const c = new THREE.Color();
  const top = baseY + h0 * 0.4 + h1 * 0.9;
  for (let k = 0; k < pos.length / 3; k++) {
    const y = pos[k * 3 + 1];
    const ny = nrm.getY(k);
    const rel = (y - baseY) / (top - baseY);
    c.copy(forest).lerp(rockC, smoothstep(0.18, 0.42, rel + (1 - ny) * 0.4));
    c.multiplyScalar(0.9 + noise2(pos[k * 3] * 0.05, pos[k * 3 + 2] * 0.05) * 0.12);
    c.lerp(snowC, smoothstep(snow, snow + 0.06, rel + noise2(pos[k * 3] * 0.02, pos[k * 3 + 2] * 0.02) * 0.08) * smoothstep(0.35, 0.65, ny));
    c.multiplyScalar(0.72 + 0.28 * ny);
    col[k * 3] = c.r;
    col[k * 3 + 1] = c.g;
    col[k * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.frustumCulled = false;
  return mesh;
}

function blobShadowTexture() {
  return canvasTexture(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}

// Libère géométries, matières et textures d'un sous-arbre (les matières partagées entre modules sont
// épargnées). Les textures rangées dans les uniformes des shaders sont libérées aussi (sauf les cibles
// de rendu, libérées par leur propriétaire).
export function disposeTree(root, keep = new Set()) {
  const mats = new Set();
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) for (const m of [].concat(o.material)) mats.add(m);
  });
  for (const m of mats) {
    if (keep.has(m)) continue;
    for (const v of Object.values(m)) if (v && v.isTexture && !v.isRenderTargetTexture) v.dispose();
    if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture && !u.value.isRenderTargetTexture) u.value.dispose();
    m.dispose();
  }
}

// --- Construction du décor ---

export function buildScenery(scene, track, { quality = 'high', renderer = null } = {}) {
  installFog();
  const course = track.course;
  const theme = THEMES[course.theme] || THEMES.meadow;
  const mood = MOODS[theme.mood];
  const feats = course.features || {};
  const group = new THREE.Group();
  group.userData.tag = 'scenery';
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
  const shared = { uTime: { value: 0 }, uWind: { value: 1 }, noise: noiseTexture() };

  // Ciel, brume, lumières et environnement
  applyMood(scene, mood);
  const sky = makeSkyDome(mood, quality);
  sky.userData.tag = 'scenery';
  scene.add(sky);
  let envTex = null;
  if (renderer) {
    envTex = makeSkyEnvironment(renderer, sky);
    scene.environment = envTex;
    scene.environmentIntensity = mood.env;
  }

  // Terrain, lac, route
  const lake = feats.lake ? findLake(track) : null;
  const coast = feats.coast || null;
  const seaY = track.minY - 0.7;
  const flat = [feats.village, feats.farm].filter(Boolean).map((z) => [z.from, z.to]);
  const height = makeGround(track, lake, theme, { coast, seaY, flat });
  const heightAt = (x, z) => height(x, z).h;
  const terrain = buildTerrain(track, height, lake, quality, theme, coast, seaY, shared);
  group.add(terrain.mesh);
  const maps = terrain.maps;
  group.add(...buildRoad(track, anisotropy, shared, terrain.material));
  if (lake) {
    const water = makeWater(new THREE.CircleGeometry(lake.r * 1.34, 96).rotateX(-Math.PI / 2), {
      mood, maps, waterY: lake.y, shared, chop: 0.28, shallow: '#4fb4b8', deep: '#14527a', sand: '#b8a77a', depthScale: 0.45, foam: 0.7,
    });
    water.position.set(lake.x, lake.y, lake.z);
    group.add(water);
  }

  // Emplacements libres (loin de la route, hors du lac, hors de l'aire de départ)
  const b = track.bounds;
  const start = track.frame(0);
  const reserved = [];
  const reserve = (x, z, rad) => reserved.push([x, z, rad]);
  const free = (x, z, minRoad) => {
    const near = nearestFine(track, x, z);
    if (near.dist < minRoad) return null;
    if (lake && Math.hypot(x - lake.x, z - lake.z) < lake.r * 1.4) return null;
    if (coast && z > coastZ(coast, x) - 34) return null; // plage et mer
    if (Math.hypot(x - start.x, z - start.z) < 14) return null;
    for (const [rx, rz, rad] of reserved) if ((x - rx) ** 2 + (z - rz) ** 2 < rad * rad) return null;
    return near;
  };

  // Pente du terrain à côté de la route (m) : < 0 ravin, > 0 talus (mesurée à 10 et 16 m du bord).
  const edgeSlope = (s, side) => {
    const a = track.frame(s, side * (ROAD_HALF + 10));
    const c = track.frame(s, side * (ROAD_HALF + 16));
    const ha = heightAt(a.x, a.z) - a.y;
    const hc = heightAt(c.x, c.z) - c.y;
    return Math.abs(ha) < Math.abs(hc) ? ha : hc;
  };

  // Éléments propres au circuit (avant la végétation, qui évite leurs emplacements)
  const ctx = { edgeSlope, track, heightAt, reserve, lake, rnd: rng(23), cast: castTrees, free, seaY, maps, mood, shared, quality, coast, palms: [] };
  const updaters = [];
  if (feats.farm) updaters.push(addFarm(group, ctx, feats.farm));
  if (feats.village) updaters.push(addAlpineVillage(group, ctx, feats.village));
  if (feats.cows) updaters.push(addAlpineCows(group, ctx));
  if (coast) updaters.push(addCoast(group, scene, ctx, coast));
  addRoadside(group, ctx, theme, quality, shared, anisotropy);
  const randomPoint = (spread) => [b.minX - spread + r() * (b.maxX - b.minX + spread * 2), b.minZ - spread + r() * (b.maxZ - b.minZ + spread * 2)];

  // Arbres : bosquets (bruit) + arbres isolés ; feuillus et sapins. Niveaux de détail selon la distance.
  const round = [];
  const pines = [];
  const bushes = [];
  const shadows = [];
  const wantTrees = Math.round(theme.trees * density);
  for (let tries = 0; tries < wantTrees * 12 && round.length + pines.length < wantTrees; tries++) {
    const [x, z] = randomPoint(420);
    const forest = fbm(x * 0.006 + 40, z * 0.006, 3) + fbm(x * 0.03, z * 0.03, 2) * 0.15;
    if (forest < 0.1 && r() > 0.04) continue; // surtout en bois, lisières découpées
    const near = free(x, z, ROAD_HALF + 7);
    if (!near) continue;
    const y = heightAt(x, z);
    const sc = 0.75 + r() * 0.75;
    if ((theme.pineNear || near.dist > 140) && r() < theme.pineRatio) pines.push([x, y, z, sc * 1.1, r()]);
    else round.push([x, y, z, sc, r()]);
    shadows.push([x, y, z, sc * 2.6]);
  }
  for (let tries = 0; tries < 8000 && bushes.length < Math.round(500 * density); tries++) {
    const [x, z] = randomPoint(120);
    const near = free(x, z, ROAD_HALF + 3.5);
    if (!near || near.dist > 90) continue;
    bushes.push([x, heightAt(x, z), z, 0.6 + r() * 0.9, r()]);
  }
  for (const pm of ctx.palms) shadows.push([pm[0], pm[1], pm[2], 3]);
  const solidMat = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }), shared, { key: 'solid' });
  const leafMat = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, map: leafAtlas(), alphaTest: 0.5, side: THREE.DoubleSide }), shared, { key: 'leaf', flutter: 0.035, noFlip: true });
  if (quality === 'high') leafMat.alphaToCoverage = true;
  const cards = quality === 'high';
  const tints = ['#ffffff', '#f2ffe0', '#e4f7d6', '#fff2c4', '#ffe0b0', '#e8fff0', '#f8ffd8'].map(C);
  const dist = quality === 'high' ? { close: 52, mid: 115 } : quality === 'medium' ? { close: 36, mid: 70 } : { close: 0.1, mid: 45 };
  const forest = new Forest(group, [
    { near: deciduousGeometry(0, cards), impostor: 'deciduous', items: round, cast: castTrees, tints, nearMaterial: cards ? [solidMat, leafMat] : solidMat, material: solidMat },
    { near: pineGeometry(0), impostor: 'pine', items: pines, cast: castTrees, tints: null, material: solidMat },
    { near: bushGeometry(0), impostor: 'bush', items: bushes, cast: false, tints, material: solidMat },
    { near: palmGeometry(0), impostor: 'palm', items: ctx.palms, cast: quality !== 'low', tints: null, nearMaterial: [solidMat, leafMat], material: solidMat },
  ], dist);
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

  // Prairie : herbe dense et fleurs autour de la caméra (carte graphique) ; touffes fixes en qualité low.
  const fields = [];
  if (quality !== 'low') {
    for (const kind of ['grass', 'flowers']) {
      const fld = makeGrassField(maps, shared, { quality, kind });
      group.add(fld.mesh);
      fields.push(fld);
    }
  } else {
    const tuftGeo = mergeGeometries([0, 1, 2].map((k) => {
      const a = (k / 3) * Math.PI * 2;
      const g = new THREE.ConeGeometry(0.05, 0.42, 3).translate(0, 0.2, 0);
      g.rotateZ(0.35 * Math.cos(a));
      g.rotateX(0.35 * Math.sin(a));
      return paint(g, (c, px, py) => c.copy(C('#3f8a2c')).lerp(C('#a7d65d'), smoothstep(0, 0.4, py)));
    }));
    const tufts = [];
    for (let i = 0; i < 2000; i++) {
      const s = r() * track.length;
      const side = r() < 0.5 ? -1 : 1;
      const lat = side * (ROAD_HALF + 2.6 + Math.pow(r(), 1.6) * 34);
      const f = track.frame(s, lat);
      if (!free(f.x, f.z, ROAD_HALF + 2.4)) continue;
      tufts.push([f.x, heightAt(f.x, f.z), f.z, r()]);
    }
    const tuftMesh = new THREE.InstancedMesh(tuftGeo, solidMat, tufts.length);
    tufts.forEach(([x, y, z, k], i) => {
      m4.compose(v3.set(x, y - 0.03, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, k * 6.28), s3.setScalar(0.8 + k * 0.9));
      tuftMesh.setMatrixAt(i, m4);
    });
    group.add(tuftMesh);
  }

  // Rochers
  const rocks = [];
  for (let tries = 0; tries < 6000 && rocks.length < Math.round(theme.rocks * density); tries++) {
    const [x, z] = randomPoint(200);
    if (!free(x, z, ROAD_HALF + 5)) continue;
    rocks.push([x, heightAt(x, z), z, 0.5 + r() * 1.8, r()]);
  }
  const rockMesh = new THREE.InstancedMesh(rockGeometry(quality === 'high' ? 2 : 1), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), rocks.length);
  rocks.forEach(([x, y, z, sc, k], i) => {
    m4.compose(v3.set(x, y - sc * 0.2, z), q.setFromEuler(e.set(k * 0.4, k * 9, k * 0.3)), s3.set(sc, sc * 0.7, sc * 1.1));
    rockMesh.setMatrixAt(i, m4);
  });
  rockMesh.castShadow = quality === 'high';
  rockMesh.receiveShadow = true;
  group.add(rockMesh);

  // Clôtures en bois le long de certains tronçons
  const posts = [];
  const rails = [];
  for (const side of theme.fences ? [-1, 1] : []) {
    for (let s = 20; s < track.length - 20; s += 2.6) {
      if (fbm(s * 0.006 + side * 13, side * 7, 2) < 0.12) continue;
      const a = track.frame(s, side * (ROAD_HALF + 3.4));
      const c2 = track.frame(s + 2.6, side * (ROAD_HALF + 3.4));
      if (lake && Math.hypot(a.x - lake.x, a.z - lake.z) < lake.r * 1.4) continue;
      if (reserved.some(([rx, rz, rad]) => (a.x - rx) ** 2 + (a.z - rz) ** 2 < (rad + 3) ** 2)) continue;
      const ya = heightAt(a.x, a.z);
      const yc = heightAt(c2.x, c2.z);
      // Pas de clôture suspendue au-dessus d'un ravin ni enterrée dans un talus (glissières, murets).
      if (Math.abs(ya - a.y) > 1.2) continue;
      if (theme.walls && Math.abs(edgeSlope(s, side)) > 2.5) continue;
      posts.push([a.x, ya, a.z]);
      const len = Math.hypot(c2.x - a.x, c2.z - a.z);
      const yaw = Math.atan2(c2.x - a.x, c2.z - a.z);
      const pitch = -Math.atan2(yc - ya, len);
      for (const hgt of [0.45, 0.85]) rails.push([(a.x + c2.x) / 2, (ya + yc) / 2 + hgt, (a.z + c2.z) / 2, yaw, pitch, len]);
    }
  }
  const wood = new THREE.MeshStandardMaterial({ color: '#a07450', roughness: 0.9 });
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
    mesh.castShadow = quality === 'high';
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Maisons de campagne (toutes fusionnées : une seule instruction de dessin, plus les vitres)
  const houses = [];
  for (let tries = 0; tries < 4000 && houses.length < (feats.cottages ? 8 : 0); tries++) {
    const s = r() * track.length;
    const side = r() < 0.5 ? -1 : 1;
    const f = track.frame(s, side * (ROAD_HALF + 16 + r() * 30));
    if (!free(f.x, f.z, ROAD_HALF + 12)) continue;
    if (houses.some((h) => Math.hypot(h.x - f.x, h.z - f.z) < 70)) continue;
    houses.push({ x: f.x, z: f.z, yaw: Math.atan2(-side * f.rx, -side * f.rz), k: r() });
  }
  if (houses.length) {
    const wallColors = ['#f3e6cc', '#efd9bb', '#f8f2e8', '#e6d4b8'];
    const roofColors = ['#b9503b', '#a64535', '#c4643a', '#8a5a3c'];
    const solid = [];
    const glass = [];
    const mtx = new THREE.Matrix4();
    for (const h of houses) {
      const y = heightAt(h.x, h.z) - 0.2;
      mtx.compose(v3.set(h.x, y, h.z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, h.yaw), s3.set(1, 1, 1));
      const wc = wallColors[Math.floor(h.k * 4)];
      const rc = roofColors[Math.floor(h.k * 7) % 4];
      const parts = [
        colored(new THREE.BoxGeometry(7, 3.4, 5.5).translate(0, 1.7, 0), wc),
        colored(new THREE.BoxGeometry(7.3, 0.35, 5.8).translate(0, 0.1, 0), '#9a958a'),
        colored(new THREE.CylinderGeometry(3.4, 3.4, 7.8, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6).scale(1, 0.62, 1).translate(0, 4.4, 0), rc),
        colored(new THREE.BoxGeometry(0.7, 1.6, 0.7).translate(2.2, 5.4, -0.8), rc),
        colored(new THREE.BoxGeometry(1.1, 2.1, 0.1).translate(-1.6, 1.05, 2.78), '#4a3a30'),
      ];
      for (const x of [0.6, 2.4]) {
        parts.push(colored(new THREE.BoxGeometry(1.2, 1.2, 0.08).translate(x, 2, 2.76), '#f4f1ea'));
        parts.push(colored(new THREE.BoxGeometry(0.32, 1.1, 0.06).translate(x - 0.78, 2, 2.79), '#3f6b46'));
        parts.push(colored(new THREE.BoxGeometry(0.32, 1.1, 0.06).translate(x + 0.78, 2, 2.79), '#3f6b46'));
        glass.push(colored(new THREE.BoxGeometry(1, 1, 0.1).translate(x, 2, 2.8), '#9fc4dc').applyMatrix4(mtx));
      }
      for (const g of parts) solid.push((g.index ? g : indexify(g)).applyMatrix4(mtx));
    }
    const houseMesh = new THREE.Mesh(mergeGeometries(solid), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    houseMesh.castShadow = true;
    houseMesh.receiveShadow = true;
    const glassMesh = new THREE.Mesh(mergeGeometries(glass.map((g) => (g.index ? g : indexify(g)))), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.3 }));
    group.add(houseMesh, glassMesh);
  }

  // Bottes de foin dans les champs
  const bales = [];
  for (let tries = 0; tries < 2000 && bales.length < Math.round(theme.bales * density); tries++) {
    const [x, z] = randomPoint(60);
    const near = free(x, z, ROAD_HALF + 10);
    if (!near || near.dist > 70) continue;
    bales.push([x, heightAt(x, z), z, r()]);
  }
  const baleGeo = new THREE.CylinderGeometry(0.75, 0.75, 1.2, 18, 1).rotateZ(Math.PI / 2);
  paint(baleGeo, (c, x, y, z) => c.set('#e2bd58').multiplyScalar(0.85 + 0.15 * Math.sin(Math.atan2(y, z) * 40) + (Math.abs(x) > 0.59 ? -0.1 : 0)));
  const baleMesh = new THREE.InstancedMesh(baleGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), bales.length);
  bales.forEach(([x, y, z, k], i) => {
    m4.compose(v3.set(x, y + 0.65, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, k * 6.28), s3.setScalar(1));
    baleMesh.setMatrixAt(i, m4);
  });
  baleMesh.castShadow = true;
  baleMesh.receiveShadow = true;
  group.add(baleMesh);

  // Montagnes à l'horizon
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  group.add(mountainRing(track, theme, coast, cx, cz));

  // Oiseaux et poussières dans la lumière
  const birds = makeBirds(shared, new THREE.Vector3(cx, track.maxY, cz), quality === 'low' ? 8 : 24);
  group.add(birds);
  const motes = quality === 'high' ? makeMotes(shared) : null;
  if (motes) group.add(motes);

  // Ligne de départ en damier + arche gonflable
  const checker = canvasTexture(256, 32, (cctx, cw, ch) => {
    const sq = ch / 2;
    for (let x = 0; x < cw / sq; x++) for (let y = 0; y < 2; y++) {
      cctx.fillStyle = (x + y) % 2 ? '#141414' : '#f5f5f5';
      cctx.fillRect(x * sq, y * sq, sq, sq);
    }
  });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 1.2), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.6 }));
  line.rotation.set(-Math.PI / 2, Math.atan2(start.tx, start.tz), 0, 'YXZ');
  line.position.set(start.x, start.y + 0.06, start.z);
  line.receiveShadow = true;
  group.add(line);
  const arch = new THREE.Group();
  // Le tore (demi-anneau) est dans le plan XY local : X = travers de la route, Y = haut.
  const archMesh = new THREE.Mesh(
    new THREE.TorusGeometry(ROAD_HALF + 1.4, 0.6, 16, 56, Math.PI),
    new THREE.MeshStandardMaterial({ color: '#ff5a1f', roughness: 0.45 }),
  );
  arch.add(archMesh);
  const bannerTex = canvasTexture(1024, 160, (cctx, cw, ch) => {
    cctx.fillStyle = '#ffffff';
    cctx.fillRect(0, 0, cw, ch);
    cctx.fillStyle = '#ff5a1f';
    cctx.font = '900 92px system-ui, sans-serif';
    cctx.textAlign = 'center';
    cctx.textBaseline = 'middle';
    cctx.fillText('MyCycleWorld', cw / 2, ch / 2 + 6);
  });
  bannerTex.anisotropy = anisotropy;
  const bannerGeo = mergeBanner();
  const banner = new THREE.Mesh(bannerGeo, new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.6 }));
  banner.position.y = ROAD_HALF + 1.4;
  arch.add(banner);
  arch.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  // Axe local Z = sens de la course : l'arche enjambe la route, les banderoles regardent les coureurs.
  arch.position.set(start.x, start.y, start.z);
  arch.rotation.y = Math.atan2(start.tx, start.tz);
  group.add(arch);

  const anim = updaters.filter(Boolean);
  let time = 0;
  const skyU = sky.userData.uniforms;
  const update = (dt, camera) => {
    time += dt;
    shared.uTime.value = time;
    skyU.uTime.value = time;
    sky.position.copy(camera.position);
    forest.update(camera.position.x, camera.position.z, camera.position.y);
    for (const fld of fields) fld.update(camera);
    for (const u of anim) u(dt, time);
  };

  // Libère tout le décor (changement de circuit sans recharger la page).
  const dispose = () => {
    for (const root of [group, sky]) {
      scene.remove(root);
      disposeTree(root);
    }
    maps.dispose();
    if (envTex) envTex.userData.release();
    scene.environment = null;
    scene.fog = null;
  };

  return { group, sky, heightAt, lake, update, dispose, center: new THREE.Vector3(cx, (track.minY + track.maxY) / 2, cz) };
}

// Banderole de l'arche : deux faces (avant et arrière) fusionnées en une géométrie.
function mergeBanner() {
  const a = new THREE.PlaneGeometry(6.4, 1).translate(0, 0, 0.62);
  const bk = new THREE.PlaneGeometry(6.4, 1).rotateY(Math.PI).translate(0, 0, -0.62);
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array([...a.attributes.position.array, ...bk.attributes.position.array]);
  const nor = new Float32Array([...a.attributes.normal.array, ...bk.attributes.normal.array]);
  const uv = new Float32Array([...a.attributes.uv.array, ...bk.attributes.uv.array]);
  const idx = [...a.index.array, ...Array.from(bk.index.array, (i) => i + 4)];
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
