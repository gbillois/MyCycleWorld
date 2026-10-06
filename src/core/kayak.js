// Course de kayak cross (module pur, testé dans tests/kayak.test.js) : une rivière sinueuse (game/rivers.js)
// descendue d'un seul trait, avec du courant (calme, régulier, rapides), des portes de slalom (une porte
// manquée = +2 s), des portes sprint (ramer plus fort que sa propre moyenne récente), une porte « glisse »
// (passerelle basse : on arrête de ramer pour se baisser), des rochers, des berges qui freinent, cinq
// adversaires et des boîtes à objets (turbo, tourbillon, bouclier).
//
// Repère de la rivière, comme la route du vélo : s = distance le long de l'axe (m, vers l'aval),
// lateral = décalage à droite de l'axe (m), heading = angle du kayak par rapport à l'axe (rad, + = à droite).
//
// Portes sprint pensées pour un vrai rameur : on n'y change pas de rythme d'un coup (il faut plusieurs coups
// pour accélérer) et la puissance n'arrive qu'une fois par coup, souvent avec un ou deux coups de retard.
// Donc : annonce tôt (zone d'effort environ 15 s avant, comptée en coups), effort jugé sur les 4 meilleurs coups
// de la zone (jamais sur une valeur instantanée, pointes écrêtées), seuil modeste relatif à la médiane de ses
// propres coups de la dernière minute, et résultat gradué (ralenti, passage normal, bonus selon la marge).

export const KAYAK = {
  k: 2.8, // W / (m/s)³ : même formule que l'ergomètre d'aviron (P = 2.8 · v³)
  // Un kayak de slalom paraît plus vif qu'un skiff à puissance égale (coque courte, accélérations franches) :
  // on garde la formule de l'aviron et on multiplie la vitesse par 1.18 (18 %, réglage de jeu assumé).
  boost: 1.18,
  tau: 1.2, // s : inertie du kayak quand on accélère
  coastTau: 2.8, // s : quand on arrête de ramer, le kayak glisse et ralentit doucement
  countdown: 3, // s
  step: 1, // m : pas d'échantillonnage de la rivière
  bankMargin: 0.9, // m : distance mini entre l'axe du kayak et la berge
  maxHeading: 0.55, // rad : angle maximal avec l'axe de la rivière
  maxYaw: 1.3, // rad/s : vitesse de rotation maximale
  yawTime: 0.15, // s : réponse de la rotation
  straightenTime: 0.6, // s : réalignement quand on lâche la direction
  gatePenalty: 2, // s par porte manquée
  gateMargin: 0.3, // m : demi-largeur du kayak, qui doit passer entièrement entre les fiches
  // Portes sprint
  sprintLead: 15, // s : la zone d'effort commence environ 15 s avant la porte (distance selon la vitesse)
  sprintMinZone: 60, // m : zone d'effort minimale
  sprintAnnounce: 170, // m : la porte est affichée (sans jauge) à partir d'ici
  judgeStrokes: 4, // coups pris en compte (les derniers de la zone)
  baseWindow: 60, // s : médiane des coups de la dernière minute
  recovery: 8, // s après une porte sprint : coups exclus de la référence
  ratioRower: 0.12, // effort demandé au rameur : +12 % (changer de rythme y est lent, la puissance arrive en retard)
  ratioOther: 0.25, // vélo, elliptique, tapotements, clavier : +25 %
  extraMin: 10, // W : effort supplémentaire mini…
  extraMax: 70, // … et maxi
  targetMin: 40, // W : jamais moins
  spikeCap: 2, // un coup compte au plus pour 2 fois la référence (pointes écrêtées)
  slowBelow: 0.6, // sous 60 % de l'effort demandé : porte à moitié fermée
  slowKeep: 0.6, // vitesse gardée quand on est ralenti
  slowPenalty: 1, // s
  slowStun: 1.2, // s de ralentissement
  boostMin: 1.5, // s de turbo à 100 % de l'effort demandé…
  boostMax: 4, // … jusqu'à 4 s avec une marge de 100 % (deux fois l'effort demandé)
  sprintGap: 45, // s : deux portes sprint jamais à moins de 45 s (à la vitesse de référence)
  refSpeed: 5.5, // m/s : vitesse de référence (environ 170 W avec le courant)
  pseudoStroke: 2.5, // s : sans cadence (on glisse, ou pas de capteur), un « coup » compté toutes les 2,5 s
  // Porte glisse : passerelle basse, il faut arrêter de ramer (puissance moyenne sur ~3 s)
  glideLead: 12, // s
  glideTau: 1.5, // s : mémoire de la puissance pour la porte glisse
  glideRatio: 0.45, // réussie si la puissance récente est sous 45 % de la référence…
  glideMax: 25, // … ou sous 25 W
  glideKeep: 0.6, // vitesse gardée si on se cogne
  turbo: 3, // s
  turboFactor: 1.35, // vitesse visée pendant un turbo
  shield: 15, // s
  boxRespawn: 2, // s : vite revenue (les six kayaks passent groupés)
  boxCatch: 1.4,
  whirlRadius: 1.6,
  whirlLife: 60,
  whirlSpin: 2.2, // s de tête-à-queue
};

// Vitesse du kayak dans l'eau (m/s) pour une puissance (W), et l'inverse.
export const kayakSpeed = (power) => KAYAK.boost * Math.cbrt(Math.max(0, power) / KAYAK.k);
export const powerForKayakSpeed = (v) => KAYAK.k * Math.pow(Math.max(0, v) / KAYAK.boost, 3);

// Courant (m/s) au milieu de la rivière, selon le type de tronçon.
export const CURRENTS = { calm: 0.35, flow: 0.9, rapid: 1.9 };
// Pente de la surface de l'eau (m/m) : la rivière descend, plus vite dans les rapides.
const DROPS = { calm: 0.002, flow: 0.006, rapid: 0.022 };

