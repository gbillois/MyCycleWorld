// VTT en forêt : sauts avec impulsion au bon moment, chutes hors de la piste, réapparition, dérive dans les
// virages serrés (module pur, testé dans tests/mtb.test.js). Aucune dépendance au navigateur ni à Three.js.
//
// Un saut (« kicker ») : rampe de len m qui monte jusqu'à la lèvre (hauteur h, position s), puis un trou
// et une réception en pente douce. En passant la lèvre, une impulsion donnée au bon moment (coup de
// puissance, double tapotement, Espace ou ↑, bouton de manette) donne un bonus de vitesse et un plus
// beau vol ; sans impulsion, on passe la bosse avec un petit saut.
//
// Les coureurs sont des objets simples (voir game/race.js) : s, lateral, heading, yawRate, lean, v.
// État ajouté ici : hop (hauteur au-dessus de la piste, m), air, vy, airT, land (compression 0..1),
// crashAt, crashUntil, crashSide, impulseAt (temps de course de la dernière impulsion).

import { stepSteering, STEER } from './steering.js';

export const MTB = Object.freeze({
  crashMargin: 1.0, // m au-delà du bord de la piste : on tombe
  crashTime: 2.6, // s de pénalité, chute comprise
  fallTime: 0.9, // s de glissade avant l'arrêt
  respawnSpeed: 2.5, // m/s en repartant du milieu de la piste
  // Fenêtre autour de la lèvre (s) : écart entre l'impulsion et le passage de la lèvre.
  perfect: 0.15,
  good: 0.32,
  early: 0.7, // une impulsion jusqu'à 0,7 s avant compte encore (petit bonus)
  late: 0.45, // et jusqu'à 0,45 s après la lèvre, en l'air
  bonus: { perfect: 1.9, good: 1.1, early: 0.45, late: 0.45, none: 0 }, // m/s gagnés
  lift: { perfect: 1.6, good: 1.0, early: 0.35, late: 0.5, none: 0 }, // m/s de vitesse verticale en plus
  pop: { perfect: 1, good: 1, early: 0.75, late: 0.4, none: 0.4 }, // part de l'élan de la rampe conservé
  gravity: 9.81 * 0.85, // un peu de flottement en l'air (sensation de jeu)
  cue: 1.7, // s avant la lèvre : l'indicateur « Saute ! » apparaît
  gap: 1.4, // m entre la lèvre et le début de la réception
  landLen: 4.5, // m de réception en pente douce
  landRatio: 0.55, // hauteur de la réception / hauteur de la lèvre
  tapDouble: 0.33, // s : deux tapotements aussi rapprochés = une impulsion
  tapBurst: 0.8, // s : ou trois tapotements dans cette durée
  powerLatency: 0.3, // s : la puissance d'un home trainer arrive en retard, on l'avance d'autant
  // Dérive dans les virages serrés (pilotage manuel) : rien au-delà de ~28 m de rayon, 80 % sous ~10 m.
  driftFrom: 0.035,
  driftTo: 0.1,
  driftMax: 0.8,
});

export const JUMP_LABELS = { perfect: 'Parfait !', good: 'Bien joué !', early: 'Trop tôt', late: 'Trop tard', none: '' };

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (t) => t * t * (3 - 2 * t);
const mod = (a, n) => ((a % n) + n) % n;

// Note d'un saut selon l'écart (s) entre l'impulsion et la lèvre (négatif = avant). null = aucune impulsion.
export function gradeJump(offset, cfg = MTB) {
  let grade = 'none';
  if (offset !== null && offset !== undefined && Number.isFinite(offset)) {
    const a = Math.abs(offset);
    if (offset < -cfg.early || offset > cfg.late) grade = 'none';
    else if (a <= cfg.perfect) grade = 'perfect';
    else if (a <= cfg.good) grade = 'good';
    else grade = offset < 0 ? 'early' : 'late';
  }
  return { grade, bonus: cfg.bonus[grade], lift: cfg.lift[grade], pop: cfg.pop[grade], label: JUMP_LABELS[grade] };
}

// Hauteur du sol au-dessus de la piste près d'un saut : rampe incurvée puis réception (m).
export function kickerHeight(d, jump, cfg = MTB) {
  // d : distance le long de la piste par rapport à la lèvre (m, négatif avant)
  const { len, h } = jump;
  if (d >= -len && d <= 0) return h * Math.pow((d + len) / len, 1.6);
  const l0 = cfg.gap;
  const l1 = cfg.gap + cfg.landLen;
  const hl = h * cfg.landRatio;
  if (d > l0 * 0.6 && d < l0) return hl * smooth((d - l0 * 0.6) / (l0 * 0.4)); // face avant de la réception
  if (d >= l0 && d <= l1) return hl * (1 - smooth((d - l0) / (l1 - l0)));
  return 0;
}

