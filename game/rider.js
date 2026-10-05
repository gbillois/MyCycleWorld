// Cycliste détaillé (graphismes détaillés) : vélo de route complet (roues à rayons, cintre de route,
// fourche qui braque) et cycliste aux formes arrondies qui pédale et se met en danseuse dans les côtes.
// Même interface que RiderModel (models.js) : group, setCrank, spinWheels, label, plus setSteer et setPose.
// Repère local : +Z = avant, +Y = haut, +X = côté gauche du coureur.
import * as THREE from 'three';
import { mergeGeometries, colored } from './geom.js';
import { makeLabel } from './models.js';

const UP = new THREE.Vector3(0, 1, 0);
const AX = new THREE.Vector3(1, 0, 0);
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tQ = new THREE.Quaternion();
const P = (x, y, z) => new THREE.Vector3(x, y, z);

// Matériaux partagés : les couleurs sont dans les sommets, donc deux matériaux suffisent pour tous les coureurs.
const GLOSSY = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.25 });
const MATTE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.02 });
const SKIN = new THREE.MeshStandardMaterial({ color: '#e6b48c', roughness: 0.65 });
const SHORTS = new THREE.MeshStandardMaterial({ color: '#16171c', roughness: 0.55 });
const WHITE = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.6 });
const METAL = new THREE.MeshStandardMaterial({ color: '#c7cbd3', roughness: 0.3, metalness: 0.8 });
const BLACK = new THREE.MeshStandardMaterial({ color: '#1b1c21', roughness: 0.5 });

const unitTube = new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0);
const unitSphere = new THREE.SphereGeometry(1, 14, 10);

// Tube statique (géométrie) entre deux points.
function tubeGeo(a, b, r, seg = 10) {
  tA.subVectors(b, a);
  const len = tA.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg).translate(0, len / 2, 0);
  g.applyQuaternion(tQ.setFromUnitVectors(UP, tA.normalize()));
  return g.translate(a.x, a.y, a.z);
}

// Tube dynamique (maillage) recalé chaque image entre deux points.
function limb(radius, material) {
  const m = new THREE.Mesh(unitTube, material);
  m.userData.radius = radius;
  m.castShadow = true;
  return m;
}
function placeLimb(mesh, a, b) {
  tA.subVectors(b, a);
  const len = tA.length() || 1e-3;
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(UP, tA.divideScalar(len));
  const r = mesh.userData.radius;
  mesh.scale.set(r, len, r);
}
function joint(radius, material) {
  const m = new THREE.Mesh(unitSphere, material);
  m.scale.setScalar(radius);
  m.castShadow = true;
  return m;
}

// Géométrie du vélo (m)
const BB = P(0, 0.3, -0.02);
const REAR = P(0, 0.335, -0.42);
const FRONT = P(0, 0.335, 0.58);
const SEAT = P(0, 0.8, -0.17);
const HEAD_TOP = P(0, 0.86, 0.4);
const HEAD_BOT = P(0, 0.7, 0.45);
const CRANK = 0.17;
const THIGH = 0.44;
const SHIN = 0.47;
// Bassin assis / en danseuse ; épaules et tête relatives au bassin
const HIP_SIT = P(0, 0.99, -0.2);
const HIP_STAND = P(0, 1.06, -0.04);
const SHOULDER = P(0, 0.36, 0.42);
const HEAD = P(0, 0.49, 0.54);
const BAR_Y = 0.06; // hauteur du cintre au-dessus du haut de la douille de direction
const BAR_Z = 0.13;

