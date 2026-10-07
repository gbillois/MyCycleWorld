// Balade en Terre du Milieu (game/middle-earth.js) et profil des parcours ouverts. Lancer : node --test tests/*.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGES, STAGE_ORDER, PLACES, JOURNEY, LEAD, bearing, placeAt, regionAt, nextStage, readProgress, recordStage, PROGRESS_KEY,
} from '../game/middle-earth.js';
import { COURSES, SURFACES, courseById } from '../game/courses.js';
import { buildOpenProfile, profileGrade } from '../src/core/profile.js';

const SIGHTS = new Set([
  'smial', 'bagend', 'partytree', 'mill', 'bridge', 'ford', 'ferry', 'breegate', 'breehouse', 'pony', 'weathertop', 'trolls',
  'elfhouse', 'elfhall', 'waterfall', 'holly', 'ruin', 'caradhras', 'moriagate', 'mallorns', 'flet', 'elfgate', 'fangorn', 'ent',
  'orthanc', 'horses', 'helmsdeep', 'edoras', 'banner', 'argonath', 'amonhen', 'rauros', 'crags', 'marsh', 'blackgate', 'ithilien',
  'osgiliath', 'minastirith', 'morgul', 'cirithungol', 'orcpits', 'mountdoom', 'baraddur', 'sammath',
]);

// Polyligne des points de contrôle, rééchantillonnée tous les 4 m : [x, z, distance cumulée].
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

test('huit étapes de la Comté au Mordor, chargées comme des circuits', () => {
  assert.equal(STAGES.length, 8);
  assert.equal(STAGES[0].from, 'hobbiton');
  assert.equal(STAGES[7].to, 'mount-doom');
  for (const id of STAGE_ORDER) {
    assert.equal(courseById(id).id, id);
    assert.ok(COURSES[id].ride && COURSES[id].open);
  }
  assert.equal(nextStage('me-comte').id, 'me-route-est');
  assert.equal(nextStage('me-mordor'), null);
});

test('les étapes suivent l’itinéraire réel, dans l’ordre', () => {
  const index = (id) => {
    const [x, y] = PLACES[id].km;
    let best = 0;
    JOURNEY.forEach(([px, py], i) => {
      if (Math.hypot(px - x, py - y) < Math.hypot(JOURNEY[best][0] - x, JOURNEY[best][1] - y)) best = i;
    });
    return best;
  };
  let last = -1;
  for (const s of STAGES) {
    assert.ok(PLACES[s.from] && PLACES[s.to], `${s.id} : lieux connus`);
    assert.ok(index(s.from) >= last, `${s.id} part après l’étape précédente`);
    assert.ok(index(s.to) > index(s.from), `${s.id} avance sur l’itinéraire`);
    last = index(s.to);
    assert.equal(s.heading, bearing(s.from, s.to), 'cap de départ = direction réelle de l’étape');
  }
  assert.equal(bearing('hobbiton', 'bree'), -0); // plein est
  assert.ok(Math.abs(bearing('rivendell', 'moria') - 104) <= 1); // vers le sud
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

  test(`${s.name} : pentes, lieux, monuments et revêtements valides`, () => {
    const { grade } = buildOpenProfile(s.profile, 1000, 3);
    assert.ok(Math.max(...grade) <= 9 && Math.min(...grade) >= -6, 'pentes de balade');
    let last = -1;
    for (const [u, name] of s.places) {
      assert.ok(u >= last && u >= 0 && u <= 1 && name, 'lieux ordonnés');
      last = u;
    }
    assert.equal(placeAt(s, 0), s.places[0][1]);
    for (const [kind, u, side, dist] of s.sights) {
      assert.ok(SIGHTS.has(kind), `monument connu (${kind})`);
      assert.ok(u >= 0 && u <= 1.08, `${kind} sur l’étape ou juste après l’arrivée`);
      assert.ok([-1, 0, 1].includes(side) && dist >= 0);
    }
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
  const comte = STAGES[0];
  assert.equal(placeAt(comte, 0.5), 'Pont du Brandevin');
  assert.equal(placeAt(comte, 1), 'Bree');
  const marais = STAGES.find((s) => s.id === 'me-marais');
  assert.equal(regionAt(marais, 0.3), 'marsh');
  assert.equal(regionAt(marais, 0.5), 'ash');
  assert.equal(regionAt(marais, 0.8), 'ithilien');
});

test('meilleurs temps enregistrés par étape', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(readProgress(storage), {});
  assert.equal(recordStage(storage, 'me-comte', 420.04).best, true);
  assert.equal(recordStage(storage, 'me-comte', 500).best, false);
  assert.equal(recordStage(storage, 'me-comte', 400).best, true);
  assert.deepEqual(readProgress(storage), { 'me-comte': 400 });
  store.set(PROGRESS_KEY, '{"me-comte": "abc", "inconnu": 3}');
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
