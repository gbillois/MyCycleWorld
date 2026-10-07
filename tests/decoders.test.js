// Tests des décodeurs (sans Bluetooth). Lancer : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIndoorBikeData, parseCyclingPower, CrankCadence, encodeSimulation } from '../src/ble/trainer.js';
import { parseHeartRate } from '../src/ble/heart-rate.js';
import { decodeButtons, MSG } from '../src/ble/zwift.js';
import { decodeProtobuf, zigzag, hex } from '../src/ble/bytes.js';
import { encodePlayStatus } from '../src/ble/mock.js';
import { VirtualGears } from '../src/core/gears.js';

const u8 = (a) => Uint8Array.from(a);

test('FTMS Indoor Bike Data : vitesse + cadence + puissance', () => {
  // flags 0x0044 : vitesse (bit0=0), cadence (bit2), puissance (bit6)
  const d = parseIndoorBikeData(u8([0x44, 0x00, 0xb8, 0x0b, 0xb4, 0x00, 0xfa, 0x00]));
  assert.equal(d.speed, 30); // 3000 / 100
  assert.equal(d.cadence, 90); // 180 / 2
  assert.equal(d.power, 250);
});

test('FTMS Indoor Bike Data : "more data" sans vitesse, avec résistance et cardio', () => {
  // bit0=1 (pas de vitesse), bit5 résistance, bit6 puissance, bit9 cardio
  const flags = 0x0001 | 0x0020 | 0x0040 | 0x0200;
  const d = parseIndoorBikeData(u8([flags & 0xff, flags >> 8, 0x0a, 0x00, 0x2c, 0x01, 0x8c]));
  assert.equal(d.speed, undefined);
  assert.equal(d.resistance, 10);
  assert.equal(d.power, 300);
  assert.equal(d.heartRate, 140);
});

test('Cycling Power : puissance + tours de pédalier', () => {
  const d = parseCyclingPower(u8([0x20, 0x00, 0xc8, 0x00, 0x0a, 0x00, 0x00, 0x04]));
  assert.equal(d.power, 200);
  assert.equal(d.crankRevs, 10);
  assert.equal(d.crankTime, 1024);
});

test('Cadence calculée depuis les tours de pédalier (avec retour à zéro du compteur)', () => {
  const c = new CrankCadence();
  c.update(65535, 65000, 0);
  // 1,5 tour en 1 s (1024 ticks) avec débordement des compteurs => 90 rpm
  assert.equal(Math.round(c.update(0, (65000 + 683) % 65536, 1000)), 90);
});

test('Commande FTMS de simulation (pente 5 %)', () => {
  const b = encodeSimulation({ grade: 5, crr: 0.004, cw: 0.51 });
  assert.deepEqual(b, [0x11, 0, 0, 0xf4, 0x01, 40, 51]);
  const neg = encodeSimulation({ grade: -2.5 });
  assert.equal(new DataView(Uint8Array.from(neg).buffer).getInt16(3, true), -250);
});

test('Ceinture cardio : formats 8 et 16 bits', () => {
  assert.deepEqual(parseHeartRate(u8([0x06, 72])), { bpm: 72, contact: true });
  assert.deepEqual(parseHeartRate(u8([0x01, 0x2c, 0x01])), { bpm: 300, contact: null });
  assert.equal(parseHeartRate(u8([0x04, 60])).contact, false);
});

test('Protobuf générique + zigzag', () => {
  assert.deepEqual(decodeProtobuf(u8([0x08, 0x96, 0x01])), [{ field: 1, wire: 0, value: 150 }]);
  assert.equal(zigzag(199), -100);
  assert.equal(zigzag(200), 100);
});

test('Zwift Play fw1 : manette droite, bouton A appuyé', () => {
  const msg = u8(encodePlayStatus('R', ['R_A']));
  assert.equal(msg[0], MSG.PLAY);
  const d = decodeButtons(msg[0], msg.subarray(1));
  assert.equal(d.side, 'R');
  assert.deepEqual([...d.pressed], ['R_A']);
});

test('Zwift Play fw1 : manette gauche, levier tiré à fond', () => {
  const msg = u8(encodePlayStatus('L', [], -100));
  const d = decodeButtons(msg[0], msg.subarray(1));
  assert.equal(d.side, 'L');
  assert.equal(d.analog.L, -100);
  assert.deepEqual([...d.pressed], ['L_PADDLE']);
});

test('Zwift Play fw1 : trame réelle "tout relâché" (gauche)', () => {
  // 07 | 08 01 10 01 18 01 20 01 28 01 30 01 38 01 40 00 48 00
  const msg = u8([0x07, 0x08, 0x01, 0x10, 0x01, 0x18, 0x01, 0x20, 0x01, 0x28, 0x01, 0x30, 0x01, 0x38, 0x01, 0x40, 0x00, 0x48, 0x00]);
  const d = decodeButtons(msg[0], msg.subarray(1));
  assert.equal(d.side, 'L');
  assert.equal(d.pressed.size, 0);
});

test('Zwift Ride / Play fw2 : tout relâché puis gauche ◀ + levier droit', () => {
  const released = u8([0x23, 0x08, 0xff, 0xff, 0xff, 0xff, 0x0f]);
  assert.equal(decodeButtons(released[0], released.subarray(1)).pressed.size, 0);
  // masque 0xFFFFFFFE (bit0 = gauche appuyé) + palette location 1 valeur 100
  const msg = u8([0x23, 0x08, 0xfe, 0xff, 0xff, 0xff, 0x0f, 0x1a, 0x05, 0x08, 0x01, 0x10, 0xc8, 0x01]);
  const d = decodeButtons(msg[0], msg.subarray(1));
  assert.deepEqual([...d.pressed].sort(), ['L_LEFT', 'R_PADDLE']);
  assert.equal(d.analog.R, 100);
});

test('Zwift Click : bouton +', () => {
  const msg = u8([0x37, 0x08, 0x00, 0x10, 0x01]);
  assert.deepEqual([...decodeButtons(msg[0], msg.subarray(1)).pressed], ['R_SHIFT']);
});

test('Vitesses virtuelles : décalage de pente et bornes', () => {
  const g = new VirtualGears();
  assert.equal(g.effectiveGrade(5), 5);
  g.shift(-4);
  assert.equal(g.effectiveGrade(5), 1);
  g.shift(-100);
  assert.equal(g.gear, 1);
  assert.equal(g.effectiveGrade(0), -10); // borné à -10 %
  g.difficulty = 0.5;
  g.shift(100);
  assert.equal(g.effectiveGrade(10), 17); // 10*0.5 + 12
});

test('hex', () => {
  assert.equal(hex(u8([0, 255, 16])), '00 ff 10');
});

test('vélo Technogym : un FTMS à zéro ne masque pas la puissance Cycling Power', async () => {
  const { Trainer } = await import('../src/ble/trainer.js');
  const t = new Trainer({ requestDevice: async () => null });
  t.onFtmsData({ speed: 0, cadence: 0, power: 0 }, 'bike');
  t.onCpsData({ power: 180 });
  assert.equal(t.data.power, 180);
  assert.equal(t.sources.power, 'Cycling Power');
  t.onFtmsData({ speed: 0, cadence: 0, power: 0 }, 'bike');
  assert.equal(t.data.power, 180, 'le zéro FTMS n’écrase pas une source qui mesure un effort');
  t.onFtmsData({ power: 210 }, 'bike');
  t.onCpsData({ power: 220 });
  assert.equal(t.data.power, 210, 'FTMS qui mesure refait foi');
});
