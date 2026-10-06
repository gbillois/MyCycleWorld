// Son du jeu (game/audio/) : réglages, hasard, chants d'oiseaux, revêtements, musique procédurale,
// emplacements des sources, et analyse spectrale des sons calculés. Lancer : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, BUSES, STORAGE_KEY, normalizeSettings, loadSettings, saveSettings, volumeToGain, busGain, stepVolume, percentLabel } from '../game/audio/settings.js';
import { rng, hashSeed, nextDelay, EventClock, Wander, weighted } from '../game/audio/random.js';
import { BIRDS, SCENE_BIRDS, birdSong, contour, songDuration, surfaceMix, tyreParams, freewheelRate, isCoasting, chainMeshRate, countdownStep, passEvent, breathing, musicIntensity, crowdExcitement } from '../game/audio/patterns.js';
import { makeSong, stepEvents, planSteps, stepDuration, swingOffset, layerLevel, SCALES, MOODS } from '../game/audio/music-gen.js';
import { soundSpots, rowingSpots, coastZ } from '../game/audio/spots.js';
import { bandEnergy, goertzel, dominantFreq, peak, rms, pink, brown, Filter, addDecaySine } from '../game/audio/dsp.js';
import * as V from '../game/audio/voices.js';
import * as S from '../game/audio/sounds.js';
import { RENDERERS, renderSound } from '../game/audio/renderers.js';
import { COURSES } from '../game/courses.js';

const SR = 48000;
const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
};

// --- Réglages ---
test('réglages : valeurs par défaut demandées', () => {
  assert.deepEqual(BUSES, ['master', 'music', 'ambience', 'sfx', 'ui']);
  assert.deepEqual({ ...DEFAULTS }, { master: 80, music: 50, ambience: 70, sfx: 80, ui: 60, muted: false, windNoise: false });
  assert.deepEqual(loadSettings(memStorage()), { ...DEFAULTS });
});

test('réglages : JSON abîmé, valeurs hors bornes, stockage indisponible', () => {
  assert.deepEqual(normalizeSettings({ master: 140, music: -5, ambience: '35', sfx: 'abc', muted: 'oui' }), { master: 100, music: 0, ambience: 35, sfx: 80, ui: 60, muted: false });
  const st = memStorage();
  st.setItem(STORAGE_KEY, '{pas du json');
  assert.deepEqual(loadSettings(st), { ...DEFAULTS });
  const broken = { getItem() { throw new Error('bloqué'); }, setItem() { throw new Error('plein'); } };
  assert.deepEqual(loadSettings(broken), { ...DEFAULTS });
  assert.equal(saveSettings(DEFAULTS, broken), false);
});

test('réglages : enregistrés puis relus dans mycycleworld.audio', () => {
  const st = memStorage();
  assert.equal(saveSettings({ ...DEFAULTS, music: 25, muted: true }, st), true);
  assert.ok(st.map.has('mycycleworld.audio'));
  assert.deepEqual(loadSettings(st), { ...DEFAULTS, music: 25, muted: true });
});

test('volume : courbe perceptive, 0 = silence, coupure générale', () => {
  assert.equal(volumeToGain(0), 0);
  assert.equal(volumeToGain(100), 1);
  assert.equal(volumeToGain(50), 0.25);
  let prev = -1;
  for (let p = 0; p <= 100; p += 5) {
    assert.ok(volumeToGain(p) > prev);
    prev = volumeToGain(p);
  }
  assert.equal(busGain({ ...DEFAULTS, muted: true }, 'music'), 0);
  assert.ok(Math.abs(busGain({ ...DEFAULTS }, 'master') - 0.64) < 1e-9);
  assert.equal(stepVolume(80, 1), 85);
  assert.equal(stepVolume(80, -1), 75);
  assert.equal(stepVolume(98, 1), 100);
  assert.equal(stepVolume(2, -1), 0);
  assert.equal(stepVolume(73, 1), 75);
  assert.equal(percentLabel(42), '42 %');
});

