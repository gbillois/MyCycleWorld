// Kayak de slalom (3,5 m) et kayakiste détaillés : coque effilée aux pointes relevées, pont bombé (bosse des genoux),
// hiloire et jupe ; kayakiste « skinné » (un seul maillage avec sa pagaie double) qui enchaîne des coups de pagaie
// alternés gauche / droite au rythme des coups de rame : attaque devant les pieds, rotation du buste, sortie à la
// hanche, pale opposée en l'air. Gerbes à chaque attaque et sillage selon la vitesse.
// Interface proche du Boat de boat.js : constructor({ color, name, quality }), group, label, pose(phase, paddling),
// plus setOrientation(yaw, lean, pitch). Repère du kayak : +Z = proue, eau à y = 0, le kayakiste regarde vers +Z.
// Un cycle de phase (0..2π) = un coup à gauche puis un coup à droite : un coup de rameur = un cycle complet.
import * as THREE from 'three';
import { makeLabel } from './models.js';
import { splashTexture, splashGeometry, wakeTexture } from './boat.js';
import {
  Parts, PBR, sweep, keep, pbrLut, hash, shade, SKINS, B, BODY, ATLAS, bindPositions, bodyGeometry, bodyMaterial, makeBody,
  ik2, orient, defaultQuality, poseHeadGear, HairSwing,
} from './figure.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const AX = V(1, 0, 0);
const AY = V(0, 1, 0);
const AZ = V(0, 0, 1);

// --- Dimensions (m) ---
const HALF = 1.75; // demi-longueur de la coque
const SEAT_Y = -0.02;
const SEAT_Z = -0.24;
const COCKPIT_Z = -0.1;
const PADDLE = { y: 0.45, z: 0.36, grip: 0.32, blade: 0.9 }; // centre de liaison, mains, centre des pales
const ANKLE = [0.11, 0.07, 0.6];

const QS = {
  high: { ring: 18, len: 48, tube: 10, blade: [7, 5] },
  medium: { ring: 12, len: 32, tube: 8, blade: [5, 4] },
  low: { ring: 8, len: 20, tube: 6, blade: [4, 3] },
};

const cache = new Map();
function cached(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
// Fenêtre douce : 0 avant a, 1 entre b et c, 0 après d
const win = (t, a, b, c, d) => smooth(a, b, t) * (1 - smooth(c, d, t));

// Forme de la coque le long de z : demi-largeur, plat-bord (relevé aux pointes), creux sous le plat-bord, bombé du pont.
const beamAt = (z) => 0.315 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(z / HALF), 2.1)), 0.62);
const sheerAt = (z) => 0.07 + 0.07 * (z / HALF) ** 2;
const depthAt = (z) => 0.17 * Math.pow(Math.max(0, 1 - (z / HALF) ** 2), 0.55) + 0.008;
const crownAt = (z) => 0.05 + 0.15 * Math.exp(-(((z - 0.42) / 0.38) ** 2)) + 0.03 * Math.exp(-(((z + 0.8) / 0.45) ** 2));

