// VTT du cycliste détaillé (style 'mtb', circuit en forêt) : pneus à crampons, cadre semi-rigide aux tubes
// épais, fourche suspendue, guidon plat avec poignées, mono-plateau ; tenue de VTT par-dessus le corps :
// casque ouvert à visière et short ample (maillage « skinné » sur le même squelette que le corps, une seule
// instruction de dessin). Appelé par rider.js (option style), qui fournit sa géométrie de vélo (GEO).
// Repère local : +Z = avant, +Y = haut, +X = côté gauche du coureur.
import * as THREE from 'three';
import { Parts, PBR, sweep, keep, B, BODY } from './figure.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const AX = V(1, 0, 0);

const QS = {
  high: { tube: 12, seg: 12, rim: 48, tyre: 8, spokes: 28, knobs: 40, cogs: 10, chain: 110, bar: 24 },
  medium: { tube: 8, seg: 10, rim: 32, tyre: 7, spokes: 20, knobs: 28, cogs: 5, chain: 64, bar: 16 },
  low: { tube: 6, seg: 6, rim: 20, tyre: 6, spokes: 12, knobs: 18, cogs: 3, chain: 36, bar: 10 },
};

const cache = new Map();
function cached(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}
const CR = (pts) => new THREE.CatmullRomCurve3(pts, false, 'centripetal');
const line = (a, b) => new THREE.LineCurve3(a, b);
const taper = (a, b, c = a, d = b) => (t) => [a + (c - a) * t, b + (d - b) * t];
const cylX = (r, len, seg, x, y, z) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2).translate(x, y, z);
function along(geo, dir, at) {
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
  return geo.translate(at.x, at.y, at.z);
}
const darker = (hex, f) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();

// Roue de VTT : pneu épais à crampons (même rayon extérieur que la roue de route), jante alu, rayons, disque.
function wheel(G, rear, q) {
  return cached(`mtbWheel${rear}${q}`, () => {
    const Q = QS[q];
    const R = G.WHEEL_R;
    const parts = new Parts();
    const tube = 0.03;
    parts.add(new THREE.TorusGeometry(R - tube, tube, Q.tyre, Q.rim).rotateY(Math.PI / 2), { color: '#1d1c1b', pbr: PBR.rubber });
    // Crampons : deux rangées décalées sur la bande de roulement, plus une sur les flancs
    const knob = new THREE.BoxGeometry(0.016, 0.011, 0.02);
    for (let k = 0; k < Q.knobs; k++) {
      const a = (k / Q.knobs) * Math.PI * 2;
      for (const side of [-1, 1]) {
        const g = knob.clone();
        const off = (k % 2 ? 0.5 : 0) * ((Math.PI * 2) / Q.knobs);
        const ang = a + off;
        const x = side * (k % 2 ? 0.011 : 0.019);
        g.translate(x, R - 0.002, 0).applyMatrix4(new THREE.Matrix4().makeRotationX(ang));
        parts.add(g, { color: '#232220', pbr: PBR.rubber });
      }
    }
    knob.dispose();
    // Jante alu noire et moyeu
    const prof = [[0.282, -0.013], [0.27, -0.012], [0.262, -0.006], [0.262, 0.006], [0.27, 0.012], [0.282, 0.013], [0.282, -0.013]];
    parts.add(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), Q.rim).rotateZ(-Math.PI / 2), { color: '#222326', pbr: PBR.alu });
    for (let k = 0; k < Q.spokes; k++) {
      const a = ((k + 0.5) / Q.spokes) * Math.PI * 2;
      const side = k % 2 ? 1 : -1;
      const from = V(side * 0.03, Math.sin(a) * 0.026, Math.cos(a) * 0.026);
      const to = V(side * 0.004, Math.sin(a + side * 0.05) * 0.262, Math.cos(a + side * 0.05) * 0.262);
      const dir = to.clone().sub(from);
      const sp = new THREE.CylinderGeometry(0.0013, 0.0013, dir.length(), 3, 1, true).translate(0, dir.length() / 2, 0);
      parts.add(along(sp, dir, from), { color: '#b9bcc2', pbr: PBR.chrome });
    }
    parts.add(new THREE.CylinderGeometry(0.02, 0.02, 0.11, 10).rotateZ(Math.PI / 2), { color: '#2a2b30', pbr: PBR.alu });
    const rotor = new THREE.RingGeometry(0.06, 0.09, 28, 1).rotateY(Math.PI / 2).translate(0.05, 0, 0);
    parts.add(rotor, { color: '#c3c6cc', pbr: PBR.chrome });
    parts.add(new THREE.RingGeometry(0.06, 0.09, 28, 1).rotateY(-Math.PI / 2).translate(0.048, 0, 0), { color: '#c3c6cc', pbr: PBR.chrome });
    if (rear) {
      for (let k = 0; k < Q.cogs; k++) {
        const f = k / Math.max(1, Q.cogs - 1);
        parts.add(cylX(0.1 - f * 0.07, 0.0024, q === 'high' ? 22 : 12, -0.022 - f * 0.034, 0, 0), { color: k % 2 ? '#c6c9cf' : '#9ea2a9', pbr: PBR.chrome });
      }
    }
    return keep(parts.build());
  });
}

