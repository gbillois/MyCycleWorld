// Emplacements des sources sonores d'un niveau (module pur, testé dans tests/audio.test.js), calculés à partir
// du tracé avec les mêmes règles que le décor (game/features.js, game/scenery.js, game/rowing-scene.js) :
// ferme et animaux, vaches à cloche, église et fontaine du village, rivage, spectateurs, tribune d'arrivée.
// track : objet du type Track (length, course, frame(s, lateral), gradeAt(s), surfaceAt(s), bounds, nearest, minY).

export const ROAD_HALF = 4; // même valeur que track.js

// Ligne du rivage de la Côte des Dunes (même formule que coastZ dans features.js).
export function coastZ(cfg, x) {
  return cfg.z + 6 * Math.sin(x * 0.013) + 4 * Math.sin(x * 0.031 + 1);
}

const pt = (f, dy = 0) => ({ x: f.x, y: f.y + dy, z: f.z });

// Lac de la Vallée Verte : point le plus éloigné de la route (recherche grossière, comme findLake dans scenery.js).
export function findLake(track) {
  const b = track.bounds;
  let best = { dist: 0 };
  for (let x = b.minX + 40; x < b.maxX - 40; x += 24) {
    for (let z = b.minZ + 40; z < b.maxZ - 40; z += 24) {
      const n = track.nearest(x, z, 8);
      if (n.dist > best.dist) best = { x, z, dist: n.dist };
    }
  }
  return best.dist < 60 ? null : best;
}

// Points tirés régulièrement dans une zone (s0..s1 le long de la route, l0..l1 sur le côté).
function zonePoints(track, zone, n = 16) {
  const out = [];
  const cols = Math.ceil(Math.sqrt(n * 2));
  const rows = Math.ceil(n / cols);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const s = zone.s0 + ((i + 0.5) / cols) * (zone.s1 - zone.s0);
      const l = zone.l0 + ((j + 0.5) / rows) * (zone.l1 - zone.l0);
      out.push(pt(track.frame(s, l), 1));
    }
  }
  return out;
}

