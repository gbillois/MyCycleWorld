// Foules et figurants (graphismes détaillés) : un système partagé par tous les décors (montées et départ du vélo,
// village, ferme, plage, tribune de l'aviron, arrivée du kayak).
// - Personnages « low poly » instanciés : plusieurs morphologies (corpulence, taille, enfants, personnes âgées),
//   tenues, coiffures, chapeaux, drapeaux et pancartes peintes (« ALLEZ ! »), animés entièrement dans le vertex
//   shader (acclamations, applaudissements, sauts, drapeaux, nage, beach-volley, promeneurs, terrasse de café) ;
//   ils regardent le joueur et s'animent davantage à son passage (moins de ~25 m).
// - Deux appels de dessin par décor : les plus proches de la caméra en version détaillée, les autres en version
//   simplifiée, au-delà rien. La sélection (proches / lointains) est refaite quatre fois par seconde sur le
//   processeur, sans allocation ; l'animation ne coûte rien au processeur.
// - Quelques figurants « héros » plus détaillés : le diable qui court à côté des coureurs dans les montées,
//   l'entraîneur à vélo le long du lac d'aviron, la balle du beach-volley.
// updateCrowds(dt, camera) est appelé une fois par image par main.js (tous modes) ; chaque foule se désinscrit
// d'elle-même quand son décor est retiré de la scène.
import * as THREE from 'three';
import { ROAD_HALF, rng } from './track.js';
import { keep, B, BODY, bindPositions, bodyGeometry, bodyMaterial, makeBody, ik2, orient, poseHeadGear, PBR, sweep, SKINS, ATLAS } from './figure.js';
import { DetailedRider } from './rider.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = (hex) => new THREE.Color(hex);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// --- Actions (identifiants lus par le shader) ---
export const ACT = { idle: 0, cheer: 1, clap: 2, wave: 3, flag: 4, sign: 5, jump: 6, sit: 7, lie: 8, swim: 9, volley: 10, walk: 11, drink: 12, talk: 13, photo: 14, waveL: 15 };
// Options de géométrie (bits) et vêtements (bits 16+)
export const OPT = { hairLong: 1, cap: 2, sunHat: 3, flag: 4, sign: 5, fork: 6, cup: 7, phone: 8, skirt: 9, beret: 10, backpack: 11 };
const WEAR = { shorts: 16, bare: 17, longSleeves: 18, bareArms: 19 };
const bit = (b) => 2 ** b;

// Parties animées (aInfo.x) et emplacements de couleur (aInfo.y)
const P = { body: 0, head: 1, armL: 2, armR: 3, thighL: 4, shinL: 5, thighR: 6, shinR: 7, sign: 9 };
const S = { shirtLow: 1, skin: 2, hair: 3, shoe: 4, hat: 5, sign: 6, flag: 7, pole: 8, dark: 9, prop: 10, shin: 11, fore: 12, sleeve: 13, shirt: 14 };

// --- Atlas partagé (512 x 512) : blanc, visages, motifs de t-shirt, filet, pancartes, drapeaux ---
const AT = 512;
const uvOf = (x, y) => [x / AT, 1 - y / AT];
const CELL = {
  face: [64, 0, 64, 64],
  pattern: [0, 64, 96, 96],
  net: [384, 64, 128, 96],
  sign: [0, 160, 256, 64],
  flag: [0, 352, 128, 80],
};
const SIGNS = ['ALLEZ !', 'VAS-Y !', 'ALLEZ ALLEZ', 'BRAVO !', '♥ MCW', 'GO GO GO'];
let atlasTex = null;
function crowdAtlas() {
  if (atlasTex) return atlasTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = AT;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, AT, AT);
  // Visages (multipliés par la teinte de peau) : yeux, sourcils, bouche ; lunettes de soleil ; moustache
  for (let i = 0; i < 4; i++) {
    const x = 64 + i * 64;
    const cx = x + 32;
    ctx.fillStyle = 'rgba(120,60,50,0.18)';
    ctx.beginPath();
    ctx.arc(cx - 12, 38, 6, 0, Math.PI * 2);
    ctx.arc(cx + 12, 38, 6, 0, Math.PI * 2);
    ctx.fill();
    if (i === 2) {
      ctx.fillStyle = '#15161a';
      ctx.fillRect(cx - 20, 22, 40, 9);
      ctx.fillRect(cx - 18, 24, 15, 10);
      ctx.fillRect(cx + 3, 24, 15, 10);
    } else {
      ctx.fillStyle = '#ffffff';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + s * 9, 28, 4.5, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#23180f';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + s * 9, 28, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(cx + s * 9 - 6, 21, 12, 2.5);
      }
    }
    ctx.fillStyle = 'rgba(70,30,25,0.8)';
    ctx.fillRect(cx - 4, 34, 8, 2);
    ctx.fillStyle = 'rgba(120,40,40,0.75)';
    ctx.beginPath();
    ctx.ellipse(cx, 45, i === 1 ? 6 : 7, i === 1 ? 4 : 2, 0, 0, Math.PI * 2);
    ctx.fill();
    if (i === 1) {
      ctx.fillStyle = 'rgba(30,10,10,0.9)';
      ctx.beginPath();
      ctx.ellipse(cx, 45, 4, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (i === 3) {
      ctx.fillStyle = '#2a1d14';
      ctx.fillRect(cx - 9, 39, 18, 4);
    }
  }
  // Motifs (multipliés par la couleur du haut) : uni, marinière, pois rouges, imprimé
  const [px, py, pw, ph] = CELL.pattern;
  ctx.fillStyle = '#1d2b5a';
  for (let k = 0; k < 9; k++) ctx.fillRect(px + pw, py + 8 + k * 10, pw, 5);
  ctx.fillStyle = '#d8202a';
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
    ctx.beginPath();
    ctx.arc(px + 2 * pw + 5 + i * 10.5 + (j % 2) * 5, py + 5 + j * 10.5, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#22252c';
  ctx.beginPath();
  ctx.arc(px + 3 * pw + pw * 0.25, py + ph * 0.45, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MCW', px + 3 * pw + pw * 0.25, py + ph * 0.45);
  // Filet de beach-volley (alpha)
  {
    const [nx, ny, nw, nh] = CELL.net;
    ctx.clearRect(nx, ny, nw, nh);
    ctx.strokeStyle = '#f2f2f2';
    ctx.lineWidth = 1.6;
    for (let k = 0; k <= nw; k += 8) {
      ctx.beginPath();
      ctx.moveTo(nx + k, ny);
      ctx.lineTo(nx + k, ny + nh);
      ctx.stroke();
    }
    for (let k = 0; k <= nh; k += 8) {
      ctx.beginPath();
      ctx.moveTo(nx, ny + k);
      ctx.lineTo(nx + nw, ny + k);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(nx, ny, nw, 10);
  }
  // Pancartes : carton, texte peint à la main
  SIGNS.forEach((txt, i) => {
    const c = i % 2;
    const r = Math.floor(i / 2);
    const x = c * 256;
    const y = 160 + r * 64;
    ctx.fillStyle = ['#fffdf5', '#ffe14d', '#fffdf5', '#ffffff', '#fffdf5', '#9be7ff'][i];
    ctx.fillRect(x + 2, y + 2, 252, 60);
    ctx.strokeStyle = '#d0c8b0';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 3, y + 3, 250, 58);
    ctx.fillStyle = ['#d8202a', '#1d2b5a', '#1b7a3a', '#d8202a', '#d8202a', '#14151a'][i];
    ctx.font = `italic 900 ${txt.length > 8 ? 36 : 44}px system-ui, sans-serif`;
    ctx.fillText(txt, x + 128, y + 34);
  });
  // Drapeaux : tricolore, maillot à pois, damier, bandes bretonnes, jaune MCW, bleu-blanc, vert, orange
  for (let i = 0; i < 8; i++) {
    const c = i % 4;
    const r = Math.floor(i / 4);
    const x = c * 128;
    const y = 352 + r * 80;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, 128, 80);
    ctx.clip();
    if (i === 0) {
      ['#1f3fa0', '#ffffff', '#d8202a'].forEach((col, k) => {
        ctx.fillStyle = col;
        ctx.fillRect(x + (k * 128) / 3, y, 128 / 3 + 1, 80);
      });
    } else if (i === 1) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, 128, 80);
      ctx.fillStyle = '#d8202a';
      for (let a = 0; a < 8; a++) for (let b = 0; b < 5; b++) {
        ctx.beginPath();
        ctx.arc(x + 8 + a * 16 + (b % 2) * 8, y + 8 + b * 16, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (i === 2) {
      for (let a = 0; a < 8; a++) for (let b = 0; b < 5; b++) {
        ctx.fillStyle = (a + b) % 2 ? '#111216' : '#ffffff';
        ctx.fillRect(x + a * 16, y + b * 16, 16, 16);
      }
    } else if (i === 3) {
      for (let k = 0; k < 9; k++) {
        ctx.fillStyle = k % 2 ? '#ffffff' : '#111216';
        ctx.fillRect(x, y + (k * 80) / 9, 128, 80 / 9 + 1);
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, 50, 44);
      ctx.fillStyle = '#111216';
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) ctx.fillRect(x + 8 + a * 15, y + 6 + b * 13, 4, 7);
    } else if (i === 4) {
      ctx.fillStyle = '#ffd21f';
      ctx.fillRect(x, y, 128, 80);
      ctx.fillStyle = '#14151a';
      ctx.font = 'italic 900 34px system-ui, sans-serif';
      ctx.fillText('MCW', x + 64, y + 42);
    } else {
      const cols = [['#1f6fd1', '#ffffff'], ['#1b7a3a', '#ffffff'], ['#ff6a00', '#ffffff']][i - 5];
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = cols[k % 2];
        ctx.fillRect(x, y + k * 16, 128, 16);
      }
    }
    ctx.restore();
  }
  atlasTex = keep(new THREE.CanvasTexture(cv));
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.anisotropy = 4;
  return atlasTex;
}

