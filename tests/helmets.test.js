// Casques vert et rouge (src/core/helmets.js) : vol, rebonds, tête chercheuse, contacts, tirage, décisions.
// Lancer : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { HELMET, itemWeights, pickItem, nextAhead, launchHelmet, releaseTarget, stepHelmet, helmetExpired, canHitRacer, helmetTouches, helmetCrosses, helmetsClash, helmetPlan, wrapGap } from '../src/core/helmets.js';

const L = 1000;
const racer = (o = {}) => ({ s: 0, prevS: 0, lateral: 0, v: 10, heading: 0, finishTime: null, isPlayer: false, ...o });
const flat = { wall: 4 - HELMET.wallMargin, curvatureAt: () => 0 };

// Fait voler un casque pendant `secs` secondes ; renvoie le nombre de rebonds signalés.
function fly(h, secs, ctx = flat, dt = 1 / 60) {
  let bounces = 0;
  for (let t = 0; t < secs; t += dt) if (stepHelmet(h, dt, ctx) === 'bounce') bounces++;
  return bounces;
}

test('écart signé le plus court sur le circuit', () => {
  assert.equal(wrapGap(10, L), 10);
  assert.equal(wrapGap(-10, L), -10);
  assert.equal(wrapGap(990, L), -10);
  assert.equal(wrapGap(2010, L), 10);
});

test('casque vert : nettement plus rapide que les coureurs, droit devant depuis la ligne du lanceur', () => {
  const owner = racer({ s: 100, lateral: 1.2, v: 11 });
  const h = launchHelmet({ kind: 'green', owner, t: 0 });
  assert.ok(h.vs >= HELMET.minSpeed && h.vs > owner.v * 2, `vitesse ${h.vs}`);
  assert.ok(h.s > owner.s, 'part devant le lanceur');
  assert.equal(h.lateral, 1.2);
  assert.equal(h.target, null);
  fly(h, 1);
  assert.ok(h.s - 100 > 20, `distance en 1 s : ${h.s - 100}`);
  assert.ok(Math.abs(h.lateral - 1.2) < 1e-9, 'sans cap ni virage, il garde sa ligne');
});

test('casque vert lancé vers l’arrière : recule par rapport au sol', () => {
  const owner = racer({ s: 100, v: 10 });
  const h = launchHelmet({ kind: 'green', owner, back: true });
  assert.ok(h.vs <= -HELMET.minBackSpeed, `vitesse ${h.vs}`);
  assert.ok(h.s < owner.s);
  fly(h, 1);
  assert.ok(h.s < 100 - 8);
  // Un casque rouge lancé en arrière n'a pas de cible : il part tout droit.
  const r = launchHelmet({ kind: 'red', owner, back: true, target: racer({ s: 150 }) });
  assert.equal(r.target, null);
});

test('rebonds : la vitesse latérale est réfléchie sur les bords, le casque reste sur la route', () => {
  const owner = racer({ heading: 0.25 });
  const h = launchHelmet({ kind: 'green', owner });
  assert.ok(h.angle > 0 && h.angle <= HELMET.maxAngle);
  let maxLat = 0;
  let bounces = 0;
  for (let i = 0; i < 300; i++) {
    const before = h.vl;
    if (stepHelmet(h, 1 / 60, flat) === 'bounce') {
      bounces++;
      assert.ok(Math.sign(h.vl) === -Math.sign(before), 'vitesse latérale inversée');
    }
    maxLat = Math.max(maxLat, Math.abs(h.lateral));
  }
  assert.ok(bounces >= 2, `rebonds ${bounces}`);
  assert.equal(h.bounces, bounces);
  assert.ok(maxLat <= flat.wall + 1e-9, `écart max ${maxLat}`);
  // Sur le sentier de VTT (demi-largeur 2 m), les rebonds sont plus fréquents.
  const trail = { wall: 2 - HELMET.wallMargin, curvatureAt: () => 0 };
  const g = launchHelmet({ kind: 'green', owner: racer({ heading: 0.25 }) });
  assert.ok(fly(g, 5, trail) > bounces);
  assert.ok(Math.abs(g.lateral) <= trail.wall + 1e-9);
});

