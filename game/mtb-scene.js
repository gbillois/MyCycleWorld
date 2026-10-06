// Décor de la Forêt des Crêtes (circuit de VTT, thème 'forest') : sentier de terre étroit avec virages relevés,
// racines, pierrier, gravier, boue, gué dans un ruisseau qui coule (eau de water.js), passerelle en bois sur
// pilotis (North Shore), sauts en bois et leur réception, forêt dense de sapins et de feuillus (forêt à niveaux
// de détail de nature.js, imposteurs au loin), fougères, souches, troncs couchés, champignons, rubalise dans
// les épingles, arche de départ en rondins, quelques spectateurs aux sauts, puits de lumière, gouttes et poussière.
// Graphismes détaillés (qualités high, medium, low) et version simple (?gfx=simple) plus légère.
// Tout est généré (aucun fichier). Le décor entier est libéré par dispose() (changement de circuit).
import * as THREE from 'three';
import { rng, mod } from './track.js';
import { mergeGeometries, paint, indexify, colored } from './geom.js';
import { MOODS, applyMood, installFog, makeSkyDome, makeEnvironment, noiseTexture, makeMotes, SUN_DIR } from './atmosphere.js';
import { Forest, deciduousGeometry, pineGeometry, bushGeometry, rockGeometry, windMaterial, leafAtlas, crispAlpha, makeFieldMaps, makeRoadMap, noise3 } from './nature.js';
import { makeWater } from './water.js';
import { terrainMaterial, fbm, disposeTree, mountainRingAround, fanGeometry, fanMaterial } from './scenery.js';
import { kickerHeight, MTB } from '../src/core/mtb.js';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const C = (hex) => new THREE.Color(hex);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Ambiance du sous-bois : soleil filtré, brume légère et verte, ciel moins présent.
export const FOREST_MOOD = {
  zenith: '#2a63bd', mid: '#6d9fd8', horizon: '#c3d4be', sun: '#ffe7bf', sunI: 3.1,
  hemiSky: '#b4cfa6', hemiGround: '#3d4a2a', hemiI: 0.8, env: 0.45,
  fog: [45, 650], clouds: 0.36, cirrus: 0.45, exposure: 1.0,
};
if (!MOODS.forest) MOODS.forest = FOREST_MOOD;

const THEME = { rock: '#77736a', sand: '#a8946c', dirt: '#5a4330' };
const FLOOR = ['#3a5424', '#4a6229', '#5c5f2c', '#6a5733', '#4f4a2a'].map(C);

// ---------------------------------------------------------------------------------------------
// Données du sentier (communes aux deux graphismes) : virages relevés, sauts, ruisseau, passerelle.
// ---------------------------------------------------------------------------------------------

function blurLoop(src, radius, passes) {
  const n = src.length;
  let a = Float32Array.from(src);
  const b = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = -radius; j <= radius; j++) sum += a[mod(i + j, n)];
      b[i] = sum / (2 * radius + 1);
    }
    a = Float32Array.from(b);
  }
  return a;
}

// Point du sentier le plus proche, avec le décalage latéral signé (+ = à droite).
function nearestSigned(track, x, z) {
  let best = Infinity;
  let bi = 0;
  for (let i = 0; i < track.count; i += 4) {
    const d = (track.x[i] - x) ** 2 + (track.z[i] - z) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  for (let j = -4; j <= 4; j++) {
    const i = mod(bi + j, track.count);
    const d = (track.x[i] - x) ** 2 + (track.z[i] - z) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  const lat = (x - track.x[bi]) * -track.tz[bi] + (z - track.z[bi]) * track.tx[bi];
  return { i: bi, lat, dist: Math.sqrt(best) };
}

// Ruisseau : arrive par la droite du sentier, le suit dans son lit (le gué), repart par la gauche.
function creekPath(track, feat) {
  const L = track.length;
  const s0 = feat.from * L;
  const s1 = feat.to * L;
  const f0 = track.frame(s0, 0, {});
  const f1 = track.frame(s1, 0, {});
  const P = (f, lat, back) => new THREE.Vector3(f.x + f.rx * lat - f.tx * back, 0, f.z + f.rz * lat - f.tz * back);
  const ctrl = [P(f0, 70, 30), P(f0, 42, 15), P(f0, 20, 7), P(f0, 6, 1.5)];
  for (let s = s0 + 2; s < s1 - 1; s += 4) {
    const f = track.frame(s, 0, {});
    ctrl.push(new THREE.Vector3(f.x, 0, f.z));
  }
  ctrl.push(P(f1, -6, -1.5), P(f1, -20, -7), P(f1, -44, -16), P(f1, -75, -30));
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  const len = curve.getLength();
  const N = Math.ceil(len / 1.5);
  const pts = curve.getSpacedPoints(N);
  const level = track.frame(s0, 0, {}).y + 0.13; // eau peu profonde : 13 cm au-dessus du lit du sentier
  const half = track.half;
  const samples = pts.map((p, k) => {
    const nn = nearestSigned(track, p.x, p.z);
    const onTrail = smoothstep(9, 1.5, nn.dist);
    const w = 1.3 + (half + 0.8 - 1.3) * onTrail + Math.max(0, noise3(k * 0.21, 1.3, 0.7)) * 0.6;
    return { x: p.x, z: p.z, w, onTrail };
  });
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of samples) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const reach = 6;
  // Distance au lit (et demi-largeur locale), recherche directe (le ruisseau compte peu de points).
  const near = (x, z) => {
    if (x < minX - reach - 4 || x > maxX + reach + 4 || z < minZ - reach - 4 || z > maxZ + reach + 4) return null;
    let best = Infinity;
    let bk = 0;
    for (let k = 0; k < samples.length; k++) {
      const d = (samples[k].x - x) ** 2 + (samples[k].z - z) ** 2;
      if (d < best) { best = d; bk = k; }
    }
    return { d: Math.sqrt(best), w: samples[bk].w, k: bk };
  };
  return { s0, s1, level, samples, near, reach, curve };
}

export function trailData(track) {
  const n = track.count;
  const L = track.length;
  const half = track.half;
  const course = track.course;
  const feats = course.features || {};
  // Virages relevés : pente transversale (tan) dans les virages serrés, signe = côté extérieur.
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = track.curv[i];
    raw[i] = smoothstep(0.045, 0.1, Math.abs(k)) * 0.34 * -Math.sign(k);
  }
  const bank = blurLoop(raw, 6, 2);
  // Hauteur de la surface du sentier au-dessus de son axe (bord intérieur au niveau de l'axe, extérieur relevé).
  const yOff = (i, lat) => {
    const b = bank[i];
    if (!b) return 0;
    const l = clamp(lat, -half, half);
    return Math.abs(b) * (l * Math.sign(b) + half) * 0.5;
  };
  const bankAt = (s, lat) => {
    const f = mod(s, L) / track.step;
    const i = Math.min(n - 1, Math.floor(f));
    const a = f - i;
    return yOff(i, lat) * (1 - a) + yOff((i + 1) % n, lat) * a;
  };
  const jumps = (course.mtb?.jumps || []).map(([u, h, len]) => ({ s: u * L, h, len }));
  const creek = feats.creek ? creekPath(track, feats.creek) : null;
  const bridge = feats.bridge ? { s0: feats.bridge.from * L, s1: feats.bridge.to * L } : null;
  // 1 sur la passerelle, adouci sur 6 m de part et d'autre (marécage dessous).
  const bog = new Float32Array(n + 1);
  if (bridge) {
    for (let i = 0; i <= n; i++) {
      const s = (i % n) * track.step;
      bog[i] = smoothstep(bridge.s0 - 6, bridge.s0 + 2, s) * (1 - smoothstep(bridge.s1 - 2, bridge.s1 + 6, s));
    }
  }
  return { half, bank, yOff, bankAt, jumps, creek, bridge, bog };
}

// Altitude du sentier la plus proche, sur une grille de 8 m floutée (terrain continu entre deux rangées).
function smoothField(track, margin) {
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
  const R = 4;
  const tmp = new Float32Array(nx * nz);
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let sum = 0;
      for (let k = -R; k <= R; k++) sum += g[j * nx + clamp(i + k, 0, nx - 1)];
      tmp[j * nx + i] = sum / (2 * R + 1);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let sum = 0;
      for (let k = -R; k <= R; k++) sum += tmp[clamp(j + k, 0, nz - 1) * nx + i];
      g[j * nx + i] = sum / (2 * R + 1);
    }
  }
  return (x, z) => {
    const fx = clamp((x - x0) / cell, 0, nx - 1.001);
    const fz = clamp((z - z0) / cell, 0, nz - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = g[j * nx + i] + (g[j * nx + i + 1] - g[j * nx + i]) * u;
    const c = g[(j + 1) * nx + i] + (g[(j + 1) * nx + i + 1] - g[(j + 1) * nx + i]) * u;
    return a + (c - a) * v;
  };
}

