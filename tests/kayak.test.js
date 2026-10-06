import { test } from 'node:test';
import assert from 'node:assert/strict';
import { River, KayakRace, KAYAK, CURRENTS, kayakSpeed, powerForKayakSpeed, sprintTarget, sprintEffort, sprintOutcome, judgeStrokes, StrokeLog, seeded } from '../src/core/kayak.js';
import { boatSpeed } from '../src/core/rowing.js';
import { RIVERS, RIVER_ORDER, riverById } from '../game/rivers.js';

const rivers = Object.fromEntries(RIVER_ORDER.map((id) => [id, new River(RIVERS[id])]));

// Fait avancer la course jusqu'à ce que tout le monde soit arrivé (ou n pas).
function run(race, input, n = 40000, dt = 0.05) {
  for (let i = 0; i < n && race.racers.some((r) => r.finishTime === null); i++) race.update(dt, typeof input === 'function' ? input(race) : input);
}

test('vitesse : 18 % plus vite que la formule de l’aviron, et inverse', () => {
  for (const p of [60, 150, 300]) assert.ok(Math.abs(kayakSpeed(p) - boatSpeed(p) * KAYAK.boost) < 1e-9);
  assert.equal(KAYAK.boost, 1.18);
  assert.equal(kayakSpeed(0), 0);
  assert.ok(Math.abs(powerForKayakSpeed(kayakSpeed(180)) - 180) < 1e-6);
  // 150 W ≈ 16 km/h dans l'eau calme
  assert.ok(kayakSpeed(150) * 3.6 > 15 && kayakSpeed(150) * 3.6 < 17.5);
});

test('rivières : longueur, largeur, virages doux, pas de boucle sur elle-même', () => {
  assert.equal(riverById('nope').id, 'gorges');
  for (const id of RIVER_ORDER) {
    const r = rivers[id];
    assert.ok(r.distance > 1200 && r.distance < 2000, `${id} : course de ${r.distance} m`);
    for (let i = 0; i <= r.count; i += 10) {
      const w = r.half[i] * 2;
      assert.ok(w >= 14 - 1e-6 && w <= 30 + 1e-6, `${id} largeur ${w}`);
      assert.ok(Math.abs(Math.hypot(r.tx[i], r.tz[i]) - 1) < 1e-6);
    }
    // Rayon mini suffisant pour la largeur (la rive intérieure ne se replie pas)
    for (let i = 0; i < r.count; i++) assert.ok(Math.abs(r.curv[i]) * (r.half[i] + 4) < 0.5, `${id} virage trop serré à ${i} m`);
    // Deux tronçons éloignés le long de la rivière restent loin l'un de l'autre
    let minD = Infinity;
    for (let i = 0; i < r.count; i += 5) for (let j = i + 220; j <= r.count; j += 5) minD = Math.min(minD, Math.hypot(r.x[i] - r.x[j], r.z[i] - r.z[j]));
    assert.ok(minD > 120, `${id} : deux tronçons à ${minD.toFixed(0)} m`);
    // L'eau descend vers l'aval, plus vite dans les rapides
    assert.ok(r.y[0] > r.y[r.count] + 5);
    for (let i = 1; i <= r.count; i++) assert.ok(r.y[i] <= r.y[i - 1] + 1e-6);
    // nearest() retrouve un point placé sur la rivière
    const f = r.frame(700, 3.5);
    const near = r.nearest(f.x, f.z);
    assert.ok(Math.abs(near.s - 700) <= 1.5 && Math.abs(near.lateral - 3.5) < 0.3, JSON.stringify(near));
  }
});

test('courant : bassins calmes, rapides qui poussent, plus fort au milieu', () => {
  const r = rivers.gorges;
  const calm = r.currentAt(r.length * 0.55);
  const rapid = r.currentAt(r.length * 0.25);
  assert.ok(Math.abs(calm - CURRENTS.calm) < 0.05, `calme ${calm}`);
  assert.ok(Math.abs(rapid - CURRENTS.rapid) < 0.05, `rapide ${rapid}`);
  assert.ok(r.rapidAt(r.length * 0.25) > 0.95 && r.rapidAt(r.length * 0.55) < 0.05);
  assert.ok(r.currentAt(r.length * 0.25, r.halfWidthAt(r.length * 0.25) * 0.9) < rapid * 0.7);
  // Sans ramer, le courant fait quand même avancer après le départ
  const race = new KayakRace(r, { random: seeded(1) });
  const s0 = race.player.s;
  for (let i = 0; i < 200; i++) race.update(0.05, { power: 0 });
  assert.ok(race.player.s > s0 + 2, `s = ${race.player.s}`);
});