test('virage : un casque vert file vers l’extérieur puis rebondit', () => {
  const right = { wall: 3.75, curvatureAt: () => 1 / 40 }; // virage à droite de 40 m de rayon
  const h = launchHelmet({ kind: 'green', owner: racer() });
  stepHelmet(h, 0.2, right);
  assert.ok(h.lateral < 0, 'vers la gauche (extérieur du virage à droite)');
  assert.ok(fly(h, 3, right) >= 1);
  // Même chose en reculant : l'extérieur reste à gauche.
  const b = launchHelmet({ kind: 'green', owner: racer({ s: 200 }), back: true });
  stepHelmet(b, 0.2, right);
  assert.ok(b.lateral < 0);
});

test('durée de vie et portée', () => {
  const h = launchHelmet({ kind: 'green', owner: racer(), t: 10 });
  assert.ok(!helmetExpired(h, 10));
  assert.ok(helmetExpired(h, 10 + HELMET.greenLife));
  h.travelled = HELMET.greenRange;
  assert.ok(helmetExpired(h, 11));
  const r = launchHelmet({ kind: 'red', owner: racer(), t: 0, target: racer({ s: 50 }) });
  assert.ok(r.expiresAt > h.expiresAt - 10 && r.range > HELMET.greenRange);
});

test('casque rouge : suit le tracé et rattrape latéralement sa cible', () => {
  const owner = racer({ s: 0, lateral: -2.5, v: 10 });
  const target = racer({ s: 60, prevS: 60, lateral: 2.5, v: 10 });
  const h = launchHelmet({ kind: 'red', owner, target });
  assert.equal(h.target, target);
  let hit = false;
  for (let i = 0; i < 60 * 8 && !hit; i++) {
    const dt = 1 / 60;
    target.prevS = target.s;
    target.s += target.v * dt;
    stepHelmet(h, dt, flat);
    assert.ok(Math.abs(h.lateral) <= flat.wall + 1e-9);
    hit = helmetTouches(h, target, L);
  }
  assert.ok(hit, 'cible touchée');
  assert.ok(Math.abs(h.lateral - 2.5) < HELMET.hitWidth);
});

test('casque rouge : une cible presque à côté du lanceur est quand même touchée', () => {
  // La cible est 1 m devant le lanceur et 3 m sur le côté : le casque naît devant elle, l'attend en
  // s'alignant, puis la percute.
  const owner = racer({ s: 0, lateral: -1.5, v: 10 });
  const target = racer({ s: 1, prevS: 1, lateral: 1.5, v: 10 });
  const h = launchHelmet({ kind: 'red', owner, target });
  assert.ok(h.s > target.s);
  let hit = false;
  let t = 0;
  for (; t < 3 && !hit; t += 1 / 60) {
    target.prevS = target.s;
    target.s += target.v / 60;
    stepHelmet(h, 1 / 60, flat);
    hit = helmetTouches(h, target, L);
  }
  assert.ok(hit && t < 2, `touchée en ${t.toFixed(2)} s`);
});

test('casque rouge sans cible (arrivée) : continue tout droit', () => {
  const target = racer({ s: 40, lateral: 3 });
  const h = launchHelmet({ kind: 'red', owner: racer(), target });
  fly(h, 0.3);
  assert.ok(h.vl > 0);
  releaseTarget(h);
  assert.equal(h.target, null);
  assert.ok(h.angle > 0, 'garde son cap du moment');
  fly(h, 2);
  assert.ok(h.bounces >= 1);
});

test('contact : balayage à grande vitesse, écart latéral, lanceur protégé', () => {
  const owner = racer({ s: 0 });
  const r = racer({ s: 20, prevS: 19.9, lateral: 0.5 });
  const h = launchHelmet({ kind: 'green', owner });
  // Un grand pas de temps fait passer le casque de l'autre côté du coureur : le contact est quand même vu.
  stepHelmet(h, 1, flat);
  assert.ok(h.s > 21);
  assert.ok(helmetTouches(h, r, L));
  // Trop à côté : pas de contact.
  assert.ok(!helmetTouches(h, racer({ s: 20, prevS: 19.9, lateral: 2 }), L));
  // Pas de contact à l'autre bout du circuit.
  assert.ok(!helmetTouches(h, racer({ s: 520, prevS: 519.9 }), L));
  // Le lanceur : pas avant le délai de grâce, ni sans rebond.
  assert.ok(!canHitRacer(h, owner, 0.1));
  assert.ok(!canHitRacer(h, owner, 5));
  h.bounces = 1;
  assert.ok(canHitRacer(h, owner, 5));
  assert.ok(canHitRacer(h, r, 0));
  assert.ok(!canHitRacer(h, racer({ finishTime: 100 }), 0), 'les coureurs arrivés ne sont plus visés');
});