// --- Hasard ---
test('hasard : reproductible, délais bornés, horloge à la bonne cadence', () => {
  const a = rng(5);
  const b = rng(5);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
  assert.notEqual(hashSeed('meadow'), hashSeed('alpine'));
  const r = rng(9);
  for (let i = 0; i < 500; i++) {
    const d = nextDelay(r, 4, 1, 12);
    assert.ok(d >= 1 && d <= 12);
  }
  const clock = new EventClock(rng(3), 2);
  let n = 0;
  for (let i = 0; i < 60 * 600; i++) n += clock.tick(1 / 60);
  assert.ok(n > 230 && n < 370, `≈ 300 événements en 10 min pour une moyenne de 2 s (${n})`);
  // Les intervalles varient : pas de rythme mécanique (écart type significatif)
  const r2 = rng(11);
  const ds = Array.from({ length: 200 }, () => nextDelay(r2, 3));
  const mean = ds.reduce((s, x) => s + x, 0) / ds.length;
  const sd = Math.sqrt(ds.reduce((s, x) => s + (x - mean) ** 2, 0) / ds.length);
  assert.ok(sd > mean * 0.4, `écart type ${sd.toFixed(2)} pour une moyenne ${mean.toFixed(2)}`);
  const w = new Wander(rng(2), 0.2, 0.8);
  for (let i = 0; i < 400; i++) {
    const x = w.tick(0.5);
    if (x) assert.ok(x.target >= 0.2 && x.target <= 0.8);
  }
  assert.equal(weighted(() => 0.99, [['a', 1], ['b', 1]]), 'b');
});

// --- Oiseaux ---
test('oiseaux : chaque espèce chante dans sa bande, avec des glissandos', () => {
  const ranges = { blackbird: [1200, 7500], greatTit: [2900, 7000], chaffinch: [1800, 6500], robin: [2000, 9000], skylark: [1700, 8500], swallow: [2200, 9500], cuckoo: [480, 760], chough: [2200, 5100], marmot: [2400, 3300], dipper: [4500, 8000], reedWarbler: [1300, 7500], coot: [700, 1500] };
  for (const sp of Object.keys(BIRDS)) {
    const r = rng(hashSeed(sp));
    const notes = birdSong(sp, r);
    assert.ok(notes.length >= 1, sp);
    const [lo, hi] = ranges[sp];
    let glides = 0;
    for (const n of notes) {
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        const f = contour(n, u);
        assert.ok(f >= lo && f <= hi, `${sp} : ${f.toFixed(0)} Hz hors de [${lo}, ${hi}]`);
      }
      if (Math.abs(contour(n, 0) - contour(n, 1)) > 15 || n.curve === 'arch') glides++;
    }
    assert.ok(glides > 0, `${sp} : au moins une note glissée`);
    const dur = songDuration(notes);
    assert.ok(dur > 0.05 && dur < 8, `${sp} : durée ${dur}`);
  }
  // Deux chants d'une même espèce ne sont jamais identiques
  const a = birdSong('blackbird', rng(1));
  const b = birdSong('blackbird', rng(2));
  assert.notDeepEqual(a.map((n) => Math.round(n.f0)), b.map((n) => Math.round(n.f0)));
  for (const list of Object.values(SCENE_BIRDS)) for (const [sp] of list) assert.ok(BIRDS[sp], sp);
});

test('oiseaux : le son calculé a son énergie entre 2 et 8 kHz et suit le contour', () => {
  const notes = birdSong('chaffinch', rng(4));
  const buf = V.renderSong(SR, notes);
  const high = bandEnergy(buf, SR, 2000, 8000);
  const low = bandEnergy(buf, SR, 100, 1000);
  assert.ok(high > low * 50, `2-8 kHz ${high} contre 100-1000 Hz ${low}`);
  // Trille descendante du pinson : la fréquence dominante baisse au cours de la première note
  const n0 = notes[0];
  const at = (u) => dominantFreq(buf, SR, Math.round((n0.t + n0.d * u) * SR), 256, 1500, 9000);
  assert.ok(at(0.15) > at(0.85) * 1.15, `${at(0.15)} -> ${at(0.85)}`);
  assert.ok(peak(buf) <= 0.91);
});