// Angle de la rampe à la lèvre (rad).
export function lipAngle(jump) {
  return Math.atan((1.6 * jump.h) / jump.len);
}

// Part de la dérive dans un virage de courbure k (1/m) : 0 dans les grandes courbes, driftMax dans les épingles.
export function trailDrift(k, cfg = MTB) {
  const a = Math.abs(k);
  return smooth(clamp((a - cfg.driftFrom) / (cfg.driftTo - cfg.driftFrom), 0, 1)) * cfg.driftMax;
}

// Faut-il tomber ? Hors de la piste de plus de crashMargin, sans pilote automatique, roues au sol.
export function shouldCrash({ lateral, half, auto = false, airborne = false, margin = MTB.crashMargin }) {
  if (auto || airborne) return false;
  return Math.abs(lateral) > half + margin;
}

// Pose de la chute selon le temps écoulé depuis le début (s) : vélo couché, cycliste qui roule, relevé.
// tilt : inclinaison du vélo (0..1 = couché), tumble : roulade du cycliste (rad), rise : relevé (0..1).
export function crashPose(elapsed, cfg = MTB) {
  const e = Math.max(0, elapsed);
  const fall = clamp(e / 0.45, 0, 1);
  const tilt = smooth(fall);
  const tumble = Math.min(1, e / cfg.fallTime) * Math.PI * 1.6;
  const riseStart = cfg.crashTime - 0.6;
  const rise = e > riseStart ? smooth(clamp((e - riseStart) / 0.6, 0, 1)) : 0;
  return { tilt: tilt * (1 - rise), tumble: tumble * (1 - rise), rise, slide: Math.min(e, cfg.fallTime) };
}

// --- Détection des impulsions (temps en secondes de course) ---
// Puissance : moyenne des 0,6 dernières secondes comparée à la moyenne de [-3,5 s ; -0,9 s] (la base du
// cycliste). Tapotements : double tapotement ou rafale. Touches : chaque nouvel appui.
const RING = 512;
export class ImpulseDetector {
  constructor(cfg = MTB) {
    this.cfg = cfg;
    this.t = new Float64Array(RING);
    this.w = new Float32Array(RING);
    this.n = 0;
    this.head = 0;
    this.taps = new Float64Array(4);
    this.tapCount = 0;
    this.last = -Infinity; // temps de la dernière impulsion
    this.source = null;
    this.cool = -Infinity;
  }

  reset() {
    this.n = 0;
    this.head = 0;
    this.tapCount = 0;
    this.last = -Infinity;
    this.source = null;
    this.cool = -Infinity;
  }

  fire(t, source) {
    this.last = t;
    this.source = source;
  }

  // Moyenne de la puissance entre a et b (temps de course), NaN sans échantillon.
  mean(a, b) {
    let sum = 0;
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      const j = (this.head - 1 - i + RING) % RING;
      const tt = this.t[j];
      if (tt < a) break;
      if (tt <= b) {
        sum += this.w[j];
        k++;
      }
    }
    return k ? sum / k : NaN;
  }

  // Un échantillon de puissance (une fois par image, ou à chaque mesure du home trainer).
  power(t, watts) {
    if (this.n && t < this.t[(this.head - 1 + RING) % RING]) this.n = 0; // nouvelle course : le temps repart
    this.t[this.head] = t;
    this.w[this.head] = Math.max(0, watts || 0);
    this.head = (this.head + 1) % RING;
    this.n = Math.min(RING, this.n + 1);
    if (t < this.cool) return false;
    const base = this.mean(t - 3.5, t - 0.9);
    const recent = this.mean(t - 0.6, t);
    if (!Number.isFinite(base) || !Number.isFinite(recent)) return false;
    if (recent >= base * 1.25 + 35 && recent - base >= 55) {
      this.fire(t - this.cfg.powerLatency, 'power');
      this.cool = t + 1.2;
      return true;
    }
    return false;
  }

  tap(t) {
    const c = this.cfg;
    this.taps[this.tapCount % 4] = t;
    this.tapCount++;
    const at = (k) => this.taps[(this.tapCount - 1 - k + 4) % 4];
    if (this.tapCount >= 2 && t - at(1) <= c.tapDouble) {
      this.fire(t, 'tap');
      return true;
    }
    if (this.tapCount >= 3 && t - at(2) <= c.tapBurst) {
      this.fire(t, 'tap');
      return true;
    }
    return false;
  }

  key(t) {
    this.fire(t, 'key');
    return true;
  }
}

