// Bassin d'aviron : eau animée, berges boisées, lignes de bouées, panneaux de distance, tribune,
// arche d'arrivée et bateaux (skiff avec rameur et avirons animés au rythme des coups).
import * as THREE from 'three';
import { makeSky, makeEnvironment, disposeTree } from './scenery.js';
import { makeLabel } from './models.js';
import { rng } from './track.js';
import { ROW } from '../src/core/rowing.js';

const C = (hex) => new THREE.Color(hex);

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

// --- Bassin ---

export function buildRowingWorld(scene, { lanes = 6, distance = ROW.distance, quality = 'high', renderer = null, detailed = true } = {}) {
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
