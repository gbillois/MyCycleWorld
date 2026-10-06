// Casques de vélo lancés comme des carapaces (module pur, testable) : vert en ligne droite qui rebondit
// sur les bords de la route, rouge à tête chercheuse qui vise le coureur juste devant au classement.
//
// Repère : celui de la route (voir src/core/steering.js). s (m) = distance parcourue le long du tracé
// (cumulée sur les tours, comme pour les coureurs), lateral (m) = écart à l'axe, + = à droite.
// Un casque : { id, kind: 'green'|'red', owner, target, s, prevS, lateral, vs (m/s, signé : < 0 vers
// l'arrière), angle (rad, cap par rapport au tracé dans le sens du vol), vl (m/s, casque rouge),
// born, expiresAt, range, travelled, bounces, ownerImmuneUntil }.
// Un coureur vu d'ici : { s, prevS, lateral, v, heading, finishTime, isPlayer }.

export const HELMET = Object.freeze({
  speedBoost: 13, // m/s au-dessus de la vitesse du lanceur...
  minSpeed: 24, // ...et jamais moins de 24 m/s (86 km/h) : nettement plus vite que les coureurs
  backSpeed: 20, // lancer vers l'arrière : 20 m/s de moins que le lanceur...
  minBackSpeed: 8, // ...et au moins 8 m/s vers l'arrière par rapport au sol
  spawn: 1.6, // m devant (ou derrière) le lanceur
  greenLife: 5, // s
  greenRange: 150, // m
  redLife: 8,
  redRange: 320,
  redReach: 110, // m : un adversaire lance son casque rouge quand sa cible est à moins de 110 m
  wallMargin: 0.25, // le casque rebondit un peu avant le bord du revêtement
  throwAngle: 1.6, // le cap du vélo au lancer, amplifié : on vise un peu en tournant
  maxAngle: 0.45, // cap maximal du casque vert par rapport au tracé (~26°)
  curveDrift: 0.7, // part de la ligne droite « monde » : dans un virage, le casque file vers l'extérieur
  hitLength: 1.0, // m : demi-longueur de contact le long de la route
  hitWidth: 0.75, // m : écart latéral maximal pour toucher
  homingNear: 30, // m : en dessous, le casque rouge braque franchement vers sa cible
  homingRate: 4, // gain du rapprochement latéral (1/s)
  homingMaxLat: 6, // m/s de vitesse latérale au plus
  ownerGrace: 0.6, // s pendant lesquelles le lanceur ne peut pas être touché (et jamais avant un rebond)
  hitDuration: 1.5, // s de glissade après un coup
  hitSpeedKeep: 0.45, // fraction de vitesse conservée (joueur)
  aiHitSpeedKeep: 0.4, // (adversaires)
  bananaReach: 0.8, // m : un casque qui croise une banane l'emporte avec lui
  clashReach: 0.9, // m : deux casques qui se croisent se détruisent
});

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const mod = (x, m) => ((x % m) + m) % m;
// Écart signé le plus court sur un circuit de longueur L, dans ]-L/2, L/2].
export const wrapGap = (d, L) => {
  const m = mod(d, L);
  return m > L / 2 ? m - L : m;
};

// --- Distribution des objets selon la position (façon Mario Kart) ---
// En tête : surtout des bananes (défense), rarement un casque rouge ; en queue : turbos et casques rouges.
// Le casque vert reste courant partout. Les quatre poids font toujours 1.
export function itemWeights(position, total) {
  const f = total > 1 ? clamp((position - 1) / (total - 1), 0, 1) : 0;
  return {
    turbo: 0.34 + 0.13 * f,
    banana: 0.42 - 0.27 * f,
    green: 0.22 - 0.06 * f,
    red: 0.02 + 0.2 * f,
  };
}

// Tire un objet : x dans [0, 1[ (fourni par le hasard de la course, reproductible).
export function pickItem(weights, x) {
  let sum = 0;
  for (const k in weights) sum += weights[k];
  let acc = 0;
  let last = null;
  for (const k in weights) {
    acc += weights[k] / sum;
    last = k;
    if (x < acc) return k;
  }
  return last;
}