// --- Revêtements et roulement ---
test('revêtement : chaque sol a son bruit dominant', () => {
  const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(top(surfaceMix('asphalt')), 'hiss');
  assert.equal(top(surfaceMix('boardwalk')), 'wood');
  assert.equal(top(surfaceMix('sand')), 'sand');
  assert.equal(top(surfaceMix('asphalt', true)), 'crunch'); // herbe et gravier hors de la route
  assert.equal(top(surfaceMix('inconnu')), 'hiss');
  let prev = 0;
  for (let v = 0; v <= 16; v += 2) {
    const p = tyreParams(v, 'asphalt');
    assert.ok(p.hiss >= prev);
    prev = p.hiss;
  }
  assert.equal(tyreParams(0, 'asphalt').hiss, 0);
  assert.ok(tyreParams(10, 'asphalt').hissFreq > tyreParams(4, 'asphalt').hissFreq);
  assert.equal(tyreParams(8, 'asphalt').plankRate, 0);
  assert.ok(Math.abs(tyreParams(8.8, 'boardwalk').plankRate - 8) < 0.01, 'une latte tous les 1,1 m');
  assert.equal(tyreParams(8, 'boardwalk', true).plankRate, 0);
  assert.ok(Math.abs(freewheelRate(10) - 85.7) < 0.1);
  assert.ok(isCoasting(0, 0, 8) && !isCoasting(85, 220, 8) && !isCoasting(0, 0, 0.5));
  assert.equal(chainMeshRate(90), 75);
});

// --- Course ---
test('compte à rebours : un bip à -3, -2 et -1 s, une seule fois chacun', () => {
  const beeps = [];
  let t = -3;
  while (t < 0.5) {
    const next = t + 1 / 60;
    const k = countdownStep(t, next);
    if (k) beeps.push(k);
    t = next;
  }
  assert.deepEqual(beeps, [3, 2, 1]);
  assert.equal(countdownStep(-0.5, -0.4), 0);
});

test('dépassements : seulement de près, dans les deux sens', () => {
  assert.equal(passEvent(1.2, -0.3, 1), 1);
  assert.equal(passEvent(-0.4, 0.5, -1), -1);
  assert.equal(passEvent(2, 1, 0), 0);
  assert.equal(passEvent(1, -1, 6), 0, 'trop loin sur le côté');
  assert.equal(passEvent(30, -30, 0), 0, 'nouveau tour, pas un dépassement');
});

test('souffle et musique suivent l’effort', () => {
  assert.equal(breathing(150, 0).rate, 0);
  const hard = breathing(350, 6);
  assert.ok(hard.rate > 30 && hard.level > 0.6);
  assert.ok(breathing(220, 9).rate > 0, 'pente raide : on souffle même à puissance moyenne');
  assert.equal(musicIntensity({ state: 'home' }), 1);
  assert.ok(musicIntensity({ time: -2 }) < 1);
  assert.ok(musicIntensity({ time: 10, power: 320, speed: 12 }) > musicIntensity({ time: 10, power: 100, speed: 6 }));
  assert.equal(musicIntensity({ time: 10, power: 50, turbo: true }), 3);
  assert.ok(musicIntensity({ time: 10, power: 50, finalLap: true }) >= 2.4);
  assert.ok(crowdExcitement(5) === 1 && crowdExcitement(200) === 0.2 && crowdExcitement(40) > crowdExcitement(70));
});

// --- Musique ---
test('musique : chaque niveau a sa tonalité et son tempo, reproductibles', () => {
  const songs = ['meadow', 'alpine', 'coast', 'lake', 'river'].map((k) => makeSong(k, k));
  const sig = songs.map((s) => `${s.root}/${s.bpm}/${s.mode}`);
  assert.ok(new Set(sig).size >= 4, sig.join(' '));
  assert.deepEqual(makeSong('alpine', 'alpine'), makeSong('alpine', 'alpine'));
  for (const s of songs) {
    const mood = MOODS[s.mood];
    assert.ok(s.bpm >= mood.bpm[0] && s.bpm <= mood.bpm[1]);
    assert.equal(s.bars.length, 16);
    // Toutes les notes des accords appartiennent à la gamme
    const pcs = new Set(SCALES[s.mode].map((x) => (x + s.root) % 12));
    for (const bar of s.bars) for (const n of bar.notes) assert.ok(pcs.has(((n % 12) + 12) % 12), `${n} hors gamme`);
  }
  const menu = makeSong('meadow', 'menu');
  assert.ok(menu.bpm < 90, 'musique du menu plus calme');
});

