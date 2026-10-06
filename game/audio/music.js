// Lecteur de musique : enchaîne les cellules rendues hors ligne (music-render.js, dans le travailleur) sur
// l'horloge audio, mesure après mesure, chaque cellule démarrant pile sur sa barre de mesure (au
// échantillon près) ; les traînes des notes recouvrent naturellement la mesure suivante, sans raccord.
// Les couches (nappe, claviers, basse, groove, batterie, mélodie) suivent l'intensité de la course, lissée
// sur plusieurs secondes : rien ne surgit d'un coup, et une couche qui entre attend sa barre de mesure.
// Effets en direct, légers : chorus stéréo de la nappe, panoramique lent des claviers, retrait de la nappe
// sous la grosse caisse, écho ping-pong et réverbération (réponse calculée hors ligne) par morceau.
// Tant qu'un morceau n'est pas prêt, on n'entend rien (le jeu n'attend jamais la musique).
import { makeSong, layerGains, nextSection, planBars, LAYERS, MOODS } from './music-gen.js';
import { biquad } from './engine.js';

const TICK_MS = 50;
const LOOKAHEAD = 0.6;
// Constantes de temps du lissage de l'intensité (s) : montée lente, descente plus lente encore.
const RISE = 3;
const FALL = 5;
// Parties d'un morceau, dans l'ordre de rendu (la réverbération et la nappe d'abord).
export const MUSIC_PARTS = ['verb', 'pad', 'keys', 'bass', 'groove', 'lead', 'drums'];
// Mémoire maximale des morceaux rendus (iPad) : les morceaux qui ne jouent pas sont libérés au besoin.
export const MUSIC_BUDGET = 40 * 1048576;
// Niveau de sortie : place la musique un peu sous les effets aux réglages par défaut.
const OUT_LEVEL = 2.4;

// Ambiance musicale d'un décor ('meadow', 'alpine'...) ; le menu a son propre morceau.
export function moodFor(key, kind = 'race') {
  if (kind === 'menu') return 'menu';
  return MOODS[key] && key !== 'menu' ? key : 'meadow';
}

// Morceau rendu : plan (music-gen) + tampons des cellules, arrivés couche par couche.
class Kit {
  constructor(mood) {
    this.mood = mood;
    this.song = makeSong(mood);
    this.buffers = new Map();
    this.parts = new Set();
    this.verb = null;
    this.bytes = 0;
    this.loading = null;
    this.failed = false;
    this.used = 0;
  }
  get ready() {
    return this.parts.has('pad') && this.parts.has('verb');
  }
  get complete() {
    return MUSIC_PARTS.every((p) => this.parts.has(p));
  }
}

// Une lecture d'un morceau (deux se chevauchent pendant un fondu enchaîné).
class Deck {
  constructor(music, kit, t0) {
    const c = music.e.ctx;
    const g = (v) => {
      const n = c.createGain();
      n.gain.value = v;
      return n;
    };
    this.m = music;
    this.c = c;
    this.kit = kit;
    this.song = kit.song;
    this.out = g(1);
    this.out.connect(music.mix);
    this.sources = new Set();
    this.layer = {};
    this.level = {};
    const fx = this.song.fx;
    // Réverbération et écho propres au morceau
    this.verb = c.createConvolver();
    this.verb.normalize = false;
    try {
      this.verb.buffer = kit.verb;
    } catch {
      /* pas de réverbération */
    }
    this.verbIn = g(1);
    this.verbIn.connect(this.verb).connect(this.out);
    this.delayIn = g(1);
    const T = Math.min(1.9, (fx.delay.beats * 60) / this.song.bpm);
    const dl = c.createDelay(2);
    const dr = c.createDelay(2);
    dl.delayTime.value = T;
    dr.delayTime.value = T;
    const lpl = biquad(c, 'lowpass', 2600, 0.5);
    const lpr = biquad(c, 'lowpass', 2200, 0.5);
    const hp = biquad(c, 'highpass', 300, 0.5);
    const fb = g(fx.delay.fb);
    this.delayIn.connect(hp).connect(dl).connect(lpl);
    lpl.connect(dr).connect(lpr).connect(fb).connect(dl);
    const pl = music.e.stereoPanner(-0.6);
    const pr = music.e.stereoPanner(0.6);
    if (pl && pr) {
      lpl.connect(pl).connect(this.out);
      lpr.connect(pr).connect(this.out);
    } else {
      lpl.connect(this.out);
      lpr.connect(this.out);
    }
    this.fxNodes = [this.verb, this.verbIn, this.delayIn, dl, dr, lpl, lpr, hp, fb, pl, pr];
    const dest = { pad: music.padBus, keys: music.keysBus, bass: music.centerBus, lead: music.centerBus, groove: music.mix, drums: music.mix };
    for (const l of LAYERS) {
      const n = g(0);
      n.connect(dest[l]);
      const vs = fx.verb[l] ?? 0;
      if (vs > 0) n.connect(g(vs)).connect(this.verbIn);
      const ds = fx.delay[l] ?? 0;
      if (ds > 0) n.connect(g(ds)).connect(this.delayIn);
      this.layer[l] = n;
      this.level[l] = 0;
    }
    this.formIdx = 0;
    this.bar = 0;
    this.next = t0;
    this.stopped = false;
  }

