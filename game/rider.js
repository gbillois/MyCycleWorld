// Cycliste détaillé (graphismes détaillés) : vélo de route complet (cadre carbone profilé, roues à jantes hautes
// ou lenticulaire, cassette, plateaux, chaîne, dérailleurs, cintre guidoliné, bidons) et cycliste « skinné »
// (un seul maillage, os placés par cinématique inverse) qui pédale, respire, se met en danseuse et se couche
// dans les descentes rapides.
// Même interface que RiderModel (models.js) : group, setCrank, spinWheels, label, plus setSteer, setPose
// et setMotion (facultatif : vitesse, pente, puissance).
// Repère local : +Z = avant, +Y = haut, +X = côté gauche du coureur.
import * as THREE from 'three';
import { makeLabel } from './models.js';
import {
  Parts, PBR, sweep, keep, pbrLut, hash, shade, contrast, SKINS, B, BODY, bindPositions, bodyGeometry, bodyMaterial,
  makeBody, ik2, orient, defaultQuality,
} from './figure.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const AX = V(1, 0, 0);
const AZ = V(0, 0, 1);

// --- Géométrie du vélo (m) ---
const BB = V(0, 0.3, -0.02);
const REAR = V(0, 0.335, -0.42);
const FRONT = V(0, 0.335, 0.58);
const HEAD_ANGLE = (73 * Math.PI) / 180;
const AXIS = V(0, Math.sin(HEAD_ANGLE), -Math.cos(HEAD_ANGLE)); // axe de direction (vers le haut)
const HT_BOT = V(0, 0.7, 0.42);
const HT_TOP = HT_BOT.clone().addScaledVector(AXIS, 0.16);
const ST_DIR = V(0, 0.9588, -0.284).normalize();
const SC = BB.clone().addScaledVector(ST_DIR, 0.52); // nœud de selle
const SADDLE = BB.clone().addScaledVector(ST_DIR, 0.715);
const STEM_TOP = HT_TOP.clone().addScaledVector(AXIS, 0.038);
const STEM_DIR = V(0, Math.sin(0.12), Math.cos(0.12));
const CLAMP = STEM_TOP.clone().addScaledVector(STEM_DIR, 0.105);
const CRANK = 0.17;
const PEDAL_X = 0.115;
const WHEEL_R = 0.335;

// Repère de la direction : origine au bas de la douille, +Y le long de l'axe.
const STEER_Q = new THREE.Quaternion().setFromUnitVectors(UP, AXIS);
const STEER_M = new THREE.Matrix4().compose(HT_BOT, STEER_Q, V(1, 1, 1));
const STEER_INV = STEER_M.clone().invert();

// Poses du bassin (centre des hanches) : assis, en danseuse
const HIP_SIT = V(0, 1.065, -0.225);
const HIP_STAND = V(0, 1.072, 0.055);

const QS = {
  high: { tube: 12, seg: 12, rim: 56, tyre: 8, spokes: [18, 22], cogs: 11, teeth: true, chain: 120, bar: 56 },
  medium: { tube: 8, seg: 10, rim: 36, tyre: 7, spokes: [16, 18], cogs: 6, teeth: true, chain: 70, bar: 36 },
  low: { tube: 6, seg: 6, rim: 24, tyre: 6, spokes: [10, 12], cogs: 3, teeth: false, chain: 40, bar: 24 },
};

const cache = new Map();
function cached(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}
const CR = (pts, closed = false) => new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
const line = (a, b) => new THREE.LineCurve3(a, b);
const taper = (a, b, c = a, d = b) => (t) => [a + (c - a) * t, b + (d - b) * t];

// Oriente une géométrie construite le long de +Y vers une direction, puis la place.
function along(geo, dir, at) {
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
  return geo.translate(at.x, at.y, at.z);
}
function cylX(r, len, seg, x, y, z) {
  return new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2).translate(x, y, z);
}

// --- Textures d'autocollants ---
// Cadre : moitié haute blanche (pièces sans décor), moitié basse = tube diagonal (couleur + logo des deux côtés).
function frameDecal(bike, accent) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 64);
  ctx.fillStyle = bike;
  ctx.fillRect(0, 64, 512, 64);
  const text = contrast(bike) === '#ffffff' ? '#ffffff' : '#16171b';
  // côté gauche (v = 0.25 -> y = 112) et côté droit (v = 0.75 -> y = 80)
  // côté gauche : lecture de l'avant vers l'arrière ; côté droit : du pédalier vers la douille (lettres non inversées)
  for (const [cy, sx, sy] of [[112, -2.6, 1], [80, 2.6, -1]]) {
    ctx.save();
    ctx.translate(256, cy);
    ctx.scale(sx, sy);
    ctx.fillStyle = accent;
    ctx.fillRect(-82, -9, 10, 18);
    ctx.fillStyle = text;
    ctx.font = 'italic 900 21px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MYCYCLE', 0, 1);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
// Jantes : carbone sombre et logo blanc ; moitié haute = flanc gauche, moitié basse = flanc droit.
function rimDecal() {
  return cached('rimDecal', () => {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = '#26272c';
    ctx.fillRect(0, 2, 512, 28);
    ctx.fillRect(0, 34, 512, 28);
    ctx.fillStyle = '#e9e9e9';
    ctx.font = 'italic 900 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [cy, flip] of [[16, 1], [48, -1]]) {
      for (const cx of [128, 384]) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(flip, flip);
        ctx.fillText('MCW  AERO 50', 0, 1);
        ctx.restore();
      }
    }
    const tex = keep(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  });
}