export const KAYAK_ITEMS = {
  turbo: { label: 'Turbo', icon: '🚀' },
  whirl: { label: 'Tourbillon', icon: '🌀' },
  shield: { label: 'Bouclier', icon: '🛡️' },
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Générateur pseudo-aléatoire déterministe (rochers identiques à chaque partie).
export function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Valeur lissée d'une table [[u, v], ...] triée selon u.
function tableAt(table, u) {
  if (u <= table[0][0]) return table[0][1];
  for (let k = 1; k < table.length; k++) {
    if (u <= table[k][0]) {
      const [a, va] = table[k - 1];
      const [b, vb] = table[k];
      return va + (vb - va) * smooth(0, 1, (u - a) / (b - a));
    }
  }
  return table[table.length - 1][1];
}

// Valeur d'un tronçon [début, fin, type] avec des transitions douces de `blend` mètres.
function sectionProfile(n, step, sections, valueOf, blend) {
  const raw = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    let v = valueOf(null);
    for (const sec of sections) if (u >= sec[0] && u < sec[1]) v = valueOf(sec[2] ?? true);
    if (u >= 1 && sections.length) {
      const last = sections[sections.length - 1];
      if (last[1] >= 1) v = valueOf(last[2] ?? true);
    }
    raw[i] = v;
  }
  return boxBlur(raw, Math.max(1, Math.round(blend / step)), 2);
}

function boxBlur(arr, R, passes = 1) {
  let a = arr;
  const n = a.length;
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -R; k <= R; k++) sum += a[clamp(i + k, 0, n - 1)];
      out[i] = sum / (2 * R + 1);
    }
    a = out;
  }
  return a;
}