// Sol de la forêt : à plat sous le sentier et ses abords, sous-bois bosselé plus loin, levée de terre à
// l'extérieur des virages relevés, lit du ruisseau creusé, marécage sous la passerelle.
function makeGround(track, td, margin) {
  const half = td.half;
  const field = smoothField(track, margin);
  const creek = td.creek;
  return (x, z) => {
    const nn = nearestSigned(track, x, z);
    const { i, lat } = nn;
    const d = Math.abs(lat);
    const edge = track.y[i] + td.yOff(i, lat);
    const flat = edge - 0.22 - td.bog[i] * 0.85;
    const tOut = smoothstep(half + 2.6, half + 22, d);
    const base = field(x, z) + 1.2 + fbm(x * 0.011, z * 0.011, 3) * 7 + fbm(x * 0.045 + 3, z * 0.045, 2) * 1.3 + Math.max(0, d - 70) * 0.1;
    let h = flat + (base - flat) * tOut;
    h += smoothstep(half + 1.2, half + 5, d) * fbm(x * 0.25, z * 0.25, 2) * 0.35 * (1 - td.bog[i]);
    const b = td.bank[i];
    if (b && lat * b > 0) h += (Math.abs(b) / 0.34) * 0.5 * Math.exp(-(((d - half - 0.9) / 0.9) ** 2));
    let wet = td.bog[i] * smoothstep(half + 7, half + 2, d);
    let bed = 0;
    if (creek && d > half + 0.4) {
      const c = creek.near(x, z);
      if (c && c.d < c.w + 3.5) {
        if (c.d < c.w) {
          h = Math.min(h, creek.level - 0.06 - 0.42 * (1 - (c.d / c.w) ** 2));
          bed = 1;
        } else {
          const t = (c.d - c.w) / 3.5;
          h = Math.max(h, creek.level + 0.1 - t * 0.1) * (1 - smoothstep(0.7, 1, t)) + h * smoothstep(0.7, 1, t);
          bed = Math.max(bed, 1 - t);
        }
        wet = Math.max(wet, 1 - smoothstep(0, 1.2, c.d - c.w));
      }
    }
    return { h, near: nn, wet, bed };
  };
}

// ---------------------------------------------------------------------------------------------
// Textures du sentier : atlas de 8 tuiles (terre, racines, pierrier, gravier, boue, lit du ruisseau,
// planches, réserve), couleur et relief (normales calculées à partir de la luminance).
// ---------------------------------------------------------------------------------------------
export const TILE = { dirt: 0, roots: 1, rock: 2, gravel: 3, mud: 4, creek: 5, boardwalk: 6 };
const ROUGH = [0.95, 0.9, 0.78, 0.93, 0.32, 0.55, 0.8, 0.9];

let atlasCache = null;
function trailAtlas() {
  if (atlasCache) return atlasCache;
  const TW = 128;
  const H = 512;
  const cv = document.createElement('canvas');
  cv.width = TW * 8;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const r = rng(77);
  const speck = (x0, n, cols, size = 2) => {
    for (let k = 0; k < n; k++) {
      ctx.fillStyle = cols[Math.floor(r() * cols.length)];
      const s = size * (0.5 + r());
      ctx.fillRect(x0 + r() * TW, r() * H, s, s);
    }
  };
  const ruts = (x0, col, w = 10) => {
    for (const u of [0.32, 0.68]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      for (let y = 0; y <= H; y += 16) ctx.lineTo(x0 + u * TW + Math.sin(y * 0.03 + u * 9) * 4, y);
      ctx.stroke();
    }
  };
  const leaves = (x0) => {
    for (let k = 0; k < 140; k++) {
      const u = r() < 0.5 ? r() * 0.16 : 1 - r() * 0.16;
      ctx.fillStyle = ['#8a5a25', '#a8742e', '#6b4a22', '#5a6a2a', '#7b3f1c'][Math.floor(r() * 5)];
      ctx.save();
      ctx.translate(x0 + u * TW, r() * H);
      ctx.rotate(r() * 6.28);
      ctx.beginPath();
      ctx.ellipse(0, 0, 3 + r() * 3, 1.5 + r() * 1.5, 0, 0, 6.28);
      ctx.fill();
      ctx.restore();
    }
  };
  const earth = (x0, base) => {
    ctx.fillStyle = base;
    ctx.fillRect(x0, 0, TW, H);
    speck(x0, 2600, ['rgba(40,26,14,0.35)', 'rgba(150,115,80,0.3)', 'rgba(95,70,45,0.4)'], 2);
  };
  // 0 : terre tassée, ornières, cailloux, feuilles sur les bords
  let x0 = 0;
  earth(x0, '#7a5b3d');
  ruts(x0, 'rgba(70,50,32,0.55)');
  speck(x0, 160, ['#9c948a', '#7d7569', '#b3a996'], 4);
  leaves(x0);
  // 1 : racines qui traversent la piste
  x0 = TW;
  earth(x0, '#6e5236');
  ruts(x0, 'rgba(60,42,26,0.5)');
  for (let k = 0; k < 14; k++) {
    const y = r() * H;
    ctx.strokeStyle = '#4a3220';
    ctx.lineWidth = 6 + r() * 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0 - 4, y);
    ctx.bezierCurveTo(x0 + TW * 0.3, y + (r() - 0.5) * 60, x0 + TW * 0.7, y + (r() - 0.5) * 60, x0 + TW + 4, y + (r() - 0.5) * 50);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(160,120,80,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  leaves(x0);
  // 2 : pierrier (dalles et blocs, terre entre)
  x0 = TW * 2;
  earth(x0, '#5d4a36');
  for (let k = 0; k < 70; k++) {
    const cx = x0 + r() * TW;
    const cy = r() * H;
    const rad = 7 + r() * 14;
    const v = 105 + r() * 70;
    ctx.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
    ctx.beginPath();
    for (let a = 0; a < 7; a++) {
      const ang = (a / 7) * 6.28;
      const rr = rad * (0.7 + r() * 0.4);
      ctx.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr * 0.8);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(cx - rad * 0.4, cy - rad * 0.5, rad * 0.6, rad * 0.25);
  }
  // 3 : gravier
  x0 = TW * 3;
  earth(x0, '#8f8370');
  speck(x0, 5200, ['#b9ae9a', '#6f6658', '#a39782', '#d2c8b4', '#57503f'], 3);
  ruts(x0, 'rgba(90,80,64,0.35)', 12);
  // 4 : boue (sombre, flaques brillantes, traces de pneus)
  x0 = TW * 4;
  earth(x0, '#4a3524');
  for (let k = 0; k < 18; k++) {
    ctx.fillStyle = 'rgba(30,22,14,0.75)';
    ctx.beginPath();
    ctx.ellipse(x0 + r() * TW, r() * H, 10 + r() * 22, 6 + r() * 14, r() * 3, 0, 6.28);
    ctx.fill();
  }
  ruts(x0, 'rgba(25,18,10,0.7)', 12);
  leaves(x0);
  // 5 : lit du ruisseau (galets ronds vus sous l'eau)
  x0 = TW * 5;
  earth(x0, '#5b5640');
  for (let k = 0; k < 160; k++) {
    const v = 90 + r() * 80;
    ctx.fillStyle = `rgb(${v},${v + 4},${v - 14})`;
    ctx.beginPath();
    ctx.ellipse(x0 + r() * TW, r() * H, 4 + r() * 8, 3 + r() * 6, r() * 3, 0, 6.28);
    ctx.fill();
  }
  // 6 : planches de la passerelle (en travers), clous, joints
  x0 = TW * 6;
  const planks = 24;
  for (let k = 0; k < planks; k++) {
    const v = 0.75 + r() * 0.3;
    ctx.fillStyle = `rgb(${Math.round(150 * v)},${Math.round(118 * v)},${Math.round(84 * v)})`;
    ctx.fillRect(x0, (k * H) / planks, TW, H / planks);
    for (let g = 0; g < 18; g++) {
      ctx.fillStyle = `rgba(70,50,30,${0.1 + r() * 0.15})`;
      ctx.fillRect(x0 + r() * TW, (k * H) / planks + r() * (H / planks), 10 + r() * 40, 1);
    }
    ctx.fillStyle = 'rgba(25,18,10,0.9)';
    ctx.fillRect(x0, (k * H) / planks, TW, 2);
    ctx.fillStyle = 'rgba(70,70,70,0.9)';
    for (const u of [0.08, 0.92]) ctx.fillRect(x0 + u * TW - 1.5, (k * H) / planks + H / planks / 2 - 1.5, 3, 3);
  }
  // 7 : réserve (terre claire)
  earth(TW * 7, '#806246');
  // Relief : normales à partir de la luminance (planches et galets ressortent)
  const img = ctx.getImageData(0, 0, cv.width, H).data;
  const W = cv.width;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = (img[i * 4] * 0.3 + img[i * 4 + 1] * 0.59 + img[i * 4 + 2] * 0.11) / 255;
  const nd = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const tx = Math.floor(x / TW) * TW;
      const at = (xx, yy) => lum[((yy + H) % H) * W + tx + ((xx - tx + TW) % TW)];
      const dx = (at(x + 1, y) - at(x - 1, y)) * 3.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 3.2;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * W + x) * 4;
      nd[o] = Math.round((-dx / l * 0.5 + 0.5) * 255);
      nd[o + 1] = Math.round((dy / l * 0.5 + 0.5) * 255);
      nd[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      nd[o + 3] = 255;
    }
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const normal = new THREE.DataTexture(nd, W, H, THREE.RGBAFormat);
  for (const t of [map, normal]) {
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
  }
  atlasCache = { map, normal };
  return atlasCache;
}

// Taches de soleil du sous-bois (lumière directe tamisée par le feuillage), dans le shader des matières.
const DAPPLE_GLSL = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
float dappleAt( vec2 p ) {
  float n = texture2D( uNoise, p * 0.034 + vec2( uTime * 0.0021, uTime * 0.0013 ) ).g;
  float m = texture2D( uNoise, p * 0.11 - vec2( uTime * 0.004, 0.0 ) ).a;
  return mix( 0.42, 1.08, smoothstep( 0.47, 0.62, n * 0.8 + m * 0.3 ) );
}`;
function withDapple(frag, posVar) {
  return frag
    .replace('#include <common>', `#include <common>\n${DAPPLE_GLSL}`)
    .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
      'getDirectionalLightInfo( directionalLight, directLight );',
      `getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= dappleAt( ${posVar}.xz );`,
    ));
}