// --- Géométrie d'un personnage (debout, face à +Z, pieds à l'origine, 1,72 m) ---
// Chaque pièce porte aInfo = (partie, emplacement de couleur, option). Les uv par défaut pointent un texel blanc.
class Body {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.info = [];
    this.idx = [];
  }
  add(geo, part, slot, opt = 0, uvFn = null) {
    const g = geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const base = this.pos.length / 3;
    const Pp = g.attributes.position;
    const N = g.attributes.normal;
    const U = g.attributes.uv;
    const white = uvOf(8, 8);
    for (let i = 0; i < Pp.count; i++) {
      const x = Pp.getX(i);
      const y = Pp.getY(i);
      const z = Pp.getZ(i);
      this.pos.push(x, y, z);
      this.nor.push(N.getX(i), N.getY(i), N.getZ(i));
      const uv = uvFn ? uvFn(x, y, z, U ? U.getX(i) : 0, U ? U.getY(i) : 0) : white;
      this.uv.push(uv[0], uv[1]);
      this.info.push(part, slot, opt);
    }
    if (g.index) for (const k of g.index.array) this.idx.push(k + base);
    else for (let k = 0; k < Pp.count; k++) this.idx.push(k + base);
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 3));
    g.setIndex(this.idx);
    g.boundingSphere = new THREE.Sphere(V(0, 1, 0), 2.5);
    return g;
  }
}
const cylY = (r0, r1, y0, y1, seg, x = 0, z = 0, open = false) => new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, open).translate(x, (y0 + y1) / 2, z);
const boxAt = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const sph = (w, h, sx, sy, sz, x, y, z, phiLen = Math.PI) => new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, 0, phiLen).scale(sx, sy, sz).translate(x, y, z);
const cellUV = (cell, fu, fv) => uvOf(cell[0] + fu * cell[2], cell[1] + fv * cell[3]);

// Géométrie d'un figurant : ~750 triangles (high), ~500 (medium), ~110 (lointain). Toutes les options
// (coiffures, chapeaux, drapeau, pancarte…) sont présentes ; le shader écrase celles qu'une instance n'a pas.
const geoCache = new Map();
function personGeometry(level) {
  if (geoCache.has(level)) return geoCache.get(level);
  const b = new Body();
  const hi = level === 'high';
  const far = level === 'far';
  const seg = hi ? 6 : 5;
  if (far) {
    // Version lointaine : boîtes et octaèdres
    for (const s of [-1, 1]) {
      b.add(boxAt(0.12, 0.44, 0.13, s * 0.09, 0.72, 0), s > 0 ? P.thighL : P.thighR, S.shirtLow);
      b.add(boxAt(0.11, 0.5, 0.14, s * 0.09, 0.25, 0.02), s > 0 ? P.shinL : P.shinR, S.shin);
      b.add(boxAt(0.09, 0.6, 0.1, s * 0.21, 1.12, 0), s > 0 ? P.armL : P.armR, S.sleeve);
    }
    b.add(boxAt(0.36, 0.56, 0.22, 0, 1.2, 0), P.body, S.shirt, 0, () => cellUV(CELL.pattern, 0.5, 0.5));
    b.add(new THREE.OctahedronGeometry(0.12, 0).scale(0.9, 1.1, 1).translate(0, 1.6, 0), P.head, S.skin);
    b.add(new THREE.OctahedronGeometry(0.115, 0).scale(0.95, 0.6, 1).translate(0, 1.67, -0.02), P.head, S.hair);
    b.add(cylY(0.015, 0.015, -0.45, 0.88, 3, -0.205, 0.02, true), P.armR, S.pole, OPT.flag);
    b.add(new THREE.PlaneGeometry(0.62, 0.4).translate(-0.205 + 0.31, -0.24, 0.02), P.armR, S.flag, OPT.flag, (x, y) => cellUV(CELL.flag, Math.min(0.99, Math.max(0.01, (x + 0.205) / 0.62)), Math.min(0.99, Math.max(0.01, (y + 0.44) / 0.4))));
    b.add(new THREE.PlaneGeometry(0.62, 0.4).rotateY(Math.PI).translate(-0.205 + 0.31, -0.24, 0.01), P.armR, S.flag, OPT.flag, (x, y) => cellUV(CELL.flag, Math.min(0.99, Math.max(0.01, (x + 0.205) / 0.62)), Math.min(0.99, Math.max(0.01, (y + 0.44) / 0.4))));
    b.add(boxAt(0.72, 0.4, 0.03, 0, 2.2, 0.155), P.sign, S.sign, OPT.sign, (x, y, z) => (z > 0.16 ? cellUV(CELL.sign, Math.min(0.99, Math.max(0.01, (x + 0.36) / 0.72)), Math.min(0.99, Math.max(0.01, (2.4 - y) / 0.4))) : uvOf(8, 8)));
  } else {
    // Jambes : cuisse, tibia (pantalon ou peau), chaussure
    for (const s of [-1, 1]) {
      const x = s * 0.09;
      b.add(cylY(0.058, 0.074, 0.5, 0.94, seg, x, 0, true), s > 0 ? P.thighL : P.thighR, S.shirtLow);
      b.add(cylY(0.043, 0.056, 0.07, 0.52, seg, x, 0.005, true), s > 0 ? P.shinL : P.shinR, S.shin);
      b.add(sph(6, 3, 0.055, 0.045, 0.125, x, 0.045, 0.035), s > 0 ? P.shinL : P.shinR, S.shoe);
    }
    // Bassin, buste (motif du t-shirt), cou
    const lathe = (prof, y0, slot, part, uvFn) => {
      const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
      b.add(new THREE.LatheGeometry(pts, hi ? 9 : 7).translate(0, y0, 0), part, slot, 0, uvFn);
    };
    lathe([[0.0, 0.0], [0.13, 0.0], [0.165, 0.06], [0.16, 0.12]], 0.86, S.shirtLow, P.body);
    const torsoUV = (x, y, z) => {
      const a = Math.atan2(x, z) / (Math.PI * 2) + 0.5;
      return cellUV(CELL.pattern, 0.02 + 0.96 * a, Math.min(0.98, Math.max(0.02, (1.46 - y) / 0.48)));
    };
    lathe([[0.16, 0.0], [0.15, 0.1], [0.168, 0.26], [0.172, 0.37], [0.14, 0.45], [0.0, 0.48]], 0.98, S.shirt, P.body, torsoUV);
    b.add(cylY(0.045, 0.05, 1.42, 1.53, 5, 0, 0, true), P.body, S.skin);
    // Jupe et sac à dos (options)
    b.add(cylY(0.23, 0.15, 0.5, 0.98, 7, 0, 0, true), P.body, S.shirtLow, OPT.skirt);
    b.add(boxAt(0.26, 0.36, 0.12, 0, 1.2, -0.2), P.body, S.hat, OPT.backpack);
    // Tête : visage peint sur l'avant, nez, oreilles, cheveux
    const faceUV = (x, y, z) => (z > 0 ? cellUV(CELL.face, 0.5 + x / 0.26, 0.5 - (y - 1.625) / 0.26) : cellUV(CELL.face, 0.04, 0.04));
    b.add(sph(hi ? 9 : 7, hi ? 7 : 5, 0.095, 0.111, 0.103, 0, 1.625, 0.005), P.head, S.skin, 0, faceUV);
    b.add(new THREE.ConeGeometry(0.018, 0.04, 3).rotateX(Math.PI / 2).translate(0, 1.615, 0.11), P.head, S.skin);
    for (const s of [-1, 1]) b.add(boxAt(0.014, 0.04, 0.026, s * 0.095, 1.62, 0), P.head, S.skin);
    b.add(sph(hi ? 9 : 7, 3, 0.103, 0.112, 0.114, 0, 1.645, -0.012, 1.55).rotateX(-0.25), P.head, S.hair);
    b.add(boxAt(0.21, 0.3, 0.07, 0, 1.52, -0.07), P.head, S.hair, OPT.hairLong);
    // Chapeaux : casquette, chapeau de paille, béret
    b.add(sph(7, 2, 0.116, 0.116, 0.116, 0, 1.66, -0.005, 1.45), P.head, S.hat, OPT.cap);
    b.add(boxAt(0.18, 0.012, 0.11, 0, 1.69, 0.13).rotateX(-0.12), P.head, S.hat, OPT.cap);
    b.add(cylY(0.25, 0.25, 1.685, 1.7, 8), P.head, S.hat, OPT.sunHat);
    b.add(cylY(0.105, 0.115, 1.69, 1.79, 6), P.head, S.hat, OPT.sunHat);
    b.add(sph(7, 2, 0.13, 0.042, 0.13, 0.02, 1.73, -0.01), P.head, S.hat, OPT.beret);
    // Bras rigides depuis l'épaule : manche, avant-bras, main
    for (const s of [-1, 1]) {
      const x = s * 0.205;
      const part = s > 0 ? P.armL : P.armR;
      b.add(cylY(0.044, 0.054, 1.14, 1.44, seg, x, 0, true), part, S.sleeve);
      b.add(cylY(0.034, 0.043, 0.88, 1.15, seg, x, 0, true), part, S.fore);
      b.add(sph(5, 3, 0.035, 0.06, 0.042, x, 0.83, 0.005), part, S.skin);
    }
    // Drapeau (main droite) : hampe le long du bras, toile vers l'intérieur (visible de face une fois levé)
    b.add(cylY(0.012, 0.012, -0.45, 0.88, 4, -0.205, 0.02, true), P.armR, S.pole, OPT.flag);
    const cloth = new THREE.PlaneGeometry(0.62, 0.4, hi ? 4 : 2, 1).translate(-0.205 + 0.31, -0.24, 0.02);
    const flagUV = (x, y) => cellUV(CELL.flag, Math.min(0.99, Math.max(0.01, (x + 0.205) / 0.62)), Math.min(0.99, Math.max(0.01, (y + 0.44) / 0.4)));
    b.add(cloth.clone(), P.armR, S.flag, OPT.flag, flagUV);
    b.add(cloth.clone().rotateY(Math.PI).translate(2 * (-0.205 + 0.31), 0, 0.04), P.armR, S.flag, OPT.flag, flagUV);
    // Pancarte à deux mains, au-dessus de la tête (face peinte devant, carton derrière, deux bâtons)
    const signFront = (x, y, z) => (z > 0.16 ? cellUV(CELL.sign, Math.min(0.99, Math.max(0.01, (x + 0.36) / 0.72)), Math.min(0.99, Math.max(0.01, (2.4 - y) / 0.4))) : uvOf(8, 8));
    b.add(boxAt(0.72, 0.4, 0.015, 0, 2.2, 0.155), P.sign, S.sign, OPT.sign, signFront);
    for (const s of [-1, 1]) b.add(cylY(0.01, 0.01, 1.9, 2.15, 3, s * 0.2, 0.14, true), P.sign, S.pole, OPT.sign);
    // Fourche du fermier (main droite, verticale bras baissé) et ses dents
    b.add(cylY(0.016, 0.016, 0.15, 1.75, 4, -0.24, 0.06, true), P.armR, S.pole, OPT.fork);
    b.add(boxAt(0.11, 0.2, 0.012, -0.24, 1.85, 0.06), P.armR, S.dark, OPT.fork);
    // Tasse (terrasse) et téléphone (photo), dans la main droite
    b.add(cylY(0.028, 0.032, 0.79, 0.86, 5, -0.205, 0.05), P.armR, S.prop, OPT.cup);
    b.add(boxAt(0.07, 0.13, 0.012, -0.205, 0.8, 0.06), P.armR, S.dark, OPT.phone);
  }
  const g = keep(b.build());
  geoCache.set(level, g);
  return g;
}

