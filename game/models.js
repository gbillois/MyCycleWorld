// Modèles low-poly : cycliste sur son vélo (jambes animées), boîte à objets, peau de banane.
// Repère local d'un coureur : +Z = vers l'avant, +Y = vers le haut.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const unitTube = new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const crankFrom = new THREE.Vector3();
const crankTo = new THREE.Vector3();

// Cylindre unitaire qu'on étire entre deux points.
function tube(radius, material) {
  const m = new THREE.Mesh(unitTube, material);
  m.userData.radius = radius;
  return m;
}

function placeTube(mesh, a, b) {
  tmpA.subVectors(b, a);
  const len = tmpA.length() || 1e-3;
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(UP, tmpA.divideScalar(len));
  const r = mesh.userData.radius;
  mesh.scale.set(r, len, r);
}

const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const SHARED = {
  tyre: lambert('#1b1c20'),
  metal: lambert('#c9ccd3'),
  skin: lambert('#e2b48f'),
  shorts: lambert('#1d1f26'),
  shoe: lambert('#f2f2f2'),
};

// Géométrie du vélo (m).
const BB = new THREE.Vector3(0, 0.3, -0.05); // boîtier de pédalier
const CRANK = 0.17;
const THIGH = 0.45;
const SHIN = 0.47;

export class RiderModel {
  constructor({ jersey = '#ff5a1f', bike = '#2b6cff', helmet = '#ffffff', name = '' } = {}) {
    const g = new THREE.Group();
    this.group = g;
    const frameMat = lambert(bike);
    const jerseyMat = lambert(jersey);

    // Roues
    const wheelGeo = new THREE.TorusGeometry(0.33, 0.03, 5, 18).rotateY(Math.PI / 2);
    this.wheels = [-0.5, 0.52].map((z) => {
      const w = new THREE.Mesh(wheelGeo, SHARED.tyre);
      w.position.set(0, 0.34, z);
      const spokes = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.01, 6).rotateZ(Math.PI / 2), SHARED.metal);
      w.add(spokes);
      g.add(w);
      return w;
    });

    // Cadre
    const P = (x, y, z) => new THREE.Vector3(x, y, z);
    const seat = P(0, 0.92, -0.24);
    const head = P(0, 0.86, 0.36);
    const bar = P(0, 0.98, 0.44);
    const rear = P(0, 0.34, -0.5);
    const front = P(0, 0.34, 0.52);
    for (const [a, b, r] of [
      [BB, seat, 0.025], [BB, head, 0.028], [seat, head, 0.024], [BB, rear, 0.018],
      [seat, rear, 0.016], [head, front, 0.02], [head, bar, 0.02],
    ]) {
      const t = tube(r, frameMat);
      placeTube(t, a, b);
      g.add(t);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.05), SHARED.tyre);
    handle.position.copy(bar);
    g.add(handle);
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.24), SHARED.tyre);
    saddle.position.set(0, 0.95, -0.24);
    g.add(saddle);

    // Corps : bassin, buste penché, tête et casque, bras.
    this.hip = P(0, 1.0, -0.22);
    const shoulder = P(0, 1.33, 0.2);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 1), jerseyMat);
    tmpB.subVectors(shoulder, this.hip);
    torso.scale.z = tmpB.length() + 0.08;
    torso.position.copy(this.hip).add(shoulder).multiplyScalar(0.5);
    torso.lookAt(tmpA.copy(torso.position).add(tmpB));
    g.add(torso);
    this.torso = torso;
    const headMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), SHARED.skin);
    headMesh.position.set(0, 1.5, 0.33);
    g.add(headMesh);
    const helmetMesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), lambert(helmet));
    helmetMesh.position.set(0, 1.53, 0.31);
    helmetMesh.rotation.x = 0.35;
    g.add(helmetMesh);
    for (const side of [-1, 1]) {
      const arm = tube(0.045, jerseyMat);
      placeTube(arm, P(side * 0.17, 1.33, 0.2), P(side * 0.2, 0.99, 0.43));
      g.add(arm);
    }

    // Jambes : cuisse + tibia + chaussure, recalculés à chaque image (cinématique inverse).
    this.legs = [-1, 1].map((side) => {
      const thigh = tube(0.07, SHARED.shorts);
      const shin = tube(0.05, SHARED.skin);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.2), SHARED.shoe);
      g.add(thigh, shin, shoe);
      return { side, thigh, shin, shoe, hip: P(side * 0.1, this.hip.y, this.hip.z), knee: new THREE.Vector3(), foot: new THREE.Vector3() };
    });
    this.crankArms = [-1, 1].map((side) => {
      const c = tube(0.015, SHARED.metal);
      g.add(c);
      return c;
    });

    // Ombre "pastille" : bien moins coûteuse qu'une vraie ombre portée.
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 12).rotateX(-Math.PI / 2).scale(0.7, 1, 1.6),
      new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false }),
    );
    shadow.position.y = 0.07;
    g.add(shadow);

    if (name) {
      const label = makeLabel(name, jersey);
      label.position.set(0, 2.15, 0);
      g.add(label);
      this.label = label;
    }
    this.setCrank(0);
  }

  // Angle du pédalier en radians (augmente quand on pédale).
  setCrank(angle) {
    const bbW = BB;
    this.legs.forEach((leg, i) => {
      const a = -angle + (i ? Math.PI : 0);
      leg.foot.set(leg.side * 0.13, bbW.y + Math.sin(a) * CRANK, bbW.z + Math.cos(a) * CRANK);
      solveKnee(leg.hip, leg.foot, THIGH, SHIN, leg.knee);
      placeTube(leg.thigh, leg.hip, leg.knee);
      placeTube(leg.shin, leg.knee, leg.foot);
      leg.shoe.position.copy(leg.foot).add(tmpA.set(0, 0.02, 0.04));
      placeTube(this.crankArms[i], crankFrom.set(leg.side * 0.07, bbW.y, bbW.z), crankTo.set(leg.side * 0.07, leg.foot.y, leg.foot.z));
    });
  }

  spinWheels(dAngle) {
    for (const w of this.wheels) w.rotation.x += dAngle;
  }
}

