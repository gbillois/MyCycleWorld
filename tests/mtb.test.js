// VTT (src/core/mtb.js) : sauts et impulsions, chutes, réapparition, dérive dans les épingles. Lancer : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { MTB, gradeJump, kickerHeight, lipAngle, trailDrift, shouldCrash, crashPose, ImpulseDetector, MtbRules } from '../src/core/mtb.js';
import { COURSES, SURFACES, surfaceAtFraction } from '../game/courses.js';

test('note du saut selon le moment de l’impulsion', () => {
  assert.equal(gradeJump(0).grade, 'perfect');
  assert.equal(gradeJump(-0.1).grade, 'perfect');
  assert.equal(gradeJump(0.12).grade, 'perfect');
  assert.equal(gradeJump(-0.25).grade, 'good');
  assert.equal(gradeJump(-0.5).grade, 'early');
  assert.equal(gradeJump(0.4).grade, 'late');
  assert.equal(gradeJump(-1.2).grade, 'none');
  assert.equal(gradeJump(0.8).grade, 'none');
  assert.equal(gradeJump(null).grade, 'none');
  assert.equal(gradeJump(0).label, 'Parfait !');
  assert.equal(gradeJump(-0.5).label, 'Trop tôt');
  // Plus on est précis, plus on gagne de vitesse et de hauteur.
  const order = ['perfect', 'good', 'early', 'none'].map((g) => MTB.bonus[g]);
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] > order[i]);
  assert.equal(gradeJump(null).bonus, 0);
  assert.ok(MTB.lift.perfect > MTB.lift.good);
});

test('forme du kicker : rampe jusqu’à la lèvre, trou, réception', () => {
  const j = { s: 100, len: 5, h: 0.8 };
  assert.equal(kickerHeight(-6, j), 0);
  assert.equal(kickerHeight(-5, j), 0);
  assert.ok(Math.abs(kickerHeight(0, j) - 0.8) < 1e-9);
  assert.ok(kickerHeight(-1, j) > kickerHeight(-3, j));
  assert.equal(kickerHeight(0.3, j), 0); // le trou
  assert.ok(kickerHeight(MTB.gap + 0.01, j) > 0.3);
  assert.equal(kickerHeight(MTB.gap + MTB.landLen + 0.5, j), 0);
  const a = lipAngle(j);
  assert.ok(a > 0.2 && a < 0.5, `angle ${a}`);
});

test('dérive : rien dans les grandes courbes, forte dans les épingles', () => {
  assert.equal(trailDrift(0), 0);
  assert.equal(trailDrift(0.02), 0);
  assert.ok(trailDrift(0.06) > 0.1 && trailDrift(0.06) < MTB.driftMax);
  assert.equal(trailDrift(-0.2), MTB.driftMax);
});

test('chute : hors de la piste de plus d’un mètre, jamais en pilote automatique ni en l’air', () => {
  assert.equal(shouldCrash({ lateral: 2.5, half: 2 }), false);
  assert.equal(shouldCrash({ lateral: 3.2, half: 2 }), true);
  assert.equal(shouldCrash({ lateral: -3.2, half: 2 }), true);
  assert.equal(shouldCrash({ lateral: 3.2, half: 2, auto: true }), false);
  assert.equal(shouldCrash({ lateral: 3.2, half: 2, airborne: true }), false);
  const p0 = crashPose(0);
  const p1 = crashPose(0.6);
  const p2 = crashPose(MTB.crashTime);
  assert.equal(p0.tilt, 0);
  assert.ok(p1.tilt > 0.9 && p1.tumble > 0);
  assert.ok(p2.rise === 1 && p2.tilt === 0);
});

test('impulsions : touche, double tapotement, coup de puissance', () => {
  const d = new ImpulseDetector();
  assert.equal(d.tap(1), false);
  assert.equal(d.tap(1.75), false); // pédalage normal (80 tapotements par minute)
  assert.equal(d.tap(2.5), false);
  assert.equal(d.tap(2.7), true); // double tapotement
  assert.equal(d.last, 2.7);
  assert.equal(d.source, 'tap');
  d.key(5);
  assert.equal(d.last, 5);
  // Puissance stable à 160 W pendant 4 s, puis +120 W : impulsion, datée un peu plus tôt (latence du trainer).
  const p = new ImpulseDetector();
  let fired = null;
  for (let t = 0; t <= 4; t += 1 / 60) if (p.power(t, 160 + Math.sin(t * 7) * 10)) fired = t;
  assert.equal(fired, null, 'pas d’impulsion en pédalant régulièrement');
  for (let t = 4; t <= 5; t += 1 / 60) if (p.power(t, 290) && fired === null) fired = t;
  assert.ok(fired !== null && fired < 4.6, `impulsion à ${fired}`);
  assert.ok(Math.abs(p.last - (fired - MTB.powerLatency)) < 1e-9);
  assert.equal(p.source, 'power');
  // Un trainer qui n'envoie qu'une mesure par seconde : la hausse est quand même vue.
  const q = new ImpulseDetector();
  let hit = false;
  for (let t = 0; t <= 6; t += 1) hit = q.power(t, t < 5 ? 150 : 300) || hit;
  assert.ok(hit);
});