test('contact au passage de la ligne d’arrivée du tour (s cumulé)', () => {
  const h = launchHelmet({ kind: 'green', owner: racer({ s: 995 }) });
  stepHelmet(h, 0.2, flat);
  assert.ok(helmetTouches(h, racer({ s: 1001, prevS: 1000.8 }), L));
});

test('banane emportée, casques qui se croisent', () => {
  const h = launchHelmet({ kind: 'green', owner: racer() });
  stepHelmet(h, 0.5, flat);
  assert.ok(helmetCrosses(h, 8, 0.3, L));
  assert.ok(!helmetCrosses(h, 8, 2, L));
  const a = launchHelmet({ kind: 'green', owner: racer({ s: 0 }) });
  const b = launchHelmet({ kind: 'green', owner: racer({ s: 30 }), back: true });
  let clash = false;
  for (let i = 0; i < 120 && !clash; i++) {
    stepHelmet(a, 1 / 30, flat);
    stepHelmet(b, 1 / 30, flat);
    clash = helmetsClash(a, b, L);
  }
  assert.ok(clash);
});

test('tirage des objets : poids selon la position, façon Mario Kart', () => {
  for (let p = 1; p <= 6; p++) {
    const w = itemWeights(p, 6);
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
    for (const v of Object.values(w)) assert.ok(v > 0);
  }
  const first = itemWeights(1, 6);
  const last = itemWeights(6, 6);
  assert.ok(last.red > first.red * 5, 'casque rouge bien plus fréquent derrière');
  assert.ok(first.banana > last.banana, 'banane en tête');
  assert.ok(first.green > 0.15 && last.green > 0.15, 'casque vert courant partout');
  assert.ok(first.green + first.red < 0.3 && last.green + last.red < 0.45, 'casques pas trop fréquents');
  // pickItem respecte les poids.
  const count = { turbo: 0, banana: 0, green: 0, red: 0 };
  for (let i = 0; i < 1000; i++) count[pickItem(last, (i + 0.5) / 1000)]++;
  for (const k in count) assert.ok(Math.abs(count[k] / 1000 - last[k]) < 0.01, k);
  assert.equal(pickItem({ a: 1 }, 0.999), 'a');
});

test('cible du casque rouge : le coureur juste devant au classement, encore en course', () => {
  const a = racer({ s: 300 });
  const b = racer({ s: 200 });
  const c = racer({ s: 100 });
  assert.equal(nextAhead([a, b, c], c), b);
  assert.equal(nextAhead([a, b, c], a), null);
  b.finishTime = 50;
  assert.equal(nextAhead([b, a, c], c), a);
});

test('décision de lancer : aligné devant, derrière, rouge à portée, joueur ménagé', () => {
  const owner = racer({ s: 100 });
  const ahead = racer({ s: 120, lateral: 0.3 });
  const side = racer({ s: 120, lateral: 3 });
  const base = { kind: 'green', owner, length: L, held: 1 };
  assert.equal(helmetPlan({ ...base, racers: [owner, ahead] }), 'forward');
  assert.equal(helmetPlan({ ...base, racers: [owner, side] }), null);
  assert.equal(helmetPlan({ ...base, racers: [owner, racer({ s: 92 })] }), 'back');
  // Tenu trop longtemps : on finit par le lancer.
  assert.equal(helmetPlan({ ...base, racers: [owner, side], held: 30 }), 'forward');
  // Joueur aligné mais protégé : on attend, même après un long moment.
  const player = racer({ s: 115, isPlayer: true });
  assert.equal(helmetPlan({ ...base, racers: [owner, player], allowPlayer: false }), null);
  assert.equal(helmetPlan({ ...base, racers: [owner, player], allowPlayer: false, held: 30 }), null);
  assert.equal(helmetPlan({ ...base, racers: [owner, player], allowPlayer: true }), 'forward');
  // Casque rouge : cible à portée.
  const red = { ...base, kind: 'red', racers: [owner, ahead] };
  assert.equal(helmetPlan({ ...red, target: ahead }), 'forward');
  assert.equal(helmetPlan({ ...red, target: racer({ s: 400 }) }), null, 'trop loin');
  assert.equal(helmetPlan({ ...red, target: player, allowPlayer: false }), null);
  // Rouge sans personne devant : se comporte comme un vert.
  assert.equal(helmetPlan({ ...red, target: null }), 'forward');
});