// --- Coque (statique), couleurs dans les sommets ---
function hullGeometry(color, q) {
  return cached(`khull${color}${q}`, () => {
    const Q = QS[q];
    const parts = new Parts();
    const deckCol = new THREE.Color(color);
    const deckLight = new THREE.Color(shade(color, 0.35));
    const hullCol = new THREE.Color(shade(color, -0.35));
    const stripe = new THREE.Color('#15171c');
    const pos = [];
    const R = Q.ring;
    for (let i = 0; i <= Q.len; i++) {
      // Sections plus serrées aux pointes (là où la forme change vite)
      const t = i / Q.len;
      const z = -HALF + (0.5 - 0.5 * Math.cos(t * Math.PI)) * HALF * 2;
      const w = Math.max(0.0015, beamAt(z));
      const sh = sheerAt(z);
      const d = depthAt(z);
      const cr = crownAt(z) * Math.min(1, w / 0.12);
      for (let j = 0; j <= R; j++) {
        const th = (j / R) * Math.PI * 2;
        const c = Math.cos(th);
        pos.push(w * Math.sin(th), c >= 0 ? sh + cr * c : sh + d * c, z);
      }
    }
    const idx = [];
    for (let i = 0; i < Q.len; i++) {
      for (let j = 0; j < R; j++) {
        const a = i * (R + 1) + j;
        const b = a + R + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const shell = new THREE.BufferGeometry();
    shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    shell.setIndex(idx);
    shell.computeVertexNormals();
    parts.add(shell, {
      color: (c, x, y, z) => {
        const sh = sheerAt(z);
        if (y < sh - 0.022) c.copy(hullCol);
        else if (y < sh + 0.004) c.copy(stripe);
        else c.copy(Math.abs(x) < 0.035 && Math.abs(z) > 0.6 ? deckLight : deckCol);
      },
      pbr: PBR.paint,
    });
    // Hiloire du cockpit et jupe en néoprène, avec la cheminée autour de la taille
    const ringY = sheerAt(COCKPIT_Z) + crownAt(COCKPIT_Z) + 0.012;
    const coaming = new THREE.TorusGeometry(1, 0.06, 6, Q.ring + 6).rotateX(Math.PI / 2).scale(0.25, 0.35, 0.41).translate(0, ringY, COCKPIT_Z);
    parts.add(coaming, { color: '#22252b', pbr: PBR.plastic });
    const skirt = new THREE.CircleGeometry(1, Q.ring + 6).rotateX(-Math.PI / 2);
    const sp = skirt.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const r = Math.hypot(sp.getX(i), sp.getZ(i));
      sp.setY(i, 0.02 * (1 - r * r));
    }
    skirt.scale(0.25, 1, 0.41).translate(0, ringY + 0.004, COCKPIT_Z);
    skirt.computeVertexNormals();
    parts.add(skirt, { color: '#1b1e24', pbr: PBR.fabric });
    const tunnel = new THREE.CylinderGeometry(0.165, 0.2, 0.14, Q.ring, 1, true).scale(1, 1, 0.78).translate(0, ringY + 0.075, SEAT_Z + 0.03);
    parts.add(tunnel, { color: '#1b1e24', pbr: PBR.fabric });
    // Poignées de portage aux deux pointes
    for (const zz of [HALF - 0.14, -HALF + 0.14]) {
      parts.add(new THREE.TorusGeometry(0.03, 0.007, 4, 8).translate(0, sheerAt(zz) + 0.03, zz), { color: '#111316', pbr: PBR.rubber });
    }
    return keep(parts.build());
  });
}

function hullMaterial(q) {
  return cached('khullMat' + q, () => {
    const lut = pbrLut();
    const common = { vertexColors: true, roughness: 1, metalness: 1, roughnessMap: lut, metalnessMap: lut };
    return keep(q === 'high' ? new THREE.MeshPhysicalMaterial({ ...common, clearcoat: 1, clearcoatMap: lut, clearcoatRoughness: 0.1 }) : new THREE.MeshStandardMaterial(common));
  });
}

// --- Pagaie double : pièce du maillage du kayakiste, liée à l'os B.oarL (pose de liaison : tige le long de X) ---
function paddleExtras(parts, quality) {
  const Q = QS[quality];
  const rect = (r) => (x, y, z, u, v) => [r[0] + u * r[2], 1 - (r[1] + (1 - v) * r[3])];
  const { y: py, z: pz } = PADDLE;
  const shaft = sweep(new THREE.LineCurve3(V(-0.8, py, pz), V(0.8, py, pz)), { segs: 4, radial: Q.tube, radius: () => [0.016, 0.016], ref: UP, caps: true });
  parts.add(shaft, { uvFn: rect(ATLAS.oar), pbr: PBR.carbon, bone: B.oarL });
  const [nt, nv] = Q.blade;
  for (const s of [-1, 1]) {
    const p = [];
    const uvs = [];
    const id = [];
    for (const face of [1, -1]) {
      const base = p.length / 3;
      for (let i = 0; i <= nt; i++) {
        const t = i / nt;
        // Pale en cuillère : étroite au col, large et arrondie au bout
        const hh = 0.095 * Math.pow(Math.sin(Math.PI * (0.12 + 0.82 * t)), 0.55) * (0.75 + 0.25 * t) + 0.012;
        for (let j = 0; j <= nv; j++) {
          const f = j / nv;
          const y = lerp(-hh, hh, f);
          const cup = 0.016 * (1 - (2 * f - 1) ** 2) * smooth(0, 0.4, t);
          p.push(s * (0.74 + t * 0.36), py + y + 0.012 * t, pz - cup + face * 0.003);
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
    parts.add(blade, { uvFn: rect(ATLAS.blade), pbr: PBR.satin, bone: B.oarL });
  }
}

const PUDDLES = 6;
const tV = Array.from({ length: 14 }, () => new THREE.Vector3());
const tQ = Array.from({ length: 4 }, () => new THREE.Quaternion());
const tM = new THREE.Matrix4();
const tC = new THREE.Color();

export class Kayak {
  constructor({ color = '#ff5a1f', name = '', quality = defaultQuality() } = {}) {
    const q = QS[quality] ? quality : 'high';
    this.quality = q;
    // group : position seule (les gerbes y sont en coordonnées « monde ») ; boat : orientation du kayak.
    this.group = new THREE.Group();
    this.boat = new THREE.Group();
    this.boat.rotation.order = 'YXZ';
    this.group.add(this.boat);
    const seed = hash(`${name}|${color}|kayak`);

    this.hull = new THREE.Mesh(hullGeometry(color, q), hullMaterial(q));
    this.hull.castShadow = true;
    this.hull.receiveShadow = q !== 'low';
    this.boat.add(this.hull);

    const helmet = seed % 2 ? '#ffffff' : shade(color, 0.55);
    const binds = bindPositions([
      [B.oarL, [0, PADDLE.y, PADDLE.z]],
      [B.oarR, [0, PADDLE.y, PADDLE.z]],
      [B.seat, [0, SEAT_Y, SEAT_Z]],
    ]);
    // Visage découvert (pas de lunettes en eau vive), queue de cheval ou barbe
    this.pony = (seed >>> 5) % 3 === 0;
    const look = { beard: this.pony ? 0 : [0, 1, 2, 0, 3, 1][(seed >>> 9) % 6] };
    this.hairSwing = new HairSwing();
    const body = makeBody(
      bodyGeometry('kayaker', q, paddleExtras),
      bodyMaterial({ kind: 'kayaker', jersey: color, helmet, accent: helmet, skin: SKINS[seed % SKINS.length], number: 1, look }, q),
      binds,
    );
    this.body = body.mesh;
    this.body.boundingSphere = new THREE.Sphere(V(0, 0.4, 0), 1.9);
    this.bones = body.bones;
    this.boat.add(this.body);

    if (q !== 'low') {
      const mat = new THREE.MeshBasicMaterial({ map: splashTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      this.puddles = new THREE.InstancedMesh(splashGeometry(), mat, PUDDLES);
      this.puddles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.puddles.setColorAt(0, tC.setRGB(0, 0, 0));
      this.puddles.count = 0;
      this.puddles.frustumCulled = false;
      this.puddles.renderOrder = 1;
      this.group.add(this.puddles);
      this.puddleData = Array.from({ length: PUDDLES }, () => ({ x: 0, y: 0, z: 0, age: 99, life: 1, size: 0.4, bright: 1 }));
      this.nextPuddle = 0;
      this.wakeMat = new THREE.MeshBasicMaterial({ map: wakeTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
      const wakeGeo = cached('kwakeGeo', () => keep(new THREE.PlaneGeometry(2.4, 7.5).rotateX(-Math.PI / 2).translate(0, 0.012, -HALF - 3.4)));
      this.wake = new THREE.Mesh(wakeGeo, this.wakeMat);
      this.wake.renderOrder = 1;
      this.boat.add(this.wake);
    }

    if (name) {
      this.label = makeLabel(name, color);
      this.label.position.set(0, 1.55, 0);
      this.group.add(this.label);
    }
    this.prevPos = null;
    this.speed = 0;
    this._t = 0;
    this.prevBlade = [0, 0];
    this._blade = [V(0, 0, 0), V(0, 0, 0)];
    this.pose(0, 0);
  }

  // Arrivée : pagaie brandie au-dessus de la tête (podium), sinon pagaie posée et buste relâché.
  celebrate(place = 9) {
    this.cele = { t: 0, place };
  }

  // Cap (rad, autour de Y), gîte (+ = penché à droite) et tangage.
  setOrientation(yaw, lean = 0, pitch = 0) {
    this.boat.rotation.set(pitch, yaw, lean);
  }

  // phase : 0..2π (pagaie gauche dans l'eau quand sin > 0). paddling : 0 = au repos, pagaie posée sur le pont.
  // duck : 0..1, couché sur le pont pour passer sous la passerelle basse.
  pose(phase, paddling = 1, duck = 0) {
    const now = performance.now() / 1000;
    const dt = this._t ? Math.min(0.1, Math.max(0, now - this._t)) : 0;
    this._t = now;
    let upW = 0;
    let slump = 0;
    let cw = 0;
    if (this.cele && this.cele.t >= 0) {
      const c = (this.cele.t += dt);
      cw = win(c, 0, 0.7, 9, 11);
      if (this.cele.place <= 3) upW = win(c, 0.5, 1.2, this.cele.place === 1 ? 6 : 3.5, this.cele.place === 1 ? 7 : 4.3);
      else slump = win(c, 0.4, 1.2, 5, 7);
      if (c > 11) this.cele.t = -1;
    }
    const r = Math.max(0, Math.min(1, paddling)) * (1 - cw);
    const sn = Math.sin(phase);
    const cs = Math.cos(phase);
    // Côté actif : passe vite d'un bord à l'autre, reste franc pendant la propulsion.
    const side = Math.sign(sn) * Math.pow(Math.abs(sn), 0.45);
    const roll = 0.8 * side * r;
    const yaw = 0.6 * cs * r;
    const twist = yaw * 0.55;
    const lean = lerp(0.12, 0.2 + 0.08 * (1 - Math.abs(cs)), r) + 0.85 * duck - 0.15 * upW + 0.3 * slump;
    const bones = this.bones;

    // Bassin, buste (rotation vers la pale qui attaque, penché en avant), tête qui regarde devant
    const qP = tQ[0].setFromAxisAngle(AY, twist * 0.3).multiply(tQ[1].setFromAxisAngle(AX, lean * 0.5));
    const hipC = tV[0].set(0, SEAT_Y + 0.09, SEAT_Z);
    const pelvis = tV[1].set(0, -BODY.hip[1], 0).applyQuaternion(qP).add(hipC);
    bones[B.pelvis].position.copy(pelvis);
    bones[B.pelvis].quaternion.copy(qP);
    const qC = tQ[2].setFromAxisAngle(AY, twist).multiply(tQ[3].setFromAxisAngle(AX, lean));
    const chest = tV[2].set(0, BODY.chestY, 0).applyQuaternion(qP).add(pelvis);
    bones[B.chest].position.copy(chest);
    bones[B.chest].quaternion.copy(qC);
    const head = tV[3].set(0, BODY.headY - BODY.chestY, 0).applyQuaternion(qC).add(chest);
    bones[B.head].position.copy(head);
    bones[B.head].quaternion.setFromAxisAngle(AY, twist * 0.25).multiply(tQ[3].setFromAxisAngle(AX, -0.08 - 0.3 * upW + 0.35 * slump));
    this.hairSwing.step(dt, 0.08 + lean * 0.3, -roll * 0.4);
    poseHeadGear(bones, -1, this.pony, this.hairSwing.x, this.hairSwing.z);

    // Pagaie : centre devant la poitrine (il tourne avec le buste), plus haut entre deux coups ; posée au repos.
    const C = tV[4].set(0, 0.15 + 0.05 * (1 - Math.abs(side)), 0.4).applyAxisAngle(AY, twist).add(chest);
    C.x = lerp(0, C.x, r);
    C.y = lerp(sheerAt(0.2) + crownAt(0.2) + 0.03, C.y, r);
    C.z = lerp(0.18, C.z, r);
    C.y -= 0.08 * duck;
    if (upW > 0.001) C.lerp(tV[13].set(0, 0.76 + 0.05 * Math.sin(this.cele.t * 6), 0.13).add(chest), upW);
    const oar = bones[B.oarL];
    oar.position.copy(C);
    oar.quaternion.setFromAxisAngle(AY, -yaw).multiply(tQ[1].setFromAxisAngle(AZ, -roll));
    const dL = tV[5].set(Math.cos(roll) * Math.cos(yaw), -Math.sin(roll), Math.cos(roll) * Math.sin(yaw));
    bones[B.oarR].position.copy(C);
    bones[B.seat].position.set(0, SEAT_Y, SEAT_Z);

    // Bras : épaule -> poignet, la main serre la tige
    for (let i = 0; i < 2; i++) {
      const s = i ? -1 : 1; // 1 = gauche (+X)
      const [bu, bf, bh] = s > 0 ? [B.upperL, B.foreL, B.handL] : [B.upperR, B.foreR, B.handR];
      const grip = tV[6].copy(C).addScaledVector(dL, s * PADDLE.grip);
      const shoulder = tV[7].set(s * BODY.shoulder[0], BODY.shoulder[1] - BODY.chestY, 0).applyQuaternion(qC).add(chest);
      // Poignet un peu sous la tige, du côté du kayakiste
      const toShoulder = tV[8].subVectors(shoulder, grip).normalize();
      const wrist = tV[9].copy(grip).addScaledVector(toShoulder, 0.07).add(tV[10].set(0, -0.025, 0));
      const pole = tV[10].set(s * 0.75, -0.65, -0.15);
      const elbow = ik2(shoulder, wrist, BODY.upper, BODY.fore, pole, tV[11], tV[12]);
      orient(bones[bu], shoulder, tV[13].subVectors(shoulder, elbow), tV[10].subVectors(tV[12], elbow));
      orient(bones[bf], elbow, tV[13].subVectors(elbow, tV[12]), tV[10].set(-s * 0.4, 1, 0));
      // Main : doigts par-dessus la tige, pouce vers le centre de la pagaie
      orient(bones[bh], tV[12], tV[13].subVectors(tV[12], grip).add(tV[10].set(0, 0.04, 0)), tV[10].copy(dL).multiplyScalar(-s));
      // Centre de la pale (repère du kayak), pour les gerbes
      this._blade[i].copy(C).addScaledVector(dL, s * PADDLE.blade);
    }

    // Jambes : allongées sous le pont, genoux un peu relevés, pieds contre le cale-pieds
    for (let i = 0; i < 2; i++) {
      const s = i ? -1 : 1;
      const [bt, bk, bfoot] = s > 0 ? [B.thighL, B.shinL, B.footL] : [B.thighR, B.shinR, B.footR];
      const hipJ = tV[6].set(s * BODY.hip[0], BODY.hip[1], 0).applyQuaternion(qP).add(pelvis);
      const ankle = tV[7].set(s * ANKLE[0], ANKLE[1], ANKLE[2]);
      const knee = ik2(hipJ, ankle, BODY.thigh, BODY.shin, tV[8].set(s * 0.3, 1, 0.1), tV[9], tV[10]);
      orient(bones[bt], hipJ, tV[11].subVectors(hipJ, knee), tV[13].set(0, 1, 0.2));
      orient(bones[bk], knee, tV[11].subVectors(knee, tV[10]), tV[13].set(0, 0.4, 1));
      bones[bfoot].position.copy(tV[10]);
      bones[bfoot].quaternion.setFromAxisAngle(AX, -1.1);
    }

    this.effects(r, dt);
  }

  // Gerbes quand une pale entre dans l'eau, sillage selon la vitesse estimée.
  effects(r, dt) {
    if (!this.puddles) return;
    const gp = this.group.position;
    if (this.prevPos && dt > 0) {
      const v = Math.hypot(gp.x - this.prevPos.x, gp.z - this.prevPos.z) / dt;
      this.speed += (Math.min(9, v) - this.speed) * (1 - Math.exp(-dt * 2));
    }
    this.prevPos = this.prevPos || V(0, 0, 0);
    this.prevPos.copy(gp);
    this.wakeMat.opacity = Math.min(0.32, this.speed / 14);
    const qb = this.boat.quaternion;
    for (let i = 0; i < 2; i++) {
      const y = this._blade[i].y;
      if (r > 0.5 && this.prevBlade[i] > 0.02 && y <= 0.02) {
        const w = tV[0].copy(this._blade[i]).applyQuaternion(qb);
        this.spawn(gp.x + w.x, gp.z + w.z, 0.5, 1.4, 0.95);
      }
      this.prevBlade[i] = y;
    }
    let n = 0;
    for (const p of this.puddleData) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const k = p.age / p.life;
      const size = p.size * (0.5 + 1.1 * k);
      tM.makeScale(size, 1, size).setPosition(p.x - gp.x, 0.01 + p.y - gp.y, p.z - gp.z);
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

  spawn(x, z, size, life, bright) {
    const p = this.puddleData[this.nextPuddle];
    this.nextPuddle = (this.nextPuddle + 1) % PUDDLES;
    p.x = x;
    p.y = this.group.position.y;
    p.z = z;
    p.age = 0;
    p.life = life;
    p.size = size;
    p.bright = bright;
  }
}