test('physique : départ bloqué pendant le décompte, inertie, berge qui freine', () => {
  const r = rivers.gorges;
  const race = new KayakRace(r, { random: seeded(2) });
  const s0 = race.player.s;
  race.update(1, { power: 300 });
  assert.equal(race.player.s, s0, 'personne ne bouge pendant le compte à rebours');
  race.update(2.05, { power: 200 });
  for (let i = 0; i < 20; i++) race.update(0.05, { power: 200 });
  const v1 = race.player.v;
  assert.ok(v1 > 0.3 && v1 < kayakSpeed(200) * 0.8, `inertie : ${v1}`);
  for (let i = 0; i < 200; i++) race.update(0.05, { power: 200 });
  assert.ok(Math.abs(race.player.v - kayakSpeed(200)) < 0.15);
  // Contre la berge : on y reste collé, on ralentit, un seul choc annoncé
  let bumps = 0;
  race.addEventListener('bump', (e) => e.detail.racer.isPlayer && bumps++);
  for (let i = 0; i < 200; i++) race.update(0.05, { power: 200, steer: 1 });
  const p = race.player;
  assert.ok(p.onBank && p.lateral > 0);
  assert.ok(Math.abs(p.lateral) <= r.halfWidthAt(p.s) - KAYAK.bankMargin + 1e-6);
  assert.ok(p.v < kayakSpeed(200) * 0.7, `vitesse contre la berge ${p.v}`);
  assert.equal(bumps, 1);
});

test('portes : passage entre les fiches, porte manquée = +2 s, bouclier', () => {
  const r = rivers.gorges;
  const race = new KayakRace(r, { random: seeded(3) });
  const log = [];
  race.addEventListener('gate', (e) => e.detail.racer.isPlayer && log.push(e.detail));
  const p = race.player;
  race.time = 0;
  const g = r.gates.find((x) => x.kind === 'normal');
  // Juste avant la porte, bien au milieu
  p.s = p.prevS = g.s - 0.5;
  p.lateral = g.lateral;
  p.v = 4;
  race.update(0.2, { power: 150 });
  assert.equal(log.length, 1);
  assert.ok(log[0].ok && p.passed === 1 && p.penalty === 0);
  // Porte suivante : à côté des fiches
  const g2 = r.gates[p.gateIdx];
  assert.equal(g2.kind, 'normal');
  p.s = p.prevS = g2.s - 0.5;
  p.lateral = g2.lateral + g2.half + 0.5;
  p.heading = 0;
  race.update(0.2, { power: 150 });
  assert.ok(!log[1].ok && p.missed === 1 && p.penalty === KAYAK.gatePenalty);
  // Un kayak à cheval sur une fiche ne passe pas (il doit passer entièrement)
  assert.ok(Math.abs(g2.half - KAYAK.gateMargin) < g2.half);
  // Avec le bouclier, la porte manquée est pardonnée
  p.item = 'shield';
  race.useItem(p);
  const g3 = r.gates.slice(p.gateIdx).find((x) => x.kind === 'normal');
  p.gateIdx = g3.id;
  p.s = p.prevS = g3.s - 0.5;
  p.lateral = g3.lateral - g3.half - 0.6;
  race.update(0.2, { power: 150 });
  assert.equal(p.penalty, KAYAK.gatePenalty);
  assert.ok(log[2].ok && log[2].saved);
  // Le classement tient compte des pénalités
  const [a, b] = race.racers.filter((x) => !x.isPlayer);
  a.finishTime = 100; a.penalty = 6;
  b.finishTime = 103; b.penalty = 0;
  assert.ok(race.positionOf(b) < race.positionOf(a));
  assert.deepEqual(race.estimatedTime(a), { time: 106, estimated: false });
});

test('porte sprint : seuil modeste relatif à sa référence (+12 % au rameur, +25 % ailleurs)', () => {
  assert.equal(sprintTarget(0), KAYAK.targetMin);
  assert.equal(sprintTarget(80, 'rower'), 90); // débutant au rameur : +10 W
  assert.equal(sprintTarget(80), 100); // +25 % (tapotements, vélo)
  assert.equal(sprintTarget(200, 'rower'), 224);
  assert.equal(sprintTarget(200), 250);
  assert.equal(sprintTarget(40, 'rower'), 50); // au moins +10 W
  assert.equal(sprintTarget(400), 470); // au plus +70 W
  assert.ok(Math.abs(sprintEffort(115, 100, 115) - 1) < 1e-9);
  assert.equal(sprintEffort(100, 100, 115), 0);
});

