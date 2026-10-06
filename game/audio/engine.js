// Moteur audio : un seul AudioContext, créé au premier geste de l'utilisateur (obligatoire sur iOS),
// bus de mixage (musique, ambiance, effets, interface), réverbération, compresseur et limiteur de sortie,
// voix ponctuelles (stéréo ou positionnées en 3D) avec plafond de voix, écoute qui suit la caméra.
//
//   musique ─► filtre/pause ─► retrait sous les effets ─┐
//   ambiance ─┐                                         ├─► général ─► limiteur de sécurité ─► écrêteur doux ─► sortie
//   effets ───┴─► monde ─► filtre pause ────────────────┤
//   (envois réverbération ─► convolution ─► égaliseur ─► monde)
//   interface ──────────────────────────────────────────┘
// Gain unitaire de bout en bout : le mélange est calme par construction (sonie visée -23 à -20 LUFS en course,
// crêtes vraies sous -3 dBFS), le limiteur ne sert qu'aux empilements exceptionnels.
import { loadSettings, saveSettings, normalizeSettings, volumeToGain } from './settings.js';
import { Bank } from './bank.js';

const AC = globalThis.AudioContext || globalThis.webkitAudioContext;

// Filtre biquad dont les paramètres sont recalculés une fois par bloc de 128 échantillons (« k-rate ») au lieu
// de chaque échantillon : une fréquence qui glisse coûte alors presque rien au fil audio.
export function biquad(ctx, type = 'lowpass', freq = 1000, q = 0.707) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  for (const k of ['frequency', 'Q', 'gain', 'detune']) {
    try {
      b[k].automationRate = 'k-rate';
    } catch {
      /* navigateur sans automationRate : calcul par échantillon */
    }
  }
  b.frequency.value = freq;
  b.Q.value = q;
  return b;
}
// Niveau du retour de réverbération partagée.
const REVERB_LEVEL = 0.7;
// Gain de sortie fixe (+1,5 dB) : place la course vers -22 LUFS aux réglages par défaut.
const OUTPUT_TRIM = 1.19;

// Absorption de l'air et du sol : coupure du passe-bas d'une source lointaine (Hz) selon la distance (m).
// 10 m : presque rien ; 60 m : ~7 kHz ; 120 m : ~2,7 kHz. Les oiseaux et les cloches au loin perdent leur éclat.
export function distanceCutoff(d) {
  return Math.max(1200, Math.min(20000, 20000 * Math.exp(-Math.max(0, d) / 57)));
}

const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'keydown', 'click'];

export class AudioEngine extends EventTarget {
  constructor({ quality = 'high', touch = false, storage } = {}) {
    super();
    this.storage = storage;
    this.settings = loadSettings(storage);
    this.available = !!AC;
    this.state = this.available ? 'locked' : 'unavailable';
    this.quality = quality;
    // HRTF (spatialisation binaurale) sur ordinateur en qualité haute ; panoramique simple ailleurs (moins coûteux).
    this.panningModel = quality === 'high' && !touch ? 'HRTF' : 'equalpower';
    this.maxVoices = quality === 'low' ? 24 : 36;
    this.maxSpatial = quality === 'high' ? 14 : 10;
    this.voices = new Set();
    this.spatialCount = 0;
    this.ctx = null;
    this.paused = false;
    this.listener = { x: 0, y: 0, z: 0, fx: 0, fz: -1 };
    this.stats = { played: 0, dropped: 0 };
    if (this.available && typeof window !== 'undefined') this.installUnlock();
  }

  get running() {
    return !!this.ctx && (this.ctx.state === 'running' || this.offline);
  }

