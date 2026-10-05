// Course d'aviron (module pur, testé dans tests/rowing.test.js) : bateaux en ligne droite sur un bassin,
// vitesse tirée de la puissance comme sur un ergomètre (formule Concept2 : P = 2.8 · v³).

export const ROW = {
  k: 2.8, // W / (m/s)³
  distance: 500, // m
  laneWidth: 13.5, // m entre deux lignes de bouées
  laneHalf: 4.8, // écart latéral avant de toucher les bouées
  tau: 1.6, // s : inertie du bateau
  countdown: 3, // s
};

export const boatSpeed = (power) => Math.cbrt(Math.max(0, power) / ROW.k);
export const powerForSplit = (split500) => ROW.k * Math.pow(500 / split500, 3);
export const splitFromSpeed = (v) => (v > 0.05 ? 500 / v : Infinity);

// 125.3 s -> "2:05.3" ; sans vitesse -> "-:--"
export function formatSplit(sec) {
  if (!Number.isFinite(sec) || sec > 5999) return '-:--';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

// Adversaires : allure cible sur 500 m (s) et cadence (coups/min).
const CREW = [
  { name: 'Léa', split: 112, rate: 30, color: '#e0384b' },
  { name: 'Tom', split: 118, rate: 28, color: '#2b6cff' },
  { name: 'Inès', split: 124, rate: 27, color: '#b78cff' },
  { name: 'Hugo', split: 131, rate: 25, color: '#ffd23f' },
  { name: 'Yuki', split: 138, rate: 24, color: '#3ccf7a' },
];

export class RowingRace extends EventTarget {
  constructor({ distance = ROW.distance, random = Math.random, playerName = 'Toi' } = {}) {
    super();
    this.distance = distance;
    this.random = random;
    this.time = -ROW.countdown;
    const lanes = CREW.length + 1;
    const playerLane = Math.floor(lanes / 2) - 1; // couloir central
    const order = CREW.map((c, i) => ({ ...c, i }));
    this.racers = [];
    let k = 0;
    for (let lane = 0; lane < lanes; lane++) {
      const isPlayer = lane === playerLane;
      const c = isPlayer ? { name: playerName, color: '#ff5a1f', split: 0, rate: 0 } : order[k++];
      this.racers.push({
        name: c.name,
        color: c.color,
        isPlayer,
        lane,
        laneX: (lane - (lanes - 1) / 2) * ROW.laneWidth,
        targetSplit: c.split,
        rate: c.rate,
        power: 0,
        strokeRate: 0,
        v: 0,
        s: 0,
        lateral: 0,
        phase: random() * Math.PI * 2,
        offLane: false,
        finishTime: null,
        form: 0.97 + random() * 0.06,
      });
    }
    this.player = this.racers.find((r) => r.isPlayer);
    this.started = false;
    this.finished = false;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // input : { power (W), strokeRate (coups/min), steer (-1..1) }
  update(dt, input = {}) {
    const wasCountdown = this.time < 0;
    this.time += dt;
    if (wasCountdown && this.time >= 0) {
      this.started = true;
      this.emit('go');
    }
    for (const r of this.racers) {
      if (r.isPlayer) {
        r.power = Math.max(0, input.power || 0);
        r.strokeRate = input.strokeRate || (r.power > 20 ? 24 : 0);
        r.lateral = Math.max(-ROW.laneHalf - 1.5, Math.min(ROW.laneHalf + 1.5, r.lateral + (input.steer || 0) * 1.4 * dt));
      } else if (this.time >= 0 && r.finishTime === null) {
        // Départ rapide, puis allure de croisière légèrement variable, sprint final.
        const left = this.distance - r.s;
        let split = r.targetSplit / r.form;
        if (this.time < 8) split *= 0.9;
        else if (left < 100) split *= 0.95;
        split *= 1 + Math.sin(this.time * 0.37 + r.phase) * 0.02;
        r.power = powerForSplit(split);
        r.strokeRate = r.rate + (this.time < 8 || left < 100 ? 4 : 0);
      } else {
        r.power = 0;
        r.strokeRate = r.finishTime !== null ? 14 : 0;
      }
      r.offLane = Math.abs(r.lateral) > ROW.laneHalf;
      let target = this.time >= 0 ? boatSpeed(r.power) : 0;
      if (r.offLane) target *= 0.8; // les bouées freinent
      if (r.finishTime !== null) target = Math.min(target, 1.2);
      r.v += (target - r.v) * (1 - Math.exp(-dt / ROW.tau));
      r.s += r.v * dt;
      r.phase += (r.strokeRate / 60) * Math.PI * 2 * dt;
      if (r.finishTime === null && r.s >= this.distance) {
        // Temps exact au passage de la ligne
        const over = (r.s - this.distance) / Math.max(r.v, 0.1);
        r.finishTime = this.time - over;
        this.emit('finish', r);
      }
    }
    if (!this.finished && this.player.finishTime !== null) this.finished = true;
  }

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

  // Temps (réel ou estimé à vitesse constante pour ceux qui n'ont pas fini).
  estimatedTime(r) {
    if (r.finishTime !== null) return { time: r.finishTime, estimated: false };
    return { time: this.time + (this.distance - r.s) / Math.max(r.v, 0.5), estimated: true };
  }
}
