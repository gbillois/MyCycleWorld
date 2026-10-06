// Casques de vélo lancés (rendu) : modèle stylisé de casque de route (coque arrondie, aérations, bandes
// blanches, visière), vert ou rouge, qui tourne sur lui-même en volant, sautille, avec une lueur et une
// courte traînée. Réserve fixe d'objets créée une fois (cachée tant qu'elle ne sert pas) : rien n'est alloué
// pendant la course, et les programmes graphiques sont compilés à l'écran de chargement (warmShaders).
// La logique de vol est dans src/core/helmets.js, les casques eux-mêmes dans race.helmets.
import * as THREE from 'three';

const POOL = 8; // casques affichés en même temps au plus (un par coureur, plus ceux qui éclatent)
const TRAIL = 6; // points de traînée par casque
const SCALE = 0.34; // rayon de la coque : ~0,8 m de long (exagéré, lisible de loin)
const POP = 0.45; // s : casque qui rebondit en l'air après un choc
const FADE = 0.25; // s : casque qui disparaît en fin de course
const FAR2 = 170 * 170; // au-delà (m²), dans la brume : pas dessiné

const COLORS = {
  green: '#22b84a',
  red: '#e3242b',
  stripe: '#ffffff',
  vent: '#16181d',
  rim: '#2a2e36',
  visor: '#121418',
};

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Coque : grille (α, β) sur une sphère dont l'axe est latéral. α = angle depuis le côté droit (écart
// latéral u = α - π/2), β = angle autour de l'axe latéral, de l'avant (en bas) à l'arrière (plus bas).
// Les lignes d'α constant courent d'avant en arrière par-dessus la tête, comme les aérations d'un casque :
// les coupures de la grille tombent pile sur les bords des aérations et des bandes (couleurs nettes).
const U_BREAKS = [0, 0.1, 0.22, 0.29, 0.38, 0.47, 0.6, 0.7, 0.82, 1.0, 1.2, 1.38, 1.555];
const B0 = -0.12;
const B1 = Math.PI + 0.22;
const NB = 24;

// Couleur de chaque cellule : liseré du bas (première et dernière rangée, c'est-à-dire tout le tour de la
// coque), aération (sur un intervalle de β), bande blanche ou couleur du casque.
function cellColor(u, b, row, kind) {
  const a = Math.abs(u);
  if (row === 0 || row === NB - 1) return COLORS.rim;
  if (a > 0.1 && a < 0.22 && b > 0.5 && b < 2.6) return COLORS.vent;
  if (a > 0.29 && a < 0.38 && b > 0.05 && b < 3.05) return COLORS.stripe;
  if (a > 0.47 && a < 0.6 && b > 0.7 && b < 2.45) return COLORS.vent;
  if (a > 0.7 && a < 0.82 && b > 1.0 && b < 2.15) return COLORS.vent;
  return COLORS[kind];
}

// Déformation de la sphère unité en casque : plus étroit, plus long, aplati, arrière effilé.
function shape(x, y, z, out) {
  let X = x * 0.84;
  let Y = y * 0.8;
  let Z = z * 1.16;
  if (Z < 0) {
    // Queue aérodynamique : l'arrière s'allonge au milieu et descend un peu.
    const k = (1 - Math.abs(x)) * -z;
    Z *= 1 + 0.28 * k;
    Y -= 0.06 * k;
  }
  if (Z > 0) Y *= 1 - 0.12 * smooth(0.3, 1, z); // front plus bas
  out[0] = X;
  out[1] = Y;
  out[2] = Z;
}

