// Son du jeu (game/audio/) : réglages, hasard, chants d'oiseaux, revêtements, musique procédurale,
// emplacements des sources, et analyse spectrale des sons calculés. Lancer : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, BUSES, STORAGE_KEY, SETTINGS_VERSION, normalizeSettings, loadSettings, saveSettings, volumeToGain, busGain, stepVolume, percentLabel } from '../game/audio/settings.js';
import { rng, hashSeed, nextDelay, EventClock, Wander, weighted } from '../game/audio/random.js';
import { BIRDS, SCENE_BIRDS, birdSong, contour, songDuration, surfaceMix, tyreParams, freewheelRate, isCoasting, chainMeshRate, countdownStep, passEvent, breathing, musicIntensity, crowdExcitement } from '../game/audio/patterns.js';
import { makeSong, layerLevel, layerGains, planBars, nextSection, parseChord, voiceChord, tokens, scaleNote, songBytes, SCALES, MOODS, LAYERS, MUSIC_SR, SKIP_BRIDGE } from '../game/audio/music-gen.js';
import { renderMusicPart, mixdown, PART_ORDER, LAYER_TARGET } from '../game/audio/music-render.js';
import { moodFor, MUSIC_PARTS, MUSIC_BUDGET } from '../game/audio/music.js';
import { soundSpots, rowingSpots, coastZ } from '../game/audio/spots.js';
import { bandEnergy, goertzel, dominantFreq, peak, rms, pink, brown, Filter, addDecaySine, loudness } from '../game/audio/dsp.js';
import { distanceCutoff } from '../game/audio/engine.js';
import { SFX } from '../game/audio/index.js';
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
  assert.deepEqual({ ...DEFAULTS }, { master: 80, music: 35, ambience: 60, sfx: 70, ui: 45, muted: false, windNoise: false });
  assert.deepEqual(loadSettings(memStorage()), { ...DEFAULTS });
});

test('réglages : JSON abîmé, valeurs hors bornes, stockage indisponible', () => {
  assert.deepEqual(normalizeSettings({ master: 140, music: -5, ambience: '35', sfx: 'abc', muted: 'oui' }), { master: 100, music: 0, ambience: 35, sfx: 70, ui: 45, muted: false, windNoise: false });
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
  assert.equal(JSON.parse(st.map.get(STORAGE_KEY)).v, SETTINGS_VERSION, 'version du format enregistrée');
});