// --- Règles du VTT, appliquées aux coureurs par la course (game/race.js) ---
// length, half : longueur du tour et demi-largeur de la piste ; jumps : [{ s (lèvre), len, h }] ;
// yAt(s) : altitude de la piste (facultatif : en descente, la piste s'éloigne sous les roues et le vol s'allonge).
export class MtbRules {
  constructor({ length, half, jumps = [], random = Math.random, emit = () => {}, yAt = null, cfg = MTB }) {
    this.length = length;
    this.half = half;
    this.jumps = jumps.map((j, i) => ({ id: i, s: mod(j.s, length), len: j.len ?? 5, h: j.h ?? 0.8 })).sort((a, b) => a.s - b.s);
    this.random = random;
    this.emit = emit;
    this.cfg = cfg;
    this.yAt = yAt || (() => 0);
    this.steerCfg = { ...STEER };
  }

  // Hauteur du sol (rampe ou réception) au-dessus de la piste en s.
  groundAt(s) {
    const x = mod(s, this.length);
    for (const j of this.jumps) {
      let d = x - j.s;
      if (d > this.length / 2) d -= this.length;
      if (d < -this.length / 2) d += this.length;
      if (d >= -j.len && d <= this.cfg.gap + this.cfg.landLen) return kickerHeight(d, j, this.cfg);
    }
    return 0;
  }

  // Prochain saut devant s (dans maxAhead m) : { jump, dist } ou null.
  nextJump(s, maxAhead = 80) {
    const x = mod(s, this.length);
    let best = null;
    for (const j of this.jumps) {
      const d = mod(j.s - x, this.length);
      if (d <= maxAhead && (!best || d < best.dist)) best = { jump: j, dist: d };
    }
    return best;
  }

  // Temps (s) avant la prochaine lèvre au rythme actuel, et cette lèvre ; null s'il n'y en a pas d'imminente.
  cue(r) {
    if (this.down(r, Infinity) || r.air) return null;
    const n = this.nextJump(r.s, 60);
    if (!n) return null;
    const eta = n.dist / Math.max(r.v, 0.5);
    return eta <= this.cfg.cue + 0.6 ? { eta, jump: n.jump, dist: n.dist } : null;
  }

  down(r, t) {
    return r.crashUntil !== undefined && t < r.crashUntil;
  }

  // Pilotage manuel : le vélo continue tout droit dans les épingles si on ne tourne pas soi-même.
  steer(r, command, v, curvature, dt, limit) {
    const drift = trailDrift(curvature, this.cfg);
    // On se redresse moins vite par rapport à la piste quand elle tourne fort sous les roues.
    this.steerCfg.straightenTime = STEER.straightenTime / Math.max(0.12, 1 - drift);
    stepSteering(r, command, v, curvature, dt, limit, this.steerCfg);
    if (drift > 0) {
      r.heading -= drift * v * curvature * dt;
      const m = this.steerCfg.maxHeading;
      if (Math.abs(r.heading) > m) r.heading = Math.sign(r.heading) * m;
    }
    return drift;
  }