// --- Shader : pose, couleur et uv par instance ---
const U = { uTime: { value: 0 }, uFocus: { value: new THREE.Vector3(0, -1e4, 0) } };
const COMMON = /* glsl */ `
attribute vec3 aInfo;
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
attribute vec4 iD;
uniform float uTime;
uniform vec3 uFocus;
mat3 cRotX( float a ) { float c = cos( a ), s = sin( a ); return mat3( 1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c ); }
mat3 cRotY( float a ) { float c = cos( a ), s = sin( a ); return mat3( c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c ); }
mat3 cRotZ( float a ) { float c = cos( a ), s = sin( a ); return mat3( c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0 ); }
// Pose d'un personnage : bras (abduction, flexion), jambes (hanche, genou), rebond, buste, tête.
void crowdPose( inout vec3 p, inout vec3 n ) {
  int mask = int( iC.w + 0.5 );
  int opt = int( aInfo.z + 0.5 );
  if ( opt > 0 && ( mask & ( 1 << opt ) ) == 0 ) { p = vec3( 0.0 ); return; }
  float part = aInfo.x;
  float act = iA.w;
  float seed = iB.w;
  float girth = iC.z;
  float energy = iD.w;
  vec3 ip = instanceMatrix[ 3 ].xyz;
  float t = uTime + seed * 61.0;
  float excite = smoothstep( 26.0, 6.0, distance( ip.xz, uFocus.xz ) ) * ( 0.35 + 0.65 * energy );
  float sway = sin( t * 0.8 ) * 0.05;
  vec4 arm = vec4( 0.07, sway, 0.07, -sway ); // abduction G, flexion G, abduction D, flexion D
  vec4 leg = vec4( 0.0 ); // hanche G, genou G, hanche D, genou D
  vec4 misc = vec4( 0.0, 0.0, 0.0, 0.25 ); // rebond, buste, tête (tangage), poids du regard
  float seatH = -1.0;
  bool canCheer = true;
  float hitW = 0.0;
  if ( act < 0.5 ) {
    if ( fract( seed * 5.3 ) > 0.6 ) arm = vec4( 0.55, 0.45, 0.55, 0.45 ); // mains sur les hanches
  } else if ( act < 1.5 ) {
    float pump = sin( t * 6.0 ) * 0.25;
    arm = vec4( 2.5 + pump, -0.3, 2.5 - pump, -0.3 );
    misc.x = abs( sin( t * 6.0 ) ) * 0.05;
  } else if ( act < 2.5 ) {
    float c = pow( abs( sin( t * 6.5 ) ), 3.0 );
    arm = vec4( -0.12 - 0.2 * c, -1.3, -0.12 - 0.2 * c, -1.3 );
  } else if ( act < 3.5 ) {
    arm.z = 2.45 + 0.35 * sin( t * 8.0 ); arm.w = -0.25;
  } else if ( act < 4.5 ) {
    arm.z = 2.2 + 0.45 * sin( t * 3.5 ); arm.w = -0.35;
  } else if ( act < 5.5 ) {
    arm = vec4( 0.12, -2.75, 0.12, -2.75 );
  } else if ( act < 6.5 ) {
    float j = max( 0.0, sin( t * 5.5 ) );
    misc.x = j * 0.3;
    arm = vec4( 2.6, -0.2, 2.6, -0.2 );
    leg = vec4( -0.35, 0.7, -0.35, 0.7 ) * ( 1.0 - j );
  } else if ( act < 7.5 ) {
    seatH = iD.z;
    if ( fract( seed * 3.7 ) > 0.5 ) arm = vec4( 0.15, -0.55, 0.15, -0.55 ); // mains sur les genoux
  } else if ( act < 8.5 ) {
    canCheer = false;
    misc.w = 0.0;
    arm = vec4( 0.25, 0.0, fract( seed * 7.0 ) > 0.5 ? 2.85 : 0.25, 0.0 );
    leg.x = fract( seed * 3.0 ) > 0.5 ? -0.75 : 0.0;
    leg.y = -leg.x * 1.7;
  } else if ( act < 9.5 ) {
    canCheer = false;
    misc.w = 0.0;
    float ph = t * 2.6;
    arm = vec4( 0.2, -ph, 0.2, -ph - 3.14159 );
    leg.x = 0.3 * sin( t * 9.0 ); leg.z = -leg.x;
  } else if ( act < 10.5 ) {
    // Beach-volley : 4 joueurs, frappes l'un après l'autre (même horloge que la balle)
    canCheer = false;
    float Th = 1.15;
    float ph = mod( uTime - iD.z * Th + 2.0 * Th, 4.0 * Th ) - 2.0 * Th;
    hitW = 1.0 - smoothstep( 0.15, 0.5, abs( ph ) );
    leg = vec4( -0.45, 0.85, -0.45, 0.85 ) * ( 1.0 - hitW * 0.8 );
    misc.y = 0.25;
    arm = vec4( -0.2, -0.75, -0.2, -0.75 );
    if ( mod( iD.z, 2.0 ) < 0.5 ) {
      // attaque : saut, bras droit qui frappe
      misc.x = hitW * 0.45;
      arm = mix( arm, vec4( 0.6, -0.6, 2.9 - 1.6 * smoothstep( -0.1, 0.25, ph ), -0.4 ), hitW );
    } else {
      // passe : bras tendus au-dessus de la tête
      arm = mix( arm, vec4( 0.25, -2.85, 0.25, -2.85 ), hitW );
      misc.x = hitW * 0.12;
    }
    misc.w = 0.0;
  } else if ( act < 11.5 ) {
    canCheer = false;
    float w = t * 5.2;
    leg = vec4( 0.42 * sin( w ), 0.6 * max( 0.0, sin( w + 1.7 ) ), -0.42 * sin( w ), 0.6 * max( 0.0, -sin( w + 1.7 ) ) );
    arm = vec4( 0.08, -0.35 * sin( w ), 0.08, 0.35 * sin( w ) );
    misc.x = abs( sin( w ) ) * 0.025;
    misc.w = 0.1;
  } else if ( act < 12.5 ) {
    seatH = iD.z;
    float d = smoothstep( 0.55, 0.95, sin( t * 0.9 ) );
    arm = vec4( 0.15, -0.55, -0.3 * d - 0.05, -0.75 - 1.45 * d );
    misc.z = -0.15 * d;
  } else if ( act < 13.5 ) {
    arm = vec4( 0.15, -0.3 + 0.2 * sin( t * 2.3 + 1.0 ), 0.2, -0.6 + 0.35 * sin( t * 3.0 ) );
    misc.z = 0.08 * sin( t * 4.0 );
  } else if ( act < 14.5 ) {
    arm = vec4( -0.3, -1.65, -0.3, -1.65 );
  } else {
    arm.x = 2.45 + 0.35 * sin( t * 8.0 ); arm.y = -0.25;
  }
  // Réaction au passage du joueur : bras levés, sauts, applaudissements au-dessus de la tête
  if ( canCheer && excite > 0.01 ) {
    float v = fract( seed * 13.7 );
    vec4 armE = arm;
    vec4 legE = leg;
    vec4 miscE = misc;
    if ( act > 3.5 && act < 4.5 ) {
      armE.z = 2.3 + 0.6 * sin( t * 8.0 ); miscE.x = abs( sin( t * 6.0 ) ) * 0.1;
    } else if ( act > 4.5 && act < 5.5 ) {
      armE.y = armE.w = -2.75 + 0.18 * sin( t * 7.0 ); miscE.x = abs( sin( t * 7.0 ) ) * 0.12;
    } else if ( v < 0.4 ) {
      float pump = sin( t * 9.0 ) * 0.3;
      armE = vec4( 2.45 + pump, -0.3, 2.45 - pump, -0.3 );
    } else if ( v < 0.7 && seatH < -0.5 ) {
      float j = max( 0.0, sin( t * 6.5 ) );
      armE = vec4( 2.6, -0.2, 2.6, -0.2 ); miscE.x = j * 0.28;
      legE = vec4( -0.35, 0.7, -0.35, 0.7 ) * ( 1.0 - j );
    } else {
      float c = pow( abs( sin( t * 7.5 ) ), 3.0 );
      armE = vec4( 2.95 - 0.3 * c, -0.15, 2.95 - 0.3 * c, -0.15 );
    }
    miscE.w = 1.0;
    arm = mix( arm, armE, excite );
    leg = mix( leg, legE, excite );
    misc = mix( misc, miscE, excite );
  }
  // Assis : cuisses à l'horizontale, tibias pendants
  if ( seatH > -0.5 ) leg = vec4( -1.45, 1.45, -1.45, 1.4 );
  // Corpulence (buste, bassin, membres), tête plus grosse chez les enfants
  float sc = length( instanceMatrix[ 0 ].xyz );
  float child = smoothstep( 0.86, 0.66, sc );
  float side = p.x >= 0.0 ? 1.0 : -1.0;
  if ( part < 0.5 ) { p.x *= girth; p.z *= mix( 1.0, girth, 0.8 ); }
  else if ( part > 1.5 && part < 3.5 ) p.x += ( part < 2.5 ? 1.0 : -1.0 ) * 0.2 * ( girth - 1.0 );
  else if ( part > 3.5 && part < 7.5 ) { float s2 = part < 5.5 ? 1.0 : -1.0; p.x = s2 * 0.09 * girth + ( p.x - s2 * 0.09 ) * mix( 1.0, girth, 0.6 ); p.z *= mix( 1.0, girth, 0.6 ); }
  vec3 piv;
  mat3 R = mat3( 1.0 );
  if ( part > 0.5 && part < 1.5 ) {
    // Tête : vers le joueur (bornée), plus grosse chez l'enfant
    vec3 lf = transpose( mat3( instanceMatrix ) ) * ( uFocus - ip );
    float yaw = clamp( atan( lf.x, lf.z ), -1.3, 1.3 ) * misc.w;
    piv = vec3( 0.0, 1.5, 0.0 );
    p = piv + ( p - piv ) * ( 1.0 + 0.32 * child );
    R = cRotY( yaw ) * cRotX( misc.z );
  } else if ( part > 1.5 && part < 2.5 ) {
    piv = vec3( 0.19 * girth, 1.42, 0.0 );
    R = cRotZ( arm.x ) * cRotX( arm.y );
  } else if ( part > 2.5 && part < 3.5 ) {
    piv = vec3( -0.19 * girth, 1.42, 0.0 );
    R = cRotZ( -arm.z ) * cRotX( arm.w );
    // Toile du drapeau qui claque
    if ( aInfo.y > 6.5 && aInfo.y < 7.5 ) p.z += sin( uTime * 9.0 + p.x * 9.0 + seed * 20.0 ) * 0.06 * ( p.x + 0.2 );
  } else if ( part > 3.5 && part < 7.5 ) {
    bool left = part < 5.5;
    float hip = left ? leg.x : leg.z;
    float knee = left ? leg.y : leg.w;
    vec3 hp = vec3( ( left ? 0.09 : -0.09 ) * girth, 0.93, 0.0 );
    if ( part > 4.5 && part < 5.5 || part > 6.5 ) {
      vec3 kp = vec3( hp.x, 0.51, 0.0 );
      p = kp + cRotX( knee ) * ( p - kp );
      n = cRotX( knee ) * n;
    }
    piv = hp;
    R = cRotX( hip );
  } else if ( part > 8.5 ) {
    // Pancarte : suit les mains, se soulève avec elles
    piv = vec3( 0.0, 1.42, 0.0 );
    p.y += misc.x * 0.6;
  } else {
    piv = vec3( 0.0 );
  }
  p = piv + R * ( p - piv );
  n = R * n;
  // Buste penché (haut du corps autour des hanches)
  if ( misc.y != 0.0 && ( part < 3.5 || part > 8.5 ) && p.y > 0.86 ) {
    vec3 hpv = vec3( 0.0, 0.93, 0.0 );
    p = hpv + cRotX( misc.y ) * ( p - hpv );
    n = cRotX( misc.y ) * n;
  }
  if ( seatH > -0.5 ) p.y -= 0.93 - ( seatH + 0.06 );
  p.y += misc.x;
  // Promeneurs : tournent en rond autour de leur point d'ancrage (rayon iD.z)
  if ( act > 10.5 && act < 11.5 ) {
    float rad = max( 0.5, iD.z );
    float th = uTime * 1.0 / rad * ( fract( seed * 9.1 ) > 0.5 ? 1.0 : -1.0 ) + seed * 6.2832;
    float dir = fract( seed * 9.1 ) > 0.5 ? 0.0 : 3.14159;
    mat3 Ry = cRotY( -th + dir );
    p = Ry * p + vec3( rad * cos( th ), 0.0, rad * sin( th ) );
    n = Ry * n;
  }
}
`;
const COLOR = /* glsl */ `
  // Couleur selon l'emplacement (tenue, peau, cheveux, chapeau…) et décalage d'uv (visage, motif, pancarte, drapeau)
  {
    int slot = int( aInfo.y + 0.5 );
    int wear = int( iC.w + 0.5 );
    vec3 skinC = mix( vec3( 0.86, 0.56, 0.4 ), vec3( 0.16, 0.08, 0.045 ), iC.x );
    int hi = int( iC.y + 0.5 );
    vec3 hairC = hi == 0 ? vec3( 0.012, 0.01, 0.01 ) : hi == 1 ? vec3( 0.04, 0.025, 0.015 ) : hi == 2 ? vec3( 0.12, 0.06, 0.028 ) : hi == 3 ? vec3( 0.55, 0.4, 0.17 ) : hi == 4 ? vec3( 0.36, 0.1, 0.03 ) : hi == 5 ? vec3( 0.35, 0.35, 0.34 ) : vec3( 0.78, 0.78, 0.75 );
    int ki = int( iD.x + 0.5 );
    vec3 hatC = ki == 0 ? vec3( 0.7, 0.04, 0.04 ) : ki == 1 ? vec3( 0.02, 0.03, 0.12 ) : ki == 2 ? vec3( 0.86, 0.86, 0.85 ) : ki == 3 ? vec3( 0.9, 0.62, 0.02 ) : ki == 4 ? vec3( 0.62, 0.46, 0.2 ) : ki == 5 ? vec3( 0.04, 0.3, 0.08 ) : ki == 6 ? vec3( 0.02, 0.02, 0.025 ) : vec3( 0.9, 0.22, 0.02 );
    vec3 col = vec3( 1.0 );
    bool shorts = ( wear & ( 1 << 16 ) ) != 0;
    bool bare = ( wear & ( 1 << 17 ) ) != 0;
    bool longS = ( wear & ( 1 << 18 ) ) != 0;
    bool bareA = ( wear & ( 1 << 19 ) ) != 0;
    if ( slot == 14 ) col = bare ? skinC : iA.rgb;
    else if ( slot == 1 ) col = iB.rgb;
    else if ( slot == 2 ) col = skinC;
    else if ( slot == 3 ) col = hairC;
    else if ( slot == 4 ) col = vec3( 0.03, 0.03, 0.035 ) + iB.rgb * 0.15;
    else if ( slot == 5 || slot == 10 ) col = hatC;
    else if ( slot == 8 ) col = vec3( 0.55, 0.45, 0.32 );
    else if ( slot == 9 ) col = vec3( 0.03 );
    else if ( slot == 11 ) col = shorts ? skinC : iB.rgb;
    else if ( slot == 12 ) col = longS ? iA.rgb : skinC;
    else if ( slot == 13 ) col = bare || bareA ? skinC : iA.rgb;
    vColor = col;
    float fi = mod( iD.y, 4.0 );
    float pi = floor( iD.y / 4.0 );
    if ( slot == 2 ) vMapUv.x += fi * ${(64 / AT).toFixed(5)};
    else if ( slot == 14 ) vMapUv.x += bare ? 0.0 : pi * ${(96 / AT).toFixed(5)};
    else if ( slot == 6 ) vMapUv += vec2( mod( iD.z, 2.0 ) * 0.5, -floor( iD.z / 2.0 ) * 0.125 );
    else if ( slot == 7 ) vMapUv += vec2( mod( iD.z, 4.0 ) * 0.25, -floor( iD.z / 4.0 ) * ${(80 / AT).toFixed(5)} );
  }
`;

function crowdMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: crowdAtlas(), roughness: 0.82, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uFocus = U.uFocus;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON)
      .replace('#include <color_vertex>', COLOR)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3( normal );\nvec3 cPos = vec3( position );\ncrowdPose( cPos, objectNormal );')
      .replace('#include <begin_vertex>', 'vec3 transformed = cPos;');
  };
  mat.customProgramCacheKey = () => 'crowd-1';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uFocus = U.uFocus;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON)
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3( position );\nvec3 cN = vec3( 0.0, 1.0, 0.0 );\ncrowdPose( transformed, cN );');
  };
  depth.customProgramCacheKey = () => 'crowd-depth-1';
  return { mat, depth };
}

// --- Apparence aléatoire d'un figurant ---
const SHIRTS = ['#e0384b', '#ffd23f', '#2b6cff', '#ffffff', '#3ccf7a', '#ff7a1a', '#f2f2f2', '#9b59ff', '#ff4fa0', '#1d2b5a', '#7fc8ff', '#2d2f36', '#c9b48a', '#b02a30'];
const PANTS = ['#2d3140', '#3a4a6b', '#1f2229', '#6b5a45', '#c9c2b0', '#48536b', '#2f3a2c', '#8a2f2f'];
const lin = (hex) => new THREE.Color(hex);
// Remplit les champs d'apparence manquants d'un emplacement (x, y, z, yaw donnés).
export function dress(s, r, kind = 'roadside') {
  const age = r();
  s.child = s.child ?? (age < 0.12);
  s.old = s.old ?? (!s.child && age > 0.88);
  const female = r() < 0.48;
  s.scale = s.scale ?? (s.child ? 0.58 + r() * 0.16 : (female ? 0.92 : 0.98) + r() * 0.1);
  s.girth = s.girth ?? (s.child ? 0.9 : 0.86 + Math.pow(r(), 1.6) * 0.5);
  s.skin = s.skin ?? Math.pow(r(), 1.4);
  s.hair = s.hair ?? (s.old ? 5 + (r() < 0.5 ? 1 : 0) : Math.floor(r() * 5));
  s.shirt = s.shirt ?? SHIRTS[Math.floor(r() * SHIRTS.length)];
  s.pants = s.pants ?? PANTS[Math.floor(r() * PANTS.length)];
  s.face = s.face ?? Math.floor(r() * 4);
  s.pattern = s.pattern ?? (r() < 0.62 ? 0 : 1 + Math.floor(r() * 3));
  if (s.pattern === 2) s.shirt = '#ffffff'; // maillot à pois : fond blanc
  if (s.pattern === 1 && r() < 0.6) s.shirt = '#ffffff'; // marinière
  s.hat = s.hat ?? Math.floor(r() * 8);
  s.energy = s.energy ?? (s.old ? 0.3 : 0.5 + r() * 0.5);
  let opts = s.opts ?? 0;
  if (female && r() < 0.75) opts |= bit(OPT.hairLong);
  if (female && !s.child && kind !== 'beach' && r() < 0.18) opts |= bit(OPT.skirt);
  const hr = r();
  if (kind === 'beach') {
    if (hr < 0.35) opts |= bit(OPT.sunHat);
    else if (hr < 0.5) opts |= bit(OPT.cap);
  } else if (hr < 0.28) opts |= bit(OPT.cap);
  else if (hr < 0.36) opts |= bit(OPT.sunHat);
  else if (hr < 0.4 && s.old) opts |= bit(OPT.beret);
  if (kind === 'roadside' && r() < 0.08) opts |= bit(OPT.backpack);
  if (kind === 'beach') opts |= bit(WEAR.shorts) | bit(WEAR.bareArms) | (female ? 0 : bit(WEAR.bare));
  else if (r() < 0.25) opts |= bit(WEAR.shorts);
  if (kind === 'cold' || (s.old && r() < 0.5)) opts |= bit(WEAR.longSleeves);
  s.opts = opts;
  return s;
}