test('réglages : migration des anciennes valeurs par défaut, choix du joueur conservés', () => {
  const st = memStorage();
  // Ancien format (sans version) resté aux anciennes valeurs par défaut : nouvelles valeurs par défaut
  st.setItem(STORAGE_KEY, JSON.stringify({ master: 80, music: 50, ambience: 70, sfx: 80, ui: 60, muted: false }));
  assert.deepEqual(loadSettings(st), { ...DEFAULTS });
  // Ancien format avec des curseurs déplacés : ceux-là restent, les autres passent aux nouvelles valeurs
  st.setItem(STORAGE_KEY, JSON.stringify({ master: 65, music: 25, ambience: 70, sfx: 90, ui: 60, muted: true, windNoise: true }));
  assert.deepEqual(loadSettings(st), { master: 65, music: 25, ambience: 60, sfx: 90, ui: 45, muted: true, windNoise: true });
  // Format actuel : rien n'est touché, même une valeur égale à un ancien défaut
  st.setItem(STORAGE_KEY, JSON.stringify({ v: SETTINGS_VERSION, master: 80, music: 50, ambience: 70, sfx: 80, ui: 60, muted: false }));
  assert.deepEqual(loadSettings(st), { master: 80, music: 50, ambience: 70, sfx: 80, ui: 60, muted: false, windNoise: false });
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
const RACE_MOODS = ['meadow', 'alpine', 'coast', 'lake', 'river', 'forest'];

test('musique : accords en degrés romains et voicings conduits', () => {
  assert.deepEqual(parseChord('IVmaj7').tones, [5, 9, 12, 16]);
  assert.deepEqual(parseChord('vi7').tones, [9, 12, 16, 19]);
  assert.deepEqual(parseChord('bVII').tones, [10, 14, 17]);
  assert.deepEqual(parseChord('i9').tones, [0, 3, 7, 10, 14]);
  assert.deepEqual(parseChord('V7sus4').tones, [7, 12, 14, 17]);
  assert.equal(parseChord('I/3').bass, 4);
  assert.throws(() => parseChord('X7'));
  // Voicing dans la tessiture, notes de l'accord, peu de mouvement d'un accord au suivant
  const c = voiceChord(parseChord('I').tones, 60, { voices: 4, range: [55, 76] });
  assert.equal(c.length, 4);
  for (const m of c) assert.ok(m >= 55 && m <= 76 && [0, 4, 7].includes(m % 12));
  const f = voiceChord(parseChord('IV').tones, 60, { voices: 4, range: [55, 76] }, c);
  const moved = f.reduce((n, m, i) => n + Math.abs(m - c[i]), 0);
  assert.ok(moved <= 6, `conduite des voix : ${moved} demi-tons de mouvement`);
  assert.deepEqual(tokens('1-3.5--').map((t) => [t.s, t.len, t.ch]), [[0, 2, '1'], [2, 1, '3'], [4, 3, '5']]);
  assert.equal(scaleNote(SCALES.major, 60, 7), 72);
  assert.equal(scaleNote(SCALES.major, 60, -1), 59);
});

test('musique : chaque niveau a son morceau, ses notes dans la gamme et ses accords sur les barres de mesure', () => {
  const songs = [...RACE_MOODS, 'menu'].map((k) => makeSong(k));
  assert.ok(new Set(songs.map((s) => `${s.key}/${Math.round(s.bpm)}/${s.mode}`)).size >= 6);
  assert.deepEqual(makeSong('alpine'), makeSong('alpine'), 'reproductible');
  assert.equal(makeSong('inconnu').mood, 'meadow');
  assert.ok(makeSong('menu').bpm < 90, 'musique du menu plus calme');
  for (const s of songs) {
    assert.ok(Number.isInteger(s.barLen) && Math.abs(s.barSec - 240 / s.bpm) < 1e-9, `${s.mood} : mesure entière en échantillons`);
    assert.ok(Math.abs(s.bpm - MOODS[s.mood].bpm) < 0.01);
    const pcs = new Set(s.scale.map((x) => (x + s.key) % 12));
    const inScale = (m) => pcs.has(((m % 12) + 12) % 12);
    let strong = 0;
    let strongOk = 0;
    for (const name of s.form) {
      const sec = s.sections[name];
      for (const layer of LAYERS) {
        assert.equal(sec.layers[layer].length, sec.bars);
        sec.layers[layer].forEach((id, b) => {
          if (!id) return;
          const cell = s.cells[id];
          for (const e of cell.events) {
            // Rien avant la barre de mesure, rien après la fin de la cellule
            assert.ok(e.t >= 0 && e.t < cell.bars * 16 + 0.5, `${s.mood} ${id} : note à ${e.t}`);
            const notes = e.notes || (e.m !== undefined ? [e.m] : []);
            for (const m of notes) assert.ok(inScale(m), `${s.mood} ${name} ${layer} : ${m} hors gamme`);
            // Nappe, claviers : uniquement les notes de l'accord de la mesure où la note commence
            const chord = parseChord(sec.prog[b + Math.floor(e.t / 16)]);
            const tones = new Set(chord.tones.map((t) => (t + s.key) % 12));
            if (layer === 'pad' || layer === 'keys') for (const m of notes) assert.ok(tones.has(m % 12), `${s.mood} ${name} ${layer} : ${m} hors accord ${sec.prog[b]}`);
            // Mélodie : aux temps forts (1 et 3), une note de l'accord le plus souvent
            if (layer === 'lead' && Math.abs(e.t - 8 * Math.round(e.t / 8)) < 0.2) {
              strong++;
              if (tones.has(e.m % 12)) strongOk++;
            }
          }
        });
      }
    }
    if (strong) assert.ok(strongOk / strong >= 0.6, `${s.mood} : mélodie sur les notes de l'accord aux temps forts (${strongOk}/${strong})`);
  }
});

test('musique : couches selon l’intensité, forme et horloge des mesures', () => {
  const s = makeSong('lake');
  const at = (x) => layerGains(s, x);
  // Compte à rebours : nappe et claviers ; effort normal : basse, groove ; turbo : tout
  assert.ok(at(0.6).pad > 0.9 && at(0.6).keys > 0.5 && at(0.6).bass === 0 && at(0.6).drums === 0);
  assert.ok(at(1.8).bass === 1 && at(1.8).groove > 0.9 && at(1.8).drums === 0);
  assert.ok(at(3).drums === 1 && at(3).lead === 1 && at(3).pad < 1);
  assert.equal(layerLevel(0, 'pad'), 1);
  // Les gains ne sautent jamais : un pas d'intensité de 0,05 ne fait bouger aucune couche de plus de 0,2
  for (let x = 0; x < 3; x += 0.05) for (const l of LAYERS) assert.ok(Math.abs(at(x + 0.05)[l] - at(x)[l]) < 0.2);
  // Forme : intro une fois, puis A B A2 B2 C en boucle ; pont sauté quand l'effort est fort
  const iC = s.form.indexOf('C');
  assert.equal(nextSection(s, iC - 1, 1), iC);
  assert.equal(s.form[nextSection(s, iC - 1, SKIP_BRIDGE + 0.2)], 'A');
  assert.equal(s.form[nextSection(s, s.form.length - 1, 1)], 'A');
  // Menu : tout joue à l'accueil (intensité 1), pas de batterie
  const menu = makeSong('menu');
  const g = layerGains(menu, 1);
  assert.ok(g.keys === 1 && g.bass === 1 && g.lead > 0.5 && g.drums === 0);
  // Horloge : des mesures régulières, aucune en double ; après une suspension, recalage sans rafale
  let next = 1;
  const all = [];
  for (let now = 0.9; now < 12; now += 0.05) {
    const res = planBars(now, next, s.barSec, 0.6);
    all.push(...res.times);
    next = res.next;
  }
  for (let i = 1; i < all.length; i++) assert.ok(Math.abs(all[i] - all[i - 1] - s.barSec) < 1e-9);
  const late = planBars(30, 5, s.barSec, 0.6);
  assert.ok(late.resync && late.times.length <= 1 && late.times[0] >= 30);
  // Décors : chaque thème de circuit a son ambiance, le menu la sienne
  assert.equal(moodFor('forest'), 'forest');
  assert.equal(moodFor('river'), 'river');
  assert.equal(moodFor('alpine', 'menu'), 'menu');
  assert.equal(moodFor('inconnu'), 'meadow');
  assert.deepEqual(MUSIC_PARTS.filter((p) => p !== 'verb').sort(), [...PART_ORDER].sort());
});

// Rendu complet de chaque morceau (une seule fois pour les tests suivants)
const rendered = new Map();
async function renderAll(mood) {
  if (rendered.has(mood)) return rendered.get(mood);
  const song = makeSong(mood);
  const cells = new Map();
  const parts = {};
  let bytes = 0;
  const t0 = performance.now();
  for (const part of [...PART_ORDER, 'verb']) {
    const res = await renderMusicPart(48000, { mood, part });
    parts[part] = res;
    for (const c of res.channels) bytes += c.length * 4;
    if (part !== 'verb') for (const c of res.meta.cells) cells.set(c.id, { l: res.channels[c.ch], r: c.n > 1 ? res.channels[c.ch + 1] : null });
  }
  const out = { song, cells, parts, bytes, ms: performance.now() - t0 };
  rendered.set(mood, out);
  return out;
}

test('musique : rendu hors ligne propre (pas de valeur invalide, bords sans clic, mémoire et temps contenus)', async () => {
  let total = 0;
  for (const mood of [...RACE_MOODS, 'menu']) {
    const { song, cells, parts, bytes, ms } = await renderAll(mood);
    total += ms;
    assert.ok(bytes <= 32 * 1048576, `${mood} : ${(bytes / 1048576).toFixed(1)} Mo de cellules`);
    assert.ok(Math.abs(bytes - songBytes(song) - parts.verb.channels[0].length * 8) < 1024, 'estimation de la mémoire juste');
    assert.ok(ms < 6000, `${mood} : rendu en ${ms.toFixed(0)} ms`);
    assert.equal(cells.size, Object.keys(song.cells).length, `${mood} : toutes les cellules rendues`);
    for (const [id, c] of cells) {
      for (const ch of c.r ? [c.l, c.r] : [c.l]) {
        let bad = 0;
        let sum = 0;
        for (let i = 0; i < ch.length; i++) {
          if (!Number.isFinite(ch[i])) bad++;
          sum += ch[i];
        }
        assert.equal(bad, 0, `${mood} ${id} : valeur invalide`);
        assert.ok(peak(ch) <= 0.72, `${mood} ${id} : crête ${peak(ch)}`);
        // La cellule démarre sur la barre en partant du silence (attaques adoucies) et finit à zéro
        assert.ok(Math.abs(ch[0]) < 0.02, `${mood} ${id} : début ${ch[0]}`);
        assert.ok(Math.abs(ch[ch.length - 1]) < 1e-4, `${mood} ${id} : fin ${ch[ch.length - 1]}`);
        assert.ok(Math.abs(sum / ch.length) < 0.003, `${mood} ${id} : composante continue`);
      }
    }
    // Réverbération : énergie unitaire, aucun grave (la basse reste nette)
    const ir = parts.verb.channels[0];
    let e = 0;
    for (const x of ir) e += x * x;
    assert.ok(Math.abs(e - 1) < 0.01);
    assert.ok(bandEnergy(ir, 48000, 40, 100) < bandEnergy(ir, 48000, 500, 2000) * 0.1);
  }
  // Mémoire : le lecteur ne garde que ce qui tient dans le budget de l'iPad (un morceau de course et, s'il
  // reste de la place, celui du menu) ; le plus gros morceau y tient largement, le menu est léger
  const sizes = [...RACE_MOODS, 'menu'].map((m) => rendered.get(m).bytes);
  assert.ok(Math.max(...sizes) < MUSIC_BUDGET * 0.82);
  assert.ok(rendered.get('menu').bytes < 20 * 1048576, 'menu léger');
  assert.ok(total < 20000, `rendu de tous les morceaux : ${total.toFixed(0)} ms`);
});

test('musique : mélange sans saturation ni aigus, sonie égale d’un niveau à l’autre, raccords invisibles', async () => {
  const lufs = [];
  for (const mood of [...RACE_MOODS, 'menu']) {
    const { song, cells } = await renderAll(mood);
    const bars = song.form.reduce((n, k) => n + song.sections[k].bars, 0) + 4;
    const x = mood === 'menu' ? 1 : 3;
    const m = mixdown(song, cells, { intensity: x, bars });
    const pk = Math.max(peak(m.l), peak(m.r));
    assert.ok(pk < 0.75, `${mood} : crête ${pk.toFixed(2)} (marge pour la réverbération)`);
    // Peu d'énergie au-dessus de 6 kHz : rien de perçant pendant 40 minutes
    const air = 10 * Math.log10(bandEnergy(m.l, MUSIC_SR, 6000, 14000, 24) / bandEnergy(m.l, MUSIC_SR, 200, 2000, 24));
    assert.ok(air < -18, `${mood} : 6-14 kHz à ${air.toFixed(1)} dB du médium`);
    // Raccords : aux barres de mesure (où les cellules s'enchaînent), pas de saut plus fort qu'ailleurs
    let inside = 0;
    for (let i = 1; i < m.length; i++) inside = Math.max(inside, Math.abs(m.l[i] - m.l[i - 1]));
    let seam = 0;
    for (let b = 1; b < bars; b++) for (let i = b * song.barLen - 32; i < b * song.barLen + 32; i++) seam = Math.max(seam, Math.abs(m.l[i] - m.l[i - 1]));
    assert.ok(seam <= inside, `${mood} : raccord ${seam} contre ${inside}`);
    let dc = 0;
    for (let i = 0; i < m.length; i++) dc += m.l[i];
    assert.ok(Math.abs(dc / m.length) < 1e-3);
    if (mood !== 'menu') {
      const mm = mixdown(song, cells, { intensity: 2.2, bars });
      lufs.push([mood, loudness(mm.l, mm.r, MUSIC_SR, 0, mm.length)]);
    }
  }
  const mean = lufs.reduce((n, [, l]) => n + l, 0) / lufs.length;
  for (const [mood, l] of lufs) assert.ok(Math.abs(l - mean) < 1.5, `${mood} : ${l.toFixed(1)} LUFS (moyenne ${mean.toFixed(1)})`);
  // Chaque couche est égalisée à sa sonie cible sur sa section de référence
  const { song, cells } = await renderAll('coast');
  const B = song.form.indexOf('B');
  const lead = mixdown(song, cells, { intensity: 3, bars: 8, from: B, weights: { lead: 1 } });
  assert.ok(Math.abs(loudness(lead.l, lead.r, MUSIC_SR, 0, lead.length) - LAYER_TARGET.lead) < 1, 'mélodie à sa sonie cible');
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
  const quick = Object.keys(RENDERERS).filter((n) => !['crowd', 'applause', 'water', 'insects', 'lapping', 'impulse', 'noise', 'church', 'fanfare', 'sting', 'song', 'music'].includes(n));
  for (const name of quick) {
    const opts = name === 'ui' ? { kind: 'confirm' } : {};
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
  assert.ok(goertzel(ding.l, SR, 784, 0, 9600) > goertzel(ding.l, SR, 650, 0, 9600) * 10, 'porte : sol 5 (784 Hz), registre médium');
});

// --- Qualité : sons doux, sans clic ni souffle aigu ---
// Énergie relative (dB) d'une bande par rapport à 200-2000 Hz.
const relBand = (buf, sr, f0, f1) => 10 * Math.log10(bandEnergy(buf, sr, f0, f1, 24) / bandEnergy(buf, sr, 200, 2000, 24));

test('qualité : chaque effet commence et finit en douceur, sans composante continue', async () => {
  // Les nappes jouées en boucle (eau, pluie…) se raccordent sans fondu : elles sont exclues.
  const names = Object.keys(RENDERERS).filter((n) => !['crowd', 'applause', 'impulse', 'noise', 'water', 'lapping', 'insects', 'crunch', 'rain', 'music'].includes(n));
  for (const name of names) {
    const opts = name === 'ui' ? { kind: 'tick' } : name === 'song' ? { species: 'robin' } : name === 'church' ? { nominal: 440, dur: 3 } : {};
    const { channels } = await renderSound(name, SR, 3, opts);
    for (const c of channels) {
      const edge = Math.max(Math.abs(c[0]), Math.abs(c[c.length - 1]));
      assert.ok(edge < 0.01, `${name} : bord ${edge.toFixed(4)} (clic)`);
      let m = 0;
      for (let i = 0; i < c.length; i++) m += c[i];
      assert.ok(Math.abs(m / c.length) < 0.01, `${name} : composante continue ${(m / c.length).toFixed(4)}`);
      // Aucun saut d'un échantillon à l'autre plus grand que la moitié de la crête (attaques adoucies) ;
      // les chants d'oiseaux et le cri du rapace, sons aigus, varient naturellement vite d'un échantillon au suivant.
      if (name === 'song' || name === 'raptor') continue;
      let jump = 0;
      for (let i = 1; i < c.length; i++) jump = Math.max(jump, Math.abs(c[i] - c[i - 1]));
      assert.ok(jump < peak(c) * 0.5, `${name} : saut ${(jump / peak(c)).toFixed(2)} de la crête`);
    }
  }
});

test('qualité : effets du jeu et interface ronds (peu d’énergie au-dessus de 6 kHz, rien de perçant)', async () => {
  const soft = ['beep', 'horn', 'pickup', 'turbo', 'banana', 'skid', 'bump', 'whoosh', 'lap', 'finalLap', 'fanfare', 'gear', 'gateDing', 'gateBuzz', 'sprintWhoosh', 'sprintFail', 'kayakSplash', 'splash', 'paddle', 'drips', 'oarlock', 'breath'];
  for (const name of soft) {
    const { channels, sampleRate } = await renderSound(name, SR, 5, {});
    const c = channels[0];
    const air = relBand(c, sampleRate, 6000, 15000);
    assert.ok(air < -18, `${name} : 6-15 kHz à ${air.toFixed(1)} dB du médium`);
  }
  for (const kind of ['tick', 'confirm', 'back', 'open', 'close']) {
    const u = S.renderUi(SR, rng(2), { kind });
    assert.ok(relBand(u.l || u, SR, 2500, 8000) < -10, `interface ${kind} : haut médium contenu`);
  }
  // Bip du compte à rebours : court, ne dure pas plus d'une demi-seconde audible
  const beep = S.renderBeep(SR, rng(1), { f: 660 });
  assert.ok(rms(beep, Math.round(SR * 0.45)) < rms(beep, 0, Math.round(SR * 0.1)) * 0.1);
});

test('qualité : nappes chaudes (bruits filtrés), insectes et gravier sans souffle aigu', async () => {
  const crunch = V.renderCrunch(32000, rng(1), { seconds: 2 });
  assert.ok(relBand(crunch, 32000, 6000, 15000) < -15, 'gravier : pas de chuintement aigu');
  const ins = V.renderInsects(32000, rng(2), { seconds: 4, kind: 'meadow' });
  assert.ok(relBand(ins.l, 32000, 9000, 15000) < relBand(ins.l, 32000, 4000, 8000) - 10, 'insectes : rien au-dessus de 9 kHz');
  const splash = V.renderSplash(SR, rng(3), {});
  assert.ok(relBand(splash, SR, 6000, 15000) < -18, 'éclaboussure naturelle, pas sifflante');
  const crowd = await V.renderCrowd(22050, rng(4), { seconds: 2, voices: 12, yieldFn: null });
  assert.ok(relBand(crowd.l, 22050, 4000, 10000) < -20, 'foule chaude');
});

test('qualité : distance, musique posée, effets plus doux que les anciens réglages', () => {
  // Absorption de l'air : la coupure baisse avec la distance, sans descendre sous 1,2 kHz
  let prev = Infinity;
  for (const d of [0, 15, 30, 60, 120, 400]) {
    const f = distanceCutoff(d);
    assert.ok(f <= prev && f >= 1200);
    prev = f;
  }
  assert.ok(distanceCutoff(10) > 15000 && distanceCutoff(60) < 8000);
  // Effort normal : nappe, claviers, basse et groove léger, sans la batterie ; batterie entière au turbo
  const x = musicIntensity({ time: 10, power: 250, speed: 9 });
  assert.ok(layerLevel(x, 'drums') === 0 && layerLevel(x, 'keys') > 0.9 && layerLevel(x, 'groove') > 0.5, `intensité ${x}`);
  assert.equal(layerLevel(musicIntensity({ time: 10, power: 50, turbo: true }), 'drums'), 1);
  // Aucun effet amplifié, la musique se met en retrait sous les effets importants
  for (const [k, def] of Object.entries(SFX)) assert.ok((def.gain ?? 0.6) <= 1, `${k} : gain ${def.gain}`);
  assert.ok(SFX.pickup.duck && SFX.lap.duck && !SFX.gear.duck);
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
