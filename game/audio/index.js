// Son du jeu : point d'entrée unique. Tout est synthétisé (Web Audio + calcul dans un Worker), aucun fichier.
//
//   const audio = createAudio({ quality });
//   audio.update({ dt, mode, state, camera, track, race, rowing, gear });  // une fois par image
//   audio.sfx('gate-pass');  audio.setScene('river');  audio.ui('confirm');
//
// update() suit tout seul les changements d'état (accueil, course, pause, arrivée), de circuit et de mode,
// s'abonne aux événements de la course (départ, objets, bananes, tours, arrivée) et pilote les sons du
// joueur, des adversaires, de la foule, de l'ambiance et de la musique. Sans Web Audio : rien, sans erreur.
import { AudioEngine } from './engine.js';
import { Ambience } from './ambience.js';
import { Crowds, excitementFor } from './crowd.js';
import { BikeSounds, RowSounds, RivalBikes, RivalBoats, HullSounds } from './player.js';
import { Music } from './music.js';
import { soundSpots, rowingSpots } from './spots.js';
import { countdownStep, passEvent, musicIntensity } from './patterns.js';
import { bindVolumeControls } from './ui.js';
import { WeatherSounds } from './weather.js';

// Effets disponibles par sfx(nom, options) : rendu, options du rendu, niveau, bus, réverbération.
export const SFX = {
  beep: { r: 'beep', o: { f: 660 }, gain: 0.55 },
  go: { r: 'beep', o: { f: 1320, dur: 0.5 }, gain: 0.55 },
  horn: { r: 'horn', gain: 0.5, wet: 0.35 },
  whistle: { r: 'whistle', gain: 0.4, wet: 0.2 },
  pickup: { r: 'pickup', gain: 0.6 },
  turbo: { r: 'turbo', gain: 0.65 },
  banana: { r: 'banana', gain: 0.7 },
  skid: { r: 'skid', gain: 0.6 },
  bump: { r: 'bump', gain: 0.7 },
  whoosh: { r: 'whoosh', o: (x) => ({ dir: x.dir < 0 ? -1 : 1 }), gain: 0.5 },
  lap: { r: 'lap', gain: 0.55, wet: 0.25 },
  'final-lap': { r: 'finalLap', gain: 0.6, wet: 0.25 },
  fanfare: { r: 'fanfare', gain: 0.65, wet: 0.3, priority: 3 },
  win: { r: 'sting', o: { kind: 'win' }, gain: 0.6, bus: 'music', priority: 3 },
  podium: { r: 'sting', o: { kind: 'podium' }, gain: 0.6, bus: 'music', priority: 3 },
  'finish-other': { r: 'sting', o: { kind: 'other' }, gain: 0.6, bus: 'music', priority: 3 },
  gear: { r: 'gear', gain: 0.45 },
  splash: { r: 'splash', gain: 0.6, pool: true },
  // Kayak (mode en préparation)
  paddle: { r: 'paddle', gain: 0.6, pool: true, pan: (x) => (x.side === 'left' ? -0.5 : x.side === 'right' ? 0.5 : 0) },
  'gate-pass': { r: 'gateDing', gain: 0.6, wet: 0.3 },
  'gate-miss': { r: 'gateBuzz', gain: 0.45 },
  'sprint-gate': { r: 'sprintWhoosh', gain: 0.6, wet: 0.2 },
  'sprint-fail': { r: 'sprintFail', gain: 0.65 },
  whirlpool: { r: 'whirlpool', o: (x) => ({ dur: Math.max(1, Math.min(6, Math.round(x.duration || 2.5))) }), gain: 0.6, wet: 0.3 },
  'kayak-splash': { r: 'kayakSplash', gain: 0.6, pool: true },
  // Nature, utilisables par d'autres modes
  cow: { r: 'cow', gain: 0.6, pool: true, bus: 'ambience' },
  sheep: { r: 'sheep', gain: 0.6, pool: true, bus: 'ambience' },
  duck: { r: 'duck', gain: 0.6, pool: true, bus: 'ambience' },
  gull: { r: 'gull', gain: 0.6, pool: true, bus: 'ambience' },
  'church-bell': { r: 'church', o: { nominal: 440 }, gain: 0.7, wet: 0.5, bus: 'ambience' },
  // Météo : tonnerre (near 0.7 = proche avec craquement, 0.3 = lointain)
  thunder: { r: 'thunder', o: (x) => ({ near: x.near > 0.5 ? 0.7 : 0.3 }), gain: 0.75, wet: 0.45, bus: 'ambience', pool: true },
};

