// Direction réaliste du vélo (src/core/steering.js). Lancer : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteerState, stepSteering, maxYawRate, forwardSpeed, headingTowards, STEER, G } from '../src/core/steering.js';

const DT = 1 / 60;

function run(st, seconds, command, v, curvature = 0, limit = Infinity) {
  for (let t = 0; t < seconds; t += DT) stepSteering(st, command, v, curvature, DT, limit);
  return st;
}

test('à l’arrêt, impossible de se déplacer latéralement', () => {
  const st = run(createSteerState(0), 2, { steer: 1 }, 0);
  assert.equal(st.lateral, 0);
  assert.equal(st.heading, 0);
  assert.equal(maxYawRate(0, 0.5), 0);
});

test('pas de glissade instantanée : le vélo doit d’abord tourner', () => {
  const st = run(createSteerState(0), 0.1, { steer: 1 }, 10);
  assert.ok(st.lateral < 0.05, `après 0,1 s le vélo a à peine bougé (${st.lateral.toFixed(3)} m)`);
  run(st, 1.4, { steer: 1 }, 10);
  assert.ok(st.lateral > 1.5, `après 1,5 s il a changé de ligne (${st.lateral.toFixed(2)} m)`);
  assert.ok(st.heading > 0 && st.heading <= STEER.maxHeading + 1e-9);
});

test('en tournant à droite, le vélo penche à droite (et inversement)', () => {
  const right = run(createSteerState(0), 0.5, { steer: 1 }, 9);
  const left = run(createSteerState(0), 0.5, { steer: -1 }, 9);
  assert.ok(right.lean > 0.1, `penché à droite : ${right.lean.toFixed(2)} rad`);
  assert.ok(left.lean < -0.1, `penché à gauche : ${left.lean.toFixed(2)} rad`);
});

test('quand on lâche, le vélo se redresse et garde sa nouvelle ligne', () => {
  const st = run(createSteerState(0), 1.2, { steer: 1 }, 10);
  const atRelease = st.lateral;
  run(st, 2.5, { steer: 0 }, 10);
  assert.ok(Math.abs(st.heading) < 0.01, `réaligné avec la route (${st.heading.toFixed(3)} rad)`);
  assert.ok(Math.abs(st.lean) < 0.03, 'redressé');
  assert.ok(st.lateral > atRelease, 'il finit son écart (inertie)');
  assert.ok(st.lateral - atRelease < 2, `sans dériver indéfiniment (+${(st.lateral - atRelease).toFixed(2)} m)`);
  const settled = st.lateral;
  run(st, 2, { steer: 0 }, 10);
  assert.ok(Math.abs(st.lateral - settled) < 0.05, 'puis reste sur sa ligne (pas de retour forcé au centre)');
});

test('dans un virage de la route, le vélo s’incline naturellement selon la vitesse', () => {
  const R = 50;
  const slow = run(createSteerState(0), 3, { steer: 0 }, 5, 1 / R);
  const fast = run(createSteerState(0), 3, { steer: 0 }, 12, 1 / R);
  assert.ok(Math.abs(slow.lean - Math.atan((5 * 5) / (R * G))) < 0.01, 'inclinaison = atan(v²/(R·g))');
  assert.ok(fast.lean > slow.lean * 3, 'bien plus penché à vitesse élevée');
  assert.ok(Math.abs(fast.lateral) < 1e-9, 'suivre la route ne décale pas le coureur');
  const leftTurn = run(createSteerState(0), 3, { steer: 0 }, 12, -1 / R);
  assert.ok(leftTurn.lean < 0, 'virage à gauche : penché à gauche');
});

test('le dérapage permet de tourner plus serré', () => {
  assert.ok(maxYawRate(10, STEER.driftLean) > maxYawRate(10, STEER.maxLean));
  const normal = run(createSteerState(0), 0.6, { steer: 1 }, 10);
  const drift = run(createSteerState(0), 0.6, { steer: 1, drift: true }, 10);
  assert.ok(drift.lateral > normal.lateral);
});

test('bord du terrain : on le longe sans le dépasser', () => {
  const st = run(createSteerState(5), 4, { steer: 1 }, 10, 0, 6.5);
  assert.equal(st.lateral, 6.5);
  assert.ok(st.heading <= 1e-9);
});

test('coureur IA : rejoint sa ligne cible sans osciller', () => {
  const st = createSteerState(-2);
  let maxOvershoot = 0;
  for (let t = 0; t < 8; t += DT) {
    stepSteering(st, { targetHeading: headingTowards(st.lateral, 2) }, 9, 0, DT);
    maxOvershoot = Math.max(maxOvershoot, st.lateral - 2);
  }
  assert.ok(Math.abs(st.lateral - 2) < 0.15, `ligne atteinte (${st.lateral.toFixed(2)} m)`);
  assert.ok(maxOvershoot < 0.3, `dépassement limité (${maxOvershoot.toFixed(2)} m)`);
});

test('en biais, on avance un peu moins vite sur le tracé', () => {
  assert.equal(forwardSpeed(10, 0), 10);
  assert.ok(forwardSpeed(10, 0.3) < 10 && forwardSpeed(10, 0.3) > 9.5);
});
