// Éléments de décor propres à chaque circuit (graphismes détaillés) :
// ferme et animaux (Vallée Verte), village de chalets (Col des Chalets), plage, mer et passerelle (Côte des Dunes).
// Chaque fonction réserve sa place (les arbres l'évitent) et renvoie éventuellement une fonction d'animation.
// Les bâtiments (architecture.js) vont dans l'ensemble de bâtiments du décor (ctx.bset : quelques instructions
// de dessin pour tout le circuit, détails masqués au loin), les animaux sont instanciés.
import * as THREE from 'three';
import { ROAD_HALF, rng } from './track.js';
import { mergeGeometries, colored, paint, indexify } from './geom.js';
import { makeWater } from './water.js';
import { barn, silo, farmhouse, tractor, hayBale, chalet, church, fountain, cafe, beachHut, lifeguardTower, streetLamp } from './architecture.js';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const C = (hex) => new THREE.Color(hex);
const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
// --- Petites briques géométriques (couleur dans les sommets) ---
const box = (w, h, d, color, x = 0, y = 0, z = 0) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), color);
const cyl = (r, h, color, x = 0, y = 0, z = 0, seg = 12) => colored(new THREE.CylinderGeometry(r, r, h, seg).translate(x, y + h / 2, z), color);

// Orientation d'un bâtiment posé au bord de la route, façade (+Z local) tournée vers elle.
const faceYaw = (f, side) => Math.atan2(-side * f.rx, -side * f.rz);

// Altitude d'assise d'un bâtiment (w × d, tourné de yaw) : un peu sous la moyenne des coins et du centre, sans
// dépasser le coin le plus bas de plus de quelques décimètres (le socle descend sous terre).
function baseAt(heightAt, x, z, yaw, w, d) {
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  let lo = Infinity;
  let sum = 0;
  for (const [a, b] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) {
    const h = heightAt(x + a * c + b * sn, z - a * sn + b * c);
    lo = Math.min(lo, h);
    sum += h;
  }
  return Math.min(lo + 0.35, sum / 5 - 0.15);
}

function shadowed(mesh, cast = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

// --- Clôture générique (piquets + 2 lisses) le long d'une liste de points ---
function fenceAlong(points, heightAt, color = '#a7774c') {
  const posts = [];
  const rails = [];
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    const y = heightAt(x, z);
    posts.push([x, y, z]);
    if (i === points.length - 1) break;
    const [x2, z2] = points[i + 1];
    const y2 = heightAt(x2, z2);
    const len = Math.hypot(x2 - x, z2 - z);
    for (const hgt of [0.45, 0.85]) rails.push([(x + x2) / 2, (y + y2) / 2 + hgt, (z + z2) / 2, Math.atan2(x2 - x, z2 - z), -Math.atan2(y2 - y, len), len]);
  }
  const wood = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 1.1, 0.13).translate(0, 0.5, 0), wood, posts.length);
  posts.forEach(([x, y, z], i) => postMesh.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y - 0.05, z), q.identity(), one)));
  const railMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.09, 1), wood, rails.length);
  rails.forEach(([x, y, z, yaw, pitch, len], i) => railMesh.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(pitch, yaw, 0, 'YXZ')), new THREE.Vector3(1, 1, len))));
  return [shadowed(postMesh), shadowed(railMesh)];
}

// =====================================================================
// Animaux (vache, mouton, cheval) : corps et tête séparés pour brouter.
// =====================================================================