export function soundSpots(track) {
  const course = track.course;
  const feats = course.features || {};
  const L = track.length;
  const spots = { theme: course.theme, length: L, farm: null, cows: [], church: null, fountain: null, village: null, crowds: [], coast: null, beach: null, stream: null };

  // Ferme (Vallée Verte) : pâturage du côté opposé au lac, grange au fond.
  if (feats.farm) {
    const s0 = feats.farm.from * L;
    const s1 = feats.farm.to * L;
    const sm = (s0 + s1) / 2;
    const mid = track.frame(sm, 0);
    let side = 1;
    const lake = feats.lake ? findLake(track) : null;
    if (lake) side = (lake.x - mid.x) * mid.rx + (lake.z - mid.z) * mid.rz > 0 ? -1 : 1;
    let l0 = side * (ROAD_HALF + 9);
    let l1 = side * (ROAD_HALF + 38);
    if (l0 > l1) [l0, l1] = [l1, l0];
    const zone = { s0: s0 + 8, s1: s1 - 8, l0, l1 };
    spots.farm = {
      center: pt(track.frame(sm, side * (ROAD_HALF + 23)), 1),
      points: zonePoints(track, zone, 18),
      barn: pt(track.frame(sm, side * (ROAD_HALF + 58)), 3),
      radius: 240,
    };
    if (lake) spots.lake = { x: lake.x, y: track.minY, z: lake.z };
  }

  // Vaches à cloche (Col des Chalets) : trois troupeaux de quatre, chacun avec sa sonnaille.
  if (feats.cows) {
    for (const [frac, side] of [[0.18, 1], [0.56, -1], [0.8, 1]]) {
      const s = frac * L;
      let l0 = side * (ROAD_HALF + 10);
      let l1 = side * (ROAD_HALF + 30);
      if (l0 > l1) [l0, l1] = [l1, l0];
      const k = spots.cows.length;
      spots.cows.push({
        center: pt(track.frame(s + 20, side * (ROAD_HALF + 20)), 1),
        points: zonePoints(track, { s0: s, s1: s + 40, l0, l1 }, 12),
        bells: [0, 1, 2, 3].map((i) => 480 + ((k * 4 + i) * 137) % 520), // tailles de cloches toutes différentes
      });
    }
  }

  // Village de chalets : église (cloche dans le clocher) et fontaine au milieu.
  if (feats.village) {
    const sm = ((feats.village.from + feats.village.to) / 2) * L;
    spots.church = pt(track.frame(sm, -(ROAD_HALF + 24)), 13);
    spots.fountain = pt(track.frame(sm, ROAD_HALF + 8), 1);
    spots.village = { center: pt(track.frame(sm, 0)), radius: ((feats.village.to - feats.village.from) * L) / 2 + 60 };
    // Torrent au fond du vallon : sous le point le plus bas du tracé, loin du bord.
  }
  if (course.theme === 'alpine') {
    let low = 0;
    for (let s = 0; s < L; s += 10) if (track.frame(s).y < track.frame(low).y) low = s;
    const f = track.frame(low, -(ROAD_HALF + 70));
    spots.stream = { x: f.x, y: f.y - 15, z: f.z };
  }

  // Rivage (Côte des Dunes) et plage habitée (au milieu de la route de sable).
  if (feats.coast) {
    spots.coast = { z: feats.coast.z, seaY: track.minY - 0.7 };
    const sand = (course.surfaces || []).find((x) => x[2] === 'sand');
    if (sand) {
      const f = track.frame(((sand[0] + sand[1]) / 2) * L, 0);
      spots.beach = { x: f.x, y: f.y + 1, z: (f.z + coastZ(feats.coast, f.x)) / 2 };
    }
  }

  // Forêt (VTT) : le ruisseau au gué et un peu en amont, des spectateurs à chaque saut.
  const half = track.half ?? ROAD_HALF;
  if (feats.creek) {
    const sm = ((feats.creek.from + feats.creek.to) / 2) * L;
    spots.creek = pt(track.frame(sm, 0), 0.2);
    spots.creekFar = pt(track.frame(feats.creek.from * L - 8, half + 22), 0.5);
  }
  for (const [u] of course.mtb?.jumps || []) spots.crowds.push({ ...pt(track.frame(u * L + 3, half + 3), 1.5), s: u * L + 3, kind: 'climb' });

  // Spectateurs : derrière les barrières du départ, et le long des montées (comme sur le Tour).
  spots.crowds.push({ ...pt(track.frame(-30, -(half + 2.5)), 1.5), s: L - 30, kind: 'start' });
  spots.crowds.push({ ...pt(track.frame(24, half + 2.5), 1.5), s: 24, kind: 'start' });
  let runStart = null;
  let side = 1;
  for (let s = 0; s <= L; s += 10) {
    const climbing = s < L && track.gradeAt(s) >= 4.5 && track.surfaceAt(s) === 'asphalt';
    if (climbing && runStart === null) runStart = s;
    if (!climbing && runStart !== null) {
      const len = s - runStart;
      const n = Math.max(1, Math.round(len / 110));
      for (let k = 0; k < n; k++) {
        const sc = runStart + ((k + 0.5) / n) * len;
        spots.crowds.push({ ...pt(track.frame(sc, side * (half + 4)), 1.5), s: sc, kind: 'climb' });
        side = -side;
      }
      runStart = null;
    }
  }
  return spots;
}

// Bassin d'aviron (même géométrie que rowing-scene.js) : couloirs de 13,5 m, berges, tribune à l'arrivée.
export function rowingSpots(distance = 500, lanes = 6, laneWidth = 13.5) {
  const half = (lanes * laneWidth) / 2;
  const bank = half + 22;
  return {
    distance,
    bank,
    stand: { x: bank + 11, y: 4, z: distance - 10 },
    boathouse: { x: -bank - 8, y: 2, z: -20 },
  };
}
