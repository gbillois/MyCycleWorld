// Météo (src/core/weather.js) et vent dans la physique (src/core/physics.js). Lancer : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rollWeather, weatherAt, rainAt, tailwind, crosswind, stepWetness, wetCrrFactor, wetSteer, windGrade, ftmsWindSpeed,
  describeWind, boatWindFactor, forecast, weatherMode, skyIcon, CLIMATES, WET,
} from '../src/core/weather.js';
import { steadySpeed, stepSpeed, resistiveForce, DEFAULTS, draftFactor } from '../src/core/physics.js';
import { STEER } from '../src/core/steering.js';
import { COURSES } from '../game/courses.js';
import { Trainer } from '../src/ble/trainer.js';
import { Devices } from '../game/devices.js';
import { NativeDevices } from '../game/native.js';
import { weatherMix } from '../game/audio/weather.js';

// Tangentes unitaires d'une boucle fermée (points de contrôle d'un vrai circuit), pondérées par la longueur.
function loopTangents(points) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[(i + 1) % points.length];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len > 0) out.push({ tx: (x1 - x0) / len, tz: (z1 - z0) / len, len });
  }
  return out;
}

test('mode : valeurs reconnues, sinon aléatoire ; Désactivée = aucune météo', () => {
  assert.equal(weatherMode('off'), 'off');
  assert.equal(weatherMode('n’importe quoi'), 'random');
  assert.equal(weatherMode(null), 'random');
  assert.equal(rollWeather({ theme: 'alpine', mode: 'off', seed: 3 }), null);
  const w = weatherAt(null, 12, {});
  assert.deepEqual([w.rain, w.speed, w.cloud], [0, 0, 0]);
});

test('déterminisme : même graine = même météo, autre graine = autre météo', () => {
  const a = rollWeather({ theme: 'alpine', mode: 'random', seed: 42 });
  const b = rollWeather({ theme: 'alpine', mode: 'random', seed: 42 });
  assert.deepEqual(a, b);
  const oa = {};
  const ob = {};
  for (const t of [-3, 0, 17.5, 120, 333]) {
    weatherAt(a, t, oa);
    weatherAt(b, t, ob);
    assert.deepEqual(oa, ob);
  }
  const others = new Set();
  for (let s = 1; s <= 20; s++) others.add(rollWeather({ theme: 'alpine', seed: s }).speed.toFixed(4));
  assert.ok(others.size > 15, 'les graines donnent des temps différents');
});

test('climat : probabilité de pluie selon le décor (montagne > prairie, lac jamais)', () => {
  const N = 2000;
  const rainy = (theme) => {
    let n = 0;
    for (let s = 1; s <= N; s++) if (rollWeather({ theme, mode: 'random', seed: s * 7919 }).showers.length) n++;
    return n / N;
  };
  const alpine = rainy('alpine');
  const meadow = rainy('meadow');
  const coast = rainy('coast');
  assert.ok(Math.abs(alpine - CLIMATES.alpine.rain) < 0.04, `montagne ${alpine}`);
  assert.ok(Math.abs(meadow - CLIMATES.meadow.rain) < 0.04, `prairie ${meadow}`);
  assert.ok(Math.abs(coast - CLIMATES.coast.rain) < 0.04, `côte ${coast}`);
  assert.ok(alpine > meadow * 2);
  assert.equal(rainy('lake'), 0);
});

test('climat : plus de vent en montagne, brise de mer régulière venant du large', () => {
  const avg = (theme, f) => {
    let sum = 0;
    for (let s = 1; s <= 400; s++) sum += f(rollWeather({ theme, seed: s }));
    return sum / 400;
  };
  assert.ok(avg('alpine', (p) => p.speed) > avg('meadow', (p) => p.speed) * 1.6);
  // Côte : le vent souffle vers la terre (z décroissant), jamais calme, peu de rafales.
  for (let s = 1; s <= 100; s++) {
    const p = rollWeather({ theme: 'coast', seed: s });
    const o = weatherAt(p, 60, {});
    assert.ok(o.dirZ < -0.8, `brise de mer vers la terre (dirZ ${o.dirZ.toFixed(2)})`);
    assert.ok(p.speed >= CLIMATES.coast.wind[0] - 1e-9);
  }
  assert.ok(avg('coast', (p) => p.gust) < avg('alpine', (p) => p.gust) / 2);
});