test('résultat gradué : ralenti sous 60 %, passage normal, bonus proportionnel à la marge', () => {
  assert.equal(sprintOutcome(0.3).grade, 'slow');
  assert.equal(sprintOutcome(NaN).grade, 'slow');
  assert.equal(sprintOutcome(0.6).grade, 'pass');
  assert.equal(sprintOutcome(0.99).grade, 'pass');
  const b1 = sprintOutcome(1);
  const b2 = sprintOutcome(1.5);
  const b3 = sprintOutcome(3);
  assert.equal(b1.grade, 'boost');
  assert.equal(b1.boost, KAYAK.boostMin);
  assert.ok(b2.boost > b1.boost && b2.boost < b3.boost);
  assert.equal(b3.boost, KAYAK.boostMax);
});

test('coups : moyenne par coup, référence = médiane de la dernière minute, pointes écrêtées', () => {
  const log = new StrokeLog();
  let t = 0;
  // 26 coups/min, puissance qui varie dans le coup (pic pendant la propulsion) : moyenne de 150 W par coup
  for (let i = 0; i < 1200; i++) {
    const strokeT = (t * 26) / 60;
    log.add(0.05, 150 + 120 * Math.sin(strokeT * Math.PI * 2), 26, 4, t);
    t += 0.05;
  }
  assert.ok(log.strokes.length >= 25 && log.strokes.length <= 27, `${log.strokes.length} coups en 60 s`);
  for (const s of log.strokes.slice(1)) assert.ok(Math.abs(s.power - 150) < 6, `coup à ${s.power}`);
  assert.ok(Math.abs(log.base(t) - 150) < 3);
  // Une pointe isolée ne bouge pas la médiane ; les coups des zones de sprint ne comptent pas
  log.strokes.push({ t, power: 900, v: 4, flag: false });
  log.strokes.push({ t, power: 400, v: 4, flag: true });
  assert.ok(Math.abs(log.base(t) - 150) < 3);
  // Les coups de plus d'une minute sont oubliés
  assert.ok(Math.abs(log.base(t + 50) - 900) < 1e-9 || log.base(t + 50) > 150);
  // Jugement : les 4 derniers coups, pointes écrêtées à 2 fois la référence
  const zone = [{ power: 100 }, { power: 190 }, { power: 180 }, { power: 1500 }, { power: 185 }];
  assert.equal(judgeStrokes(zone, 150, 180), (190 + 180 + 300 + 185) / 4);
  assert.equal(judgeStrokes([], 150, 180), null);
  // Sans cadence (on glisse) : un coup toutes les 2,5 s
  const glide = new StrokeLog();
  for (let i = 0; i < 110; i++) glide.add(0.05, 0, 0, 3, i * 0.05);
  assert.equal(glide.strokes.length, 2);
  assert.equal(glide.strokes[0].power, 0);
});

// Rameur FTMS simulé : la puissance n'est connue qu'une fois par coup, avec `lag` coups de retard.
function rower({ lag = 2, rate = 26 } = {}) {
  const efforts = [];
  return (race, wanted) => {
    const n = Math.floor((race.time + 10) * rate / 60);
    efforts[n] = efforts[n] ?? wanted;
    return { power: efforts[Math.max(0, n - lag)] ?? wanted, strokeRate: rate, auto: true, machine: 'rower' };
  };
}

test('porte sprint au rameur : annonce en coups, effort jugé malgré 2 coups de retard', () => {
  for (const base of [80, 150, 260]) {
    for (const [extra, grade] of [[0, 'slow'], [0.1, 'pass'], [0.3, 'boost']]) {
      const race = new KayakRace(rivers.gorges, { random: seeded(5) });
      const machine = rower({ lag: 2 });
      const grades = [];
      let announced = null;
      race.addEventListener('sprint', (e) => e.detail.racer.isPlayer && grades.push(e.detail.grade));
      run(race, (rc) => {
        const info = rc.sprintInfo();
        if (info && !announced) announced = info;
        // On accélère dès l'annonce de la zone d'effort (environ 14 s avant)
        return machine(rc, info && info.zone ? base * (1 + extra) : base);
      });
      assert.equal(grades.length, rivers.gorges.sprintGates);
      assert.ok(grades.every((g) => g === grade), `${base} W +${extra * 100} % : ${grades}`);
      // Annonce : bien avant la zone, comptée en coups
      assert.ok(announced.dist > 100 && announced.strokes >= 10, JSON.stringify({ d: announced.dist, n: announced.strokes }));
      assert.ok(Math.abs(announced.target - sprintTarget(base, 'rower')) < 2, `seuil ${announced.target}`);
    }
  }
});