// Cadre semi-rigide : tubes épais, tube horizontal plongeant, haubans bas, tige de selle télescopique,
// mono-plateau et chaîne, dérailleur arrière.
function frame(G, bike, jersey, q) {
  return cached(`mtbFrame${bike}${jersey}${q}`, () => {
    const Q = QS[q];
    const parts = new Parts();
    const paint = { color: bike, pbr: PBR.paint };
    const stays = darker(bike, 0.7);
    const tube = (curve, radius, opts = paint, ref = AX) => parts.add(sweep(curve, { segs: Q.seg, radial: Q.tube, radius, ref }), opts);
    const { BB, REAR, HT_BOT, AXIS, ST_DIR, SADDLE } = G;
    // Douille conique
    tube(line(HT_BOT.clone().addScaledVector(AXIS, -0.03), HT_BOT.clone().addScaledVector(AXIS, 0.17)), taper(0.034, 0.034, 0.028, 0.028));
    // Diagonal épais (avec l'autocollant de la marque) et tube horizontal plongeant
    const dtFrom = BB.clone().add(V(0, 0.03, 0.025));
    const dtTo = HT_BOT.clone().addScaledVector(AXIS, 0.02);
    const dtDir = dtTo.clone().sub(dtFrom).normalize();
    parts.add(sweep(CR([dtFrom, dtFrom.clone().lerp(dtTo, 0.5).add(V(0, -0.012, 0.004)), dtTo]), { segs: Q.seg, radial: Q.tube + 2, radius: () => [0.034, 0.03], ref: V(0, -dtDir.z, dtDir.y) }), {
      color: '#ffffff',
      pbr: PBR.decal,
      uvFn: (x, y, z, u, v) => [0.02 + u * 0.96, 0.5 * v],
    });
    const seatJoint = BB.clone().addScaledVector(ST_DIR, 0.44);
    tube(CR([HT_BOT.clone().addScaledVector(AXIS, 0.14), V(0, 0.76, 0.16), seatJoint.clone().add(V(0, 0.01, 0.01))]), taper(0.024, 0.028, 0.02, 0.022));
    tube(line(BB.clone().add(V(0, 0.02, 0)), seatJoint.clone().addScaledVector(ST_DIR, 0.06)), taper(0.022, 0.024));
    parts.add(cylX(0.03, 0.09, Q.tube + 4, 0, BB.y, BB.z), paint);
    for (const s of [-1, 1]) {
      tube(CR([V(s * 0.03, 0.29, -0.04), V(s * 0.058, 0.3, -0.22), V(s * 0.068, REAR.y, REAR.z)]), taper(0.014, 0.018, 0.01, 0.012), { color: stays, pbr: PBR.paint });
      tube(CR([seatJoint.clone().add(V(s * 0.018, -0.02, -0.02)), V(s * 0.05, 0.5, -0.29), V(s * 0.068, REAR.y + 0.01, REAR.z)]), taper(0.011, 0.014, 0.009, 0.01), { color: stays, pbr: PBR.paint });
      parts.add(new THREE.BoxGeometry(0.01, 0.05, 0.04).translate(s * 0.069, REAR.y, REAR.z), { color: '#1c1d21', pbr: PBR.alu });
    }
    parts.add(cylX(0.008, 0.16, 8, 0, REAR.y, REAR.z), { color: '#2c2d33', pbr: PBR.alu });
    // Tige télescopique (fourreau noir, plongeur chromé) et selle de VTT
    const postTop = BB.clone().addScaledVector(ST_DIR, 0.69);
    tube(line(seatJoint, BB.clone().addScaledVector(ST_DIR, 0.6)), () => [0.017, 0.017], { color: '#18191c', pbr: PBR.carbon });
    tube(line(BB.clone().addScaledVector(ST_DIR, 0.6), postTop), () => [0.0145, 0.0145], { color: '#c9ccd2', pbr: PBR.chrome });
    const saddle = new THREE.SphereGeometry(1, 14, 6).scale(0.07, 0.022, 0.135).translate(SADDLE.x, SADDLE.y - 0.008, SADDLE.z - 0.01);
    parts.add(saddle, { color: (c, x, y, z) => c.set(z < SADDLE.z - 0.1 ? jersey : '#17181b'), pbr: PBR.satin });
    // Plateau unique, chaîne, dérailleur
    const cx = -0.048;
    const ring = new THREE.TorusGeometry(0.085, 0.006, 4, q === 'low' ? 16 : 32).rotateY(Math.PI / 2).translate(cx, BB.y, BB.z);
    parts.add(ring, { color: '#2b2c31', pbr: PBR.alu });
    const chain = new THREE.CatmullRomCurve3([
      V(cx, BB.y + 0.088, BB.z), V(cx, 0.4, -0.2), V(cx, REAR.y + 0.07, REAR.z + 0.02), V(cx, REAR.y + 0.02, REAR.z - 0.07),
      V(cx, REAR.y - 0.05, REAR.z - 0.04), V(cx, 0.24, -0.43), V(cx, 0.2, -0.38), V(cx, BB.y - 0.088, -0.12), V(cx, BB.y - 0.088, BB.z), V(cx, BB.y, BB.z + 0.09),
    ], true);
    parts.add(sweep(chain, { segs: Q.chain, radial: 4, radius: () => [0.0035, 0.0048], ref: AX }), {
      color: (c, x, y, z, u) => c.set(Math.floor(u * Q.chain) % 2 ? '#9a9ea6' : '#3b3d43'),
      pbr: PBR.chrome,
    });
    parts.add(new THREE.BoxGeometry(0.024, 0.07, 0.035).rotateX(0.4).translate(cx - 0.012, 0.25, -0.43), { color: '#202126', pbr: PBR.alu });
    // Manivelles
    for (const s of [-1, 1]) parts.add(new THREE.BoxGeometry(0.014, 0.02, 0.17).translate(s * 0.075, BB.y, BB.z + s * 0.0), { color: '#1a1b1f', pbr: PBR.alu });
    return keep(parts.build());
  });
}

