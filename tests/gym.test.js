// Carte des salles (src/core/gym.js) : lecture de la carte envoyée par l'appli, ordre des machines,
// machine la plus proche, souvenir du choix et signal de départ.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGym, fits, proximity, rankMachines, nearestId, placeById, loadChoices, saveChoice, lastChoice, isMoving, gateStatus, CHOICE_KEY } from '../src/core/gym.js';

const P1 = 'AAAAAAAA-0000-4000-8000-000000000001';
const P2 = 'AAAAAAAA-0000-4000-8000-000000000002';
const ROW = 'BBBBBBBB-0000-4000-8000-000000000001';
const BIKE = 'BBBBBBBB-0000-4000-8000-000000000002';
const UNKNOWN = 'BBBBBBBB-0000-4000-8000-000000000003';
const LOOSE = 'BBBBBBBB-0000-4000-8000-000000000004';
const OTHER = 'BBBBBBBB-0000-4000-8000-000000000005';

const RAW = {
  v: 1,
  defaultPlace: P1.toLowerCase(),
  places: [
    {
      id: P1,
      name: 'Club',
      width: 20,
      depth: 12,
      machines: [
        { id: ROW, name: 'SKILLROW', label: 'Rameur fenêtre', kind: 'rower', x: 3, y: 4, err: 1.5 },
        { id: BIKE, name: 'BIKE 1', kind: 'bike', x: 30, y: -2 },
        { id: UNKNOWN, name: 'Technogym', kind: 'fusée' },
        { id: 'pas-un-uuid', name: 'X' },
      ],
    },
    { id: P2, name: 'Hôtel', width: 500, depth: 1, machines: [{ id: OTHER, name: 'MYRUN', kind: 'treadmill', x: 1, y: 1 }] },
    { id: 'faux', name: 'Ignoré' },
  ],
  nearby: [
    { id: BIKE, name: 'BIKE 1', kind: 'bike', rssi: -72 },
    { id: LOOSE, name: 'SKILLBIKE 9', kind: 'bike', rssi: -60 },
    { id: ROW, name: 'SKILLROW', kind: 'rower', rssi: -48 },
    { id: 'zzz', rssi: -40 },
  ],
  scanning: true,
};

test('la carte de l’appli est lue prudemment', () => {
  const gym = parseGym(RAW);
  assert.equal(gym.places.length, 2);
  assert.equal(gym.defaultPlace, P1, 'identifiants en majuscules');
  const club = gym.places[0];
  assert.equal(club.machines.length, 3, 'identifiant invalide ignoré');
  const [row, bike, unknown] = club.machines;
  assert.equal(row.title, 'Rameur fenêtre');
  assert.equal(row.err, 1.5);
  assert.deepEqual([bike.x, bike.y], [20, 0], 'position ramenée dans le plan');
  assert.equal(unknown.kind, null);
  assert.equal(unknown.x, null);
  assert.deepEqual([gym.places[1].width, gym.places[1].depth], [120, 4], 'dimensions bornées');
  assert.deepEqual(gym.nearby.map((n) => n.id), [ROW, LOOSE, BIKE], 'plus proche d’abord, entrées invalides ignorées');
  assert.equal(gym.scanning, true);
  assert.deepEqual(parseGym(null), { places: [], defaultPlace: null, nearby: [], scanning: false });
  assert.equal(parseGym({ places: [{ id: P2, machines: [] }], defaultPlace: 'inconnu' }).defaultPlace, P2);
});

test('machines adaptées au mode de jeu et proximité', () => {
  assert.equal(fits('rower', 'row'), 'yes');
  assert.equal(fits('bike', 'row'), 'no');
  assert.equal(fits(null, 'row'), 'maybe');
  assert.equal(fits('power', 'bike'), 'yes');
  assert.equal(fits('cross', 'cross'), 'yes');
  assert.equal(fits('bike', 'cross'), 'no');
  assert.equal(proximity(-50), 'juste devant toi');
  assert.equal(proximity(-60), 'tout près');
  assert.equal(proximity(-75), 'dans la salle');
  assert.equal(proximity(-90), 'loin');
  assert.equal(proximity(null), null);
});

test('ordre des machines : devant soi, adaptées, inconnues, autres ; machines hors carte à la fin', () => {
  const gym = parseGym(RAW);
  const club = placeById(gym, P1);
  const rowing = rankMachines(gym, club, 'row').map((m) => m.id);
  assert.deepEqual(rowing, [ROW, UNKNOWN, BIKE, LOOSE]);
  const cycling = rankMachines(gym, club, 'bike');
  assert.deepEqual(cycling.map((m) => m.id), [BIKE, LOOSE, UNKNOWN, ROW], 'le rameur juste devant ne passe pas devant les vélos');
  assert.equal(cycling.find((m) => m.id === LOOSE).mapped, false);
  assert.equal(cycling.find((m) => m.id === BIKE).rssi, -72);
  assert.equal(nearestId(gym, club), ROW);
  assert.equal(nearestId(gym, placeById(gym, P2)), null);
  assert.equal(placeById(gym, 'inconnu').id, P1, 'lieu inconnu : le lieu par défaut');
});

test('le dernier choix est mémorisé par lieu et par mode', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(loadChoices(storage), {});
  saveChoice(storage, P1, 'row', ROW);
  saveChoice(storage, P1, 'bike', BIKE);
  assert.equal(lastChoice(loadChoices(storage), P1, 'row'), ROW);
  assert.equal(lastChoice(loadChoices(storage), P2, 'row'), null);
  store.set(CHOICE_KEY, '{cassé');
  assert.deepEqual(loadChoices(storage), {});
  const broken = { getItem: () => { throw new Error('bloqué'); }, setItem: () => { throw new Error('bloqué'); } };
  assert.deepEqual(loadChoices(broken), {});
  assert.doesNotThrow(() => saveChoice(broken, P1, 'row', ROW));
});

test('la course part aux premières données d’effort de la machine choisie', () => {
  assert.equal(isMoving(null), false);
  assert.equal(isMoving({ power: 0, cadence: 0, speed: 0.2, strokeRate: null }), false);
  assert.equal(isMoving({ power: 0, strokeRate: 18 }), true);
  assert.equal(isMoving({ cadence: 60 }), true);
  assert.equal(isMoving({ stepRate: 40 }), true);
  const t = (connected, id, data = {}) => ({ connected, id, data });
  assert.equal(gateStatus(t(false, null), ROW), 'connecting');
  assert.equal(gateStatus(t(true, BIKE), ROW), 'other');
  assert.equal(gateStatus(t(true, ROW.toLowerCase()), ROW), 'idle');
  assert.equal(gateStatus(t(true, ROW, { power: 120 }), ROW), 'go');
  assert.equal(gateStatus(t(true, null, { cadence: 50 }), ROW), 'go', 'appli sans identifiant : la machine branchée fait foi');
});
