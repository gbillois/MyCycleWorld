// Cycliste détaillé (graphismes détaillés) : vélo de route complet (cadre carbone profilé, roues à jantes hautes
// ou lenticulaire, cassette, plateaux, chaîne, dérailleurs, cintre guidoliné, bidons) et cycliste « skinné »
// (un seul maillage, os placés par cinématique inverse) qui pédale, respire, se met en danseuse et se couche
// dans les descentes rapides. Animation secondaire : pied à terre et salut au départ, regards (caméra, voisins,
// par-dessus l'épaule quand on l'attaque), transferts de poids, sprint en danseuse dans le bas du cintre avec le
// vélo qui tangue, bidon sur le plat, bras levés à l'arrivée ; chaîne qui défile, roues floues à grande vitesse.
// Même interface que RiderModel (models.js) : group, setCrank, spinWheels, label, plus setSteer, setPose,
// setMotion (facultatif : vitesse, pente, puissance), setRace (temps, caméra, distance restante) et celebrate(place).
// Repère local : +Z = avant, +Y = haut, +X = côté gauche du coureur.
import * as THREE from 'three';
import { makeLabel } from './models.js';
import {
  Parts, PBR, sweep, keep, pbrLut, hash, shade, contrast, SKINS, B, BODY, bindPositions, bodyGeometry, bodyMaterial,
  makeBody, ik2, orient, defaultQuality, poseHeadGear, HairSwing,
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

// Bidon du tube diagonal (dans son porte-bidon) : centre et axe, repère vélo.
const DT_FROM = BB.clone().add(V(0, 0.028, 0.02));
const DT_DIR = HT_BOT.clone().addScaledVector(AXIS, 0.03).sub(DT_FROM).normalize();
const CAGE_POS = DT_FROM.clone().lerp(HT_BOT.clone().addScaledVector(AXIS, 0.03), 0.46).addScaledVector(V(0, DT_DIR.z, -DT_DIR.y), 0.06).addScaledVector(DT_DIR, 0.004);
const CAGE_Q = new THREE.Quaternion().setFromUnitVectors(UP, DT_DIR);

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
// Roues : une seule texture (512 x 128). Haut : jantes carbone avec logo (moitié = un flanc) ;
// puis flancs des pneus (marque et taille) ; en bas, disque flou des rayons à grande vitesse (alpha tramé).
function rimDecal() {
  return cached('rimDecal', () => {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = '#26272c';
    ctx.fillRect(0, 2, 512, 28);
    ctx.fillRect(0, 34, 512, 28);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = (cy, flip, text, font, color) => {
      ctx.fillStyle = color;
      ctx.font = font;
      for (const cx of [128, 384]) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(flip, flip);
        ctx.fillText(text, 0, 1);
        ctx.restore();
      }
    };
    for (const [cy, flip] of [[16, 1], [48, -1]]) label(cy, flip, 'MCW  AERO 50', 'italic 900 18px system-ui, sans-serif', '#e9e9e9');
    // Flancs des pneus : caoutchouc, liseré, marquage gris clair
    ctx.fillStyle = '#1b1c1f';
    ctx.fillRect(0, 64, 512, 32);
    ctx.fillStyle = '#2b2c30';
    ctx.fillRect(0, 70, 512, 2);
    ctx.fillRect(0, 88, 512, 2);
    for (const [cy, flip] of [[72, 1], [88, -1]]) label(cy, flip, 'MCW CORSA  ·  25-622', '800 9px system-ui, sans-serif', '#b9b9b4');
    // Disque flou : voile gris, stries radiales, plus dense près du moyeu
    const img = ctx.createImageData(512, 32);
    for (let y = 0; y < 32; y++) {
      const r = y / 31; // 0 = moyeu, 1 = jante
      for (let x = 0; x < 512; x++) {
        const streak = 0.5 + 0.5 * Math.cos((x / 512) * Math.PI * 2 * 20);
        const a = (0.2 + 0.18 * streak * streak + 0.25 * (1 - r) * (1 - r)) * 255;
        const i = (y * 512 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 52 + 20 * streak;
        img.data[i + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 96);
    const tex = keep(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  });
}

function pbrMaterial(map, quality, extra = {}) {
  const lut = pbrLut();
  const common = { vertexColors: true, map, roughness: 1, metalness: 1, roughnessMap: lut, metalnessMap: lut, ...extra };
  if (quality === 'high') return new THREE.MeshPhysicalMaterial({ ...common, clearcoat: 1, clearcoatMap: lut, clearcoatRoughness: 0.12 });
  return new THREE.MeshStandardMaterial(common);
}
// Roues et pédalier : le disque flou des rayons passe par l'alpha-to-coverage (anticrénelage multiéchantillon) :
// ni tri ni appel de dessin en plus ; sans multiéchantillonnage, il reste un disque gris opaque.
const wheelMaterial = (q) => cached('wheelMat' + q, () => keep(pbrMaterial(rimDecal(), q, { alphaToCoverage: true })));
const frameDecalTex = (bike, accent) => cached(`frameDecal${bike}${accent}`, () => keep(frameDecal(bike, accent)));
// Cadre : matériau propre au coureur (programme partagé) ; les maillons de la chaîne (repérés par uv1.y > 1.5)
// sont dessinés dans le shader et défilent avec le pédalier (uChain = phase des maillons).
const LINKS = 112;
function frameMaterial(bike, accent, q) {
  const mat = pbrMaterial(frameDecalTex(bike, accent), q);
  const chain = { value: 0 };
  mat.userData.chain = chain;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uChain = chain;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vChain;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvChain = uv1.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vChain;\nuniform float uChain;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if ( vChain > 1.5 ) {
          float link = fract( ( vChain - 2.0 ) * ${LINKS.toFixed(1)} + uChain );
          float plate = smoothstep( 0.08, 0.16, link ) * ( 1.0 - smoothstep( 0.5, 0.58, link ) );
          diffuseColor.rgb = mix( vec3( 0.035, 0.036, 0.04 ), vec3( 0.42, 0.44, 0.48 ), plate );
        }`);
  };
  mat.customProgramCacheKey = () => 'frame-chain-' + q;
  return mat;
}

// --- Roues ---
// kind : 'spoke' (rayons), 'disc' (lenticulaire) ou 'blur' (rayons remplacés par un disque flou, à grande vitesse).
function wheelGeometry(kind, rear, q) {
  return cached(`wheel${kind}${rear}${q}`, () => {
    const Q = QS[q];
    const parts = new Parts();
    const toX = (g) => g.rotateZ(-Math.PI / 2);
    // Pneu : flancs marqués (bande du milieu de la texture), bande de roulement sombre
    parts.add(new THREE.TorusGeometry(0.3215, 0.0138, Q.tyre, Q.rim).rotateY(Math.PI / 2), {
      color: '#ffffff',
      pbr: PBR.rubber,
      uvFn: (x, y, z) => {
        const r = Math.hypot(y, z);
        const u = 0.5 + Math.atan2(y, z) / (Math.PI * 2);
        if (Math.abs(x) < 0.006) return [u, 0.255];
        const f = Math.min(1, Math.max(0, (r - 0.311) / 0.022));
        return [u, x > 0 ? 0.5 - 0.002 - f * 0.12 : 0.252 + f * 0.12];
      },
    });
    // Jante haute (profil en V) avec logo sur les flancs
    const prof = [[0.311, -0.0118], [0.298, -0.0137], [0.276, -0.0124], [0.264, -0.006], [0.264, 0.006], [0.276, 0.0124], [0.298, 0.0137], [0.311, 0.0118], [0.311, -0.0118]];
    const rim = toX(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), Q.rim));
    const decalUV = (x, y, z, u) => {
      const r = Math.hypot(y, z);
      const f = Math.min(1, Math.max(0, (r - 0.268) / 0.04));
      if (Math.abs(x) < 0.006 || r > 0.309) return [0.004, 0.998];
      return [u, 0.5 + 0.5 * (x > 0 ? 1 - (0.06 + f * 0.36) : 0.06 + f * 0.36)];
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
          return r < 0.15 ? [0.5, 0.875] : [u, 0.5 + 0.5 * (x > 0 ? 1 - (0.06 + f * 0.36) : 0.06 + f * 0.36)];
        },
      });
    } else if (kind === 'blur') {
      // Disque flou : une face de chaque côté, u = angle autour de l'axe, v = rayon (alpha tramé de la texture)
      const nT = Math.max(16, Q.rim / 2);
      const nR = 3;
      for (const side of [-1, 1]) {
        const pos = [];
        const uv = [];
        const idx = [];
        for (let i = 0; i <= nT; i++) {
          const a = (i / nT) * Math.PI * 2;
          for (let j = 0; j <= nR; j++) {
            const r = 0.026 + (0.266 - 0.026) * (j / nR);
            pos.push(side * (0.004 + 0.02 * (1 - j / nR)), Math.sin(a) * r, Math.cos(a) * r);
            uv.push(i / nT, 0.004 + 0.24 * (j / nR));
          }
        }
        for (let i = 0; i < nT; i++) {
          for (let j = 0; j < nR; j++) {
            const a = i * (nR + 1) + j;
            const b = a + nR + 1;
            if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1);
            else idx.push(a, a + 1, b, b, a + 1, b + 1);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        parts.add(g, { color: '#ffffff', pbr: PBR.alu, uvFn: (x, y, z, u, v) => [u, v] });
      }
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
    // Bidons et porte-bidons (sur le diagonal et sur le tube de selle). Le bidon du diagonal appartient au
    // maillage du coureur (os B.bottle) : il peut le prendre pour boire.
    const bottle = (base, dir, side, col, withBottle = true) => {
      const g = !withBottle ? null : new THREE.LatheGeometry(
        [[0, 0], [0.031, 0], [0.036, 0.01], [0.036, 0.075], [0.032, 0.095], [0.036, 0.115], [0.036, 0.175], [0.031, 0.192], [0.017, 0.202], [0.013, 0.218], [0.007, 0.226], [0, 0.228]].map(([r, y]) => new THREE.Vector2(r, y)),
        q === 'low' ? 8 : 14,
      );
      const center = base.clone().addScaledVector(side, 0.024 + 0.036);
      if (g) along(g, dir, center.addScaledVector(dir, -0.11));
      const top = center.clone().addScaledVector(dir, 0.19);
      if (g) parts.add(g, {
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
    bottle(dtMid, dtDir, V(0, dtDir.z, -dtDir.y), jersey, false);
    const stMid = BB.clone().addScaledVector(ST_DIR, 0.27);
    bottle(stMid, ST_DIR, V(0, ST_DIR.z, -ST_DIR.y).negate(), helmet === '#ffffff' ? '#2b6cff' : helmet);
    // Chaîne (boucle fermée) : maillons dessinés et animés dans le shader du cadre (uv1.y = 2 + abscisse)
    const cx = -0.044;
    const chain = CR([
      V(cx, 0.406, -0.02), V(cx, 0.398, -0.16), V(cx, 0.388, -0.3), V(cx, 0.38, -0.42), V(cx, 0.365, -0.452), V(cx, 0.335, -0.466), V(cx, 0.302, -0.455),
      V(cx, 0.288, -0.438), V(cx, 0.262, -0.418), V(cx, 0.232, -0.428), V(cx, 0.206, -0.412), V(cx, 0.198, -0.3), V(cx, 0.196, -0.12), V(cx, 0.197, -0.02),
      V(cx, 0.225, 0.06), V(cx, 0.3, 0.086), V(cx, 0.375, 0.06),
    ], true);
    parts.add(sweep(chain, { segs: Q.chain, radial: 4, radius: () => [0.0035, 0.0048], ref: AX }), {
      color: '#9a9ea6',
      pbr: PBR.chrome,
      uv1y: (u) => 2 + u,
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
const tV = Array.from({ length: 16 }, () => new THREE.Vector3());
const tQ = Array.from({ length: 8 }, () => new THREE.Quaternion());
const qRoll = new THREE.Quaternion();
const qBike = new THREE.Quaternion();
const qInv = new THREE.Quaternion();
const PELVIS_HIP = V(0, -BODY.hip[1], 0); // du centre des hanches vers l'origine du bassin
const HIP_SPRINT = V(0, 1.045, 0.11); // sprint en danseuse : bassin très en avant, buste plongeant
const HIP_STOP = V(0.018, 0.955, -0.075); // à l'arrêt : debout au-dessus du tube horizontal, pied droit à terre
const FOOT_DOWN = V(-0.29, 0.085, -0.04); // cheville du pied posé au sol (repère du coureur)
const MOUTH = V(0, 0.048, 0.11); // bouche, relative à l'os de la tête
const DROP = (s) => V(s * 0.2, CLAMP.y - 0.088, CLAMP.z + 0.02); // poignets dans le bas du cintre
const TOP = (s) => V(s * 0.13, CLAMP.y + 0.045, CLAMP.z - 0.02); // mains sur le haut du cintre
const LINK_PER_RAD = 0.106 / 0.0127; // maillons par radian de pédalier (plateau de 52)
const ease = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-dt * rate));
const smooth01 = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// Fenêtre douce : 0 avant a, 1 entre b et c, 0 après d
const win = (t, a, b, c, d) => smooth01(a, b, t) * (1 - smooth01(c, d, t));

export class DetailedRider {
  constructor({ jersey = '#ff5a1f', bike = '#2b6cff', helmet = '#ffffff', name = '', quality = defaultQuality() } = {}) {
    const q = QS[quality] ? quality : 'high';
    this.quality = q;
    const g = new THREE.Group();
    this.group = g;
    g.userData.rider = this; // accès de débogage (tests automatisés) et regards entre coureurs
    const seed = hash(`${name}|${jersey}|${bike}`);
    this.seed = seed;
    const accent = helmet === '#ffffff' || helmet === jersey ? (bike === '#16181d' ? '#ffffff' : bike) : helmet;
    this.colors = { jersey, bike, helmet, accent };

    // Vélo (dans un groupe qui peut se balancer sous le coureur en danseuse)
    this.bike = new THREE.Group();
    g.add(this.bike);
    this.frameMat = frameMaterial(bike, accent, q);
    this.frame = new THREE.Mesh(frameGeometry(bike, jersey, helmet, q), this.frameMat);
    this.bike.add(this.frame);
    this.steer = new THREE.Group();
    this.steer.position.copy(HT_BOT);
    this.steer.quaternion.copy(STEER_Q);
    this.bike.add(this.steer);
    this.steerMesh = new THREE.Mesh(steerGeometry(bike, accent, q), this.frameMat);
    this.steer.add(this.steerMesh);
    const wMat = wheelMaterial(q);
    this.rearKind = seed % 3 === 1 ? 'disc' : 'spoke';
    this.frontWheel = new THREE.Mesh(wheelGeometry('spoke', false, q), wMat);
    this.frontWheel.position.copy(FRONT).applyMatrix4(STEER_INV);
    this.steer.add(this.frontWheel);
    this.rearWheel = new THREE.Mesh(wheelGeometry(this.rearKind, true, q), wMat);
    this.rearWheel.position.copy(REAR);
    this.bike.add(this.rearWheel);
    this.crankset = new THREE.Mesh(crankGeometry(q), wMat);
    this.crankset.position.copy(BB);
    this.bike.add(this.crankset);
    this.bike.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });

    // Cycliste : visage (yeux, barbe), cheveux (queue de cheval), lunettes sur le nez ou relevées sur le casque
    const skin = SKINS[seed % SKINS.length];
    const number = name ? 2 + (seed % 97) : 1;
    this.pony = (seed >>> 5) % 3 === 0;
    this.glassMode = (seed >>> 7) % 4 === 0 ? 1 : 0;
    const look = { beard: this.pony ? 0 : [0, 1, 2, 0, 3, 1, 4][(seed >>> 9) % 7] };
    const body = makeBody(bodyGeometry('cyclist', q), bodyMaterial({ kind: 'cyclist', jersey, helmet, accent, skin, number, look }, q), bindPositions());
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
    // Points d'appui des mains (poignets) dans le repère de la direction : cocottes, bas du cintre, haut du cintre
    this.wristLocal = [-1, 1].map((s) => V(s * 0.198, CLAMP.y + 0.05, CLAMP.z + 0.035).applyMatrix4(STEER_INV));
    this.dropLocal = [-1, 1].map((s) => DROP(s).applyMatrix4(STEER_INV));
    this.topLocal = [-1, 1].map((s) => TOP(s).applyMatrix4(STEER_INV));
    this.standing = 0;
    this.crankAngle = 0;
    this.steerAngle = 0;
    this.tuck = 0;
    this.tuckTarget = 0;
    this.effort = 0.5;
    this.phase = (seed % 1000) / 160;
    this._t = 0;
    this.hip = HIP_SIT.clone();
    // Mouvement et course (setMotion, setRace)
    this.v = 0;
    this.grade = 0;
    this.power = 0;
    this.raceTime = null;
    this.camera = null;
    this.toGo = Infinity;
    this.sprinter = (seed >>> 11) % 2 === 0;
    // Animation secondaire : sprint, arrêt pied à terre, regards, bidon, salut, célébration, cheveux
    this.sprint = 0;
    this.stop = 1;
    this.rnd = seed % 9973;
    this.look = { target: V(0, 0, 0), w: 0, until: 0, kind: 0, next: 1 + this.random() * 3 };
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.lastZ = new Map();
    this.drinkT = -1;
    this.nextDrink = 20 + this.random() * 40;
    this.waveT = -1;
    this.nextWave = 0.5 + this.random() * 5;
    this.cele = { t: -1, place: 9 };
    this.hairSwing = new HairSwing();
    this.lod = false;
    this.blurOn = false;
    if (q !== 'low') {
      // Géométries du niveau de détail lointain préparées d'avance (pas d'à-coup en course)
      frameGeometry(bike, jersey, helmet, 'low');
      steerGeometry(bike, accent, 'low');
      bodyGeometry('cyclist', 'low');
      crankGeometry('low');
      for (const k of ['spoke', 'blur', 'disc']) wheelGeometry(k, true, 'low');
      wheelGeometry('spoke', false, 'low');
      wheelGeometry('blur', false, q);
      wheelGeometry('blur', true, q);
    }
    this.clock = 0;
    this.update();
  }

  // Petit générateur pseudo-aléatoire propre au coureur (déterministe)
  random() {
    this.rnd = (this.rnd * 16807) % 2147483647 || 1;
    return (this.rnd % 100000) / 100000;
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

  // Facultatif : vitesse (m/s), pente (%), puissance (W). Position aérodynamique dans les descentes rapides,
  // sprint en danseuse quand la puissance s'envole sur le plat.
  setMotion(v = 0, grade = 0, power = 0) {
    this.tuckTarget = v > 11.5 && grade < -3 ? 1 : 0;
    this.effort = Math.min(1, Math.max(0, power / 380));
    this.v = v;
    this.grade = grade;
    this.power = power;
  }

  // Facultatif : temps de course (négatif pendant le compte à rebours), caméra (regards, niveau de détail)
  // et distance restante (sprint final).
  setRace(time, camera = null, toGo = Infinity) {
    this.raceTime = time;
    this.camera = camera;
    this.toGo = toGo;
    if (camera && this.quality !== 'low') {
      // Niveau de détail : géométries « low » au-delà de 40 m (hystérésis)
      const d = camera.position.distanceTo(this.group.position);
      if (!this.lod && d > 40) this.setLod(true);
      else if (this.lod && d < 33) this.setLod(false);
    }
  }

  // Arrivée : bras levés pour le vainqueur, poing levé sur le podium, buste relevé sinon.
  celebrate(place = 9) {
    this.cele.t = 0;
    this.cele.place = place;
  }

  // Boire maintenant (sinon de temps en temps sur le plat, à faible allure)
  drink() {
    if (this.drinkT < 0) this.drinkT = 0;
  }

  setLod(low) {
    this.lod = low;
    const q = low ? 'low' : this.quality;
    const { jersey, bike, helmet, accent } = this.colors;
    this.body.geometry = bodyGeometry('cyclist', q);
    this.frame.geometry = frameGeometry(bike, jersey, helmet, q);
    this.steerMesh.geometry = steerGeometry(bike, accent, q);
    this.crankset.geometry = crankGeometry(q);
    this.blurOn = !this.blurOn; // force la mise à jour des roues
    this.updateWheels(!this.blurOn);
  }

  // Disque flou des rayons au-dessus de ~31 km/h
  updateWheels(blur) {
    if (blur === this.blurOn) return;
    this.blurOn = blur;
    const q = this.lod ? 'low' : this.quality;
    this.frontWheel.geometry = wheelGeometry(blur ? 'blur' : 'spoke', false, q);
    this.rearWheel.geometry = wheelGeometry(this.rearKind === 'disc' ? 'disc' : blur ? 'blur' : 'spoke', true, q);
  }

  spinWheels(dAngle) {
    this.rearWheel.rotation.x += dAngle;
    this.frontWheel.rotation.x += dAngle;
  }

  // Choix du regard : caméra au départ, coup d'œil à un voisin, regard en arrière quand on est attaqué.
  chooseLook(dt) {
    const L = this.look;
    const me = this.group.position;
    qInv.copy(this.group.quaternion).invert();
    const sibs = this.group.parent ? this.group.parent.children : [];
    let near = null;
    let nearD = 1e9;
    let attacker = null;
    for (let i = 0; i < sibs.length; i++) {
      const r = sibs[i].userData.rider;
      if (!r || r === this) continue;
      const rel = tV[0].copy(r.group.position).sub(me).applyQuaternion(qInv);
      const last = this.lastZ.get(r);
      const closing = last === undefined || dt <= 0 ? 0 : (rel.z - last) / dt;
      this.lastZ.set(r, rel.z);
      const d = Math.hypot(rel.x, rel.z);
      if (rel.z < -0.8 && rel.z > -7 && Math.abs(rel.x) < 3.5 && closing > 1.1 && this.v > 3) attacker = r;
      if (d < 10 && rel.z > -2 && d < nearD) {
        near = r;
        nearD = d;
      }
    }
    if (this.clock < L.until) return;
    if (attacker && L.kind !== 3) {
      // Attaque : regard par-dessus l'épaule, du côté de l'attaquant
      L.kind = 3;
      L.ref = attacker;
      L.until = this.clock + 0.9;
      L.next = this.clock + 5 + this.random() * 4;
      return;
    }
    if (this.clock < L.next) {
      if (L.kind !== 0 && L.kind !== 4) L.kind = 0;
      return;
    }
    const atStart = this.stop > 0.5 || (this.raceTime !== null && this.raceTime < 0);
    if (atStart && this.camera && this.random() < 0.65) {
      L.kind = 1; // caméra (public, photographe)
      L.until = this.clock + 2 + this.random() * 3;
    } else if (near) {
      L.kind = 2;
      L.ref = near;
      L.until = this.clock + 0.9 + this.random() * 0.9;
    } else {
      L.kind = 0;
      L.until = this.clock + 1;
    }
    L.next = L.until + (atStart ? 0.5 + this.random() * 1.5 : 4 + this.random() * 8);
  }

  update() {
    const now = performance.now() / 1000;
    const dt = this._t ? Math.min(0.1, Math.max(0, now - this._t)) : 0;
    this._t = now;
    this.clock += dt;
    const bones = this.bones;
    const crank = this.crankAngle;
    this.tuck += (this.tuckTarget - this.tuck) * (1 - Math.exp(-dt * 2.2));
    this.chooseLook(dt);

    // --- États : arrêt pied à terre, sprint, célébration, bidon, salut ---
    this.stop = ease(this.stop, this.v < 0.35 ? 1 : 0, this.v < 0.35 ? 2.2 : 5, dt);
    const stop = this.stop;
    const finalSprint = this.sprinter && this.toGo > 0 && this.toGo < 230 && this.v > 6;
    this.sprint = ease(this.sprint, (this.power > 520 && this.v > 8 && this.grade < 4) || finalSprint ? 1 : 0, 3, dt);
    const sp = this.sprint * (1 - stop);
    const st = Math.max(this.standing, sp) * (1 - stop);
    const tk = this.tuck * (1 - st);
    let armsUp = 0;
    let fistR = 0;
    let sitUp = 0;
    let topsW = 0;
    if (this.cele.t >= 0) {
      const c = (this.cele.t += dt);
      const p = this.cele.place;
      if (p === 1) {
        armsUp = win(c, 0.2, 0.7, 4.2, 5);
        sitUp = win(c, 0, 0.6, 8, 9.5);
      } else if (p <= 3) {
        fistR = win(c, 0.2, 0.6, 2.6, 3.2);
        sitUp = win(c, 0, 0.6, 7, 8.5);
      } else sitUp = win(c, 0, 1, 5, 6.5);
      topsW = sitUp * (1 - armsUp);
      if (c > 10) this.cele.t = -1;
    }
    // Bidon : sur le plat, à allure modérée, de temps en temps
    if (this.drinkT < 0 && this.clock > this.nextDrink) {
      const calm = this.v > 4 && Math.abs(this.grade) < 2.5 && this.power < 240 && st < 0.1 && this.tuck < 0.1 && stop < 0.1 && this.cele.t < 0 && this.toGo > 400;
      if (calm) this.drinkT = 0;
      else this.nextDrink = this.clock + 3;
    }
    let drinkW = 0;
    let reachW = 0;
    let holdW = 0;
    let sipW = 0;
    if (this.drinkT >= 0) {
      const d = (this.drinkT += dt);
      drinkW = win(d, 0, 0.35, 3.1, 3.5);
      reachW = win(d, 0.05, 0.5, 0.65, 1.05) + win(d, 2.45, 2.8, 2.95, 3.3);
      holdW = win(d, 0.5, 0.6, 2.85, 2.95);
      sipW = win(d, 0.95, 1.4, 2.2, 2.6);
      if (d > 3.5) {
        this.drinkT = -1;
        this.nextDrink = this.clock + 30 + this.random() * 50;
      }
    }
    // Salut de la main au départ (compte à rebours, écran titre)
    if (this.waveT < 0 && stop > 0.85 && this.clock > this.nextWave) this.waveT = 0;
    let waveW = 0;
    if (this.waveT >= 0) {
      const w = (this.waveT += dt);
      waveW = win(w, 0, 0.4, 2.2, 2.7) * stop;
      if (w > 2.7) {
        this.waveT = -1;
        this.nextWave = this.clock + 3 + this.random() * 7;
      }
    }
    const freeR = Math.max(fistR, drinkW, waveW, armsUp);

    // --- Vélo : balancement en danseuse (plus ample au sprint), penché à droite à l'arrêt ---
    const sway = Math.sin(crank) * st * (1 + 0.9 * sp);
    this.bike.rotation.z = -0.17 * sway + 0.11 * stop;
    this.bike.updateMatrix();
    qBike.setFromAxisAngle(AZ, this.bike.rotation.z);
    this.steer.quaternion.copy(STEER_Q).multiply(tQ[0].setFromAxisAngle(UP, -this.steerAngle * (1 - stop)));
    this.steer.updateMatrix();
    this.crankset.rotation.x = crank;
    this.frameMat.userData.chain.value = (crank * LINK_PER_RAD) % 1;
    this.updateWheels(this.lod ? false : this.blurOn ? this.v > 8.2 : this.v > 8.8);

    // --- Bassin et buste ---
    const breathe = Math.sin(now * (2.2 + this.effort * 2.4) + this.phase) * (0.4 + this.effort);
    const hipC = tV[0].lerpVectors(HIP_SIT, HIP_STAND, Math.max(this.standing, 0) * (1 - stop));
    hipC.lerp(HIP_SPRINT, sp);
    hipC.z -= 0.035 * tk;
    hipC.y -= 0.004 * tk;
    // Transfert de poids sur la selle : glisse un peu, se recale vers l'avant quand l'effort monte
    const seated = 1 - Math.max(st, stop);
    hipC.x += 0.012 * Math.sin(this.clock * 0.37 + this.phase) * seated + 0.025 * sway;
    hipC.z += (0.022 * this.effort - 0.012 * sitUp) * seated;
    hipC.y += Math.abs(Math.cos(crank)) * 0.012 * st * (1 + sp);
    hipC.lerp(HIP_STOP, stop);
    let leanP = 0.92 - 0.1 * st + 0.3 * tk + 0.12 * sp;
    let leanC = 1.14 - 0.04 * st + 0.3 * tk + 0.22 * sp + breathe * 0.012 + Math.abs(Math.sin(crank)) * 0.06 * st;
    leanC -= 0.5 * sitUp + 0.18 * waveW;
    leanP -= 0.25 * sitUp;
    leanC += 0.32 * reachW - 0.15 * sipW;
    leanC = leanC * (1 - stop) + 0.62 * stop;
    leanP = leanP * (1 - stop) + 0.25 * stop;
    const rock = Math.sin(crank) * (0.03 + 0.03 * this.effort) * (1 - st) * (1 - stop);
    qRoll.setFromAxisAngle(AZ, -0.05 * sway + rock - 0.16 * reachW);
    const qP = tQ[1].setFromAxisAngle(AX, leanP).premultiply(qRoll);

    // Regard (cible choisie au début de l'image) et torsion du buste pour regarder en arrière
    const L = this.look;
    let wantW = 0;
    if (L.kind === 1 && this.camera) {
      L.target.copy(this.camera.position);
      wantW = 1;
    } else if ((L.kind === 2 || L.kind === 3) && L.ref) {
      L.target.copy(L.ref.group.position);
      L.target.y += 1.3;
      wantW = 1;
    }
    let yawT = 0;
    let pitchT = 0;
    if (wantW) {
      const hp = bones[B.head].position;
      const rel = tV[1].copy(L.target).sub(this.group.position).applyQuaternion(qInv.copy(this.group.quaternion).invert());
      yawT = Math.atan2(rel.x - hp.x, rel.z - hp.z);
      pitchT = -Math.atan2(rel.y - hp.y, Math.hypot(rel.x - hp.x, rel.z - hp.z));
      const lim = L.kind === 3 ? 2.3 : 1.35;
      yawT = Math.max(-lim, Math.min(lim, yawT));
      pitchT = Math.max(-0.5, Math.min(0.45, pitchT));
    }
    L.w = ease(L.w, wantW, 4, dt);
    this.lookYaw = ease(this.lookYaw, yawT, L.kind === 3 ? 7 : 4, dt);
    this.lookPitch = ease(this.lookPitch, pitchT, 4, dt);
    const lookYaw = this.lookYaw * L.w * (1 - drinkW);
    const twist = Math.sign(lookYaw) * Math.max(0, Math.abs(lookYaw) - 1.0) * 0.7;
    const qC = tQ[2].setFromAxisAngle(AX, leanC);
    qC.premultiply(tQ[3].setFromAxisAngle(UP, -rock * 1.6 + twist)).premultiply(qRoll);
    const pelvisPos = tV[1].copy(PELVIS_HIP).applyQuaternion(qP).add(hipC);
    bones[B.pelvis].position.copy(pelvisPos);
    bones[B.pelvis].quaternion.copy(qP);
    const chestPos = tV[2].set(0, BODY.chestY, 0).applyQuaternion(qP).add(pelvisPos);
    bones[B.chest].position.copy(chestPos);
    bones[B.chest].quaternion.copy(qC);
    const bs = 1 + breathe * 0.012;
    bones[B.chest].scale.set(bs, 1, 1 + breathe * 0.02);

    // --- Tête : regarde la route (et tourne dans les virages), ou sa cible ; renversée pour boire ---
    const headPos = tV[3].set(0, BODY.headY - BODY.chestY, 0).applyQuaternion(qC).add(chestPos);
    const basePitch = 0.2 + 0.22 * tk - 0.1 * st + 0.12 * sp + breathe * 0.01 - 0.15 * sitUp - 0.1 * stop;
    const pitch = basePitch * (1 - L.w) + (this.lookPitch + 0.05) * L.w - 0.5 * sipW + 0.35 * reachW - 0.25 * armsUp;
    const yaw = -this.steerAngle * 0.9 * (1 - L.w) * (1 - stop) + (lookYaw - twist) + Math.sin(this.clock * 1.7) * 0.25 * (sitUp - armsUp) * (this.cele.place > 3 ? 1 : 0);
    const qH = tQ[4].setFromAxisAngle(AX, pitch);
    qH.premultiply(tQ[5].setFromAxisAngle(UP, yaw));
    qH.premultiply(tQ[6].setFromAxisAngle(AZ, -0.1 * reachW + 0.04 * sway));
    bones[B.head].position.copy(headPos);
    bones[B.head].quaternion.copy(qH);
    // Accessoires : lunettes, queue de cheval (le vent la soulève, le corps la secoue)
    this.hairSwing.step(dt, Math.min(0.6, this.v * 0.05) - pitch * 0.9 + 0.15, -0.6 * sway - this.lookYaw * 0.2 * L.w);
    poseHeadGear(bones, this.glassMode, this.pony, this.hairSwing.x, this.hairSwing.z);

    // --- Bras : épaules -> poignets (cocottes, bas du cintre au sprint, haut du cintre quand il se relève,
    // ou mains libres : bidon, salut, bras levés) ---
    const mouth = tV[11].copy(MOUTH).applyQuaternion(qH).add(headPos);
    const cage = tV[12].copy(CAGE_POS).applyMatrix4(this.bike.matrix);
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      const [bu, bf, bh] = s > 0 ? [B.upperL, B.foreL, B.handL] : [B.upperR, B.foreR, B.handR];
      const shoulder = tV[4].set(s * BODY.shoulder[0], BODY.shoulder[1] - BODY.chestY, 0).applyQuaternion(qC).add(chestPos);
      const wrist = tV[5].copy(this.wristLocal[i]).applyMatrix4(this.steer.matrix).applyMatrix4(this.bike.matrix);
      if (sp > 0.01) wrist.lerp(tV[13].copy(this.dropLocal[i]).applyMatrix4(this.steer.matrix).applyMatrix4(this.bike.matrix), sp);
      if (topsW > 0.01) wrist.lerp(tV[13].copy(this.topLocal[i]).applyMatrix4(this.steer.matrix).applyMatrix4(this.bike.matrix), topsW);
      const handDir = tV[9].set(0, 0.35 - 0.25 * sp, -1).applyQuaternion(qBike);
      const zHint = tV[10].set(-s * 0.85, 0.38 + 0.3 * sp, 0.13);
      const pole = tV[6].set(s * (0.8 + 0.6 * tk), -0.6 - 0.4 * tk, -0.35);
      let free = s > 0 ? armsUp : freeR;
      if (free > 0.001) {
        const ft = tV[14];
        if (s < 0 && drinkW > 0.001) {
          // Main droite : cocotte -> bidon -> bouche -> bidon -> cocotte
          // au visage : poignet sous le menton, bidon incliné, bouchon aux lèvres
          ft.copy(mouth).add(tV[15].set(-0.02, -0.14 + 0.04 * sipW, 0.12 + 0.03 * sipW));
          ft.lerp(tV[15].copy(cage).add(tV[7].set(-0.03, 0.09, -0.01)), Math.min(1, reachW));
          free = drinkW;
          handDir.set(0.2, -0.75, 0.62 + 0.3 * sipW).lerp(tV[7].set(0, 1, -0.2), Math.min(1, reachW));
          zHint.set(0, 0.8 - 0.3 * sipW, -0.6).lerp(tV[7].set(0.5, 0.2, 0.6), Math.min(1, reachW));
        } else if (s < 0 && waveW > fistR && waveW > armsUp) {
          // Salut : main près de la tête, avant-bras qui oscille
          ft.set(-0.22 - 0.06 * Math.sin(this.clock * 8), 0.3, 0.2).applyQuaternion(qC).add(shoulder);
          handDir.set(0.35 * Math.sin(this.clock * 8) - 0.2, -1, 0.1);
          zHint.set(0.6, 0, 0.8);
          free = waveW;
        } else {
          // Bras levés (victoire) ou poing levé (podium), avec un petit pompage
          const pump = 0.04 * Math.sin(this.cele.t * 7 + i);
          ft.set(s * 0.17, 0.5 + pump, 0.08).applyQuaternion(qC).add(shoulder);
          ft.y = Math.max(ft.y, shoulder.y + 0.42 + pump);
          handDir.set(-s * 0.15, -1, 0.1);
          zHint.set(-s, 0, 0.3);
        }
        wrist.lerp(ft, free);
        pole.lerp(tV[7].set(s * 1, -0.15, -0.25), free);
      }
      const elbow = ik2(shoulder, wrist, BODY.upper, BODY.fore, pole, tV[7], tV[8]);
      orient(bones[bu], shoulder, tV[13].subVectors(shoulder, elbow), tV[15].subVectors(tV[8], elbow));
      orient(bones[bf], elbow, tV[13].subVectors(elbow, tV[8]), tV[15].set(-s * 0.3, 1, 0.2));
      orient(bones[bh], tV[8], handDir, zHint);
    }
    // Bidon : dans le porte-bidon, ou dans la main droite (axe le long du pouce)
    const bottle = bones[B.bottle];
    bottle.position.copy(cage);
    bottle.quaternion.copy(qBike).multiply(CAGE_Q);
    if (holdW > 0.001) {
      const hand = bones[B.handR];
      const inHand = tV[13].set(0.024, -0.08, 0.004).applyQuaternion(hand.quaternion).add(hand.position);
      bottle.position.lerp(inHand, holdW);
      tQ[7].copy(hand.quaternion).multiply(tQ[6].setFromAxisAngle(AX, Math.PI / 2));
      bottle.quaternion.slerp(tQ[7], holdW);
    }

    // --- Jambes : hanche -> cheville, pied sur la pédale ; à l'arrêt, pied droit posé au sol ---
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      const [bt, bk, bf] = s > 0 ? [B.thighL, B.shinL, B.footL] : [B.thighR, B.shinR, B.footR];
      const a = -crank + (i ? Math.PI : 0);
      const pedal = tV[4].set(s * PEDAL_X, BB.y + Math.sin(a) * CRANK, BB.z + Math.cos(a) * CRANK).applyMatrix4(this.bike.matrix);
      const pitchF = 0.2 - 0.16 * Math.sin(a + 0.5) + 0.12 * st;
      const qF = tQ[3].setFromAxisAngle(AX, pitchF).premultiply(qBike);
      const ankle = tV[5].set(0, 0.083, -0.1).applyQuaternion(qF).add(pedal);
      if (s < 0 && stop > 0.001) {
        ankle.lerp(FOOT_DOWN, stop);
        qF.slerp(tQ[7].setFromAxisAngle(UP, -0.25), stop);
      }
      const hipJ = tV[6].set(s * BODY.hip[0], BODY.hip[1], 0).applyQuaternion(qP).add(pelvisPos);
      const pole = tV[7].set(s * (0.12 + (s < 0 ? 0.25 * stop : 0)), 0.15, 1);
      const knee = ik2(hipJ, ankle, BODY.thigh, BODY.shin, pole, tV[8], tV[9]);
      orient(bones[bt], hipJ, tV[10].subVectors(hipJ, knee), pole);
      orient(bones[bk], knee, tV[10].subVectors(knee, tV[9]), pole);
      bones[bf].position.copy(tV[9]);
      bones[bf].quaternion.copy(qF);
    }
  }
}
