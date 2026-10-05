// Circuits (game/courses.js) et profil d'altitude (src/core/profile.js). Lancer : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSES, COURSE_ORDER, SURFACES, courseById, surfaceAtFraction } from '../game/courses.js';
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