  // Rendu hors ligne (tests, mesure du coût) : même graphe sur un OfflineAudioContext fourni.
  useContext(ctx) {
    this.ctx = ctx;
    this.offline = true;
    this.available = true;
    this.buildGraph();
    this.bank = new Bank(ctx);
    this.state = 'running';
    this.dispatchEvent(new Event('ready'));
    return this;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // --- Déverrouillage (premier geste), visibilité, interruptions iOS ---
  installUnlock() {
    // Seuls les vrais gestes comptent (les touches simulées des manettes ne déverrouillent rien).
    const onGesture = (e) => {
      if (e.isTrusted !== false) this.unlock();
    };
    for (const ev of GESTURES) window.addEventListener(ev, onGesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => this.applyRunState());
    window.addEventListener('pagehide', () => this.ctx?.suspend?.().catch(() => {}));
    window.addEventListener('pageshow', () => this.applyRunState());
  }

  // Appelé dans le gestionnaire du geste : iOS (Safari, WKWebView) n'accepte resume() qu'à cet instant.
  unlock() {
    if (!this.available) return;
    if (!this.ctx && !this.create()) return;
    if (this.shouldSleep()) return;
    if (this.ctx.state !== 'running') {
      try {
        const p = this.ctx.resume();
        p?.catch?.(() => {});
      } catch {
        /* sans effet hors d'un geste : on réessaiera au prochain */
      }
      // Ancien iOS : jouer un son vide pendant le geste débloque la sortie audio.
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = this.ctx.createBuffer(1, 1, 22050);
        src.connect(this.ctx.destination);
        src.start(0);
      } catch {
        /* rien */
      }
    }
  }

