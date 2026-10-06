// Skiff (yole de mer olympique en solo) et rameur détaillés : coque effilée avec pont, cockpit, portant en aile,
// coulisse et barre de pieds ; rameur « skinné » (un seul maillage avec ses avirons et son siège) qui enchaîne
// un vrai coup d'aviron : attaque, poussée des jambes puis du dos puis des bras, dégagé, plumage des pelles,
// retour sur la coulisse. Flaques des pelles et sillage à l'arrière.
// Même interface que l'ancien Boat de rowing-scene.js : constructor({ color, name }), group, label, pose(phase, rowing).
// Repère du bateau : +Z = proue (sens de la course), eau à y = 0. Le rameur regarde vers la poupe (-Z).
import * as THREE from 'three';
import { makeLabel } from './models.js';
import {
  Parts, PBR, sweep, keep, pbrLut, hash, shade, SKINS, B, BODY, ATLAS, bindPositions, bodyGeometry, bodyMaterial, makeBody,
  ik2, orient, defaultQuality,
} from './figure.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const AX = V(1, 0, 0);
const AZ = V(0, 0, 1);

// --- Dimensions (m) ---
const HALF_LEN = 4.0;
const PIN_X = 0.8; // demi-envergure des portants
const PIN_Y = 0.36;
const INBOARD = 0.88;
const BLADE_R = 1.75; // de la dame de nage au centre de la pelle
const SEAT_Y = 0.2;
const SEAT_CATCH = -0.07; // position du siège (repère du rameur, +Z = vers ses pieds)
const SEAT_FINISH = -0.56;
const ANKLE = [0.1, 0.12, 0.3];
const COCKPIT = [-0.95, 0.95];

const QS = {
  high: { ring: 14, len: 56, tube: 10, blade: [8, 6] },
  medium: { ring: 10, len: 36, tube: 8, blade: [6, 4] },
  low: { ring: 7, len: 20, tube: 6, blade: [4, 3] },
};

const cache = new Map();
function cached(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}
const CR = (pts) => new THREE.CatmullRomCurve3(pts, false, 'centripetal');
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// Demi-largeur et hauteur du plat-bord le long de la coque
const beam = (z) => 0.148 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(z / HALF_LEN), 2.3)), 0.6);
const gunwale = (z) => 0.055 + 0.03 * (1 - (z / HALF_LEN) ** 2);
const depth = (z) => 0.13 * Math.pow(Math.max(0, 1 - (z / HALF_LEN) ** 2), 0.5) + 0.004;