function helmetGeometry(kind) {
  const us = [...U_BREAKS.slice(1).reverse().map((u) => -u), ...U_BREAKS];
  const NA = us.length - 1;
  const pos = [];
  const p = [0, 0, 0];
  for (let j = 0; j <= NB; j++) {
    const b = B0 + ((B1 - B0) * j) / NB;
    for (let i = 0; i <= NA; i++) {
      const al = Math.PI / 2 + us[i];
      const r = Math.sin(al);
      shape(Math.cos(al), r * Math.sin(b), r * Math.cos(b), p);
      pos.push(p[0], p[1], p[2]);
    }
  }
  const idx = [];
  const cells = [];
  const W = NA + 1;
  for (let j = 0; j < NB; j++) {
    for (let i = 0; i < NA; i++) {
      const a = j * W + i;
      idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
      const uc = (us[i] + us[i + 1]) / 2;
      const bc = B0 + ((B1 - B0) * (j + 0.5)) / NB;
      cells.push(cellColor(uc, bc, j, kind));
    }
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shell.setIndex(idx);
  // Orientation des faces vers l'extérieur (le haut de la coque doit avoir une normale vers le haut).
  shell.computeVertexNormals();
  const top = Math.round(NB / 2) * W + Math.round(NA / 2);
  if (shell.attributes.normal.getY(top) < 0) {
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    shell.setIndex(idx);
    shell.computeVertexNormals();
  }
  const flat = shell.toNonIndexed(); // normales lisses conservées, couleur nette par face
  shell.dispose();

  // Visière : petite bande arquée qui dépasse à l'avant, légèrement inclinée vers le bas.
  const vis = [];
  const VA = 10;
  const vs = [];
  for (let i = 0; i <= VA; i++) {
    const u = -0.62 + (1.24 * i) / VA;
    const al = Math.PI / 2 + u;
    const r = Math.sin(al);
    shape(Math.cos(al), r * Math.sin(0.02), r * Math.cos(0.02), p);
    const inner = [p[0], p[1], p[2]];
    vs.push([inner, [p[0] * 1.06, p[1] - 0.05, p[2] + 0.2 * r]]);
  }
  for (let i = 0; i < VA; i++) {
    const [a0, a1] = vs[i];
    const [b0, b1] = vs[i + 1];
    vis.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
  }
  const vgeo = new THREE.BufferGeometry();
  vgeo.setAttribute('position', new THREE.Float32BufferAttribute(vis, 3));
  vgeo.computeVertexNormals();

  // Assemblage : coque + visière, couleurs par sommet (espace linéaire).
  const nShell = flat.attributes.position.count;
  const nVis = vgeo.attributes.position.count;
  const P = new Float32Array((nShell + nVis) * 3);
  const N = new Float32Array((nShell + nVis) * 3);
  const C = new Float32Array((nShell + nVis) * 3);
  P.set(flat.attributes.position.array, 0);
  P.set(vgeo.attributes.position.array, nShell * 3);
  N.set(flat.attributes.normal.array, 0);
  N.set(vgeo.attributes.normal.array, nShell * 3);
  const col = new THREE.Color();
  for (let t = 0; t < nShell / 3; t++) {
    col.set(cells[Math.floor(t / 2)]);
    for (let k = 0; k < 3; k++) C.set([col.r, col.g, col.b], (t * 3 + k) * 3);
  }
  col.set(COLORS.visor);
  for (let v = nShell; v < nShell + nVis; v++) C.set([col.r, col.g, col.b], v * 3);
  flat.dispose();
  vgeo.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.scale(SCALE, SCALE, SCALE);
  g.computeBoundingSphere();
  return g;
}

// Lueur douce (disque dégradé, additive), teintée par la couleur du matériau.
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createResources(detailed) {
  const glow = glowTexture();
  const sprite = (color) => new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: true });
  return {
    geo: { green: helmetGeometry('green'), red: helmetGeometry('red') },
    // Plastique brillant : vernis en graphismes détaillés, matériau standard en graphismes simples.
    mat: detailed
      ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0, side: THREE.DoubleSide }),
    glow: { green: sprite('#7dff8f'), red: sprite('#ff6a4d') },
    trail: { green: sprite('#3cff6a'), red: sprite('#ff4a2a') },
    tex: glow,
  };
}

export class HelmetFx {
  constructor(scene, { detailed = true, shadows = false } = {}) {
    this.res = createResources(detailed);
    this.group = new THREE.Group();
    this.group.name = 'helmets';
    scene.add(this.group);
    this.tmp = {};
    this.slots = [];
    for (let i = 0; i < POOL; i++) {
      const root = new THREE.Group();
      const meshes = {};
      for (const kind of ['green', 'red']) {
        const m = new THREE.Mesh(this.res.geo[kind], this.res.mat);
        m.castShadow = shadows;
        m.visible = false;
        meshes[kind] = m;
        root.add(m);
      }
      const glow = new THREE.Sprite(this.res.glow.green);
      glow.scale.setScalar(1.2);
      root.add(glow);
      root.visible = false;
      this.group.add(root);
      const trail = [];
      for (let k = 0; k < TRAIL; k++) {
        const s = new THREE.Sprite(this.res.trail.green);
        s.visible = false;
        trail.push(s);
        this.group.add(s);
      }
      this.slots.push({ root, meshes, glow, trail, hist: new Float32Array(TRAIL * 3), count: 0, head: 0, h: null, t: 0, spin: 0, end: -1 });
    }
  }

  // Course quittée ou nouvelle course : tous les casques rentrent dans la réserve.
  reset() {
    for (const slot of this.slots) this.free(slot);
  }