// Action d'un spectateur au bord de la route (drapeaux, pancartes, applaudissements…)
export function fanAction(s, r) {
  const a = r();
  if (a < 0.14) {
    s.act = ACT.flag;
    s.opts |= bit(OPT.flag);
    s.prop = Math.floor(r() * 8);
  } else if (a < 0.24) {
    s.act = ACT.sign;
    s.opts |= bit(OPT.sign);
    s.prop = Math.floor(r() * SIGNS.length);
  } else if (a < 0.4) s.act = ACT.clap;
  else if (a < 0.5) s.act = ACT.cheer;
  else if (a < 0.56) {
    s.act = ACT.photo;
    s.opts |= bit(OPT.phone);
  } else if (a < 0.66) s.act = ACT.wave;
  else if (a < 0.74) s.act = ACT.talk;
  else s.act = ACT.idle;
  return s;
}

// --- Foule : CPU (tous les figurants) + deux maillages instanciés (proches détaillés, lointains simplifiés) ---
const registry = [];
const LIMITS = {
  high: { near: 150, far: 700, r1: 62, r2: 320 },
  medium: { near: 80, far: 380, r1: 44, r2: 220 },
  low: { near: 40, far: 200, r1: 28, r2: 140 },
};
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
class Crowd {
  constructor(spots, quality) {
    const L = LIMITS[quality] || LIMITS.high;
    this.L = L;
    const n = spots.length;
    this.n = n;
    this.mat = new Float32Array(n * 16);
    this.a = [0, 1, 2, 3].map(() => new Float32Array(n * 4));
    spots.forEach((s, i) => this.write(i, s));
    this.px = new Float32Array(n);
    this.pz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.px[i] = this.mat[i * 16 + 12];
      this.pz[i] = this.mat[i * 16 + 14];
    }
    this.d2 = new Float32Array(n);
    this.order = new Uint32Array(n);
    this.byDist = (x, y) => this.d2[x] - this.d2[y];
    const { mat, depth } = crowdMaterial();
    this.group = new THREE.Group();
    this.group.userData.tag = 'crowd';
    this.near = this.makeMesh(personGeometry(quality === 'high' ? 'high' : 'medium'), mat, Math.min(n, L.near));
    this.near.customDepthMaterial = depth;
    this.near.castShadow = quality === 'high';
    this.near.receiveShadow = quality !== 'low';
    this.far = this.makeMesh(personGeometry('far'), mat, Math.min(n, L.far));
    this.group.add(this.near, this.far);
    this.selNear = new Int32Array(this.near.userData.max).fill(-1);
    this.selFar = new Int32Array(this.far.userData.max).fill(-1);
    this.timer = 0;
    this.lastX = 1e9;
    this.lastZ = 1e9;
  }

  makeMesh(base, mat, max) {
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv', 'aInfo']) g.setAttribute(k, base.attributes[k]);
    g.setIndex(base.index);
    g.boundingSphere = base.boundingSphere;
    const m = Math.max(1, max);
    ['iA', 'iB', 'iC', 'iD'].forEach((k) => {
      const at = new THREE.InstancedBufferAttribute(new Float32Array(m * 4), 4);
      at.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(k, at);
    });
    const mesh = new THREE.InstancedMesh(g, mat, m);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.userData.max = max;
    return mesh;
  }

  // Matrice et attributs d'un figurant (position, cap, échelle ; couché pour bronzer ou nager)
  write(i, s) {
    _s.setScalar(s.scale);
    if (s.act === ACT.lie || s.act === ACT.swim) {
      _q.setFromEuler(_e.set(s.act === ACT.lie ? -Math.PI / 2 : Math.PI / 2, s.yaw, 0, 'YXZ'));
      _p.set(0, s.act === ACT.lie ? 0.11 : -0.06, s.act === ACT.lie ? 0.85 * s.scale : -0.9 * s.scale).applyAxisAngle(THREE.Object3D.DEFAULT_UP, s.yaw);
      _p.x += s.x;
      _p.y += s.y;
      _p.z += s.z;
    } else {
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, s.yaw);
      _p.set(s.x, s.y, s.z);
    }
    _m.compose(_p, _q, _s).toArray(this.mat, i * 16);
    const [A, Bb, Cc, D] = this.a;
    _c.set(s.shirt);
    A.set([_c.r, _c.g, _c.b, s.act ?? 0], i * 4);
    _c.set(s.pants);
    Bb.set([_c.r, _c.g, _c.b, s.seed ?? (i * 0.6180339) % 1], i * 4);
    Cc.set([s.skin, s.hair, s.girth, s.opts], i * 4);
    D.set([s.hat, s.face + 4 * s.pattern, s.aux ?? s.prop ?? 0, s.energy], i * 4);
  }

  // Sélection par distance à la caméra (4 fois par seconde, ou dès que la caméra a bougé de 6 m)
  update(dt, camera) {
    this.timer -= dt;
    const cx = camera.position.x;
    const cz = camera.position.z;
    if (this.timer > 0 && (cx - this.lastX) ** 2 + (cz - this.lastZ) ** 2 < 36) return;
    this.timer = 0.25;
    this.lastX = cx;
    this.lastZ = cz;
    const { r1, r2 } = this.L;
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      const d = (this.px[i] - cx) ** 2 + (this.pz[i] - cz) ** 2;
      this.d2[i] = d;
      if (d < r2 * r2) this.order[k++] = i;
    }
    const list = this.order.subarray(0, k);
    list.sort(this.byDist);
    const maxN = this.near.userData.max;
    let nn = 0;
    while (nn < k && nn < maxN && this.d2[list[nn]] < r1 * r1) nn++;
    this.fill(this.near, this.selNear, list, 0, nn);
    this.fill(this.far, this.selFar, list, nn, Math.min(k, nn + this.far.userData.max));
  }

  fill(mesh, sel, list, from, to) {
    const cnt = to - from;
    let same = cnt === mesh.count;
    for (let j = 0; same && j < cnt; j++) same = sel[j] === list[from + j];
    if (same) return;
    const g = mesh.geometry;
    const im = mesh.instanceMatrix.array;
    const at = [g.attributes.iA.array, g.attributes.iB.array, g.attributes.iC.array, g.attributes.iD.array];
    for (let j = 0; j < cnt; j++) {
      const i = list[from + j];
      sel[j] = i;
      im.set(this.mat.subarray(i * 16, i * 16 + 16), j * 16);
      for (let a = 0; a < 4; a++) at[a].set(this.a[a].subarray(i * 4, i * 4 + 4), j * 4);
    }
    mesh.count = cnt;
    mesh.instanceMatrix.needsUpdate = true;
    for (const k of ['iA', 'iB', 'iC', 'iD']) g.attributes[k].needsUpdate = true;
  }
}

// Inscrit un objet animé (foule, héros) ; il se désinscrit quand sa racine quitte la scène.
function register(entry) {
  entry.seen = false;
  registry.push(entry);
  return entry;
}

// Foule à partir d'emplacements complets ({ x, y, z, yaw, act, … } ; voir dress()).
export function makeCrowd(spots, { quality = 'high' } = {}) {
  const crowd = new Crowd(spots, quality);
  register({ root: crowd.group, update: (dt, cam) => crowd.update(dt, cam) });
  return crowd;
}

// Point d'intérêt des foules : joueur (si main.js le donne) sinon un peu devant la caméra.
let focusAge = 1e9;
export function setCrowdFocus(x, y, z) {
  U.uFocus.value.set(x, y, z);
  focusAge = 0;
}
const _fwd = new THREE.Vector3();
// Une fois par image (main.js) : horloge et point d'intérêt des shaders, sélection, héros.
export function updateCrowds(dt, camera) {
  U.uTime.value += dt;
  focusAge += dt;
  if (focusAge > 0.5 && camera) {
    camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    _fwd.normalize();
    U.uFocus.value.copy(camera.position).addScaledVector(_fwd, 7);
    U.uFocus.value.y -= 2;
  }
  for (let i = registry.length - 1; i >= 0; i--) {
    const e = registry[i];
    let o = e.root;
    while (o.parent) o = o.parent;
    if (!o.isScene) {
      e.age = (e.age || 0) + dt;
      if (e.seen || e.age > 10) registry.splice(i, 1); // retiré de la scène (ou jamais ajouté)
      continue;
    }
    e.seen = true;
    if (camera) e.update(dt, camera);
  }
}
export const crowdClock = () => U.uTime.value;

// ---------------------------------------------------------------------------------------------
// Accessoires fixes des scènes de figurants (tables et chaises de café, parasols, filet de volley…) :
// un seul maillage par décor, couleurs dans les sommets, filet découpé dans l'atlas (alphaTest).
// ---------------------------------------------------------------------------------------------
class Props {
  constructor() {
    this.body = new Body();
    this.cols = [];
  }
  add(geo, color, matrix = null, uvFn = null) {
    if (uvFn) {
      const Pp = geo.attributes.position;
      const uv = new Float32Array(Pp.count * 2);
      for (let i = 0; i < Pp.count; i++) uv.set(uvFn(Pp.getX(i), Pp.getY(i), Pp.getZ(i)), i * 2);
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    if (matrix) geo.applyMatrix4(matrix);
    const before = this.body.pos.length / 3;
    this.body.add(geo, 0, 0, 0, uvFn ? (x, y, z, u, v) => [u, v] : null);
    const c = C(color);
    for (let i = before; i < this.body.pos.length / 3; i++) this.cols.push(c.r, c.g, c.b);
  }
  build(group, cast) {
    if (!this.cols.length) return null;
    const g = this.body.build();
    g.deleteAttribute('aInfo');
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.cols, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: crowdAtlas(), alphaTest: 0.5, roughness: 0.75, side: THREE.DoubleSide }));
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
}
const at = (x, y, z, yaw = 0) => new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), V(1, 1, 1));

