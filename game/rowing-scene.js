// Bassin d'aviron : eau animée, berges boisées, lignes de bouées, panneaux de distance, tribune,
// arche d'arrivée et bateaux (skiff avec rameur et avirons animés au rythme des coups).
// Graphismes détaillés : lac naturel (voir buildRowingWorld) ; graphismes simples : version d'origine.
import * as THREE from 'three';
import { makeSky, makeEnvironment, disposeTree, terrainMaterial, mountainRingAround, fbm } from './scenery.js';
import { buildStandCrowd, addRowingCoach } from './people.js';
import { MOODS, applyMood, installFog, makeSkyDome, makeEnvironment as makeSkyEnvironment, noiseTexture, makeBirds } from './atmosphere.js';
import { Forest, deciduousGeometry, pineGeometry, bushGeometry, windMaterial, leafAtlas, makeFieldMaps, crispAlpha } from './nature.js';
import { makeWater, makeReflectiveWater } from './water.js';
import { mergeGeometries, colored, paint, indexify } from './geom.js';
import { makeLabel } from './models.js';
import { rng } from './track.js';
import { ROW } from '../src/core/rowing.js';

const C = (hex) => new THREE.Color(hex);
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Carte de normales de vaguelettes (somme de sinus périodiques, donc raccord parfait en mosaïque).
function rippleNormalMap(size = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const waves = [[3, 1, 0.9], [-2, 4, 0.6], [5, -3, 0.45], [1, 7, 0.3], [-7, -2, 0.25]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dy = 0;
      for (const [kx, ky, a] of waves) {
        const ph = ((kx * x + ky * y) / size) * Math.PI * 2;
        dx += a * kx * Math.cos(ph);
        dy += a * ky * Math.cos(ph);
      }
      const nx = -dx * 0.05;
      const ny = -dy * 0.05;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function signTexture(text, bg = '#ffffff', fg = '#1c1f26') {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg;
    ctx.font = '900 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
  });
}

// --- Bateau : skiff + rameur ---

export class Boat {
  constructor({ color = '#ff5a1f', name = '' } = {}) {
    this.group = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.35 });
    const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: '#25272e', roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: '#e9b48f', roughness: 0.7 });
    const metal = new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.3, metalness: 0.7 });

    // Coque effilée : sphère très allongée, coupée au ras de l'eau.
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), white);
    hull.scale.set(0.24, 0.16, 4.1);
    hull.position.y = 0.12;
    const deck = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), accent);
    deck.scale.set(0.24, 1, 4.1);
    deck.position.y = 0.121;
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 1.5), dark);
    cockpit.position.set(0, 0.14, -0.1);
    this.group.add(hull, deck, cockpit);

    // Portants (riggers)
    for (const side of [-1, 1]) {
      const rig = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.85, 6).rotateZ(Math.PI / 2), metal);
      rig.position.set(side * 0.42, 0.33, 0.2);
      this.group.add(rig);
    }

    // Rameur (regarde vers l'arrière, comme en vrai : il avance dos à l'arrivée)
    this.rower = new THREE.Group();
    this.seat = new THREE.Group();
    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.26), dark);
    hips.position.y = 0.32;
    this.torso = new THREE.Group();
    this.torso.position.y = 0.36;
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.36, 4, 10), accent);
    chest.position.y = 0.3;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), skin);
    head.position.y = 0.66;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), accent);
    cap.position.y = 0.68;
    this.torso.add(chest, head, cap);
    // Bras : des épaules vers les poignées (mis à jour à chaque image)
    this.arms = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 1, 6).translate(0, 0.5, 0), skin);
      this.group.add(arm);
      this.arms.push({ arm, side });
    }
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.5), dark);
    legs.position.set(0, 0.36, 0.3);
    this.legs = legs;
    this.seat.add(hips, this.torso);
    this.rower.add(this.seat, legs);
    this.group.add(this.rower);

    // Avirons : pivot sur la dame de nage, manche vers l'intérieur, pelle colorée dehors.
    this.oars = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.82, 0.38, 0.2);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.9, 6).rotateZ(Math.PI / 2), dark);
      shaft.position.x = side * 0.95;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.03), accent);
      blade.position.x = side * 2.35;
      const handle = new THREE.Object3D();
      handle.position.x = -side * 0.75;
      pivot.add(shaft, blade, handle);
      this.group.add(pivot);
      this.oars.push({ pivot, side, handle, blade });
    }
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    if (name) {
      this.label = makeLabel(name, color);
      this.label.position.set(0, 1.7, 0);
      this.group.add(this.label);
    }
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
  }

  // phase : 0..2π, coup d'aviron (propulsion pendant sin > 0). rowing : 0 = au repos.
  pose(phase, rowing = 1) {
    const drive = Math.sin(phase);
    const reach = Math.cos(phase); // 1 = bras tendus vers l'arrière du bateau (attaque)
    for (const o of this.oars) {
      // Balayage : pelles vers l'avant du bateau à l'attaque (+Z), vers l'arrière au dégagé.
      o.pivot.rotation.y = -o.side * (0.15 + 0.62 * reach) * rowing;
      // Pelles dans l'eau pendant la propulsion, au-dessus pendant le retour.
      o.pivot.rotation.z = o.side * (drive > 0 ? 0.13 : -0.05 - 0.08 * -drive) * rowing + o.side * 0.1 * (1 - rowing);
      o.blade.rotation.x = drive > 0 ? 0 : (Math.PI / 2) * 0.9 * rowing; // pelle à plat au retour
    }
    // Coulisse et buste : penché vers l'avant à l'attaque, vers l'arrière au dégagé.
    this.seat.position.z = -0.35 + 0.35 * reach * rowing;
    this.torso.rotation.x = (-0.35 * reach + 0.25 * (1 - reach) * 0.5) * rowing;
    this.legs.scale.z = 0.9 + 0.3 * (1 - reach * rowing) * 0.5;
    // Bras : épaule -> poignée
    this.group.updateMatrixWorld(true);
    for (const { arm, side } of this.arms) {
      const shoulder = this.tmp.set(side * 0.17, 0.8, 0);
      this.torso.localToWorld(shoulder);
      this.group.worldToLocal(shoulder);
      const o = this.oars.find((x) => x.side === side);
      const hand = this.tmp2.set(0, 0, 0);
      o.handle.localToWorld(hand);
      this.group.worldToLocal(hand);
      const dir = hand.clone().sub(shoulder);
      const len = dir.length();
      arm.position.copy(shoulder);
      arm.scale.set(1, len, 1);
      arm.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, dir.normalize());
    }
  }
}