// Cible du casque rouge : le coureur juste devant au classement (encore en course), sinon personne.
export function nextAhead(ranking, owner) {
  for (let i = ranking.indexOf(owner) - 1; i >= 0; i--) if (ranking[i].finishTime === null || ranking[i].finishTime === undefined) return ranking[i];
  return null;
}

// Nouveau casque lancé par owner (vers l'arrière si back). target : cible du casque rouge (ou null).
export function launchHelmet({ id = 0, kind = 'green', owner, back = false, t = 0, target = null }) {
  const vs = back ? -Math.max(HELMET.minBackSpeed, HELMET.backSpeed - owner.v) : Math.max(HELMET.minSpeed, owner.v + HELMET.speedBoost);
  const red = kind === 'red';
  const s = owner.s + (back ? -HELMET.spawn : HELMET.spawn);
  // Cap de départ : celui du vélo (dans le sens du vol), amplifié, borné.
  const heading = owner.heading || 0;
  const angle = clamp((back ? -heading : heading) * HELMET.throwAngle, -HELMET.maxAngle, HELMET.maxAngle);
  return {
    id,
    kind,
    owner,
    target: red && !back ? target : null,
    s,
    prevS: s,
    lateral: owner.lateral,
    vs,
    angle,
    vl: Math.abs(vs) * Math.sin(angle),
    born: t,
    expiresAt: t + (red ? HELMET.redLife : HELMET.greenLife),
    range: red ? HELMET.redRange : HELMET.greenRange,
    travelled: 0,
    bounces: 0,
    ownerImmuneUntil: t + HELMET.ownerGrace,
  };
}

// La cible n'est plus valable (arrivée) : le casque rouge continue tout droit, comme un vert.
export function releaseTarget(h) {
  if (!h.target) return;
  h.target = null;
  h.angle = clamp(Math.asin(clamp(h.vl / Math.max(1, Math.abs(h.vs)), -1, 1)), -HELMET.maxAngle, HELMET.maxAngle);
}

// Avance un casque d'un pas. ctx : { wall (m, |lateral| maximal), curvatureAt(s) (1/m, + = virage à droite) }.
// Renvoie 'bounce' si le casque a rebondi sur un bord pendant ce pas, sinon null.
export function stepHelmet(h, dt, { wall, curvatureAt = () => 0 }) {
  h.prevS = h.s;
  const speed = Math.abs(h.vs);
  let ds;
  if (h.target) {
    // Tête chercheuse : suit le tracé à pleine vitesse et se rapproche latéralement de sa cible,
    // d'autant plus franchement qu'elle est proche.
    const tg = h.target;
    const gap = tg.s - h.s; // > 0 : la cible est devant
    const dist = Math.abs(gap);
    const k = HELMET.homingRate * (dist < HELMET.homingNear ? 1.6 : clamp(HELMET.homingNear / dist, 0.25, 1));
    const err = tg.lateral - h.lateral;
    const want = clamp(err * k, -HELMET.homingMaxLat, HELMET.homingMaxLat);
    h.vl += (want - h.vl) * (1 - Math.exp(-dt * 8));
    h.lateral += h.vl * dt;
    h.angle = Math.asin(clamp(h.vl / Math.max(1, speed), -1, 1));
    // Tout près de la cible, le casque cale sa vitesse sur elle le temps de s'aligner (il la laisse revenir
    // s'il l'a dépassée), puis fonce dessus ; plus loin, pleine vitesse.
    const closing = 2.5 * gap + (Math.abs(err) < 0.6 ? 5 : 0);
    ds = clamp((tg.v || 0) + closing, 0, speed) * dt;
  } else {
    // Ligne droite (en partie) dans le monde : dans un virage, le cap par rapport au tracé tourne vers
    // l'extérieur, quel que soit le sens du vol, et le casque finit par rebondir sur le bord.
    h.angle -= speed * curvatureAt(h.s) * HELMET.curveDrift * dt;
    h.angle = clamp(h.angle, -HELMET.maxAngle, HELMET.maxAngle);
    h.vl = speed * Math.sin(h.angle);
    h.lateral += h.vl * dt;
    ds = h.vs * Math.cos(h.angle) * dt;
  }
  h.s += ds;
  h.travelled += Math.abs(ds);
  if (Math.abs(h.lateral) > wall && h.target) {
    // Casque rouge : il longe le bord sans rebondir (il vise une cible au milieu de la route).
    h.lateral = Math.sign(h.lateral) * wall;
    h.vl = 0;
  } else if (Math.abs(h.lateral) > wall) {
    // Rebond : position et vitesse latérale réfléchies sur le bord.
    const side = Math.sign(h.lateral);
    h.lateral = side * (2 * wall - Math.abs(h.lateral));
    if (Math.abs(h.lateral) > wall) h.lateral = side * wall;
    h.angle = -h.angle;
    h.vl = -h.vl;
    h.bounces++;
    return 'bounce';
  }
  return null;
}