function cowGeometries(brown = false) {
  const body = new THREE.CapsuleGeometry(0.42, 1.0, 4, 12).rotateX(Math.PI / 2).scale(0.95, 1, 1).translate(0, 1.0, 0);
  paint(body, (c, x, y, z) => {
    if (brown) c.copy(C('#8a5a35')).lerp(C('#a8744a'), smoothstep(0.7, 1.4, y));
    else c.set(Math.sin(x * 7 + z * 3) + Math.cos(z * 5 - x * 2) > 0.6 ? '#1d1d20' : '#f4f1ea');
  });
  const parts = [body];
  for (const [x, z] of [[0.25, 0.55], [-0.25, 0.55], [0.25, -0.55], [-0.25, -0.55]]) parts.push(cyl(0.08, 0.62, brown ? '#6e4426' : '#e9e5dc', x, 0, z, 8));
  parts.push(colored(new THREE.SphereGeometry(0.16, 8, 6).translate(0, 0.62, -0.25), '#f0a9a9'));
  parts.push(cyl(0.03, 0.7, brown ? '#6e4426' : '#1d1d20', 0, 0.45, -0.78, 6));
  const head = [box(0.34, 0.34, 0.5, brown ? '#7a4e2e' : '#f4f1ea', 0, -0.17, 0.25), box(0.3, 0.2, 0.16, '#e9a3a0', 0, -0.25, 0.52)];
  head.push(colored(new THREE.ConeGeometry(0.04, 0.16, 6).rotateZ(-0.9).translate(0.2, 0.15, 0.1), '#e8e0c8'));
  head.push(colored(new THREE.ConeGeometry(0.04, 0.16, 6).rotateZ(0.9).translate(-0.2, 0.15, 0.1), '#e8e0c8'));
  if (brown) head.push(colored(new THREE.SphereGeometry(0.07, 8, 6).translate(0, -0.42, 0.15), '#e2b43c')); // cloche
  return { body: mergeGeometries(parts), head: mergeGeometries(head), neck: new THREE.Vector3(0, 1.15, 0.85) };
}

function sheepGeometries() {
  const parts = [];
  for (const [x, y, z, r] of [[0, 0.75, 0, 0.42], [0.2, 0.78, 0.25, 0.3], [-0.2, 0.78, 0.25, 0.3], [0.2, 0.76, -0.25, 0.3], [-0.2, 0.76, -0.25, 0.3], [0, 0.95, 0, 0.3]]) {
    parts.push(colored(indexify(new THREE.IcosahedronGeometry(r, 1)).translate(x, y, z), '#f5f3ee'));
  }
  for (const [x, z] of [[0.17, 0.3], [-0.17, 0.3], [0.17, -0.3], [-0.17, -0.3]]) parts.push(cyl(0.05, 0.45, '#26262a', x, 0, z, 6));
  const head = [box(0.24, 0.26, 0.34, '#26262a', 0, -0.13, 0.15), box(0.36, 0.06, 0.1, '#26262a', 0, 0.02, 0.05)];
  return { body: mergeGeometries(parts), head: mergeGeometries(head), neck: new THREE.Vector3(0, 0.92, 0.42) };
}

function horseGeometries() {
  const body = colored(new THREE.CapsuleGeometry(0.4, 1.1, 4, 12).rotateX(Math.PI / 2).translate(0, 1.35, 0), '#7a4a2a');
  const parts = [body];
  for (const [x, z] of [[0.22, 0.6], [-0.22, 0.6], [0.22, -0.6], [-0.22, -0.6]]) {
    parts.push(cyl(0.075, 1.0, '#6a3f22', x, 0, z, 8));
    parts.push(cyl(0.085, 0.14, '#1d1b1a', x, 0, z, 8));
  }
  parts.push(colored(new THREE.CylinderGeometry(0.06, 0.12, 0.8, 6).rotateX(0.6).translate(0, 1.15, -0.95), '#2a1c14'));
  const head = [];
  const neck = new THREE.CylinderGeometry(0.17, 0.24, 0.85, 10).rotateX(0.75).translate(0, 0.25, 0.25);
  head.push(colored(neck, '#7a4a2a'));
  head.push(box(0.24, 0.26, 0.6, '#7a4a2a', 0, 0.46, 0.6));
  head.push(box(0.06, 0.3, 0.7, '#2a1c14', 0, 0.45, 0.1)); // crinière
  return { body: mergeGeometries(parts), head: mergeGeometries(head), neck: new THREE.Vector3(0, 1.5, 0.75) };
}