// Matière du sentier : une seule instruction de dessin pour tous les revêtements (tuile par sommet).
function trailMaterial(shared, quality) {
  const atlas = trailAtlas();
  const mat = new THREE.MeshStandardMaterial({ map: atlas.map, normalMap: quality === 'low' ? null : atlas.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNoise = { value: shared.noise };
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTile;\nvarying float vTile;\nvarying vec3 vTrailPos;\nvarying vec2 vTrailUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTile = aTile;\nvTrailPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvTrailUv = uv;');
    const sample = (tex) => `textureGrad( ${tex}, vec2( ( floor( vTile + 0.5 ) + clamp( vTrailUv.x, 0.02, 0.98 ) ) / 8.0, fract( vTrailUv.y ) ), dFdx( vTrailUv ) * vec2( 0.125, 1.0 ), dFdy( vTrailUv ) * vec2( 0.125, 1.0 ) )`;
    sh.fragmentShader = withDapple(sh.fragmentShader, 'vTrailPos')
      .replace('#include <common>', '#include <common>\nvarying float vTile;\nvarying vec3 vTrailPos;\nvarying vec2 vTrailUv;\nconst float TROUGH[8] = float[8]( ' + ROUGH.map((x) => x.toFixed(2)).join(', ') + ' );')
      .replace('#include <map_fragment>', `vec4 trailTex = ${sample('map')};\ndiffuseColor *= trailTex;\ndiffuseColor.rgb *= 0.88 + texture2D( uNoise, vTrailPos.xz * 0.05 ).r * 0.24;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = TROUGH[ int( floor( vTile + 0.5 ) ) ];')
      .replace('#include <normal_fragment_maps>', quality === 'low' ? '' : `vec3 mapN = ${sample('normalMap')}.xyz * 2.0 - 1.0;\nmapN.xy *= normalScale;\nnormal = normalize( tbn * mapN );`);
  };
  mat.customProgramCacheKey = () => `mtb-trail-${quality}`;
  return mat;
}

// ---------------------------------------------------------------------------------------------
// Petits éléments du sous-bois (géométries instanciées)
// ---------------------------------------------------------------------------------------------

function fernGeometry(fronds = 7) {
  const pos = [];
  const col = [];
  const idx = [];
  const SEG = 5;
  const dark = C('#264d1c');
  const light = C('#6ea042');
  const c = new THREE.Color();
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + (f % 2) * 0.3;
    const len = 0.75 + (f % 3) * 0.15;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const base = pos.length / 3;
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG;
      const r = t * len;
      const y = Math.sin(t * 2.2) * 0.42 * len - t * t * 0.25;
      const w = 0.16 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.9));
      pos.push(dx * r - dz * w, y, dz * r + dx * w, dx * r + dz * w, y, dz * r - dx * w);
      c.copy(dark).lerp(light, 0.25 + t * 0.6);
      col.push(c.r, c.g, c.b, c.r * 0.85, c.g * 0.85, c.b * 0.85);
    }
    for (let k = 0; k < SEG; k++) {
      const o = base + k * 2;
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Normales vers le haut (éclairage doux du feuillage, sans face sombre)
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
  return g;
}

function logGeometry(seg = 9) {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, seg, 1).rotateZ(Math.PI / 2);
  g.computeVertexNormals();
  return paint(g, (c, x, y, z) => {
    if (Math.abs(x) > 0.49) c.set('#b08a5e').lerp(C('#7a5a38'), Math.hypot(y, z) * 1.6);
    else c.set('#4c3a28').multiplyScalar(0.85 + noise3(x * 6, y * 9, z * 9) * 0.3).lerp(C('#4f6a2c'), Math.max(0, y) * 0.5);
  });
}

function stumpGeometry() {
  const g = new THREE.CylinderGeometry(0.34, 0.5, 0.55, 10, 2).translate(0, 0.27, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < 0.1) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const k = 1 + Math.max(0, Math.sin(a * 5)) * 0.35;
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
  }
  g.computeVertexNormals();
  return paint(g, (c, x, y, z) => {
    const r = Math.hypot(x, z);
    if (y > 0.54) c.set('#b5915f').multiplyScalar(0.85 + 0.15 * Math.sin(r * 60));
    else c.set('#4e3c2a').multiplyScalar(0.85 + noise3(x * 8, y * 8, z * 8) * 0.25);
  });
}

function mushroomGeometry() {
  const parts = [];
  const stem = paint(new THREE.CylinderGeometry(0.025, 0.035, 0.14, 6).translate(0, 0.07, 0), (c) => c.set('#efe8d8'));
  const cap = new THREE.SphereGeometry(0.075, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1).translate(0, 0.13, 0);
  let s = 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  paint(cap, (c, x, y) => c.set(y > 0.15 && rnd() < 0.18 ? '#f6f1e6' : '#c8261c'));
  parts.push(indexify(stem), indexify(cap));
  return mergeGeometries(parts);
}

function rootGeometry() {
  const pts = [new THREE.Vector3(-1.1, -0.05, 0.1), new THREE.Vector3(-0.4, 0.02, -0.08), new THREE.Vector3(0.3, 0.03, 0.06), new THREE.Vector3(1.1, -0.06, -0.1)];
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.045, 5, false);
  return paint(g, (c, x) => c.set('#4a3322').lerp(C('#6d5038'), (Math.sin(x * 9) + 1) * 0.2));
}

// ---------------------------------------------------------------------------------------------
// Gouttes du ruisseau et poussière : un seul nuage de points recyclé (aucune allocation par image).
// ---------------------------------------------------------------------------------------------
function makeFx(count = 220) {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const life = new Float32Array(count);
  const max = new Float32Array(count).fill(1);
  const kind = new Uint8Array(count); // 0 eau, 1 poussière, 2 boue
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  const sizeAttr = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
  const lifeAttr = new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  geo.setAttribute('aSize', sizeAttr);
  geo.setAttribute('aLife', lifeAttr);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 420 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aLife;
      attribute vec3 color;
      uniform float uScale;
      varying vec3 vCol;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        vCol = color;
        vA = clamp( aLife, 0.0, 1.0 );
        gl_PointSize = aLife > 0.0 ? aSize * uScale / max( 0.5, - mv.z ) : 0.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying float vA;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a = smoothstep( 0.5, 0.18, length( q ) ) * vA;
        if ( a < 0.02 ) discard;
        gl_FragColor = vec4( vCol, a );
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  let next = 0;
  let alive = 0;
  const COLORS = [[0.86, 0.93, 0.97], [0.55, 0.45, 0.33], [0.3, 0.22, 0.14]];
  return {
    points,
    // Lance n particules autour de (x, y, z) ; (vx, vz) : vitesse du coureur ; type : 0 eau, 1 poussière, 2 boue.
    burst(x, y, z, vx, vz, n, type = 0, spread = 0.5) {
      for (let k = 0; k < n; k++) {
        const i = next;
        next = (next + 1) % count;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * spread;
        pos[i * 3] = x + Math.cos(a) * r;
        pos[i * 3 + 1] = y + Math.random() * 0.1;
        pos[i * 3 + 2] = z + Math.sin(a) * r;
        const up = type === 1 ? 0.4 + Math.random() * 0.6 : 1.2 + Math.random() * 2.2;
        const side = type === 1 ? 0.8 : 1.4;
        vel[i * 3] = vx * 0.35 + Math.cos(a) * side * Math.random();
        vel[i * 3 + 1] = up;
        vel[i * 3 + 2] = vz * 0.35 + Math.sin(a) * side * Math.random();
        const c = COLORS[type];
        col[i * 3] = c[0];
        col[i * 3 + 1] = c[1];
        col[i * 3 + 2] = c[2];
        size[i] = type === 1 ? 0.35 + Math.random() * 0.35 : 0.07 + Math.random() * 0.08;
        max[i] = type === 1 ? 1.1 + Math.random() * 0.6 : 0.55 + Math.random() * 0.35;
        life[i] = max[i];
        kind[i] = type;
      }
      alive = count;
    },
    update(dt) {
      if (!alive) return;
      let any = 0;
      for (let i = 0; i < count; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) {
          life[i] = 0;
          continue;
        }
        any++;
        const k = kind[i];
        if (k === 1) {
          vel[i * 3] *= 1 - dt * 1.5;
          vel[i * 3 + 1] = vel[i * 3 + 1] * (1 - dt * 1.2) - dt * 0.2;
          vel[i * 3 + 2] *= 1 - dt * 1.5;
          size[i] += dt * 0.5;
        } else vel[i * 3 + 1] -= 9.81 * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      alive = any;
      posAttr.needsUpdate = true;
      lifeAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
    },
    reset() {
      life.fill(0);
      lifeAttr.needsUpdate = true;
      alive = 0;
    },
  };
}

// Puits de lumière dans les trouées (rubans additifs tournés vers la caméra, alignés sur le soleil).
function lightShafts(items, shared) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 1, 3, 2]);
  const data = new Float32Array(items.length * 4);
  items.forEach(([x, y, z, w], i) => data.set([x, y, z, w], i * 4));
  geo.setAttribute('aShaft', new THREE.InstancedBufferAttribute(data, 4));
  geo.instanceCount = items.length;
  const s = SUN_DIR;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime },
    vertexShader: /* glsl */ `
      attribute vec4 aShaft;
      uniform float uTime;
      varying vec2 vUv;
      varying float vFade;
      void main() {
        vec3 axis = vec3( ${s.x.toFixed(4)}, ${s.y.toFixed(4)}, ${s.z.toFixed(4)} );
        vec3 base = aShaft.xyz;
        vec3 toCam = normalize( cameraPosition - base );
        vec3 side = normalize( cross( axis, toCam ) );
        float len = 26.0;
        vec3 p = base + axis * position.y * len + side * position.x * aShaft.w * ( 1.0 + position.y * 0.8 );
        vUv = vec2( position.x + 0.5, position.y );
        float d = distance( cameraPosition, base );
        vFade = smoothstep( 6.0, 16.0, d ) * ( 1.0 - smoothstep( 70.0, 130.0, d ) ) * ( 0.75 + 0.25 * sin( uTime * 0.5 + base.x ) );
        gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFade;
      void main() {
        float a = sin( 3.14159 * vUv.x ) * smoothstep( 0.0, 0.25, vUv.y ) * ( 1.0 - smoothstep( 0.55, 1.0, vUv.y ) ) * vFade * 0.13;
        gl_FragColor = vec4( vec3( 1.0, 0.92, 0.72 ) * a, a );
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return mesh;
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

function bannerTexture() {
  return canvasTexture(1024, 160, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#1f4a2a');
    g.addColorStop(1, '#2f6b3a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ff5a1f';
    ctx.fillRect(0, h - 18, w, 18);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 70px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FORÊT DES CRÊTES', w / 2, h / 2 - 16);
    ctx.font = '700 30px system-ui, sans-serif';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('MyCycleWorld · VTT', w / 2, h / 2 + 40);
  });
}

function checkerTexture() {
  return canvasTexture(128, 32, (ctx, w, h) => {
    const sq = h / 2;
    for (let x = 0; x < w / sq; x++) for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#141414' : '#f5f5f5';
      ctx.fillRect(x * sq, y * sq, sq, sq);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Pièces en bois et en terre (sauts, passerelle, rubalise, panneaux, arche) : une géométrie fusionnée.
// ---------------------------------------------------------------------------------------------
class Builder {
  constructor() {
    this.pos = [];
    this.col = [];
  }

  tri(a, b, c, color) {
    this.pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) this.col.push(color.r, color.g, color.b);
  }

  quad(a, b, c, d, color) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  // Boîte orientée : centre, axes (vecteurs unitaires) et demi-tailles.
  box(cx, cy, cz, ax, ay, az, hx, hy, hz, color) {
    const P = (sx, sy, sz) => [
      cx + ax[0] * sx * hx + ay[0] * sy * hy + az[0] * sz * hz,
      cy + ax[1] * sx * hx + ay[1] * sy * hy + az[1] * sz * hz,
      cz + ax[2] * sx * hx + ay[2] * sy * hy + az[2] * sz * hz,
    ];
    const c = color;
    const dark = c.clone().multiplyScalar(0.8);
    this.quad(P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), c);
    this.quad(P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), P(-1, -1, -1), dark);
    this.quad(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), dark);
    this.quad(P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), dark);
    this.quad(P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), P(-1, -1, 1), dark);
  }

  // Poteau vertical (boîte) de (x, y0, z) à la hauteur y1.
  post(x, y0, z, y1, w, color, yaw = 0) {
    const ax = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const az = [Math.sin(yaw), 0, Math.cos(yaw)];
    this.box(x, (y0 + y1) / 2, z, ax, [0, 1, 0], az, w, (y1 - y0) / 2, w, color);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

// Sauts : rampe en planches jusqu'à la lèvre, cadre latéral, réception en terre (même forme que src/core/mtb.js).
function addKickers(B, track, td, surfaceY) {
  const half = td.half;
  const wood = C('#a57a4c');
  const woodDark = C('#6f4f30');
  const earth = C('#6a4e34');
  const f = {};
  const at = (s, lat, h) => {
    track.frame(s, lat, f);
    return [f.x, surfaceY(s, lat) + h, f.z];
  };
  for (const j of td.jumps) {
    const w = half - 0.05;
    const STEP = 0.25;
    // Rampe : planches alternées
    for (let d = -j.len, k = 0; d < 0 - 1e-6; d += STEP, k++) {
      const d2 = Math.min(0, d + STEP);
      const h1 = kickerHeight(d, j);
      const h2 = kickerHeight(d2, j);
      const col = k % 2 ? wood : wood.clone().multiplyScalar(0.9);
      B.quad(at(j.s + d, -w, h1), at(j.s + d, w, h1), at(j.s + d2, w, h2), at(j.s + d2, -w, h2), col);
      // Flancs
      for (const side of [-1, 1]) {
        const a = at(j.s + d, side * w, 0);
        const b = at(j.s + d2, side * w, 0);
        const c = at(j.s + d2, side * w, h2);
        const e = at(j.s + d, side * w, h1);
        if (side < 0) B.quad(a, e, c, b, woodDark);
        else B.quad(a, b, c, e, woodDark);
      }
    }
    // Face arrière (verticale) sous la lèvre
    B.quad(at(j.s, -w, 0), at(j.s, -w, j.h), at(j.s, w, j.h), at(j.s, w, 0), woodDark);
    // Réception en terre : face avant puis pente douce
    const l0 = MTB.gap * 0.6;
    const l1 = MTB.gap + MTB.landLen;
    for (let d = l0; d < l1 - 1e-6; d += STEP) {
      const d2 = Math.min(l1, d + STEP);
      const h1 = kickerHeight(d, j);
      const h2 = kickerHeight(d2, j);
      B.quad(at(j.s + d, -w - 0.3, h1), at(j.s + d, w + 0.3, h1), at(j.s + d2, w + 0.3, h2), at(j.s + d2, -w - 0.3, h2), earth);
      for (const side of [-1, 1]) {
        const a = at(j.s + d, side * (w + 1.1), 0);
        const b = at(j.s + d2, side * (w + 1.1), 0);
        const c = at(j.s + d2, side * (w + 0.3), h2);
        const e = at(j.s + d, side * (w + 0.3), h1);
        if (side < 0) B.quad(a, e, c, b, earth);
        else B.quad(a, b, c, e, earth);
      }
    }
  }
}

// Passerelle North Shore : poteaux jusqu'au marécage, longerons latéraux.
function addBridge(B, track, td, surfaceY, heightAt) {
  if (!td.bridge) return;
  const f = {};
  const wood = C('#7b5a3a');
  for (let s = td.bridge.s0 - 1; s <= td.bridge.s1 + 1; s += 1.6) {
    for (const side of [-1, 1]) {
      track.frame(s, side * (td.half - 0.08), f);
      const top = surfaceY(s, side * td.half);
      const g = heightAt(f.x, f.z);
      if (top - g > 0.15) B.post(f.x, g - 0.2, f.z, top - 0.02, 0.07, wood, Math.atan2(f.tx, f.tz));
    }
  }
  // Longerons : bandes latérales sous le tablier
  const a = {};
  const b = {};
  for (let s = td.bridge.s0 - 1; s < td.bridge.s1 + 1; s += 1) {
    for (const side of [-1, 1]) {
      track.frame(s, side * (td.half + 0.02), a);
      track.frame(s + 1, side * (td.half + 0.02), b);
      const ya = surfaceY(s, side * td.half);
      const yb = surfaceY(s + 1, side * td.half);
      B.quad([a.x, ya - 0.28, a.z], [b.x, yb - 0.28, b.z], [b.x, yb + 0.02, b.z], [a.x, ya + 0.02, a.z], wood.clone().multiplyScalar(0.8));
    }
  }
}

// Rubalise à l'extérieur des virages serrés (piquets et ruban rouge et blanc) et panneaux de direction.
function addTape(B, track, td, heightAt) {
  const stake = C('#e2dccb');
  const red = C('#d8322a');
  const white = C('#f2f2ee');
  const f = {};
  let prev = null;
  let k = 0;
  const signs = [];
  for (let s = 0; s < track.length; s += 3) {
    const kc = track.curvatureAt(s);
    if (Math.abs(kc) < 0.065) {
      prev = null;
      continue;
    }
    const out = -Math.sign(kc);
    track.frame(s, out * (td.half + 1.3), f);
    if (td.creek) {
      const c = td.creek.near(f.x, f.z);
      if (c && c.d < c.w + 0.5) {
        prev = null;
        continue;
      }
    }
    const y = heightAt(f.x, f.z);
    B.post(f.x, y - 0.1, f.z, y + 0.95, 0.025, stake);
    const cur = [f.x, y, f.z, out];
    if (prev && prev[3] === out) {
      const col = k++ % 2 ? red : white;
      const sag = -0.05;
      const m = [(prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2 + 0.78 + sag, (prev[2] + cur[2]) / 2];
      B.quad([prev[0], prev[1] + 0.82, prev[2]], [m[0], m[1] + 0.04, m[2]], [m[0], m[1] - 0.03, m[2]], [prev[0], prev[1] + 0.75, prev[2]], col);
      B.quad([m[0], m[1] + 0.04, m[2]], [cur[0], cur[1] + 0.82, cur[2]], [cur[0], cur[1] + 0.75, cur[2]], [m[0], m[1] - 0.03, m[2]], col);
    }
    prev = cur;
    if (Math.abs(kc) > 0.09 && (!signs.length || s - signs[signs.length - 1] > 60)) signs.push(s);
  }
  // Panneaux jaunes à chevron noir, avant les épingles
  const yellow = C('#f2c230');
  const black = C('#1a1a1a');
  for (const s0 of signs) {
    const s = s0 - 12;
    const kc = track.curvatureAt(s0);
    const out = -Math.sign(kc);
    track.frame(s, out * (td.half + 1.6), f);
    const y = heightAt(f.x, f.z);
    const yaw = Math.atan2(f.tx, f.tz);
    B.post(f.x, y - 0.1, f.z, y + 1.25, 0.04, C('#6d5a44'), yaw);
    // Panneau face au coureur (normal = -tangente)
    const ax = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const az = [Math.sin(yaw), 0, Math.cos(yaw)];
    B.box(f.x - f.tx * 0.06, y + 1.25, f.z - f.tz * 0.06, ax, [0, 1, 0], az, 0.32, 0.22, 0.02, yellow);
    // Chevron (vers l'intérieur du virage)
    const dir = -out;
    const cx = f.x - f.tx * 0.09;
    const cz = f.z - f.tz * 0.09;
    const R = (u, v) => [cx + ax[0] * u * dir, y + 1.25 + v, cz + ax[2] * u * dir];
    B.quad(R(-0.12, 0.15), R(0.12, 0), R(0.04, 0), R(-0.2, 0.15), black);
    B.quad(R(0.12, 0), R(-0.12, -0.15), R(-0.2, -0.15), R(0.04, 0), black);
  }
}

// Arche de départ en rondins.
function addArch(B, track, td, heightAt) {
  const f = track.frame(0, 0, {});
  const yaw = Math.atan2(f.tx, f.tz);
  const log = C('#6a4b2f');
  for (const side of [-1, 1]) {
    const x = f.x + f.rx * side * (td.half + 0.9);
    const z = f.z + f.rz * side * (td.half + 0.9);
    B.post(x, heightAt(x, z) - 0.3, z, f.y + 4.3, 0.17, log, yaw);
  }
  const ax = [f.rx, 0, f.rz];
  const az = [f.tx, 0, f.tz];
  B.box(f.x, f.y + 4.25, f.z, ax, [0, 1, 0], az, td.half + 1.3, 0.14, 0.14, log);
  return { x: f.x, y: f.y, z: f.z, yaw };
}

// ---------------------------------------------------------------------------------------------
// Construction du décor détaillé
// ---------------------------------------------------------------------------------------------

export function buildForestScenery(scene, track, { quality = 'high', renderer = null, detailed = true } = {}) {
  if (!detailed) return buildForestSimple(scene, track);
  installFog();
  const td = trailData(track);
  const half = td.half;
  const group = new THREE.Group();
  group.userData.tag = 'scenery';
  scene.add(group);
  const density = quality === 'high' ? 1 : quality === 'medium' ? 0.62 : 0.38;
  const r = rng(31);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s3 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const e = new THREE.Euler();
  const shared = { uTime: { value: 0 }, uWind: { value: 0.8 }, uWet: { value: 0 }, noise: noiseTexture() };
  const mood = FOREST_MOOD;

  // Ciel, brume, lumières, environnement
  applyMood(scene, mood);
  const sky = makeSkyDome(mood, quality);
  sky.userData.tag = 'scenery';
  scene.add(sky);
  let envTex = null;
  if (renderer) {
    envTex = makeEnvironment(renderer, sky);
    scene.environment = envTex;
    scene.environmentIntensity = mood.env;
  }

  // Terrain
  const b = track.bounds;
  const margin = 230;
  const ground = makeGround(track, td, margin + 40);
  const heightAt = (x, z) => ground(x, z).h;
  const cell = quality === 'high' ? 3.2 : quality === 'medium' ? 4.5 : 6;
  const w = b.maxX - b.minX + margin * 2;
  const d = b.maxZ - b.minZ + margin * 2;
  const gx = Math.ceil(w / cell);
  const gz = Math.ceil(d / cell);
  const tg = new THREE.PlaneGeometry(w, d, gx, gz);
  tg.rotateX(-Math.PI / 2);
  tg.translate((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  const tp = tg.attributes.position;
  const heights = new Float32Array(tp.count);
  const info = new Array(tp.count);
  for (let i = 0; i < tp.count; i++) {
    const g = ground(tp.getX(i), tp.getZ(i));
    tp.setY(i, g.h);
    heights[i] = g.h;
    info[i] = g;
  }
  tg.computeVertexNormals();
  const tn = tg.attributes.normal;
  const col = new Float32Array(tp.count * 3);
  const mixA = new Float32Array(tp.count * 4);
  const wetA = new Float32Array(tp.count);
  const groundTex = new Uint8Array(tp.count * 4);
  const c = new THREE.Color();
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i);
    const z = tp.getZ(i);
    const g = info[i];
    const dd = Math.abs(g.near.lat);
    const k = (fbm(x * 0.03, z * 0.03, 3) + 1) / 2;
    const idx = clamp(k * (FLOOR.length - 1) * 1.2, 0, FLOOR.length - 1.001);
    c.copy(FLOOR[Math.floor(idx)]).lerp(FLOOR[Math.ceil(idx)], idx % 1).multiplyScalar(0.85 + fbm(x * 0.2, z * 0.2, 2) * 0.2);
    // Couches : litière et terre près du sentier et par plaques, roche sur les pentes et dans le lit du ruisseau.
    const litter = smoothstep(-0.2, 0.3, fbm(x * 0.06 + 7, z * 0.06, 3));
    const dirt = Math.max(smoothstep(half + 3.4, half + 0.8, dd), litter * 0.7, g.wet * 0.9);
    const rock = Math.max(smoothstep(0.7, 0.5, tn.getY(i)) * 0.85, g.bed * 0.8);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    mixA.set([rock, 0, dirt, 0], i * 4);
    wetA[i] = g.wet;
    groundTex[i * 4] = Math.round(c.r * 255);
    groundTex[i * 4 + 1] = Math.round(c.g * 255);
    groundTex[i * 4 + 2] = Math.round(c.b * 255);
    groundTex[i * 4 + 3] = Math.round((1 - dirt) * (1 - rock) * 255);
  }
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.setAttribute('aMix', new THREE.BufferAttribute(mixA, 4));
  tg.setAttribute('aWet', new THREE.BufferAttribute(wetA, 1));
  const tMat = terrainMaterial({ ...THEME, mood: 'forest' }, shared, quality);
  const terrain = new THREE.Mesh(tg, tMat);
  terrain.receiveShadow = true;
  group.add(terrain);
  const x0 = (b.minX + b.maxX) / 2 - w / 2;
  const z0 = (b.minZ + b.maxZ) / 2 - d / 2;
  const maps = makeFieldMaps({ heights, nx: gx + 1, nz: gz + 1, x0, z0, cellX: w / gx, cellZ: d / gz, ground: groundTex });
  makeRoadMap(maps, track);

  // Sentier (une instruction de dessin) et accotements (matière du terrain)
  const n = track.count;
  const surfaceY = (s, lat) => track.frame(s, 0, tmpF).y + td.bankAt(s, lat) + 0.03;
  const tmpF = {};
  {
    const pos = [];
    const uv = [];
    const tile = [];
    const idx = [];
    const LATS = [-half, 0, half];
    let rows = 0;
    let prevTile = -1;
    let last = -1;
    const link = (ra, rb) => {
      const a = ra * 3;
      const bb = rb * 3;
      for (let j = 0; j < 2; j++) idx.push(a + j, a + j + 1, bb + j, a + j + 1, bb + j + 1, bb + j);
    };
    const pushRow = (i, t) => {
      const k = i % n;
      const rx = -track.tz[k];
      const rz = track.tx[k];
      for (let j = 0; j < 3; j++) {
        const lat = LATS[j];
        pos.push(track.x[k] + rx * lat, track.y[k] + td.yOff(k, lat) + 0.03 + (j === 1 ? 0.02 : 0), track.z[k] + rz * lat);
        uv.push(j / 2, (i * track.step) / 7);
        tile.push(t);
      }
      return rows++;
    };
    // Changement de revêtement : le rang est dédoublé (fin de l'ancien tronçon, début du nouveau).
    for (let i = 0; i <= n; i++) {
      const t = TILE[track.surf[i % n]] ?? 0;
      if (last >= 0 && t !== prevTile) link(last, pushRow(i, prevTile));
      const cur = pushRow(i, t);
      if (last >= 0 && t === prevTile) link(last, cur);
      last = cur;
      prevTile = t;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('aTile', new THREE.Float32BufferAttribute(tile, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeTangents?.();
    const trail = new THREE.Mesh(geo, trailMaterial(shared, quality));
    trail.receiveShadow = true;
    group.add(trail);
  }
  {
    // Accotements : du bord du sentier à la levée (virages relevés) puis au sol de la forêt.
    const pos = [];
    const colS = [];
    const mixS = [];
    const idx = [];
    const OUT = [0, 0.9, 3.4];
    const f = {};
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      for (const side of [-1, 1]) {
        for (let j = 0; j < 3; j++) {
          const lat = side * (half + OUT[j]);
          track.frame(k * track.step, lat, f);
          let y;
          if (j === 0) y = track.y[k] + td.yOff(k, lat) + 0.02;
          else {
            y = heightAt(f.x, f.z);
            if (j === 1) y = Math.max(y, track.y[k] + td.yOff(k, side * half) - 0.12 - td.bog[k] * 0.7);
          }
          pos.push(f.x, y - (j === 2 ? 0.02 : 0), f.z);
          const cc = FLOOR[(k + j) % FLOOR.length];
          colS.push(cc.r, cc.g, cc.b);
          mixS.push(0, 0, j === 0 ? 1 : j === 1 ? 0.85 : 0.4, 0);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (td.bog[i] > 0.5 && td.bog[i + 1] > 0.5) continue; // passerelle : on voit le marécage dessous
      for (let sIdx = 0; sIdx < 2; sIdx++) {
        const a = i * 6 + sIdx * 3;
        const bq = (i + 1) * 6 + sIdx * 3;
        for (let j = 0; j < 2; j++) {
          if (sIdx === 0) idx.push(a + j, bq + j, a + j + 1, a + j + 1, bq + j, bq + j + 1);
          else idx.push(a + j, a + j + 1, bq + j, a + j + 1, bq + j + 1, bq + j);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colS, 3));
    geo.setAttribute('aMix', new THREE.Float32BufferAttribute(mixS, 4));
    geo.setAttribute('aWet', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const sh = new THREE.Mesh(geo, tMat);
    sh.receiveShadow = true;
    group.add(sh);
  }

  // Ruisseau : eau qui coule (shader de water.js), lit creusé dans le terrain
  let water = null;
  if (td.creek) {
    const cr = td.creek;
    const pts = cr.samples;
    const pos = [];
    const flow = [];
    const idx = [];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      const q2 = pts[Math.min(pts.length - 1, k + 1)];
      const p0 = pts[Math.max(0, k - 1)];
      let tx = q2.x - p0.x;
      let tz = q2.z - p0.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      const ww = p.w + 0.5;
      pos.push(p.x - tz * ww, cr.level, p.z + tx * ww, p.x + tz * ww, cr.level, p.z - tx * ww);
      const speed = 0.7 + (1 - p.onTrail) * 0.5;
      const rapid = 0.15 + 0.3 * Math.max(0, noise3(k * 0.3, 2.1, 0.4));
      flow.push(tx * speed, tz * speed, rapid, tx * speed, tz * speed, rapid);
      if (k) {
        const a = (k - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 3));
    geo.setIndex(idx);
    // Sans carte du terrain : eau claire et peu profonde partout (pas d'écume de rivage), courant et remous.
    water = makeWater(geo, { mood, maps: null, waterY: cr.level, shared, flow: true, chop: 0.3, foam: 0, shallow: '#7fa592', deep: '#2b5547', sand: '#857452', depthScale: 0.06 });
    // Légèrement transparente : on devine les galets du lit sous l'eau.
    water.material.fragmentShader = water.material.fragmentShader.replace('gl_FragColor = vec4( col, 1.0 );', 'gl_FragColor = vec4( col, 0.78 );');
    water.material.transparent = true;
    water.material.depthWrite = false;
    water.renderOrder = 2;
    group.add(water);
  }

  // Emplacements libres (hors du sentier, du ruisseau, de l'aire de départ)
  const start = track.frame(0, 0, {});
  const reserved = [];
  const free = (x, z, minTrail) => {
    const g = ground(x, z);
    if (g.near.dist < minTrail) return null;
    if (Math.hypot(x - start.x, z - start.z) < 14) return null;
    if (td.creek) {
      const cc = td.creek.near(x, z);
      if (cc && cc.d < cc.w + 1.2) return null;
    }
    for (const [rx, rz, rad] of reserved) if ((x - rx) ** 2 + (z - rz) ** 2 < rad * rad) return null;
    return g;
  };
  const randomPoint = (spread) => [b.minX - spread + r() * (b.maxX - b.minX + spread * 2), b.minZ - spread + r() * (b.maxZ - b.minZ + spread * 2)];
  // Spectateurs et réceptions des sauts : on y garde de la place.
  for (const j of td.jumps) {
    const f = track.frame(j.s + 3, 0, {});
    reserved.push([f.x, f.z, half + 5.5]);
  }

  // Pièces en bois et en terre (une seule géométrie)
  const B = new Builder();
  addKickers(B, track, td, surfaceY);
  addBridge(B, track, td, surfaceY, heightAt);
  addTape(B, track, td, heightAt);
  const arch = addArch(B, track, td, heightAt);
  const props = new THREE.Mesh(B.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, side: THREE.DoubleSide }));
  props.castShadow = quality !== 'low';
  props.receiveShadow = true;
  group.add(props);
  // Banderole et ligne de départ (textures)
  const bannerTex = bannerTexture();
  const bw = half * 2 + 2.2;
  const bannerGeo = mergeGeometries([
    indexify(new THREE.PlaneGeometry(bw, 0.95).translate(0, 0, 0.16)),
    indexify(new THREE.PlaneGeometry(bw, 0.95).rotateY(Math.PI).translate(0, 0, -0.16)),
  ]);
  const uvA = [];
  for (let k = 0; k < 2; k++) uvA.push(0, 1, 1, 1, 0, 0, 1, 0);
  bannerGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
  const banner = new THREE.Mesh(bannerGeo, new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.7 }));
  banner.position.set(arch.x, arch.y + 3.55, arch.z);
  banner.rotation.y = arch.yaw;
  banner.castShadow = true;
  group.add(banner);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 0.8), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.7 }));
  line.rotation.set(-Math.PI / 2, arch.yaw, 0, 'YXZ');
  line.position.set(arch.x, surfaceY(0, 0) + 0.035, arch.z);
  line.receiveShadow = true;
  group.add(line);

  // Arbres : sapins et feuillus serrés près du sentier, sous-bois de buissons ; niveaux de détail (nature.js).
  const pines = [];
  const round = [];
  const bushes = [];
  const wantTrees = Math.round(7800 * density);
  const tmpF2 = {};
  for (let tries = 0; tries < wantTrees * 6 && pines.length + round.length < wantTrees; tries++) {
    // Deux arbres sur trois tirés le long du sentier (lisière dense), les autres partout.
    let x;
    let z;
    if (r() < 0.65) {
      const f = track.frame(r() * track.length, (r() < 0.5 ? -1 : 1) * (half + 2 + Math.pow(r(), 1.3) * 45), tmpF2);
      x = f.x + (r() - 0.5) * 4;
      z = f.z + (r() - 0.5) * 4;
    } else [x, z] = randomPoint(200);
    const near = free(x, z, half + 2.2 + r() * 2);
    if (!near) continue;
    // Clairières rares, lisière plus dense le long du sentier
    if (fbm(x * 0.012 + 9, z * 0.012, 2) < -0.32 && near.near.dist > 12) continue;
    const y = near.h;
    const sc = 0.85 + r() * 0.75;
    if (r() < (near.near.dist > 60 ? 0.62 : 0.5)) pines.push([x, y, z, sc * 1.25, r()]);
    else round.push([x, y, z, sc * 1.1, r()]);
  }
  for (let tries = 0; tries < 9000 && bushes.length < Math.round(1100 * density); tries++) {
    const [x, z] = randomPoint(60);
    const near = free(x, z, half + 1.4);
    if (!near || near.near.dist > 40) continue;
    bushes.push([x, near.h, z, 0.5 + r() * 0.8, r()]);
  }
  const solidMat = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }), shared, { key: 'solid' });
  const cards = quality === 'high';
  const leafMat = cards ? crispAlpha(windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, map: leafAtlas(), alphaTest: 0.5, side: THREE.DoubleSide }), shared, { key: 'leaf', flutter: 0.035, noFlip: true })) : null;
  if (leafMat) leafMat.alphaToCoverage = true;
  const tints = ['#ffffff', '#e8f6d8', '#dff0cf', '#f4f0c8', '#e2f2e0', '#d6e8c4'].map(C);
  const dist = quality === 'high' ? { close: 30, mid: 72 } : quality === 'medium' ? { close: 30, mid: 60 } : { close: 0.1, mid: 42 };
  const castTrees = quality !== 'low';
  const forest = new Forest(group, [
    { near: deciduousGeometry(0, cards), mid: deciduousGeometry(1), impostor: 'deciduous', items: round, cast: castTrees, tints, nearMaterial: cards ? [solidMat, leafMat] : solidMat, material: solidMat },
    { near: pineGeometry(0), mid: pineGeometry(1), impostor: 'pine', items: pines, cast: castTrees, tints: null, material: solidMat },
    { near: bushGeometry(0), mid: bushGeometry(1), impostor: 'bush', items: bushes, cast: false, tints, material: solidMat },
  ], dist);

  // Fougères (le long du sentier)
  const ferns = [];
  for (let tries = 0; tries < 12000 && ferns.length < Math.round((quality === 'high' ? 1000 : 1300) * density); tries++) {
    const s = r() * track.length;
    const side = r() < 0.5 ? -1 : 1;
    const f = track.frame(s, side * (half + 0.9 + Math.pow(r(), 1.5) * 14), {});
    const g = free(f.x, f.z, half + 0.8);
    if (!g || td.bog[g.near.i] > 0.5) continue;
    ferns.push([f.x, g.h, f.z, 0.55 + r() * 0.7, r()]);
  }
  const fernMat = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), shared, { key: 'fern', base: 0.05, amount: 0.05 });
  const fernMesh = new THREE.InstancedMesh(fernGeometry(quality === 'low' ? 5 : 7), fernMat, ferns.length);
  ferns.forEach(([x, y, z, sc, k], i) => {
    m4.compose(v3.set(x, y - 0.04, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, k * 6.28), s3.set(sc, sc * (0.8 + k * 0.4), sc));
    fernMesh.setMatrixAt(i, m4);
  });
  fernMesh.receiveShadow = true;
  group.add(fernMesh);

  // Rochers : sous-bois, berges du ruisseau, pierrier dans le sentier
  const rocks = [];
  for (let tries = 0; tries < 5000 && rocks.length < Math.round(260 * density); tries++) {
    const [x, z] = randomPoint(120);
    const g = free(x, z, half + 2.5);
    if (!g) continue;
    const sc = 0.35 + Math.pow(r(), 2) * 1.6;
    rocks.push([x, g.h - sc * 0.25, z, sc, sc * 0.65, sc * 1.1, r()]);
  }
  if (td.creek) {
    for (const [k, p] of td.creek.samples.entries()) {
      if (k % 2 || p.onTrail > 0.6) continue;
      for (const side of [-1, 1]) {
        if (r() < 0.35) continue;
        const pp = td.creek.samples[Math.min(td.creek.samples.length - 1, k + 1)];
        const tx = pp.x - p.x;
        const tz = pp.z - p.z;
        const l = Math.hypot(tx, tz) || 1;
        const off = side * (p.w + 0.2 + r() * 0.6);
        const x = p.x - (tz / l) * off;
        const z = p.z + (tx / l) * off;
        const sc = 0.25 + r() * 0.45;
        rocks.push([x, td.creek.level - 0.1, z, sc, sc * 0.6, sc, r()]);
      }
    }
  }
  const garden = [];
  for (let s = 0; s < track.length; s += 0.7) {
    const sf = track.surfaceAt(s);
    if (sf !== 'rock' && !(sf === 'creek' && r() < 0.25)) continue;
    for (let k = 0; k < 2; k++) {
      if (r() < 0.35) continue;
      const lat = (r() * 2 - 1) * (half - 0.15);
      const f = track.frame(s + r() * 0.6, lat, {});
      const y = surfaceY(s, lat);
      const sc = 0.14 + r() * 0.24;
      garden.push([f.x, y - sc * 0.45, f.z, sc * 1.2, sc * 0.7, sc, r()]);
    }
  }
  const allRocks = rocks.concat(garden);
  const rockMesh = new THREE.InstancedMesh(rockGeometry(quality === 'high' ? 2 : 1), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), allRocks.length);
  allRocks.forEach(([x, y, z, sx, sy, sz, k], i) => {
    m4.compose(v3.set(x, y, z), q.setFromEuler(e.set(k * 0.5, k * 9, k * 0.3)), s3.set(sx, sy, sz));
    rockMesh.setMatrixAt(i, m4);
  });
  rockMesh.castShadow = quality === 'high';
  rockMesh.receiveShadow = true;
  group.add(rockMesh);

  // Troncs couchés (dont de grands arbres tombés le long du sentier, à contourner) et souches
  const logs = [];
  for (let tries = 0; tries < 3000 && logs.length < Math.round(70 * density) + 8; tries++) {
    const s = r() * track.length;
    const big = logs.length < 8;
    const side = r() < 0.5 ? -1 : 1;
    const lat = side * (half + (big ? 1.6 + r() * 1.2 : 1.8 + r() * 10));
    const f = track.frame(s, lat, {});
    const len = big ? 9 + r() * 6 : 1.5 + r() * 3.5;
    const yaw = Math.atan2(f.tx, f.tz) + Math.PI / 2 + (big ? (r() - 0.5) * 0.5 : r() * 6.28);
    // Le tronc entier doit rester hors du sentier
    const ex = Math.cos(yaw) * len * 0.5;
    const ez = -Math.sin(yaw) * len * 0.5;
    let ok = true;
    for (const t of [-1, -0.5, 0, 0.5, 1]) if (!free(f.x + ex * t, f.z + ez * t, half + 1.1)) ok = false;
    if (!ok) continue;
    const rad = big ? 0.42 + r() * 0.15 : 0.16 + r() * 0.14;
    logs.push([f.x, heightAt(f.x, f.z) + rad * 0.75, f.z, len, rad, yaw]);
    reserved.push([f.x, f.z, len * 0.4]);
  }
  const logMesh = new THREE.InstancedMesh(logGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), logs.length);
  logs.forEach(([x, y, z, len, rad, yaw], i) => {
    m4.compose(v3.set(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), s3.set(len, rad * 2, rad * 2));
    logMesh.setMatrixAt(i, m4);
  });
  logMesh.castShadow = quality !== 'low';
  logMesh.receiveShadow = true;
  group.add(logMesh);
  const stumps = [];
  for (let tries = 0; tries < 3000 && stumps.length < Math.round(60 * density); tries++) {
    const s = r() * track.length;
    const side = r() < 0.5 ? -1 : 1;
    const f = track.frame(s, side * (half + 1.5 + r() * 9), {});
    const g = free(f.x, f.z, half + 1.2);
    if (!g) continue;
    stumps.push([f.x, g.h - 0.05, f.z, 0.7 + r() * 0.8, r()]);
  }
  const stumpMesh = new THREE.InstancedMesh(stumpGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), stumps.length);
  stumps.forEach(([x, y, z, sc, k], i) => {
    m4.compose(v3.set(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, k * 6.28), s3.set(sc, sc * (0.7 + k * 0.6), sc));
    stumpMesh.setMatrixAt(i, m4);
  });
  stumpMesh.castShadow = quality === 'high';
  stumpMesh.receiveShadow = true;
  group.add(stumpMesh);

  // Champignons (amanites) par petits groupes au pied des souches et le long du sentier
  const shrooms = [];
  for (let tries = 0; tries < 4000 && shrooms.length < Math.round(220 * density); tries++) {
    const s = r() * track.length;
    const side = r() < 0.5 ? -1 : 1;
    const f = track.frame(s, side * (half + 0.8 + r() * 5), {});
    const g = free(f.x, f.z, half + 0.7);
    if (!g) continue;
    const n2 = 1 + Math.floor(r() * 4);
    for (let k = 0; k < n2; k++) {
      const x = f.x + (r() - 0.5) * 0.6;
      const z = f.z + (r() - 0.5) * 0.6;
      shrooms.push([x, g.h - 0.01, z, 0.6 + r() * 0.9, r()]);
    }
  }
  const shroomMesh = new THREE.InstancedMesh(mushroomGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), shrooms.length);
  shrooms.forEach(([x, y, z, sc, k], i) => {
    m4.compose(v3.set(x, y, z), q.setFromEuler(e.set((k - 0.5) * 0.3, k * 6, (k - 0.5) * 0.2)), s3.setScalar(sc));
    shroomMesh.setMatrixAt(i, m4);
  });
  group.add(shroomMesh);

  // Racines en relief sur les tronçons de racines
  const roots = [];
  for (let s = 0; s < track.length; s += 0.9) {
    if (track.surfaceAt(s) !== 'roots' || r() < 0.3) continue;
    const lat = (r() - 0.5) * half;
    const f = track.frame(s, lat, {});
    roots.push([f.x, surfaceY(s, lat) - 0.015, f.z, Math.atan2(f.tx, f.tz) + (r() - 0.5) * 0.9, 0.8 + r() * 0.6]);
  }
  const rootMesh = new THREE.InstancedMesh(rootGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), roots.length);
  roots.forEach(([x, y, z, yaw, sc], i) => {
    m4.compose(v3.set(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), s3.set(sc * (half / 1.1), 1, 1));
    rootMesh.setMatrixAt(i, m4);
  });
  rootMesh.receiveShadow = true;
  group.add(rootMesh);

  // ----- Spectateurs aux sauts (bloc séparé : les personnages sont améliorés ailleurs, rester minimal) -----
  const fans = [];
  for (const j of td.jumps) {
    for (let k = 0; k < Math.round(8 * Math.max(0.5, density)); k++) {
      const side = k % 2 ? 1 : -1;
      const s = j.s - 2 + r() * 9;
      const f = track.frame(s, side * (half + 2.3 + r() * 1.8), {});
      fans.push([f.x, heightAt(f.x, f.z), f.z, Math.atan2(-side * f.rx, -side * f.rz) + (r() - 0.5) * 0.6, r()]);
    }
  }
  if (fans.length) {
    const fanMesh = new THREE.InstancedMesh(fanGeometry(false), fanMaterial(shared), fans.length);
    const jerseys = ['#e63946', '#2a9d8f', '#f4a261', '#3a86ff', '#ffbe0b', '#8338ec', '#fb5607', '#06d6a0'].map(C);
    fans.forEach(([x, y, z, yaw, k], i) => {
      m4.compose(v3.set(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), s3.setScalar(0.95 + k * 0.12));
      fanMesh.setMatrixAt(i, m4);
      fanMesh.setColorAt(i, jerseys[Math.floor(k * jerseys.length)]);
    });
    fanMesh.castShadow = quality === 'high';
    group.add(fanMesh);
  }
  // ----- fin des spectateurs -----

  // Collines boisées à l'horizon
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
  group.add(mountainRingAround({ cx, cz, r0: span + 240, r1: span + 1600, baseY: track.minY - 25, h: [60, 120], snow: 5, seg: quality === 'low' ? 120 : 200 }));

  // Puits de lumière et pollens
  let shafts = null;
  if (quality !== 'low') {
    const items = [];
    for (let s = 20; s < track.length; s += quality === 'high' ? 55 : 90) {
      const side = r() < 0.5 ? -1 : 1;
      const f = track.frame(s, side * (half + r() * 7), {});
      items.push([f.x, heightAt(f.x, f.z), f.z, 2 + r() * 3]);
    }
    shafts = lightShafts(items, shared);
    group.add(shafts);
  }
  const motes = quality === 'high' ? makeMotes(shared, 260) : null;
  if (motes) group.add(motes);

  // Gouttes et poussière
  const fx = makeFx(quality === 'low' ? 120 : 240);
  group.add(fx.points);

  let time = 0;
  const skyU = sky.userData.uniforms;
  const update = (dt, camera) => {
    time += dt;
    shared.uTime.value = time;
    skyU.uTime.value = time;
    sky.position.copy(camera.position);
    forest.update(camera.position.x, camera.position.z, camera.position.y);
    fx.update(dt);
  };

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

  return { group, sky, heightAt, update, dispose, wet: shared.uWet, fx, trail: td, center: new THREE.Vector3(cx, (track.minY + track.maxY) / 2, cz) };
}

