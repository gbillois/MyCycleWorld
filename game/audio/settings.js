// Réglages du son (module pur, testé dans tests/audio.test.js) : volumes par bus en pourcentage,
// coupure générale, lecture et écriture dans localStorage ('mycycleworld.audio').

export const STORAGE_KEY = 'mycycleworld.audio';

// Bus de mixage : général, musique, ambiance (décor), effets (jeu) et interface (menus).
export const BUSES = ['master', 'music', 'ambience', 'sfx', 'ui'];

export const BUS_LABELS = {
  master: 'Volume général',
  music: 'Musique',
  ambience: 'Ambiance',
  sfx: 'Effets',
  ui: 'Interface',
};

export const DEFAULTS = Object.freeze({ master: 80, music: 50, ambience: 70, sfx: 80, ui: 60, muted: false });

const clampPercent = (v, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.max(0, Math.min(100, n)));
};

// Réglages complets et valides à partir de n'importe quoi (JSON abîmé, ancienne version, valeurs hors bornes).
export function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const bus of BUSES) out[bus] = clampPercent(src[bus], DEFAULTS[bus]);
  out.muted = src.muted === true;
  return out;
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return normalizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return normalizeSettings(null);
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
    return true;
  } catch {
    return false; // stockage indisponible (navigation privée) : réglage valable pour cette session
  }
}

// Pourcentage -> gain linéaire. Courbe au carré : 50 % ≈ -12 dB, 70 % ≈ -6 dB, 0 % = silence.
// L'oreille perçoit le volume de façon logarithmique : un curseur linéaire en gain serait « tout en haut ».
export function volumeToGain(percent) {
  const p = clampPercent(percent, 0) / 100;
  return p * p;
}

// Gain effectif d'un bus (général × bus, coupure comprise).
export function busGain(settings, bus) {
  const s = normalizeSettings(settings);
  if (s.muted) return 0;
  if (bus === 'master') return volumeToGain(s.master);
  return volumeToGain(s[bus]);
}

export const percentLabel = (p) => `${clampPercent(p, 0)} %`;

// Pas des curseurs au clavier / à la manette (← →).
export const VOLUME_STEP = 5;
export function stepVolume(value, dir, step = VOLUME_STEP) {
  const v = clampPercent(value, 0);
  const next = dir > 0 ? Math.floor(v / step) * step + step : Math.ceil(v / step) * step - step;
  return Math.max(0, Math.min(100, next));
}