// Troupeau qui broute et se promène dans une zone (coordonnées le long de la route : s et décalage latéral).
// Un maillage instancié par espèce pour les corps et un pour les têtes : quelques instructions de dessin.
function herd(group, track, heightAt, kinds, zone, rnd, cast) {
  const geos = { cow: cowGeometries(false), brown: cowGeometries(true), sheep: sheepGeometries(), horse: horseGeometries() };
  const counts = {};
  for (const k of kinds) counts[k] = (counts[k] || 0) + 1;
  const f = {};
  // Sphère englobante de la zone (les animaux n'en sortent pas).
  const mid = track.frame((zone.s0 + zone.s1) / 2, (zone.l0 + zone.l1) / 2);
  const sphere = new THREE.Sphere(new THREE.Vector3(mid.x, heightAt(mid.x, mid.z), mid.z), Math.hypot(zone.s1 - zone.s0, zone.l1 - zone.l0) / 2 + 8);
  const meshes = {};
  for (const [kind, n] of Object.entries(counts)) {
    const g = geos[kind];
    const body = shadowed(new THREE.InstancedMesh(g.body, MAT, n), cast);
    const head = shadowed(new THREE.InstancedMesh(g.head, MAT, n), cast);
    for (const m of [body, head]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.boundingSphere = sphere;
      group.add(m);
    }
    meshes[kind] = { body, head, neck: g.neck, used: 0 };
  }
  for (const [kind, g] of Object.entries(geos)) {
    if (counts[kind]) continue;
    g.body.dispose();
    g.head.dispose();
  }
  const animals = kinds.map((kind) => ({
    kind,
    slot: meshes[kind].used++,
    s: zone.s0 + rnd() * (zone.s1 - zone.s0),
    lat: zone.l0 + rnd() * (zone.l1 - zone.l0),
    yaw: rnd() * Math.PI * 2,
    pitch: 0,
    target: null,
    timer: rnd() * 6,
    phase: rnd() * 10,
    speed: kind === 'horse' ? 0.9 : kind === 'sheep' ? 0.45 : 0.35,
  }));
  const m4 = new THREE.Matrix4();
  const hm = new THREE.Matrix4();
  const hw = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const place = (st) => {
    const ms = meshes[st.kind];
    track.frame(st.s, st.lat, f);
    m4.compose(v.set(f.x, heightAt(f.x, f.z), f.z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(f.tx, f.tz) + st.yaw), one);
    ms.body.setMatrixAt(st.slot, m4);
    hm.makeRotationX(st.pitch).setPosition(ms.neck);
    ms.head.setMatrixAt(st.slot, hw.multiplyMatrices(m4, hm));
  };
  const flush = () => {
    for (const ms of Object.values(meshes)) {
      ms.body.instanceMatrix.needsUpdate = true;
      ms.head.instanceMatrix.needsUpdate = true;
    }
  };
  animals.forEach(place);
  flush();
  return (dt, time) => {
    for (const st of animals) {
      st.timer -= dt;
      if (st.timer <= 0) {
        if (st.target) {
          st.target = null; // on s'arrête pour brouter
          st.timer = 4 + rnd() * 8;
        } else {
          st.target = [zone.s0 + rnd() * (zone.s1 - zone.s0), zone.l0 + rnd() * (zone.l1 - zone.l0)];
          st.timer = 12;
        }
      }
      if (st.target) {
        const ds = st.target[0] - st.s;
        const dl = st.target[1] - st.lat;
        const d = Math.hypot(ds, dl);
        if (d < 0.3) st.timer = 0;
        else {
          const want = Math.atan2(-dl, ds); // cap relatif à la route (+ = vers la gauche)
          const diff = Math.atan2(Math.sin(want - st.yaw), Math.cos(want - st.yaw));
          st.yaw += Math.max(-1.2 * dt, Math.min(1.2 * dt, diff));
          if (Math.abs(diff) < 0.6) {
            st.s += Math.cos(st.yaw) * st.speed * dt;
            st.lat -= Math.sin(st.yaw) * st.speed * dt;
          }
        }
        st.pitch = Math.sin(time * 6 + st.phase) * 0.05;
      } else {
        st.pitch = 0.55 + Math.sin(time * 1.7 + st.phase) * 0.12; // tête baissée, broute
      }
      place(st);
    }
    flush();
  };
}