// Genou par cinématique inverse à deux segments dans le plan (z, y) : il pointe vers l'avant.
function solveKnee(hip, foot, a, b, out) {
  const dz = foot.z - hip.z;
  const dy = foot.y - hip.y;
  const d = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, Math.hypot(dz, dy)));
  const phi = Math.atan2(dy, dz);
  const alpha = Math.acos((a * a + d * d - b * b) / (2 * a * d));
  out.set(hip.x, hip.y + Math.sin(phi + alpha) * a, hip.z + Math.cos(phi + alpha) * a);
  return out;
}

export function makeLabel(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 34px system-ui, sans-serif';
  const w = Math.min(248, ctx.measureText(text).width + 28);
  ctx.fillStyle = 'rgba(15,17,22,0.72)';
  ctx.beginPath();
  ctx.roundRect((256 - w) / 2, 8, w, 48, 24);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect((256 - w) / 2 + 14, 26, 10, 12);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128 + 8, 33);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// --- Boîte à bonus façon kart : cube arrondi translucide et irisé aux couleurs de l'arc-en-ciel,
// gros « ? » en relief qui flotte à l'intérieur, halo doux visible de loin. Ressources partagées entre boîtes.
let boxRes = null;
const noDispose = (o) => {
  o.dispose = () => {};
  return o;
};