test('porte sprint : la zone d’effort dure environ 15 s (moins de 20 s) et se juge sur 4 coups au moins', () => {
  const race = new KayakRace(rivers.torrent, { random: seeded(11) });
  const zones = [];
  let zoneStart = null;
  race.addEventListener('sprint-zone', () => (zoneStart = race.time));
  race.addEventListener('sprint', (e) => {
    if (!e.detail.racer.isPlayer) return;
    zones.push({ duration: race.time - zoneStart, judged: race.player.log.since(zoneStart).length });
  });
  run(race, { power: 160, strokeRate: 26, auto: true, machine: 'rower' });
  assert.equal(zones.length, rivers.torrent.sprintGates);
  for (const z of zones) {
    assert.ok(z.duration > 10 && z.duration < 20, `zone de ${z.duration.toFixed(1)} s`);
    assert.ok(z.judged >= KAYAK.judgeStrokes, `${z.judged} coups jugés`);
  }
});

test('portes sprint espacées d’au moins 45 s, avec de quoi récupérer', () => {
  for (const id of RIVER_ORDER) {
    const s = rivers[id].gates.filter((g) => g.kind === 'sprint').map((g) => g.s);
    assert.ok(s.length >= 2);
    for (let i = 1; i < s.length; i++) assert.ok(s[i] - s[i - 1] >= KAYAK.sprintGap * KAYAK.refSpeed, `${id} : ${s[i] - s[i - 1]} m`);
    // Ni porte sprint ni porte glisse dans les 150 premiers mètres (la référence doit exister)
    for (const g of rivers[id].gates) if (g.kind !== 'normal') assert.ok(g.s - rivers[id].start > 150);
  }
});

test('porte sprint : bonus selon la marge, ralenti doux (+1 s) si l’effort manque, bouclier', () => {
  const r = rivers.gorges;
  const g = r.gates.find((x) => x.kind === 'sprint');
  const make = (ratio, shield = false) => {
    const race = new KayakRace(r, { random: seeded(6) });
    race.update(3.05, { power: 150, strokeRate: 26 });
    const p = race.player;
    // Une minute à 150 W pour la référence, juste avant la zone
    p.gateIdx = g.id;
    p.s = p.prevS = g.s - 400;
    for (let i = 0; i < 2000 && !p.challenge; i++) race.update(0.05, { power: 150, strokeRate: 26, machine: 'rower' });
    if (shield) {
      p.item = 'shield';
      race.useItem(p);
    }
    for (let i = 0; i < 600 && p.gateIdx <= g.id; i++) race.update(0.05, { power: 150 * ratio, strokeRate: 28, machine: 'rower' });
    return { race, p };
  };
  const boost = make(1.3);
  assert.equal(boost.p.sprints.boost, 1);
  assert.ok(boost.race.time < boost.p.turboUntil);
  const pass = make(1.12);
  assert.equal(pass.p.sprints.pass, 1);
  assert.equal(pass.p.penalty, 0);
  const slow = make(1.0);
  assert.equal(slow.p.sprints.slow, 1);
  assert.equal(slow.p.penalty, KAYAK.slowPenalty);
  assert.ok(slow.p.v < pass.p.v * 0.75 && slow.p.v > pass.p.v * 0.4, `${slow.p.v} vs ${pass.p.v}`);
  const saved = make(1.0, true);
  assert.equal(saved.p.sprints.pass, 1);
  assert.equal(saved.p.penalty, 0);
});

test('porte glisse : arrêter de ramer pour passer sous la passerelle', () => {
  for (const id of RIVER_ORDER) {
    for (const ease of [true, false]) {
      const race = new KayakRace(rivers[id], { random: seeded(12) });
      const results = [];
      race.addEventListener('glide', (e) => e.detail.racer.isPlayer && results.push(e.detail.ok));
      const machine = rower({ lag: 1 });
      run(race, (rc) => {
        const info = rc.challengeInfo();
        const stop = ease && info && info.kind === 'glide' && info.zone && info.strokes <= 3;
        return machine(rc, stop ? 0 : 160);
      });
      assert.equal(results.length, rivers[id].glideGates);
      assert.ok(results.every((ok) => ok === ease), `${id} glisse ${ease} : ${results}`);
    }
  }
});