  get section() {
    return this.song.sections[this.song.form[this.formIdx]];
  }

  // Gains des couches pour l'intensité lissée x (petits pas, aucune marche audible).
  levels(x, now) {
    const g = layerGains(this.song, x);
    for (const l of LAYERS) {
      const v = g[l];
      if (Math.abs(v - this.level[l]) < 0.002) continue;
      this.level[l] = v;
      this.layer[l].gain.setTargetAtTime(v, now, 0.15);
    }
    this.target = g;
  }

  schedule(now, x) {
    const { times, next, resync } = planBars(now, this.next, this.song.barSec, LOOKAHEAD);
    if (resync) this.m.stats.resync++;
    for (const t of times) {
      this.playBar(t, now, x);
      this.bar++;
      if (this.bar >= this.section.bars) {
        this.bar = 0;
        this.formIdx = nextSection(this.song, this.formIdx, x);
      }
    }
    this.next = next;
  }

  playBar(t, now, x) {
    const sec = this.section;
    const g = layerGains(this.song, x);
    for (const l of LAYERS) {
      const id = sec.layers[l][this.bar];
      if (!id) continue;
      // Couche éteinte (et qui le reste) : on ne joue rien, le fil audio n'a rien à calculer
      if (g[l] < 0.003 && this.level[l] < 0.003) continue;
      const buf = this.kit.buffers.get(id);
      if (!buf) continue;
      this.start(buf, this.layer[l], t, now);
      if ((l === 'groove' || l === 'drums') && this.m.duckDepth > 0) this.duck(this.song.cells[id].kicks, t, g.groove);
    }
  }

  start(buf, dest, t, now) {
    const c = this.c;
    const src = c.createBufferSource();
    src.buffer = buf;
    let node = null;
    if (t < now + 0.005) {
      // En retard (fil principal bloqué) : on reprend au bon endroit de la cellule, avec un fondu bref
      const off = now + 0.01 - t;
      if (off >= buf.duration) return;
      node = c.createGain();
      node.gain.setValueAtTime(0, now + 0.01);
      node.gain.linearRampToValueAtTime(1, now + 0.025);
      src.connect(node).connect(dest);
      src.start(now + 0.01, off);
      this.m.stats.late++;
    } else {
      src.connect(dest);
      src.start(t);
    }
    this.sources.add(src);
    this.m.stats.cells++;
    src.onended = () => {
      this.sources.delete(src);
      src.disconnect();
      node?.disconnect();
    };
  }

  // Retrait de la nappe sous chaque coup de grosse caisse (pompage discret, façon compresseur sidechain).
  duck(kicks, t, level) {
    if (!kicks?.length || level < 0.05) return;
    const p = this.m.padDuck.gain;
    const d = this.m.duckDepth * level;
    const step = this.song.stepSec;
    for (const k of kicks) {
      const tk = t + k * step;
      p.setTargetAtTime(1 - d, tk, 0.004);
      p.setTargetAtTime(1, tk + 0.03, 0.09);
    }
  }

  stop(fade) {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.c.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(0, now, Math.max(0.05, fade / 3));
    setTimeout(() => this.dispose(), (fade + 0.6) * 1000);
  }

  dispose() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* déjà arrêtée */
      }
      s.disconnect();
    }
    this.sources.clear();
    for (const n of Object.values(this.layer)) n.disconnect();
    for (const n of this.fxNodes) n?.disconnect();
    this.out.disconnect();
  }
}

