import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RowingRace, boatSpeed, powerForSplit, splitFromSpeed, formatSplit, ROW } from '../src/core/rowing.js';
import { parseRowerData, parseCrossTrainerData, rowerPowerFromPace } from '../src/ble/trainer.js';
import { hardwareById, looksTechnogym, HARDWARE_ORDER } from '../src/core/hardware.js';

const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('vitesse du bateau : 2:00 / 500 m ≈ 203 W', () => {
  assert.ok(Math.abs(powerForSplit(120) - 202.5) < 0.5);
  assert.ok(Math.abs(splitFromSpeed(boatSpeed(202.5)) - 120) < 0.01);
  assert.equal(boatSpeed(0), 0);
  assert.equal(formatSplit(125.34), '2:05.3');
  assert.equal(formatSplit(65), '1:05.0');
  assert.equal(formatSplit(Infinity), '-:--');
});

test('course : compte à rebours, départ, arrivée et classement', () => {
  const race = new RowingRace({ random: seeded(3) });
  assert.equal(race.racers.length, 6);
  let go = 0;
  const finished = [];
  race.addEventListener('go', () => go++);
  race.addEventListener('finish', (e) => finished.push(e.detail));
  race.update(1, { power: 300 });
  assert.equal(race.player.s, 0, 'personne ne bouge pendant le compte à rebours');
  for (let i = 0; i < 4000 && !race.finished; i++) race.update(0.05, { power: 200, strokeRate: 26 });
  assert.equal(go, 1);
  assert.ok(race.finished);
  // 200 W ≈ 2:00.6 / 500 m, plus l'accélération du départ
  assert.ok(race.player.finishTime > 118 && race.player.finishTime < 130, `temps ${race.player.finishTime}`);
  const pos = race.positionOf(race.player);
  assert.ok(pos >= 2 && pos <= 5, `position ${pos}`);
  assert.equal(race.ranking()[0].name, 'Léa');
});

test('sortir de son couloir ralentit', () => {
  const run = (steer) => {
    const race = new RowingRace({ random: seeded(5) });
    for (let i = 0; i < 1200; i++) race.update(0.05, { power: 200, steer });
    return race.player;
  };
  const straight = run(0);
  const off = run(1);
  assert.ok(off.offLane);
  assert.ok(off.s < straight.s - 10);
  assert.ok(Math.abs(off.lateral) <= ROW.laneHalf + 1.5);
});

const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];

test('FTMS Rower Data : cadence (0.5), coups, distance, allure, puissance, FC', () => {
  const flags = (1 << 2) | (1 << 3) | (1 << 5) | (1 << 9);
  const d = parseRowerData(Uint8Array.from([...u16(flags), 52, ...u16(120), 0x2c, 0x01, 0x00, ...u16(125), ...u16(181), 140]));
  assert.deepEqual({ ...d, flags: undefined }, { flags: undefined, strokeRate: 26, strokeCount: 120, distance: 300, pace: 125, power: 181, heartRate: 140 });
  // Paquet « More Data » (bit 0) : pas de cadence, seulement la puissance
  const p = parseRowerData(Uint8Array.from([...u16(1 | (1 << 5)), ...u16(150)]));
  assert.equal(p.strokeRate, undefined);
  assert.equal(p.power, 150);
  assert.ok(Math.abs(rowerPowerFromPace(120) - 202.5) < 0.5);
});

test('FTMS Cross Trainer Data : drapeaux sur 3 octets, pas/min, résistance, puissance', () => {
  const flags = (1 << 3) | (1 << 7) | (1 << 8) | (1 << 15);
  const d = parseCrossTrainerData(Uint8Array.from([flags & 0xff, (flags >> 8) & 0xff, 0, ...u16(950), ...u16(140), ...u16(138), ...u16(85), ...u16(160)]));
  assert.equal(d.speed, 9.5);
  assert.equal(d.stepRate, 140);
  assert.equal(d.resistance, 8.5);
  assert.equal(d.power, 160);
  assert.equal(d.backward, true);
});

test('profils matériel : Zwift, Technogym, BLE standard', () => {
  assert.deepEqual(HARDWARE_ORDER, ['zwift', 'technogym', 'ble']);
  assert.equal(hardwareById('nimporte').id, 'zwift');
  const tg = hardwareById('technogym');
  assert.ok(tg.filters.some((f) => f.namePrefix === 'Technogym'));
  assert.ok(tg.filters.some((f) => f.services?.includes(0x1826)));
  assert.ok(looksTechnogym('Technogym SKILLROW'));
  assert.ok(!looksTechnogym('KICKR CORE'));
});

test('inspecteur BLE : liste de services saisie à la main, texte ASCII', async () => {
  const { parseServiceList, asciiOf } = await import('../src/ble/inspector.js');
  assert.deepEqual(parseServiceList('1826, 0xFFF0 ; 6E400001-B5A3-F393-E0A9-E50E24DCCA9E nimporte 12'), [0x1826, 0xfff0, '6e400001-b5a3-f393-e0a9-e50e24dcca9e']);
  assert.equal(asciiOf(Uint8Array.from([84, 71, 32, 49, 0])), 'TG 1');
  assert.equal(asciiOf(Uint8Array.from([1, 200])), null);
});

test('rameur : cadence de secours (moyenne, puis compteur de coups)', async () => {
  const { Trainer } = await import('../src/ble/trainer.js');
  const t = new Trainer({ requestDevice: async () => null });
  t.onFtmsData({ strokeRate: 0, avgStrokeRate: 24, power: 150 }, 'rower');
  assert.equal(t.data.strokeRate, 24);
  const u = new Trainer({ requestDevice: async () => null });
  [0, 2300, 4600, 6900].forEach((ms, i) => u.strokeRateFrom({ strokeCount: i }, ms));
  assert.ok(Math.abs(u.strokeRateFrom({ strokeCount: 3 }, 6900) - 26) < 1.5);
});

test('cardio : montres et ceintures reconnues par leur nom, dans tous les profils', async () => {
  const { looksHeartRate } = await import('../src/core/hardware.js');
  assert.ok(looksHeartRate('Forerunner 255'));
  assert.ok(looksHeartRate('Polar H10 1234'));
  assert.ok(!looksHeartRate('KICKR CORE'));
});