function rider(over = {}) {
  return { s: 0, prevS: 0, lateral: 0, heading: 0, yawRate: 0, lean: 0, v: 7, isPlayer: true, ...over };
}

// Fait rouler un coureur tout droit à vitesse constante (au sol) ; impulse : temps de l'impulsion.
function ride(rules, r, { from, to, dt = 1 / 60, impulse = null, events = [] }) {
  let t = 0;
  r.s = r.prevS = from;
  while (r.s < to) {
    if (impulse !== null && t >= impulse && (r.impulseAt ?? -1) < impulse) r.impulseAt = impulse;
    r.prevS = r.s;
    if (!r.air) r.s += r.v * dt;
    else r.s += r.v * dt;
    rules.step(r, dt, t, { auto: false });
    t += dt;
  }
  return { t, events };
}

test('saut : impulsion parfaite = bonus et vol plus long ; sans impulsion, petite bosse', () => {
  const ev = [];
  const mk = () => new MtbRules({ length: 1000, half: 2, jumps: [{ s: 100, len: 5, h: 0.8 }], emit: (type, d) => ev.push([type, d]) });
  // Sans impulsion
  const r0 = rider();
  ride(mk(), r0, { from: 80, to: 125 });
  const none = ev.find(([k]) => k === 'jump');
  assert.equal(none[1].grade, 'none');
  assert.ok(Math.abs(r0.v - 7) < 1e-9, 'aucun bonus');
  const air0 = ev.find(([k]) => k === 'land')[1].air;
  // Impulsion pile à la lèvre (lèvre atteinte après 20 m à 7 m/s)
  ev.length = 0;
  const r1 = rider();
  ride(mk(), r1, { from: 80, to: 125, impulse: 20 / 7 - 0.05 });
  const perfect = ev.find(([k]) => k === 'jump')[1];
  assert.equal(perfect.grade, 'perfect');
  assert.ok(Math.abs(r1.v - (7 + MTB.bonus.perfect)) < 1e-9);
  const air1 = ev.find(([k]) => k === 'land')[1].air;
  assert.ok(air1 > air0 + 0.3, `vol ${air0.toFixed(2)} s puis ${air1.toFixed(2)} s`);
  assert.ok(air1 > 0.6 && air1 < 1.3);
  // Trop tôt
  ev.length = 0;
  const r2 = rider();
  ride(mk(), r2, { from: 80, to: 125, impulse: 20 / 7 - 0.55 });
  assert.equal(ev.find(([k]) => k === 'jump')[1].grade, 'early');
  // Trop tard : en l'air, juste après la lèvre
  ev.length = 0;
  const r3 = rider();
  ride(mk(), r3, { from: 80, to: 125, impulse: 20 / 7 + 0.38 });
  assert.equal(ev.find(([k]) => k === 'jump')[1].grade, 'late');
  assert.ok(r3.v > 7);
  // Une impulsion ne sert qu'une fois
  ev.length = 0;
  const two = new MtbRules({ length: 1000, half: 2, jumps: [{ s: 100, len: 5, h: 0.8 }, { s: 130, len: 5, h: 0.8 }], emit: (type, d) => ev.push([type, d]) });
  const r4 = rider();
  ride(two, r4, { from: 80, to: 160, impulse: 20 / 7 });
  const grades = ev.filter(([k]) => k === 'jump').map(([, d]) => d.grade);
  assert.deepEqual(grades.slice(0, 1), ['perfect']);
  assert.equal(grades[1], 'none');
});