export class Music {
  constructor(engine) {
    this.e = engine;
    this.kits = new Map();
    this.deck = null;
    this.pending = null; // morceau demandé, pas encore prêt
    this.playing = false;
    this.songId = null;
    this.intensity = 1;
    this.target = 1;
    this.brightness = 0.6;
    this.timer = null;
    this.built = false;
    this.duckDepth = 0;
    this.stats = { cells: 0, late: 0, resync: 0, renderMs: 0, acceptMs: 0 };
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
    // Brillance générale : s'ouvre avec la vitesse, sans jamais assourdir (coupure au-dessus de 4,5 kHz)
    this.tone = biquad(c, 'lowpass', 9000, 0.5);
    this.tone.connect(this.out);
    this.mix = g(OUT_LEVEL);
    this.mix.connect(this.tone);
    // Couches mono au centre (panoramique à puissance constante : 0,707 de chaque côté)
    this.centerBus = this.e.stereoPanner(0) || g(0.7071);
    this.centerBus.connect(this.mix);
    // Claviers : panoramique lent et léger
    this.keysBus = this.e.stereoPanner(-0.1) || g(0.7071);
    this.keysBus.connect(this.mix);
    if (this.keysBus.pan) {
      this.keysLfo = c.createOscillator();
      this.keysLfo.frequency.value = 0.11;
      this.keysLfo.connect(g(0.22)).connect(this.keysBus.pan);
      this.keysLfo.start();
    }
    // Nappe : retrait sous la grosse caisse, puis chorus stéréo (deux retards modulés en opposition) ;
    // l'entrée à 0,87 compense l'énergie ajoutée par les deux voix du chorus (même niveau que hors ligne)
    this.padBus = g(0.87);
    this.padDuck = g(1);
    this.padBus.connect(this.padDuck);
    const dry = this.e.stereoPanner(0) || g(0.7071);
    this.padDuck.connect(dry).connect(this.mix);
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.5;
    lfo.start();
    for (const [pan, sign] of [[-0.85, 1], [0.85, -1]]) {
      const d = c.createDelay(0.05);
      d.delayTime.value = 0.009;
      lfo.connect(g(0.0023 * sign)).connect(d.delayTime);
      const p = this.e.stereoPanner(pan) || g(0.5);
      this.padDuck.connect(d).connect(g(0.4)).connect(p).connect(this.mix);
    }
  }

  // key : décor ('meadow', 'alpine'...) ; kind : 'race' ou 'menu'.
  setSong(key, kind = 'race') {
    if (!this.e.ctx) return;
    const mood = moodFor(key, kind);
    const id = `${key}:${kind}`;
    if (this.songId === id && this.playing) return;
    this.build();
    if (!this.connected) {
      this.out.connect(this.e.buses.music);
      this.connected = true;
    }
    this.songId = id;
    this.playing = true;
    this.intensity = Math.min(this.intensity, 1); // un nouveau morceau commence toujours calmement
    const t = this.e.ctx.currentTime;
    clearTimeout(this.offTimer);
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(1, t, 0.3);
    if (this.deck && this.deck.kit.mood === mood && !this.deck.stopped) {
      // Même morceau (menu d'un décor à l'autre) : il continue
      this.pending = null;
    } else {
      this.deck?.stop(1.2);
      this.deck = null;
      this.pending = mood;
      this.load(mood, 2);
    }
    if (!this.timer) this.tick();
  }

