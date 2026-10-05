// Petits outils de géométrie partagés par le décor détaillé et le cycliste détaillé.
import * as THREE from 'three';

// Fusionne des géométries indexées ayant position/normal/(color) en une seule.
export function mergeGeometries(list) {
  let vCount = 0;
  let iCount = 0;
  for (const g of list) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, vo * 3);
    else col.fill(1, vo * 3, (vo + n) * 3);
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[io + k] = g.index.array[k] + vo;
    else for (let k = 0; k < n; k++) idx[io + k] = k + vo;
    io += g.index ? g.index.count : n;
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export function paint(geo, colorFn) {
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    colorFn(c, p.getX(i), p.getY(i), p.getZ(i));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Les icosaèdres sont non indexés : on leur ajoute un index trivial pour la fusion.
export function indexify(g) {
  if (g.index) return g;
  const n = g.attributes.position.count;
  g.setIndex(Array.from({ length: n }, (_, i) => i));
  return g;
}


// Couleur unie sur toute la géométrie (pour fusionner des pièces de couleurs différentes).
export function colored(geo, color) {
  const c = new THREE.Color(color);
  return paint(geo, (out) => out.copy(c));
}