// --- La rivière : axe échantillonné tous les mètres, largeur, courant, rapides, falaises, niveau de l'eau ---
export class River {
  constructor(def) {
    this.def = def;
    const step = KAYAK.step;
    // Courbure brute (1/m, + = virage à droite) mètre par mètre, puis lissée : virages sans cassure.
    const curv = [];
    for (const part of def.path) {
      if (typeof part === 'number') for (let k = 0; k < Math.round(part / step); k++) curv.push(0);
      else {
        const [r, deg] = part;
        const len = (r * Math.abs(deg) * Math.PI) / 180;
        for (let k = 0; k < Math.round(len / step); k++) curv.push(((deg > 0 ? 1 : -1) * step) / r / step);
      }
    }
    const n = curv.length;
    this.count = n;
    this.step = step;
    this.length = n * step;
    const k = boxBlur(Float32Array.from(curv), Math.round(12 / step), 2);
    this.curv = new Float32Array(n + 1);
    this.curv.set(k.subarray(0, n));
    this.curv[n] = this.curv[n - 1];
    this.x = new Float32Array(n + 1);
    this.z = new Float32Array(n + 1);
    this.tx = new Float32Array(n + 1);
    this.tz = new Float32Array(n + 1);
    let a = ((def.heading || 0) * Math.PI) / 180;
    let x = 0;
    let z = 0;
    for (let i = 0; i <= n; i++) {
      this.x[i] = x;
      this.z[i] = z;
      this.tx[i] = Math.cos(a);
      this.tz[i] = Math.sin(a);
      // Pas à mi-angle (intégration du milieu) : la position suit fidèlement la courbure.
      const da = this.curv[Math.min(i, n - 1)] * step;
      x += Math.cos(a + da / 2) * step;
      z += Math.sin(a + da / 2) * step;
      a += da;
    }
    this.half = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) this.half[i] = tableAt(def.widths, i / n) / 2;
    const secs = def.sections || [];
    this.current = sectionProfile(n, step, secs, (t) => CURRENTS[t] ?? CURRENTS.flow, 18);
    this.rapid = sectionProfile(n, step, secs, (t) => (t === 'rapid' ? 1 : 0), 12);
    this.gorge = sectionProfile(n, step, def.gorge || [], (t) => (t ? 1 : 0), 30);
    const drop = sectionProfile(n, step, secs, (t) => DROPS[t] ?? DROPS.flow, 10);
    this.y = new Float32Array(n + 1);
    let y = 0;
    for (let i = n; i >= 0; i--) {
      this.y[i] = y;
      y += drop[i] * step;
    }
    this.lead = def.lead ?? 80;
    this.start = this.lead;
    this.finish = this.length - this.lead;
    this.distance = this.finish - this.start;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i <= n; i++) {
      minX = Math.min(minX, this.x[i]); maxX = Math.max(maxX, this.x[i]);
      minZ = Math.min(minZ, this.z[i]); maxZ = Math.max(maxZ, this.z[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
    this.buildGates();
    this.buildRocks();
  }

  // s (m) d'une fraction u de la course (0 = départ, 1 = arrivée).
  sOf(u) {
    return this.start + u * this.distance;
  }

  locate(s) {
    const f = clamp(s, 0, this.length) / this.step;
    const i = Math.min(this.count - 1, Math.floor(f));
    return [i, f - i];
  }

  sample(arr, s) {
    const [i, a] = this.locate(s);
    return arr[i] + (arr[i + 1] - arr[i]) * a;
  }

  halfWidthAt(s) {
    return this.sample(this.half, s);
  }

  curvatureAt(s) {
    return this.sample(this.curv, s);
  }

  rapidAt(s) {
    return this.sample(this.rapid, s);
  }

  gorgeAt(s) {
    return this.sample(this.gorge, s);
  }

  waterYAt(s) {
    return this.sample(this.y, s);
  }

  // Courant (m/s) : plus fort au milieu qu'au bord.
  currentAt(s, lateral = 0) {
    const hw = this.halfWidthAt(s);
    const k = clamp(Math.abs(lateral) / hw, 0, 1);
    return this.sample(this.current, s) * (1 - 0.45 * k * k);
  }

  // Position et orientation. out = { x, y (niveau de l'eau), z, tx, tz, rx, rz }.
  frame(s, lateral = 0, out = {}) {
    const [i, a] = this.locate(s);
    let tx = this.tx[i] + (this.tx[i + 1] - this.tx[i]) * a;
    let tz = this.tz[i] + (this.tz[i + 1] - this.tz[i]) * a;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    out.tx = tx;
    out.tz = tz;
    out.rx = -tz; // « droite » = avant × haut, comme pour la route du vélo
    out.rz = tx;
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * a + out.rx * lateral;
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * a + out.rz * lateral;
    out.y = this.y[i] + (this.y[i + 1] - this.y[i]) * a;
    return out;
  }

  // Point de l'axe le plus proche (recherche grossière puis affinée) : index, s, décalage signé, distance.
  nearest(x, z, out = {}) {
    let best = Infinity;
    let bi = 0;
    const n = this.count;
    for (let i = 0; i <= n; i += 6) {
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    const lo = Math.max(0, bi - 6);
    const hi = Math.min(n, bi + 6);
    for (let i = lo; i <= hi; i++) {
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    out.index = bi;
    out.s = bi * this.step;
    out.lateral = (x - this.x[bi]) * -this.tz[bi] + (z - this.z[bi]) * this.tx[bi];
    out.dist = Math.sqrt(best);
    return out;
  }

  buildGates() {
    const def = this.def;
    const gap = def.gateGap ?? 2;
    this.gates = [];
    let n = 0;
    for (const g of def.gates || []) {
      if (g[0] === 'sprint' || g[0] === 'glide') {
        const s = this.sOf(g[1]);
        this.gates.push({ id: this.gates.length, kind: g[0], n: 0, s, lateral: 0, half: this.halfWidthAt(s) });
      } else {
        const s = this.sOf(g[0]);
        const hw = this.halfWidthAt(s);
        const lateral = clamp(g[1] * hw, -(hw - gap - 1.2), hw - gap - 1.2);
        this.gates.push({ id: this.gates.length, kind: 'normal', n: ++n, s, lateral, half: gap });
      }
    }
    this.gates.sort((a, b) => a.s - b.s);
    this.gates.forEach((g, i) => (g.id = i));
    this.normalGates = n;
    this.sprintGates = this.gates.filter((g) => g.kind === 'sprint').length;
    this.glideGates = this.gates.filter((g) => g.kind === 'glide').length;
  }

  // Rochers au milieu des rapides (jamais sur une porte, une rangée de boîtes ni sur la ligne de départ).
  buildRocks() {
    const r = seeded(this.def.id ? [...this.def.id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) : 7);
    this.rocks = [];
    const want = this.def.rocks || 0;
    const busy = [...this.gates.map((g) => g.s), ...(this.def.boxes || []).map((u) => this.sOf(u))];
    for (let tries = 0; tries < want * 60 && this.rocks.length < want; tries++) {
      const s = this.start + 40 + r() * (this.distance - 80);
      if (this.rapidAt(s) < 0.6) continue;
      if (busy.some((b) => Math.abs(b - s) < 14)) continue;
      if (this.rocks.some((o) => Math.abs(o.s - s) < 22)) continue;
      const hw = this.halfWidthAt(s);
      const side = r() < 0.5 ? -1 : 1;
      const lateral = side * hw * (0.3 + r() * 0.35);
      this.rocks.push({ s, lateral, r: 0.7 + r() * 0.5 });
    }
    this.rocks.sort((a, b) => a.s - b.s);
  }
}

// Adversaires : puissance de croisière, précision aux portes, effort aux portes sprint (part de l'effort
// demandé, tirée au hasard dans cette fourchette), réussite à la porte glisse.
const CREW = [
  { name: 'Léa', color: '#e0384b', power: 225, miss: 0.04, sprint: [0.8, 1.7], glide: 0.95 },
  { name: 'Tom', color: '#2b6cff', power: 198, miss: 0.07, sprint: [0.7, 1.5], glide: 0.9 },
  { name: 'Inès', color: '#b78cff', power: 176, miss: 0.1, sprint: [0.55, 1.4], glide: 0.85 },
  { name: 'Hugo', color: '#ffd23f', power: 152, miss: 0.13, sprint: [0.45, 1.3], glide: 0.8 },
  { name: 'Yuki', color: '#3ccf7a', power: 130, miss: 0.16, sprint: [0.35, 1.2], glide: 0.7 },
];

// Médiane d'une liste de nombres (0 si vide).
export function median(list) {
  if (!list.length) return 0;
  const a = [...list].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Seuil d'une porte sprint (W) pour une référence (médiane récente) : effort modeste au rameur (+15 %),
// plus franc ailleurs (+25 %), toujours entre +10 et +70 W, jamais sous 40 W (un débutant à 80 W y arrive).
export function sprintTarget(base, machine = 'other') {
  const b = Math.max(0, base || 0);
  const ratio = machine === 'rower' ? KAYAK.ratioRower : KAYAK.ratioOther;
  return Math.max(KAYAK.targetMin, b + clamp(b * ratio, KAYAK.extraMin, KAYAK.extraMax));
}

// Part de l'effort supplémentaire demandé réellement fournie : 0 = sa référence, 1 = le seuil, 2 = deux fois plus.
export function sprintEffort(avg, base, target) {
  const b = Math.max(0, base || 0);
  const need = target - b;
  return need > 0 ? (avg - b) / need : 1;
}

// Résultat gradué : ralenti sous 60 %, passage normal jusqu'à 100 %, bonus proportionnel à la marge au-delà.
export function sprintOutcome(effort) {
  if (!(effort >= KAYAK.slowBelow)) return { grade: 'slow', boost: 0 };
  if (effort < 1) return { grade: 'pass', boost: 0 };
  return { grade: 'boost', boost: KAYAK.boostMin + (KAYAK.boostMax - KAYAK.boostMin) * Math.min(1, effort - 1) };
}

// Effort d'une zone : moyenne des 4 meilleurs coups de la zone, chacun écrêté (une pointe isolée ne compte
// pas plus que 2 fois la référence). Les meilleurs plutôt que les derniers : la puissance d'un rameur arrive
// avec un ou deux coups de retard et il faut plusieurs coups pour accélérer.
export function judgeStrokes(strokes, base, target, n = KAYAK.judgeStrokes) {
  if (!strokes.length) return null;
  const cap = Math.max(Math.max(0, base) * KAYAK.spikeCap, target * 1.5);
  const best = strokes.map((s) => Math.min(cap, s.power)).sort((a, b) => b - a).slice(0, n);
  return best.reduce((sum, p) => sum + p, 0) / best.length;
}

// Journal des coups : puissance et vitesse moyennes de chaque coup (la puissance d'un rameur FTMS n'arrive
// qu'une fois par coup ; les tapotements et le clavier passent par le même calcul). Sans cadence (on glisse,
// ou pas de capteur de coups), un « coup » est compté toutes les 2,5 s.
export class StrokeLog {
  constructor() {
    this.strokes = [];
    this.reset();
  }

  reset() {
    this.acc = 0;
    this.sumP = 0;
    this.sumV = 0;
    this.time = 0;
    this.flag = false;
  }

  // flag : coup donné dans une zone de porte sprint ou glisse, ou juste après (exclu de la référence).
  add(dt, power, rate, v, t, flag = false) {
    this.sumP += Math.max(0, power) * dt;
    this.sumV += v * dt;
    this.time += dt;
    this.flag ||= flag;
    const rowing = rate >= 5;
    if (rowing) this.acc += (rate / 60) * dt;
    if (!(rowing ? this.acc >= 1 : this.time >= KAYAK.pseudoStroke)) return null;
    const stroke = { t, power: this.sumP / this.time, v: this.sumV / this.time, flag: this.flag, duration: this.time };
    this.strokes.push(stroke);
    if (this.strokes.length > 80) this.strokes.shift();
    const carry = rowing ? this.acc - 1 : 0;
    this.reset();
    this.acc = Math.min(0.9, carry);
    return stroke;
  }

  // Référence : médiane des coups « normaux » de la dernière minute.
  base(t) {
    const list = this.strokes.filter((s) => !s.flag && t - s.t <= KAYAK.baseWindow).map((s) => s.power);
    if (list.length) return median(list);
    const all = this.strokes.filter((s) => !s.flag).map((s) => s.power);
    return all.length ? median(all) : 0;
  }

  // Coups terminés depuis t0, plus le coup en cours s'il est au moins à moitié fait.
  since(t0) {
    const list = this.strokes.filter((s) => s.t > t0);
    if (this.time >= 0.3 && (this.acc >= 0.5 || this.time >= KAYAK.pseudoStroke / 2)) list.push({ t: t0, power: this.sumP / this.time, partial: true });
    return list;
  }
}

export class KayakRace extends EventTarget {
  constructor(river, { random = Math.random, playerName = 'Toi' } = {}) {
    super();
    this.river = river;
    this.random = random;
    this.time = -KAYAK.countdown;
    this.gates = river.gates;
    this.racers = [];
    // Départ en ligne à travers la rivière, le joueur au milieu.
    const lanes = CREW.length + 1;
    const playerLane = Math.floor(lanes / 2);
    const hw = river.halfWidthAt(river.start);
    const spacing = Math.min(3.4, ((hw - 2) * 2) / (lanes - 1));
    let k = 0;
    for (let lane = 0; lane < lanes; lane++) {
      const isPlayer = lane === playerLane;
      const c = isPlayer ? { name: playerName, color: '#ff5a1f', power: 0, miss: 0, sprint: [1, 1], glide: 1 } : CREW[k++];
      const r = {
        id: lane,
        name: c.name,
        color: c.color,
        isPlayer,
        basePower: c.power,
        missChance: c.miss,
        s: river.start - 2,
        prevS: river.start - 2,
        lateral: (lane - (lanes - 1) / 2) * spacing,
        heading: 0,
        yawRate: 0,
        lean: 0,
        v: 0,
        power: 0,
        strokeRate: 0,
        phase: random() * Math.PI * 2,
        item: null,
        itemSince: 0,
        useItemAt: null,
        turboUntil: -Infinity,
        shieldUntil: -Infinity,
        spinUntil: -Infinity,
        stunUntil: -Infinity,
        recoverUntil: -Infinity,
        spin: 0,
        onBank: false,
        bumpedAt: -Infinity,
        gateIdx: 0,
        passed: 0,
        missed: 0,
        penalty: 0,
        sprints: { boost: 0, pass: 0, slow: 0 },
        glides: { ok: 0, bump: 0 },
        finishTime: null,
        plan: [],
        wobble: random() * 100,
        challenge: null, // zone de porte sprint ou glisse en cours
        glideAvg: 0,
        log: isPlayer ? new StrokeLog() : null,
      };
      // Plan de course de l'IA : ligne visée à chaque porte (parfois à côté), effort aux portes sprint,
      // réussite à la porte glisse.
      if (!isPlayer) {
        r.plan = this.gates.map((g) => {
          if (g.kind === 'sprint') return { effort: c.sprint[0] + random() * (c.sprint[1] - c.sprint[0]) };
          if (g.kind === 'glide') return { ok: random() < c.glide };
          const miss = random() < c.miss;
          const side = random() < 0.5 ? -1 : 1;
          return { offset: miss ? side * (g.half + 0.9) : (random() - 0.5) * g.half * 0.7 };
        });
      }
      this.racers.push(r);
    }
    this.player = this.racers.find((x) => x.isPlayer);
    this.machine = 'other';
    this.boxes = [];
    (river.def.boxes || []).forEach((u, row) => {
      const s = river.sOf(u);
      const h = river.halfWidthAt(s);
      const lats = row % 2 === 0 ? [-0.45, 0, 0.45] : [-0.25, 0.25];
      for (const f of lats) this.boxes.push({ s, lateral: f * (h - 1), respawnAt: 0 });
    });
    this.whirls = [];
    this.whirlId = 0;
    this.started = false;
    this.finished = false;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // Chrono officiel : temps + pénalités.
  totalTime(r) {
    return r.finishTime === null ? null : r.finishTime + r.penalty;
  }

  ranking() {
    return [...this.racers].sort((a, b) => {
      const ta = this.totalTime(a);
      const tb = this.totalTime(b);
      if (ta !== null && tb !== null) return ta - tb;
      if (ta !== null) return -1;
      if (tb !== null) return 1;
      return b.s - a.s;
    });
  }

  positionOf(r) {
    return this.ranking().indexOf(r) + 1;
  }

  estimatedTime(r) {
    if (r.finishTime !== null) return { time: r.finishTime + r.penalty, estimated: false };
    const left = Math.max(0, this.river.finish - r.s);
    const avg = Math.max(2, (r.s - this.river.start) / Math.max(1, this.time));
    return { time: this.time + left / avg + r.penalty, estimated: true };
  }

  // Référence de puissance du joueur (médiane de ses coups de la dernière minute).
  get base() {
    return this.player.log.base(this.time);
  }

  groundSpeed(r) {
    return Math.max(2, r.v + this.river.currentAt(r.s, r.lateral));
  }

  // Longueur de la zone d'une porte sprint ou glisse : environ 15 s (12 s pour la glisse) à la vitesse actuelle.
  zoneLength(r, g) {
    const lead = g.kind === 'glide' ? KAYAK.glideLead : KAYAK.sprintLead;
    return Math.max(g.kind === 'glide' ? 40 : KAYAK.sprintMinZone, this.groundSpeed(r) * lead);
  }

  nextChallenge(r) {
    for (let i = r.gateIdx; i < this.gates.length; i++) if (this.gates[i].kind !== 'normal') return this.gates[i];
    return null;
  }

  // Prochaine porte sprint ou glisse du joueur et état de la jauge (pour le HUD).
  challengeInfo(r = this.player) {
    const g = this.nextChallenge(r);
    if (!g || r.finishTime !== null) return null;
    const dist = g.s - r.s;
    const zoneLen = this.zoneLength(r, g);
    if (dist > Math.max(KAYAK.sprintAnnounce, zoneLen + 40)) return null;
    const zone = r.challenge?.gate === g;
    // Dans la zone, coups comptés à la cadence et à la vitesse de l'entrée (le compte ne remonte pas si on glisse)
    const rate = zone ? r.challenge.rate : r.strokeRate > 5 ? r.strokeRate : 24;
    const speed = zone ? r.challenge.speed : this.groundSpeed(r);
    const strokes = Math.max(0, Math.ceil(((dist / speed) * rate) / 60));
    if (g.kind === 'glide') {
      const base = zone ? r.challenge.base : this.base;
      const limit = Math.max(KAYAK.glideMax, base * KAYAK.glideRatio);
      return { kind: 'glide', gate: g, dist, strokes, zone, recent: r.glideAvg, limit, ok: r.glideAvg <= limit };
    }
    const base = zone ? r.challenge.base : this.base;
    const target = zone ? r.challenge.target : sprintTarget(base, this.machine);
    const judged = zone ? r.log.since(r.challenge.startT) : [];
    const avg = judgeStrokes(judged, base, target);
    const effort = avg === null ? 0 : sprintEffort(avg, base, target);
    return { kind: 'sprint', gate: g, dist, strokes, zone, base, target, avg, effort, judged: Math.min(judged.length, KAYAK.judgeStrokes), outcome: sprintOutcome(effort).grade };
  }

  // Compatibilité : la porte sprint seule.
  sprintInfo(r = this.player) {
    const info = this.challengeInfo(r);
    return info && info.kind === 'sprint' ? info : null;
  }

  // input : { power (W), strokeRate (coups/min), steer (-1..1), auto (pilote automatique), machine ('rower' | autre) }
  update(dt, input = {}) {
    const wasCountdown = this.time < 0;
    this.time += dt;
    const t = this.time;
    const p = this.player;
    p.power = Math.max(0, input.power || 0);
    p.strokeRate = input.strokeRate || (p.power > 20 ? 26 : 0);
    this.machine = input.machine === 'rower' ? 'rower' : 'other';
    if (wasCountdown && t >= 0) {
      this.started = true;
      dt = t; // seule la partie du pas après le départ compte
      this.emit('go');
    }
    if (t < 0) {
      // Compte à rebours : on peut déjà ramer (le kayak reste tenu au ponton).
      for (const r of this.racers) r.phase += ((r.isPlayer ? r.strokeRate : 0) / 60) * Math.PI * 2 * dt;
      return;
    }
    for (const r of this.racers) {
      if (r.isPlayer) this.drivePlayer(r, dt, input);
      else this.driveAI(r, dt);
      this.move(r, dt);
    }
    this.separate(dt);
    this.trackPlayer(dt);
    this.handleGates();
    this.handleBoxes();
    this.handleWhirls();
    for (let i = this.whirls.length - 1; i >= 0; i--) {
      if (t < this.whirls[i].expiresAt) continue;
      const w = this.whirls[i];
      this.whirls.splice(i, 1);
      this.emit('whirl-removed', w);
    }
    if (!this.finished && p.finishTime !== null) this.finished = true;
  }

  // Coups du joueur (puissance moyenne par coup), zones des portes sprint et glisse.
  trackPlayer(dt) {
    const p = this.player;
    const t = this.time;
    if (p.finishTime !== null) return;
    p.glideAvg += (p.power - p.glideAvg) * (1 - Math.exp(-dt / KAYAK.glideTau));
    const g = this.nextChallenge(p);
    if (g && !p.challenge && g.s - p.s <= this.zoneLength(p, g)) {
      const base = this.base;
      p.challenge = { gate: g, startT: t, base, target: g.kind === 'sprint' ? sprintTarget(base, this.machine) : 0, speed: this.groundSpeed(p), rate: p.strokeRate > 5 ? p.strokeRate : 24 };
      this.emit(g.kind === 'sprint' ? 'sprint-zone' : 'glide-zone', { racer: p, gate: g, base, target: p.challenge.target });
    }
    p.log.add(dt, p.power, p.strokeRate, p.v, t, !!p.challenge || t < p.recoverUntil);
  }

  drivePlayer(r, dt, input) {
    this.autoPilot = !!input.auto;
    if (input.auto && !input.steer) {
      const target = this.autoLine(r);
      this.steer(r, { targetHeading: this.headingFor(r, target) }, dt);
      this.autoItem(r);
    } else this.steer(r, { steer: input.steer || 0 }, dt);
  }

  driveAI(r, dt) {
    const t = this.time;
    const wobble = 1 + 0.06 * Math.sin(t * 0.23 + r.wobble) + 0.03 * Math.sin(t * 0.91 + r.wobble * 2);
    let power = r.basePower * wobble;
    // Zone d'une porte sprint : effort selon le plan ; porte glisse : on arrête de ramer (ou pas).
    const g = this.nextChallenge(r);
    if (g && g.s - r.s < this.zoneLength(r, g)) {
      if (g.kind === 'sprint') power *= 1 + r.plan[g.id].effort * KAYAK.ratioOther;
      else if (r.plan[g.id].ok && g.s - r.s < Math.max(18, r.v * 4)) power *= 0.08;
    }
    if (r.finishTime !== null) power *= 0.4;
    r.power = power;
    r.strokeRate = r.finishTime !== null ? 16 : power < 40 ? 0 : 24 + power / 40 + 2 * Math.sin(t * 0.4 + r.wobble);
    const target = this.autoLine(r);
    this.steer(r, { targetHeading: this.headingFor(r, target) }, dt);
    if (r.item && r.useItemAt !== null && t >= r.useItemAt) this.useItem(r);
    else if (r.item) this.autoItem(r);
  }

  // Cap visé pour rejoindre une ligne : correcteur proportionnel.
  headingFor(r, target) {
    return clamp((target - r.lateral) * 0.22, -KAYAK.maxHeading * 0.85, KAYAK.maxHeading * 0.85);
  }

  // Ligne choisie par le pilote automatique et par l'IA : la prochaine porte, sinon une boîte à objets,
  // sinon le milieu (où le courant est le plus fort) ; on contourne rochers et tourbillons.
  autoLine(r) {
    const river = this.river;
    const t = this.time;
    const v = Math.max(r.v, 1);
    let target = 0;
    let gateNear = false;
    const g = this.gates[r.gateIdx];
    if (g && g.kind === 'normal' && g.s - r.s < 70) {
      target = g.lateral + (r.isPlayer ? 0 : r.plan[g.id].offset);
      gateNear = g.s - r.s < 35;
    }
    if (!r.item && !gateNear) {
      // Boîte la plus proche (distance + écart latéral), libre à notre arrivée, sans faire manquer la porte suivante
      let best = Infinity;
      for (const box of this.boxes) {
        const d = box.s - r.s;
        if (d < 3 || d > 40) continue;
        if (box.respawnAt > t + d / v) continue;
        if (g && g.kind === 'normal' && g.s - box.s < 18 && g.s > box.s && Math.abs(box.lateral - g.lateral) > g.half + 1) continue;
        const score = d + Math.abs(box.lateral - r.lateral) * 2.5;
        if (score >= best) continue;
        best = score;
        target = box.lateral;
      }
    }
    // Fenêtre de la porte toute proche : un obstacle ne doit pas faire passer à côté.
    const near = g && g.kind === 'normal' && g.s - r.s < 40;
    const w0 = near ? g.lateral - g.half + 0.45 : 0;
    const w1 = near ? g.lateral + g.half - 0.45 : 0;
    for (const rock of river.rocks) target = this.avoid(r, target, rock.s, rock.lateral, rock.r, near ? g.s : null, w0, w1);
    for (const w of this.whirls) if (w.owner !== r || t > w.ownerImmuneUntil) target = this.avoid(r, target, w.s, w.lateral, KAYAK.whirlRadius, near ? g.s : null, w0, w1);
    const lim = river.halfWidthAt(r.s + 10) - 1.6;
    return clamp(target, -lim, lim);
  }

  // Contourne un obstacle (rocher, tourbillon) du côté le plus proche de la ligne visée. Près d'une porte
  // (gateS), on reste entre les fiches [w0, w1], quitte à frôler (ou prendre) l'obstacle.
  avoid(r, target, s, lateral, rad, gateS, w0, w1) {
    const d = s - r.s;
    if (d < -1 || d > 26 || Math.abs(target - lateral) > rad + 1.3) return target;
    const side = target === lateral ? (lateral > 0 ? -1 : 1) : Math.sign(target - lateral);
    let next = lateral + side * (rad + 1.6);
    if (gateS !== null && Math.abs(s - gateS) < 10 && (next < w0 || next > w1)) {
      const other = lateral - side * (rad + 1.6);
      next = other >= w0 && other <= w1 ? other : clamp(next, w0, w1);
    }
    return next;
  }

  // Objets en pilote automatique (et pour l'IA) : turbo loin des portes sprint et glisse, dans l'eau calme,
  // tourbillon quand quelqu'un suit de près, bouclier à l'entrée d'un rapide.
  autoItem(r) {
    if (!r.item || this.time < 0) return;
    const held = this.time - r.itemSince;
    const river = this.river;
    if (r.item === 'turbo') {
      const g = this.nextChallenge(r);
      const soon = g && g.s - r.s < 200;
      if ((!soon && river.rapidAt(r.s) < 0.2 && held > 1.5) || held > 9) this.useItem(r);
    } else if (r.item === 'whirl') {
      const chaser = this.racers.some((o) => o !== r && r.s - o.s > 2 && r.s - o.s < 16);
      if (chaser || held > 12) this.useItem(r);
    } else if (r.item === 'shield') {
      if (river.rapidAt(r.s + 25) > 0.5 || held > 10) this.useItem(r);
    }
  }

  // Direction du kayak : rotation progressive, angle borné, légère inclinaison dans les virages.
  steer(r, cmd, dt) {
    const K = KAYAK;
    const cap = K.maxYaw * Math.min(1, 0.4 + r.v / 3);
    let desired;
    if (cmd.targetHeading !== undefined && cmd.targetHeading !== null) desired = (clamp(cmd.targetHeading, -K.maxHeading, K.maxHeading) - r.heading) / 0.35;
    else if (Math.abs(cmd.steer) > 0.05) desired = clamp(cmd.steer, -1, 1) * cap;
    else desired = -r.heading / K.straightenTime;
    desired = clamp(desired, -cap, cap);
    const k = 1 - Math.exp(-dt / K.yawTime);
    r.yawRate += (desired - r.yawRate) * k;
    r.heading += r.yawRate * dt;
    if (Math.abs(r.heading) > K.maxHeading) {
      r.heading = Math.sign(r.heading) * K.maxHeading;
      if (Math.sign(r.yawRate) === Math.sign(r.heading)) r.yawRate = 0;
    }
    const omega = r.yawRate + r.v * this.river.curvatureAt(r.s);
    const targetLean = clamp(omega * r.v * 0.05, -0.22, 0.22);
    r.lean += (targetLean - r.lean) * (1 - Math.exp(-dt / 0.3));
  }

  move(r, dt) {
    const t = this.time;
    const river = this.river;
    let power = r.power;
    if (t < r.spinUntil) power *= 0.15;
    if (t < r.stunUntil) power *= 0.4;
    let target = kayakSpeed(power);
    if (t < r.turboUntil) target *= KAYAK.turboFactor;
    if (r.finishTime !== null) target = Math.min(target, 1.6);
    r.v += (target - r.v) * (1 - Math.exp(-dt / (target < r.v ? KAYAK.coastTau : KAYAK.tau)));
    if (r.onBank) r.v -= r.v * 1.2 * dt; // frottement contre la berge
    // Tête-à-queue dans un tourbillon (visuel) qui s'amortit
    if (t < r.spinUntil) r.spin += dt * 7 * (r.spinUntil - t);
    else r.spin *= Math.exp(-dt * 4);
    const current = river.currentAt(r.s, r.lateral);
    // Remous des rapides : une petite poussée latérale que la direction doit corriger.
    const rapid = river.rapidAt(r.s);
    const swirl = rapid * 0.35 * Math.sin(r.s * 0.11 + r.wobble);
    r.prevS = r.s;
    r.s += (r.v * Math.cos(r.heading) + current) * dt;
    r.lateral += (r.v * Math.sin(r.heading) + swirl) * dt;
    r.phase += (r.strokeRate / 60) * Math.PI * 2 * dt;
    this.collide(r);
    if (r.finishTime === null && r.s >= river.finish) {
      const speed = Math.max(0.3, (r.s - r.prevS) / Math.max(dt, 1e-3));
      r.finishTime = t - (r.s - river.finish) / speed;
      this.emit('finish', r);
    }
  }

  // Deux kayaks côte à côte se poussent doucement (pas de chevauchement), sans perte de vitesse.
  separate(dt) {
    const list = this.racers;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.finishTime !== null || b.finishTime !== null) continue;
        const ds = Math.abs(a.s - b.s);
        const dl = b.lateral - a.lateral;
        if (ds > 3.3 || Math.abs(dl) > 1.1) continue;
        const push = (1.1 - Math.abs(dl)) * 0.5 * (1 - ds / 3.3) * Math.min(1, dt * 6);
        const side = dl === 0 ? (a.id < b.id ? 1 : -1) : Math.sign(dl);
        // Les adversaires s'écartent pour le joueur (il garde sa ligne vers la porte)
        const wa = a.isPlayer ? 0.3 : b.isPlayer ? 1.7 : 1;
        a.lateral -= side * push * wa;
        b.lateral += side * push * (2 - wa);
      }
    }
  }

  // Berges et rochers : on rebondit, on perd de la vitesse (sauf avec le bouclier).
  collide(r) {
    const t = this.time;
    const river = this.river;
    const lim = river.halfWidthAt(r.s) - KAYAK.bankMargin;
    if (Math.abs(r.lateral) > lim) {
      const side = Math.sign(r.lateral);
      r.lateral = side * lim;
      if (Math.sign(r.heading) === side) {
        r.heading *= -0.3;
        r.yawRate = 0;
      }
      if (!r.onBank) {
        r.onBank = true;
        this.bump(r, 'bank', 0.65);
      }
    } else if (Math.abs(r.lateral) < lim - 0.3) r.onBank = false;
    for (const rock of river.rocks) {
      const ds = rock.s - r.s;
      if (ds > 3 || ds < -2) continue;
      const dl = r.lateral - rock.lateral;
      const reach = rock.r + 0.45;
      if (Math.abs(dl) >= reach || Math.abs(ds) > rock.r + 0.9) continue;
      r.lateral = rock.lateral + (dl >= 0 ? 1 : -1) * reach;
      r.heading *= 0.4;
      if (t - r.bumpedAt > 1) this.bump(r, 'rock', 0.5);
    }
  }

  bump(r, kind, keep) {
    const t = this.time;
    r.bumpedAt = t;
    if (this.shielded(r, kind)) return;
    r.v *= keep;
    this.emit('bump', { racer: r, kind });
  }

  // Le bouclier encaisse un seul choc (berge, rocher, porte manquée, porte sprint ou glisse ratée, tourbillon).
  shielded(r, kind) {
    if (this.time >= r.shieldUntil) return false;
    r.shieldUntil = -Infinity;
    this.emit('shield-save', { racer: r, kind });
    return true;
  }

  handleGates() {
    const t = this.time;
    for (const r of this.racers) {
      while (r.gateIdx < this.gates.length && r.s >= this.gates[r.gateIdx].s) {
        const g = this.gates[r.gateIdx];
        r.gateIdx++;
        if (r.prevS > g.s + 0.01 || r.finishTime !== null) continue;
        if (g.kind === 'sprint') this.sprintGate(r, g);
        else if (g.kind === 'glide') this.glideGate(r, g);
        else this.normalGate(r, g);
        if (r.isPlayer && r.challenge?.gate === g) r.challenge = null;
      }
    }
    void t;
  }

  normalGate(r, g) {
    const inside = Math.abs(r.lateral - g.lateral) <= g.half - KAYAK.gateMargin;
    if (inside) {
      r.passed++;
      this.emit('gate', { racer: r, gate: g, ok: true });
    } else if (this.shielded(r, 'gate')) {
      r.passed++;
      this.emit('gate', { racer: r, gate: g, ok: true, saved: true });
    } else {
      r.missed++;
      r.penalty += KAYAK.gatePenalty;
      this.emit('gate', { racer: r, gate: g, ok: false });
    }
  }

  // Porte sprint : effort jugé sur les derniers coups de la zone, résultat gradué.
  sprintGate(r, g) {
    const t = this.time;
    let effort;
    if (r.isPlayer) {
      const c = r.challenge?.gate === g ? r.challenge : { startT: t - KAYAK.sprintLead, base: this.base, target: sprintTarget(this.base, this.machine) };
      const avg = judgeStrokes(r.log.since(c.startT), c.base, c.target);
      effort = avg === null ? 0 : sprintEffort(avg, c.base, c.target);
      r.recoverUntil = t + KAYAK.recovery;
    } else effort = r.plan[g.id].effort;
    let { grade, boost } = sprintOutcome(effort);
    if (grade === 'slow' && this.shielded(r, 'sprint')) grade = 'pass';
    r.sprints[grade]++;
    if (grade === 'boost') {
      r.turboUntil = Math.max(r.turboUntil, t + boost);
      r.v += 0.4 + 0.4 * Math.min(1, effort - 1);
    } else if (grade === 'slow') {
      r.v *= KAYAK.slowKeep;
      r.penalty += KAYAK.slowPenalty;
      r.stunUntil = t + KAYAK.slowStun;
    }
    this.emit('sprint', { racer: r, gate: g, grade, effort, boost, ok: grade !== 'slow' });
  }

  // Porte glisse (passerelle basse) : on doit avoir arrêté de ramer pour se baisser et glisser dessous.
  glideGate(r, g) {
    let ok;
    if (r.isPlayer) {
      const base = r.challenge?.gate === g ? r.challenge.base : this.base;
      ok = r.glideAvg <= Math.max(KAYAK.glideMax, base * KAYAK.glideRatio);
      r.recoverUntil = this.time + 3;
    } else ok = r.plan[g.id].ok;
    if (!ok && this.shielded(r, 'glide')) ok = true;
    if (ok) r.glides.ok++;
    else {
      r.glides.bump++;
      r.v *= KAYAK.glideKeep;
    }
    this.emit('glide', { racer: r, gate: g, ok });
  }

  crossed(r, at) {
    return r.prevS < at && r.s >= at;
  }

  handleBoxes() {
    const t = this.time;
    for (const box of this.boxes) {
      if (t < box.respawnAt) continue;
      for (const r of this.racers) {
        if (Math.abs(r.lateral - box.lateral) > KAYAK.boxCatch || !this.crossed(r, box.s)) continue;
        box.respawnAt = t + KAYAK.boxRespawn;
        if (!r.item && r.finishTime === null) {
          const x = this.random();
          r.item = x < 0.4 ? 'turbo' : x < 0.75 ? 'whirl' : 'shield';
          r.itemSince = t;
          if (!r.isPlayer) r.useItemAt = r.item === 'turbo' ? null : t + 2 + this.random() * 6;
          this.emit('pickup', { racer: r, item: r.item, box });
        }
        break;
      }
    }
  }

  handleWhirls() {
    const t = this.time;
    for (let i = this.whirls.length - 1; i >= 0; i--) {
      const w = this.whirls[i];
      for (const r of this.racers) {
        if (r === w.owner && t < w.ownerImmuneUntil) continue;
        if (Math.abs(r.lateral - w.lateral) > KAYAK.whirlRadius || !this.crossed(r, w.s)) continue;
        this.whirls.splice(this.whirls.indexOf(w), 1);
        if (!this.shielded(r, 'whirl')) {
          r.spinUntil = t + KAYAK.whirlSpin;
          r.v *= 0.4;
          this.emit('whirl-hit', { racer: r, whirl: w });
        }
        this.emit('whirl-removed', w);
        break;
      }
    }
  }

  useItem(r) {
    const item = r.item;
    if (!item || this.time < 0 || r.finishTime !== null) return null;
    r.item = null;
    r.useItemAt = null;
    const t = this.time;
    if (item === 'turbo') {
      r.turboUntil = Math.max(r.turboUntil, t + KAYAK.turbo);
      r.v += 1;
    } else if (item === 'shield') {
      r.shieldUntil = t + KAYAK.shield;
    } else if (item === 'whirl') {
      const w = {
        id: ++this.whirlId,
        s: r.s - 3,
        lateral: r.lateral,
        owner: r,
        ownerImmuneUntil: t + 1.5,
        expiresAt: t + KAYAK.whirlLife,
      };
      this.whirls.push(w);
      this.emit('whirl-dropped', w);
    }
    this.emit('use', { racer: r, item });
    return item;
  }
}
