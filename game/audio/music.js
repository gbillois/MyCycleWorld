// Lecteur de musique procédurale : programmateur « en avance » sur l'horloge audio (minuterie de 25 ms,
// 100 ms programmées d'avance), nappe et basse en synthèse continue (aucun nœud créé par note),
// batterie et notes mélodiques en échantillons calculés. Les couches suivent l'intensité de la course
// (lissée sur plusieurs secondes : rien ne surgit d'un coup), le filtre s'ouvre un peu avec la vitesse.
// Timbres chauds : formes d'onde aux harmoniques décroissantes (pas de dent de scie ni de carré bruts),
// filtres doux sans résonance. Peu de voix : léger pour le processeur.
import { makeSong, stepEvents, stepDuration, swingOffset, planSteps, layerLevel } from './music-gen.js';
import { mtof } from './dsp.js';
import { biquad } from './engine.js';

const LOOKAHEAD = 0.1;
const TICK_MS = 25;
const DRUMS = ['kick', 'snare', 'clap', 'hat', 'shaker', 'rim', 'conga', 'brush'];
const DRUM_GAIN = { kick: 1.2, snare: 0.5, clap: 0.45, hat: 0.18, openhat: 0.12, shaker: 0.25, rim: 0.3, conga: 0.4, brush: 0.4 };
// Constantes de temps du lissage de l'intensité (s) : montée lente, descente plus lente encore.
const RISE = 3;
const FALL = 5;

// Onde périodique aux harmoniques a_n = 1 / n^pente (n ≤ count) : une « dent de scie » déjà filtrée, ronde.
function softWave(c, count, slope, extra = {}) {
  const real = new Float32Array(count + 1);
  const imag = new Float32Array(count + 1);
  for (let n = 1; n <= count; n++) imag[n] = extra[n] ?? 1 / Math.pow(n, slope);
  return c.createPeriodicWave(real, imag);
}

export class Music {
  constructor(engine) {
    this.e = engine;
    this.song = null;
    this.playing = false;
    this.intensity = 1;
    this.target = 1;
    this.brightness = 0.6;
    this.timer = null;
    this.built = false;
  }

  build() {
    if (this.built) return;
    this.built = true;
    const c = this.e.ctx;
    const g = (v) => {
      const n = c.createGain();
      n.gain.value = v;
      return n;
    };
    this.out = g(0);
    this.connected = false;
    // Brillance générale (s'ouvre un peu avec la vitesse), plafonnée bas : musique en retrait, jamais criarde
    this.tone = biquad(c, 'lowpass', 4000, 0.5);
    this.tone.connect(this.out);
    // Nappe : 4 voix × 2 oscillateurs désaccordés, ouverts en stéréo, onde douce
    const padWave = softWave(c, 14, 1.9);
    this.padFilter = biquad(c, 'lowpass', 800, 0.5);
    this.padGain = g(0);
    const pl = this.e.stereoPanner(-0.5);
    const pr = this.e.stereoPanner(0.5);
    this.padOsc = [];
    for (let v = 0; v < 4; v++) {
      for (const [side, det] of [[pl, -6], [pr, 6]]) {
        const o = c.createOscillator();
        o.setPeriodicWave(padWave);
        o.detune.value = det + (v - 1.5) * 1.5;
        o.frequency.value = 220;
        o.connect(side || this.padFilter);
        o.start();
        this.padOsc.push({ o, v });
      }
    }
    pl?.connect(this.padFilter);
    pr?.connect(this.padFilter);
    // Lente respiration de la nappe
    this.padLfo = c.createOscillator();
    this.padLfo.frequency.value = 0.07;
    this.padLfo.connect(g(110)).connect(this.padFilter.frequency);
    this.padLfo.start();
    this.padFilter.connect(this.padGain).connect(this.tone);
    // Basse monophonique ronde (fondamentale, un peu d'octave et de quinte), passe-bas sans résonance
    this.bassA = c.createOscillator();
    this.bassA.setPeriodicWave(softWave(c, 3, 1, { 1: 1, 2: 0.3, 3: 0.1 }));
    this.bassFilter = biquad(c, 'lowpass', 400, 0.7);
    this.bassGain = g(0);
    this.bassA.connect(this.bassFilter).connect(this.bassGain).connect(this.tone);
    this.bassA.start();
    // Batterie et notes : un gain par famille, écho (croche pointée) feutré sur les notes mélodiques
    this.drumBus = g(1);
    this.drumBus.connect(biquad(c, 'lowpass', 9000, 0.5)).connect(this.out);
    this.noteBus = g(1);
    this.noteBus.connect(this.tone);
    this.delay = c.createDelay(1.5);
    const fb = g(0.25);
    const dlp = biquad(c, 'lowpass', 2000);
    this.delaySend = g(0.18);
    this.noteBus.connect(this.delaySend).connect(this.delay).connect(dlp).connect(fb).connect(this.delay);
    dlp.connect(this.tone);
  }

