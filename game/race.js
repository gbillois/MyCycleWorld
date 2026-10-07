// Logique de course, sans rendu : coureurs, IA, boîtes à objets, peaux de banane, classement.
// Toutes les durées sont en secondes de course (this.time), les distances en mètres.
import { stepSpeed, bestDraftFactor, DEFAULTS } from '../src/core/physics.js';
import { stepSteering, forwardSpeed, headingTowards } from '../src/core/steering.js';
import { ROAD_HALF, LATERAL_LIMIT, mod } from './track.js';
import { SURFACES } from './courses.js';
import { MtbRules } from '../src/core/mtb.js';
import { HELMET, itemWeights, pickItem, nextAhead, launchHelmet, releaseTarget, stepHelmet, helmetExpired, canHitRacer, helmetTouches, helmetCrosses, helmetsClash, helmetPlan } from '../src/core/helmets.js';

// svg : icône du HUD (symbole de game/index.html) à la place de l'émoji, dans la couleur color.
export const ITEMS = {
  turbo: { label: 'Turbo', icon: '🚀' },
  banana: { label: 'Peau de banane', icon: '🍌' },
  green: { label: 'Casque vert', icon: '🟢', svg: 'i-helmet', color: '#33d35f' },
  red: { label: 'Casque rouge', icon: '🔴', svg: 'i-helmet', color: '#ff3b3b' },
};
export const HELMET_ITEMS = new Set(['green', 'red']);

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
// Les adversaires ne visent pas le joueur plus d'une fois toutes les 14 s (ni pendant les 8 premières).
const AI_PLAYER_COOLDOWN = 14;
const AI_FIRST_SHOT = 8;

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
    this.slipUntil = -Infinity; // glissade sur banane (ou après un casque)
    this.hitAt = -Infinity; // touché par un casque : tête-à-queue
    this.hitUntil = -Infinity;
    this.shieldUntil = -Infinity; // bouclier (s'il existe) : encaisse un casque
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
    // Casques lancés (src/core/helmets.js) et dernier moment où un adversaire a visé le joueur.
    this.helmets = [];
    this.helmetId = 0;
    this.playerTargetedAt = AI_FIRST_SHOT - AI_PLAYER_COOLDOWN;
    // Météo (game/weather.js) : { tailwindAt(s), crrFactor, steer } ; null = temps neutre (comportement d'origine).
    this.weather = null;
    // Demi-largeur de la route et écart latéral maximal de ce circuit (sentier de VTT étroit).
    this.half = track.half ?? ROAD_HALF;
    this.limit = track.lateralLimit ?? LATERAL_LIMIT;
    const grid = Math.min(1.6, this.half - 0.5);

    // Balade (course.ride, zones de la Grande Balade) : mêmes adversaires et boîtes à objets que sur les circuits,
    // sur un parcours ouvert. Les écarts entre coureurs, boîtes et casques s'y calculent sans boucler : une
    // « longueur de tour » démesurée (this.L) rend les calculs modulo identiques à de simples différences.
    this.ride = !!track.course.ride;
    this.L = track.open ? 1e6 : track.length;
    // Grille de départ : deux par rangée, le joueur en deuxième ligne.
    const order = [AI_PROFILES[4], AI_PROFILES[3], null, AI_PROFILES[2], AI_PROFILES[1], AI_PROFILES[0]];
    order.forEach((p, i) => {
      const row = Math.floor(i / 2);
      const s = -4 - row * 4;
      const lateral = i % 2 ? grid : -grid;
      if (!p) {
        this.player = new Racer({ id: 0, name: playerName, color: '#ff5a1f', helmet: '#ffffff', bike: '#16181d', isPlayer: true, s, lateral });
        this.racers.push(this.player);
      } else {
        this.racers.push(new Racer({ id: this.racers.length, name: p.name, color: p.color, helmet: p.helmet, bike: p.bike, basePower: p.power, s, lateral }));
      }
    });

    // Boîtes à objets : 8 rangées par tour, en quinconce (3 de front, puis 2 décalées), resserrées sur un sentier.
    this.boxes = [];
    const spread = Math.min(1, (this.half - 0.6) / (ROAD_HALF - 0.6));
    BOX_ROWS.forEach((frac, row) => {
      for (const lateral of row % 2 === 0 ? [-2.6, 0, 2.6] : [-1.3, 1.3]) {
        this.boxes.push({ s: frac * track.length, lateral: lateral * spread, respawnAt: 0 });
      }
    });

    // VTT (src/core/mtb.js) : sauts avec impulsion, chutes hors de la piste, dérive dans les épingles.
    this.mtb = null;
    if (track.course.mtb) {
      const f = {};
      this.mtb = new MtbRules({
        length: track.length,
        half: this.half,
        jumps: (track.course.mtb.jumps || []).map(([u, h, len]) => ({ s: u * track.length, h, len })),
        random,
        emit: (type, detail) => this.emit(type, detail),
        yAt: (s) => track.frame(s, 0, f).y,
      });
    }
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
    if (input.impulseAt !== undefined) p.impulseAt = input.impulseAt; // VTT : dernière impulsion (saut)
    if (t < 0) {
      // Compte à rebours : on peut déjà pédaler, mais on ne part pas.
      for (const r of this.racers) r.crank += (r.isPlayer ? r.cadence : 0) / 60 * Math.PI * 2 * dt;
      return;
    }

    for (const r of this.racers) {
      if (r.isPlayer) this.steerPlayer(r, dt, input);
      else this.driveAI(r, dt);
      this.move(r, dt);
      if (this.mtb) this.mtb.step(r, dt, t, { auto: r.isPlayer && this.autoPilot, skill: (r.basePower - 150) / 110 });
    }
    this.handleBoxes();
    this.handleBananas();
    this.handleHelmets(dt);
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
    if (this.mtb && (r.air || this.mtb.down(r, this.time))) return; // en l'air ou à terre : pas de direction
    if (input.auto && !input.steer) {
      r.targetLateral = this.autoLine(r);
      stepSteering(r, { targetHeading: headingTowards(r.lateral, r.targetLateral) }, r.v, this.track.curvatureAt(r.s), dt, this.limit, this.weather?.steer);
      this.autoItem(r);
      return;
    }
    // VTT : sans tourner soi-même, le vélo file tout droit dans les virages serrés (et sort de la piste).
    if (this.mtb && !input.auto) this.mtb.steer(r, { steer: input.steer, drift: input.drift }, r.v, this.track.curvatureAt(r.s), dt, this.limit, this.weather?.steer);
    else stepSteering(r, { steer: input.steer, drift: input.drift }, r.v, this.track.curvatureAt(r.s), dt, this.limit, this.weather?.steer);
  }

  // Ligne choisie par le pilote automatique : boîte à objets à portée, sinon le milieu, en évitant les bananes.
  autoLine(r) {
    const L = this.L;
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
      const dodge = Math.min(1.9, this.half * 0.8);
      target = b.lateral > 0 ? b.lateral - dodge : b.lateral + dodge;
    }
    const lim = this.half - 0.7;
    return Math.max(-lim, Math.min(lim, target));
  }

  // Objets en pilote automatique : turbo dans les montées (ou après 6 s), banane quand quelqu'un suit de près,
  // casque quand un coureur est aligné devant (ou derrière), casque rouge dès qu'une cible est à portée.
  autoItem(r) {
    if (!r.item || this.time < 0) return;
    const held = this.time - (r.itemSince ?? this.time);
    if (r.item === 'turbo' && (this.track.gradeAt(r.s) > 3 || held > 6)) this.useItem(r);
    else if (r.item === 'banana') {
      const L = this.L;
      const chaser = this.racers.some((o) => o !== r && mod(r.s - o.s, L) < 14 && mod(r.s - o.s, L) > 2);
      if (chaser || held > 10) this.useItem(r);
    } else if (HELMET_ITEMS.has(r.item) && this.time >= (r.planAt ?? 0)) {
      r.planAt = this.time + 0.2; // décision réévaluée 5 fois par seconde
      const plan = this.helmetPlanFor(r, held, 12);
      if (plan) this.useItem(r, { back: plan === 'back' });
    }
  }

  // Quand lancer son casque (voir helmetPlan) ; les adversaires laissent souffler le joueur entre deux tirs.
  helmetPlanFor(r, held, maxHold) {
    return helmetPlan({
      kind: r.item,
      owner: r,
      racers: this.racers,
      length: this.L,
      target: r.item === 'red' ? nextAhead(this.ranking(), r) : null,
      held,
      maxHold,
      allowPlayer: r.isPlayer || this.time - this.playerTargetedAt >= AI_PLAYER_COOLDOWN,
    });
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
      r.targetLateral = (this.random() * 2 - 1) * (this.half - 0.9);
      r.nextLaneChange = t + 4 + this.random() * 8;
    }
    if (!(this.mtb && r.air)) stepSteering(r, { targetHeading: headingTowards(r.lateral, r.targetLateral) }, r.v, this.track.curvatureAt(r.s), dt, this.limit, this.weather?.steer);

    // Utilisation des objets avec un petit délai ; un casque attend une cible (helmetPlan).
    if (r.item && r.useItemAt !== null && t >= r.useItemAt) {
      if (!HELMET_ITEMS.has(r.item)) this.useItem(r);
      else if (r.finishTime === null && t >= (r.planAt ?? 0)) {
        r.planAt = t + 0.2;
        const plan = this.helmetPlanFor(r, t - (r.itemSince ?? t), 14);
        if (plan) this.useItem(r, { back: plan === 'back' });
      }
    }
  }

  move(r, dt) {
    const t = this.time;
    const L = this.L;
    const leaders = [];
    for (const o of this.racers) {
      if (o === r) continue;
      let gap = mod(o.s - r.s, L);
      if (gap > L / 2) continue;
      leaders.push({ gap, lateral: o.lateral - r.lateral });
    }
    r.draft = bestDraftFactor(leaders);
    let grade = this.track.gradeAt(r.s);
    const offRoad = Math.abs(r.lateral) > this.half + 0.3;
    // VTT : à terre, on ne pédale plus ; en l'air, ni pédalage ni frottement des pneus.
    const down = this.mtb ? this.mtb.down(r, t) : false;
    const air = !!(this.mtb && r.air);
    const power = down || air ? 0 : r.power + (r.turbo(t) ? TURBO_POWER : 0);
    // Résistance au roulement : herbe hors de la route, sinon selon le revêtement (le sable freine).
    const surface = this.track.surfaceAt(r.s);
    let crr = offRoad ? GRASS_CRR : SURFACES[surface]?.crr ?? DEFAULTS.crr;
    if (air) {
      crr = 0;
      grade = 0;
    }
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
    return mod(at - r.prevS, this.L) <= travelled;
  }

  handleBoxes() {
    const t = this.time;
    for (const box of this.boxes) {
      if (t < box.respawnAt) continue;
      for (const r of this.racers) {
        if (Math.abs(r.lateral - box.lateral) > BOX_CATCH || !this.crossed(r, box.s)) continue;
        box.respawnAt = t + BOX_RESPAWN;
        if (!r.item && r.finishTime === null) {
          r.item = pickItem(itemWeights(this.positionOf(r), this.racers.length), this.random());
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

  // Casques en vol : rebonds, coureurs touchés, bananes emportées, casques qui se croisent, fin de course.
  handleHelmets(dt) {
    const list = this.helmets;
    if (!list.length) return;
    const t = this.time;
    const L = this.L;
    const ctx = (this.helmetCtx ||= { wall: this.half - HELMET.wallMargin, curvatureAt: (s) => this.track.curvatureAt(s) });
    for (const h of list) {
      if (h.done) continue;
      if (h.target && h.target.finishTime !== null) releaseTarget(h);
      if (stepHelmet(h, dt, ctx) === 'bounce') this.emit('helmet-bounce', h);
      let banana = null;
      for (const x of this.bananas) if (helmetCrosses(h, x.s, x.lateral, L)) banana = x;
      if (banana) {
        this.bananas.splice(this.bananas.indexOf(banana), 1);
        this.emit('banana-removed', banana);
        this.removeHelmet(h, 'banana');
        continue;
      }
      let victim = null;
      for (const r of this.racers) {
        if (this.canHelmetHit(h, r) && helmetTouches(h, r, L)) {
          victim = r;
          break;
        }
      }
      if (victim) this.helmetHit(h, victim);
      else if (helmetExpired(h, t)) this.removeHelmet(h, 'expire');
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && !list[i].done; j++) {
        if (list[j].done || !helmetsClash(list[i], list[j], L)) continue;
        this.removeHelmet(list[i], 'clash');
        this.removeHelmet(list[j], 'clash');
      }
    }
    let n = 0;
    for (const h of list) if (!h.done) list[n++] = h;
    list.length = n;
  }

  // En l'air (saut de VTT) ou à terre, on ne se fait pas toucher.
  canHelmetHit(h, r) {
    if (this.mtb && (r.air || this.mtb.down(r, this.time))) return false;
    return canHitRacer(h, r, this.time);
  }

  helmetHit(h, r) {
    const t = this.time;
    this.removeHelmet(h, 'hit');
    if (t < r.shieldUntil) {
      // Le bouclier encaisse le casque et disparaît.
      r.shieldUntil = -Infinity;
      this.emit('helmet-blocked', { racer: r, helmet: h });
      return;
    }
    r.slipUntil = Math.max(r.slipUntil, t + HELMET.hitDuration);
    r.hitAt = t;
    r.hitUntil = t + HELMET.hitDuration;
    r.hitSpin = this.random() < 0.5 ? -1 : 1;
    r.v *= r.isPlayer ? HELMET.hitSpeedKeep : HELMET.aiHitSpeedKeep;
    r.yawRate += r.hitSpin * 0.3;
    if (r.isPlayer && !h.owner.isPlayer) this.playerTargetedAt = t;
    this.emit('helmet-hit', { racer: r, helmet: h });
  }

  removeHelmet(h, reason) {
    if (h.done) return;
    h.done = true;
    h.reason = reason;
    this.emit('helmet-removed', h);
  }

  // opts.back : lancer le casque vers l'arrière (↓ tenue au moment d'utiliser l'objet).
  useItem(r, { back = false } = {}) {
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
        s: mod(r.s - 2.5, this.L),
        lateral: r.lateral,
        owner: r,
        ownerImmuneUntil: this.time + 1.5,
        expiresAt: this.time + BANANA_LIFETIME,
      };
      this.bananas.push(b);
      this.emit('banana-dropped', b);
    } else if (HELMET_ITEMS.has(item)) {
      const target = item === 'red' && !back ? nextAhead(this.ranking(), r) : null;
      const h = launchHelmet({ id: ++this.helmetId, kind: item, owner: r, back, t: this.time, target });
      this.helmets.push(h);
      // Un adversaire vise le joueur (casque rouge, ou vert aligné sur lui) : le joueur est tranquille un moment.
      if (!r.isPlayer && (target?.isPlayer || this.aimsAtPlayer(r, back))) this.playerTargetedAt = this.time;
      this.emit('helmet-thrown', h);
    }
    this.emit('use', { racer: r, item });
    return item;
  }

  aimsAtPlayer(r, back) {
    const p = this.player;
    const gap = back ? r.s - p.s : p.s - r.s;
    return gap > 0 && gap < 45 && Math.abs(p.lateral - r.lateral) < 1.2;
  }

  // Temps estimé pour les coureurs pas encore arrivés (écran de fin).
  estimatedTime(r) {
    if (r.finishTime !== null) return { time: r.finishTime, estimated: false };
    const remaining = Math.max(0, this.distance - r.s);
    const avg = Math.max(4, r.s / Math.max(1, this.time));
    return { time: this.time + remaining / avg, estimated: true };
  }
}