test('modes forcés : pluie dès le départ qui s’arrête puis revient, vent fort, beau temps sec', () => {
  for (let s = 1; s <= 30; s++) {
    const rain = rollWeather({ theme: 'meadow', mode: 'rain', seed: s });
    assert.ok(rainAt(rain, 0) > 0.3, 'il pleut au départ');
    const [a, b] = rain.showers;
    assert.ok(rainAt(rain, a.t1 + a.fade + 5) === 0, 'éclaircie entre deux averses');
    assert.ok(rainAt(rain, b.t0 + b.ramp + 5) > 0.2, 'nouvelle averse');
    const wind = rollWeather({ theme: 'meadow', mode: 'wind', seed: s });
    assert.ok(wind.speed >= 6.5 && !wind.showers.length);
    const fair = rollWeather({ theme: 'alpine', mode: 'fair', seed: s });
    assert.ok(!fair.showers.length && fair.speed <= CLIMATES.alpine.wind[0] + 1.2 + 1e-9);
  }
});

test('évolution : rafales et pluie bornées, le vent tourne un peu', () => {
  const p = rollWeather({ theme: 'alpine', mode: 'rain', seed: 9 });
  const o = {};
  let min = Infinity;
  let max = 0;
  let dmin = Infinity;
  let dmax = -Infinity;
  for (let t = -3; t < 900; t += 0.5) {
    weatherAt(p, t, o);
    assert.ok(o.rain >= 0 && o.rain <= 1 && o.cloud >= 0 && o.cloud <= 1);
    assert.ok(Number.isFinite(o.speed) && o.speed >= 0);
    assert.ok(Math.abs(Math.hypot(o.dirX, o.dirZ) - 1) < 1e-9);
    min = Math.min(min, o.speed);
    max = Math.max(max, o.speed);
    const a = Math.atan2(o.dirX, o.dirZ);
    dmin = Math.min(dmin, a);
    dmax = Math.max(dmax, a);
  }
  assert.ok(max > min * 1.5, `rafales ${min.toFixed(1)} à ${max.toFixed(1)} m/s`);
  assert.ok(dmax - dmin > 0.1 && dmax - dmin < 1.2 || dmax - dmin > 5, 'le vent tourne lentement');
});

test('vent le long d’une boucle : de dos puis de face, nul en moyenne sur le tour', () => {
  for (const id of Object.keys(COURSES)) {
    const tangents = loopTangents(COURSES[id].control);
    const total = tangents.reduce((n, x) => n + x.len, 0);
    for (const dir of [0, 1.1, 2.5, 4]) {
      const dx = Math.sin(dir);
      const dz = Math.cos(dir);
      let mean = 0;
      let head = 0;
      let tail = 0;
      for (const t of tangents) {
        const w = tailwind(6, dx, dz, t.tx, t.tz);
        assert.ok(Math.abs(w) <= 6 + 1e-9);
        assert.ok(Math.abs(Math.hypot(w, crosswind(6, dx, dz, t.tx, t.tz)) - 6) < 1e-9);
        mean += w * t.len;
        if (w < -2) head += t.len;
        if (w > 2) tail += t.len;
      }
      assert.ok(Math.abs(mean / total) < 1e-6, `${id} : moyenne ${mean / total}`);
      assert.ok(head > total * 0.1 && tail > total * 0.1, `${id} : portions de face et de dos`);
    }
  }
  // Cas simples : route vers le nord (+z), vent vers le nord = de dos ; vers le sud = de face.
  assert.equal(tailwind(5, 0, 1, 0, 1), 5);
  assert.equal(tailwind(5, 0, -1, 0, 1), -5);
  assert.ok(Math.abs(tailwind(5, 1, 0, 0, 1)) < 1e-12);
});