export function helmetExpired(h, t) {
  return t >= h.expiresAt || h.travelled >= h.range;
}

// Le lanceur ne peut être touché qu'après le délai de grâce et un rebond (le casque revient vers lui).
export function canHitRacer(h, r, t) {
  if (r.finishTime !== null && r.finishTime !== undefined) return false;
  if (r === h.owner) return t >= h.ownerImmuneUntil && h.bounces > 0;
  return true;
}

// Contact avec un coureur pendant le dernier pas (balayage : rien ne passe au travers à grande vitesse).
export function helmetTouches(h, r, L) {
  if (Math.abs(r.lateral - h.lateral) > HELMET.hitWidth) return false;
  const now = wrapGap(h.s - r.s, L);
  if (Math.abs(now) <= HELMET.hitLength) return true;
  const before = wrapGap(h.prevS - (r.prevS ?? r.s), L);
  // Le casque est passé d'un côté à l'autre du coureur (les deux ont bougé de moins d'un quart de tour).
  return Math.sign(before) !== Math.sign(now) && Math.abs(before - now) < L / 4;
}

// Le casque croise-t-il un point fixe (banane) pendant ce pas ?
export function helmetCrosses(h, s, lateral, L, reach = HELMET.bananaReach) {
  if (Math.abs(lateral - h.lateral) > reach) return false;
  const now = wrapGap(h.s - s, L);
  if (Math.abs(now) <= reach) return true;
  const before = wrapGap(h.prevS - s, L);
  return Math.sign(before) !== Math.sign(now) && Math.abs(before - now) < L / 4;
}

// Deux casques qui se rencontrent (en sens inverse ou en se rattrapant).
export function helmetsClash(a, b, L) {
  if (Math.abs(a.lateral - b.lateral) > HELMET.clashReach) return false;
  const now = wrapGap(a.s - b.s, L);
  if (Math.abs(now) <= HELMET.clashReach) return true;
  const before = wrapGap(a.prevS - b.prevS, L);
  return Math.sign(before) !== Math.sign(now) && Math.abs(before - now) < L / 4;
}

// Quand lancer un casque (adversaires et pilote automatique du joueur) : 'forward', 'back' ou null (attendre).
// o : { kind, owner, racers, length, target (casque rouge : cible au classement), held (s), maxHold (s),
//       allowPlayer (false : le joueur ne doit pas être visé en ce moment) }.
export function helmetPlan({ kind, owner, racers, length, target = null, held = 0, maxHold = 14, allowPlayer = true }) {
  const L = length;
  const ok = (r) => r !== owner && (r.finishTime === null || r.finishTime === undefined) && (allowPlayer || !r.isPlayer);
  if (kind === 'red' && target) {
    const gap = mod(target.s - owner.s, L);
    if (ok(target) && gap > 2 && gap < HELMET.redReach) return 'forward';
    // Cible trop loin ou protégée (joueur visé il y a peu) : on patiente.
    return held > maxHold * 2 && !target.isPlayer ? 'forward' : null;
  }
  // Casque vert (ou rouge sans personne devant : il part tout droit).
  let blocked = false;
  for (const r of racers) {
    if (r === owner || (r.finishTime !== null && r.finishTime !== undefined)) continue;
    const aligned = Math.abs(r.lateral - owner.lateral) < 0.9;
    if (!aligned) continue;
    const ahead = mod(r.s - owner.s, L);
    const behind = mod(owner.s - r.s, L);
    const inFront = ahead > 3 && ahead < 40;
    const inBack = behind > 3 && behind < 15;
    if (!inFront && !inBack) continue;
    if (!ok(r)) {
      blocked = true;
      continue;
    }
    return inFront ? 'forward' : 'back';
  }
  return held > maxHold && !blocked ? 'forward' : null;
}