// Terrasse de café : tables rondes, chaises, parasols ; clients assis (boivent, discutent), un serveur.
function cafe(props, spots, r, x, y, z, yaw, rows = 3) {
  const ux = Math.cos(yaw);
  const uz = -Math.sin(yaw);
  for (let k = 0; k < rows; k++) {
    const tx = x + ux * k * 2.4;
    const tz = z + uz * k * 2.4;
    props.add(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 14).translate(0, 0.74, 0), '#f2efe6', at(tx, y, tz));
    props.add(new THREE.CylinderGeometry(0.03, 0.04, 0.72, 6).translate(0, 0.37, 0), '#3a3a3e', at(tx, y, tz));
    props.add(new THREE.ConeGeometry(1.25, 0.45, 10, 1, true).translate(0, 2.3, 0), k % 2 ? '#d8202a' : '#f4f1ea', at(tx, y, tz));
    props.add(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 5).translate(0, 1.15, 0), '#d9d9d9', at(tx, y, tz));
    for (let c = 0; c < 4; c++) {
      if (c === 1 && k === 1) continue;
      const a = yaw + (c * Math.PI) / 2 + 0.3;
      const cx = tx + Math.sin(a) * 0.7;
      const cz = tz + Math.cos(a) * 0.7;
      const face = a + Math.PI;
      const m = at(cx, y, cz, face);
      props.add(new THREE.BoxGeometry(0.42, 0.04, 0.42).translate(0, 0.45, 0), '#7a4e2e', m.clone());
      props.add(new THREE.BoxGeometry(0.42, 0.45, 0.04).translate(0, 0.7, -0.2), '#7a4e2e', m.clone());
      for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) props.add(new THREE.CylinderGeometry(0.015, 0.015, 0.45, 4).translate(lx, 0.225, lz), '#2a2a2e', m.clone());
      if (r() < 0.75) {
        const s = dress({ x: cx, y, z: cz, yaw: face, aux: 0.45 }, r, 'village');
        s.act = r() < 0.5 ? ACT.drink : ACT.talk;
        if (s.act === ACT.drink) s.opts |= bit(OPT.cup);
        s.aux = 0.45;
        s.child = false;
        spots.push(s);
      } else if (c === 0) {
        // tasse posée sur la table
        props.add(new THREE.CylinderGeometry(0.03, 0.025, 0.07, 6).translate(0.12, 0.79, 0.1), '#ffffff', at(tx, y, tz));
      }
    }
  }
  // Serveur : chemise blanche, tablier noir
  const w = dress({ x: x + ux * 1.2 + Math.sin(yaw) * 1.3, y, z: z + uz * 1.2 + Math.cos(yaw) * 1.3, yaw: yaw + 2.6, shirt: '#ffffff', pants: '#16171b', child: false, old: false }, r, 'village');
  w.act = ACT.talk;
  w.opts &= ~bit(OPT.cap) & ~bit(OPT.sunHat);
  spots.push(w);
}

// Beach-volley : filet, poteaux, 4 joueurs ; la balle est animée sur la même horloge que les joueurs.
function volley(group, props, spots, r, x, y, z, yaw, heightAt) {
  const ux = Math.cos(yaw);
  const uz = -Math.sin(yaw);
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  for (const s of [-1, 1]) props.add(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6).translate(0, 1.3, 0), '#e8e8e8', at(x + ux * s * 4.3, y, z + uz * s * 4.3));
  const net = new THREE.PlaneGeometry(8.4, 0.95, 1, 1).translate(0, 2.0, 0);
  props.add(net, '#ffffff', at(x, y, z, yaw), (px, py) => cellUV(CELL.net, Math.min(1, Math.max(0, (px + 4.2) / 8.4)), Math.min(1, Math.max(0, (2.475 - py) / 0.95))));
  // Ligne de terrain (rubans au sol)
  for (const s of [-1, 1]) props.add(new THREE.BoxGeometry(8, 0.01, 0.05).translate(0, 0.01, s * 8), '#2b6cff', at(x, y, z, yaw));
  for (const s of [-1, 1]) props.add(new THREE.BoxGeometry(0.05, 0.01, 16).translate(s * 4, 0.01, 0), '#2b6cff', at(x, y, z, yaw));
  // Joueurs : ordre des frappes 0 (A, attaque), 1 (B, passe), 2 (B, attaque), 3 (A, passe)
  const place = [[-1.6, -4.2], [1.4, 2.6], [-1.3, 4.4], [1.5, -2.4]];
  const pos = [];
  place.forEach(([lx, lz], k) => {
    const px = x + ux * lx + fx * lz;
    const pz = z + uz * lx + fz * lz;
    const py = heightAt(px, pz);
    const s = dress({ x: px, y: py, z: pz, yaw: yaw + (lz > 0 ? Math.PI : 0), child: false, old: false, girth: 0.88 + r() * 0.12 }, r, 'beach');
    s.act = ACT.volley;
    s.aux = k;
    s.opts &= ~bit(OPT.sunHat) & ~bit(OPT.skirt);
    spots.push(s);
    pos.push(V(px, py + 2.1, pz));
  });
  // Balle : arcs successifs entre les mains des joueurs (même période que le shader : 1,15 s par frappe)
  const ball = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(0.11, 1)), new THREE.MeshStandardMaterial({ color: '#ffe14d', roughness: 0.5 }));
  ball.castShadow = true;
  group.add(ball);
  const Th = 1.15;
  register({
    root: ball,
    update: () => {
      const t = crowdClock();
      const k = Math.floor(t / Th) % 4;
      const f = (t % Th) / Th;
      const a = pos[k];
      const b = pos[(k + 1) % 4];
      const apex = k % 2 === 0 ? 2.6 : 1.8;
      ball.position.lerpVectors(a, b, f);
      ball.position.y += Math.sin(Math.PI * f) * apex + (k % 2 === 0 ? 0.3 : 0) * (1 - f);
      ball.rotation.x = t * 5;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Diable des montées : costume rouge, cornes, cape, trident ; il attend sur le bord de la route puis
// court à côté du joueur en agitant son trident, comme sur les grands cols du Tour.
// ---------------------------------------------------------------------------------------------
function devilExtras(parts, quality) {
  const hi = quality === 'high';
  const hc = [0, BODY.headY + 0.1, 0.012];
  for (const s of [-1, 1]) {
    const horn = new THREE.ConeGeometry(0.018, 0.075, hi ? 8 : 5).rotateZ(-s * 0.45).translate(s * 0.055, hc[1] + 0.105, hc[2] + 0.02);
    parts.add(horn, { bone: B.head, pbr: PBR.satin, uvFn: () => [ATLAS.dark[0] + 0.05, 1 - ATLAS.dark[1] - 0.05] });
  }
  // Trident dans la main droite (os de la main, pose de liaison : bras le long du corps)
  const hx = -BODY.shoulder[0];
  const hy = BODY.shoulder[1] - BODY.upper - BODY.fore - 0.06;
  const metal = () => [ATLAS.metal[0] + 0.05, 1 - ATLAS.metal[1] - 0.05];
  parts.add(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 6).translate(hx, hy + 0.3, 0.03), { bone: B.handR, pbr: PBR.satin, uvFn: () => [ATLAS.dark[0] + 0.05, 1 - ATLAS.dark[1] - 0.05] });
  for (const k of [-1, 0, 1]) parts.add(new THREE.ConeGeometry(0.012, 0.16, 5).translate(hx + k * 0.05, hy + 1.13, 0.03), { bone: B.handR, pbr: PBR.chrome, uvFn: metal });
  parts.add(new THREE.BoxGeometry(0.12, 0.018, 0.018).translate(hx, hy + 1.05, 0.03), { bone: B.handR, pbr: PBR.chrome, uvFn: metal });
  // Cape (os B.oarL, accrochée aux épaules) et queue pointue (os B.oarR, au bas du dos)
  const cape = new THREE.PlaneGeometry(0.46, 0.85, 3, 5);
  const cp = cape.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i);
    const y = cp.getY(i);
    cp.setXYZ(i, x * (1 + 0.35 * (0.425 - y)), BODY.shoulder[1] + 0.02 - (0.425 - y), -0.13 - 0.05 * Math.cos(x * 5) - 0.04 * (0.425 - y));
  }
  cape.computeVertexNormals();
  const red = () => [ATLAS.accent[0] + 0.05, 1 - ATLAS.accent[1] - 0.05];
  parts.add(cape, { bone: B.oarL, pbr: PBR.fabric, uvFn: red });
  parts.add(cape.clone().scale(1, 1, 1).translate(0, 0, -0.004), { bone: B.oarL, pbr: PBR.fabric, uvFn: red });
  const tail = sweep(new THREE.CatmullRomCurve3([V(0, -0.02, -0.12), V(0, -0.2, -0.22), V(0, -0.4, -0.2), V(0, -0.5, -0.3)]), { segs: 6, radial: 5, radius: (t) => [0.012 * (1 - 0.6 * t), 0.012 * (1 - 0.6 * t)] });
  parts.add(tail, { bone: B.oarR, pbr: PBR.fabric, uvFn: red });
  parts.add(new THREE.ConeGeometry(0.035, 0.07, 4).rotateX(-1.8).translate(0, -0.52, -0.33), { bone: B.oarR, pbr: PBR.fabric, uvFn: red });
}

