// Logique de course, sans rendu : coureurs, IA, boîtes à objets, peaux de banane, classement.
// Toutes les durées sont en secondes de course (this.time), les distances en mètres.
import { stepSpeed, bestDraftFactor, DEFAULTS } from '../src/core/physics.js';
import { stepSteering, forwardSpeed, headingTowards } from '../src/core/steering.js';
import { ROAD_HALF, LATERAL_LIMIT, mod } from './track.js';
import { SURFACES } from './courses.js';

export const ITEMS = {
  turbo: { label: 'Turbo', icon: '🚀' },
  banana: { label: 'Peau de banane', icon: '🍌' },
};

export const EFFECT_DURATION = 3; // turbo et glissade sur banane
const TURBO_POWER = 380; // W "virtuels" ajoutés pendant le turbo
const GRASS_CRR = 0.035; // rouler dans l'herbe freine nettement
const BANANA_SPEED_KEEP = 0.35; // fraction de vitesse conservée après une banane (joueur)
const BOX_RESPAWN = 4;
// Position des rangées de boîtes sur le tour (fraction de la longueur), loin de la ligne de départ.
const BOX_ROWS = [0.05, 0.17, 0.29, 0.41, 0.53, 0.65, 0.77, 0.89];
const BOX_CATCH = 1.3; // largeur de capture (m) : un peu plus que le rayon visuel de la boîte
const BANANA_LIFETIME = 90;
const COUNTDOWN = 3;

const AI_PROFILES = [
  { name: 'Lucie', color: '#e63946', helmet: '#ffd23f', bike: '#1d3557', power: 150 },
  { name: 'Marco', color: '#2a9d8f', helmet: '#ffffff', bike: '#264653', power: 180 },
  { name: 'Inès', color: '#9b5de5', helmet: '#f15bb5', bike: '#3a0ca3', power: 205 },
  { name: 'Hugo', color: '#f4a261', helmet: '#222222', bike: '#e76f51', power: 230 },
  { name: 'Yuki', color: '#00b4d8', helmet: '#ffffff', bike: '#023e8a', power: 260 },
];

export class Racer {
  constructor({ id, name, color, helmet, bike, isPlayer = false, basePower = 0, s = 0, lateral = 0 }) {
    Object.assign(this, { id, name, color, helmet, bike, isPlayer, basePower, s, lateral });
    this.v = 0;
    this.power = 0;
    this.cadence = 0;
    this.crank = Math.random() * Math.PI * 2;
    this.item = null;
    this.turboUntil = -Infinity;
    this.slipUntil = -Infinity; // glissade sur banane
    this.finishTime = null;
    this.draft = 1;
    // Direction (voir src/core/steering.js) : cap par rapport à la route, vitesse de lacet, inclinaison.
    this.heading = 0;
    this.yawRate = 0;
    this.lean = 0;
    this.targetLateral = lateral;
    this.nextLaneChange = 2 + Math.random() * 6;
    this.useItemAt = null;
    this.phase = Math.random() * 100;
  }
  turbo(t) {
    return t < this.turboUntil;
  }
  slipping(t) {
    return t < this.slipUntil;
  }
}