function wheelGeometry(rimColor) {
  const parts = [
    colored(new THREE.TorusGeometry(0.335, 0.024, 8, 40).rotateY(Math.PI / 2), '#1d1e22'),
    colored(new THREE.TorusGeometry(0.308, 0.018, 6, 40).rotateY(Math.PI / 2), rimColor),
    colored(new THREE.CylinderGeometry(0.296, 0.296, 0.026, 40, 1, true).rotateZ(Math.PI / 2), rimColor),
    colored(new THREE.CylinderGeometry(0.026, 0.026, 0.11, 12).rotateZ(Math.PI / 2), '#c7cbd3'),
  ];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const side = k % 2 ? 0.03 : -0.03;
    parts.push(colored(tubeGeo(P(side, 0, 0), P(0, Math.sin(a) * 0.29, Math.cos(a) * 0.29), 0.0035, 4), '#d5d8de'));
  }
  return mergeGeometries(parts);
}

export class DetailedRider {
  constructor({ jersey = '#ff5a1f', bike = '#2b6cff', helmet = '#ffffff', name = '' } = {}) {
    const g = new THREE.Group();
    this.group = g;
    const jerseyMat = new THREE.MeshStandardMaterial({ color: jersey, roughness: 0.6 });

    // Cadre (une seule géométrie)
    const frame = [];
    const fc = bike;
    frame.push(colored(tubeGeo(BB, HEAD_BOT, 0.032), fc));
    frame.push(colored(tubeGeo(BB, SEAT, 0.028), fc));
    frame.push(colored(tubeGeo(SEAT, HEAD_TOP, 0.025), fc));
    frame.push(colored(tubeGeo(HEAD_BOT, HEAD_TOP, 0.036), fc));
    for (const s of [-1, 1]) {
      frame.push(colored(tubeGeo(P(s * 0.025, BB.y, BB.z), P(s * 0.06, REAR.y, REAR.z), 0.015), fc));
      frame.push(colored(tubeGeo(P(s * 0.02, SEAT.y - 0.02, SEAT.z), P(s * 0.06, REAR.y, REAR.z), 0.012), fc));
    }
    frame.push(colored(tubeGeo(SEAT, P(0, 0.9, -0.205), 0.014), '#2a2c33'));
    frame.push(colored(new THREE.SphereGeometry(1, 12, 8).scale(0.068, 0.028, 0.14).translate(0, 0.925, -0.22), '#17181c'));
    frame.push(colored(new THREE.TorusGeometry(0.1, 0.012, 6, 28).rotateY(Math.PI / 2).translate(-0.075, BB.y, BB.z), '#b9bec7'));
    frame.push(colored(new THREE.CylinderGeometry(0.034, 0.034, 0.19, 12).applyQuaternion(tQ.setFromUnitVectors(UP, tB.subVectors(HEAD_BOT, BB).normalize())).translate(0, 0.47, 0.16), '#f2f2f2'));
    const frameMesh = new THREE.Mesh(mergeGeometries(frame), GLOSSY);
    g.add(frameMesh);

    // Roues
    const wheelGeo = wheelGeometry('#2b2d34');
    this.rearWheel = new THREE.Mesh(wheelGeo, MATTE);
    this.rearWheel.position.copy(REAR);
    g.add(this.rearWheel);

    // Direction : fourche, potence, cintre de route et roue avant pivotent autour de la douille.
    this.steer = new THREE.Group();
    this.steer.position.copy(HEAD_TOP);
    g.add(this.steer);
    const rel = (v) => v.clone().sub(HEAD_TOP);
    const steerParts = [];
    for (const s of [-1, 1]) steerParts.push(colored(tubeGeo(rel(P(s * 0.03, HEAD_BOT.y, HEAD_BOT.z)), rel(P(s * 0.05, FRONT.y, FRONT.z)), 0.016), fc));
    steerParts.push(colored(tubeGeo(P(0, 0, 0), P(0, BAR_Y, BAR_Z), 0.018), '#1d1e22'));
    steerParts.push(colored(new THREE.CylinderGeometry(0.013, 0.013, 0.42, 10).rotateZ(Math.PI / 2).translate(0, BAR_Y, BAR_Z), '#1d1e22'));
    for (const s of [-1, 1]) {
      const drop = new THREE.TorusGeometry(0.07, 0.012, 6, 14, Math.PI).rotateZ(-Math.PI / 2).rotateY(-Math.PI / 2);
      steerParts.push(colored(drop.translate(s * 0.21, BAR_Y - 0.07, BAR_Z), '#1d1e22'));
      steerParts.push(colored(new THREE.BoxGeometry(0.035, 0.05, 0.07).translate(s * 0.21, BAR_Y + 0.02, BAR_Z + 0.05), '#1d1e22'));
    }
    this.steer.add(new THREE.Mesh(mergeGeometries(steerParts), GLOSSY));
    this.frontWheel = new THREE.Mesh(wheelGeo, MATTE);
    this.frontWheel.position.copy(rel(FRONT));
    this.steer.add(this.frontWheel);

    // Haut du corps (une géométrie) accroché au bassin : se déplace d'un bloc en danseuse.
    this.torsoPivot = new THREE.Group();
    g.add(this.torsoPivot);
    const body = [];
    const torsoGeo = new THREE.CapsuleGeometry(0.15, 0.32, 6, 14).scale(1.2, 1, 0.82);
    const tFrom = P(0, 0.04, 0.03);
    const tTo = SHOULDER.clone().sub(P(0, 0.03, 0.02));
    const tDir = tB.subVectors(tTo, tFrom).normalize().clone();
    const tMid = tFrom.clone().add(tTo).multiplyScalar(0.5);
    torsoGeo.applyQuaternion(tQ.setFromUnitVectors(UP, tDir)).translate(tMid.x, tMid.y, tMid.z);
    body.push(colored(torsoGeo, jersey));
    // Bande blanche sur la poitrine
    const band = new THREE.CylinderGeometry(0.155, 0.155, 0.05, 16, 1, true).scale(1.2, 1, 0.82);
    const bandPos = tFrom.clone().lerp(tTo, 0.72);
    band.applyQuaternion(tQ.setFromUnitVectors(UP, tDir)).translate(bandPos.x, bandPos.y, bandPos.z);
    body.push(colored(band, '#ffffff'));
    body.push(colored(new THREE.SphereGeometry(1, 14, 10).scale(0.15, 0.12, 0.16), '#16171c')); // bassin / cuissard
    body.push(colored(tubeGeo(SHOULDER, HEAD.clone().sub(P(0, 0.06, 0.04)), 0.05), '#e6b48c')); // cou
    body.push(colored(new THREE.SphereGeometry(0.1, 16, 12).translate(HEAD.x, HEAD.y, HEAD.z), '#e6b48c'));
    const helmetGeo = new THREE.SphereGeometry(0.128, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56).scale(1, 0.85, 1.3);
    helmetGeo.rotateX(0.3).translate(HEAD.x, HEAD.y + 0.03, HEAD.z - 0.03);
    body.push(colored(helmetGeo, helmet));
    for (const s of [-1, 0, 1]) {
      body.push(colored(new THREE.BoxGeometry(0.018, 0.012, 0.17).rotateX(0.3).translate(s * 0.045, HEAD.y + 0.125, HEAD.z - 0.05), '#2a2c33'));
    }
    body.push(colored(new THREE.BoxGeometry(0.17, 0.036, 0.04).translate(HEAD.x, HEAD.y + 0.005, HEAD.z + 0.092), '#101114')); // lunettes
    this.torsoPivot.add(new THREE.Mesh(mergeGeometries(body), MATTE));

    // Bras (dynamiques : les épaules bougent, les mains restent sur les cocottes)
    this.arms = [-1, 1].map((side) => {
      const upper = limb(0.047, jerseyMat);
      const fore = limb(0.039, SKIN);
      const elbow = joint(0.043, SKIN);
      const hand = joint(0.035, BLACK);
      g.add(upper, fore, elbow, hand);
      return { side, upper, fore, elbow, hand };
    });

    // Jambes (cinématique inverse)
    this.legs = [-1, 1].map((side) => {
      const thigh = limb(0.068, SHORTS);
      const shin = limb(0.046, SKIN);
      const knee = joint(0.056, SKIN);
      const sock = limb(0.048, WHITE);
      const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.13, 4, 8).rotateX(Math.PI / 2), WHITE);
      shoe.castShadow = true;
      g.add(thigh, shin, knee, sock, shoe);
      return { side, thigh, shin, knee, sock, shoe, hip: new THREE.Vector3(), kneeP: new THREE.Vector3(), foot: new THREE.Vector3() };
    });
    this.cranks = [-1, 1].map(() => {
      const arm = limb(0.013, METAL);
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.015, 0.06), BLACK);
      g.add(arm, pedal);
      return { arm, pedal };
    });

    // Ombre « pastille », utilisée seulement sans ombres portées
    this.blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 16).rotateX(-Math.PI / 2).scale(0.65, 1, 1.5),
      new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.blob.position.y = 0.06;
    g.add(this.blob);

    g.traverse((o) => {
      if (o.isMesh && o !== this.blob) o.castShadow = true;
    });

    if (name) {
      this.label = makeLabel(name, jersey);
      this.label.position.set(0, 2.2, 0);
      g.add(this.label);
    }
    this.standing = 0;
    this.crankAngle = 0;
    this.hip = HIP_SIT.clone();
    this.setPose(0);
  }

  // 0 = assis, 1 = en danseuse (côtes). Valeur lissée par l'appelant.
  setPose(standing) {
    this.standing = standing;
    this.hip.lerpVectors(HIP_SIT, HIP_STAND, standing);
    this.torsoPivot.position.copy(this.hip);
    this.torsoPivot.rotation.x = standing * 0.12;
    this.updateArms();
    this.setCrank(this.crankAngle);
  }

  updateArms() {
    for (const arm of this.arms) {
      const shoulder = tA.copy(SHOULDER).setX(arm.side * 0.17).applyAxisAngle(AX, this.torsoPivot.rotation.x).add(this.hip).clone();
      const hand = P(arm.side * 0.21, HEAD_TOP.y + BAR_Y + 0.03, HEAD_TOP.z + BAR_Z + 0.05);
      const elbow = shoulder.clone().lerp(hand, 0.5).add(P(arm.side * 0.04, -0.05 + this.standing * 0.02, -0.05));
      placeLimb(arm.upper, shoulder, elbow);
      placeLimb(arm.fore, elbow, hand);
      arm.elbow.position.copy(elbow);
      arm.hand.position.copy(hand);
    }
  }

  // Angle du pédalier (radians, croissant quand on pédale)
  setCrank(angle) {
    this.crankAngle = angle;
    this.legs.forEach((leg, i) => {
      const a = -angle + (i ? Math.PI : 0);
      leg.hip.set(leg.side * 0.1, this.hip.y - 0.02, this.hip.z);
      leg.foot.set(leg.side * 0.13, BB.y + Math.sin(a) * CRANK, BB.z + Math.cos(a) * CRANK);
      solveKnee(leg.hip, leg.foot, THIGH, SHIN, leg.kneeP);
      placeLimb(leg.thigh, leg.hip, leg.kneeP);
      placeLimb(leg.shin, leg.kneeP, leg.foot);
      leg.knee.position.copy(leg.kneeP);
      placeLimb(leg.sock, tB.copy(leg.foot).lerp(leg.kneeP, 0.18), leg.foot);
      leg.shoe.position.set(leg.foot.x, leg.foot.y + 0.025, leg.foot.z + 0.035);
      const c = this.cranks[i];
      placeLimb(c.arm, tB.set(leg.side * 0.075, BB.y, BB.z), tA.set(leg.side * 0.075, leg.foot.y, leg.foot.z));
      c.pedal.position.set(leg.side * 0.12, leg.foot.y, leg.foot.z);
    });
  }

  // Braquage de la direction (radians, + = vers la droite du coureur)
  setSteer(angle) {
    this.steer.rotation.y = -angle;
  }

  spinWheels(dAngle) {
    this.rearWheel.rotation.x += dAngle;
    this.frontWheel.rotation.x += dAngle;
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
