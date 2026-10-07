// Grande Balade (game/balade.js) et profil des parcours ouverts. Lancer : node --test tests/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGES, STAGE_ORDER, LEAD, TOUR_ID, placeAt, regionAt, nextStage, worldMap, readProgress, recordStage, PROGRESS_KEY,
} from '../game/balade.js';
import { COURSES, SURFACES, courseById } from '../game/courses.js';
import { buildOpenProfile, profileGrade } from '../src/core/profile.js';

const SIGHTS = new Set([
  'hillhouse', 'bighillhouse', 'bigtree', 'mill', 'bridge', 'ford', 'ferry', 'villagegate', 'timberhouse', 'inn',
  'ruinedtower', 'standingstones', 'villa', 'bigvilla', 'waterfall', 'holly', 'ruin', 'peak', 'minegate', 'lakeserpent',
  'goldforest', 'treehouse', 'woodarch', 'oldforest', 'castle', 'horses', 'canyonfort', 'hillhall', 'pennant', 'giants',
  'belvedere', 'bigfalls', 'crags', 'marsh', 'greatwall', 'ruins', 'rockcastle', 'spires', 'fumaroles', 'volcano',
]);
const REGIONS = new Set(['collines', 'foretdor', 'lac', 'plaines', 'landes', 'vertbois', 'neiges', 'feu']);

// Polyligne des points de contrôle, rééchantillonnée tous les `step` m : [x, z, distance cumulée].
function densify(control, step = 4) {
  const out = [];
  let s = 0;
  for (let i = 0; i < control.length - 1; i++) {
    const [x0, z0] = control[i];
    const [x1, z1] = control[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) out.push([x0 + ((x1 - x0) * j) / k, z0 + ((z1 - z0) * j) / k, s + (len * j) / k]);
    s += len;
  }
  return { pts: out, length: s };
}

test('huit zones, des Collines Fleuries aux Terres de Feu, chargées comme des circuits', () => {
  assert.equal(STAGES.length, 8);
  assert.equal(STAGES[0].id, 'tour-collines');
  assert.equal(STAGES[7].id, 'tour-feu');
  STAGES.forEach((s, i) => {
    assert.equal(s.index, i);
    assert.equal(courseById(s.id).id, s.id);
    assert.ok(COURSES[s.id].ride && COURSES[s.id].open);
    assert.ok(REGIONS.has(s.region), `région connue (${s.region})`);
  });
  assert.equal(nextStage('tour-collines').id, 'tour-foret');
  assert.equal(nextStage('tour-feu'), null);
  assert.equal(new Set(STAGE_ORDER).size, 8);
});

test('carte du monde : les zones s’enchaînent bout à bout sans se croiser', () => {
  const world = worldMap();
  assert.equal(world.length, 8);
  for (let i = 1; i < world.length; i++) {
    const prev = world[i - 1].points;
    const [ex, ez] = prev[prev.length - 1];
    const [sx, sz] = world[i].points[0];
    assert.ok(Math.hypot(ex - sx, ez - sz) < 1e-6, `la zone ${i + 1} part de l’arrivée de la zone ${i}`);
  }
  // Deux zones différentes restent à plus de 150 m l'une de l'autre (hors de la jonction entre voisines).
  let min = Infinity;
  for (let a = 0; a < world.length; a++) {
    for (let b = a + 1; b < world.length; b++) {
      const pa = b === a + 1 ? world[a].points.slice(0, -14) : world[a].points;
      const pb = b === a + 1 ? world[b].points.slice(14) : world[b].points;
      for (const [x0, z0] of pa) for (const [x1, z1] of pb) min = Math.min(min, Math.hypot(x0 - x1, z0 - z1));
    }
  }
  assert.ok(min > 150, `écart minimal entre zones ${min.toFixed(0)} m`);
  // Un monde compact (à peu près carré) pour la carte.
  const all = world.flatMap((z) => z.points);
  const w = Math.max(...all.map((p) => p[0])) - Math.min(...all.map((p) => p[0]));
  const h = Math.max(...all.map((p) => p[1])) - Math.min(...all.map((p) => p[1]));
  assert.ok(Math.max(w, h) / Math.min(w, h) < 1.8, `proportions ${Math.round(w)} × ${Math.round(h)} m`);
});

