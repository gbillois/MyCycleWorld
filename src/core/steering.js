// Direction réaliste d'un vélo, dans le repère de la route (module pur, testable).
//
// Un vélo ne glisse pas de côté : pour changer de ligne, il s'incline, tourne, puis se redresse.
// État (sur l'objet passé, par exemple un coureur) :
//   lateral  (m)     décalage par rapport à l'axe de la route, + = à droite
//   heading  (rad)   angle entre le vélo et l'axe de la route, + = vers la droite
//   yawRate  (rad/s) vitesse à laquelle cet angle change
//   lean     (rad)   inclinaison du vélo, + = penché à droite (route + écart volontaire)
//
// Le virage possible dépend de la vitesse : ω = g·tan(inclinaison) / v, limité par un rayon de braquage
// minimal. À l'arrêt, on ne peut donc pas se déplacer latéralement.

export const G = 9.81;

export const STEER = Object.freeze({
  maxLean: 0.5, // ~29° d'inclinaison pour un changement de ligne volontaire
  driftLean: 0.7, // ~40° en appuyant sur « dérapage »
  minRadius: 3.5, // rayon de braquage minimal (m)
  rollTime: 0.2, // temps de réponse de l'inclinaison (s)
  straightenTime: 0.3, // temps pour se réaligner avec la route quand on lâche la direction (s)
  maxHeading: 0.3, // angle maximal avec la route (~17°)
  maxVisualLean: 0.75, // inclinaison affichée maximale (~43°)
});

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function createSteerState(lateral = 0) {
  return { lateral, heading: 0, yawRate: 0, lean: 0 };
}

// Vitesse de lacet maximale (rad/s) pour une inclinaison donnée, à la vitesse v (m/s).
export function maxYawRate(v, lean, minRadius = STEER.minRadius) {
  if (v <= 0.05) return 0;
  return Math.min((G * Math.tan(lean)) / v, v / minRadius);
}

/**
 * Avance la direction d'un pas de temps.
 * command : { steer: -1..1 } pour le joueur, ou { targetHeading } pour un coureur IA ; drift : bool.
 * v : vitesse (m/s) ; curvature : courbure de la route (1/m, + = virage à droite) ; limit : |lateral| max.
 */
export function stepSteering(st, command, v, curvature, dt, limit = Infinity, cfg = STEER) {
  const { steer = 0, drift = false, targetHeading = null } = command || {};
  const cap = maxYawRate(v, drift ? cfg.driftLean : cfg.maxLean, cfg.minRadius);
  let desired;
  if (targetHeading !== null && targetHeading !== undefined) {
    desired = (clamp(targetHeading, -cfg.maxHeading, cfg.maxHeading) - st.heading) / cfg.straightenTime;
  } else if (Math.abs(steer) > 0.05) {
    desired = clamp(steer, -1, 1) * cap;
  } else {
    desired = -st.heading / cfg.straightenTime; // on lâche : le vélo se redresse et suit la route
  }
  desired = clamp(desired, -cap, cap);

  // L'inclinaison, donc le virage, ne change pas instantanément.
  const k = 1 - Math.exp(-dt / cfg.rollTime);
  st.yawRate += (desired - st.yawRate) * k;
  st.heading += st.yawRate * dt;
  if (Math.abs(st.heading) > cfg.maxHeading) {
    st.heading = Math.sign(st.heading) * cfg.maxHeading;
    if (Math.sign(st.yawRate) === Math.sign(st.heading)) st.yawRate = 0;
  }

  st.lateral += v * Math.sin(st.heading) * dt;
  if (Math.abs(st.lateral) > limit) {
    // Bord du terrain praticable : on le longe.
    st.lateral = Math.sign(st.lateral) * limit;
    if (Math.sign(st.heading) === Math.sign(st.lateral)) {
      st.heading = 0;
      st.yawRate = 0;
    }
  }

  // Inclinaison réelle : elle équilibre le virage total (courbe de la route + écart volontaire).
  const omega = st.yawRate + v * curvature;
  const targetLean = clamp(Math.atan2(v * omega, G), -cfg.maxVisualLean, cfg.maxVisualLean);
  st.lean += (targetLean - st.lean) * k;
  return st;
}

// Progression le long de la route : un vélo en biais avance un peu moins vite sur le tracé.
export function forwardSpeed(v, heading) {
  return v * Math.cos(heading || 0);
}

// Cap visé par un coureur IA pour rejoindre une ligne cible (correcteur proportionnel, sans oscillation).
export function headingTowards(lateral, target, cfg = STEER) {
  return clamp((target - lateral) * 0.12, -cfg.maxHeading * 0.7, cfg.maxHeading * 0.7);
}