// =====================================================================
// Vallée Verte : ferme (grange, silo, maison, tracteur, pâturage et animaux)
// =====================================================================

export function addFarm(group, ctx, cfg) {
  const { track, heightAt, reserve, lake, rnd, cast } = ctx;
  const s0 = cfg.from * track.length;
  const s1 = cfg.to * track.length;
  const sm = (s0 + s1) / 2;
  // Côté opposé au lac
  const mid = track.frame(sm, 0);
  let side = 1;
  if (lake) {
    const toLake = (lake.x - mid.x) * mid.rx + (lake.z - mid.z) * mid.rz;
    side = toLake > 0 ? -1 : 1;
  }
  const L = (lat) => side * lat;
  const zone = { s0: s0 + 8, s1: s1 - 8, l0: L(ROAD_HALF + 9), l1: L(ROAD_HALF + 38) };
  if (zone.l0 > zone.l1) [zone.l0, zone.l1] = [zone.l1, zone.l0];

  // Clôture du pâturage
  const ring = [];
  const f = {};
  for (let s = zone.s0; s <= zone.s1; s += 3) ring.push(track.frame(s, L(ROAD_HALF + 7), f) && [f.x, f.z]);
  for (let l = ROAD_HALF + 7; l <= ROAD_HALF + 40; l += 3) ring.push(track.frame(zone.s1, L(l), f) && [f.x, f.z]);
  for (let s = zone.s1; s >= zone.s0; s -= 3) ring.push(track.frame(s, L(ROAD_HALF + 40), f) && [f.x, f.z]);
  for (let l = ROAD_HALF + 40; l >= ROAD_HALF + 7; l -= 3) ring.push(track.frame(zone.s0, L(l), f) && [f.x, f.z]);
  group.add(...fenceAlong(ring, heightAt, '#f2efe8'));
  for (let s = zone.s0; s <= zone.s1; s += 10) {
    track.frame(s, L(ROAD_HALF + 23), f);
    reserve(f.x, f.z, 22);
  }

  const B = ctx.bset;
  // Grange rouge à toit brisé (appentis du côté opposé au silo)
  const barnPos = track.frame(sm, L(ROAD_HALF + 58));
  reserve(barnPos.x, barnPos.z, 26);
  const yawB = faceYaw(barnPos, side);
  const siloPos = track.frame(sm + 12, L(ROAD_HALF + 66));
  const siloX = (siloPos.x - barnPos.x) * Math.cos(yawB) - (siloPos.z - barnPos.z) * Math.sin(yawB);
  barn(B, barnPos.x, baseAt(heightAt, barnPos.x, barnPos.z, yawB, 12, 15), barnPos.z, yawB, rng(401), { lean: siloX > 0 ? -1 : 1 });
  B.site('barn', barnPos.x, heightAt(barnPos.x, barnPos.z), barnPos.z);
  // Silo
  silo(B, siloPos.x, heightAt(siloPos.x, siloPos.z) - 0.1, siloPos.z, rng(402));
  // Corps de ferme en pierre
  const housePos = track.frame(s1 + 16, L(ROAD_HALF + 26));
  reserve(housePos.x, housePos.z, 14);
  const yawH = faceYaw(housePos, side);
  farmhouse(B, housePos.x, baseAt(heightAt, housePos.x, housePos.z, yawH, 9, 7), housePos.z, yawH, rng(403));
  B.site('farmhouse', housePos.x, heightAt(housePos.x, housePos.z), housePos.z);
  // Tracteur
  const tPos = track.frame(sm - 14, L(ROAD_HALF + 50));
  tractor(B, tPos.x, heightAt(tPos.x, tPos.z), tPos.z, faceYaw(tPos, side) + 1.1);
  // Bottes de foin près de la grange
  for (let k = 0; k < 6; k++) {
    const bp = track.frame(sm + 18 + (k % 3) * 1.7, L(ROAD_HALF + 48 + Math.floor(k / 3) * 1.5));
    hayBale(B, bp.x, heightAt(bp.x, bp.z) - 0.03, bp.z, Math.atan2(bp.tx, bp.tz));
  }

  return herd(group, track, heightAt, ['cow', 'cow', 'cow', 'cow', 'cow', 'sheep', 'sheep', 'sheep', 'sheep', 'sheep', 'sheep', 'sheep', 'horse', 'horse'], zone, rnd, cast);
}