  // key : décor ('meadow', 'alpine'...) ; kind : 'race' ou 'menu'. La graine fait la tonalité et le tempo du niveau.
  setSong(key, kind = 'race') {
    if (!this.e.running && !this.e.ctx) return;
    const id = `${key}:${kind}`;
    if (this.songId === id && this.playing) return;
    this.songId = id;
    this.build();
    if (!this.connected) {
      this.out.connect(this.e.buses.music);
      this.connected = true;
    }
    this.song = makeSong(key, kind === 'menu' ? 'menu' : key);
    this.level = kind === 'menu' ? 1.2 : 1; // le thème du menu, plus doux, est à peine remonté
    this.prefetch();
    const c = this.e.ctx;
    const t = c.currentTime;
    // Fondu enchaîné : on recommence au début de la grille un peu plus tard
    clearTimeout(this.offTimer);
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, 0.25);
    this.step = 0;
    this.nextTime = t + 0.9;
    this.out.gain.setTargetAtTime(this.level, t + 0.9, 0.8);
    this.stepDur = stepDuration(this.song.bpm);
    this.playing = true;
    this.lastChord = -1;
    this.lastPump = t;
    this.intensity = Math.min(this.intensity, 1); // un nouveau morceau commence toujours calmement
    if (!this.timer) this.tick();
  }

  prefetch() {
    const b = this.e.bank;
    // Notes des autres instruments libérées (mémoire contenue sur tablette)
    const inst = `"instrument":"${this.song.instrument}"`;
    b.evict((k) => k.startsWith('note{') && !k.includes(inst));
    for (const k of DRUMS) b.load('drum', { kind: k }).catch(() => {});
    const notes = new Set();
    for (const bar of this.song.bars) for (const n of bar.notes) {
      notes.add(n + this.song.arpOctave);
      notes.add(n + 12 + this.song.arpOctave);
    }
    for (let d = 0; d < 10; d++) notes.add(this.song.root + this.song.scale[d % 7] + 12 * (1 + Math.floor(d / 7)));
    for (const m of notes) b.load('note', { instrument: this.song.instrument, midi: m }).catch(() => {});
  }

  stop(fade = 1.2) {
    if (!this.playing) return;
    this.playing = false;
    this.songId = null;
    const t = this.e.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, fade / 3);
    this.padGain.gain.setTargetAtTime(0, t, fade / 3);
    this.bassGain.gain.setTargetAtTime(0, t, 0.1);
    // Silence complet : la chaîne est débranchée, le moteur audio ne la calcule plus.
    clearTimeout(this.offTimer);
    this.offTimer = setTimeout(() => {
      if (!this.playing && this.connected) {
        this.out.disconnect();
        this.connected = false;
      }
    }, fade * 1000 + 600);
  }

  // Intensité voulue (0..3) : la musique s'en approche en quelques secondes.
  setIntensity(x) {
    this.target = Math.max(0, Math.min(3, x));
  }

  setBrightness(k) {
    const kk = Math.max(0, Math.min(1, k));
    if (Math.abs(kk - this.brightness) < 0.02 || !this.built) return;
    this.brightness = kk;
    this.tone.frequency.setTargetAtTime(2200 + 5000 * kk * kk, this.e.ctx.currentTime, 0.8);
  }

  tick() {
    this.timer = null;
    if (!this.playing) return;
    this.timer = setTimeout(() => this.tick(), TICK_MS);
    if (!this.e.running) return;
    this.pump();
  }

  // Lissage de l'intensité sur l'horloge audio, puis programmation des pas qui tombent dans la fenêtre.
  pump() {
    const c = this.e.ctx;
    const now = c.currentTime;
    const dt = Math.max(0, Math.min(0.5, now - (this.lastPump ?? now)));
    this.lastPump = now;
    const tau = this.target > this.intensity ? RISE : FALL;
    this.intensity += (this.target - this.intensity) * (1 - Math.exp(-dt / tau));
    const { times, next } = planSteps(now, this.nextTime, this.stepDur, LOOKAHEAD);
    times.forEach((tt) => {
      this.schedule(this.step, tt + swingOffset(this.step, this.stepDur, this.song.swing));
      this.step++;
    });
    this.nextTime = next;
  }

  schedule(step, t) {
    const song = this.song;
    const x = this.intensity;
    for (const ev of stepEvents(song, step, x)) {
      if (ev.type === 'chord') this.chord(ev.notes, t, x);
      else if (ev.type === 'drum') this.drum(ev.kind, ev.vel, t);
      else if (ev.type === 'bass') this.bass(ev.midi, ev.vel, ev.len, t);
      else if (ev.type === 'note') this.note(ev.midi, ev.vel, t, ev.lead);
    }
  }

  chord(notes, t, x) {
    // Les voix glissent doucement vers le nouvel accord (portamento de nappe analogique)
    for (const { o, v } of this.padOsc) {
      const m = notes[v % notes.length] + (v >= notes.length ? 12 : 0);
      o.frequency.setTargetAtTime(mtof(m), t, 0.08);
    }
    const level = 0.15 * (0.6 + 0.4 * layerLevel(x, 'pad')) * (x > 2.5 ? 0.85 : 1);
    this.padGain.gain.setTargetAtTime(level, t, 0.8);
    this.padFilter.frequency.setTargetAtTime(500 + 900 * this.brightness * (0.6 + x / 8), t, 1);
  }

  bass(midi, vel, len, t) {
    const f = mtof(midi);
    const d = this.stepDur * (len >= 1 ? 1.8 : 0.9);
    this.bassA.frequency.setValueAtTime(f, t);
    const g = this.bassGain.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.26 * vel, t, 0.012);
    g.setTargetAtTime(0, t + d, 0.06);
    const fl = this.bassFilter.frequency;
    fl.cancelScheduledValues(t);
    fl.setTargetAtTime(200 + 350 * vel * (0.5 + this.brightness), t, 0.01);
    fl.setTargetAtTime(160 + 120 * this.brightness, t + 0.04, 0.12);
  }

  drum(kind, vel, t) {
    const buf = this.e.bank.get('drum', { kind });
    if (!buf) return;
    this.hit(buf, (DRUM_GAIN[kind] ?? 0.15) * vel * (0.9 + Math.random() * 0.2), t, this.drumBus, 1 + (Math.random() - 0.5) * 0.02);
  }

  note(midi, vel, t, lead = false) {
    const buf = this.e.bank.get('note', { instrument: this.song.instrument, midi });
    if (!buf) return;
    this.hit(buf, 0.45 * vel * (0.85 + Math.random() * 0.2), t, this.noteBus, 1);
  }

  hit(buf, level, t, dest, rate) {
    const c = this.e.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = level;
    src.connect(g).connect(dest);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
    src.start(t);
  }
}