function pbrMaterial(map, quality) {
  const lut = pbrLut();
  const common = { vertexColors: true, map, roughness: 1, metalness: 1, roughnessMap: lut, metalnessMap: lut };
  if (quality === 'high') return new THREE.MeshPhysicalMaterial({ ...common, clearcoat: 1, clearcoatMap: lut, clearcoatRoughness: 0.12 });
  return new THREE.MeshStandardMaterial(common);
}
const wheelMaterial = (q) => cached('wheelMat' + q, () => keep(pbrMaterial(rimDecal(), q)));
const frameMaterial = (bike, accent, q) => cached(`frameMat${bike}${accent}${q}`, () => keep(pbrMaterial(keep(frameDecal(bike, accent)), q)));

// --- Roues ---
function wheelGeometry(kind, rear, q) {
  return cached(`wheel${kind}${rear}${q}`, () => {
    const Q = QS[q];
    const parts = new Parts();
    const toX = (g) => g.rotateZ(-Math.PI / 2);
    // Pneu
    parts.add(new THREE.TorusGeometry(0.3215, 0.0138, Q.tyre, Q.rim).rotateY(Math.PI / 2), {
      color: (c, x, y, z) => c.set(Math.abs(x) > 0.009 && Math.hypot(y, z) < 0.326 ? '#2a2724' : '#1a1b1e'),
      pbr: PBR.rubber,
    });
    // Jante haute (profil en V) avec logo sur les flancs
    const prof = [[0.311, -0.0118], [0.298, -0.0137], [0.276, -0.0124], [0.264, -0.006], [0.264, 0.006], [0.276, 0.0124], [0.298, 0.0137], [0.311, 0.0118], [0.311, -0.0118]];
    const rimDepth = kind === 'disc' ? prof : prof;
    const rim = toX(new THREE.LatheGeometry(rimDepth.map(([r, y]) => new THREE.Vector2(r, y)), Q.rim));
    const decalUV = (x, y, z, u) => {
      const r = Math.hypot(y, z);
      const f = Math.min(1, Math.max(0, (r - 0.268) / 0.04));
      if (Math.abs(x) < 0.006 || r > 0.309) return [0.004, 0.996];
      return [u, x > 0 ? 1 - (0.06 + f * 0.36) : 0.06 + f * 0.36];
    };
    parts.add(rim, { color: '#ffffff', pbr: PBR.carbon, uvFn: decalUV });
    if (kind === 'disc') {
      // Roue lenticulaire : deux flancs bombés du moyeu à la jante
      const lens = [];
      for (let k = 0; k <= 10; k++) {
        const r = 0.03 + (0.265 - 0.03) * (k / 10);
        lens.push(new THREE.Vector2(r, -(0.026 - 0.016 * Math.pow(k / 10, 1.4))));
      }
      for (let k = 10; k >= 0; k--) lens.push(new THREE.Vector2(lens[k].x, -lens[k].y));
      const disc = toX(new THREE.LatheGeometry(lens, Q.rim));
      parts.add(disc, {
        color: '#ffffff',
        pbr: PBR.carbon,
        uvFn: (x, y, z, u) => {
          const r = Math.hypot(y, z);
          const f = Math.min(1, Math.max(0, (r - 0.15) / 0.11));
          return r < 0.15 ? [0.5, 0.75] : [u, x > 0 ? 1 - (0.06 + f * 0.36) : 0.06 + f * 0.36];
        },
      });
    } else {
      // Rayons (plats) du moyeu à la jante, alternés gauche / droite
      const n = Q.spokes[rear ? 1 : 0];
      for (let k = 0; k < n; k++) {
        const a = ((k + 0.5) / n) * Math.PI * 2;
        const side = k % 2 ? 1 : -1;
        const from = V(side * 0.027, Math.sin(a) * 0.024, Math.cos(a) * 0.024);
        const to = V(side * 0.004, Math.sin(a + side * 0.04) * 0.264, Math.cos(a + side * 0.04) * 0.264);
        const dir = to.clone().sub(from);
        const sp = new THREE.CylinderGeometry(0.0014, 0.0014, dir.length(), 3, 1, true).scale(1, 1, 1.8).translate(0, dir.length() / 2, 0);
        parts.add(along(sp, dir, from), { color: '#2b2c31', pbr: PBR.alu });
      }
    }
    // Moyeu, flasques, axe
    parts.add(toX(new THREE.LatheGeometry([[0.006, -0.055], [0.014, -0.05], [0.016, -0.03], [0.025, -0.029], [0.025, -0.025], [0.017, -0.023], [0.015, 0], [0.017, 0.023], [0.025, 0.025], [0.025, 0.029], [0.016, 0.03], [0.014, 0.05], [0.006, 0.055]].map(([r, y]) => new THREE.Vector2(r, y)), 14)), { color: '#2a2b30', pbr: PBR.alu });
    // Disque de frein côté gauche (+X)
    const rotor = new THREE.RingGeometry(0.058, 0.08, 32, 1);
    const rotorCol = (c, x, y, z) => {
      const r = Math.hypot(y, z);
      const a = Math.atan2(y, z);
      c.set(r > 0.062 && r < 0.076 && Math.sin(a * 18) > 0.3 ? '#6d7078' : '#b9bdc4');
    };
    parts.add(rotor.clone().rotateY(Math.PI / 2).translate(0.048, 0, 0), { color: rotorCol, pbr: PBR.chrome });
    parts.add(rotor.rotateY(-Math.PI / 2).translate(0.046, 0, 0), { color: rotorCol, pbr: PBR.chrome });
    parts.add(new THREE.CylinderGeometry(0.06, 0.06, 0.003, 6).rotateZ(Math.PI / 2).translate(0.047, 0, 0), { color: '#202126', pbr: PBR.alu });
    if (rear) {
      // Cassette côté droit (-X) : pignons du plus grand (près des rayons) au plus petit
      const n = Q.cogs;
      for (let k = 0; k < n; k++) {
        const f = k / Math.max(1, n - 1);
        const r = 0.066 - f * 0.04;
        parts.add(cylX(r, 0.0022, q === 'high' ? 20 : 12, -0.022 - f * 0.036, 0, 0), { color: k % 2 ? '#c6c9cf' : '#aeb2b9', pbr: PBR.chrome });
      }
      parts.add(cylX(0.02, 0.04, 10, -0.04, 0, 0), { color: '#55585f', pbr: PBR.alu });
    }
    return keep(parts.build());
  });
}