test('le coureur suit la rampe puis retombe sur la réception', () => {
  const rules = new MtbRules({ length: 1000, half: 2, jumps: [{ s: 100, len: 5, h: 0.8 }] });
  assert.ok(Math.abs(rules.groundAt(100) - 0.8) < 1e-9);
  assert.equal(rules.groundAt(50), 0);
  assert.ok(rules.groundAt(1100 - 2) > 0, 'positions modulo la longueur du tour');
  const r = rider();
  let maxHop = 0;
  r.s = r.prevS = 90;
  for (let t = 0; t < 4; t += 1 / 60) {
    r.prevS = r.s;
    r.s += r.v / 60;
    rules.step(r, 1 / 60, t);
    maxHop = Math.max(maxHop, r.hop);
  }
  assert.ok(maxHop > 0.8, `hauteur max ${maxHop}`);
  assert.equal(r.air, false);
  assert.equal(r.hop, 0);
  assert.equal(rules.nextJump(95).dist, 5);
  assert.equal(rules.nextJump(101, 50), null);
});

test('chute hors de la piste, pénalité, puis réapparition au milieu à petite vitesse', () => {
  const ev = [];
  const rules = new MtbRules({ length: 1000, half: 2, emit: (type, d) => ev.push(type) });
  const r = rider({ lateral: 3.3, s: 50, prevS: 50 });
  rules.step(r, 1 / 60, 10, { auto: true });
  assert.deepEqual(ev, [], 'pilote automatique : jamais de chute');
  rules.step(r, 1 / 60, 10, { auto: false });
  assert.deepEqual(ev, ['crash']);
  assert.ok(rules.down(r, 10.5));
  let t = 10;
  while (t < 10 + MTB.crashTime - 0.05) {
    t += 1 / 60;
    rules.step(r, 1 / 60, t);
  }
  assert.equal(r.v, 0, 'immobile au sol');
  for (let k = 0; k < 10; k++) {
    t += 1 / 60;
    rules.step(r, 1 / 60, t);
  }
  assert.deepEqual(ev, ['crash', 'respawn']);
  assert.equal(r.lateral, 0);
  assert.equal(r.v, MTB.respawnSpeed);
  assert.ok(!rules.down(r, t));
  // Les adversaires ne tombent pas.
  const ai = rider({ isPlayer: false, lateral: 4 });
  rules.step(ai, 1 / 60, 30);
  assert.ok(!rules.down(ai, 30.1));
});

test('épingle sans tourner : on sort de la piste ; en tournant, on reste dessus', () => {
  const rules = new MtbRules({ length: 1000, half: 2 });
  const k = 1 / 8; // virage à droite de 8 m de rayon
  const run = (steer) => {
    const r = rider({ v: 5 });
    for (let t = 0; t < 2.5; t += 1 / 60) rules.steer(r, { steer }, r.v, k, 1 / 60, 6.5);
    return r.lateral;
  };
  const free = run(0);
  const held = run(0.6);
  assert.ok(free < -(2 + MTB.crashMargin), `sans tourner : ${free.toFixed(2)} m`);
  assert.ok(Math.abs(held) < 2, `en tournant : ${held.toFixed(2)} m`);
  // Grande courbe : le vélo suit la piste tout seul.
  const r = rider({ v: 7 });
  for (let t = 0; t < 4; t += 1 / 60) rules.steer(r, { steer: 0 }, r.v, 1 / 60, 1 / 60, 6.5);
  assert.ok(Math.abs(r.lateral) < 0.3);
});

test('Forêt des Crêtes : piste étroite, revêtements nature, sauts et ruisseau', () => {
  const c = COURSES.foret;
  assert.equal(c.theme, 'forest');
  assert.ok(c.roadHalf >= 1.6 && c.roadHalf <= 2.4);
  assert.equal(surfaceAtFraction(c, 0.001), c.baseSurface);
  for (const s of ['dirt', 'roots', 'rock', 'gravel', 'mud', 'creek']) {
    assert.ok(SURFACES[s], s);
    assert.ok(SURFACES[s].crr >= SURFACES.asphalt.crr);
  }
  for (const s of ['mud', 'creek', 'rock']) assert.ok(SURFACES[s].crr > SURFACES.dirt.crr * 2 && SURFACES[s].gradeExtra > SURFACES.dirt.gradeExtra, s);
  const used = new Set(c.surfaces.map((x) => x[2]));
  for (const s of ['roots', 'rock', 'creek', 'mud']) assert.ok(used.has(s), `tronçon ${s}`);
  assert.ok(c.mtb.jumps.length >= 3);
  for (const [u] of c.mtb.jumps) assert.equal(surfaceAtFraction(c, u), c.baseSurface, 'saut sur de la terre');
});
