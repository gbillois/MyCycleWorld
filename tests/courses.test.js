// Circuits (game/courses.js) et profil d'altitude (src/core/profile.js). Lancer : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSES, COURSE_ORDER, SURFACES, courseById, road, surfaceAtFraction } from '../game/courses.js';
import { buildProfile, profileGrade, elevationGain } from '../src/core/profile.js';

test('trois circuits, dans l’ordre du menu', () => {
  assert.deepEqual(COURSE_ORDER, ['vallee', 'col', 'plage']);
  for (const id of COURSE_ORDER) assert.equal(COURSES[id].id, id);
  assert.equal(courseById('inconnu').id, 'vallee');
});

for (const id of COURSE_ORDER) {
  const c = COURSES[id];
  test(`${c.name} : profil qui boucle, pentes réalistes`, () => {
    const n = 2000;
    const { grade, y, closure } = buildProfile(c.profile, n, 1);
    assert.ok(Math.abs(closure) < 1e-6, `retour à l’altitude de départ (écart ${closure})`);
    assert.equal(y[n], y[0]);
    const max = Math.max(...grade);
    const min = Math.min(...grade);
    assert.ok(max <= 10 && min >= -13, `pentes ${min.toFixed(1)} à ${max.toFixed(1)} %`);
    assert.ok(c.laps >= 1 && c.control.length >= 8);
  });
  test(`${c.name} : revêtements valides`, () => {
    let last = 0;
    for (const [a, b, type] of c.surfaces) {
      assert.ok(a >= last && b > a && b <= 1, 'tronçons ordonnés et sans chevauchement');
      assert.ok(SURFACES[type], `type connu (${type})`);
      last = b;
    }
  });
}

test('le Col des Chalets est le plus montagneux, la plage a du sable', () => {
  const gain = (id) => elevationGain(buildProfile(COURSES[id].profile, 2000, 1).grade, 1);
  assert.ok(gain('col') > gain('vallee') * 1.5);
  assert.equal(surfaceAtFraction(COURSES.plage, 0.5), 'sand');
  assert.equal(surfaceAtFraction(COURSES.plage, 0.32), 'boardwalk');
  assert.equal(surfaceAtFraction(COURSES.plage, 0.05), 'asphalt');
  assert.equal(surfaceAtFraction(COURSES.vallee, 0.5), 'asphalt');
});

// Polyligne fermée des points de contrôle, rééchantillonnée tous les `step` m : [x, z, distance cumulée].
function densify(control, step = 4) {
  const out = [];
  let s = 0;
  for (let i = 0; i < control.length; i++) {
    const [x0, z0] = control[i];
    const [x1, z1] = control[(i + 1) % control.length];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) out.push([x0 + ((x1 - x0) * j) / k, z0 + ((z1 - z0) * j) / k, s + (len * j) / k]);
    s += len;
  }
  return { pts: out, length: s };
}

// Somme des changements de cap (degrés) par km le long de la polyligne de contrôle.
function turnPerKm(control) {
  let turn = 0;
  let len = 0;
  const n = control.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = control[(i + n - 1) % n];
    const [bx, bz] = control[i];
    const [cx, cz] = control[(i + 1) % n];
    const d = Math.atan2(cz - bz, cx - bx) - Math.atan2(bz - az, bx - ax);
    turn += Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
    len += Math.hypot(cx - bx, cz - bz);
  }
  return ((turn * 180) / Math.PI) / (len / 1000);
}