  create() {
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      try {
        this.ctx = new AC();
      } catch {
        this.available = false;
        this.state = 'unavailable';
        return false;
      }
    }
    // iOS 17+ : se mêler à la musique de l'utilisateur (podcast, playlist) et respecter le bouton silence.
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'ambient';
    } catch {
      /* non pris en charge */
    }
    this.buildGraph();
    this.bank = new Bank(this.ctx);
    this.ctx.onstatechange = () => this.onStateChange();
    this.onStateChange();
    this.dispatchEvent(new Event('ready'));
    return true;
  }

  onStateChange() {
    if (!this.ctx) return;
    const st = this.ctx.state; // running | suspended | interrupted (iOS : appel, Siri...) | closed
    this.state = st === 'running' ? 'running' : this.shouldSleep() ? 'sleeping' : st;
    if ((st === 'interrupted' || st === 'suspended') && !this.shouldSleep() && !this.retry) {
      // Après une interruption, la reprise peut réussir sans geste ; sinon le prochain toucher s'en charge.
      this.retry = setTimeout(() => {
        this.retry = null;
        if (!this.shouldSleep()) this.ctx.resume().catch(() => {});
      }, 400);
    }
    this.dispatchEvent(new Event('statechange'));
  }

  shouldSleep() {
    return (typeof document !== 'undefined' && document.hidden) || this.settings.muted || this.settings.master <= 0;
  }

  // Page cachée, son coupé ou volume général à 0 : contexte suspendu (aucun calcul audio, batterie épargnée).
  applyRunState() {
    if (!this.ctx) return;
    if (this.shouldSleep()) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = setTimeout(() => {
        if (this.shouldSleep()) this.ctx.suspend().catch(() => {});
      }, this.settings.muted ? 300 : 0);
    } else if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
    }
  }

  // --- Graphe de mixage ---
  buildGraph() {
    const c = this.ctx;
    const gain = (v = 1) => {
      const g = c.createGain();
      g.gain.value = v;
      return g;
    };
    this.master = gain(0);
    // Limiteur de sécurité sans gain de compensation : le compresseur du navigateur ajoute un gain automatique
    // dès que son seuil est sous 0 dB (il gonflait tout le mélange de 8 à 9 dB et l'écrasait en permanence).
    // Seuil réglé à 0 dB et signal monté de 3 dB juste avant puis redescendu juste après : il agit au-dessus
    // de -3 dBFS, et le gain reste exactement 1 en dessous.
    const pre = gain(1.4125);
    const limiter = c.createDynamicsCompressor();
    Object.entries({ threshold: 0, knee: 0, ratio: 20, attack: 0.002, release: 0.2 }).forEach(([k, v]) => (limiter[k].value = v));
    const post = gain(0.708);
    // Écrêteur de dernier recours : transparent sous 0,8 (droite exacte), arrondi au-delà, plafonné à 0,98.
    const clip = c.createWaveShaper();
    const N = 2049;
    const curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      const a = Math.abs(x);
      const y = a <= 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18);
      curve[i] = Math.sign(x) * y;
    }
    clip.curve = curve;
    // Pas de suréchantillonnage : sous 0,8 la courbe est une droite exacte (aucune distorsion, aucun repliement)
    // et le limiteur garde le signal sous 0,71 ; il ne coûterait que du calcul.
    this.master.connect(pre).connect(limiter).connect(post).connect(clip).connect(c.destination);
    this.out = { limiter, clip, glue: limiter };

    this.buses = { music: gain(), ambience: gain(), sfx: gain(), ui: gain() };
    // Musique : filtre et atténuation pendant la pause, puis léger retrait sous les effets importants
    this.musicFilter = biquad(c, 'lowpass', 20000);
    this.musicDuck = gain();
    this.musicSide = gain();
    this.buses.music.connect(this.musicFilter).connect(this.musicDuck).connect(this.musicSide).connect(this.master);
    // Monde (ambiance + effets) : passe-bas et atténuation en pause, comme si on s'éloignait de la course
    this.world = gain();
    this.worldFilter = biquad(c, 'lowpass', 20000);
    this.buses.ambience.connect(this.world);
    this.buses.sfx.connect(this.world);
    this.world.connect(this.worldFilter).connect(this.master);
    this.buses.ui.connect(this.master);
    // Réverbération partagée : envois par bus (suivent le volume du bus), réponse impulsionnelle par décor
    // Retour de réverbération égalisé : ni boue dans le grave, ni brillance métallique (queue chaude et lointaine).
    this.convolver = c.createConvolver();
    this.reverbOut = gain(REVERB_LEVEL);
    this.wet = { ambience: gain(), sfx: gain() };
    this.wet.ambience.connect(this.convolver);
    this.wet.sfx.connect(this.convolver);
    this.convolver.connect(biquad(c, 'highpass', 180, 0.6)).connect(biquad(c, 'lowpass', 5500, 0.6)).connect(this.reverbOut).connect(this.worldFilter);
    this.applyVolumes(true);
  }

  applyVolumes(instant = false) {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    const set = (param, v) => {
      if (instant) param.value = v;
      else param.setTargetAtTime(v, t, 0.03);
    };
    set(this.master.gain, s.muted ? 0 : volumeToGain(s.master) * OUTPUT_TRIM);
    set(this.buses.music.gain, volumeToGain(s.music));
    set(this.buses.ambience.gain, volumeToGain(s.ambience));
    set(this.wet.ambience.gain, volumeToGain(s.ambience));
    set(this.buses.sfx.gain, volumeToGain(s.sfx));
    set(this.wet.sfx.gain, volumeToGain(s.sfx));
    set(this.buses.ui.gain, volumeToGain(s.ui));
  }

  setVolume(bus, percent, save = true) {
    this.settings = normalizeSettings({ ...this.settings, [bus]: percent });
    this.applyVolumes();
    if (save) saveSettings(this.settings, this.storage);
    this.applyRunState();
    this.dispatchEvent(new Event('settings'));
  }

  // Souffle du vent de la vitesse : activé ou non (Options > Son).
  setWindNoise(on) {
    this.settings = normalizeSettings({ ...this.settings, windNoise: !!on });
    saveSettings(this.settings, this.storage);
    this.dispatchEvent(new Event('settings'));
  }

  setMuted(muted) {
    this.settings = normalizeSettings({ ...this.settings, muted: !!muted });
    saveSettings(this.settings, this.storage);
    this.applyVolumes();
    this.applyRunState();
    if (!muted) this.unlock();
    this.dispatchEvent(new Event('settings'));
  }

  // Pause : le monde passe derrière une vitre (passe-bas), la musique se met en retrait.
  setPaused(paused) {
    if (!this.ctx || paused === this.paused) return;
    this.paused = paused;
    const t = this.ctx.currentTime;
    this.worldFilter.frequency.setTargetAtTime(paused ? 650 : 20000, t, paused ? 0.08 : 0.15);
    this.world.gain.setTargetAtTime(paused ? 0.45 : 1, t, 0.1);
    this.musicFilter.frequency.setTargetAtTime(paused ? 1400 : 20000, t, 0.12);
    this.musicDuck.gain.setTargetAtTime(paused ? 0.5 : 1, t, 0.15);
  }

  // Retrait de la musique sous un effet important (objet, tour, départ) : -3 dB environ, puis retour en douceur.
  duckMusic(depth = 0.7, hold = 0.5) {
    if (!this.ctx) return;
    const g = this.musicSide.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(depth, t, 0.05);
    g.setTargetAtTime(1, t + hold, 0.6);
  }

  async setReverb(preset) {
    if (!this.ctx || this.reverbPreset === preset) return;
    this.reverbPreset = preset;
    try {
      const buf = await this.bank.load('impulse', { preset }, 2);
      if (this.reverbPreset !== preset) return;
      const t = this.ctx.currentTime;
      // Fondu court pour changer de réponse sans claquement.
      this.reverbOut.gain.setTargetAtTime(0, t, 0.05);
      setTimeout(() => {
        try {
          this.convolver.buffer = buf;
        } catch {
          /* rien */
        }
        this.reverbOut.gain.setTargetAtTime(REVERB_LEVEL, this.ctx.currentTime, 0.2);
      }, 250);
    } catch {
      /* pas de réverbération */
    }
  }

  // --- Écoute (caméra) ---
  // m : matrixWorld de la caméra Three.js (elements, colonne par colonne).
  setListener(m) {
    if (!this.ctx || !m) return;
    const e = m.elements || m;
    const L = this.ctx.listener;
    const x = e[12], y = e[13], z = e[14];
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];
    Object.assign(this.listener, { x, y, z, fx, fz });
    if (L.positionX) {
      L.positionX.value = x;
      L.positionY.value = y;
      L.positionZ.value = z;
      L.forwardX.value = fx;
      L.forwardY.value = fy;
      L.forwardZ.value = fz;
      L.upX.value = ux;
      L.upY.value = uy;
      L.upZ.value = uz;
    } else {
      L.setPosition?.(x, y, z);
      L.setOrientation?.(fx, fy, fz, ux, uy, uz);
    }
  }

  distanceTo(p) {
    const l = this.listener;
    return Math.hypot(p.x - l.x, (p.y ?? l.y) - l.y, p.z - l.z);
  }

  // --- Nœuds ---
  panner({ ref = 8, rolloff = 1, max = 2000, model } = {}) {
    const p = this.ctx.createPanner();
    p.panningModel = model || this.panningModel;
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = max;
    return p;
  }

  setPos(node, p) {
    if (node.positionX) {
      node.positionX.value = p.x;
      node.positionY.value = p.y ?? this.listener.y;
      node.positionZ.value = p.z;
    } else node.setPosition?.(p.x, p.y ?? this.listener.y, p.z);
  }

  stereoPanner(pan) {
    if (!this.ctx.createStereoPanner) return null;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    return p;
  }

  // Joue un échantillon. Renvoie la voix ({ src, gain, stop }) ou null (contexte arrêté, plafond atteint, trop loin).
  //   bus : 'sfx' | 'ambience' | 'ui' | 'music' ; pos : {x,y,z} pour une source 3D ; wet : part de réverbération
  play(buffer, o = {}) {
    if (!buffer || !this.running) return null;
    const spatial = !!o.pos;
    if (spatial && o.radius && this.distanceTo(o.pos) > o.radius) return null;
    if (this.voices.size >= this.maxVoices || (spatial && this.spatialCount >= this.maxSpatial)) {
      // Plafond atteint : un son important (départ, arrivée) remplace la plus ancienne voix d'ambiance.
      if (!(o.priority > 1) || !this.steal()) {
        this.stats.dropped++;
        return null;
      }
    }
    const c = this.ctx;
    const t = Math.max(c.currentTime, o.when ?? 0);
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = o.rate ?? 1;
    if (o.loop) src.loop = true;
    const g = c.createGain();
    const level = o.gain ?? 1;
    if (o.fadeIn) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + o.fadeIn);
    } else g.gain.value = level;
    let node = src;
    // Passe-bas demandé, ou absorption de l'air pour une source 3D lointaine (au-delà de 15 m)
    let lp = o.lowpass;
    if (!lp && spatial && o.air !== false) {
      const d = this.distanceTo(o.pos);
      if (d > 15) lp = distanceCutoff(d);
    }
    let filter = null;
    if (lp) {
      filter = biquad(c, 'lowpass', lp, 0.6);
      node.connect(filter);
      node = filter;
    }
    node.connect(g);
    let pan = null;
    let out = g;
    if (spatial) {
      pan = this.panner({ ref: o.ref, rolloff: o.rolloff, max: o.max, model: o.model });
      this.setPos(pan, o.pos);
      g.connect(pan);
      out = pan;
      this.spatialCount++;
    } else if (o.pan) {
      pan = this.stereoPanner(o.pan);
      if (pan) {
        g.connect(pan);
        out = pan;
      }
    }
    const bus = this.buses[o.bus || 'sfx'] || this.buses.sfx;
    out.connect(bus);
    let wet = null;
    if (o.wet && this.wet[o.bus || 'sfx']) {
      wet = c.createGain();
      wet.gain.value = o.wet;
      out.connect(wet).connect(this.wet[o.bus || 'sfx']);
    }
    const voice = { src, gain: g, pan, spatial, priority: o.priority ?? 1, started: t, done: false };
    voice.stop = (fade = 0.05) => {
      if (voice.done) return;
      const now = c.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + fade);
      try {
        src.stop(now + fade + 0.02);
      } catch {
        /* déjà arrêtée */
      }
    };
    src.onended = () => {
      voice.done = true;
      if (this.voices.delete(voice) && voice.spatial) this.spatialCount--;
      src.disconnect();
      g.disconnect();
      filter?.disconnect();
      pan?.disconnect();
      wet?.disconnect();
    };
    try {
      if (o.duration) src.start(t, o.offset ?? 0, o.duration);
      else src.start(t, o.offset ?? 0);
    } catch {
      return null;
    }
    this.voices.add(voice);
    this.stats.played++;
    return voice;
  }

  steal() {
    let victim = null;
    for (const v of this.voices) if (v.priority <= 1 && !v.done && (!victim || v.started < victim.started)) victim = v;
    if (!victim) return false;
    victim.stop(0.03);
    if (this.voices.delete(victim) && victim.spatial) this.spatialCount--;
    return true;
  }

  // Voix construite à la main (vagues, sources en boucle) : comptée dans le plafond, nettoyée à la fin de src.
  adopt(src, nodes, { spatial = false, priority = 1 } = {}) {
    const voice = { src, gain: nodes[0], spatial, priority, started: this.ctx.currentTime, done: false };
    voice.stop = (fade = 0.1) => {
      if (voice.done) return;
      const now = this.ctx.currentTime;
      const g = nodes[0].gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + fade);
      try {
        src.stop(now + fade + 0.02);
      } catch {
        /* déjà arrêtée */
      }
    };
    const srcs = Array.isArray(src) ? src : [src];
    voice.src = srcs[0];
    srcs[0].onended = () => {
      voice.done = true;
      if (this.voices.delete(voice) && voice.spatial) this.spatialCount--;
      for (const s of srcs) s.disconnect();
      for (const n of nodes) n.disconnect();
    };
    if (srcs.length > 1) {
      const stop = voice.stop;
      voice.stop = (fade) => {
        stop(fade);
        for (const s of srcs.slice(1)) {
          try {
            s.stop(this.ctx.currentTime + (fade ?? 0.1) + 0.02);
          } catch {
            /* rien */
          }
        }
      };
    }
    this.voices.add(voice);
    if (spatial) this.spatialCount++;
    return voice;
  }

  canPlay(spatial = false) {
    return this.running && this.voices.size < this.maxVoices && (!spatial || this.spatialCount < this.maxSpatial);
  }

  // Vumètres (tests et réglage du mélange uniquement) : RMS et crête de chaque bus et de la sortie finale.
  meter() {
    if (!this.ctx) return null;
    if (!this.meters) {
      this.meters = {};
      const taps = { ...this.buses, world: this.worldFilter, out: this.out.clip };
      // (out : après le limiteur et l'écrêteur, c'est ce qu'entend le joueur)
      for (const [k, n] of Object.entries(taps)) {
        const a = this.ctx.createAnalyser();
        a.fftSize = 4096;
        a.smoothingTimeConstant = 0;
        n.connect(a);
        this.meters[k] = { a, buf: new Float32Array(4096), spec: new Float32Array(2048) };
      }
    }
    const read = () => {
      const res = {};
      for (const [k, m] of Object.entries(this.meters)) {
        m.a.getFloatTimeDomainData(m.buf);
        let s = 0;
        let p = 0;
        for (const x of m.buf) {
          s += x * x;
          p = Math.max(p, Math.abs(x));
        }
        m.a.getFloatFrequencyData(m.spec);
        res[k] = { rms: Math.sqrt(s / m.buf.length), peak: p, spec: Array.from(m.spec) };
      }
      return res;
    };
    return { read, sampleRate: this.ctx.sampleRate };
  }

  // Source en boucle d'un bruit de base (rose, brun, blanc), départ au hasard dans la boucle.
  // opts : { rate } ou directement la vitesse de lecture (nombre).
  noise(color = 'pink', opts = {}) {
    const rate = typeof opts === 'number' ? opts : opts.rate ?? 1;
    const buf = this.bank.get('noise', { color, seconds: 6 });
    if (!buf) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start(this.ctx.currentTime, Math.random() * buf.duration);
    return src;
  }
}