// --- Bassin, graphismes simples (version d'origine) ---

function buildSimpleRowingWorld(scene, { lanes = 6, distance = ROW.distance, quality = 'high', renderer = null, detailed = true } = {}) {
  const group = new THREE.Group();
  scene.add(group);
  const r = rng(31);
  const width = lanes * ROW.laneWidth;
  const half = width / 2;
  const bank = half + 22; // bord des berges
  const zMin = -160;
  const zMax = distance + 260;
  const zMid = (zMin + zMax) / 2;
  const len = zMax - zMin;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();

  // Ciel, brume, reflets
  const sky = makeSky(['#2f7fdc', '#8cc8f7', '#e0f1ff']);
  scene.add(sky);
  const prevFog = scene.fog;
  scene.fog = new THREE.Fog(C('#e0f1ff'), 300, 1500);
  let envTex = null;
  if (renderer && detailed) {
    envTex = makeEnvironment(renderer, sky);
    scene.environment = envTex;
    scene.environmentIntensity = 0.6;
  }

  // Eau
  const normals = rippleNormalMap();
  normals.repeat.set(40, 80);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 3200).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#2a7fb8', roughness: 0.08, metalness: 0.1, normalMap: normals, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2 }),
  );
  water.position.set(0, 0, zMid);
  water.receiveShadow = true;
  group.add(water);

  // Berges en herbe avec un talus vers l'eau
  const grass = new THREE.MeshStandardMaterial({ color: '#5aa845', roughness: 1 });
  const soil = new THREE.MeshStandardMaterial({ color: '#8a7a55', roughness: 1 });
  for (const side of [-1, 1]) {
    const land = new THREE.Mesh(new THREE.BoxGeometry(600, 2, len + 400), grass);
    land.position.set(side * (bank + 300), 0.4, zMid);
    land.receiveShadow = true;
    const slope = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, len + 400), soil);
    slope.position.set(side * (bank + 0.6), 0.1, zMid);
    slope.rotation.z = side * 0.5;
    group.add(land, slope);
  }

  // Arbres le long des berges et collines
  const treeGeo = new THREE.ConeGeometry(2.2, 7, 8).translate(0, 5.2, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2, 6).translate(0, 1, 0);
  const trees = [];
  for (let i = 0; i < (quality === 'low' ? 160 : 320); i++) {
    const side = r() < 0.5 ? -1 : 1;
    const x = side * (bank + 8 + Math.pow(r(), 1.5) * 160);
    const z = zMin - 100 + r() * (len + 200);
    if (side > 0 && Math.abs(z - distance) < 50 && x < bank + 60) continue; // place pour la tribune
    trees.push([x, z, 0.7 + r() * 0.8]);
  }
  const leafMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 });
  const leaves = new THREE.InstancedMesh(treeGeo, leafMat, trees.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#6b4a30' }), trees.length);
  const greens = ['#2f7a35', '#3b8a3f', '#2a6b34', '#4b9a45'].map(C);
  trees.forEach(([x, z, sc], i) => {
    m4.compose(v3.set(x, 1.4, z), q.identity(), s3.setScalar(sc));
    leaves.setMatrixAt(i, m4);
    trunks.setMatrixAt(i, m4);
    leaves.setColorAt(i, greens[i % greens.length]);
  });
  leaves.castShadow = trunks.castShadow = detailed && quality !== 'low';
  group.add(leaves, trunks);

  // Montagnes au loin
  const mGeo = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
  const mountains = new THREE.InstancedMesh(mGeo, new THREE.MeshStandardMaterial({ color: '#7f9bb5', roughness: 1, flatShading: true }), 24);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const d = 900 + r() * 300;
    m4.compose(v3.set(Math.cos(a) * d, -10, zMid + Math.sin(a) * d), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r() * 6), s3.set(220 + r() * 160, 140 + r() * 200, 220 + r() * 160));
    mountains.setMatrixAt(i, m4);
  }
  group.add(mountains);

  // Lignes de bouées : rouges sur les 100 premiers et les 100 derniers mètres, blanches ailleurs.
  const buoys = [];
  for (let line = 0; line <= lanes; line++) {
    const x = -half + line * ROW.laneWidth;
    for (let z = 0; z <= distance; z += 10) buoys.push([x, z, z < 100 || z > distance - 100]);
  }
  const buoyMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.4 }), buoys.length);
  const red = C('#ff4a2f');
  const white = C('#f5f5f5');
  buoys.forEach(([x, z, isRed], i) => {
    m4.compose(v3.set(x, 0.08, z), q.identity(), s3.setScalar(1));
    buoyMesh.setMatrixAt(i, m4);
    buoyMesh.setColorAt(i, isRed ? red : white);
  });
  group.add(buoyMesh);

  // Ligne d'arrivée sur l'eau et numéros de couloirs au départ
  const finishLine = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff3b2f', transparent: true, opacity: 0.85 }));
  finishLine.position.set(0, 0.03, distance);
  group.add(finishLine);
  for (let lane = 0; lane < lanes; lane++) {
    const x = -half + (lane + 0.5) * ROW.laneWidth;
    const pontoon = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, 1.2), new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.9 }));
    pontoon.position.set(x, 0.1, -5.2);
    const num = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshStandardMaterial({ map: signTexture(String(lane + 1), '#ffd23f') }));
    num.position.set(x, 0.75, -5.2);
    num.rotation.y = Math.PI;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), new THREE.MeshStandardMaterial({ color: '#888888' }));
    post.position.set(x, 0.45, -5.2);
    group.add(pontoon, num, post);
  }

  // Panneaux de distance sur la berge gauche
  for (let d = 100; d < distance; d += 100) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshStandardMaterial({ map: signTexture(`${d} m`) }));
    sign.position.set(-bank - 2, 3.4, d);
    sign.rotation.y = Math.PI / 2;
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 0.2), new THREE.MeshStandardMaterial({ color: '#444a55' }));
    pole.position.set(-bank - 2.15, 1.6, d);
    group.add(sign, pole);
  }

  // Arche d'arrivée au-dessus du bassin
  const archMat = new THREE.MeshStandardMaterial({ color: '#ff5a1f', roughness: 0.5 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), archMat);
    post.position.set(side * (half + 2), 4.5, distance);
    post.castShadow = true;
    group.add(post);
  }
  // Banderole répétée sur toute la largeur (texture 2:1, donc une répétition tous les 3.6 m).
  const bannerTex = signTexture('ARRIVÉE', '#ffffff', '#ff5a1f');
  bannerTex.wrapS = THREE.RepeatWrapping;
  bannerTex.repeat.x = Math.round((width + 5) / 3.6);
  const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(width + 5, 1.8, 0.5), [archMat, archMat, archMat, archMat, bannerMat, bannerMat]);
  beam.position.set(0, 9, distance);
  beam.castShadow = true;
  group.add(beam);

  // Tribune et spectateurs sur la berge droite, à l'arrivée
  const stand = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: '#c9c4b8', roughness: 0.9 });
  for (let k = 0; k < 6; k++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(5, 0.8 * (k + 1), 60), concrete);
    step.position.set(k * 2.2, 0.4 * (k + 1), 0);
    step.receiveShadow = true;
    stand.add(step);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(16, 0.4, 62), new THREE.MeshStandardMaterial({ color: '#2b6cff', roughness: 0.6 }));
  roof.position.set(6, 9.5, 0);
  roof.rotation.z = -0.12;
  stand.add(roof);
  const fans = [];
  for (let k = 0; k < 6; k++) for (let z = -28; z <= 28; z += 1.4) if (r() < 0.75) fans.push([k * 2.2 + (r() - 0.5), 0.8 * (k + 1) + 0.45, z + (r() - 0.5) * 0.5]);
  const fanMesh = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.22, 0.45, 2, 6), new THREE.MeshStandardMaterial({ roughness: 0.8 }), fans.length);
  const shirt = ['#e0384b', '#2b6cff', '#ffd23f', '#3ccf7a', '#ffffff', '#ff7aa8', '#ff5a1f'].map(C);
  fans.forEach(([x, y, z], i) => {
    m4.compose(v3.set(x, y, z), q.identity(), s3.setScalar(1));
    fanMesh.setMatrixAt(i, m4);
    fanMesh.setColorAt(i, shirt[i % shirt.length]);
  });
  stand.add(fanMesh);
  stand.position.set(bank + 6, 1.4, distance - 10);
  stand.traverse((o) => {
    if (o.isMesh) o.castShadow = detailed;
  });
  group.add(stand);

  // Nuages
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  const clouds = new THREE.InstancedMesh(cloudGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }), 16);
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2;
    const d = 500 + r() * 600;
    m4.compose(v3.set(Math.cos(a) * d, 240 + r() * 120, zMid + Math.sin(a) * d), q.identity(), s3.set(60 + r() * 40, 14 + r() * 8, 30 + r() * 20));
    clouds.setMatrixAt(i, m4);
  }
  group.add(clouds);

  let time = 0;
  return {
    group,
    sky,
    center: new THREE.Vector3(0, 0, distance / 2),
    update(dt, camera) {
      time += dt;
      sky.position.copy(camera.position);
      normals.offset.set(time * 0.01, time * 0.02);
    },
    dispose() {
      for (const root of [group, sky]) {
        scene.remove(root);
        disposeTree(root);
      }
      if (envTex) envTex.dispose();
      scene.environment = null;
      scene.fog = prevFog;
    },
  };
}