// =====================================================================
// Col des Chalets : village de chalets sur le plateau, église, fontaine, guirlandes, vaches à cloche
// =====================================================================

export function addAlpineVillage(group, ctx, cfg) {
  const { track, heightAt, reserve, rnd } = ctx;
  const s0 = cfg.from * track.length;
  const s1 = cfg.to * track.length;
  const f = {};
  let k = 0;
  const B = ctx.bset;
  const sm = (s0 + s1) / 2;
  for (let s = s0 + 6; s < s1 - 6; s += 21) {
    for (const side of [-1, 1]) {
      if ((k + (side > 0 ? 1 : 0)) % 5 === 4) {
        k++;
        continue; // quelques trous dans les rangées
      }
      const lat = side * (ROAD_HALF + 10 + rnd() * 3);
      const sc = s + (side > 0 ? 9 : 0);
      // Place de la fontaine et café à droite, parvis de l'église à gauche
      if ((side > 0 && sc > sm - 12 && sc < sm + 27) || (side < 0 && Math.abs(sc - sm) < 11)) {
        k++;
        continue;
      }
      track.frame(sc, lat, f);
      const yaw = faceYaw(f, side);
      chalet(B, f.x, baseAt(heightAt, f.x, f.z, yaw, 9, 9.5), f.z, yaw, rng(700 + k * 13));
      reserve(f.x, f.z, 12);
      k++;
    }
  }
  // Église, fontaine sur sa place pavée, café et sa terrasse au milieu du village
  const cp = track.frame(sm, -(ROAD_HALF + 24));
  const yawC = faceYaw(cp, -1);
  church(B, cp.x, heightAt(cp.x, cp.z) - 0.3, cp.z, yawC, rng(801));
  B.site('church', cp.x, heightAt(cp.x, cp.z), cp.z);
  reserve(cp.x, cp.z, 20);
  const pv = track.frame(sm, -(ROAD_HALF + 12));
  ctx.bare(pv.x, pv.z, 2.5);
  const fp = track.frame(sm, ROAD_HALF + 8);
  fountain(B, fp.x, heightAt(fp.x, fp.z) - 0.05, fp.z, rng(802));
  reserve(fp.x, fp.z, 6.5);
  ctx.bare(fp.x, fp.z, 5.5);
  const kp = track.frame(sm + 17, ROAD_HALF + 12.5);
  const yawK = faceYaw(kp, 1);
  cafe(B, kp.x, baseAt(heightAt, kp.x, kp.z, yawK, 9, 8), kp.z, yawK, rng(803));
  B.site('cafe', kp.x, heightAt(kp.x, kp.z), kp.z);
  reserve(kp.x, kp.z, 12);
  const tp = track.frame(sm + 17, ROAD_HALF + 5.5);
  ctx.bare(tp.x, tp.z, 4.5);
  // Lampadaires le long de la rue, en quinconce
  let li = 0;
  for (let s = s0 + 14; s < s1 - 8; s += 26, li++) {
    const side = li % 2 ? 1 : -1;
    if (side > 0 && Math.abs(s - sm) < 9) continue;
    const lp = track.frame(s, side * (ROAD_HALF + 1.7));
    streetLamp(B, lp.x, heightAt(lp.x, lp.z), lp.z, faceYaw(lp, side));
    reserve(lp.x, lp.z, 1.2);
  }

  // Guirlandes de fanions au-dessus de la route
  const flags = [];
  const COLORS = ['#e0384b', '#ffd23f', '#2b6cff', '#3ccf7a', '#ffffff'];
  for (const s of [s0 + 4, sm, s1 - 4]) {
    const a = track.frame(s, -(ROAD_HALF + 1.4));
    const b = track.frame(s, ROAD_HALF + 1.4);
    const ya = heightAt(a.x, a.z);
    const yb = heightAt(b.x, b.z);
    for (const [p, y] of [[a, ya], [b, yb]]) flags.push(cyl(0.09, 5.6, '#6b4a30', p.x, y, p.z, 6));
    const N = 18;
    for (let i = 0; i < N; i++) {
      const t0 = i / N;
      const t1 = (i + 0.6) / N;
      const pt = (t) => [a.x + (b.x - a.x) * t, ya + 5.4 + (yb - ya) * t - Math.sin(Math.PI * t) * 1.1, a.z + (b.z - a.z) * t];
      const p0 = pt(t0);
      const p1 = pt(t1);
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 - 0.55, (p0[2] + p1[2]) / 2], 3));
      tri.computeVertexNormals();
      flags.push(colored(indexify(tri), COLORS[i % COLORS.length]));
    }
  }
  const flagMesh = new THREE.Mesh(mergeGeometries(flags), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  flagMesh.castShadow = true;
  group.add(flagMesh);
  return null;
}