// --- Pédalier (tourne autour de X, à l'origine du boîtier) ---
function chainringShape(teeth, rOut, rIn, hole) {
  const s = new THREE.Shape();
  if (teeth) {
    for (let k = 0; k < teeth * 2; k++) {
      const a = (k / (teeth * 2)) * Math.PI * 2;
      const r = k % 2 ? rIn : rOut;
      if (k === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
  } else {
    s.absarc(0, 0, rOut, 0, Math.PI * 2, false);
  }
  const h = new THREE.Path();
  h.absarc(0, 0, hole, 0, Math.PI * 2, true);
  s.holes.push(h);
  return s;
}
function crankGeometry(q) {
  return cached('crank' + q, () => {
    const Q = QS[q];
    const parts = new Parts();
    const ring = (teeth, rOut, rIn, hole, x, color) => {
      const g = new THREE.ExtrudeGeometry(chainringShape(Q.teeth ? teeth : 0, rOut, rIn, hole), { depth: 0.003, bevelEnabled: false, curveSegments: Q.teeth ? 4 : 10 });
      g.rotateY(Math.PI / 2).translate(x, 0, 0);
      parts.add(g, { color, pbr: PBR.alu });
    };
    ring(52, 0.106, 0.1, 0.086, -0.047, '#2b2c31');
    ring(36, 0.075, 0.069, 0.055, -0.04, '#8d9199');
    // Araignée à 4 branches
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const arm = new THREE.BoxGeometry(0.008, 0.016, 0.09).translate(0, 0, 0.045);
      arm.rotateX(-a).translate(-0.043, 0, 0);
      parts.add(arm, { color: '#1d1e23', pbr: PBR.carbon });
    }
    // Manivelles profilées : droite vers +Z, gauche vers -Z
    for (const s of [-1, 1]) {
      const x = s * 0.07;
      const dir = s < 0 ? 1 : -1;
      const g = sweep(line(V(x, 0, 0), V(x + s * 0.006, 0, dir * CRANK)), { segs: 4, radial: Q.tube, radius: taper(0.009, 0.02, 0.007, 0.012), caps: true });
      parts.add(g, { color: '#18191d', pbr: PBR.carbon });
      parts.add(cylX(0.012, 0.016, 12, x, 0, dir * CRANK), { color: '#9a9ea6', pbr: PBR.alu });
      parts.add(cylX(0.019, 0.012, 14, x, 0, 0), { color: '#9a9ea6', pbr: PBR.alu });
    }
    parts.add(cylX(0.012, 0.15, 10, 0, 0, 0), { color: '#5b5e66', pbr: PBR.alu });
    return keep(parts.build());
  });
}

// --- Cadre (statique), propre à chaque coureur (couleurs dans les sommets) ---
function frameGeometry(bike, jersey, helmet, q) {
  return cached(`frame${bike}${jersey}${helmet}${q}`, () => {
    const Q = QS[q];
    const parts = new Parts();
    const stays = shade(bike, -0.35);
    const paint = { color: bike, pbr: PBR.paint };
    const tube = (curve, radius, opts = paint, ref = AX, segs = Q.seg) => parts.add(sweep(curve, { segs, radial: Q.tube, radius, ref }), opts);

    // Douille de direction (plus large en bas), bande de couleur
    tube(line(HT_BOT.clone().addScaledVector(AXIS, -0.018), HT_TOP.clone().addScaledVector(AXIS, 0.004)), taper(0.03, 0.03, 0.024, 0.024), paint, AX, 2);
    // Tube horizontal (incliné vers l'arrière)
    const ttFront = HT_BOT.clone().addScaledVector(AXIS, 0.128);
    tube(CR([ttFront, V(0, 0.818, 0.12), V(0, 0.806, -0.08), SC.clone().add(V(0, 0.01, 0.005))]), taper(0.017, 0.023, 0.013, 0.016));
    // Tube diagonal aéro avec logo (l'axe rx est ici dans le plan, ry latéral)
    const dtFrom = BB.clone().add(V(0, 0.028, 0.02));
    const dtTo = HT_BOT.clone().addScaledVector(AXIS, 0.03);
    const dtDir = dtTo.clone().sub(dtFrom).normalize();
    const under = V(0, -dtDir.z, dtDir.y);
    parts.add(sweep(CR([dtFrom, dtFrom.clone().lerp(dtTo, 0.5).add(V(0, -0.006, 0.004)), dtTo]), { segs: Q.seg, radial: Q.tube + 2, radius: (t) => [0.03 - 0.004 * t, 0.024 - 0.003 * t + (t < 0.1 ? (0.1 - t) * 0.08 : 0)], ref: under }), {
      color: '#ffffff',
      pbr: PBR.decal,
      uvFn: (x, y, z, u, v) => [0.02 + u * 0.96, 0.5 * v],
    });
    // Tube de selle, découpé autour de la roue
    tube(CR([BB.clone().add(V(0, 0.02, 0)), V(0, 0.42, -0.044), V(0, 0.62, -0.112), SC]), taper(0.019, 0.027, 0.016, 0.022));
    // Boîtier
    parts.add(cylX(0.026, 0.08, Q.tube + 4, 0, BB.y, BB.z), paint);
    // Bases et haubans (bicolores), pattes et axe
    for (const s of [-1, 1]) {
      tube(CR([V(s * 0.028, 0.296, -0.045), V(s * 0.052, 0.305, -0.2), V(s * 0.063, 0.33, -0.402)]), taper(0.011, s < 0 ? 0.019 : 0.016, 0.008, 0.01), { color: stays, pbr: PBR.paint });
      tube(CR([V(s * 0.014, 0.722, -0.142), V(s * 0.045, 0.54, -0.27), V(s * 0.063, 0.345, -0.41)]), taper(0.009, 0.013, 0.007, 0.008), { color: stays, pbr: PBR.paint });
      parts.add(new THREE.BoxGeometry(0.008, 0.045, 0.035).translate(s * 0.064, REAR.y + 0.005, REAR.z + 0.004), { color: '#1c1d21', pbr: PBR.carbon });
    }
    parts.add(cylX(0.007, 0.15, 8, 0, REAR.y, REAR.z), { color: '#2c2d33', pbr: PBR.alu });
    // Tige de selle aéro + chariot + selle profilée
    const postTop = BB.clone().addScaledVector(ST_DIR, 0.69);
    tube(line(SC.clone().addScaledVector(ST_DIR, -0.03), postTop), taper(0.012, 0.019, 0.011, 0.017), { color: '#1b1c20', pbr: PBR.carbon }, AX, 2);
    parts.add(new THREE.BoxGeometry(0.03, 0.016, 0.05).translate(postTop.x, postTop.y + 0.008, postTop.z), { color: '#202126', pbr: PBR.alu });
    for (const s of [-1, 1]) {
      tube(CR([V(s * 0.02, SADDLE.y - 0.022, SADDLE.z + 0.1), V(s * 0.022, SADDLE.y - 0.03, SADDLE.z), V(s * 0.028, SADDLE.y - 0.022, SADDLE.z - 0.1)]), () => [0.0035, 0.0035], { color: '#8a8e96', pbr: PBR.chrome }, AX, 6);
    }
    parts.add(saddleGeometry(), { color: (c, x, y, z) => c.set(z < SADDLE.z - 0.105 && Math.abs(x) < 0.05 ? jersey : y < SADDLE.y - 0.006 ? '#2a2b30' : '#16171b'), pbr: PBR.satin });
    // Bidons et porte-bidons (sur le diagonal et sur le tube de selle)
    const bottle = (base, dir, side, col) => {
      const g = new THREE.LatheGeometry(
        [[0, 0], [0.031, 0], [0.036, 0.01], [0.036, 0.075], [0.032, 0.095], [0.036, 0.115], [0.036, 0.175], [0.031, 0.192], [0.017, 0.202], [0.013, 0.218], [0.007, 0.226], [0, 0.228]].map(([r, y]) => new THREE.Vector2(r, y)),
        q === 'low' ? 8 : 14,
      );
      const center = base.clone().addScaledVector(side, 0.024 + 0.036);
      along(g, dir, center.addScaledVector(dir, -0.11));
      const top = center.clone().addScaledVector(dir, 0.19);
      parts.add(g, {
        color: (c, x, y, z) => {
          const t = (x - center.x) * dir.x + (y - center.y) * dir.y + (z - center.z) * dir.z;
          const p = V(x, y, z);
          c.set(p.distanceTo(top) < 0.045 && t > 0.185 ? '#1a1b1f' : t > 0.085 && t < 0.165 ? col : '#f2f2ee');
        },
        pbr: PBR.plastic,
      });
      // porte-bidon : deux tiges noires qui enserrent le bidon
      for (const o of [-1, 1]) {
        const a = base.clone().addScaledVector(dir, -0.06).addScaledVector(side, 0.012);
        const b = base.clone().addScaledVector(dir, 0.07).addScaledVector(side, 0.04).add(V(o * 0.034, 0, 0));
        tube(CR([a, a.clone().lerp(b, 0.5).add(V(o * 0.03, 0, 0)), b]), () => [0.0028, 0.0028], { color: '#1a1b1f', pbr: PBR.carbon }, UP, 6);
      }
    };
    const dtMid = dtFrom.clone().lerp(dtTo, 0.46);
    bottle(dtMid, dtDir, V(0, dtDir.z, -dtDir.y).negate().multiplyScalar(-1), jersey);
    const stMid = BB.clone().addScaledVector(ST_DIR, 0.27);
    bottle(stMid, ST_DIR, V(0, ST_DIR.z, -ST_DIR.y).negate(), helmet === '#ffffff' ? '#2b6cff' : helmet);
    // Chaîne (boucle fermée, maillons suggérés par l'alternance de couleurs)
    const cx = -0.044;
    const chain = CR([
      V(cx, 0.406, -0.02), V(cx, 0.398, -0.16), V(cx, 0.388, -0.3), V(cx, 0.38, -0.42), V(cx, 0.365, -0.452), V(cx, 0.335, -0.466), V(cx, 0.302, -0.455),
      V(cx, 0.288, -0.438), V(cx, 0.262, -0.418), V(cx, 0.232, -0.428), V(cx, 0.206, -0.412), V(cx, 0.198, -0.3), V(cx, 0.196, -0.12), V(cx, 0.197, -0.02),
      V(cx, 0.225, 0.06), V(cx, 0.3, 0.086), V(cx, 0.375, 0.06),
    ], true);
    parts.add(sweep(chain, { segs: Q.chain, radial: 4, radius: () => [0.0035, 0.0048], ref: AX }), {
      color: (c, x, y, z, u) => c.set(Math.floor(u * Q.chain) % 2 ? '#9a9ea6' : '#3b3d43'),
      pbr: PBR.chrome,
    });
    // Dérailleur arrière : chape, galets, corps
    for (const [y, z] of [[0.288, -0.43], [0.218, -0.413]]) parts.add(cylX(0.016, 0.006, 12, cx, y, z), { color: '#1c1d21', pbr: PBR.plastic });
    for (const o of [-1, 1]) parts.add(sweep(line(V(cx + o * 0.006, 0.292, -0.432), V(cx + o * 0.006, 0.212, -0.41)), { segs: 1, radial: 6, radius: () => [0.002, 0.021], caps: true }), { color: '#2a2b30', pbr: PBR.alu });
    parts.add(new THREE.BoxGeometry(0.022, 0.05, 0.03).rotateX(0.5).translate(cx - 0.016, 0.32, -0.445), { color: '#25262b', pbr: PBR.alu });
    // Dérailleur avant (plaque sur le tube de selle) et étriers de frein (côté gauche)
    parts.add(new THREE.BoxGeometry(0.012, 0.024, 0.07).rotateX(-0.28).translate(-0.034, 0.43, -0.07), { color: '#25262b', pbr: PBR.alu });
    parts.add(new THREE.BoxGeometry(0.018, 0.04, 0.05).rotateX(0.7).translate(0.07, 0.4, -0.37), { color: '#1a1b1f', pbr: PBR.alu });
    return keep(parts.build());
  });
}

// Selle : contour extrudé avec arrondis, cambrée, bec relevé
function saddleGeometry() {
  return cached('saddleShape', () => {
    const half = [[0.0, 0.135], [0.016, 0.13], [0.021, 0.08], [0.028, 0.03], [0.05, -0.03], [0.066, -0.08], [0.07, -0.11], [0.062, -0.135], [0.0, -0.142]];
    const s = new THREE.Shape();
    half.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
    for (let i = half.length - 2; i > 0; i--) s.lineTo(-half[i][0], -half[i][1]);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const z = P.getZ(i);
      P.setY(i, P.getY(i) - 0.012 + 0.6 * (z * z) * (z > 0 ? 0.4 : 1) - (z > 0.09 ? (z - 0.09) * 0.15 : 0));
    }
    g.computeVertexNormals();
    return g.translate(SADDLE.x, SADDLE.y, SADDLE.z);
  }).clone();
}