  stop(fade = 1.2) {
    if (!this.playing) return;
    this.playing = false;
    this.songId = null;
    this.pending = null;
    this.deck?.stop(fade);
    this.deck = null;
    const t = this.e.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, fade / 3);
    clearTimeout(this.offTimer);
    // Silence complet : la chaîne est débranchée, le moteur audio ne la calcule plus.
    this.offTimer = setTimeout(() => {
      if (!this.playing && this.connected) {
        this.out.disconnect();
        this.connected = false;
      }
    }, fade * 1000 + 800);
  }

  // Intensité voulue (0..3) : la musique s'en approche en quelques secondes.
  setIntensity(x) {
    this.target = Math.max(0, Math.min(3, x));
  }

  setBrightness(k) {
    const kk = Math.max(0, Math.min(1, k));
    if (Math.abs(kk - this.brightness) < 0.02 || !this.built) return;
    this.brightness = kk;
    this.tone.frequency.setTargetAtTime(4500 + 6500 * kk * kk, this.e.ctx.currentTime, 0.8);
  }

  // --- Rendu des morceaux (travailleur), couche par couche ---
  load(mood, prio = 1) {
    let kit = this.kits.get(mood);
    if (!kit) {
      kit = new Kit(mood);
      this.kits.set(mood, kit);
    }
    kit.used = performance.now();
    if (kit.complete || kit.loading || kit.failed || !this.e.bank) return kit;
    kit.loading = (async () => {
      for (const part of MUSIC_PARTS) {
        if (kit.parts.has(part)) continue;
        // Plus demandé (le joueur a changé de niveau) : on s'arrête là
        if (this.pending !== mood && this.deck?.kit !== kit) break;
        this.makeRoom(kit);
        try {
          const t0 = performance.now();
          const res = await this.e.bank.raw('music', { mood, part }, prio);
          this.accept(kit, part, res);
          this.stats.renderMs += performance.now() - t0;
        } catch {
          kit.failed = true;
          break;
        }
      }
      kit.loading = null;
    })();
    return kit;
  }

  accept(kit, part, res) {
    const t0 = performance.now();
    this.convert(kit, part, res);
    this.stats.acceptMs = Math.max(this.stats.acceptMs, performance.now() - t0);
  }

  convert(kit, part, res) {
    const c = this.e.ctx;
    if (part === 'verb') {
      const b = c.createBuffer(2, res.channels[0].length, res.sampleRate);
      res.channels.forEach((ch, i) => b.getChannelData(i).set(ch));
      kit.verb = b;
      kit.bytes += b.length * 8;
    } else {
      for (const cell of res.meta.cells) {
        const len = res.channels[cell.ch].length;
        const b = c.createBuffer(cell.n, len, res.sampleRate);
        for (let i = 0; i < cell.n; i++) b.getChannelData(i).set(res.channels[cell.ch + i]);
        kit.buffers.set(cell.id, b);
        kit.bytes += len * cell.n * 4;
      }
    }
    kit.parts.add(part);
  }

  // Libère les morceaux qui ne jouent pas (le plus ancien d'abord) tant que la mémoire déborde.
  makeRoom(keep) {
    const total = () => [...this.kits.values()].reduce((n, k) => n + k.bytes, 0);
    const estimate = 32 * 1048576 - keep.bytes;
    const idle = [...this.kits.values()].filter((k) => k !== keep && k !== this.deck?.kit && !k.loading).sort((a, b) => a.used - b.used);
    while (total() + Math.max(0, estimate) > MUSIC_BUDGET && idle.length) {
      const k = idle.shift();
      this.kits.delete(k.mood);
    }
  }

  get bytes() {
    return [...this.kits.values()].reduce((n, k) => n + k.bytes, 0);
  }

  // --- Programmateur ---
  tick() {
    this.timer = null;
    if (!this.playing && !this.deck) return;
    this.timer = setTimeout(() => this.tick(), TICK_MS);
    if (!this.e.running) return;
    this.pump();
  }

  pump() {
    const c = this.e.ctx;
    const now = c.currentTime;
    const dt = Math.max(0, Math.min(0.5, now - (this.lastPump ?? now)));
    this.lastPump = now;
    const tau = this.target > this.intensity ? RISE : FALL;
    this.intensity += (this.target - this.intensity) * (1 - Math.exp(-dt / tau));
    // Morceau demandé prêt (réverbération et nappe rendues) : il démarre
    if (this.pending) {
      const kit = this.kits.get(this.pending);
      if (kit?.ready) {
        this.pending = null;
        this.deck = new Deck(this, kit, now + 0.15);
        this.duckDepth = kit.song.fx.duck ?? 0;
        this.deck.levels(this.intensity, now);
      } else if (!kit || (!kit.loading && !kit.failed)) this.load(this.pending, 2);
    }
    const d = this.deck;
    if (!d) return;
    d.kit.used = performance.now();
    d.levels(this.intensity, now);
    d.schedule(now, this.intensity);
  }

  debug() {
    const d = this.deck;
    return {
      mood: d?.kit.mood ?? this.pending ?? null,
      section: d ? d.song.form[d.formIdx] : null,
      bar: d?.bar ?? null,
      intensity: +this.intensity.toFixed(2),
      parts: d ? [...d.kit.parts] : [],
      kits: [...this.kits.keys()],
      mb: +(this.bytes / 1048576).toFixed(1),
      sources: d?.sources.size ?? 0,
      ...this.stats,
    };
  }
}
