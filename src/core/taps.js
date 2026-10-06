// Pédaler ou ramer en tapotant l'écran (sans home trainer ni rameur connecté). Module pur, testé dans
// tests/taps.test.js. Un tapotement = un tour de pédalier (vélo) ou un coup d'aviron (rameur) :
// le rythme des tapotements donne la cadence, et la puissance simulée suit la cadence.

export const TAP = {
  // idle : ms sans tapotement au bout desquelles on considère qu'on a arrêté (un coup d'aviron est lent).
  bike: { refRate: 80, refPower: 250, max: 420, idle: 1500 }, // 80 tapotements/min ≈ 250 W
  row: { refRate: 26, refPower: 180, max: 380, idle: 4000 }, // 26 coups/min ≈ 180 W
  keep: 6, // derniers intervalles pris en compte
};

export class TapDrive {
  constructor() {
    this.times = [];
  }

  tap(now) {
    this.times.push(now);
    if (this.times.length > TAP.keep + 1) this.times.shift();
  }

  reset() {
    this.times = [];
  }

  // Tapotements par minute (0 si on a arrêté). Un seul tapotement récent compte comme un démarrage.
  rate(now, kind = 'bike') {
    const t = this.times;
    if (!t.length) return 0;
    const idle = TAP[kind].idle;
    const since = now - t[t.length - 1];
    if (since > idle) return 0;
    if (t.length < 2) return TAP[kind].refRate * 0.5;
    const intervals = [];
    for (let i = 1; i < t.length; i++) {
      const d = t[i] - t[i - 1];
      if (d < idle) intervals.push(d);
    }
    if (!intervals.length) return TAP[kind].refRate * 0.5;
    let avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    // On ralentit : l'attente depuis le dernier tapotement dépasse l'intervalle habituel.
    avg = Math.max(avg, since);
    return Math.min(240, 60000 / Math.max(avg, 150));
  }

  // Puissance visée (W) et cadence (tours ou coups par minute) pour ce rythme.
  target(now, kind = 'bike') {
    const cfg = TAP[kind];
    const rate = this.rate(now, kind);
    return { rate, power: Math.min(cfg.max, (cfg.refPower * rate) / cfg.refRate) };
  }

  active(now, kind = 'bike') {
    return this.times.length > 0 && now - this.times[this.times.length - 1] <= TAP[kind].idle;
  }
}