test('IA : tout le monde arrive, les plus forts devant, quelques portes manquées', () => {
  let missed = 0;
  let sprintFails = 0;
  let items = 0;
  for (const seed of [1, 2, 3, 4]) {
    for (const id of RIVER_ORDER) {
      const race = new KayakRace(rivers[id], { random: seeded(seed) });
      race.addEventListener('use', (e) => !e.detail.racer.isPlayer && items++);
      run(race, { power: 150, auto: true });
      const ai = race.racers.filter((x) => !x.isPlayer);
      assert.ok(ai.every((x) => x.finishTime !== null));
      for (const x of ai) {
        missed += x.missed;
        sprintFails += x.sprints.slow;
        assert.equal(x.passed + x.missed, rivers[id].normalGates);
      }
      // Léa (la plus forte) finit devant Yuki (la moins forte)
      const rank = race.ranking();
      assert.ok(rank.findIndex((x) => x.name === 'Léa') < rank.findIndex((x) => x.name === 'Yuki'));
      // Le pilote automatique du joueur passe toutes les portes
      assert.equal(race.player.missed, 0, `${id} seed ${seed}`);
    }
  }
  assert.ok(missed > 4, `portes manquées par l'IA : ${missed}`);
  assert.ok(sprintFails > 2, `portes sprint ratées par l'IA : ${sprintFails}`);
  assert.ok(items > 10, `objets utilisés par l'IA : ${items}`);
});

test('objets : turbo, tourbillon qui fait tourner le suivant, bouclier contre la berge', () => {
  const r = rivers.gorges;
  // Turbo : plus vite pendant 3 s
  const race = new KayakRace(r, { random: seeded(7) });
  race.update(3.05, { power: 150 });
  for (let i = 0; i < 300; i++) race.update(0.05, { power: 150 });
  const p = race.player;
  const v0 = p.v;
  p.item = 'turbo';
  assert.equal(race.useItem(p), 'turbo');
  for (let i = 0; i < 40; i++) race.update(0.05, { power: 150 });
  assert.ok(p.v > v0 * 1.2, `turbo ${p.v} vs ${v0}`);
  assert.equal(p.item, null);
  assert.equal(race.useItem(p), null, 'pas d’objet, rien ne se passe');
  // Tourbillon : posé derrière, il fait tourner celui qui arrive dessus
  const hits = [];
  race.addEventListener('whirl-hit', (e) => hits.push(e.detail.racer));
  const victim = race.racers.find((x) => !x.isPlayer);
  victim.item = null;
  p.item = 'whirl';
  race.useItem(p);
  const w = race.whirls[0];
  assert.ok(w && Math.abs(w.s - (p.s - 3)) < 1e-6);
  victim.s = victim.prevS = w.s - 1;
  victim.lateral = w.lateral;
  victim.v = 4;
  for (let i = 0; i < 6; i++) race.update(0.05, { power: 150 });
  assert.deepEqual(hits, [victim]);
  assert.ok(race.time < victim.spinUntil && victim.v < 2.5);
  assert.equal(race.whirls.length, 0);
  // Bouclier : le choc contre la berge ne ralentit pas
  const race2 = new KayakRace(r, { random: seeded(8) });
  race2.update(3.05, { power: 150 });
  for (let i = 0; i < 200; i++) race2.update(0.05, { power: 150 });
  const q = race2.player;
  q.item = 'shield';
  race2.useItem(q);
  let saved = 0;
  race2.addEventListener('shield-save', () => saved++);
  const before = q.v;
  q.lateral = r.halfWidthAt(q.s) - KAYAK.bankMargin - 0.01;
  q.heading = 0.4;
  race2.update(0.05, { power: 150 });
  assert.equal(saved, 1);
  assert.ok(q.v > before * 0.9);
  assert.ok(race2.time > q.shieldUntil, 'le bouclier ne sert qu’une fois');
});

test('boîtes à objets : ramassage, réapparition, le pilote automatique les vise', () => {
  const r = rivers.torrent;
  const race = new KayakRace(r, { random: seeded(9) });
  const picks = [];
  race.addEventListener('pickup', (e) => e.detail.racer.isPlayer && picks.push(e.detail.item));
  run(race, { power: 170, auto: true });
  assert.ok(picks.length >= 3, `objets ramassés : ${picks}`);
  assert.ok(picks.every((x) => ['turbo', 'whirl', 'shield'].includes(x)));
  assert.ok(race.boxes.length >= 14);
});