for (const s of STAGES) {
  test(`${s.name} : parcours ouvert jouable, sans chevauchement`, () => {
    const { pts, length } = densify(s.control);
    const drive = length - LEAD[0] - LEAD[1];
    assert.ok(drive > 1800 && drive < 3600, `longueur ${Math.round(drive)} m`);
    const [x0, z0] = s.control[0];
    const [x1, z1] = s.control[s.control.length - 1];
    assert.ok(Math.hypot(x1 - x0, z1 - z0) > 300, 'l’arrivée est loin du départ');
    // Deux passages de la route séparés de plus de 260 m de route restent à 50 m au moins l'un de l'autre.
    let min = Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      for (let j = i + 2; j < pts.length; j += 2) {
        if (pts[j][2] - pts[i][2] < 260) continue;
        min = Math.min(min, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
      }
    }
    assert.ok(min >= 50, `écart minimal ${min.toFixed(0)} m`);
  });

  test(`${s.name} : pentes, lieux, décors et revêtements valides`, () => {
    const { grade } = buildOpenProfile(s.profile, 1000, 3);
    assert.ok(Math.max(...grade) <= 9 && Math.min(...grade) >= -6, 'pentes de balade');
    let last = -1;
    for (const [u, name] of s.places) {
      assert.ok(u >= last && u >= 0 && u <= 1 && name, 'lieux ordonnés');
      last = u;
    }
    assert.equal(placeAt(s, 0), s.places[0][1]);
    for (const [kind, u, side, dist] of s.sights) {
      assert.ok(SIGHTS.has(kind), `décor connu (${kind})`);
      assert.ok(u >= 0 && u <= 1.08, `${kind} sur la zone ou juste après l’arrivée`);
      assert.ok([-1, 0, 1].includes(side) && dist >= 0);
    }
    for (const [u0, u1, h, w0, w1] of s.walls || []) assert.ok(u0 < u1 && h > 0 && w0 < w1, 'parois valides');
    for (const [a, b, type] of s.surfaces) assert.ok(a < b && SURFACES[type], `revêtement ${type}`);
    assert.ok(SURFACES[s.baseSurface], 'chemin de terre');
    if (s.lake) {
      // Centre du lac à côté de la route (comme Track.frame : droite = (-tz, tx)), puis distance à toute la route.
      const { pts, length } = densify(s.control, 2);
      const at = LEAD[0] + s.lake.u * (length - LEAD[0] - LEAD[1]);
      const i = pts.findIndex((p) => p[2] >= at);
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const l = Math.hypot(bx - ax, bz - az);
      const cx = ax + (-(bz - az) / l) * s.lake.side * s.lake.dist;
      const cz = az + ((bx - ax) / l) * s.lake.side * s.lake.dist;
      const gap = Math.min(...pts.map(([x, z]) => Math.hypot(x - cx, z - cz))) - s.lake.r * 1.34;
      assert.ok(gap > 8, `le lac reste à ${gap.toFixed(0)} m de la route`);
    }
  });
}

test('lieux traversés et teintes du sol', () => {
  const collines = STAGES[0];
  assert.equal(placeAt(collines, 0.5), 'Pont-de-Pierre');
  assert.equal(placeAt(collines, 1), 'Hautes-Haies');
  const marais = STAGES.find((s) => s.id === 'tour-marais');
  assert.equal(regionAt(marais, 0.3), 'marsh');
  assert.equal(regionAt(marais, 0.5), 'ash');
  assert.equal(regionAt(marais, 0.8), 'vertbois');
});

test('meilleurs temps enregistrés par zone et pour le Grand Tour', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(readProgress(storage), {});
  assert.equal(recordStage(storage, 'tour-collines', 420.04).best, true);
  assert.equal(recordStage(storage, 'tour-collines', 500).best, false);
  assert.equal(recordStage(storage, 'tour-collines', 400).best, true);
  assert.equal(recordStage(storage, TOUR_ID, 3600).best, true);
  assert.deepEqual(readProgress(storage), { 'tour-collines': 400, [TOUR_ID]: 3600 });
  store.set(PROGRESS_KEY, '{"tour-collines": "abc", "inconnu": 3}');
  assert.deepEqual(readProgress(storage), {}, 'valeurs invalides ignorées');
  store.set(PROGRESS_KEY, 'pas du json');
  assert.deepEqual(readProgress(storage), {});
  assert.deepEqual(readProgress(null), {});
});

test('profil d’un parcours ouvert : pas de retour à l’altitude de départ', () => {
  const profile = [[0, 0], [0.1, 5], [0.9, 5], [1, 0]];
  const n = 1000;
  const { grade, y } = buildOpenProfile(profile, n, 2);
  assert.equal(grade.length, n + 1);
  assert.ok(y[n] > 70, `on finit en haut (${y[n].toFixed(1)} m)`);
  assert.ok(Math.abs(grade[500] - profileGrade(profile, 0.5)) < 1e-6);
  // Prolongements avant le départ et après l'arrivée : pente des extrémités du profil.
  const lead = buildOpenProfile(profile, 100, 1, (i) => Math.min(1, Math.max(0, (i - 20) / 60)));
  assert.equal(lead.grade[5], 0);
  assert.equal(lead.grade[95], 0);
});