// Fourche suspendue, potence courte, cintre plat large avec poignées et leviers (repère de la direction).
function steer(G, bike, q) {
  return cached(`mtbSteer${bike}${q}`, () => {
    const Q = QS[q];
    const parts = new Parts();
    const { HT_BOT, AXIS, FRONT, STEM_TOP, CLAMP, STEER_INV } = G;
    const crown = HT_BOT.clone().addScaledVector(AXIS, -0.025);
    parts.add(new THREE.BoxGeometry(0.15, 0.03, 0.05).translate(crown.x, crown.y, crown.z), { color: '#1b1c20', pbr: PBR.alu });
    for (const s of [-1, 1]) {
      const top = crown.clone().add(V(s * 0.055, 0, 0));
      const axle = V(s * 0.058, FRONT.y + 0.01, FRONT.z - 0.012);
      const mid = top.clone().lerp(axle, 0.42);
      parts.add(sweep(line(top, mid), { segs: 2, radial: Q.tube, radius: () => [0.0175, 0.0175], ref: AX }), { color: '#d9a441', pbr: PBR.chrome });
      parts.add(sweep(line(mid.clone().lerp(top, 0.08), axle), { segs: 3, radial: Q.tube, radius: taper(0.024, 0.024, 0.018, 0.02), ref: AX, caps: true }), { color: '#141518', pbr: PBR.satin });
      parts.add(new THREE.BoxGeometry(0.012, 0.04, 0.035).translate(axle.x, axle.y - 0.005, axle.z + 0.01), { color: '#141518', pbr: PBR.alu });
    }
    // Arceau des fourreaux, devant la roue
    const archY = crown.y - 0.2;
    parts.add(sweep(CR([V(-0.057, archY, crown.z + 0.07), V(0, archY + 0.05, crown.z + 0.11), V(0.057, archY, crown.z + 0.07)]), { segs: 8, radial: 6, radius: () => [0.012, 0.014], ref: UP }), { color: '#141518', pbr: PBR.satin });
    parts.add(cylX(0.008, 0.15, 8, 0, FRONT.y, FRONT.z), { color: '#2c2d33', pbr: PBR.alu });
    // Potence courte et cintre relevé de 78 cm
    parts.add(sweep(line(STEM_TOP.clone().addScaledVector(AXIS, -0.03), CLAMP.clone().add(V(0, 0.006, -0.03))), { segs: 2, radial: Q.tube, radius: () => [0.02, 0.022], ref: AX, caps: true }), { color: '#1b1c20', pbr: PBR.alu });
    const by = CLAMP.y + 0.012;
    const bz = CLAMP.z - 0.03;
    const bar = CR([V(0.39, by + 0.03, bz - 0.04), V(0.26, by + 0.025, bz - 0.02), V(0.12, by + 0.004, bz), V(0, by, bz), V(-0.12, by + 0.004, bz), V(-0.26, by + 0.025, bz - 0.02), V(-0.39, by + 0.03, bz - 0.04)]);
    parts.add(sweep(bar, { segs: Q.bar, radial: Q.tube, radius: (t) => (Math.abs(t - 0.5) < 0.1 ? [0.0159, 0.0159] : [0.011, 0.011]), ref: UP, caps: true }), { color: '#1e1f23', pbr: PBR.alu });
    for (const s of [-1, 1]) {
      // Poignées (gomme) et leviers de frein à un doigt
      parts.add(sweep(line(V(s * 0.27, by + 0.026, bz - 0.022), V(s * 0.385, by + 0.03, bz - 0.04)), { segs: 1, radial: Q.tube, radius: () => [0.017, 0.017], ref: UP, caps: true }), { color: '#141414', pbr: PBR.rubber });
      parts.add(new THREE.BoxGeometry(0.03, 0.02, 0.03).translate(s * 0.235, by + 0.02, bz - 0.01), { color: '#25262b', pbr: PBR.alu });
      parts.add(sweep(line(V(s * 0.235, by + 0.015, bz + 0.005), V(s * 0.31, by + 0.01, bz + 0.035)), { segs: 1, radial: 5, radius: () => [0.004, 0.006], ref: UP }), { color: '#c8cbd0', pbr: PBR.alu });
    }
    const geo = parts.build();
    geo.applyMatrix4(STEER_INV);
    return keep(geo);
  });
}

