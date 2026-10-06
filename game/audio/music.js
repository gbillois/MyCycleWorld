// Lecteur de musique procédurale : programmateur « en avance » sur l'horloge audio (minuterie de 25 ms,
// 100 ms programmées d'avance), nappe et basse en synthèse continue (aucun nœud créé par note),
// batterie et notes mélodiques en échantillons calculés. Les couches suivent l'intensité de la course,
// le filtre s'ouvre avec la vitesse. Peu de voix : léger pour le processeur.
import { makeSong, stepEvents, stepDuration, swingOffset, planSteps, layerLevel } from './music-gen.js';
import { mtof } from './dsp.js';
import { biquad } from './engine.js';

const LOOKAHEAD = 0.1;
const TICK_MS = 25;
const DRUMS = ['kick', 'snare', 'clap', 'hat', 'openhat', 'shaker', 'rim', 'conga', 'brush'];
const DRUM_GAIN = { kick: 0.85, snare: 0.45, clap: 0.42, hat: 0.2, openhat: 0.16, shaker: 0.22, rim: 0.25, conga: 0.35, brush: 0.3 };

export class Music {
  constructor(engine) {
    this.e = engine;
    this.song = null;
    this.playing = false;
    this.intensity = 1;
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
    // Brillance générale (s'ouvre avec la vitesse)
    this.tone = biquad(c, 'lowpass', 6000, 0.5);
    this.tone.connect(this.out);
    // Nappe : 4 voix × 2 dents de scie désaccordées, ouvertes en stéréo
    this.padFilter = biquad(c, 'lowpass', 900, 0.6);
    this.padGain = g(0);
    const pl = this.e.stereoPanner(-0.55);
    const pr = this.e.stereoPanner(0.55);
    this.padOsc = [];
    for (let v = 0; v < 4; v++) {
      for (const [side, det] of [[pl, -7], [pr, 7]]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
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
    this.padLfo.frequency.value = 0.09;
    const lfoDepth = g(220);
    this.padLfo.connect(lfoDepth).connect(this.padFilter.frequency);
    this.padLfo.start();
    this.padFilter.connect(this.padGain).connect(this.tone);
    // Basse monophonique : dent de scie + carré une octave dessous, filtre à enveloppe
    this.bassA = c.createOscillator();
    this.bassA.type = 'sawtooth';
    this.bassB = c.createOscillator();
    this.bassB.type = 'square';
    this.bassFilter = biquad(c, 'lowpass', 300, 3);
    this.bassGain = g(0);
    this.bassA.connect(this.bassFilter);
    const sub = g(0.5);
    this.bassB.connect(sub).connect(this.bassFilter);
    this.bassFilter.connect(this.bassGain).connect(this.tone);
    this.bassA.start();
    this.bassB.start();
    // Batterie et notes : un gain par famille, écho (croche pointée) sur les notes mélodiques
    this.drumBus = g(1);
    this.drumBus.connect(this.out); // la batterie garde son attaque, hors du filtre de brillance
    this.noteBus = g(1);
    this.noteBus.connect(this.tone);
    this.delay = c.createDelay(1.5);
    const fb = g(0.32);
    const dlp = biquad(c, 'lowpass', 2600);
    this.delaySend = g(0.28);
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
    this.level = kind === 'menu' ? 1.5 : 1; // le thème du menu, plus doux, est un peu remonté
    this.prefetch();
    const c = this.e.ctx;
    const t = c.currentTime;
    // Fondu enchaîné : on recommence au début de la grille un peu plus tard
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, 0.25);
    this.step = 0;
    this.nextTime = t + 0.9;
    this.out.gain.setTargetAtTime(this.level, t + 0.9, 0.5);
    this.stepDur = stepDuration(this.song.bpm);
    this.playing = true;
    this.lastChord = -1;
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

  setIntensity(x) {
    this.intensity = Math.max(0, Math.min(3, x));
  }

  setBrightness(k) {
    const kk = Math.max(0, Math.min(1, k));
    if (Math.abs(kk - this.brightness) < 0.02 || !this.built) return;
    this.brightness = kk;
    this.tone.frequency.setTargetAtTime(1800 + 9000 * kk * kk, this.e.ctx.currentTime, 0.4);
  }

  tick() {
    this.timer = null;
    if (!this.playing) return;
    this.timer = setTimeout(() => this.tick(), TICK_MS);
    if (!this.e.running) return;
    const c = this.e.ctx;
    const { times, next } = planSteps(c.currentTime, this.nextTime, this.stepDur, LOOKAHEAD);
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
      o.frequency.setTargetAtTime(mtof(m), t, 0.05);
    }
    const level = 0.07 * (0.6 + 0.4 * layerLevel(x, 'pad')) * (x > 2.5 ? 0.8 : 1);
    this.padGain.gain.setTargetAtTime(level, t, 0.6);
    this.padFilter.frequency.setTargetAtTime(500 + 1600 * this.brightness * (0.5 + x / 6), t, 0.8);
  }

  bass(midi, vel, len, t) {
    const f = mtof(midi);
    const d = this.stepDur * (len >= 1 ? 1.8 : 0.9);
    this.bassA.frequency.setValueAtTime(f, t);
    this.bassB.frequency.setValueAtTime(f / 2, t);
    const g = this.bassGain.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.16 * vel, t, 0.006);
    g.setTargetAtTime(0, t + d, 0.04);
    const fl = this.bassFilter.frequency;
    fl.cancelScheduledValues(t);
    fl.setTargetAtTime(220 + 900 * vel * (0.4 + this.brightness), t, 0.004);
    fl.setTargetAtTime(160 + 200 * this.brightness, t + 0.03, 0.08);
  }

  drum(kind, vel, t) {
    const buf = this.e.bank.get('drum', { kind });
    if (!buf) return;
    this.hit(buf, (DRUM_GAIN[kind] ?? 0.3) * vel, t, this.drumBus, 1 + (Math.random() - 0.5) * 0.02);
  }

  note(midi, vel, t, lead = false) {
    const buf = this.e.bank.get('note', { instrument: this.song.instrument, midi });
    if (!buf) return;
    this.hit(buf, (lead ? 0.24 : 0.19) * vel, t, this.noteBus, 1);
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