// --- Direction : fourche, potence, cintre guidoliné, cocottes, compteur (construit en repère vélo puis ramené au repère de la direction) ---
const HOOD = (s) => V(s * 0.203, CLAMP.y + 0.012, CLAMP.z + 0.085);
function steerGeometry(bike, accent, q) {
  return cached(`steer${bike}${accent}${q}`, () => {
    const Q = QS[q];
    const parts = new Parts();
    const black = { color: '#17181c', pbr: PBR.carbon };
    // Fourche : té, fourreaux profilés incurvés vers l'avant
    const crown = HT_BOT.clone().addScaledVector(AXIS, -0.014);
    parts.add(sweep(line(crown.clone().add(V(-0.045, 0, 0)), crown.clone().add(V(0.045, 0, 0))), { segs: 1, radial: Q.tube, radius: () => [0.024, 0.016], ref: UP, caps: true }), { color: bike, pbr: PBR.paint });
    for (const s of [-1, 1]) {
      parts.add(sweep(CR([crown.clone().add(V(s * 0.034, -0.012, 0.004)), V(s * 0.05, 0.53, 0.5), V(s * 0.056, FRONT.y + 0.004, FRONT.z)]), { segs: Q.seg, radial: Q.tube, radius: taper(0.011, 0.021, 0.007, 0.011), ref: AX }), { color: (c, x, y) => c.set(y < 0.42 ? shade(bike, -0.35) : bike), pbr: PBR.paint });
      parts.add(new THREE.BoxGeometry(0.008, 0.035, 0.03).translate(s * 0.057, FRONT.y + 0.006, FRONT.z), black);
    }
    parts.add(cylX(0.007, 0.14, 8, 0, FRONT.y, FRONT.z), { color: '#2c2d33', pbr: PBR.alu });
    parts.add(new THREE.BoxGeometry(0.018, 0.04, 0.05).rotateX(-0.4).translate(0.07, FRONT.y + 0.06, FRONT.z - 0.03), { color: '#1a1b1f', pbr: PBR.alu });
    // Entretoises et capot de direction, potence
    parts.add(along(new THREE.CylinderGeometry(0.019, 0.02, 0.04, Q.tube + 2), AXIS, HT_TOP.clone().addScaledVector(AXIS, 0.0)).translate(0, 0, 0), black);
    parts.add(sweep(line(STEM_TOP.clone().addScaledVector(STEM_DIR, -0.02), CLAMP.clone().addScaledVector(STEM_DIR, 0.012)), { segs: 2, radial: Q.tube, radius: taper(0.017, 0.022, 0.015, 0.02), ref: AX, caps: true }), black);
    // Cintre : tops, courbe vers les cocottes, cintre bas ; guidoline à bandes en spirale
    const half = (s) => [
      V(s * 0.06, CLAMP.y, CLAMP.z), V(s * 0.14, CLAMP.y, CLAMP.z + 0.002), V(s * 0.188, CLAMP.y + 0.001, CLAMP.z + 0.012), V(s * 0.2, CLAMP.y + 0.0, CLAMP.z + 0.045),
      V(s * 0.203, CLAMP.y - 0.006, CLAMP.z + 0.08), V(s * 0.205, CLAMP.y - 0.04, CLAMP.z + 0.1), V(s * 0.207, CLAMP.y - 0.088, CLAMP.z + 0.088),
      V(s * 0.21, CLAMP.y - 0.12, CLAMP.z + 0.042), V(s * 0.213, CLAMP.y - 0.131, CLAMP.z - 0.015), V(s * 0.215, CLAMP.y - 0.133, CLAMP.z - 0.06),
    ];
    const bar = CR([...half(1).reverse(), V(0, CLAMP.y, CLAMP.z), ...half(-1)]);
    const tapeCol = (hash(bike + accent) & 3) === 0 ? '#ececea' : '#1a1b20';
    parts.add(sweep(bar, { segs: Q.bar, radial: Q.tube, radius: (t) => (Math.abs(t - 0.5) < 0.09 ? [0.0145, 0.0145] : [0.0128, 0.0128]), ref: UP, caps: true }), {
      color: (c, x, y, z, u, v) => {
        if (Math.abs(x) < 0.07) return c.set('#1d1e22');
        const stripe = (u * 90 + v) % 1;
        c.set(stripe < 0.1 ? (tapeCol === '#1a1b20' ? '#34363d' : '#c4c4c2') : tapeCol);
      },
      pbr: PBR.fabric,
    });
    // Cocottes et leviers
    for (const s of [-1, 1]) {
      const h = HOOD(s);
      const hood = new THREE.SphereGeometry(1, Q.tube, 8).scale(0.017, 0.022, 0.042).rotateX(-0.35).translate(h.x, h.y, h.z);
      parts.add(hood, { color: '#141518', pbr: PBR.rubber });
      parts.add(new THREE.SphereGeometry(0.014, 8, 6).translate(h.x, h.y + 0.022, h.z + 0.032), { color: '#141518', pbr: PBR.rubber });
      parts.add(sweep(CR([V(h.x, h.y + 0.004, h.z + 0.035), V(h.x + s * 0.002, h.y - 0.05, h.z + 0.04), V(h.x + s * 0.004, h.y - 0.11, h.z + 0.012)]), { segs: 6, radial: 6, radius: taper(0.006, 0.012, 0.004, 0.008), ref: AX }), { color: '#2a2b30', pbr: PBR.alu });
    }
    // Compteur devant la potence
    parts.add(new THREE.BoxGeometry(0.012, 0.012, 0.07).translate(0, CLAMP.y - 0.01, CLAMP.z + 0.04), black);
    parts.add(new THREE.BoxGeometry(0.05, 0.016, 0.075).rotateX(-0.12).translate(0, CLAMP.y + 0.006, CLAMP.z + 0.085), { color: '#1b1c20', pbr: PBR.plastic });
    parts.add(new THREE.BoxGeometry(0.04, 0.002, 0.058).rotateX(-0.12).translate(0, CLAMP.y + 0.015, CLAMP.z + 0.085), { color: '#4d6a7a', pbr: PBR.glass });
    const geo = parts.build();
    geo.applyMatrix4(STEER_INV);
    return keep(geo);
  });
}