test('physique : le vent de dos aide, le vent de face freine, sans vent rien ne change', () => {
  const calm = steadySpeed(200, 0);
  assert.ok(steadySpeed(200, 0, { tailwind: 5 }) > calm + 1);
  assert.ok(steadySpeed(200, 0, { tailwind: -5 }) < calm - 1);
  // Sans vent : exactement la physique d'origine (Désactivée).
  assert.equal(resistiveForce(9.3, 2.5, { tailwind: 0 }), resistiveForce(9.3, 2.5));
  assert.equal(stepSpeed(7, 230, 1, 1 / 60, { tailwind: 0, crr: 0.004 * wetCrrFactor(0) }), stepSpeed(7, 230, 1, 1 / 60, { crr: 0.004 }));
  // Intégration image par image : même sens.
  let a = 9;
  let b = 9;
  let c = 9;
  for (let i = 0; i < 60 * 30; i++) {
    a = stepSpeed(a, 220, 0, 1 / 60);
    b = stepSpeed(b, 220, 0, 1 / 60, { tailwind: 4 });
    c = stepSpeed(c, 220, 0, 1 / 60, { tailwind: -4 });
  }
  assert.ok(b > a && a > c, `${b} > ${a} > ${c}`);
  // Vent de dos plus rapide que le coureur : l'air pousse (traînée négative).
  assert.ok(resistiveForce(3, 0, { tailwind: 6, crr: 0 }) < 0);
});

test('physique : l’aspiration réduit aussi la traînée du vent de face', () => {
  const alone = steadySpeed(200, 0, { tailwind: -6 });
  const sheltered = steadySpeed(200, 0, { tailwind: -6, cda: DEFAULTS.cda * draftFactor(2, 0) });
  assert.ok(sheltered > alone * 1.08);
});

test('pluie : la route mouille vite et sèche lentement ; roulement et adhérence', () => {
  let wet = 0;
  for (let t = 0; t < 40; t += 0.1) wet = stepWetness(wet, 0.8, 0.1);
  assert.ok(wet > 0.8, `mouillée ${wet}`);
  let dry = wet;
  for (let t = 0; t < 40; t += 0.1) dry = stepWetness(dry, 0, 0.1);
  assert.ok(dry > wet * 0.7, 'sèche lentement');
  for (let t = 0; t < 900; t += 0.1) dry = stepWetness(dry, 0, 0.1);
  assert.ok(dry < 0.01);
  assert.equal(wetCrrFactor(0), 1);
  assert.ok(Math.abs(wetCrrFactor(1) - (1 + WET.crr)) < 1e-12);
  const s = wetSteer(1, STEER, {});
  assert.ok(s.maxLean < STEER.maxLean && s.rollTime > STEER.rollTime && s.minRadius > STEER.minRadius);
  assert.deepEqual(wetSteer(0, STEER, {}), { ...STEER });
  // Sur route mouillée, même puissance : un peu moins vite.
  assert.ok(steadySpeed(200, 0, { crr: DEFAULTS.crr * wetCrrFactor(1) }) < steadySpeed(200, 0));
});

test('trainer : pente équivalente au vent et champ vent FTMS (positif = de face)', () => {
  assert.equal(windGrade(10, 0), 0);
  const head = windGrade(10, -5);
  const tail = windGrade(10, 5);
  assert.ok(head > 2 && head < 4, `face ${head}`);
  assert.ok(tail < -1 && tail > -3, `dos ${tail}`);
  assert.ok(windGrade(0, -5) > 0, 'à l’arrêt, le vent de face pousse en arrière');
  // Cohérence avec la physique : même surcroît de force.
  const dF = resistiveForce(10, 0, { tailwind: -5 }) - resistiveForce(10, 0);
  assert.ok(Math.abs(head - (dF / (DEFAULTS.mass * DEFAULTS.g)) * 100) < 1e-9);
  assert.equal(ftmsWindSpeed(-4.25), 4.25);
  assert.equal(ftmsWindSpeed(3), -3);
  assert.equal(ftmsWindSpeed(0), 0);
  assert.equal(ftmsWindSpeed(-100), 32);
});

test('libellés : vent de face, de dos, de côté, calme ; ciel ; prévision', () => {
  assert.deepEqual(describeWind(-5, 5), { kind: 'head', kmh: 18, text: 'Vent de face 18 km/h' });
  assert.equal(describeWind(4, 5).text, 'Vent de dos 18 km/h');
  assert.equal(describeWind(0.5, 5).kind, 'cross');
  assert.equal(describeWind(0, 0.4).kind, 'calm');
  assert.equal(skyIcon(0.9, 1), '🌧️');
  assert.equal(skyIcon(0, 0), '☀️');
  assert.match(forecast('alpine', 'random'), /averses/);
  assert.match(forecast('coast', 'random'), /brise/);
  assert.equal(forecast('meadow', 'off'), 'désactivée');
});