  free(slot) {
    slot.h = null;
    slot.end = -1;
    slot.root.visible = false;
    for (const s of slot.trail) s.visible = false;
  }

  take(h) {
    for (const slot of this.slots) {
      if (slot.h) continue;
      slot.h = h;
      slot.t = 0;
      slot.end = -1;
      slot.count = 0;
      slot.spin = Math.random() * Math.PI * 2;
      slot.meshes.green.visible = h.kind === 'green';
      slot.meshes.red.visible = h.kind === 'red';
      slot.glow.material = this.res.glow[h.kind];
      for (const s of slot.trail) s.material = this.res.trail[h.kind];
      slot.root.visible = true;
      h.fx = slot;
      return;
    }
    h.fx = null; // réserve pleine : ce casque vole sans être dessiné
  }

  // Une fois par image : position, rotation, sautillement, lueur, traînée, éclatement.
  sync(race, track, dt, camera) {
    if (!race) return;
    for (const h of race.helmets) if (h.fx === undefined) this.take(h);
    const cam = camera.position;
    for (const slot of this.slots) {
      const h = slot.h;
      if (!h) continue;
      slot.t += dt;
      if (h.done && slot.end < 0) slot.end = 0;
      const red = h.kind === 'red';
      const root = slot.root;
      if (slot.end >= 0) {
        // Fin : le casque rebondit en l'air en tournoyant (choc) ou se dégonfle (fin de course).
        slot.end += dt;
        const pop = h.reason !== 'expire';
        const life = pop ? POP : FADE;
        const k = slot.end / life;
        if (k >= 1) {
          this.free(slot);
          continue;
        }
        const f = track.frame(h.s, h.lateral, this.tmp);
        const up = pop ? 3.4 * slot.end - 7 * slot.end * slot.end : 0;
        root.position.set(f.x, f.y + 0.3 + Math.max(0, up), f.z);
        slot.spin += dt * (pop ? 26 : 8);
        root.rotation.set(pop ? slot.end * 14 : 0, slot.spin, pop ? slot.end * 9 : 0);
        root.scale.setScalar(pop ? 1 - 0.5 * k : 1 - k);
        slot.glow.scale.setScalar(pop ? 1.2 + 5 * k : 1.2 * (1 - k));
        this.fadeTrail(slot, k);
        continue;
      }
      const f = track.frame(h.s, h.lateral, this.tmp);
      const hop = Math.abs(Math.sin(slot.t * 9)) * 0.1;
      root.position.set(f.x, f.y + 0.3 + hop, f.z);
      slot.spin += dt * (red ? 15 : 12);
      root.rotation.set(0.12 * Math.sin(slot.t * 7), slot.spin, 0.1 * Math.cos(slot.t * 5));
      root.scale.setScalar(Math.min(1, 0.4 + slot.t * 6)); // jaillit de la main du lanceur
      const pulse = red ? 1 + 0.25 * Math.sin(slot.t * 22) : 1 + 0.1 * Math.sin(slot.t * 10);
      slot.glow.scale.setScalar(1.2 * pulse);
      root.visible = root.position.distanceToSquared(cam) < FAR2;
      this.pushTrail(slot, root.position);
    }
  }

  // Traînée : derniers points de passage, de plus en plus petits.
  pushTrail(slot, p) {
    const H = slot.hist;
    const last = ((slot.head + TRAIL - 1) % TRAIL) * 3;
    if (slot.count && (H[last] - p.x) ** 2 + (H[last + 1] - p.y) ** 2 + (H[last + 2] - p.z) ** 2 < 0.25) return;
    H[slot.head * 3] = p.x;
    H[slot.head * 3 + 1] = p.y;
    H[slot.head * 3 + 2] = p.z;
    slot.head = (slot.head + 1) % TRAIL;
    slot.count = Math.min(TRAIL, slot.count + 1);
    for (let k = 0; k < TRAIL; k++) {
      const s = slot.trail[k];
      if (k >= slot.count) {
        s.visible = false;
        continue;
      }
      const i = ((slot.head - 1 - k + TRAIL * 2) % TRAIL) * 3;
      s.position.set(H[i], H[i + 1], H[i + 2]);
      s.scale.setScalar(0.62 * (1 - k / TRAIL));
      s.visible = slot.root.visible;
    }
  }

  fadeTrail(slot, k) {
    for (let i = 0; i < TRAIL; i++) {
      const s = slot.trail[i];
      if (!s.visible) continue;
      s.scale.setScalar(0.62 * (1 - i / TRAIL) * (1 - k));
    }
  }
}