export function addAlpineCows(group, ctx) {
  const { track, heightAt, reserve, rnd, cast } = ctx;
  const updates = [];
  for (const [frac, side] of [[0.18, 1], [0.56, -1], [0.8, 1]]) {
    const s = frac * track.length;
    const zone = { s0: s, s1: s + 40, l0: side * (ROAD_HALF + 10), l1: side * (ROAD_HALF + 30) };
    if (zone.l0 > zone.l1) [zone.l0, zone.l1] = [zone.l1, zone.l0];
    const f = track.frame(s + 20, side * (ROAD_HALF + 20));
    reserve(f.x, f.z, 16);
    updates.push(herd(group, track, heightAt, ['brown', 'brown', 'brown', 'brown'], zone, rnd, cast));
  }
  return (dt, t) => updates.forEach((u) => u(dt, t));
}

// =====================================================================
// Côte des Dunes : mer, écume, plage (parasols, serviettes, poste de secours), cabines, palmiers,
// voiliers et passerelle en bois sur pilotis.
// =====================================================================

export function coastZ(cfg, x) {
  return cfg.z + 6 * Math.sin(x * 0.013) + 4 * Math.sin(x * 0.031 + 1);
}

function umbrellaGeometry() {
  const cone = new THREE.ConeGeometry(1.3, 0.5, 12, 1, true).translate(0, 2.3, 0);
  paint(cone, (c, x, y, z) => c.set(Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 12) % 2 ? '#ffffff' : '#bdbdbd'));
  return mergeGeometries([cone, cyl(0.035, 2.3, '#e8e8e8', 0, 0, 0, 6)]);
}

