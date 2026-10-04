// Tests de la physique du vélo. Lancer : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS,
  resistiveForce,
  propulsiveForce,
  stepSpeed,
  steadySpeed,
  draftFactor,
  bestDraftFactor,
  msToKmh,
} from '../src/core/physics.js';

// Simule `seconds` secondes à puissance et pente constantes, pas de 1/60 s comme le jeu.
function ride(v, power, grade, seconds, params) {
  for (let t = 0; t < seconds; t += 1 / 60) v = stepSpeed(v, power, grade, 1 / 60, params);
  return v;
}

test('Forces à l’arrêt sur le plat : seulement le roulement', () => {
  const f = resistiveForce(0, 0);
  assert.ok(Math.abs(f - DEFAULTS.mass * DEFAULTS.g * DEFAULTS.crr) < 1e-9);
});

test('Vitesse d’équilibre : 250 W sur le plat ≈ 37 km/h', () => {
  const kmh = msToKmh(steadySpeed(250, 0));
  assert.ok(kmh > 35 && kmh < 40, `obtenu ${kmh.toFixed(1)} km/h`);
});

test('Vitesse d’équilibre : 250 W à 7 % ≈ 14 km/h', () => {
  const kmh = msToKmh(steadySpeed(250, 7));
  assert.ok(kmh > 12 && kmh < 17, `obtenu ${kmh.toFixed(1)} km/h`);
});

test('Plus de watts = plus vite, plus de pente = moins vite', () => {
  assert.ok(steadySpeed(260, 0) > steadySpeed(150, 0));
  assert.ok(steadySpeed(200, 6) < steadySpeed(200, 0));
  assert.ok(steadySpeed(200, -5) > steadySpeed(200, 0));
});

test('L’intégration converge vers la vitesse d’équilibre', () => {
  const v = ride(0, 200, 3, 180);
  assert.ok(Math.abs(v - steadySpeed(200, 3)) < 0.05, `${v} vs ${steadySpeed(200, 3)}`);
});

test('Départ arrêté : pas de NaN ni d’infini, la propulsion est plafonnée', () => {
  assert.ok(Number.isFinite(propulsiveForce(250, 0)));
  const v = stepSpeed(0, 250, 0, 1 / 60);
  assert.ok(v > 0 && v < 1);
  assert.equal(propulsiveForce(0, 0), 0);
  assert.equal(propulsiveForce(-100, 5), 0);
});

test('Sans pédaler : on ralentit jusqu’à l’arrêt sur le plat, jamais de marche arrière', () => {
  const v = ride(10, 0, 0, 600);
  assert.ok(v >= 0 && v < 0.5, `v=${v}`);
  assert.equal(ride(0, 0, 8, 5), 0); // arrêté en montée : on reste à 0
  assert.ok(ride(3, 0, 8, 10) === 0);
});

test('Sans pédaler en descente : on accélère depuis l’arrêt', () => {
  const v = ride(0, 0, -6, 20);
  assert.ok(v > 5, `v=${v}`);
  assert.ok(v <= steadySpeed(0, -6) + 0.01);
});

test('Grand dt découpé en sous-pas : résultat stable', () => {
  const a = stepSpeed(5, 250, 0, 0.5);
  let b = 5;
  for (let i = 0; i < 25; i++) b = stepSpeed(b, 250, 0, 0.02);
  assert.ok(Math.abs(a - b) < 1e-9);
});

test('Aspiration : −30 % de CdA juste derrière, rien ailleurs', () => {
  assert.equal(draftFactor(2, 0), 0.7);
  assert.equal(draftFactor(3, 0.3), 0.7);
  assert.equal(draftFactor(6, 0), 1); // trop loin
  assert.equal(draftFactor(-2, 0), 1); // devant, pas derrière
  assert.equal(draftFactor(2, 2), 1); // pas sur la même ligne
  const mid = draftFactor(3.75, 0);
  assert.ok(mid > 0.7 && mid < 1);
  assert.equal(bestDraftFactor([{ gap: 8, lateral: 0 }, { gap: 1.5, lateral: 0.2 }]), 0.7);
  assert.equal(bestDraftFactor([]), 1);
});

test('Aspiration : même puissance, on va plus vite dans la roue', () => {
  const alone = steadySpeed(200, 0);
  const sheltered = steadySpeed(200, 0, { cda: DEFAULTS.cda * draftFactor(2, 0) });
  assert.ok(sheltered > alone * 1.05);
});
