// Spectateurs : groupes positionnés (départ, montées, tribune de l'aviron) qui s'animent quand le coureur
// approche : brouhaha au repos, puis cris, « allez ! » scandés, sifflets et applaudissements qui enflent.
// Seuls les deux groupes les plus proches sont actifs (trois boucles chacun), les autres ne coûtent rien.
import { crowdExcitement } from './patterns.js';

const CROWD = { excited: true, seconds: 6 };
const MURMUR = { excited: false, seconds: 6 };
const CLAPS = { seconds: 6 };

export class Crowds {
  constructor(engine) {
    this.e = engine;
    this.spots = [];
    this.active = new Map(); // spot -> nœuds
    this.left = 0;
  }

  preload() {
    const b = this.e.bank;
    b.pool('chant', {}, 3);
    return Promise.all([b.load('crowd', CROWD, 0), b.load('crowd', MURMUR, 0), b.load('applause', CLAPS, 0)]).catch(() => null);
  }

  // spots : [{ x, y, z, kind, ref? }]
  setSpots(spots) {
    for (const spot of [...this.active.keys()]) this.deactivate(spot, 1.2);
    this.spots = spots || [];
  }

  activate(spot) {
    const e = this.e;
    const bufs = [e.bank.get('crowd', CROWD), e.bank.get('crowd', MURMUR), e.bank.get('applause', CLAPS)];
    if (bufs.some((b) => !b) || !e.canPlay(true)) return;
    const c = e.ctx;
    const t = c.currentTime;
    const mix = c.createGain();
    mix.gain.setValueAtTime(0, t);
    mix.gain.linearRampToValueAtTime(1, t + 1.5);
    const pan = e.panner({ ref: spot.ref ?? 14, rolloff: 1, max: 3000 });
    e.setPos(pan, spot);
    const layers = bufs.map((buf) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = 0.96 + Math.random() * 0.08;
      src.start(t, Math.random() * buf.duration);
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(g).connect(mix);
      return { src, g };
    });
    mix.connect(pan).connect(e.buses.ambience);
    const wet = c.createGain();
    wet.gain.value = 0.2;
    pan.connect(wet).connect(e.wet.ambience);
    const voice = e.adopt(layers.map((l) => l.src), [mix, ...layers.map((l) => l.g), pan, wet], { spatial: true });
    this.active.set(spot, { voice, layers, mix, ex: -1, burstUntil: 0, wasNear: false });
  }

  deactivate(spot, fade = 1.5) {
    const a = this.active.get(spot);
    if (!a) return;
    a.voice.stop(fade);
    this.active.delete(spot);
  }

  // excite(spot) -> 0..1 : excitation voulue pour chaque groupe ; player : position du coureur (bouffée de joie au passage).
  update(dt, { excite, player = null } = {}) {
    if (!this.e.running) return;
    this.left -= dt;
    if (this.left > 0) return;
    this.left = 0.2;
    const e = this.e;
    const t = e.ctx.currentTime;
    // Les deux plus proches dans un rayon de 170 m (hystérésis pour ne pas clignoter)
    const ranked = this.spots.map((s) => [s, e.distanceTo(s)]).sort((a, b) => a[1] - b[1]);
    const want = new Set(ranked.filter(([s, d], i) => i < 2 && d < (this.active.has(s) ? 200 : 170)).map(([s]) => s));
    for (const spot of [...this.active.keys()]) if (!want.has(spot)) this.deactivate(spot);
    for (const spot of want) if (!this.active.has(spot)) this.activate(spot);
    for (const [spot, a] of this.active) {
      let ex = excite ? excite(spot) : 0.3;
      // Le coureur passe tout près : grande clameur pendant quelques secondes
      if (player) {
        const d = Math.hypot(player.x - spot.x, player.z - spot.z);
        const isNear = d < 14;
        if (isNear && !a.wasNear) a.burstUntil = t + 3;
        a.wasNear = isNear;
      }
      if (t < a.burstUntil) ex = Math.min(1.3, ex + 0.5);
      // « Allez ! » scandés de temps en temps quand l'ambiance est chaude (délais tirés au sort)
      a.chantIn = (a.chantIn ?? 2 + Math.random() * 4) - 0.2;
      if (ex > 0.55 && a.chantIn <= 0) {
        a.chantIn = 3.5 + Math.random() * 6;
        e.play(e.bank.pool('chant', {}, 3), { bus: 'ambience', pos: spot, ref: spot.ref ?? 14, gain: 0.55 * Math.min(1, ex), rate: 0.95 + Math.random() * 0.1, wet: 0.2, radius: 200 });
      }
      if (Math.abs(ex - a.ex) < 0.02) continue;
      a.ex = ex;
      const [cheer, murmur, claps] = a.layers;
      cheer.g.gain.setTargetAtTime(0.1 + 0.75 * ex, t, 0.4);
      murmur.g.gain.setTargetAtTime(0.55 * Math.max(0.15, 1 - ex), t, 0.6);
      claps.g.gain.setTargetAtTime(0.06 + 0.55 * Math.min(1, ex), t, 0.5);
    }
  }

  // Arrivée : la foule la plus proche explose.
  roar() {
    for (const a of this.active.values()) a.burstUntil = this.e.ctx.currentTime + 6;
    this.left = 0;
  }
}

export const excitementFor = (player) => (spot) => (player ? crowdExcitement(Math.hypot(player.x - spot.x, player.z - spot.z)) : 0.3);