  // Un pas de temps après le déplacement du coureur : sauts, réception, chute, réapparition.
  // ctx : { auto (pilote automatique du joueur), skill (0..1, adversaires) }
  step(r, dt, t, ctx = {}) {
    const c = this.cfg;
    if (r.hop === undefined) Object.assign(r, { hop: 0, air: false, vy: 0, airT: 0, land: 0, lateOpen: false, usedImpulse: -Infinity });
    r.land = Math.max(0, r.land - dt * 2.6);
    // À terre : glissade, puis attente, puis on repart du milieu de la piste.
    if (r.crashUntil !== undefined && r.crashAt !== undefined && t >= r.crashAt) {
      if (t < r.crashUntil) {
        r.v = t - r.crashAt < c.fallTime ? r.v * Math.exp(-dt * 4) : 0;
        r.hop = Math.max(0, r.hop - dt * 3);
        return 'down';
      }
      if (!r.respawned) {
        r.respawned = true;
        Object.assign(r, { lateral: 0, heading: 0, yawRate: 0, lean: 0, hop: 0, air: false, vy: 0, v: Math.max(r.v, c.respawnSpeed) });
        this.emit('respawn', { racer: r });
      }
    }
    if (r.air) {
      r.airT += dt;
      const g = c.gravity;
      // Impulsion tardive (juste après la lèvre) : encore un petit bonus, et un peu plus de hauteur.
      if (r.lateOpen) {
        const off = r.impulseAt - r.lipTime;
        if (r.impulseAt > r.usedImpulse && off >= 0 && off <= c.late) {
          r.lateOpen = false;
          r.usedImpulse = r.impulseAt;
          const res = gradeJump(off, c);
          this.apply(r, res, true);
        } else if (t - r.lipTime > c.late) {
          r.lateOpen = false;
          this.emit('jump', { racer: r, grade: 'none', bonus: 0, label: '' });
        }
      }
      const hop = r.h0 + r.vy0 * r.airT - 0.5 * g * r.airT * r.airT - (this.yAt(r.s) - r.yLip);
      const ground = this.groundAt(r.s);
      if (hop <= ground && r.airT > 0.06) {
        const vyNow = r.vy0 - g * r.airT;
        r.air = false;
        r.hop = ground;
        r.land = clamp(-vyNow / 5, 0.25, 1);
        this.emit('land', { racer: r, impact: r.land, air: r.airT });
        if (r.lateOpen) {
          r.lateOpen = false;
          this.emit('jump', { racer: r, grade: 'none', bonus: 0, label: '' });
        }
      } else {
        r.hop = hop;
        r.vy = r.vy0 - g * r.airT;
        return 'air';
      }
    } else {
      r.hop = this.groundAt(r.s);
      // Passage d'une lèvre pendant ce pas : décollage.
      const travelled = r.s - (r.prevS ?? r.s);
      if (travelled > 0) {
        for (const j of this.jumps) {
          const past = mod(r.s - j.s, this.length);
          if (past > travelled || past > 6) continue;
          this.takeoff(r, j, t - past / Math.max(r.v, 0.5), ctx);
          break;
        }
      }
    }
    if (r.isPlayer && shouldCrash({ lateral: r.lateral, half: this.half, auto: ctx.auto, airborne: r.air, margin: c.crashMargin })) this.crash(r, t);
    return r.air ? 'air' : 'ride';
  }

  takeoff(r, j, tLip, ctx) {
    const c = this.cfg;
    r.lipTime = tLip;
    r.lipId = j.id;
    let res;
    if (r.isPlayer) {
      const off = r.impulseAt !== undefined && r.impulseAt > r.usedImpulse ? r.impulseAt - tLip : null;
      if (off !== null && off >= -c.early && off <= 0) {
        r.usedImpulse = r.impulseAt;
        res = gradeJump(off, c);
      } else {
        res = gradeJump(null, c);
        r.lateOpen = true; // on attend encore une impulsion tardive
      }
    } else {
      // Adversaires : réussite selon leur niveau.
      const x = this.random() * (0.6 + (ctx.skill ?? 0.5) * 0.6);
      res = gradeJump(x > 0.85 ? 0.05 : x > 0.5 ? 0.25 : x > 0.25 ? -0.5 : null, c);
    }
    const a = lipAngle(j);
    r.air = true;
    r.airT = 0;
    r.h0 = j.h;
    r.yLip = this.yAt(j.s);
    r.vy0 = Math.max(0.6, r.v * Math.sin(a) * res.pop);
    r.vy = r.vy0;
    r.hop = j.h;
    this.emit('takeoff', { racer: r, jump: j });
    if (!r.lateOpen) this.apply(r, res, false);
  }

  // Bonus du saut : vitesse et hauteur (une impulsion tardive relance le vol en cours).
  apply(r, res, late) {
    r.v += res.bonus;
    if (res.lift > 0) {
      if (late) {
        // Vol en cours : on ajoute la poussée à partir de maintenant.
        const g = this.cfg.gravity;
        const hop = r.h0 + r.vy0 * r.airT - 0.5 * g * r.airT * r.airT;
        const vyNow = r.vy0 - g * r.airT + res.lift;
        r.h0 = hop;
        r.vy0 = Math.max(vyNow, res.lift);
        r.airT = 0;
      } else r.vy0 += res.lift;
    }
    r.jumpGrade = res.grade;
    this.emit('jump', { racer: r, grade: res.grade, bonus: res.bonus, label: res.label });
  }

  crash(r, t) {
    const c = this.cfg;
    r.crashAt = t;
    r.crashUntil = t + c.crashTime;
    r.crashSide = r.lateral >= 0 ? 1 : -1;
    r.respawned = false;
    r.air = false;
    r.lateOpen = false;
    this.emit('crash', { racer: r, side: r.crashSide, speed: r.v });
  }
}