// --- Coque (statique), couleurs dans les sommets ---
function hullGeometry(color, q) {
  return cached(`hull${color}${q}`, () => {
    const Q = QS[q];
    const parts = new Parts();
    const deckCol = new THREE.Color(color);
    const hullWhite = new THREE.Color('#f3f3ef');
    // Coque : sections en U du plat-bord bâbord au plat-bord tribord
    const pos = [];
    const nor = [];
    const uv = [];
    const idx = [];
    const R = Q.ring;
    for (let i = 0; i <= Q.len; i++) {
      const t = i / Q.len;
      const z = -HALF_LEN + t * HALF_LEN * 2;
      const w = Math.max(0.002, beam(z));
      const g = gunwale(z);
      const d = depth(z);
      for (let j = 0; j <= R; j++) {
        const th = -Math.PI / 2 + (j / R) * Math.PI;
        pos.push(w * Math.sin(th), g - d * Math.cos(th), z);
        const nx = Math.sin(th) / w;
        const ny = -Math.cos(th) / d;
        const l = Math.hypot(nx, ny);
        nor.push(nx / l, ny / l, 0);
        uv.push(t, j / R);
      }
    }
    for (let i = 0; i < Q.len; i++) {
      for (let j = 0; j < R; j++) {
        const a = i * (R + 1) + j;
        const b = a + R + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const shell = new THREE.BufferGeometry();
    shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    shell.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    shell.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    shell.setIndex(idx);
    shell.computeVertexNormals();
    parts.add(shell, {
      color: (c, x, y, z) => {
        // liseré de couleur sous le plat-bord
        const g = gunwale(z);
        c.copy(y > g - 0.022 && y < g - 0.01 ? deckCol : hullWhite);
      },
      pbr: PBR.paint,
    });
    // Pont bombé (hors cockpit), couleur d'équipe avec un trait blanc au centre
    for (const [z0, z1] of [[-HALF_LEN, COCKPIT[0]], [COCKPIT[1], HALF_LEN]]) {
      const n = Math.max(4, Math.round((Q.len * (z1 - z0)) / (HALF_LEN * 2)));
      const p2 = [];
      const i2 = [];
      const cols = 6;
      for (let i = 0; i <= n; i++) {
        const z = z0 + ((z1 - z0) * i) / n;
        const w = beam(z);
        const g = gunwale(z);
        for (let j = 0; j <= cols; j++) {
          const f = -1 + (2 * j) / cols;
          p2.push(f * w, g + 0.012 * (1 - f * f) * Math.min(1, w / 0.05), z);
        }
      }
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < cols; j++) {
          const a = i * (cols + 1) + j;
          const b = a + cols + 1;
          i2.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      const deck = new THREE.BufferGeometry();
      deck.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3));
      deck.setIndex(i2);
      deck.computeVertexNormals();
      parts.add(deck, { color: (c, x, y, z) => c.copy(Math.abs(x) < 0.006 ? hullWhite : deckCol), pbr: PBR.paint });
    }
    // Cockpit : plancher sombre, hiloires
    const cw = beam(0) - 0.01;
    parts.add(new THREE.BoxGeometry(cw * 2, 0.01, COCKPIT[1] - COCKPIT[0]).translate(0, 0.045, 0), { color: '#2b2d33', pbr: PBR.carbon });
    for (const s of [-1, 1]) {
      parts.add(new THREE.BoxGeometry(0.008, 0.03, COCKPIT[1] - COCKPIT[0]).translate(s * (cw - 0.004), gunwale(0) + 0.008, 0), { color: shade(color, -0.3), pbr: PBR.paint });
    }
    for (const z of COCKPIT) parts.add(new THREE.BoxGeometry(cw * 2, 0.035, 0.008).translate(0, gunwale(z) + 0.01, z), { color: shade(color, -0.3), pbr: PBR.paint });
    // Boule de proue
    parts.add(new THREE.SphereGeometry(0.035, 10, 8).translate(0, gunwale(HALF_LEN) + 0.01, HALF_LEN - 0.02), { color: '#f7f7f5', pbr: PBR.rubber });
    // Coulisse : deux rails (repère du bateau : z = -siège)
    for (const s of [-1, 1]) {
      parts.add(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 6).rotateX(Math.PI / 2).translate(s * 0.085, 0.14, 0.3), { color: '#b9bdc4', pbr: PBR.chrome });
      parts.add(new THREE.BoxGeometry(0.02, 0.09, 0.02).translate(s * 0.085, 0.095, -0.13), { color: '#3a3c42', pbr: PBR.alu });
      parts.add(new THREE.BoxGeometry(0.02, 0.09, 0.02).translate(s * 0.085, 0.095, 0.73), { color: '#3a3c42', pbr: PBR.alu });
    }
    // Barre de pieds inclinée (sous les chaussures)
    parts.add(new THREE.BoxGeometry(0.3, 0.32, 0.012).rotateX(0.75).translate(0, 0.17, -ANKLE[2] - 0.12), { color: '#33353b', pbr: PBR.alu });
    // Portant en aile (derrière le rameur, côté proue) et bras avant vers la coque
    const pinB = (s) => V(s * PIN_X, PIN_Y - 0.03, 0);
    const wing = CR([pinB(-1), V(-0.55, 0.3, 0.28), V(0, 0.255, 0.46), V(0.55, 0.3, 0.28), pinB(1)]);
    parts.add(sweep(wing, { segs: Q.len / 2, radial: Q.tube, radius: (t) => [0.014, 0.034 - 0.014 * Math.abs(t - 0.5)], ref: UP }), { color: '#1d1e23', pbr: PBR.carbon });
    for (const s of [-1, 1]) {
      parts.add(sweep(CR([pinB(s), V(s * 0.4, 0.2, -0.18), V(s * 0.13, 0.085, -0.34)]), { segs: 8, radial: Q.tube, radius: () => [0.011, 0.011], ref: UP }), { color: '#1d1e23', pbr: PBR.carbon });
      parts.add(sweep(CR([V(s * 0.6, 0.29, 0.2), V(s * 0.3, 0.12, 0.3), V(s * 0.13, 0.075, 0.33)]), { segs: 6, radial: Q.tube, radius: () => [0.01, 0.01], ref: UP }), { color: '#1d1e23', pbr: PBR.carbon });
      // Dame de nage : axe vertical et portière
      parts.add(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 8).translate(s * PIN_X, PIN_Y - 0.02, 0), { color: '#c3c7ce', pbr: PBR.chrome });
      parts.add(new THREE.BoxGeometry(0.05, 0.06, 0.04).translate(s * PIN_X, PIN_Y + 0.01, 0), { color: '#202126', pbr: PBR.plastic });
    }
    return keep(parts.build());
  });
}