test('le Col des Chalets est un vrai col à lacets : épingles serrées mais jouables, sans chevauchement', () => {
  const col = COURSES.col;
  // Bien plus sinueux que la vallée (au moins 3 fois plus de virage par km).
  assert.ok(turnPerKm(col.control) > 3 * turnPerKm(COURSES.vallee.control), `${turnPerKm(col.control).toFixed(0)} °/km`);
  // Rayon de courbure (cercle passant par 3 points consécutifs) et épingles (virages serrés de 150° et plus).
  const n = col.control.length;
  const radius = [];
  const turn = [];
  for (let i = 0; i < n; i++) {
    const [a, b, c] = [col.control[(i + n - 1) % n], col.control[i], col.control[(i + 1) % n]];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const r = (Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) * Math.hypot(a[0] - c[0], a[1] - c[1])) / (2 * Math.abs(cross) || 1e-9);
    const d = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
    radius.push(r);
    turn.push((Math.atan2(Math.sin(d), Math.cos(d)) * 180) / Math.PI);
  }
  const minR = Math.min(...radius);
  assert.ok(minR >= 20 && minR < 30, `rayon mini ${minR.toFixed(1)} m`);
  let hairpins = 0;
  let run = 0;
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    if (i < n && radius[k] < 35 && (run === 0 || Math.sign(turn[k]) === Math.sign(run))) run += turn[k];
    else {
      if (Math.abs(run) >= 150) hairpins++;
      run = i < n && radius[k] < 35 ? turn[k] : 0;
    }
  }
  assert.ok(hairpins >= 10, `${hairpins} épingles`);
  // Deux passages de la route (éloignés de plus de 60 m le long du tracé) restent à 40 m l'un de l'autre.
  const { pts, length } = densify(col.control);
  assert.ok(length > 2500 && length < 3500, `longueur ${length.toFixed(0)} m`);
  let minGap = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const along = pts[j][2] - pts[i][2];
      if (along < 60 || length - along < 60) continue;
      minGap = Math.min(minGap, Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]));
    }
  }
  assert.ok(minGap >= 40, `écart mini entre passages ${minGap.toFixed(1)} m`);
  // Le village est sur le plateau (pente nulle) et sur une portion droite.
  const { from, to } = col.features.village;
  for (let u = from - 0.01; u <= to + 0.01; u += 0.001) assert.equal(profileGrade(col.profile, u), 0);
  let along = 0;
  for (let i = 1; i < n; i++) {
    along += Math.hypot(col.control[i][0] - col.control[i - 1][0], col.control[i][1] - col.control[i - 1][1]);
    if (along / length > from && along / length < to) assert.ok(Math.abs(turn[i]) < 1, `route droite dans le village (${turn[i].toFixed(2)}°)`);
  }
});

test('road() : tracé au volant, boucle fermée', () => {
  // Un carré aux coins arrondis : 4 droites de 100 m et 4 virages à droite de 90°, rayon 20 m.
  const pts = road([0, 0], 0, [100, [20, 90], 100, [20, 90], 100, [20, 90], 100, [20, 90]]);
  assert.deepEqual(pts[0], [0, 0]);
  assert.deepEqual(pts[1], [33.3, 0]); // 100 m de droite : un point tous les 33,3 m
  assert.deepEqual(pts[3], [100, 0]);
  // Virage à droite en partant vers +x : on tourne vers +z.
  const corner = pts[4];
  assert.ok(corner[0] > 100 && corner[1] > 0);
  // Le dernier point (retour au départ) est omis.
  const last = pts[pts.length - 1];
  assert.ok(Math.hypot(last[0], last[1]) > 1 && Math.hypot(last[0], last[1]) < 41);
});

test('le sable freine bien plus que l’asphalte, au jeu comme au trainer', () => {
  assert.ok(SURFACES.sand.crr > SURFACES.asphalt.crr * 5);
  assert.ok(SURFACES.sand.gradeExtra > 2);
  assert.equal(SURFACES.asphalt.gradeExtra, 0);
});

test('interpolation douce du profil', () => {
  const p = [[0, 0], [0.5, 10], [1, 0]];
  assert.equal(profileGrade(p, 0), 0);
  assert.equal(profileGrade(p, 0.5), 10);
  assert.ok(Math.abs(profileGrade(p, 0.25) - 5) < 1e-9);
});
