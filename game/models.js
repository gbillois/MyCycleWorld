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

function makeLabel(text, color) {
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

let boxMaterial = null;
let glowMaterial = null;
const boxGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Boîte à bonus façon kart : arc-en-ciel vif, bordure blanche, gros point d'interrogation.
export function createItemBox() {
  if (!boxMaterial) {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, S, S);
    grad.addColorStop(0, '#ff3d6e');
    grad.addColorStop(0.35, '#ffb21f');
    grad.addColorStop(0.65, '#2fd4c0');
    grad.addColorStop(1, '#3d8bff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
    // Bordure blanche arrondie
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#ffffff';
    roundRect(ctx, 14, 14, S - 28, S - 28, 30);
    ctx.stroke();
    // Point d'interrogation : contour sombre puis remplissage blanc
    ctx.font = '900 190px "Arial Black", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 22;
    ctx.strokeStyle = 'rgba(40, 10, 70, 0.85)';
    ctx.strokeText('?', S / 2, S / 2 + 12);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('?', S / 2, S / 2 + 12);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    // MeshBasicMaterial : couleurs franches, indépendantes de la lumière, donc lisibles de loin.
    boxMaterial = new THREE.MeshBasicMaterial({ map: tex });
    // Lueur douce (disque dégradé, additif) : repère visible de loin, sans contour carré.
    const g = document.createElement('canvas');
    g.width = g.height = 128;
    const gc = g.getContext('2d');
    const rad = gc.createRadialGradient(64, 64, 6, 64, 64, 64);
    rad.addColorStop(0, 'rgba(255, 236, 150, 0.85)');
    rad.addColorStop(0.45, 'rgba(255, 190, 80, 0.28)');
    rad.addColorStop(1, 'rgba(255, 170, 60, 0)');
    gc.fillStyle = rad;
    gc.fillRect(0, 0, 128, 128);
    glowMaterial = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(g),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
  }
  const box = new THREE.Mesh(boxGeo, boxMaterial);
  const glow = new THREE.Sprite(glowMaterial);
  glow.scale.set(3.6, 3.6, 1);
  box.add(glow);
  return box;
}

const bananaGeo = new THREE.TorusGeometry(0.28, 0.09, 5, 9, Math.PI * 1.1).rotateX(-Math.PI / 2);
const bananaMat = lambert('#ffd21f');
export function createBanana() {
  const m = new THREE.Mesh(bananaGeo, bananaMat);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), lambert('#5a3d1a'));
  tip.position.set(0.28, 0, 0);
  m.add(tip);
  return m;
}