// Matériau partagé de la coque (couleurs dans les sommets + table PBR)
function hullMaterial(q) {
  return cached('hullMat' + q, () => {
    const lut = pbrLut();
    const common = { vertexColors: true, roughness: 1, metalness: 1, roughnessMap: lut, metalnessMap: lut };
    return keep(q === 'high' ? new THREE.MeshPhysicalMaterial({ ...common, clearcoat: 1, clearcoatMap: lut, clearcoatRoughness: 0.08 }) : new THREE.MeshStandardMaterial(common));
  });
}

// --- Avirons et siège : pièces du maillage du rameur (repère du rameur : il regarde vers +Z) ---
function rowerExtras(parts, quality) {
  const Q = QS[quality];
  const rect = (r, u0, u1) => (x, y, z, u, v) => [r[0] + (u0 + (u1 - u0) * u) * r[2], 1 - (r[1] + (1 - v) * r[3])];
  for (const [s, bone] of [[1, B.oarL], [-1, B.oarR]]) {
    const pin = V(s * PIN_X, PIN_Y, 0);
    const at = (x) => V(pin.x + s * x, pin.y, 0);
    // Poignée, manche carbone, manchon et collier, puis pelle « hachoir »
    const shaft = sweep(new THREE.LineCurve3(at(-INBOARD), at(BLADE_R - 0.22)), { segs: 6, radial: Q.tube, radius: (t) => {
      const x = -INBOARD + t * (BLADE_R - 0.22 + INBOARD);
      const r = x < -INBOARD + 0.13 ? 0.018 : x > -0.1 && x < 0.16 ? 0.023 : 0.019 - 0.005 * Math.max(0, x / 1.6);
      return [r, r];
    }, ref: UP, caps: true });
    parts.add(shaft, { uvFn: rect(ATLAS.oar, 0, 1), pbr: PBR.carbon, bone });
    parts.add(new THREE.CylinderGeometry(0.034, 0.034, 0.018, 12).rotateZ(Math.PI / 2).translate(pin.x + s * 0.035, pin.y, 0), { uvFn: () => [ATLAS.metal[0] + 0.05, 1 - ATLAS.metal[1] - 0.05], pbr: PBR.plastic, bone });
    // Pelle : surface double face, plus large sous le manche, légèrement creusée côté poupe
    const [nt, nv] = Q.blade;
    const p = [];
    const uvs = [];
    const id = [];
    for (const face of [1, -1]) {
      const base = p.length / 3;
      for (let i = 0; i <= nt; i++) {
        const t = i / nt;
        const top = 0.016 + 0.07 * smooth(0, 0.85, t) * (t > 0.9 ? 1 - (t - 0.9) * 3 : 1);
        const bot = -0.016 - 0.14 * Math.pow(smooth(0, 0.9, t), 0.8) * (t > 0.92 ? 1 - (t - 0.92) * 3 : 1);
        for (let j = 0; j <= nv; j++) {
          const f = j / nv;
          const y = lerp(bot, top, f);
          const mid = (top + bot) / 2;
          const half = Math.max(0.001, (top - bot) / 2);
          const cup = 0.018 * (1 - ((y - mid) / half) ** 2) * smooth(0, 0.3, t);
          p.push(pin.x + s * (BLADE_R - 0.24 + t * 0.47), pin.y + y, -cup + face * 0.004);
          uvs.push(t, f);
        }
      }
      for (let i = 0; i < nt; i++) {
        for (let j = 0; j < nv; j++) {
          const a = base + i * (nv + 1) + j;
          const b = a + nv + 1;
          if (face * s > 0) id.push(a, b, a + 1, b, b + 1, a + 1);
          else id.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
    }
    const blade = new THREE.BufferGeometry();
    blade.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    blade.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    blade.setIndex(id);
    blade.computeVertexNormals();
    parts.add(blade, { uvFn: rect(ATLAS.blade, 0, 1), pbr: PBR.satin, bone });
  }
  // Siège coulissant et ses roulettes
  const seat = new THREE.BoxGeometry(0.25, 0.03, 0.27, 1, 1, 1).translate(0, SEAT_Y - 0.015, 0);
  parts.add(seat, { uvFn: () => [ATLAS.seat[0] + 0.05, 1 - ATLAS.seat[1] - 0.05], pbr: PBR.plastic, bone: B.seat });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.add(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 8).rotateZ(Math.PI / 2).translate(sx * 0.085, SEAT_Y - 0.045, sz * 0.08), { uvFn: () => [ATLAS.dark[0] + 0.05, 1 - ATLAS.dark[1] - 0.05], pbr: PBR.plastic, bone: B.seat });
    }
  }
}