test('musique : les couches s’ajoutent avec l’intensité', () => {
  const s = makeSong('lake', 'lake');
  const kinds = (x) => {
    const set = new Set();
    for (let i = 0; i < 64; i++) for (const e of stepEvents(s, i, x)) set.add(e.type === 'drum' ? e.kind : e.type);
    return set;
  };
  const calm = kinds(0.5);
  const full = kinds(3);
  assert.ok(calm.has('chord') && !calm.has('kick') && !calm.has('hat'));
  assert.ok(full.has('kick') && full.has('bass') && full.has('note'));
  assert.equal(layerLevel(0, 'pad'), 1);
  assert.equal(layerLevel(1, 'kick'), 0);
  assert.equal(layerLevel(3, 'kick'), 1);
});

test('musique : programmation en avance sans doublon ni retard rattrapé d’un coup', () => {
  const dur = stepDuration(120);
  assert.equal(dur, 0.125);
  let next = 1;
  const all = [];
  for (let now = 0.95; now < 3; now += 0.025) {
    const res = planSteps(now, next, dur, 0.1);
    for (const t of res.times) {
      assert.ok(t >= now - 1e-9 && t < now + 0.1 + 1e-9, 'dans la fenêtre de 100 ms');
      all.push(t);
    }
    next = res.next;
  }
  for (let i = 1; i < all.length; i++) assert.ok(Math.abs(all[i] - all[i - 1] - dur) < 1e-9, 'pas réguliers, aucun doublon');
  // Après une suspension de 5 s : recalage, pas de rafale de notes
  const late = planSteps(10, 5, dur, 0.1);
  assert.ok(late.times.length <= 1 && late.times[0] >= 10);
  assert.equal(swingOffset(1, 0.1, 0.1), 0.010000000000000002);
  assert.equal(swingOffset(2, 0.1, 0.1), 0);
});

// --- Emplacements des sources ---
// Faux tracé (cercle de 400 m de rayon) : mêmes méthodes que Track, sans Three.js.
function fakeTrack(course) {
  const R = 400;
  const L = 2 * Math.PI * R;
  const mod = (a) => ((a % L) + L) % L;
  const frac = (s) => mod(s) / L;
  const gradeAt = (s) => {
    const u = frac(s);
    let g = 0;
    for (let i = 1; i < course.profile.length; i++) {
      const [u0, g0] = course.profile[i - 1];
      const [u1, g1] = course.profile[i];
      if (u >= u0 && u <= u1) g = g0 + ((g1 - g0) * (u - u0)) / Math.max(1e-6, u1 - u0);
    }
    return g;
  };
  return {
    course,
    length: L,
    minY: 0,
    bounds: { minX: -R, maxX: R, minZ: -R, maxZ: R },
    frame(s, lat = 0, out = {}) {
      const a = (mod(s) / R);
      const tx = -Math.sin(a);
      const tz = Math.cos(a);
      out.tx = tx;
      out.tz = tz;
      out.rx = -tz;
      out.rz = tx;
      out.x = R * Math.cos(a) + out.rx * lat;
      out.z = R * Math.sin(a) + out.rz * lat;
      out.y = 0;
      out.grade = gradeAt(s);
      return out;
    },
    gradeAt,
    surfaceAt(s) {
      const u = frac(s);
      for (const [a, b, t] of course.surfaces || []) if (u >= a && u < b) return t;
      return 'asphalt';
    },
    nearest(x, z) {
      const d = Math.abs(Math.hypot(x, z) - R);
      return { index: 0, dist: d, y: 0 };
    },
  };
}