// Tenue de VTT par-dessus le corps : casque ouvert à visière (os de la tête) et short ample (bassin et cuisses).
function kitGeometry(helmet, jersey, q) {
  return cached(`mtbKit${helmet}${jersey}${q}`, () => {
    const hi = q === 'high';
    const parts = new Parts();
    const hc = V(0, BODY.headY + 0.1, 0.012);
    // Coque ronde (recouvre le casque de route) avec aérations sombres
    const shell = new THREE.SphereGeometry(1, hi ? 22 : 14, hi ? 10 : 7, 0, Math.PI * 2, 0, Math.PI * 0.56).scale(0.113, 0.128, 0.145).translate(hc.x, hc.y + 0.02, hc.z - 0.01);
    parts.add(shell, {
      color: (c, x, y, z) => {
        const a = Math.atan2(x, z - hc.z);
        const vent = y > hc.y + 0.09 && Math.abs(Math.sin(a * 3.5)) < 0.18 && Math.abs(a) < 2.4;
        c.set(vent ? '#1b1c20' : y < hc.y + 0.035 ? darker(helmet, 0.75) : helmet);
      },
      pbr: PBR.satin,
      bone: B.head,
    });
    // Visière : plaque arrondie au-dessus du front, légèrement inclinée vers le bas
    const visor = new THREE.RingGeometry(0.1, 0.168, hi ? 14 : 8, 1, -Math.PI / 2 - 0.85, 1.7).rotateX(-Math.PI / 2).rotateX(0.22).translate(hc.x, hc.y + 0.075, hc.z + 0.005);
    parts.add(visor, { color: darker(helmet === '#ffffff' ? '#2b2f36' : helmet, 0.6), pbr: PBR.plastic, bone: B.head });
    // Short : ceinture sur le bassin, jambes amples jusqu'au-dessus du genou
    const waist = new THREE.LatheGeometry([[0.152, 0.095], [0.168, 0.04], [0.172, -0.04], [0.165, -0.13]].map(([r, y]) => new THREE.Vector2(r, y)), hi ? 18 : 12).scale(1, 1, 0.72);
    parts.add(waist, { color: '#2a2e35', pbr: PBR.fabric, bone: B.pelvis });
    const [hx, hy] = BODY.hip;
    for (const [s, bone] of [[1, B.thighL], [-1, B.thighR]]) {
      const leg = new THREE.LatheGeometry([[0.1, 0.05], [0.103, -0.05], [0.097, -0.2], [0.09, -0.3], [0.088, -0.31]].map(([r, y]) => new THREE.Vector2(r, y)), hi ? 14 : 9);
      leg.translate(s * hx, hy, 0.004);
      parts.add(leg, {
        color: (c, x, y, z) => c.set(Math.abs(x - s * hx) > 0.085 && Math.sign(x - s * hx) === s && y > hy - 0.27 ? jersey : '#2a2e35'),
        pbr: PBR.fabric,
        bone,
      });
    }
    return keep(parts.build({ skinned: true }));
  });
}

let kitMat = null;
function kitMaterial() {
  if (!kitMat) kitMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide }));
  return kitMat;
}

// Pièces du VTT pour DetailedRider : géométries du cadre, de la direction, des roues et poignets sur les poignées.
export function mtbBike(G, { bike, jersey, quality }) {
  const q = QS[quality] ? quality : 'high';
  return {
    frame: frame(G, bike, jersey, q),
    steer: steer(G, bike, q),
    wheel: (rear) => wheel(G, rear, q),
    // Poignets sur les poignées du cintre plat (repère de la direction)
    wrists: [-1, 1].map((s) => V(s * 0.33, G.CLAMP.y + 0.07, G.CLAMP.z - 0.05).applyMatrix4(G.STEER_INV)),
  };
}

// Casque et short : maillage « skinné » qui suit le squelette du corps (même groupe que lui).
export function mtbKit(body, { helmet, jersey, quality }) {
  const q = QS[quality] ? quality : 'high';
  const mesh = new THREE.SkinnedMesh(kitGeometry(helmet, jersey, q), kitMaterial());
  mesh.bind(body.skeleton, new THREE.Matrix4());
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);
  mesh.castShadow = true;
  return mesh;
}
