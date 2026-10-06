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

// windNoise : souffle du vent de la vitesse dans les oreilles (désactivé par défaut, réglable dans Options).
// Mélange calme par défaut : musique nettement en retrait, ambiance en fond, effets présents mais doux.
export const DEFAULTS = Object.freeze({ master: 80, music: 35, ambience: 60, sfx: 70, ui: 45, muted: false, windNoise: false });

// Version du format enregistré. Les réglages de la version 1 (sans champ v) restés aux anciennes valeurs
// par défaut passent aux nouvelles ; une valeur choisie par le joueur n'est jamais modifiée.
export const SETTINGS_VERSION = 2;
export const OLD_DEFAULTS = Object.freeze({ master: 80, music: 50, ambience: 70, sfx: 80, ui: 60 });

export function migrateSettings(raw) {
  if (!raw || typeof raw !== 'object' || raw.v >= SETTINGS_VERSION) return raw;
  const out = { ...raw };
  for (const bus of BUSES) if (Number(raw[bus]) === OLD_DEFAULTS[bus]) out[bus] = DEFAULTS[bus];
  return out;
}

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
  out.windNoise = src.windNoise === true;
  return out;
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return normalizeSettings(text ? migrateSettings(JSON.parse(text)) : null);
  } catch {
    return normalizeSettings(null);
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ v: SETTINGS_VERSION, ...normalizeSettings(settings) }));
    return true;
  } catch {
    return false; // stockage indisponible (navigation privée) : réglage valable pour cette session
  }
}

// Pourcentage -> gain linéaire. Courbe au carré : 35 % ≈ -18 dB, 50 % ≈ -12 dB, 70 % ≈ -6 dB, 0 % = silence.
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