test('sources : ferme loin du lac, troupeaux à cloches, église, rivage, spectateurs', () => {
  const vallee = soundSpots(fakeTrack(COURSES.vallee));
  assert.ok(vallee.farm && vallee.farm.points.length >= 12);
  assert.ok(vallee.lake, 'lac trouvé au centre');
  const dFarm = Math.hypot(vallee.farm.center.x - vallee.lake.x, vallee.farm.center.z - vallee.lake.z);
  assert.ok(dFarm > 400, `ferme du côté opposé au lac (${dFarm.toFixed(0)} m)`);
  const col = soundSpots(fakeTrack(COURSES.col));
  assert.equal(col.cows.length, 3);
  const bells = col.cows.flatMap((h) => h.bells);
  assert.equal(new Set(bells).size, 12, 'douze cloches toutes différentes');
  for (const f of bells) assert.ok(f >= 400 && f <= 1100);
  assert.ok(col.church && col.fountain && col.stream);
  assert.ok(col.church.y > 10, 'cloche dans le clocher');
  const plage = soundSpots(fakeTrack(COURSES.plage));
  assert.ok(plage.coast && plage.beach);
  assert.equal(plage.coast.z, 326);
  assert.equal(coastZ({ z: 326 }, 0), 326 + 4 * Math.sin(1));
  for (const sp of [vallee, col, plage]) {
    assert.equal(sp.crowds.filter((c) => c.kind === 'start').length, 2);
  }
  assert.ok(col.crowds.filter((c) => c.kind === 'climb').length >= 3, 'public sur les montées du col');
  const row = rowingSpots(1000);
  assert.equal(row.stand.z, 990);
  assert.ok(row.stand.x > row.bank);
});

// --- Sons calculés : analyse ---
test('sonnaille : partiels inharmoniques (1, 1,59, 2,14...) et double coup', () => {
  const f0 = 600;
  const buf = V.renderCowbell(SR, rng(1), { f0 });
  const len = Math.round(SR * 0.5);
  const at = (f) => goertzel(buf, SR, f, 0, len);
  for (const q of [1, 1.59, 2.14]) assert.ok(at(f0 * q) > at(f0 * (q + 0.25)) * 5, `partiel ${q}`);
  // Les aigus s'éteignent avant le fondamental
  const late = Math.round(SR * 0.6);
  const ratioEarly = goertzel(buf, SR, f0 * 2.68, 0, 4800) / goertzel(buf, SR, f0, 0, 4800);
  const ratioLate = goertzel(buf, SR, f0 * 2.68, late, 4800) / goertzel(buf, SR, f0, late, 4800);
  assert.ok(ratioLate < ratioEarly * 0.5);
  assert.ok(peak(buf) <= 0.86);
});

test('cloche d’église : bourdon à l’octave grave et tierce mineure', () => {
  const nominal = 440;
  const buf = V.renderChurchBell(SR, rng(2), { nominal });
  const win = [Math.round(SR * 0.2), Math.round(SR * 0.5)];
  const at = (f) => goertzel(buf, SR, f, win[0], win[1]);
  assert.ok(at(220) > at(250) * 10, 'bourdon (hum)');
  assert.ok(at(nominal * 1.19) > at(nominal * 1.3) * 10, 'tierce mineure');
  assert.ok(rms(buf, SR * 5, SR * 6) > 0.002, 'résonne longtemps');
});

test('eau : bulles de Minnaert entre 300 Hz et 2,6 kHz, boucle sans raccord', () => {
  const buf = V.renderBubbles(SR, rng(3), { seconds: 2, rate: 200, fmin: 300, fmax: 2600 });
  const mid = bandEnergy(buf, SR, 300, 2600);
  const top = bandEnergy(buf, SR, 6000, 12000);
  assert.ok(mid > top * 20);
  const p = pink(SR, rng(4), true);
  const jump = Math.abs(p[p.length - 1] - p[0]);
  let typical = 0;
  for (let i = 1; i < p.length; i++) typical += Math.abs(p[i] - p[i - 1]);
  typical /= p.length - 1;
  assert.ok(jump < typical * 5, `bruit rose en boucle : pas de saut au raccord (${jump} contre ${typical})`);
  const b = brown(SR, rng(5), true);
  assert.ok(Math.abs(b[b.length - 1] - b[0]) < 0.05);
});