// --- Flaques des pelles et sillage (textures partagées) ---
function puddleTexture() {
  return cached('puddleTex', () => {
    const S = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.25)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.78, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.9, 'rgba(255,255,255,0.15)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return keep(new THREE.CanvasTexture(cv));
  });
}
function wakeTexture() {
  return cached('wakeTex', () => {
    const W = 128;
    const H = 256;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    // Deux traînées divergentes depuis la poupe (haut du canvas) et un léger remous au centre
    for (let y = 0; y < H; y++) {
      const t = y / H;
      const fade = (1 - t) ** 1.5;
      const spread = 0.12 + t * 0.36;
      for (const side of [-1, 1]) {
        const cx = W / 2 + side * spread * W;
        const g = ctx.createLinearGradient(cx - 10, 0, cx + 10, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, `rgba(255,255,255,${0.55 * fade})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - 10, y, 20, 1);
      }
      ctx.fillStyle = `rgba(255,255,255,${0.18 * fade * (0.6 + 0.4 * Math.sin(y * 0.4))})`;
      ctx.fillRect(W / 2 - 6, y, 12, 1);
    }
    return keep(new THREE.CanvasTexture(cv));
  });
}

const PUDDLES = 8;
const tV = Array.from({ length: 12 }, () => new THREE.Vector3());
const tQ = Array.from({ length: 4 }, () => new THREE.Quaternion());
const tM = new THREE.Matrix4();
const tC = new THREE.Color();

export class Boat {
  constructor({ color = '#ff5a1f', name = '', quality = defaultQuality() } = {}) {
    const q = QS[quality] ? quality : 'high';
    this.quality = q;
    this.group = new THREE.Group();
    const seed = hash(`${name}|${color}`);

    this.hull = new THREE.Mesh(hullGeometry(color, q), hullMaterial(q));
    this.hull.castShadow = true;
    this.hull.receiveShadow = q !== 'low';
    this.group.add(this.hull);

    // Rameur, avirons et siège : un maillage « skinné », dans un repère retourné (il regarde vers la poupe)
    this.frame = new THREE.Group();
    this.frame.rotation.y = Math.PI;
    this.group.add(this.frame);
    const accent = shade(color, 0.55);
    const helmet = seed % 2 ? '#ffffff' : accent;
    const binds = bindPositions([
      [B.oarL, [PIN_X, PIN_Y, 0]],
      [B.oarR, [-PIN_X, PIN_Y, 0]],
      [B.seat, [0, SEAT_Y, 0]],
    ]);
    const body = makeBody(
      bodyGeometry('rower', q, rowerExtras),
      bodyMaterial({ kind: 'rower', jersey: color, helmet, accent: helmet, skin: SKINS[seed % SKINS.length], number: 1 }, q),
      binds,
    );
    this.body = body.mesh;
    this.body.boundingSphere = new THREE.Sphere(V(0, 0.5, 0), 3.2);
    this.bones = body.bones;
    this.frame.add(this.body);

    // Flaques laissées par les pelles (coordonnées « monde » du bassin, dérivent avec le bateau qui avance)
    if (q !== 'low') {
      const mat = new THREE.MeshBasicMaterial({ map: puddleTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      this.puddles = new THREE.InstancedMesh(keep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), mat, PUDDLES);
      this.puddles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.puddles.setColorAt(0, tC.setRGB(0, 0, 0));
      this.puddles.count = 0;
      this.puddles.frustumCulled = false;
      this.puddles.renderOrder = 1;
      this.group.add(this.puddles);
      this.puddleData = Array.from({ length: PUDDLES }, () => ({ x: 0, z: 0, age: 99, life: 1, size: 0.4, bright: 1 }));
      this.nextPuddle = 0;
      // Sillage : quad additif derrière la poupe, intensité selon la vitesse
      this.wakeMat = new THREE.MeshBasicMaterial({ map: wakeTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
      const wakeGeo = cached('wakeGeo', () => keep(new THREE.PlaneGeometry(3.2, 11).rotateX(-Math.PI / 2).translate(0, 0.008, -HALF_LEN - 5.3)));
      this.wake = new THREE.Mesh(wakeGeo, this.wakeMat);
      this.wake.renderOrder = 1;
      this.group.add(this.wake);
    }

    if (name) {
      this.label = makeLabel(name, color);
      this.label.position.set(0, 1.7, 0);
      this.group.add(this.label);
    }
    this.prevPhase = null;
    this.prevPos = null;
    this.speed = 0;
    this._t = 0;
    this.pose(Math.PI * 1.5, 0);
  }

  // phase : 0..2π, coup d'aviron (propulsion pendant sin > 0). rowing : 0 = au repos.
  pose(phase, rowing = 1) {
    const now = performance.now() / 1000;
    const dt = this._t ? Math.min(0.1, Math.max(0, now - this._t)) : 0;
    this._t = now;
    const TWO_PI = Math.PI * 2;
    const ph = ((phase % TWO_PI) + TWO_PI) % TWO_PI;
    const drive = ph < Math.PI;
    const u = drive ? ph / Math.PI : (ph - Math.PI) / Math.PI;

    // Paramètres du coup : coulisse (0 = attaque, 1 = dégagé), buste, bras, hauteur et plumage des pelles
    let legs;
    let back;
    let arms;
    let bladeY;
    let feather;
    if (drive) {
      legs = smooth(0, 0.62, u);
      back = smooth(0.22, 0.82, u);
      arms = smooth(0.55, 1, u);
      bladeY = lerp(0.06, -0.055, smooth(0, 0.1, u)) + 0.15 * smooth(0.9, 1, u);
      feather = 0;
    } else {
      arms = 1 - smooth(0, 0.28, u);
      back = 1 - smooth(0.1, 0.42, u);
      legs = 1 - smooth(0.32, 1, u) * 0.98 - 0.02 * smooth(0.9, 1, u);
      bladeY = 0.12 - 0.06 * smooth(0.8, 1, u);
      feather = smooth(0, 0.1, u) * (1 - smooth(0.7, 0.92, u));
    }
    // Au repos : assis jambes tendues, bras le long, pelles posées à plat sur l'eau
    const r = Math.max(0, Math.min(1, rowing));
    legs = lerp(0.85, legs, r);
    back = lerp(0.55, back, r);
    arms = lerp(0.35, arms, r);
    bladeY = lerp(0.02, bladeY, r);
    feather = lerp(1, feather, r);

    const seatZ = lerp(SEAT_CATCH, SEAT_FINISH, legs);
    const lean = lerp(0.52, -0.36, back);
    const reach = lerp(0.52, 0.2, arms);
    const bones = this.bones;
    bones[B.seat].position.set(0, SEAT_Y, seatZ - 0.02);

    // Bassin sur le siège, buste penché (vers +Z = vers les pieds à l'attaque)
    const qP = tQ[0].setFromAxisAngle(AX, lean * 0.75 + 0.05);
    const qC = tQ[1].setFromAxisAngle(AX, lean);
    const hipC = tV[0].set(0, SEAT_Y + 0.09, seatZ);
    const pelvis = tV[1].set(0, -BODY.hip[1], 0).applyQuaternion(qP).add(hipC);
    bones[B.pelvis].position.copy(pelvis);
    bones[B.pelvis].quaternion.copy(qP);
    const chest = tV[2].set(0, BODY.chestY, 0).applyQuaternion(qP).add(pelvis);
    bones[B.chest].position.copy(chest);
    bones[B.chest].quaternion.copy(qC);
    const breathe = Math.sin(ph) * 0.5 * r;
    bones[B.chest].scale.set(1 + breathe * 0.015, 1, 1 + breathe * 0.025);
    const head = tV[3].set(0, BODY.headY - BODY.chestY, 0).applyQuaternion(qC).add(chest);
    bones[B.head].position.copy(head);
    bones[B.head].quaternion.setFromAxisAngle(AX, lean * 0.35 + 0.05);

    // Avirons : la poignée suit les mains (portée horizontale devant les épaules)
    const shoulderZ = chest.z + Math.sin(lean) * (BODY.shoulder[1] - BODY.chestY);
    const beta = Math.asin(Math.min(0.9, Math.max(-0.2, (PIN_Y - bladeY) / BLADE_R)));
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      const b = beta + s * 0.012; // main gauche un peu plus haute (croisement des poignées)
      const handZ = shoulderZ + reach;
      const theta = Math.asin(Math.min(0.98, Math.max(-0.98, handZ / (INBOARD * Math.cos(b)))));
      const oar = bones[s > 0 ? B.oarL : B.oarR];
      const qo = oar.quaternion.setFromAxisAngle(UP, s * theta);
      qo.multiply(tQ[2].setFromAxisAngle(AZ, -s * b)).multiply(tQ[3].setFromAxisAngle(AX, -feather * Math.PI * 0.5));
      oar.position.set(s * PIN_X, PIN_Y, 0);
      // Poignée (bout intérieur de l'aviron) dans le repère du rameur
      const handle = tV[4].set(-s * (INBOARD - 0.06), 0, 0).applyQuaternion(tQ[2].setFromAxisAngle(UP, s * theta).multiply(tQ[3].setFromAxisAngle(AZ, -s * b))).add(oar.position);
      // Bras : épaule -> poignet (juste derrière la poignée)
      const [bu, bf, bh] = s > 0 ? [B.upperL, B.foreL, B.handL] : [B.upperR, B.foreR, B.handR];
      const shoulder = tV[5].set(s * BODY.shoulder[0], BODY.shoulder[1] - BODY.chestY, 0).applyQuaternion(qC).add(chest);
      const handDir = tV[6].set(0, -0.55, 0.84);
      const wrist = tV[7].copy(handle).addScaledVector(handDir, -0.06).add(tV[8].set(0, 0.012, 0));
      const pole = tV[8].set(s * 0.9, -0.55, -0.4);
      const elbow = ik2(shoulder, wrist, BODY.upper, BODY.fore, pole, tV[9], tV[10]);
      orient(bones[bu], shoulder, tV[11].subVectors(shoulder, elbow), tV[6].subVectors(tV[10], elbow));
      orient(bones[bf], elbow, tV[11].subVectors(elbow, tV[10]), tV[6].set(-s * 0.4, 1, 0));
      orient(bones[bh], tV[10], tV[11].set(0, 0.55, -0.84), tV[6].set(-s, 0.2, 0.3));
      if (i === 0) this._blade = this._blade || [V(0, 0, 0), V(0, 0, 0)];
      // Centre de la pelle (pour les flaques)
      this._blade[i].set(s * BLADE_R, 0, 0).applyQuaternion(tQ[2].setFromAxisAngle(UP, s * theta).multiply(tQ[3].setFromAxisAngle(AZ, -s * b))).add(oar.position);
    }

    // Jambes : hanche -> cheville fixée sur la barre de pieds (genoux vers le haut)
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      const [bt, bk, bf] = s > 0 ? [B.thighL, B.shinL, B.footL] : [B.thighR, B.shinR, B.footR];
      const hipJ = tV[4].set(s * BODY.hip[0], BODY.hip[1], 0).applyQuaternion(qP).add(pelvis);
      const ankle = tV[5].set(s * ANKLE[0], ANKLE[1], ANKLE[2]);
      const pole = tV[6].set(s * 0.25, 1, 0.2);
      const knee = ik2(hipJ, ankle, BODY.thigh, BODY.shin, pole, tV[7], tV[8]);
      orient(bones[bt], hipJ, tV[9].subVectors(hipJ, knee), tV[10].set(0, 1, 0.1));
      orient(bones[bk], knee, tV[9].subVectors(knee, tV[8]), tV[10].set(0, 0.3, 1));
      bones[bf].position.copy(ankle);
      bones[bf].quaternion.setFromAxisAngle(AX, -0.75);
    }

    this.effects(ph, r, dt);
    this.prevPhase = ph;
  }

  // Flaques à l'attaque et au dégagé, sillage selon la vitesse estimée
  effects(ph, r, dt) {
    if (!this.puddles) return;
    const gp = this.group.position;
    if (this.prevPos && dt > 0) {
      const v = Math.hypot(gp.x - this.prevPos.x, gp.z - this.prevPos.z) / dt;
      this.speed += (Math.min(8, v) - this.speed) * (1 - Math.exp(-dt * 2));
    }
    this.prevPos = this.prevPos || V(0, 0, 0);
    this.prevPos.copy(gp);
    this.wakeMat.opacity = Math.min(0.55, this.speed / 8);
    if (this.prevPhase !== null && r > 0.5) {
      const p0 = this.prevPhase;
      // attaque (la phase repasse par 0) : petite gerbe ; dégagé : flaque qui s'élargit
      if (p0 > ph + 1 || (p0 < 0.02 && ph >= 0.02)) this.spawn(0.28, 0.8, 0.9);
      if (p0 < Math.PI * 0.97 && ph >= Math.PI * 0.97) this.spawn(0.42, 2.6, 0.7);
    }
    let n = 0;
    for (const p of this.puddleData) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const k = p.age / p.life;
      const size = p.size * (0.6 + 0.8 * k);
      tM.makeScale(size, 1, size).setPosition(p.x - gp.x, 0.006, p.z - gp.z);
      this.puddles.setMatrixAt(n, tM);
      const a = p.bright * (1 - k) * (1 - k);
      this.puddles.setColorAt(n, tC.setRGB(a, a, a));
      n++;
    }
    this.puddles.count = n;
    if (n) {
      this.puddles.instanceMatrix.needsUpdate = true;
      this.puddles.instanceColor.needsUpdate = true;
    }
  }

  spawn(size, life, bright) {
    const gp = this.group.position;
    for (const b of this._blade) {
      const p = this.puddleData[this.nextPuddle];
      this.nextPuddle = (this.nextPuddle + 1) % PUDDLES;
      // repère du rameur retourné (rotation de π autour de Y) -> repère du bateau
      p.x = gp.x - b.x;
      p.z = gp.z - b.z;
      p.age = 0;
      p.life = life;
      p.size = size;
      p.bright = bright;
    }
  }
}