// --- Bassin, graphismes détaillés ---
// Lac naturel : rives en pente douce (terrain texturé), roseaux, herbe et fleurs, forêt avec niveaux de
// détail, hangar à bateaux au départ, tribune et arche à l'arrivée, brume au bout du lac, montagnes,
// eau avec reflet plan en qualité high (arbres, tribune et bateaux s'y reflètent).
export function buildRowingWorld(scene, opts = {}) {
  if (opts.detailed === false) return buildSimpleRowingWorld(scene, opts);
  const { lanes = 6, distance = ROW.distance, quality = 'high', renderer = null } = opts;
  installFog();
  const group = new THREE.Group();
  group.userData.tag = 'scenery';
  scene.add(group);
  const r = rng(31);
  const width = lanes * ROW.laneWidth;
  const half = width / 2;
  const bank = half + 22; // bord des berges
  const zMin = -160;
  const zMax = distance + 260;
  const zMid = (zMin + zMax) / 2;
  const len = zMax - zMin;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const shared = { uTime: { value: 0 }, uWind: { value: 0.8 }, noise: noiseTexture() };
  const mood = MOODS.lake;

  // Ciel, brume, lumières, reflets
  const prevFog = scene.fog;
  applyMood(scene, mood);
  const sky = makeSkyDome(mood, quality);
  scene.add(sky);
  let envTex = null;
  if (renderer) {
    envTex = makeSkyEnvironment(renderer, sky);
    scene.environment = envTex;
    scene.environmentIntensity = mood.env;
  }

  // Terrain : fond du lac, rives irrégulières, collines ; le lac se referme après l'arrivée et avant le départ.
  const shoreX = (z) => bank + 5 * Math.sin(z * 0.013 + 1.3) + 3 * fbm(z * 0.02, 3.7, 2) * 2;
  const standZ = distance - 10;
  const heightAt = (x, z) => {
    const ax = Math.abs(x);
    const sx = shoreX(z * (x < 0 ? 1 : 1.07) + (x < 0 ? 0 : 40));
    // Fermeture du lac aux deux bouts (rive arrondie)
    const endD = Math.max(0, z - (zMax - 70), (zMin + 60) - z);
    const d = ax - sx + endD * 1.1 + Math.max(0, endD - 40) * 0.6;
    let h;
    if (d < -8) h = -2.6 - Math.min(1.5, (-d - 8) * 0.03);
    else if (d < 6) h = -2.6 + smoothstep(-8, 6, d) * 3.4; // plage et roselière
    else h = 0.8 + smoothstep(6, 70, d) * (3 + fbm(x * 0.006, z * 0.006, 4) * 14) + Math.max(0, d - 160) * 0.22;
    h += fbm(x * 0.05, z * 0.05, 2) * 0.35 * smoothstep(0, 10, d);
    // Replat pour la tribune et le hangar
    const flat = (cx, cz, rad) => smoothstep(rad + 25, rad, Math.hypot(x - cx, z - cz));
    h += (1.0 - h) * Math.max(flat(bank + 14, standZ, 34) * (x > 0 ? 1 : 0), flat(-bank - 10, -30, 22) * (x < 0 ? 1 : 0)) * smoothstep(-2, 2, d);
    return h;
  };
  const cell = quality === 'high' ? 6.5 : quality === 'medium' ? 9 : 12;
  const TW = 1500;
  const TD = len + 900;
  const gx = Math.ceil(TW / cell);
  const gz = Math.ceil(TD / cell);
  const tgeo = new THREE.PlaneGeometry(TW, TD, gx, gz).rotateX(-Math.PI / 2).translate(0, 0, zMid);
  const tp = tgeo.attributes.position;
  const heights = new Float32Array(tp.count);
  for (let i = 0; i < tp.count; i++) {
    const h = heightAt(tp.getX(i), tp.getZ(i));
    tp.setY(i, h);
    heights[i] = h;
  }
  tgeo.computeVertexNormals();
  const tn = tgeo.attributes.normal;
  const col = new Float32Array(tp.count * 3);
  const mix = new Float32Array(tp.count * 4);
  const wet = new Float32Array(tp.count);
  const ground = new Uint8Array(tp.count * 4);
  const G = ['#4c8f35', '#62a842', '#86b84a', '#a3bf55'].map(C);
  const c = new THREE.Color();
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i);
    const z = tp.getZ(i);
    const y = tp.getY(i);
    const k = (fbm(x * 0.012, z * 0.012, 3) + 1) / 2;
    const idx = Math.min(G.length - 1.001, Math.max(0, k * (G.length - 1) * 1.15));
    c.copy(G[Math.floor(idx)]).lerp(G[Math.ceil(idx)], idx % 1).multiplyScalar(0.92 + fbm(x * 0.08, z * 0.08, 2) * 0.12);
    const sand = smoothstep(0.5, -0.3, y);
    const mud = smoothstep(-0.2, -0.9, y);
    const rock = smoothstep(0.86, 0.7, tn.getY(i)) * 0.9;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    mix.set([rock, sand * (1 - mud), mud * 0.8, 0], i * 4);
    wet[i] = smoothstep(0.25, -0.2, y);
    const dens = smoothstep(0.15, 0.8, y) * (1 - rock);
    ground.set([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), Math.round(dens * 255)], i * 4);
  }
  tgeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tgeo.setAttribute('aMix', new THREE.BufferAttribute(mix, 4));
  tgeo.setAttribute('aWet', new THREE.BufferAttribute(wet, 1));
  const tmat = terrainMaterial({ rock: '#8d887d', sand: '#cbbb8e', dirt: '#5e5140' }, shared, quality);
  const terrain = new THREE.Mesh(tgeo, tmat);
  terrain.receiveShadow = true;
  group.add(terrain);
  const maps = makeFieldMaps({ heights, nx: gx + 1, nz: gz + 1, x0: -TW / 2, z0: zMid - TD / 2, cellX: TW / gx, cellZ: TD / gz, ground });
  // Pas de route ici : carte de distance constante (loin de toute route).
  const noRoad = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat);
  noRoad.needsUpdate = true;
  maps.uniforms.uRoad.value = noRoad;

  // Eau : reflet plan en high (demi-résolution), reflet du ciel calculé sinon.
  const wopts = { mood, maps, waterY: 0, shared, chop: 0.13, shallow: '#4aa6a8', deep: '#164f6e', sand: '#a99b72', depthScale: 0.5, foam: 0.35 };
  let water;
  if (quality === 'high' && renderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const res = new THREE.Vector2(Math.min(1280, Math.round(size.x * 0.5)), Math.min(720, Math.round(size.y * 0.5)));
    water = makeReflectiveWater(TW, TD, wopts, res);
    water.position.set(0, 0, zMid);
  } else {
    water = makeWater(new THREE.PlaneGeometry(TW, TD).rotateX(-Math.PI / 2), wopts);
    water.position.set(0, 0, zMid);
  }
  group.add(water);

  // Arbres (feuillus, sapins, buissons) sur les rives et les collines, avec niveaux de détail
  const round = [];
  const pines = [];
  const bushes = [];
  const nTrees = quality === 'high' ? 2600 : quality === 'medium' ? 1800 : 900;
  for (let tries = 0; tries < nTrees * 20 && round.length + pines.length < nTrees; tries++) {
    const side = r() < 0.5 ? -1 : 1;
    const x = side * (bank + 14 + Math.pow(r(), 1.5) * 400);
    const z = zMin - 300 + r() * (len + 600);
    const y = heightAt(x, z);
    if (y < 0.7) continue;
    if (side > 0 && Math.abs(z - standZ) < 50 && x < bank + 70) continue; // tribune
    if (side < 0 && Math.abs(z + 30) < 30 && x > -bank - 45) continue; // hangar
    if (fbm(x * 0.008 + 3, z * 0.008, 3) < 0.0 && r() > 0.15) continue; // bois et clairières
    const sc = 0.8 + r() * 0.7;
    if (r() < 0.45) pines.push([x, y, z, sc * 1.1, r()]);
    else round.push([x, y, z, sc, r()]);
  }
  for (let tries = 0; tries < 4000 && bushes.length < nTrees * 0.5; tries++) {
    const side = r() < 0.5 ? -1 : 1;
    const z = zMin + r() * len;
    const x = side * (shoreX(z) + 7 + r() * 25);
    const y = heightAt(x, z);
    if (y < 0.6) continue;
    bushes.push([x, y, z, 0.7 + r() * 0.8, r()]);
  }
  const solidMat = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }), shared, { key: 'solid' });
  const leafMat = crispAlpha(windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, map: leafAtlas(), alphaTest: 0.5, side: THREE.DoubleSide }), shared, { key: 'leaf', flutter: 0.035, noFlip: true }));
  if (quality === 'high') leafMat.alphaToCoverage = true;
  const cards = quality === 'high';
  const tints = ['#ffffff', '#f2ffe0', '#e4f7d6', '#fff2c4', '#ffe0b0', '#e8fff0'].map(C);
  const forest = new Forest(group, [
    { near: deciduousGeometry(0, cards), impostor: 'deciduous', items: round, cast: quality !== 'low', tints, nearMaterial: cards ? [solidMat, leafMat] : solidMat, material: solidMat },
    { near: pineGeometry(0), impostor: 'pine', items: pines, cast: quality !== 'low', tints: null, material: solidMat },
    { near: bushGeometry(0), impostor: 'bush', items: bushes, cast: false, tints, material: solidMat },
  ], quality === 'high' ? { close: 60, mid: 130 } : quality === 'medium' ? { close: 40, mid: 90 } : { close: 0.1, mid: 50 });

  // Roseaux le long des rives (ils ondulent dans le vent)
  const reedParts = [];
  let rs = 5;
  const rr = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 9; k++) {
    const a = rr() * Math.PI * 2;
    const d = rr() * 0.45;
    const h = 1.3 + rr() * 0.9;
    const blade = new THREE.ConeGeometry(0.025, h, 3, 1, true).translate(Math.cos(a) * d, h / 2, Math.sin(a) * d);
    blade.rotateZ((rr() - 0.5) * 0.25);
    reedParts.push(paint(indexify(blade), (cc, x, y) => cc.set('#4c6b2c').lerp(C('#a6a75a'), smoothstep(0.4, 2.0, y))));
    if (k % 3 === 0) reedParts.push(colored(new THREE.CylinderGeometry(0.045, 0.045, 0.28, 5).translate(Math.cos(a) * d, h + 0.05, Math.sin(a) * d), '#5a3b22'));
  }
  const reedGeo = mergeGeometries(reedParts.map((g) => (g.index ? g : indexify(g))));
  const reeds = [];
  const nReeds = quality === 'high' ? 900 : quality === 'medium' ? 450 : 180;
  for (let tries = 0; tries < nReeds * 10 && reeds.length < nReeds; tries++) {
    const side = r() < 0.5 ? -1 : 1;
    const z = zMin + 40 + r() * (len - 100);
    const x = side * (shoreX(z * (side < 0 ? 1 : 1.07) + (side < 0 ? 0 : 40)) - 7 + r() * 11);
    const y = heightAt(x, z);
    if (y < -0.9 || y > 0.5) continue;
    if (fbm(z * 0.02, side * 5, 2) < -0.1) continue; // touffes, pas une haie continue
    reeds.push([x, y, z, 0.8 + r() * 0.5, r()]);
  }
  const reedMat = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), shared, { key: 'reed', base: 0.1, amount: 0.05 });
  const reedMesh = new THREE.InstancedMesh(reedGeo, reedMat, reeds.length);
  reeds.forEach(([x, y, z, sc, k], i) => reedMesh.setMatrixAt(i, m4.compose(v3.set(x, Math.max(y, -0.6), z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, k * 6.28), s3.set(sc, sc * (0.85 + k * 0.3), sc))));
  reedMesh.receiveShadow = true;
  group.add(reedMesh);

  // (Pas d'herbe dense ici : les rives sont hors de portée de la caméra, au milieu du bassin.)

  // Montagnes au loin
  group.add(mountainRingAround({ cx: 0, cz: zMid, r0: 900, r1: 2600, baseY: -30, h: [180, 320], snow: 0.6 }));

  // Lignes de bouées : rouges sur les 100 premiers et les 100 derniers mètres, blanches ailleurs.
  const buoys = [];
  for (let line = 0; line <= lanes; line++) {
    const x = -half + line * ROW.laneWidth;
    for (let z = 0; z <= distance; z += 10) buoys.push([x, z, z < 100 || z > distance - 100]);
  }
  const buoyMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.35 }), buoys.length);
  const red = C('#ff4a2f');
  const white = C('#f5f5f5');
  buoys.forEach(([x, z, isRed], i) => {
    m4.compose(v3.set(x, 0.06, z), q.identity(), s3.setScalar(1));
    buoyMesh.setMatrixAt(i, m4);
    buoyMesh.setColorAt(i, isRed ? red : white);
  });
  group.add(buoyMesh);

  // Ligne d'arrivée sur l'eau
  const finishLine = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff3b2f', transparent: true, opacity: 0.85 }));
  finishLine.position.set(0, 0.03, distance);
  group.add(finishLine);

  // Pontons de départ et numéros de couloirs (fusionnés, numéros dans un atlas)
  const numTex = canvasTexture(128 * lanes, 64, (cx, w, h) => {
    for (let i = 0; i < lanes; i++) {
      cx.fillStyle = '#ffd23f';
      cx.fillRect(i * 128 + 2, 2, 124, 60);
      cx.fillStyle = '#1c1f26';
      cx.font = '900 46px system-ui, sans-serif';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillText(String(i + 1), i * 128 + 64, 34);
    }
  });
  const pontoonParts = [];
  const numParts = [];
  for (let lane = 0; lane < lanes; lane++) {
    const x = -half + (lane + 0.5) * ROW.laneWidth;
    pontoonParts.push(colored(new THREE.BoxGeometry(2.4, 0.4, 1.2).translate(x, 0.1, -5.2), '#d8d2c4'));
    pontoonParts.push(colored(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6).translate(x, 0.45, -5.2), '#888888'));
    const pl = new THREE.PlaneGeometry(1.1, 0.55).rotateY(Math.PI).translate(x, 0.75, -5.2);
    const uv = pl.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (lane + uv.getX(i)) / lanes);
    numParts.push(pl);
  }
  group.add(shadowedMesh(mergeGeometries(pontoonParts.map((g) => (g.index ? g : indexify(g)))), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })));
  group.add(new THREE.Mesh(mergeUv(numParts), new THREE.MeshStandardMaterial({ map: numTex, roughness: 0.6 })));

  // Panneaux de distance sur la berge gauche (atlas)
  const marks = [];
  for (let d = 100; d < distance; d += 100) marks.push(d);
  if (marks.length) {
    const signTex = canvasTexture(256 * marks.length, 128, (cx, w, h) => {
      marks.forEach((d, i) => {
        cx.fillStyle = '#ffffff';
        cx.fillRect(i * 256 + 3, 3, 250, 122);
        cx.fillStyle = '#1c1f26';
        cx.font = '900 64px system-ui, sans-serif';
        cx.textAlign = 'center';
        cx.textBaseline = 'middle';
        cx.fillText(`${d} m`, i * 256 + 128, 68);
      });
    });
    const signs = [];
    const poles = [];
    marks.forEach((d, i) => {
      const x = -shoreX(d) - 2;
      const y = Math.max(0.3, heightAt(x, d));
      const pl = new THREE.PlaneGeometry(4, 2).rotateY(Math.PI / 2).translate(x, y + 3.0, d);
      const uv = pl.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / marks.length);
      signs.push(pl);
      poles.push(colored(new THREE.BoxGeometry(0.2, 3, 0.2).translate(x - 0.15, y + 1.2, d), '#444a55'));
    });
    group.add(new THREE.Mesh(mergeUv(signs), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6, side: THREE.DoubleSide })));
    group.add(shadowedMesh(mergeGeometries(poles), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })));
  }

  // Arche d'arrivée au-dessus du bassin
  const archMat = new THREE.MeshStandardMaterial({ color: '#ff5a1f', roughness: 0.45 });
  const archParts = [-1, 1].map((side) => new THREE.BoxGeometry(0.8, 9, 0.8).translate(side * (half + 2), 4.5, distance));
  const posts = new THREE.Mesh(mergeUv(archParts), archMat);
  posts.castShadow = true;
  group.add(posts);
  const bannerTex = signTexture('ARRIVÉE', '#ffffff', '#ff5a1f');
  bannerTex.wrapS = THREE.RepeatWrapping;
  bannerTex.repeat.x = Math.round((width + 5) / 3.6);
  const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(width + 5, 1.8, 0.5), [archMat, archMat, archMat, archMat, bannerMat, bannerMat]);
  beam.position.set(0, 9, distance);
  beam.castShadow = true;
  group.add(beam);

  // Tribune et spectateurs sur la berge droite, à l'arrivée
  const stand = new THREE.Group();
  const steps = [];
  for (let k = 0; k < 6; k++) steps.push(colored(new THREE.BoxGeometry(5, 0.8 * (k + 1), 60).translate(k * 2.2, 0.4 * (k + 1), 0), k % 2 ? '#c9c4b8' : '#bdb7aa'));
  for (const z of [-30, 30]) steps.push(colored(new THREE.BoxGeometry(14, 5.4, 0.4).translate(5.5, 2.7, z), '#a9a397'));
  for (const z of [-29, -10, 10, 29]) steps.push(colored(new THREE.BoxGeometry(0.3, 9.5, 0.3).translate(12, 4.75, z), '#5a5f6a'));
  const stepMesh = shadowedMesh(mergeGeometries(steps), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  stand.add(stepMesh);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(16, 0.4, 62), new THREE.MeshStandardMaterial({ color: '#2b6cff', roughness: 0.5 }));
  roof.position.set(6, 9.5, 0);
  roof.rotation.z = -0.12;
  roof.castShadow = true;
  stand.add(roof);
  // Public de la tribune (people.js, coordonnées monde : la tribune est posée en (bank + 8, 1, standZ))
  const seats = [];
  for (let k = 0; k < 6; k++) for (let z = -28; z <= 28; z += 1.1) if (r() < 0.8) seats.push([bank + 8 + k * 2.2 + (r() - 0.5) * 0.6, 1.0 + 0.8 * (k + 1), standZ + z + (r() - 0.5) * 0.4, -Math.PI / 2 + (r() - 0.5) * 0.3, r()]);
  buildStandCrowd(group, seats, quality);
  stand.position.set(bank + 8, 1.0, standZ);
  group.add(stand);

  // Hangar à bateaux au départ (rive gauche) avec son ponton
  const bh = [];
  const W = 14;
  const D = 10;
  bh.push(colored(new THREE.BoxGeometry(D, 4.2, W).translate(0, 2.1, 0), '#8a5a36'));
  for (let i = -6; i <= 6; i += 1.5) bh.push(colored(new THREE.BoxGeometry(D + 0.06, 4.2, 0.12).translate(0, 2.1, i), '#6e4528'));
  bh.push(colored(new THREE.CylinderGeometry(D * 0.62, D * 0.62, W + 1.2, 3, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).scale(1, 0.55, 1).translate(0, 5.6, 0), '#3d3a38'));
  for (const z of [-3.6, 0, 3.6]) bh.push(colored(new THREE.BoxGeometry(0.15, 3.2, 3.0).translate(D / 2 + 0.05, 1.6, z), '#2e2a26'));
  bh.push(colored(new THREE.BoxGeometry(12, 0.25, W + 4).translate(D / 2 + 6, 0.35, 0), '#9b7a55'));
  for (let i = 0; i < 8; i++) bh.push(colored(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 6).translate(D / 2 + 1 + (i % 4) * 3.4, -0.8, i < 4 ? -W / 2 - 1.5 : W / 2 + 1.5), '#5a4330'));
  for (let i = 0; i < 3; i++) bh.push(colored(new THREE.SphereGeometry(1, 10, 6).scale(0.25, 0.16, 4).translate(D / 2 + 4 + i * 0.7, 0.62 + i * 0.32, -2 + i * 1.6), ['#f4f4f2', '#ffd23f', '#e0384b'][i]));
  const boathouse = shadowedMesh(mergeGeometries(bh.map((g) => (g.index ? g : indexify(g)))), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  boathouse.position.set(-bank - 14, 0.95, -30);
  group.add(boathouse);

  // Brume au bout du lac : grands voiles doux posés sur l'eau
  const mistTex = canvasTexture(256, 128, (cx, w, h) => {
    const g = cx.createRadialGradient(w / 2, h * 0.7, 4, w / 2, h * 0.7, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, w, h);
  });
  const mist = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: mistTex, color: C(mood.horizon), transparent: true, depthWrite: false, fog: false, opacity: 0.55 }), 7);
  for (let i = 0; i < 7; i++) {
    m4.compose(v3.set((i - 3) * 70 + (r() - 0.5) * 30, 7 + r() * 5, zMax - 120 + r() * 80), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.PI), s3.set(220 + r() * 80, 26 + r() * 10, 1));
    mist.setMatrixAt(i, m4);
  }
  mist.renderOrder = 3;
  mist.frustumCulled = false;
  group.add(mist);

  // Oiseaux
  group.add(makeBirds(shared, new THREE.Vector3(0, 0, zMid), quality === 'low' ? 8 : 18));

  let time = 0;
  const skyU = sky.userData.uniforms;
  return {
    group,
    sky,
    center: new THREE.Vector3(0, 0, distance / 2),
    update(dt, camera) {
      time += dt;
      shared.uTime.value = time;
      skyU.uTime.value = time;
      sky.position.copy(camera.position);
      forest.update(camera.position.x, camera.position.z, camera.position.y);
    },
    dispose() {
      for (const root of [group, sky]) {
        scene.remove(root);
        disposeTree(root);
      }
      if (water.isReflector) water.dispose();
      maps.dispose();
      if (envTex) envTex.userData.release();
      scene.environment = null;
      scene.fog = prevFog;
    },
  };
}

function shadowedMesh(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Fusion de plans texturés (position, normale, uv).
function mergeUv(list) {
  let n = 0;
  let ni = 0;
  for (const g of list) {
    n += g.attributes.position.count;
    ni += g.index.count;
  }
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const idx = new Uint32Array(ni);
  let o = 0;
  let io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    for (let k = 0; k < g.index.count; k++) idx[io + k] = g.index.array[k] + o;
    o += g.attributes.position.count;
    io += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