// Cube aux arêtes arrondies : sommets d'un cube subdivisé ramenés sur une « boîte arrondie ».
function roundedBox(size, radius, seg) {
  const g = new THREE.BoxGeometry(size, size, size, seg, seg, seg);
  const P = g.attributes.position;
  const N = g.attributes.normal;
  const inner = size / 2 - radius;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    c.set(Math.max(-inner, Math.min(inner, v.x)), Math.max(-inner, Math.min(inner, v.y)), Math.max(-inner, Math.min(inner, v.z)));
    v.sub(c).normalize();
    N.setXYZ(i, v.x, v.y, v.z);
    v.multiplyScalar(radius).add(c);
    P.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

// Forme du point d'interrogation (crochet, tige, point), extrudée avec un biseau
function questionGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.3, 0.2);
  s.absarc(0, 0.2, 0.3, Math.PI, -Math.PI * 0.27, true);
  s.quadraticCurveTo(0.085, -0.1, 0.085, -0.2);
  s.lineTo(0.085, -0.3);
  s.lineTo(-0.085, -0.3);
  s.lineTo(-0.085, -0.18);
  s.quadraticCurveTo(-0.085, -0.04, 0.075, 0.05);
  s.absarc(0, 0.2, 0.13, -Math.PI * 0.32, Math.PI, false);
  s.lineTo(-0.3, 0.2);
  const dot = new THREE.Shape();
  dot.absarc(0, -0.45, 0.09, 0, Math.PI * 2, false);
  const g = new THREE.ExtrudeGeometry([s, dot], { depth: 0.07, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 2, curveSegments: 7 });
  g.center().translate(0, 0, 0.072);
  // Deux « ? » dos à dos : il se lit à l'endroit des deux côtés de la boîte qui tourne
  const back = g.clone().rotateY(Math.PI);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal']) {
    const a = g.attributes[name].array;
    const b = back.attributes[name].array;
    const arr = new Float32Array(a.length + b.length);
    arr.set(a);
    arr.set(b, a.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  return out;
}