test('réverbération de montagne : vrais échos après la queue', () => {
  const ir = S.renderImpulse(SR, rng(6), 'alpine');
  const e = (t0, t1) => rms(ir.l, Math.round(t0 * SR), Math.round(t1 * SR));
  assert.ok(e(0.37, 0.43) > e(0.3, 0.36) * 1.3, 'écho vers 0,38 s');
  assert.ok(e(0.02, 0.1) > e(1.5, 1.6) * 5, 'la queue décroît');
  const meadow = S.renderImpulse(SR, rng(6), 'meadow');
  assert.ok(meadow.l.length < ir.l.length, 'prairie : réverbération plus courte');
});

test('foule : voix à formants en stéréo, applaudissements', async () => {
  const sr = 22050;
  const crowd = await V.renderCrowd(sr, rng(7), { seconds: 2, voices: 12, yieldFn: null });
  assert.equal(crowd.l.length, sr * 2);
  const voice = bandEnergy(crowd.l, sr, 300, 3000);
  const sub = bandEnergy(crowd.l, sr, 30, 80);
  assert.ok(voice > sub * 10);
  assert.ok(rms(crowd.l) > 0.02 && rms(crowd.r) > 0.02);
  let diff = 0;
  for (let i = 0; i < crowd.l.length; i += 7) diff += Math.abs(crowd.l[i] - crowd.r[i]);
  assert.ok(diff > 1, 'gauche et droite différentes (largeur)');
  const claps = await V.renderApplause(32000, rng(8), { seconds: 2, clappers: 10, yieldFn: null });
  assert.ok(rms(claps.l) > 0.01);
});

test('effets : départ, objets, kayak, tous calculés sans valeur invalide ni saturation', async () => {
  const quick = Object.keys(RENDERERS).filter((n) => !['crowd', 'applause', 'water', 'insects', 'lapping', 'impulse', 'noise', 'church', 'fanfare', 'sting', 'song'].includes(n));
  for (const name of quick) {
    const opts = name === 'drum' ? { kind: 'snare' } : name === 'note' ? { instrument: 'pluck', midi: 60 } : name === 'ui' ? { kind: 'confirm' } : {};
    const { channels, sampleRate } = await renderSound(name, SR, 1, opts);
    assert.ok([SR, 32000, 22050].includes(sampleRate), `${name} : ${sampleRate} Hz`);
    for (const c of channels) {
      assert.ok(c.length > 100, name);
      let bad = false;
      for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i])) bad = true;
      assert.ok(!bad, `${name} : valeur invalide`);
      assert.ok(peak(c) <= 0.95, `${name} : crête ${peak(c)}`);
      assert.ok(rms(c) > 0.003, `${name} : silencieux`);
    }
  }
});

test('effets : bip du compte à rebours à 660 Hz, corne grave et riche, porte de kayak claire', () => {
  const beep = S.renderBeep(SR, rng(1), { f: 660 });
  assert.ok(goertzel(beep, SR, 660, 0, 4800) > goertzel(beep, SR, 900, 0, 4800) * 20);
  const horn = S.renderHorn(SR, rng(1));
  assert.ok(bandEnergy(horn, SR, 300, 2500) > bandEnergy(horn, SR, 5000, 12000) * 5);
  const ding = S.renderGateDing(SR, rng(1));
  assert.ok(goertzel(ding.l, SR, 1568, 0, 9600) > goertzel(ding.l, SR, 1300, 0, 9600) * 10);
});

test('filtre biquad : passe-bas atténue les aigus, sinus amorti décroît', () => {
  const f = new Filter('lowpass', 500, 0.707, SR);
  const n = 4800;
  const hi = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 8000 * i) / SR));
  f.run(hi);
  assert.ok(rms(hi, 1000) < 0.01);
  const out = new Float32Array(SR);
  addDecaySine(out, 0, SR, 1000, 1, 20, SR);
  assert.ok(rms(out, 0, 4800) > rms(out, SR - 4800, SR) * 50);
  assert.ok(Math.abs(dominantFreq(out, SR, 0, 2048, 500, 2000) - 1000) < 40);
});
