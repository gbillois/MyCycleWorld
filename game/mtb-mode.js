// VTT en jeu (circuit en forêt) : relie les règles pures (src/core/mtb.js, appliquées par race.js) à l'écran.
// Impulsions (puissance, tapotements, Espace / ↑, boutons des manettes), indicateur « Saute ! » avec sa
// fenêtre, messages (« Parfait ! », « Trop tôt »...), vol et compression à la réception, chute (vélo couché,
// cycliste qui roule) puis réapparition, gerbes d'eau dans le ruisseau, poussière, boue, sons.
// Aucune allocation par image : objets de travail réutilisés, textes réécrits seulement s'ils changent.
import { ImpulseDetector, MTB, crashPose } from '../src/core/mtb.js';
import { msToKmh } from '../src/core/physics.js';

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export class MtbMode {
  constructor({ hud, audio, devices }) {
    this.hud = hud;
    this.audio = audio;
    this.devices = devices;
    this.detector = new ImpulseDetector();
    this.race = null;
    this.track = null;
    this.scenery = null;
    this.models = null;
    this.shake = 0;
    this.fxClock = 0;
    this.sfxClock = 0;
    this.cueShown = false;
    this.cueText = '';
    this.handlers = null;
    this.buildHud();
  }

  get active() {
    return !!(this.race && this.race.mtb);
  }

  // Indicateur de saut : barre avec la zone parfaite au centre, curseur qui s'en approche.
  buildHud() {
    const root = $('hud');
    if (!root || $('mtbCue')) return;
    const el = document.createElement('div');
    el.id = 'mtbCue';
    el.className = 'mtb-cue';
    el.hidden = true;
    el.innerHTML = '<div class="mtb-cue-label">Saute !</div><div class="mtb-cue-bar"><span class="z-ok"></span><span class="z-good"></span><span class="z-perfect"></span><span class="mtb-cue-mark" id="mtbMark"></span></div><div class="mtb-cue-hint" id="mtbHint"></div>';
    root.appendChild(el);
    this.cue = el;
    this.mark = el.querySelector('#mtbMark');
    this.hint = el.querySelector('#mtbHint');
  }

  // Nouvelle course (ou aperçu de l'accueil).
  attach(race, track, models, scenery) {
    this.detach();
    this.race = race;
    this.track = track;
    this.models = models;
    this.scenery = scenery;
    this.detector.reset();
    this.shake = 0;
    this.blinkUntil = -Infinity;
    if (this.cue) this.cue.hidden = true;
    this.cueShown = false;
    if (!race.mtb) return;
    const mine = (d) => d?.racer?.isPlayer;
    const fxAt = (r, n, type, spread = 0.5) => {
      const fx = this.scenery?.fx;
      if (!fx) return;
      const f = track.frame(r.s, r.lateral, this.tmpF || (this.tmpF = {}));
      fx.burst(f.x, f.y + 0.05, f.z, f.tx * r.v, f.tz * r.v, n, type, spread);
    };
    const h = {
      takeoff: ({ detail: d }) => {
        if (mine(d)) this.audio?.sfx('jump', { gain: 0.8 });
      },
      jump: ({ detail: d }) => {
        if (!mine(d)) return;
        if (d.grade === 'perfect') {
          this.hud.flash(`${d.label} +${Math.round(msToKmh(d.bonus))} km/h`, 1300, 'good');
          this.audio?.sfx('jump-perfect');
          this.shake = Math.max(this.shake, 0.25);
        } else if (d.grade === 'good') {
          this.hud.flash(`${d.label} +${Math.round(msToKmh(d.bonus))} km/h`, 1100, 'good');
          this.audio?.sfx('jump-perfect', { gain: 0.6, rate: 0.9 });
        } else if (d.grade === 'early' || d.grade === 'late') this.hud.flash(`${d.label} · +${Math.round(msToKmh(d.bonus))} km/h`, 1000);
      },
      land: ({ detail: d }) => {
        const r = d.racer;
        fxAt(r, r.isPlayer ? 10 : 5, 1, 0.8);
        if (r.isPlayer) {
          this.audio?.sfx('land', { gain: 0.5 + d.impact * 0.6 });
          this.shake = Math.max(this.shake, 0.2 + d.impact * 0.35);
          this.devices?.vibrate?.();
        }
      },
      crash: ({ detail: d }) => {
        if (!mine(d)) return;
        this.hud.flash('Chute ! Reste sur le sentier', 2200, 'bad');
        this.audio?.sfx('crash');
        this.shake = 1.1;
        fxAt(d.racer, 14, 1, 1);
        this.devices?.vibrate?.();
      },
      respawn: ({ detail: d }) => {
        if (!mine(d)) return;
        this.hud.flash('C’est reparti !', 900, 'good');
        this.blinkUntil = performance.now() + 900;
      },
    };
    for (const [k, fn] of Object.entries(h)) race.addEventListener(k, fn);
    this.handlers = h;
  }

  detach() {
    if (this.race && this.handlers) for (const [k, fn] of Object.entries(this.handlers)) this.race.removeEventListener(k, fn);
    this.handlers = null;
    this.race = null;
    if (this.cue) this.cue.hidden = true;
  }

  // Le prochain saut est-il assez proche pour qu'Espace serve d'impulsion (et pas à utiliser l'objet) ?
  wantsKey() {
    if (!this.active) return false;
    const c = this.race.mtb.cue(this.race.player);
    const p = this.race.player;
    return !!c || (p.air && p.lateOpen);
  }

  // Appui sur une touche (front montant) : Espace ou ↑ (et les boutons des manettes qui les envoient).
  key() {
    if (!this.active) return;
    this.detector.key(this.race.time);
  }

  tap() {
    if (!this.active) return;
    this.detector.tap(this.race.time);
  }

  // À chaque image, avant race.update : puissance pour détecter un coup de pédale, impulsion transmise.
  input(input, { power }) {
    if (!this.active) return input;
    if (this.race.time > -1) this.detector.power(this.race.time, power);
    input.impulseAt = this.detector.last;
    return input;
  }

  // Pose du coureur : bosse du virage relevé, hauteur du saut, cabrage en l'air, compression, chute.
  // Appelé par syncScene avant l'orientation finale ; renvoie le tangage et le roulis ajoutés dans out.
  pose(r, m, dt, out) {
    out.pitch = 0;
    out.roll = 0;
    out.dy = 0;
    if (!this.active) return out;
    const td = this.scenery?.trail;
    const t = this.race.time;
    const mtb = this.race.mtb;
    let dy = (td ? td.bankAt(r.s, r.lateral) : 0) + (r.hop || 0);
    // Sur la rampe : le vélo suit la pente ; en l'air : il suit sa trajectoire, nez qui replonge à la fin.
    if (r.air) {
      out.pitch = -Math.atan2(r.vy || 0, Math.max(r.v, 2)) * 0.8;
    } else if (r.hop > 0.01) {
      const g0 = mtb.groundAt(r.s - 0.4);
      const g1 = mtb.groundAt(r.s + 0.4);
      out.pitch = -Math.atan2(g1 - g0, 0.8);
    }
    // Réception : le cycliste encaisse (descend un peu), puis se relève
    dy -= (r.land || 0) * 0.09;
    const crashed = r.crashAt !== undefined && t >= r.crashAt && t < r.crashUntil;
    const body = m.body;
    if (crashed) {
      const p = crashPose(t - r.crashAt);
      out.roll = r.crashSide * p.tilt * 1.38;
      dy += 0.05 * p.tilt;
      if (body) {
        // Le cycliste part en roulade vers l'avant et sur le côté du vélo
        const k = p.tumble;
        body.rotation.set(Math.sin(k) * 0.9 + p.tilt * 0.4, 0, -r.crashSide * p.tilt * 0.35);
        body.position.set(-r.crashSide * p.tilt * 0.35, -p.tilt * 0.32, p.tilt * 0.75);
      }
    } else if (body && (body.rotation.x !== 0 || body.position.z !== 0)) {
      body.rotation.set(0, 0, 0);
      body.position.set(0, 0, 0);
    }
    if (r.isPlayer) {
      // Clignote un instant après la réapparition
      const blink = performance.now() < this.blinkUntil;
      m.group.visible = blink ? Math.floor(performance.now() / 90) % 2 === 0 : m.group.visible;
    }
    // Debout sur les pédales en l'air et dans les pierriers
    if (m.setPose && (r.air || r.hop > 0.05 || r.surface === 'rock' || r.surface === 'roots')) {
      m.pose = Math.min(1, (m.pose ?? 0) + dt * 5);
      m.setPose(m.pose);
    }
    // Pierrier et racines : le vélo tressaute
    if (!r.air && (r.surface === 'rock' || r.surface === 'roots') && r.v > 1) {
      const a = r.surface === 'rock' ? 0.035 : 0.018;
      dy += Math.abs(Math.sin(r.s * 7.3) * Math.sin(r.s * 3.1)) * a;
      out.pitch += Math.sin(r.s * 5.7) * a * 0.6;
    }
    out.dy = dy;
    return out;
  }

  // Hauteur ajoutée à la caméra (suit le saut) et secousse.
  cameraLift() {
    if (!this.active) return 0;
    const p = this.race.player;
    return (p.hop || 0) * 0.65;
  }

  takeShake(dt) {
    const s = this.shake;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    return s;
  }

  // Image par image en course : indicateur de saut, gerbes du ruisseau, boue, sons de surface.
  frame(dt, state, ui = {}) {
    if (!this.active) return;
    const race = this.race;
    const p = race.player;
    const racing = state === 'race' && race.time >= 0;
    this.updateCue(racing ? race.mtb.cue(p) : null, p, ui);
    // Gerbes d'eau (tous les coureurs proches dans le ruisseau), boue projetée
    this.fxClock -= dt;
    this.sfxClock -= dt;
    if (this.fxClock <= 0 && this.scenery?.fx) {
      this.fxClock = 0.07;
      const f = this.tmpF || (this.tmpF = {});
      for (const r of race.racers) {
        if (r.air || r.v < 1.2 || Math.abs(r.s - p.s) > 60) continue;
        const surf = r.surface;
        if (surf !== 'creek' && surf !== 'mud') continue;
        this.track.frame(r.s, r.lateral, f);
        const n = surf === 'creek' ? Math.min(6, 1 + Math.round(r.v * 0.6)) : 2;
        this.scenery.fx.burst(f.x, f.y + 0.08, f.z, f.tx * r.v, f.tz * r.v, n, surf === 'creek' ? 0 : 2, 0.35);
      }
    }
    if (racing && this.sfxClock <= 0 && !p.air && p.v > 1.2) {
      if (p.surface === 'creek') {
        this.sfxClock = 0.32 - Math.min(0.15, p.v * 0.015);
        this.audio?.sfx('splash', { gain: 0.35 + Math.min(0.5, p.v * 0.06), rate: 0.9 + Math.random() * 0.25 });
      } else if (p.surface === 'mud') {
        this.sfxClock = 0.45;
        this.audio?.sfx('mud', { gain: 0.6 });
      } else this.sfxClock = 0.2;
    }
  }

  updateCue(c, p, ui) {
    if (!this.cue) return;
    const lateOpen = p.air && p.lateOpen;
    const show = !!c || lateOpen;
    if (show !== this.cueShown) {
      this.cueShown = show;
      this.cue.hidden = !show;
    }
    if (!show) return;
    // Position du curseur : à gauche quand la lèvre est loin, au centre au moment parfait, à droite en retard.
    const eta = c ? c.eta : -(this.race.time - p.lipTime);
    const x = clamp(-eta / MTB.cue, -1.15, MTB.late / MTB.cue + 0.05);
    this.mark.style.transform = `translateX(${(x * 50).toFixed(1)}cqw)`;
    const hot = Math.abs(eta) <= MTB.good;
    if (hot !== this.cueHot) {
      this.cueHot = hot;
      this.cue.classList.toggle('hot', hot);
    }
    const hint = ui.trainer ? 'Coup de pédale !' : ui.touch ? 'Double tape l’écran !' : 'Espace ou ↑ (ou double clic)';
    if (hint !== this.cueText) {
      this.cueText = hint;
      this.hint.textContent = hint;
    }
  }
}