const tV = Array.from({ length: 12 }, () => new THREE.Vector3());
const tQ = Array.from({ length: 4 }, () => new THREE.Quaternion());
const AX = V(1, 0, 0);
const AY = V(0, 1, 0);
// Pose de course à pied / de saut sur place (os du squelette de figure.js, repère du personnage, +Z devant).
function poseRunner(bones, t, speed, hop, waveR, look) {
  const run = Math.min(1, speed / 3);
  const w = t * (6 + speed * 0.9);
  const bob = Math.abs(Math.sin(w)) * 0.06 * run + Math.max(0, Math.sin(t * 7)) * 0.18 * hop;
  const lean = 0.08 + 0.18 * run;
  const qP = tQ[0].setFromAxisAngle(AX, lean * 0.6).multiply(tQ[1].setFromAxisAngle(AY, Math.sin(w) * 0.15 * run));
  const hip = tV[0].set(0, 0.95 + bob, 0);
  const pelvis = tV[1].set(0, -BODY.hip[1], 0).applyQuaternion(qP).add(hip);
  bones[B.pelvis].position.copy(pelvis);
  bones[B.pelvis].quaternion.copy(qP);
  const qC = tQ[2].setFromAxisAngle(AX, lean).multiply(tQ[3].setFromAxisAngle(AY, -Math.sin(w) * 0.25 * run));
  const chest = tV[2].set(0, BODY.chestY, 0).applyQuaternion(qP).add(pelvis);
  bones[B.chest].position.copy(chest);
  bones[B.chest].quaternion.copy(qC);
  const head = tV[3].set(0, BODY.headY - BODY.chestY, 0).applyQuaternion(qC).add(chest);
  bones[B.head].position.copy(head);
  bones[B.head].quaternion.setFromAxisAngle(AY, look).multiply(tQ[1].setFromAxisAngle(AX, -0.1));
  poseHeadGear(bones, -1, false);
  // Cape et queue : suivent le buste, la cape se soulève en courant
  const swing = tQ[1].setFromAxisAngle(AX, -0.3 * run - 0.08 * Math.sin(w * 2));
  const piv = tV[4].set(0, BODY.shoulder[1] - BODY.chestY, -0.12);
  bones[B.oarL].position.copy(piv).sub(tV[5].copy(piv).applyQuaternion(swing)).applyQuaternion(qC).add(chest);
  bones[B.oarL].quaternion.copy(qC).multiply(swing);
  bones[B.oarR].position.copy(pelvis);
  bones[B.oarR].quaternion.copy(qP).multiply(tQ[1].setFromAxisAngle(tV[5].set(0, 0, 1), Math.sin(t * 5) * 0.4));
  // Jambes : pieds sur un cycle de foulée
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1;
    const ph = w + (i ? Math.PI : 0);
    const [bt, bk, bf] = s > 0 ? [B.thighL, B.shinL, B.footL] : [B.thighR, B.shinR, B.footR];
    const hipJ = tV[6].set(s * BODY.hip[0], BODY.hip[1], 0).applyQuaternion(qP).add(pelvis);
    const ankle = tV[7].set(s * 0.1, 0.09 + Math.max(0, Math.cos(ph)) * 0.22 * run + Math.max(0, Math.sin(t * 7)) * 0.16 * hop, Math.sin(ph) * 0.38 * run + 0.05);
    const knee = ik2(hipJ, ankle, BODY.thigh, BODY.shin, tV[8].set(s * 0.1, 0, 1), tV[9], tV[10]);
    orient(bones[bt], hipJ, tV[11].subVectors(hipJ, knee), tV[8]);
    orient(bones[bk], knee, tV[11].subVectors(knee, tV[10]), tV[8]);
    bones[bf].position.copy(tV[10]);
    bones[bf].quaternion.setFromAxisAngle(AX, Math.cos(ph) * 0.3 * run);
  }
  // Bras : le gauche balance, le droit brandit le trident
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1;
    const [bu, bf, bh] = s > 0 ? [B.upperL, B.foreL, B.handL] : [B.upperR, B.foreR, B.handR];
    const shoulder = tV[6].set(s * BODY.shoulder[0], BODY.shoulder[1] - BODY.chestY, 0).applyQuaternion(qC).add(chest);
    let wrist;
    if (s < 0) {
      const shake = Math.sin(t * 9) * 0.06 * waveR;
      wrist = tV[7].set(-0.3 + shake, 0.22 + 0.25 * waveR, 0.12).applyQuaternion(qC).add(shoulder);
    } else {
      const sw = Math.sin(w) * 0.25 * run;
      wrist = tV[7].set(0.12, -0.42 + 0.1 * run + 0.5 * hop * Math.max(0, Math.sin(t * 7)), 0.12 + sw).add(shoulder);
    }
    const elbow = ik2(shoulder, wrist, BODY.upper, BODY.fore, tV[8].set(s * 0.8, -0.4, -0.5), tV[9], tV[10]);
    orient(bones[bu], shoulder, tV[11].subVectors(shoulder, elbow), tV[5].subVectors(tV[10], elbow));
    orient(bones[bf], elbow, tV[11].subVectors(elbow, tV[10]), tV[5].set(-s * 0.3, 1, 0.2));
    orient(bones[bh], tV[10], s < 0 ? tV[11].set(0.1, -1, 0.05) : tV[11].subVectors(elbow, tV[10]), tV[5].set(-s, 0.2, 0.4));
  }
}

function makeDevil(quality) {
  const q = quality === 'high' ? 'high' : quality === 'low' ? 'low' : 'medium';
  const binds = bindPositions([
    [B.oarL, [0, BODY.chestY, 0]],
    [B.oarR, [0, 0, 0]],
  ]);
  const body = makeBody(bodyGeometry('devil', q, devilExtras), bodyMaterial({ kind: 'devil', jersey: '#c8102e', helmet: '#c8102e', accent: '#14151a', skin: SKINS[1], number: 0, look: { beard: 4, hair: '#141210' } }, q), binds);
  body.mesh.boundingSphere = new THREE.Sphere(V(0, 1, 0), 2.2);
  return body;
}

// Le diable attend au point s0 (côté side) d'une montée ; il court avec le joueur sur ~70 m.
function addDevil(group, track, heightAt, s0, side, quality) {
  const { mesh, bones } = makeDevil(quality);
  const root = new THREE.Group();
  root.add(mesh);
  group.add(root);
  const f = {};
  const st = { s: s0, v: 0, t: Math.random() * 10, focusS: -1e9, lastFocusS: null, mode: 'wait', look: 0 };
  const lat = side * (ROAD_HALF + 1.1);
  register({
    root,
    update: (dt, camera) => {
      st.t += dt;
      // Abscisse du point d'intérêt le long de la route, cherchée seulement près du diable
      const fp = U.uFocus.value;
      track.frame(st.s, 0, f);
      const near = Math.hypot(fp.x - f.x, fp.z - f.z);
      root.visible = camera.position.distanceTo(root.position) < 260;
      if (near > 140) {
        if (st.mode !== 'wait') {
          st.mode = 'wait';
          st.s = s0;
        }
        st.lastFocusS = null;
      } else {
        let best = 1e18;
        let bs = st.s;
        const from = st.lastFocusS ?? st.s - 90;
        const span = st.lastFocusS === null ? 180 : 24;
        const step = st.lastFocusS === null ? 3 : 1;
        for (let s = from - (st.lastFocusS === null ? 0 : 12); s <= from + span - (st.lastFocusS === null ? 0 : 12); s += step) {
          track.frame(s, 0, f);
          const d = (fp.x - f.x) ** 2 + (fp.z - f.z) ** 2;
          if (d < best) {
            best = d;
            bs = s;
          }
        }
        const fv = st.lastFocusS === null || dt <= 0 ? 0 : (bs - st.lastFocusS) / dt;
        st.lastFocusS = bs;
        // Le point d'intérêt est ~3 m derrière le joueur : le diable court à sa hauteur, un peu devant
        const target = bs + 2.5;
        if (st.mode === 'wait' && target > s0 - 2) st.mode = 'run';
        if (st.mode === 'run' && target > s0 + 75) st.mode = 'done';
        if (st.mode === 'run') {
          const want = Math.max(0, Math.min(9, fv + (target - st.s) * 1.5));
          st.v += (want - st.v) * (1 - Math.exp(-dt * 4));
          st.s = Math.max(st.s, st.s + st.v * dt);
        } else st.v += (0 - st.v) * (1 - Math.exp(-dt * 3));
      }
      st.s += st.mode === 'done' ? st.v * dt : 0;
      track.frame(st.s, lat, f);
      root.position.set(f.x, heightAt(f.x, f.z) - 0.02, f.z);
      const yaw = Math.atan2(f.tx, f.tz);
      root.rotation.y = yaw;
      // Regarde la caméra (le joueur), bornée
      const dx = camera.position.x - root.position.x;
      const dz = camera.position.z - root.position.z;
      let rel = Math.atan2(dx, dz) - yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      st.look += (Math.max(-1.1, Math.min(1.1, rel)) - st.look) * (1 - Math.exp(-dt * 4));
      const hop = st.mode === 'run' ? 0 : near < 60 ? 1 : 0.2;
      poseRunner(bones, st.t, st.v, hop, st.mode === 'run' ? 1 : near < 60 ? 1 : 0.3, st.look);
    },
  });
  return root;
}

// ---------------------------------------------------------------------------------------------
// Décors : spectateurs du circuit (montées, départ), village, ferme, plage
// ---------------------------------------------------------------------------------------------
// fanSpots : [x, y, z, yaw, r] des spectateurs du bord de route (scenery.js). ctx : contexte du décor.
export function buildCourseCrowd(group, ctx, fanSpots, quality) {
  const { track, heightAt } = ctx;
  const r = rng(91);
  const spots = [];
  const feats = track.course.features || {};
  const cold = track.course.theme === 'alpine';
  for (const [x, y, z, yaw, k] of fanSpots) {
    const s = dress({ x, y: y - 0.03, z, yaw, seed: k }, r, cold ? 'cold' : 'roadside');
    fanAction(s, r);
    spots.push(s);
  }
  // Montée la plus raide : haie de spectateurs serrés des deux côtés (comme sur les cols du Tour) et le diable
  let bestS = -1;
  if (track.course.theme === 'alpine' || track.course.theme === 'meadow') {
    let bestG = 5;
    for (let s = 40; s < track.length - 120; s += 10) {
      const g = track.gradeAt(s) + track.gradeAt(s + 40) + track.gradeAt(s + 80);
      if (track.surfaceAt(s) === 'asphalt' && g / 3 > bestG) {
        bestG = g / 3;
        bestS = s;
      }
    }
  }
  if (bestS > 0) {
    const f = {};
    for (let s0 = bestS - 30; s0 < bestS + 150; s0 += 2.1) {
      for (const side of [-1, 1]) {
        if (r() > (quality === 'low' ? 0.35 : 0.8)) continue;
        track.frame(s0 + r() * 1.5, side * (ROAD_HALF + 2.9 + r() * 2.2), f);
        const y = heightAt(f.x, f.z);
        if (Math.abs(y - f.y) > 1.7 || (ctx.free && !ctx.free(f.x, f.z, ROAD_HALF + 2.6))) continue;
        const sp = dress({ x: f.x, y: y - 0.03, z: f.z, yaw: Math.atan2(-side * f.rx, -side * f.rz) + (r() - 0.5) * 0.6 }, r, cold ? 'cold' : 'roadside');
        fanAction(sp, r);
        sp.energy = 0.7 + 0.3 * r();
        spots.push(sp);
      }
    }
  }
  const props = new Props();
  if (feats.village) villageCrowd(spots, props, r, ctx, feats.village);
  if (feats.farm) farmCrowd(spots, r, ctx, feats.farm);
  if (feats.coast) beachCrowd(group, spots, props, r, ctx, feats.coast);
  if (feats.lake && ctx.lake) lakeCrowd(spots, r, ctx);
  props.build(group, quality !== 'low');
  const crowd = makeCrowd(spots, { quality });
  group.add(crowd.group);
  if (bestS > 0) {
    const side = ctx.edgeSlope && Math.abs(ctx.edgeSlope(bestS, -1)) < Math.abs(ctx.edgeSlope(bestS, 1)) ? -1 : 1;
    addDevil(group, track, heightAt, bestS, side, quality);
  }
  return crowd;
}