// ---------------------------------------------------------------------------------------------
// Version simple (?gfx=simple) : couleurs unies, peu d'objets, même sentier, mêmes sauts, même ruisseau.
// ---------------------------------------------------------------------------------------------
const SIMPLE_SURF = { dirt: ['#7a5b3d', '#73563a'], roots: ['#5e4430', '#664a33'], rock: ['#8a8378', '#7d766b'], gravel: ['#a39782', '#9a8f7a'], mud: ['#4a3524', '#44301f'], creek: ['#4f8fa8', '#4a88a0'], boardwalk: ['#a57a4c', '#93683f'] };

function buildForestSimple(scene, track) {
  const td = trailData(track);
  const half = td.half;
  const group = new THREE.Group();
  scene.add(group);
  const vc = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
  const b = track.bounds;
  const margin = 200;
  const ground = makeGround(track, td, margin + 20);
  const heightAt = (x, z) => ground(x, z).h;
  const r = rng(5);
  // Brume plus proche dans la forêt
  const prevFog = scene.fog ? { near: scene.fog.near, far: scene.fog.far, color: scene.fog.color.clone() } : null;
  if (scene.fog) {
    scene.fog.near = 60;
    scene.fog.far = 520;
  }
  // Terrain
  const cell = 6;
  const w = b.maxX - b.minX + margin * 2;
  const d = b.maxZ - b.minZ + margin * 2;
  const tg = new THREE.PlaneGeometry(w, d, Math.ceil(w / cell), Math.ceil(d / cell));
  tg.rotateX(-Math.PI / 2);
  tg.translate((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  const tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, heightAt(tp.getX(i), tp.getZ(i)));
  const flat = tg.toNonIndexed();
  tg.dispose();
  const fp = flat.attributes.position;
  const colors = new Float32Array(fp.count * 3);
  const pal = ['#3f5d27', '#4a6a2c', '#56602e', '#5f5432'].map(C);
  for (let i = 0; i < fp.count; i += 3) {
    const cc = pal[Math.floor(r() * pal.length)];
    for (let v = 0; v < 3; v++) colors.set([cc.r, cc.g, cc.b], (i + v) * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  flat.computeVertexNormals();
  group.add(new THREE.Mesh(flat, vc()));
  // Sentier coloré par revêtement
  const pos = [];
  const col = [];
  const cc = new THREE.Color();
  const n = track.count;
  for (let i = 0, seg = 0; i < n; i += 2, seg++) {
    const j = Math.min(n, i + 2);
    const P = (k, lat) => {
      const kk = k % n;
      return [track.x[kk] - track.tz[kk] * lat, track.y[kk] + td.yOff(kk, lat) + 0.04, track.z[kk] + track.tx[kk] * lat];
    };
    const p0 = P(i, -half), p1 = P(i, half), p2 = P(j, -half), p3 = P(j, half);
    pos.push(...p0, ...p1, ...p2, ...p1, ...p3, ...p2);
    cc.set((SIMPLE_SURF[track.surf[i]] || SIMPLE_SURF.dirt)[seg % 2]);
    for (let v = 0; v < 6; v++) col.push(cc.r, cc.g, cc.b);
  }
  const tgeo = new THREE.BufferGeometry();
  tgeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tgeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  tgeo.computeVertexNormals();
  group.add(new THREE.Mesh(tgeo, vc()));
  // Sauts, passerelle, rubalise, arche
  const tmpF = {};
  const surfaceY = (s, lat) => track.frame(s, 0, tmpF).y + td.bankAt(s, lat) + 0.04;
  const B = new Builder();
  addKickers(B, track, td, surfaceY);
  addBridge(B, track, td, surfaceY, heightAt);
  addTape(B, track, td, heightAt);
  const arch = addArch(B, track, td, heightAt);
  group.add(new THREE.Mesh(B.geometry(), vc({ side: THREE.DoubleSide })));
  const banner = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 2.2, 0.95, 0.2), new THREE.MeshLambertMaterial({ map: bannerTexture() }));
  banner.position.set(arch.x, arch.y + 3.55, arch.z);
  banner.rotation.y = arch.yaw;
  group.add(banner);
  // Ruisseau : ruban d'eau uni
  if (td.creek) {
    const cr = td.creek;
    const wp = [];
    const pts = cr.samples;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1];
      const p = pts[k];
      const tx = p.x - a.x;
      const tz = p.z - a.z;
      const l = Math.hypot(tx, tz) || 1;
      const A = [a.x - (tz / l) * (a.w + 0.4), cr.level, a.z + (tx / l) * (a.w + 0.4)];
      const Bq = [a.x + (tz / l) * (a.w + 0.4), cr.level, a.z - (tx / l) * (a.w + 0.4)];
      const Cq = [p.x - (tz / l) * (p.w + 0.4), cr.level, p.z + (tx / l) * (p.w + 0.4)];
      const D = [p.x + (tz / l) * (p.w + 0.4), cr.level, p.z - (tx / l) * (p.w + 0.4)];
      wp.push(...A, ...Cq, ...Bq, ...Bq, ...Cq, ...D);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    wg.computeVertexNormals();
    group.add(new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: '#4d93b8', transparent: true, opacity: 0.85, side: THREE.DoubleSide })));
  }
  // Arbres (instanciés : tronc + houppier conique)
  const trees = [];
  const start = track.frame(0, 0, {});
  for (let tries = 0; tries < 9000 && trees.length < 1400; tries++) {
    const x = b.minX - 150 + r() * (b.maxX - b.minX + 300);
    const z = b.minZ - 150 + r() * (b.maxZ - b.minZ + 300);
    const g = ground(x, z);
    if (g.near.dist < half + 2.5 || Math.hypot(x - start.x, z - start.z) < 14) continue;
    if (td.creek) {
      const c = td.creek.near(x, z);
      if (c && c.d < c.w + 1) continue;
    }
    trees.push([x, g.h, z, 0.9 + r() * 0.8, r()]);
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s3 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 2.4, 5).translate(0, 1.2, 0), new THREE.MeshLambertMaterial({ color: '#6a4a30', flatShading: true }), trees.length);
  const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 5.5, 6).translate(0, 4.6, 0), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), trees.length);
  const leaf = ['#24572e', '#2f6a35', '#3b7a3a', '#2a4f2a', '#4e7f37'].map(C);
  trees.forEach(([x, y, z, sc, k], i) => {
    m4.compose(v3.set(x, y - 0.2, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, k * 6), s3.setScalar(sc));
    trunk.setMatrixAt(i, m4);
    crown.setMatrixAt(i, m4);
    crown.setColorAt(i, leaf[i % leaf.length]);
  });
  group.add(trunk, crown);
  // Rochers du pierrier et du sous-bois
  const rocks = [];
  for (let s = 0; s < track.length; s += 1.2) {
    if (track.surfaceAt(s) !== 'rock') continue;
    const lat = (r() * 2 - 1) * (half - 0.2);
    const f = track.frame(s, lat, {});
    rocks.push([f.x, surfaceY(s, lat) - 0.05, f.z, 0.22 + r() * 0.15]);
  }
  for (let k = 0; k < 120; k++) {
    const s = r() * track.length;
    const f = track.frame(s, (r() < 0.5 ? -1 : 1) * (half + 2 + r() * 8), {});
    rocks.push([f.x, heightAt(f.x, f.z), f.z, 0.4 + r() * 0.9]);
  }
  const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#8d8f94', flatShading: true }), rocks.length);
  rocks.forEach(([x, y, z, sc], i) => {
    m4.compose(v3.set(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, sc * 17), s3.set(sc, sc * 0.6, sc));
    rockMesh.setMatrixAt(i, m4);
  });
  group.add(rockMesh);
  // Ciel en dégradé
  const skyGeo = new THREE.SphereGeometry(1800, 24, 12);
  const sp = skyGeo.attributes.position;
  const skyCol = new Float32Array(sp.count * 3);
  const top = C('#3f86d8');
  const hor = C('#cfe6fb');
  const tmp = new THREE.Color();
  for (let i = 0; i < sp.count; i++) {
    tmp.copy(hor).lerp(top, Math.pow(Math.max(0, sp.getY(i) / 1800), 0.6));
    skyCol.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(skyCol, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  scene.add(sky);
  const fx = makeFx(90);
  group.add(fx.points);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  return {
    group, sky, heightAt, fx, trail: td,
    center: new THREE.Vector3(cx, (track.minY + track.maxY) / 2, cz),
    update(dt, cam) {
      sky.position.copy(cam.position);
      fx.update(dt);
    },
    dispose() {
      for (const root of [group, sky]) {
        scene.remove(root);
        disposeTree(root);
      }
      if (prevFog && scene.fog) {
        scene.fog.near = prevFog.near;
        scene.fog.far = prevFog.far;
      }
    },
  };
}