export function createItemBox() {
  if (!boxRes) {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, S, S);
    grad.addColorStop(0, '#ff3d6e');
    grad.addColorStop(0.3, '#ffb21f');
    grad.addColorStop(0.55, '#5bf08a');
    grad.addColorStop(0.78, '#2fd4ff');
    grad.addColorStop(1, '#8b5bff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
    // Reflet diagonal et liseré blanc lumineux
    const sheen = ctx.createLinearGradient(0, 0, S, S * 0.6);
    sheen.addColorStop(0.25, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, S, S);
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#ffffff';
    roundRect(ctx, 10, 10, S - 20, S - 20, 34);
    ctx.stroke();
    const tex = noDispose(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const shell = noDispose(new THREE.MeshPhysicalMaterial({
      map: tex,
      emissive: '#ffffff',
      emissiveMap: tex,
      emissiveIntensity: 0.32,
      roughness: 0.12,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      iridescence: 0.9,
      iridescenceIOR: 1.6,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    }));
    const mark = noDispose(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff1b8', emissiveIntensity: 0.5, roughness: 0.2, metalness: 0.1, transparent: true }));
    // « ? » dessiné après la coque (ordre de rendu) : il reste net derrière la paroi translucide.
    // Lueur douce (disque dégradé, additif) : repère visible de loin, sans contour carré.
    const g = document.createElement('canvas');
    g.width = g.height = 128;
    const gc = g.getContext('2d');
    const rad = gc.createRadialGradient(64, 64, 6, 64, 64, 64);
    rad.addColorStop(0, 'rgba(255, 236, 150, 0.7)');
    rad.addColorStop(0.45, 'rgba(255, 190, 80, 0.22)');
    rad.addColorStop(1, 'rgba(255, 170, 60, 0)');
    gc.fillStyle = rad;
    gc.fillRect(0, 0, 128, 128);
    const glow = noDispose(new THREE.SpriteMaterial({ map: noDispose(new THREE.CanvasTexture(g)), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    boxRes = { shell, mark, glow, geo: noDispose(roundedBox(1.5, 0.22, 5)), qGeo: noDispose(questionGeometry().scale(1.15, 1.15, 1.15)) };
  }
  const box = new THREE.Mesh(boxRes.geo, boxRes.shell);
  box.renderOrder = 2;
  const mark = new THREE.Mesh(boxRes.qGeo, boxRes.mark);
  mark.renderOrder = 3;
  box.add(mark);
  const glow = new THREE.Sprite(boxRes.glow);
  glow.scale.set(3.6, 3.6, 1);
  box.add(glow);
  return box;
}

// --- Peau de banane : quatre lanières ouvertes en étoile autour du bout, taches brunes, queue sombre ---
let bananaRes = null;
function bananaGeometry() {
  const parts = [];
  const yellow = new THREE.Color('#ffd21f');
  const cream = new THREE.Color('#fff1b0');
  const brown = new THREE.Color('#5a3d1a');
  const tmp = new THREE.Color();
  const speck = (x, y, z) => {
    const h = Math.sin(x * 91.7 + z * 57.3 + y * 33.1) * 43758.5453;
    return h - Math.floor(h) > 0.93;
  };
  const strip = (curve, width, inner) => {
    const segs = 10;
    const radial = 6;
    const geo = new THREE.TubeGeometry(curve, segs, 1, radial, false);
    // Section aplatie : on écrase le tube autour de sa courbe (large à la base, pointu au bout)
    const P = geo.attributes.position;
    const pt = new THREE.Vector3();
    const col = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      curve.getPointAt(t, pt);
      const w = width * (1 - 0.7 * t * t) + 0.004;
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        const dx = P.getX(k) - pt.x;
        const dy = P.getY(k) - pt.y;
        const dz = P.getZ(k) - pt.z;
        P.setXYZ(k, pt.x + dx * w, pt.y + dy * 0.012, pt.z + dz * w);
        const up = dy > 0;
        tmp.copy(t > 0.88 ? brown : up && inner && t < 0.55 ? cream : yellow);
        if (speck(P.getX(k), P.getY(k), P.getZ(k)) && t < 0.86) tmp.lerp(brown, 0.7);
        col.push(tmp.r, tmp.g, tmp.b);
      }
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    parts.push(geo);
  };
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4 + (k % 2) * 0.25;
    const len = 0.22 + (k % 2) * 0.04;
    const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    strip(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.1, 0).addScaledVector(d, 0.02),
      new THREE.Vector3(0, 0.13, 0).addScaledVector(d, 0.1),
      new THREE.Vector3(0, 0.06, 0).addScaledVector(d, len * 0.75),
      new THREE.Vector3(0, 0.02, 0).addScaledVector(d, len),
      new THREE.Vector3(0, 0.03, 0).addScaledVector(d, len + 0.035),
    ]), 0.075, true);
  }
  // Cœur de la peau et queue
  const stalk = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0.0, 0.12, 0.0), new THREE.Vector3(0.03, 0.24, 0.02), new THREE.Vector3(0.07, 0.3, 0.03)]), 8, 0.04, 7, false);
  const P = stalk.attributes.position;
  const col = [];
  for (let i = 0; i < P.count; i++) {
    const y = P.getY(i);
    tmp.copy(y > 0.25 ? brown : yellow);
    if (speck(P.getX(i), y, P.getZ(i))) tmp.lerp(brown, 0.6);
    col.push(tmp.r, tmp.g, tmp.b);
  }
  stalk.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  stalk.computeVertexNormals();
  parts.push(stalk);
  parts.push(paintGeo(new THREE.SphereGeometry(0.045, 10, 8).scale(1, 0.8, 1).translate(0, 0.1, 0), yellow));
  return mergeSimple(parts);
}
function paintGeo(geo, color) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([color.r, color.g, color.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
// Fusion minimale (position, normale, couleur) de géométries indexées
function mergeSimple(list) {
  let vc = 0;
  let ic = 0;
  for (const g of list) {
    vc += g.attributes.position.count;
    ic += g.index.count;
  }
  const pos = new Float32Array(vc * 3);
  const nor = new Float32Array(vc * 3);
  const col = new Float32Array(vc * 3);
  const idx = new Uint32Array(ic);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), vo * 3);
    nor.set(g.attributes.normal.array.subarray(0, n * 3), vo * 3);
    col.set(g.attributes.color.array.subarray(0, n * 3), vo * 3);
    for (let k = 0; k < g.index.count; k++) idx[io + k] = g.index.array[k] + vo;
    io += g.index.count;
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export function createBanana() {
  if (!bananaRes) {
    bananaRes = {
      geo: noDispose(bananaGeometry().scale(1.35, 1.35, 1.35)),
      mat: noDispose(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0, emissive: '#3a2a00', emissiveIntensity: 0.35 })),
    };
  }
  const m = new THREE.Mesh(bananaRes.geo, bananaRes.mat);
  m.castShadow = true;
  return m;
}