// Ombre « pastille » partagée
let blobRes = null;
function blobResources() {
  if (!blobRes) {
    blobRes = {
      geo: keep(new THREE.CircleGeometry(0.6, 16).rotateX(-Math.PI / 2).scale(0.65, 1, 1.5)),
      mat: keep(new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false })),
    };
  }
  return blobRes;
}

// Vecteurs de travail (aucune allocation par image)
const tV = Array.from({ length: 12 }, () => new THREE.Vector3());
const tQ = Array.from({ length: 6 }, () => new THREE.Quaternion());
const qRoll = new THREE.Quaternion();
const qBike = new THREE.Quaternion();
const PELVIS_HIP = V(0, -BODY.hip[1], 0); // du centre des hanches vers l'origine du bassin

export class DetailedRider {
  constructor({ jersey = '#ff5a1f', bike = '#2b6cff', helmet = '#ffffff', name = '', quality = defaultQuality() } = {}) {
    const q = QS[quality] ? quality : 'high';
    this.quality = q;
    const g = new THREE.Group();
    this.group = g;
    g.userData.rider = this; // accès de débogage (tests automatisés)
    const seed = hash(`${name}|${jersey}|${bike}`);
    const accent = helmet === '#ffffff' || helmet === jersey ? (bike === '#16181d' ? '#ffffff' : bike) : helmet;

    // Vélo (dans un groupe qui peut se balancer sous le coureur en danseuse)
    this.bike = new THREE.Group();
    g.add(this.bike);
    const frameMat = frameMaterial(bike, accent, q);
    this.frame = new THREE.Mesh(frameGeometry(bike, jersey, helmet, q), frameMat);
    this.bike.add(this.frame);
    this.steer = new THREE.Group();
    this.steer.position.copy(HT_BOT);
    this.steer.quaternion.copy(STEER_Q);
    this.bike.add(this.steer);
    this.steer.add(new THREE.Mesh(steerGeometry(bike, accent, q), frameMat));
    const wMat = wheelMaterial(q);
    this.frontWheel = new THREE.Mesh(wheelGeometry('spoke', false, q), wMat);
    this.frontWheel.position.copy(FRONT).applyMatrix4(STEER_INV);
    this.steer.add(this.frontWheel);
    this.rearWheel = new THREE.Mesh(wheelGeometry(seed % 3 === 1 ? 'disc' : 'spoke', true, q), wMat);
    this.rearWheel.position.copy(REAR);
    this.bike.add(this.rearWheel);
    this.crankset = new THREE.Mesh(crankGeometry(q), wMat);
    this.crankset.position.copy(BB);
    this.bike.add(this.crankset);
    this.bike.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });

    // Cycliste
    const skin = SKINS[seed % SKINS.length];
    const number = name ? 2 + (seed % 97) : 1;
    const body = makeBody(bodyGeometry('cyclist', q), bodyMaterial({ kind: 'cyclist', jersey, helmet, accent, skin, number }, q), bindPositions());
    this.body = body.mesh;
    this.bones = body.bones;
    g.add(this.body);

    // Ombre « pastille », utilisée seulement sans ombres portées
    const br = blobResources();
    this.blob = new THREE.Mesh(br.geo, br.mat);
    this.blob.position.y = 0.06;
    g.add(this.blob);

    if (name) {
      this.label = makeLabel(name, jersey);
      this.label.position.set(0, 2.2, 0);
      g.add(this.label);
    }
    // Points d'appui des mains (poignets) dans le repère de la direction
    this.wristLocal = [-1, 1].map((s) => V(s * 0.198, CLAMP.y + 0.05, CLAMP.z + 0.035).applyMatrix4(STEER_INV));
    this.standing = 0;
    this.crankAngle = 0;
    this.steerAngle = 0;
    this.tuck = 0;
    this.tuckTarget = 0;
    this.effort = 0.5;
    this.phase = (seed % 1000) / 160;
    this._t = 0;
    this.hip = HIP_SIT.clone();
    this.update();
  }

  // Les réglages (pose, braquage, mouvement) sont mémorisés ; la pose complète est recalculée par setCrank,
  // appelé une fois par image après eux (un seul passage d'IK par coureur et par image).
  // 0 = assis, 1 = en danseuse (côtes). Valeur lissée par l'appelant.
  setPose(standing) {
    this.standing = standing;
  }

  // Angle du pédalier (radians, croissant quand on pédale)
  setCrank(angle) {
    this.crankAngle = angle;
    this.update();
  }

  // Braquage de la direction (radians, + = vers la droite du coureur)
  setSteer(angle) {
    this.steerAngle = angle;
  }

  // Facultatif : vitesse (m/s), pente (%), puissance (W). Position aérodynamique dans les descentes rapides.
  setMotion(v = 0, grade = 0, power = 0) {
    this.tuckTarget = v > 11.5 && grade < -3 ? 1 : 0;
    this.effort = Math.min(1, Math.max(0, power / 380));
  }

  spinWheels(dAngle) {
    this.rearWheel.rotation.x += dAngle;
    this.frontWheel.rotation.x += dAngle;
  }

  update() {
    const now = performance.now() / 1000;
    const dt = this._t ? Math.min(0.1, Math.max(0, now - this._t)) : 0;
    this._t = now;
    this.tuck += (this.tuckTarget - this.tuck) * (1 - Math.exp(-dt * 2.2));
    const st = this.standing;
    const tk = this.tuck * (1 - st);
    const crank = this.crankAngle;
    const bones = this.bones;

    // Balancement du vélo en danseuse (le corps reste presque droit)
    const sway = Math.sin(crank) * st;
    this.bike.rotation.z = -0.17 * sway;
    this.bike.updateMatrix();
    qBike.setFromAxisAngle(AZ, this.bike.rotation.z);
    this.steer.quaternion.copy(STEER_Q).multiply(tQ[0].setFromAxisAngle(UP, -this.steerAngle));
    this.steer.updateMatrix();
    this.crankset.rotation.x = crank;

    // Bassin et buste
    const breathe = Math.sin(now * (2.2 + this.effort * 2.4) + this.phase) * (0.4 + this.effort);
    const hipC = tV[0].lerpVectors(HIP_SIT, HIP_STAND, st);
    hipC.z -= 0.035 * tk;
    hipC.y -= 0.004 * tk;
    hipC.x += 0.025 * sway;
    hipC.y += Math.abs(Math.cos(crank)) * 0.012 * st;
    const leanP = 0.92 - 0.1 * st + 0.3 * tk;
    const leanC = 1.14 - 0.04 * st + 0.3 * tk + breathe * 0.012 + Math.abs(Math.sin(crank)) * 0.06 * st;
    const rock = Math.sin(crank) * 0.03 * (1 - st);
    qRoll.setFromAxisAngle(AZ, -0.05 * sway + rock);
    const qP = tQ[1].setFromAxisAngle(AX, leanP).premultiply(qRoll);
    const qC = tQ[2].setFromAxisAngle(AX, leanC);
    qC.multiply(tQ[3].setFromAxisAngle(UP, -rock * 1.6)).premultiply(qRoll);
    const pelvisPos = tV[1].copy(PELVIS_HIP).applyQuaternion(qP).add(hipC);
    bones[B.pelvis].position.copy(pelvisPos);
    bones[B.pelvis].quaternion.copy(qP);
    const chestPos = tV[2].set(0, BODY.chestY, 0).applyQuaternion(qP).add(pelvisPos);
    bones[B.chest].position.copy(chestPos);
    bones[B.chest].quaternion.copy(qC);
    const bs = 1 + breathe * 0.012;
    bones[B.chest].scale.set(bs, 1, 1 + breathe * 0.02);

    // Tête : regarde la route, tourne un peu dans les virages
    const headPos = tV[3].set(0, BODY.headY - BODY.chestY, 0).applyQuaternion(qC).add(chestPos);
    const qH = tQ[4].setFromAxisAngle(AX, 0.2 + 0.22 * tk - 0.1 * st + breathe * 0.01);
    qH.premultiply(tQ[5].setFromAxisAngle(UP, -this.steerAngle * 0.9));
    bones[B.head].position.copy(headPos);
    bones[B.head].quaternion.copy(qH);

    // Bras : épaules -> poignets sur les cocottes
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      const [bu, bf, bh] = s > 0 ? [B.upperL, B.foreL, B.handL] : [B.upperR, B.foreR, B.handR];
      const shoulder = tV[4].set(s * BODY.shoulder[0], BODY.shoulder[1] - BODY.chestY, 0).applyQuaternion(qC).add(chestPos);
      const wrist = tV[5].copy(this.wristLocal[i]).applyMatrix4(this.steer.matrix).applyMatrix4(this.bike.matrix);
      const pole = tV[6].set(s * (0.8 + 0.6 * tk), -0.6 - 0.4 * tk, -0.35);
      const elbow = ik2(shoulder, wrist, BODY.upper, BODY.fore, pole, tV[7], tV[8]);
      orient(bones[bu], shoulder, tV[9].subVectors(shoulder, elbow), tV[10].subVectors(tV[8], elbow));
      orient(bones[bf], elbow, tV[9].subVectors(elbow, tV[8]), tV[10].set(-s * 0.3, 1, 0.2));
      const handDir = tV[9].set(0, 0.35, -1).applyQuaternion(qBike);
      orient(bones[bh], tV[8], handDir, tV[10].set(-s * 0.85, 0.38, 0.13));
    }

    // Jambes : hanche -> cheville, pied sur la pédale avec un coup de cheville naturel
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      const [bt, bk, bf] = s > 0 ? [B.thighL, B.shinL, B.footL] : [B.thighR, B.shinR, B.footR];
      const a = -crank + (i ? Math.PI : 0);
      const pedal = tV[4].set(s * PEDAL_X, BB.y + Math.sin(a) * CRANK, BB.z + Math.cos(a) * CRANK).applyMatrix4(this.bike.matrix);
      const pitch = 0.2 - 0.16 * Math.sin(a + 0.5) + 0.12 * st;
      const qF = tQ[3].setFromAxisAngle(AX, pitch).premultiply(qBike);
      const ankle = tV[5].set(0, 0.083, -0.1).applyQuaternion(qF).add(pedal);
      const hipJ = tV[6].set(s * BODY.hip[0], BODY.hip[1], 0).applyQuaternion(qP).add(pelvisPos);
      const pole = tV[7].set(s * 0.12, 0.15, 1);
      const knee = ik2(hipJ, ankle, BODY.thigh, BODY.shin, pole, tV[8], tV[9]);
      orient(bones[bt], hipJ, tV[10].subVectors(hipJ, knee), pole);
      orient(bones[bk], knee, tV[10].subVectors(knee, tV[9]), pole);
      bones[bf].position.copy(tV[9]);
      bones[bf].quaternion.copy(qF);
    }
  }
}