test('aviron : effet doux du vent sur le bateau', () => {
  assert.equal(boatWindFactor(0), 1);
  assert.ok(boatWindFactor(5) > 1 && boatWindFactor(5) < 1.07);
  assert.ok(boatWindFactor(-5) < 1);
  assert.equal(boatWindFactor(-50), 0.9);
});

// --- Le vent jusqu'au trainer ---

test('trainer FTMS : le vent part dans le champ « vitesse du vent » de Set Indoor Bike Simulation', async () => {
  const t = new Trainer({ requestDevice: async () => null });
  t.kind = 'bike';
  const sent = [];
  t.command = async (bytes) => {
    sent.push(bytes);
    return { ok: true };
  };
  t.setGradeThrottled(2.5, 4.25); // pente 2,5 %, vent de face 4,25 m/s
  await new Promise((r) => setTimeout(r, 0));
  clearTimeout(t.gradePump);
  t.gradePump = null;
  const v = new DataView(Uint8Array.from(sent[0]).buffer);
  assert.equal(sent[0][0], 0x11);
  assert.equal(v.getInt16(1, true), 4250);
  assert.equal(v.getInt16(3, true), 250);
  // Sans vent (météo désactivée) : exactement les octets d'avant (vent 0).
  t.setGradeThrottled(5);
  await new Promise((r) => setTimeout(r, 0));
  clearTimeout(t.gradePump);
  assert.deepEqual(sent[1], [0x11, 0, 0, 0xf4, 0x01, 40, 51]);
});

test('jeu web : vélo en simulation = pente sans vent + champ vent ; elliptique ou rameur = vent fondu dans la pente', () => {
  const calls = [];
  const trainer = { connected: true, canControl: true, kind: 'bike', setGradeThrottled: (...a) => calls.push(a) };
  const send = (...a) => Devices.prototype.sendGrade.call({ trainer }, ...a);
  send(6.4, 6.4, { speed: 5, grade: 4 }); // ressentie 6,4 % dont 2,4 % de vent de face
  assert.deepEqual(calls.pop(), [4, 5]);
  send(3, 3); // météo désactivée : comme avant
  assert.deepEqual(calls.pop(), [3]);
  trainer.kind = 'rower';
  send(6.4, 6.4, { speed: 5, grade: 4 });
  assert.deepEqual(calls.pop(), [6.4]);
  trainer.canControl = false;
  send(1, 1, null);
  assert.equal(calls.length, 0);
});

test('appli iOS : le vent est fondu dans la pente du terrain, message inchangé (protocole 1)', () => {
  const posted = [];
  const win = new EventTarget();
  win.webkit = { messageHandlers: { mcw: { postMessage: (m) => posted.push(m) } } };
  const devices = new NativeDevices({ win, keyEmitter: { releaseAll() {}, buttonDown() {}, buttonUp() {} } });
  devices.sendGrade(8, 4 + 1.5, { speed: 5, grade: 6.5 }); // terrain 4 % + 1,5 % de vent de face
  assert.deepEqual(posted.at(-1), { type: 'grade', value: 5.5 });
});

test('son : pluie, vent plus fort de face, chuintement des pneus seulement sur route mouillée', () => {
  const off = weatherMix(null);
  assert.equal(off.leaves + off.road + off.wind + off.hiss, 0);
  const w = { on: true, rain: 0.8, wet: 0.9, wind: 6, head: 0, gust: 1, theme: 'meadow' };
  const tailMix = weatherMix(w, 9, true);
  const headMix = weatherMix({ ...w, head: 6 }, 9, true);
  assert.ok(headMix.wind > tailMix.wind * 1.4);
  assert.ok(tailMix.leaves > 0.2 && tailMix.road > 0.1 && tailMix.hiss > 0.1);
  assert.ok(weatherMix({ ...w, theme: 'coast' }).leaves < tailMix.leaves);
  assert.equal(weatherMix({ ...w, wet: 0 }, 9, true).hiss, 0);
  assert.equal(weatherMix(w, 9, false).hiss, 0);
  assert.equal(weatherMix({ ...w, rain: 0, wind: 0 }, 9, true).wind, 0);
});