const UI_SOUNDS = { focus: 'tick', confirm: 'confirm', back: 'back', open: 'open', close: 'close', slider: 'tick' };
const PRELOAD = ['tick', 'confirm', 'back', 'open', 'close'];

export function createAudio(opts = {}) {
  return new GameAudio(opts);
}

class GameAudio {
  constructor({ quality = 'high', touch = false, storage, controls = typeof document !== 'undefined' ? document : null } = {}) {
    this.engine = new AudioEngine({ quality, touch, storage });
    this.available = this.engine.available;
    this.state = null;
    this.lastInfo = null;
    this.stats = { updates: 0, ms: 0 };
    this.engine.addEventListener('ready', () => this.onReady());
    this.refreshControls = bindVolumeControls(controls, this.engine, (bus, v) => this.preview(bus, v));
    if (typeof window !== 'undefined') {
      // M : couper / rétablir le son (hors champ de texte)
      window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyM' || e.repeat || e.target?.closest?.('input[type="text"], textarea')) return;
        this.engine.setMuted(!this.engine.settings.muted);
      });
    }
  }

  get settings() {
    return this.engine.settings;
  }

  onReady() {
    const e = this.engine;
    this.ambience = new Ambience(e);
    this.crowds = new Crowds(e);
    this.bike = new BikeSounds(e);
    this.row = new RowSounds(e);
    this.rivals = new RivalBikes(e);
    this.boats = new RivalBoats(e);
    this.hull = new HullSounds(e);
    this.music = new Music(e);
    this.weather = new WeatherSounds(e, (n, o) => this.sfx(n, o));
    const b = e.bank;
    for (const k of PRELOAD) b.load('ui', { kind: k }, 3).catch(() => {});
    for (const n of ['beep', 'go', 'horn', 'pickup', 'turbo', 'banana', 'skid', 'bump', 'lap', 'final-lap', 'gear']) this.buffer(n, {}, 2);
    for (const dir of [1, -1]) this.buffer('whoosh', { dir }, 2);
    this.crowds.preload();
    for (const n of ['fanfare', 'win', 'podium', 'finish-other']) this.buffer(n, {}, 0);
    // L'état courant est rejoué à la prochaine image (scène, musique...).
    this.state = null;
  }

  // --- API générique ---
  buffer(name, x = {}, prio = 1) {
    const def = SFX[name];
    if (!def || !this.engine.bank) return null;
    const o = typeof def.o === 'function' ? def.o(x) : def.o || {};
    if (def.pool) return this.engine.bank.pool(def.r, o, 3);
    const got = this.engine.bank.get(def.r, o);
    if (!got && prio !== 1) this.engine.bank.load(def.r, o, prio).catch(() => {});
    return got;
  }

  // Joue un effet : opts { gain, rate, pan, pos: {x,y,z}, when, bus, wet, duration }. Renvoie la voix (stop()) ou null.
  sfx(name, opts = {}) {
    const def = SFX[name];
    if (!def || !this.engine.running) return null;
    const buf = this.buffer(name, opts, 2);
    if (!buf) return null;
    const pan = opts.pan ?? (typeof def.pan === 'function' ? def.pan(opts) : def.pan);
    return this.engine.play(buf, {
      bus: opts.bus || def.bus || 'sfx',
      gain: (def.gain ?? 0.6) * (opts.gain ?? 1),
      rate: opts.rate ?? (def.pool ? 0.94 + Math.random() * 0.12 : 1),
      pan,
      pos: opts.pos,
      ref: opts.ref ?? 6,
      when: opts.when,
      wet: opts.wet ?? def.wet ?? 0,
      priority: opts.priority ?? def.priority ?? 2,
      radius: opts.pos ? opts.radius ?? 120 : undefined,
    });
  }

  // Sons d'interface (menus) : focus, confirm, back, open, close, slider.
  ui(kind, value) {
    const e = this.engine;
    if (!e.running) return;
    const buf = e.bank.get('ui', { kind: UI_SOUNDS[kind] || 'tick' });
    const rate = kind === 'slider' ? 0.75 + (value ?? 50) / 160 : kind === 'focus' ? 0.97 + Math.random() * 0.06 : 1;
    e.play(buf, { bus: 'ui', gain: kind === 'focus' || kind === 'slider' ? 0.5 : 0.6, rate, priority: 2 });
  }

  // Aperçu en bougeant un curseur de volume : un son du bus concerné.
  preview(bus, value) {
    if (bus === 'ui' || bus === 'master') return this.ui('slider', value);
    if (bus === 'sfx') return this.sfx('gear', { gain: 1.2 });
    if (bus === 'ambience') {
      const e = this.engine;
      const buf = e.running && e.bank.pool('song', { species: 'chaffinch' }, 2);
      if (buf) e.play(buf, { bus: 'ambience', gain: 0.5, rate: 0.95 + Math.random() * 0.1 });
    }
  }

  // Décor d'ambiance des autres modes (kayak...) : 'meadow', 'alpine', 'coast', 'lake', 'river'.
  // Les modes vélo et rameur choisissent le leur tout seuls ; null rend la main.
  setScene(name, world = {}) {
    this.forcedScene = name ? { name, world: { id: name, ...world } } : null;
    this.sceneKey = null;
  }

  // Abonnement optionnel (update() le fait aussi tout seul quand la course change).
  attach({ race, rowing } = {}) {
    if (race) this.bindRace(race);
    if (rowing) this.bindRow(rowing);
  }

  // --- Image par image ---
  // info : { dt, mode: 'bike'|'row'|'kayak', state: 'home'|'race'|'paused'|'end', camera, track, race, rowing,
  //          gear, player: { speed } (kayak), scene, weather: { on, rain, wet, wind, head, gust, theme } }
  update(info) {
    const e = this.engine;
    if (!e.ctx || !this.ambience) return;
    const t0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, info.dt ?? 1 / 60));
    if (info.camera) {
      info.camera.updateMatrixWorld?.();
      e.setListener(info.camera.matrixWorld);
    }
    const mode = info.mode || 'bike';
    const state = info.state || 'home';
    this.scene(info, mode);
    e.setPaused(state === 'paused');
    if (mode === 'bike' && info.race && info.race !== this.race) this.bindRace(info.race);
    if (mode === 'row' && info.rowing && info.rowing !== this.rowRace) this.bindRow(info.rowing);
    const race = mode === 'row' ? info.rowing : mode === 'bike' ? info.race : null;
    if (state !== this.state || mode !== this.mode) this.transition(this.state, state, mode, info);
    this.state = state;
    this.mode = mode;

    // Compte à rebours : bips 3, 2, 1 (le « partez » vient de l'événement go)
    if (race && state === 'race') {
      const k = countdownStep(this.lastTime ?? race.time, race.time);
      if (k) this.sfx('beep', { priority: 3 });
    }
    if (race) this.lastTime = race.time;

    const riding = state === 'race' || state === 'end';
    if (mode === 'bike' && race) this.updateBike(dt, info, race, riding, state);
    else {
      this.bike.setActive(false);
      this.rivals.setActive(false);
    }
    if (mode === 'row' && race) this.updateRow(dt, race, riding, state);
    else this.row.setActive(false);
    if (mode === 'kayak' && info.player) this.hull.update(dt, state === 'race' ? info.player.speed || 0 : 0);
    else if (this.hull.ready) this.hull.update(dt, 0);

    if (info.gear !== undefined) {
      if (this.lastGear !== undefined && info.gear !== this.lastGear && state === 'race') this.sfx('gear');
      this.lastGear = info.gear;
    }
    this.ambience.update(dt, { speed: this.speed || 0, state });
    this.weather.update(dt, info.weather, this.speed || 0, state, mode);
    this.stats.updates++;
    this.stats.ms += performance.now() - t0;
  }

  scene(info, mode) {
    let name;
    let world;
    if (this.forcedScene && mode !== 'bike' && mode !== 'row') ({ name, world } = this.forcedScene);
    else if (mode === 'row') {
      const d = info.rowing?.distance ?? 500;
      name = 'lake';
      world = { id: `row${d}`, rowing: rowingSpots(d) };
    } else if (mode === 'kayak') {
      name = info.scene || 'river';
      world = { id: 'kayak' };
    } else if (info.track) {
      const tr = info.track;
      if (this.spotsTrack !== tr) {
        this.spotsTrack = tr;
        this.spots = soundSpots(tr);
      }
      name = tr.course?.theme || 'meadow';
      world = { id: tr.course?.id, spots: this.spots };
    } else return;
    const key = `${name}:${world.id}`;
    if (key === this.sceneKey) return;
    this.sceneKey = key;
    this.theme = name;
    this.ambience.set(name, world);
    if (mode === 'row') this.crowds.setSpots([{ ...world.rowing.stand, kind: 'stand', ref: 24 }]);
    else if (mode === 'bike' && world.spots) this.crowds.setSpots(world.spots.crowds);
    else this.crowds.setSpots([]);
    if (this.state === 'home') this.music.setSong(this.theme, 'menu');
  }

  transition(prev, state, mode, info) {
    const theme = this.theme || 'meadow';
    if (state === 'home') {
      this.music.setSong(theme, 'menu');
    } else if (state === 'race' && prev !== 'paused') {
      // Nouvelle course (depuis l'accueil, l'arrivée ou un autre mode)
      this.music.setSong(theme, 'race');
      this.music.setIntensity(0.6);
      this.finished = false;
      this.lastTime = undefined;
    } else if (state === 'end' && prev !== 'end') {
      const race = mode === 'row' ? info.rowing : info.race;
      const rank = race?.positionOf?.(race.player) ?? 99;
      this.music.stop(0.8);
      setTimeout(() => this.sfx(rank === 1 ? 'win' : rank <= 3 ? 'podium' : 'finish-other'), 250);
      clearTimeout(this.endMusic);
      this.endMusic = setTimeout(() => {
        if (this.state === 'end') this.music.setSong(theme, 'menu');
      }, 4200);
    }
  }

  updateBike(dt, info, race, riding, state) {
    const p = race.player;
    const t = race.time;
    const tr = info.track;
    this.bike.build();
    this.bike.setActive(riding && !!tr);
    this.speed = p.v;
    if (riding && tr) {
      this.bike.update(dt, {
        speed: p.v,
        cadence: p.cadence,
        power: p.power,
        grade: tr.gradeAt(p.s),
        surface: tr.surfaceAt(p.s),
        offRoad: !!p.offRoad,
        turbo: p.turbo(t),
        slip: p.slipping(t),
      });
    }
    // Adversaires proches et dépassements
    this.rivals.setActive(riding);
    const others = [];
    const L = tr?.length || 1;
    this.prevGaps ||= new Map();
    const f = this.tmpFrame || (this.tmpFrame = {});
    for (const r of race.racers) {
      if (r === p) continue;
      const gap = r.s - p.s;
      if (riding && Math.abs(gap) < 40 && tr) {
        tr.frame(r.s, r.lateral, f);
        others.push({ racer: r, pos: { x: f.x, y: f.y + 0.6, z: f.z } });
      }
      const prev = this.prevGaps.get(r);
      this.prevGaps.set(r, gap);
      if (state === 'race' && t > 1 && prev !== undefined) {
        const ev = passEvent(prev, gap, r.lateral - p.lateral);
        if (ev) this.sfx('whoosh', { dir: r.lateral > p.lateral ? 1 : -1, gain: Math.min(1, 0.4 + p.v / 15), pan: r.lateral > p.lateral ? 0.4 : -0.4 });
      }
    }
    void L;
    this.rivals.update(dt, others);
    // Foule : s'anime selon la distance au coureur (à l'accueil, simple brouhaha)
    let ppos = null;
    if (tr && state !== 'home') {
      tr.frame(p.s, p.lateral, f);
      ppos = { x: f.x, y: f.y, z: f.z };
    }
    const excite = state === 'home' ? () => 0.3 : t < 0 ? () => 0.85 : excitementFor(ppos);
    this.crowds.update(dt, { excite, player: state === 'race' ? ppos : null });
    // Musique : intensité selon l'effort et la situation de course, brillance avec la vitesse
    if (state === 'race') {
      const remaining = race.distance - p.s;
      this.music.setIntensity(musicIntensity({ state, time: t, power: p.power, speed: p.v, turbo: p.turbo(t), finalLap: race.lapOf(p) === race.laps && race.laps > 1, remaining }));
      this.music.setBrightness(Math.min(1, 0.35 + p.v / 16));
    } else if (state === 'home') {
      this.music.setIntensity(1);
      this.music.setBrightness(0.55);
    }
  }

  updateRow(dt, race, riding, state) {
    const p = race.player;
    this.row.build();
    this.row.setActive(riding);
    this.speed = p.v;
    if (riding) this.row.update(dt, p);
    const boats = [];
    for (const r of race.racers) if (r !== p && Math.abs(r.s - p.s) < 40) boats.push({ racer: r, pos: { x: r.laneX + r.lateral, y: 0.4, z: r.s } });
    if (riding) this.boats.update(dt, boats);
    // Tribune : la foule monte en puissance quand la tête de course approche de l'arrivée
    const lead = Math.max(...race.racers.map((r) => r.s));
    const k = Math.max(0, Math.min(1, (lead - (race.distance - 260)) / 260));
    this.crowds.update(dt, { excite: () => (state === 'home' ? 0.25 : 0.2 + 0.8 * k * k), player: null });
    if (state === 'race') {
      this.music.setIntensity(musicIntensity({ state, time: race.time, power: p.power, speed: p.v * 2.2, ref: 200, remaining: race.distance - p.s > 0 ? (race.distance - p.s) * 2 : 0 }));
      this.music.setBrightness(Math.min(1, 0.4 + p.v / 7));
    }
  }

  // --- Événements de course ---
  bindRace(race) {
    this.unbind?.();
    this.race = race;
    this.prevGaps = new Map();
    const on = (type, fn) => race.addEventListener(type, fn);
    const near = (r, d = 25) => this.posOf(race, r) && this.engine.distanceTo(this.posOf(race, r)) < d;
    const handlers = {
      go: () => {
        this.sfx('go', { priority: 3 });
        this.sfx('horn', { priority: 3 });
      },
      pickup: ({ detail }) => {
        if (detail.racer.isPlayer) this.sfx('pickup');
        else if (near(detail.racer, 20)) this.sfx('pickup', { pos: this.posOf(race, detail.racer), gain: 0.35, priority: 1 });
      },
      use: ({ detail }) => {
        const me = detail.racer.isPlayer;
        if (detail.item === 'turbo') {
          if (me) this.sfx('turbo');
          else if (near(detail.racer)) this.sfx('turbo', { pos: this.posOf(race, detail.racer), gain: 0.4, priority: 1 });
        }
      },
      'banana-dropped': ({ detail: b }) => {
        const pos = this.bananaPos(race, b);
        if (b.owner?.isPlayer) this.sfx('banana', { gain: 0.8 });
        else if (pos && this.engine.distanceTo(pos) < 30) this.sfx('banana', { pos, gain: 0.6, priority: 1 });
      },
      'banana-hit': ({ detail }) => {
        if (detail.racer.isPlayer) {
          this.sfx('skid', { priority: 3 });
          this.sfx('bump', { gain: 0.8 });
        } else if (near(detail.racer, 35)) this.sfx('skid', { pos: this.posOf(race, detail.racer), gain: 0.5, priority: 1 });
      },
      lap: ({ detail }) => {
        if (!detail.racer.isPlayer) return;
        this.sfx(detail.lap === race.laps ? 'final-lap' : 'lap', { priority: 3 });
      },
      finish: ({ detail: r }) => {
        if (!r.isPlayer) return;
        this.finishFx();
      },
    };
    for (const [k, fn] of Object.entries(handlers)) on(k, fn);
    this.unbind = () => {
      for (const [k, fn] of Object.entries(handlers)) race.removeEventListener(k, fn);
    };
  }

  bindRow(race) {
    this.unbindRow?.();
    this.rowRace = race;
    const go = () => {
      this.sfx('go', { priority: 3 });
      this.sfx('horn', { priority: 3 });
    };
    const finish = ({ detail }) => {
      if (detail.isPlayer) this.finishFx();
    };
    race.addEventListener('go', go);
    race.addEventListener('finish', finish);
    this.unbindRow = () => {
      race.removeEventListener('go', go);
      race.removeEventListener('finish', finish);
    };
  }

  finishFx() {
    if (this.finished) return;
    this.finished = true;
    this.music.stop(0.6);
    this.sfx('fanfare', { priority: 3 });
    this.crowds.roar();
    // Clameur de la foule autour de la ligne
    const e = this.engine;
    const buf = e.bank.get('crowd', { excited: true, seconds: 6 });
    const v = e.play(buf, { bus: 'sfx', gain: 0.55, fadeIn: 0.3, offset: Math.random() * 2, priority: 3 });
    if (v) setTimeout(() => v.stop(1.6), 3200);
  }

  posOf(race, r) {
    const tr = race.track;
    if (!tr) return null;
    const f = tr.frame(r.s, r.lateral, {});
    return { x: f.x, y: f.y + 0.6, z: f.z };
  }

  bananaPos(race, b) {
    const tr = race.track;
    if (!tr) return null;
    const f = tr.frame(b.s, b.lateral, {});
    return { x: f.x, y: f.y + 0.2, z: f.z };
  }

  // Mesures (tests, ?fps=1) : voix actives, coût moyen de update() en ms.
  debug() {
    const e = this.engine;
    return {
      state: e.state,
      ctxState: e.ctx?.state ?? null,
      voices: e.voices.size,
      spatial: e.spatialCount,
      played: e.stats.played,
      dropped: e.stats.dropped,
      updateMs: this.stats.updates ? this.stats.ms / this.stats.updates : 0,
      bank: e.bank ? { ...e.bank.stats, cached: e.bank.cache.size, mb: +(([...e.bank.cache.values()].reduce((n, b) => n + b.length * b.numberOfChannels * 4, 0) + [...e.bank.pools.values()].reduce((n, p) => n + p.items.reduce((m, b) => m + b.length * b.numberOfChannels * 4, 0), 0)) / 1048576).toFixed(1) } : null,
      scene: this.sceneKey,
      music: this.music?.songId ?? null,
      settings: { ...e.settings },
    };
  }
}