export function addCoast(group, scene, ctx, cfg) {
  const { track, heightAt, reserve, rnd, seaY } = ctx;
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();

  // Mer : shader d'eau (profondeur lue dans la carte du terrain, écume sur le rivage, houle)
  const sea = new THREE.PlaneGeometry(7000, 3200, 140, 64).rotateX(-Math.PI / 2);
  sea.translate(cx, 0, cfg.z + 1560);
  const seaMesh = makeWater(sea, {
    mood: ctx.mood, maps: ctx.maps, waterY: seaY, shared: ctx.shared, chop: 0.36, swell: 1, foam: 1,
    shallow: '#3cc2c6', deep: '#0d4f80', sand: '#d8c493', depthScale: 0.22,
  });
  seaMesh.position.y = seaY;
  group.add(seaMesh);

  // Passerelle en bois sur pilotis : garde-corps et pieux sur les tronçons « boardwalk »
  const posts = [];
  const rails = [];
  const f = {};
  for (let s = 0; s < track.length; s += 2) {
    if (track.surfaceAt(s) !== 'boardwalk') continue;
    for (const side of [-1, 1]) {
      track.frame(s, side * (ROAD_HALF + 0.12), f);
      const top = f.y + 0.04;
      const ground = heightAt(f.x, f.z);
      posts.push([f.x, ground, f.z, top + 1.0 - ground]);
      const g2 = {};
      track.frame(s + 2, side * (ROAD_HALF + 0.12), g2);
      if (track.surfaceAt(s + 2) === 'boardwalk') {
        const len = Math.hypot(g2.x - f.x, g2.z - f.z);
        rails.push([(f.x + g2.x) / 2, (f.y + g2.y) / 2 + 1.0, (f.z + g2.z) / 2, Math.atan2(g2.x - f.x, g2.z - f.z), -Math.atan2(g2.y - f.y, len), len]);
      }
    }
  }
  const wood = new THREE.MeshStandardMaterial({ color: '#9b7048', roughness: 0.9 });
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1, 0.16).translate(0, 0.5, 0), wood, posts.length);
  posts.forEach(([x, y, z, h], i) => postMesh.setMatrixAt(i, m4.compose(v.set(x, y, z), q.identity(), sc.set(1, Math.max(0.3, h), 1))));
  const railMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 1), wood, rails.length);
  const e = new THREE.Euler();
  rails.forEach(([x, y, z, yaw, pitch, len], i) => railMesh.setMatrixAt(i, m4.compose(v.set(x, y, z), q.setFromEuler(e.set(pitch, yaw, 0, 'YXZ')), sc.set(1, 1, len))));
  group.add(shadowed(postMesh), shadowed(railMesh));

  // Palmiers dans les dunes et près du départ
  const palms = [];
  for (let tries = 0; tries < 6000 && palms.length < 140; tries++) {
    const s = rnd() * track.length;
    const side = rnd() < 0.5 ? -1 : 1;
    const p = track.frame(s, side * (ROAD_HALF + 5 + rnd() * 45));
    if (p.z > coastZ(cfg, p.x) - 4) continue;
    if (!ctx.free(p.x, p.z, ROAD_HALF + 4)) continue;
    const y = heightAt(p.x, p.z);
    if (y < seaY + 0.6) continue;
    palms.push([p.x, y, p.z, 0.8 + rnd() * 0.5, rnd()]);
  }
  // Les palmiers rejoignent la forêt commune (niveaux de détail, vent).
  ctx.palms.push(...palms);

  // Plage : parasols, serviettes, poste de secours (entre la route de plage et la mer)
  const umbrellas = [];
  const towels = [];
  const COLORS = ['#ff5a1f', '#2b6cff', '#ffd23f', '#e0384b', '#3ccf7a', '#b78cff'].map(C);
  for (let s = 0; s < track.length; s += 3) {
    if (track.surfaceAt(s) !== 'sand' || rnd() > 0.35) continue;
    const c = track.frame(s, 0);
    const toSea = Math.sign((0 - c.rx) * 0 + c.rz) || 1; // côté mer : vers +Z
    const side = c.rz > 0 ? 1 : -1;
    const room = coastZ(cfg, c.x) - c.z;
    const lat = side * (ROAD_HALF + 4 + rnd() * Math.max(2, room - ROAD_HALF - 9));
    const p = track.frame(s, lat);
    if (p.z > coastZ(cfg, p.x) - 3) continue;
    const y = heightAt(p.x, p.z);
    umbrellas.push([p.x, y, p.z, rnd()]);
    towels.push([p.x + 0.9, y + 0.03, p.z + 0.6, rnd()]);
    void toSea;
  }
  const umbMesh = new THREE.InstancedMesh(umbrellaGeometry(), MAT, umbrellas.length);
  umbrellas.forEach(([x, y, z, k], i) => {
    umbMesh.setMatrixAt(i, m4.compose(v.set(x, y, z), q.setFromAxisAngle(new THREE.Vector3(Math.cos(k * 6), 0, Math.sin(k * 6)), 0.12), sc.setScalar(1)));
    umbMesh.setColorAt(i, COLORS[Math.floor(k * 60) % COLORS.length]);
  });
  const towelMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.03, 1.8), new THREE.MeshStandardMaterial({ roughness: 0.9 }), towels.length);
  towels.forEach(([x, y, z, k], i) => {
    towelMesh.setMatrixAt(i, m4.compose(v.set(x, y, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, k * 3), sc.setScalar(1)));
    towelMesh.setColorAt(i, COLORS[Math.floor(k * 77 + 2) % COLORS.length]);
  });
  group.add(shadowed(umbMesh, true), shadowed(towelMesh, false));

  // Poste de secours
  const B = ctx.bset;
  const sandS = track.course.surfaces.find((sf) => sf[2] === 'sand');
  if (sandS) {
    const sMid = ((sandS[0] + sandS[1]) / 2) * track.length;
    const c = track.frame(sMid, 0);
    const side = c.rz > 0 ? 1 : -1;
    const room = coastZ(cfg, c.x) - c.z;
    const p = track.frame(sMid, side * Math.min(room - 6, ROAD_HALF + 9));
    lifeguardTower(B, p.x, heightAt(p.x, p.z), p.z, Math.PI);
    B.site('lifeguard', p.x, heightAt(p.x, p.z), p.z);
    reserve(p.x, p.z, 4);
  }

  // Cabines de plage rayées côté terre, le long de la route de plage
  const huts = [];
  for (let s = 0; s < track.length; s += 9) {
    if (track.surfaceAt(s) !== 'sand' || rnd() > 0.6) continue;
    const c = track.frame(s, 0);
    const land = c.rz > 0 ? -1 : 1;
    const p = track.frame(s, land * (ROAD_HALF + 4.5));
    if (!ctx.free(p.x, p.z, ROAD_HALF + 3)) continue;
    huts.push([p, land, huts.length]);
  }
  for (const [p, land, k] of huts) {
    beachHut(B, p.x, heightAt(p.x, p.z), p.z, faceYaw(p, land), rng(900 + k), k);
    if (k === 0) B.site('hut', p.x, heightAt(p.x, p.z), p.z);
    reserve(p.x, p.z, 2.5);
  }

  // Voiliers au large (instanciés, bercés par la houle)
  const hull = [colored(new THREE.BoxGeometry(1.4, 0.6, 4.2).translate(0, 0.1, 0), '#ffffff'), cyl(0.06, 6, '#d9d9d9', 0, 0.4, -0.3, 6)];
  const sail = new THREE.BufferGeometry();
  sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.9, -0.2, 0, 6.2, -0.3, 0, 0.9, -2.4], 3));
  sail.computeVertexNormals();
  hull.push(colored(indexify(sail), '#ffffff'));
  const boatMesh = new THREE.InstancedMesh(mergeGeometries(hull), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }), 6);
  boatMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  boatMesh.frustumCulled = false;
  const boats = [];
  const tintB = ['#ffffff', '#fff3c4', '#ffd6cc'].map(C);
  for (let i = 0; i < 6; i++) {
    const x = b.minX + rnd() * (b.maxX - b.minX);
    const z = coastZ(cfg, x) + 120 + rnd() * 420;
    boats.push({ x, z, yaw: rnd() * Math.PI * 2, phase: rnd() * 10, drift: (rnd() - 0.5) * 0.6 });
    boatMesh.setColorAt(i, tintB[i % 3]);
  }
  group.add(boatMesh);
  const be = new THREE.Euler();

  return (dt, t) => {
    boats.forEach((bt, i) => {
      bt.x += bt.drift * dt;
      be.set(0, bt.yaw, Math.sin(t * 0.7 + bt.phase) * 0.05, 'YXZ');
      boatMesh.setMatrixAt(i, m4.compose(v.set(bt.x, seaY + Math.sin(t * 0.9 + bt.phase) * 0.12, bt.z), q.setFromEuler(be), sc.set(1, 1, 1)));
    });
    boatMesh.instanceMatrix.needsUpdate = true;
  };
}