export class Race extends EventTarget {
  constructor(track, { laps = 3, playerName = 'Toi', random = Math.random } = {}) {
    super();
    this.track = track;
    this.laps = laps;
    this.random = random;
    this.time = -COUNTDOWN;
    this.state = 'countdown'; // countdown | racing | finished
    this.distance = laps * track.length;
    this.racers = [];
    this.bananas = [];
    this.bananaId = 0;
    // Météo (game/weather.js) : { tailwindAt(s), crrFactor, steer } ; null = temps neutre (comportement d'origine).
    this.weather = null;

    // Grille de départ : deux par rangée, le joueur en deuxième ligne.
    const order = [AI_PROFILES[4], AI_PROFILES[3], null, AI_PROFILES[2], AI_PROFILES[1], AI_PROFILES[0]];
    order.forEach((p, i) => {
      const row = Math.floor(i / 2);
      const s = -4 - row * 4;
      const lateral = i % 2 ? 1.6 : -1.6;
      if (!p) {
        this.player = new Racer({ id: 0, name: playerName, color: '#ff5a1f', helmet: '#ffffff', bike: '#16181d', isPlayer: true, s, lateral });
        this.racers.push(this.player);
      } else {
        this.racers.push(new Racer({ id: this.racers.length, name: p.name, color: p.color, helmet: p.helmet, bike: p.bike, basePower: p.power, s, lateral }));
      }
    });

    // Boîtes à objets : 8 rangées par tour, en quinconce (3 de front, puis 2 décalées).
    this.boxes = [];
    BOX_ROWS.forEach((frac, row) => {
      for (const lateral of row % 2 === 0 ? [-2.6, 0, 2.6] : [-1.3, 1.3]) {
        this.boxes.push({ s: frac * track.length, lateral, respawnAt: 0 });
      }
    });
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  lapOf(r) {
    return Math.min(this.laps, Math.max(1, Math.floor(r.s / this.track.length) + 1));
  }

  // Classement : arrivés par temps, puis les autres par distance parcourue.
  ranking() {
    return [...this.racers].sort((a, b) => {
      if (a.finishTime !== null && b.finishTime !== null) return a.finishTime - b.finishTime;
      if (a.finishTime !== null) return -1;
      if (b.finishTime !== null) return 1;
      return b.s - a.s;
    });
  }

  positionOf(r) {
    return this.ranking().indexOf(r) + 1;
  }

  // input = { power, cadence, steer (-1..1), drift (bool) } pour le joueur.
  update(dt, input) {
    const prevTime = this.time;
    this.time += dt;
    const t = this.time;
    if (prevTime < 0 && t >= 0) {
      this.state = 'racing';
      this.emit('go');
    }
    const p = this.player;
    p.power = input.power;
    p.cadence = input.cadence;
    if (t < 0) {
      // Compte à rebours : on peut déjà pédaler, mais on ne part pas.
      for (const r of this.racers) r.crank += (r.isPlayer ? r.cadence : 0) / 60 * Math.PI * 2 * dt;
      return;
    }

    for (const r of this.racers) {
      if (r.isPlayer) this.steerPlayer(r, dt, input);
      else this.driveAI(r, dt);
      this.move(r, dt);
    }
    this.handleBoxes();
    this.handleBananas();
    this.bananas = this.bananas.filter((b) => {
      if (t < b.expiresAt) return true;
      this.emit('banana-removed', b);
      return false;
    });
  }

  // Le joueur ne glisse pas de côté : il s'incline, tourne puis se redresse (modèle de vélo).
  // input.auto : pilote automatique (machines sans boutons : elliptique, vélo de salle). Une touche
  // de direction reprend la main tant qu'elle est tenue.
  steerPlayer(r, dt, input) {
    this.autoPilot = !!input.auto;
    if (input.auto && !input.steer) {
      r.targetLateral = this.autoLine(r);
      stepSteering(r, { targetHeading: headingTowards(r.lateral, r.targetLateral) }, r.v, this.track.curvatureAt(r.s), dt, LATERAL_LIMIT, this.weather?.steer);
      this.autoItem(r);
      return;
    }
    stepSteering(r, { steer: input.steer, drift: input.drift }, r.v, this.track.curvatureAt(r.s), dt, LATERAL_LIMIT, this.weather?.steer);
  }

  // Ligne choisie par le pilote automatique : boîte à objets à portée, sinon le milieu, en évitant les bananes.
  autoLine(r) {
    const L = this.track.length;
    const t = this.time;
    const v = Math.max(r.v, 1);
    let target = 0;
    if (!r.item) {
      let best = Infinity;
      for (const box of this.boxes) {
        const d = mod(box.s - r.s, L);
        if (d < 2 || d > 45 || d >= best) continue;
        if (box.respawnAt > t + d / v) continue; // la boîte ne sera pas revenue à temps
        best = d;
        target = box.lateral;
      }
    }
    for (const b of this.bananas) {
      const d = mod(b.s - r.s, L);
      if (d < 1 || d > 30 || Math.abs(target - b.lateral) > 1.5) continue;
      target = b.lateral > 0 ? b.lateral - 1.9 : b.lateral + 1.9;
    }
    const lim = ROAD_HALF - 0.7;
    return Math.max(-lim, Math.min(lim, target));
  }

  // Objets en pilote automatique : turbo dans les montées (ou après 6 s), banane quand quelqu'un suit de près.
  autoItem(r) {
    if (!r.item || this.time < 0) return;
    const held = this.time - (r.itemSince ?? this.time);
    if (r.item === 'turbo' && (this.track.gradeAt(r.s) > 3 || held > 6)) this.useItem(r);
    else if (r.item === 'banana') {
      const L = this.track.length;
      const chaser = this.racers.some((o) => o !== r && mod(r.s - o.s, L) < 14 && mod(r.s - o.s, L) > 2);
      if (chaser || held > 10) this.useItem(r);
    }
  }

  driveAI(r, dt) {
    const t = this.time;
    // Puissance qui fluctue un peu, et un effort supplémentaire dans les montées.
    const wobble = 1 + 0.07 * Math.sin(t * 0.21 + r.phase) + 0.04 * Math.sin(t * 0.83 + r.phase * 2);
    const grade = this.track.gradeAt(r.s);
    const climb = grade > 3 ? 1.1 : grade < -3 ? 0.6 : 1;
    let power = r.basePower * wobble * climb;
    if (r.finishTime !== null) power *= 0.45; // récupération après l'arrivée
    if (r.slipping(t)) power *= 0.15;
    r.power = power;
    r.cadence = r.slipping(t) ? 20 : 84 + 6 * Math.sin(t * 0.4 + r.phase);

    // Changement de ligne de temps en temps.
    if (t >= r.nextLaneChange) {
      r.targetLateral = (this.random() * 2 - 1) * (ROAD_HALF - 0.9);
      r.nextLaneChange = t + 4 + this.random() * 8;
    }
    stepSteering(r, { targetHeading: headingTowards(r.lateral, r.targetLateral) }, r.v, this.track.curvatureAt(r.s), dt, LATERAL_LIMIT, this.weather?.steer);

    // Utilisation des objets avec un petit délai.
    if (r.item && r.useItemAt !== null && t >= r.useItemAt) this.useItem(r);
  }

  move(r, dt) {
    const t = this.time;
    const L = this.track.length;
    const leaders = [];
    for (const o of this.racers) {
      if (o === r) continue;
      let gap = mod(o.s - r.s, L);
      if (gap > L / 2) continue;
      leaders.push({ gap, lateral: o.lateral - r.lateral });
    }
    r.draft = bestDraftFactor(leaders);
    const grade = this.track.gradeAt(r.s);
    const offRoad = Math.abs(r.lateral) > ROAD_HALF + 0.3;
    const power = r.power + (r.turbo(t) ? TURBO_POWER : 0);
    // Résistance au roulement : herbe hors de la route, sinon selon le revêtement (le sable freine).
    const surface = this.track.surfaceAt(r.s);
    const crr = offRoad ? GRASS_CRR : SURFACES[surface]?.crr ?? DEFAULTS.crr;
    r.surface = offRoad ? 'grass' : surface;
    // Météo : vent le long de la route (de dos > 0) et route mouillée (roulement un peu plus dur).
    const w = this.weather;
    r.tailwind = w ? w.tailwindAt(r.s) : 0;
    r.v = stepSpeed(r.v, power, grade, dt, { crr: w ? crr * w.crrFactor : crr, cda: DEFAULTS.cda * r.draft, tailwind: r.tailwind });
    r.offRoad = offRoad;
    r.prevS = r.s;
    const lapBefore = Math.floor(r.s / L);
    r.s += forwardSpeed(r.v, r.heading) * dt;
    r.crank += (r.cadence / 60) * Math.PI * 2 * dt;

    if (r.finishTime === null && r.s >= this.distance) {
      // Temps interpolé au passage exact de la ligne.
      r.finishTime = t - (r.s - this.distance) / Math.max(r.v, 0.1);
      this.emit('finish', r);
      if (r.isPlayer) this.state = 'finished';
    } else if (r.isPlayer && r.finishTime === null && lapBefore >= 0 && Math.floor(r.s / L) > lapBefore) {
      this.emit('lap', { racer: r, lap: this.lapOf(r) });
    }
  }

  // A-t-on franchi la position `at` (mod L) pendant ce pas ?
  crossed(r, at) {
    const travelled = r.s - r.prevS;
    if (!(travelled > 0)) return false;
    return mod(at - r.prevS, this.track.length) <= travelled;
  }

  handleBoxes() {
    const t = this.time;
    for (const box of this.boxes) {
      if (t < box.respawnAt) continue;
      for (const r of this.racers) {
        if (Math.abs(r.lateral - box.lateral) > BOX_CATCH || !this.crossed(r, box.s)) continue;
        box.respawnAt = t + BOX_RESPAWN;
        if (!r.item && r.finishTime === null) {
          r.item = this.random() < 0.5 ? 'turbo' : 'banana';
          r.itemSince = t;
          if (!r.isPlayer) r.useItemAt = t + 1 + this.random() * 5;
          this.emit('pickup', { racer: r, item: r.item });
        }
        break;
      }
    }
  }

  handleBananas() {
    const t = this.time;
    for (const b of [...this.bananas]) {
      for (const r of this.racers) {
        if (r === b.owner && t < b.ownerImmuneUntil) continue;
        if (Math.abs(r.lateral - b.lateral) > 0.8 || !this.crossed(r, b.s)) continue;
        this.bananas.splice(this.bananas.indexOf(b), 1);
        r.slipUntil = t + EFFECT_DURATION;
        r.v *= r.isPlayer ? BANANA_SPEED_KEEP : 0.4;
        r.yawRate += (this.random() < 0.5 ? -1 : 1) * 0.35; // la roue part sur le côté
        this.emit('banana-hit', { racer: r, banana: b });
        this.emit('banana-removed', b);
        break;
      }
    }
  }

  useItem(r) {
    const item = r.item;
    if (!item || this.time < 0) return null;
    r.item = null;
    r.useItemAt = null;
    if (item === 'turbo') {
      r.turboUntil = this.time + EFFECT_DURATION;
      r.v += 1.5; // petite poussée immédiate
    } else if (item === 'banana') {
      const b = {
        id: ++this.bananaId,
        s: mod(r.s - 2.5, this.track.length),
        lateral: r.lateral,
        owner: r,
        ownerImmuneUntil: this.time + 1.5,
        expiresAt: this.time + BANANA_LIFETIME,
      };
      this.bananas.push(b);
      this.emit('banana-dropped', b);
    }
    this.emit('use', { racer: r, item });
    return item;
  }

  // Temps estimé pour les coureurs pas encore arrivés (écran de fin).
  estimatedTime(r) {
    if (r.finishTime !== null) return { time: r.finishTime, estimated: false };
    const remaining = Math.max(0, this.distance - r.s);
    const avg = Math.max(4, r.s / Math.max(1, this.time));
    return { time: this.time + remaining / avg, estimated: true };
  }
}
