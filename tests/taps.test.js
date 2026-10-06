import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TapDrive, TAP } from '../src/core/taps.js';

const tapEvery = (drive, ms, n, start = 0) => {
  let t = start;
  for (let i = 0; i < n; i++) {
    drive.tap(t);
    t += ms;
  }
  return t - ms;
};

test('vélo : 80 tapotements/min donnent ~250 W et une cadence de 80', () => {
  const d = new TapDrive();
  const last = tapEvery(d, 750, 8);
  const { rate, power } = d.target(last + 10);
  assert.ok(Math.abs(rate - 80) < 1, `cadence ${rate}`);
  assert.ok(Math.abs(power - 250) < 4, `puissance ${power}`);
});

test('rameur : 26 coups/min ≈ 180 W, puissance plafonnée', () => {
  const d = new TapDrive();
  const last = tapEvery(d, 60000 / 26, 6);
  const { power } = d.target(last + 10, 'row');
  assert.ok(Math.abs(power - 180) < 3, `puissance ${power}`);
  const fast = new TapDrive();
  const l2 = tapEvery(fast, 160, 8);
  assert.equal(fast.target(l2 + 5, 'row').power, TAP.row.max);
});

test('un premier tapotement fait démarrer, l\'arrêt coupe la puissance', () => {
  const d = new TapDrive();
  d.tap(0);
  assert.ok(d.target(100).power > 0);
  assert.ok(d.active(100));
  assert.equal(d.target(TAP.bike.idle + 1).power, 0);
  assert.ok(!d.active(TAP.bike.idle + 1));
  assert.ok(d.active(TAP.bike.idle + 1, 'row'), 'au rameur on attend plus longtemps');
});

test('on ralentit : la cadence baisse avant de tomber à zéro', () => {
  const d = new TapDrive();
  const last = tapEvery(d, 600, 6);
  const now = d.rate(last + 50);
  const later = d.rate(last + 1200);
  assert.ok(later < now, `${later} < ${now}`);
  assert.ok(later > 0);
});