// Village de chalets : promeneurs autour de la fontaine, assis sur la margelle, enfants, terrasse de café.
function villageCrowd(spots, props, r, ctx, cfg) {
  const { track, heightAt } = ctx;
  const sm = ((cfg.from + cfg.to) / 2) * track.length;
  const fp = track.frame(sm, ROAD_HALF + 8);
  const fy = heightAt(fp.x, fp.z) - 0.05;
  for (let k = 0; k < 5; k++) {
    const s = dress({ x: fp.x, y: fy, z: fp.z, yaw: 0 }, r, 'village');
    s.act = ACT.walk;
    s.aux = 2.6 + k * 0.45;
    s.opts &= ~bit(OPT.sign) & ~bit(OPT.flag);
    spots.push(s);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    const s = dress({ x: fp.x + Math.sin(a) * 1.78, y: fy, z: fp.z + Math.cos(a) * 1.78, yaw: a }, r, 'village');
    s.act = k % 2 ? ACT.sit : ACT.talk;
    if (s.act === ACT.sit) {
      s.aux = 0.6;
      s.x = fp.x + Math.sin(a) * 1.72;
      s.z = fp.z + Math.cos(a) * 1.72;
    }
    spots.push(s);
  }
  // Terrasse de café le long de la route, avant la fontaine
  const cp = track.frame(sm - 16, ROAD_HALF + 2.6);
  const yaw = Math.atan2(cp.tx, cp.tz) - Math.PI / 2;
  cafe(props, spots, r, cp.x, heightAt(cp.x, cp.z) - 0.02, cp.z, yaw, 3);
  // Quelques villageois sur le pas des portes, qui saluent les coureurs
  for (let k = 0; k < 8; k++) {
    const s0 = (cfg.from + (cfg.to - cfg.from) * (0.1 + 0.8 * r())) * track.length;
    const side = r() < 0.5 ? -1 : 1;
    const f = track.frame(s0, side * (ROAD_HALF + 1.8 + r() * 1.5));
    const s = dress({ x: f.x, y: heightAt(f.x, f.z) - 0.02, z: f.z, yaw: Math.atan2(-side * f.rx, -side * f.rz) }, r, 'cold');
    s.act = [ACT.wave, ACT.clap, ACT.idle, ACT.photo][k % 4];
    if (s.act === ACT.photo) s.opts |= bit(OPT.phone);
    spots.push(s);
  }
}

// Ferme : le fermier (salopette, chapeau de paille, fourche) salue au bord du pré, sa famille un peu plus loin.
function farmCrowd(spots, r, ctx, cfg) {
  const { track, heightAt, lake } = ctx;
  const sm = ((cfg.from + cfg.to) / 2) * track.length;
  const mid = track.frame(sm, 0);
  let side = 1;
  if (lake) side = (lake.x - mid.x) * mid.rx + (lake.z - mid.z) * mid.rz > 0 ? -1 : 1;
  const f = track.frame(sm - 6, side * (ROAD_HALF + 5.2));
  const yaw = Math.atan2(-side * f.rx, -side * f.rz);
  const farmer = dress({ x: f.x, y: heightAt(f.x, f.z) - 0.02, z: f.z, yaw, shirt: '#2f5d9b', pants: '#2f5d9b', child: false, old: true, girth: 1.18, hat: 4, energy: 0.9 }, r, 'roadside');
  farmer.opts = bit(OPT.sunHat) | bit(OPT.fork) | bit(WEAR.longSleeves);
  farmer.act = ACT.waveL;
  farmer.hair = 5;
  spots.push(farmer);
  for (let k = 0; k < 3; k++) {
    const g = track.frame(sm + 2 + k * 1.3, side * (ROAD_HALF + 5.5 + r()));
    const s = dress({ x: g.x, y: heightAt(g.x, g.z) - 0.02, z: g.z, yaw, child: k > 0 }, r, 'roadside');
    s.act = k === 0 ? ACT.clap : ACT.jump;
    spots.push(s);
  }
}

// Plage : bronzeurs sur les serviettes (ctx.towels), baigneurs, beach-volley, promeneurs au bord de l'eau.
function beachCrowd(group, spots, props, r, ctx, cfg) {
  const { track, heightAt, seaY } = ctx;
  const coastZ = (x) => cfg.z + 6 * Math.sin(x * 0.013) + 4 * Math.sin(x * 0.031 + 1);
  for (const [x, y, z, k] of ctx.towels || []) {
    const yaw = k * 3;
    const s = dress({ x, y: y + 0.02, z, yaw }, r, 'beach');
    const a = r();
    s.act = a < 0.7 ? ACT.lie : ACT.sit;
    s.aux = 0;
    s.opts &= ~bit(OPT.skirt) & ~bit(OPT.backpack);
    spots.push(s);
  }
  // Baigneurs et promeneurs le long du rivage des tronçons de sable
  let swim = 0;
  let walk = 0;
  for (let s0 = 0; s0 < track.length; s0 += 14) {
    if (track.surfaceAt(s0) !== 'sand') continue;
    const c = track.frame(s0, 0);
    const x = c.x + (r() - 0.5) * 10;
    const zc = coastZ(x);
    if (r() < 0.55 && swim < 40) {
      const s = dress({ x, y: seaY, z: zc + 9 + r() * 26, yaw: r() * 6.28 }, r, 'beach');
      s.act = r() < 0.6 ? ACT.swim : ACT.wave;
      if (s.act === ACT.wave) s.y = seaY - 1.0; // dans l'eau jusqu'à la taille
      s.opts &= ~bit(OPT.sunHat) & ~bit(OPT.cap);
      spots.push(s);
      swim++;
    }
    if (r() < 0.35 && walk < 16) {
      const wx = x + (r() - 0.5) * 6;
      const wz = coastZ(wx) + 1.5;
      const s = dress({ x: wx, y: Math.max(seaY, heightAt(wx, wz)), z: wz, yaw: 0 }, r, 'beach');
      s.act = ACT.walk;
      s.aux = 3 + r() * 5;
      spots.push(s);
      walk++;
    }
  }
  // Beach-volley : là où la plage est la plus large le long de la route de sable, terrain parallèle à la route
  let best = null;
  for (let s0 = 0; s0 < track.length; s0 += 6) {
    if (track.surfaceAt(s0) !== 'sand') continue;
    const c = track.frame(s0, 0);
    const room = coastZ(c.x) - c.z;
    if (!best || room > best.room) best = { s: s0, room };
  }
  if (best && best.room > ROAD_HALF + 15) {
    const c = track.frame(best.s, 0);
    const side = c.rz > 0 ? 1 : -1;
    const p = track.frame(best.s, side * (ROAD_HALF + Math.min(12, best.room * 0.5)));
    volley(group, props, spots, r, p.x, heightAt(p.x, p.z), p.z, Math.atan2(p.tx, p.tz), heightAt);
  }
}

// Vallée Verte : pêcheurs et promeneurs au bord du lac.
function lakeCrowd(spots, r, ctx) {
  const { lake, heightAt } = ctx;
  for (let k = 0; k < 7; k++) {
    const a = r() * Math.PI * 2;
    const d = lake.r * (1.24 + r() * 0.08);
    const x = lake.x + Math.cos(a) * d;
    const z = lake.z + Math.sin(a) * d;
    const s = dress({ x, y: heightAt(x, z) - 0.02, z, yaw: Math.atan2(lake.x - x, lake.z - z) }, r, 'roadside');
    if (k < 3) {
      s.act = ACT.sit;
      s.aux = 0;
    } else {
      s.act = ACT.walk;
      s.aux = 2 + r() * 3;
    }
    spots.push(s);
  }
}

// Tribune de l'aviron (coordonnées monde) : assis sur les gradins ou debout, drapeaux et pancartes.
export function buildStandCrowd(group, seats, quality) {
  const r = rng(57);
  const spots = seats.map(([x, y, z, yaw, k]) => {
    const s = dress({ x, y, z, yaw, seed: k }, r, 'roadside');
    const a = r();
    if (a < 0.55) {
      s.act = r() < 0.35 ? ACT.drink : ACT.sit;
      s.aux = 0;
      if (s.act === ACT.drink) s.opts |= bit(OPT.cup);
    } else fanAction(s, r);
    return s;
  });
  const crowd = makeCrowd(spots, { quality });
  group.add(crowd.group);
  return crowd;
}

// Arrivée du kayak : public sur les deux rives (drapeaux, pancartes, photos).
export function buildBankCrowd(group, list, quality) {
  const r = rng(77);
  const spots = list.map(([x, y, z, yaw, k]) => fanAction(dress({ x, y, z, yaw, seed: k }, r, 'roadside'), r));
  const crowd = makeCrowd(spots, { quality });
  group.add(crowd.group);
  return crowd;
}

// ---------------------------------------------------------------------------------------------
// Entraîneur à vélo le long du lac d'aviron : suit le bateau du joueur sur le chemin de la rive gauche.
// ---------------------------------------------------------------------------------------------
export function addRowingCoach(group, { shoreX, heightAt, zMin, zMax, quality }) {
  const coach = new DetailedRider({ jersey: '#1d3557', bike: '#e8e8e8', helmet: '#1d3557', name: '', quality: quality === 'high' ? 'medium' : 'low' });
  coach.blob.visible = false;
  group.add(coach.group);
  const st = { z: zMin + 40, v: 0, crank: 0, lastF: null };
  register({
    root: coach.group,
    update: (dt, camera) => {
      const fz = U.uFocus.value.z;
      const fv = st.lastF === null || dt <= 0 ? 0 : (fz - st.lastF) / dt;
      st.lastF = fz;
      const target = Math.min(zMax - 120, fz + 6);
      // Première image ou saut de caméra (nouvelle course) : l'entraîneur se replace à hauteur du bateau
      if (Math.abs(target - st.z) > 80) st.z = Math.max(zMin + 40, target - 8);
      const want = Math.max(0, Math.min(9, fv + (target - st.z) * 0.8));
      st.v += (want - st.v) * (1 - Math.exp(-dt * 2));
      if (target - st.z < 0.5 && fv < 0.3) st.v *= Math.exp(-dt * 3);
      st.z += st.v * dt;
      const x = -(shoreX(st.z) + 7.5);
      coach.group.position.set(x, heightAt(x, st.z) + 0.03, st.z);
      coach.group.rotation.set(0, 0, 0);
      st.crank += dt * st.v * 1.25;
      coach.setMotion(st.v, 0, 90 + st.v * 12);
      coach.setRace(10, camera, Infinity);
      coach.setPose(0);
      coach.setSteer(0);
      coach.setCrank(st.crank);
      coach.spinWheels((st.v * dt) / 0.34);
    },
  });
  return coach;
}
