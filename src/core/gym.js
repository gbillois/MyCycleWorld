// Carte des salles envoyée par l'appli iOS (révision 4 du pont, voir game/native.js) : lecture prudente
// (les données viennent de l'appli mais on ne fait confiance à rien), machines adaptées au mode de jeu,
// machine la plus proche, souvenir du dernier choix et départ de la course quand la machine bouge.
// Module pur, testé dans tests/gym.test.js. Affichage : game/gym-picker.js.

export const KIND_LABELS = { bike: 'Vélo', cross: 'Elliptique', rower: 'Rameur', treadmill: 'Tapis de course', power: 'Capteur de puissance' };
const KINDS = new Set(Object.keys(KIND_LABELS));
const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

// Mode de jeu (bouton « Jouer ») -> types de machine faits pour lui. Les autres font quand même avancer
// (leur puissance), mais ils sont proposés après.
export const PLAY_KINDS = { bike: ['bike', 'power'], cross: ['cross'], row: ['rower'] };

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function parseMachine(m, width, depth) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !UUID.test(m.id)) return null;
  const name = str(m.name) || 'Machine';
  const label = str(m.label);
  const x = num(m.x);
  const y = num(m.y);
  const placed = x !== null && y !== null;
  return {
    id: m.id.toUpperCase(),
    name,
    label,
    title: label || name,
    kind: KINDS.has(m.kind) ? m.kind : null,
    x: placed ? clamp(x, 0, width) : null,
    y: placed ? clamp(y, 0, depth) : null,
    err: placed && num(m.err) !== null ? clamp(m.err, 0, Math.max(width, depth)) : null,
  };
}

// Carte reçue de l'appli -> { places, defaultPlace, nearby, scanning } (places vides si rien d'utilisable).
export function parseGym(raw) {
  const out = { places: [], defaultPlace: null, nearby: [], scanning: false };
  if (!raw || typeof raw !== 'object') return out;
  for (const p of Array.isArray(raw.places) ? raw.places.slice(0, 50) : []) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !UUID.test(p.id)) continue;
    const width = clamp(num(p.width) ?? 20, 4, 120);
    const depth = clamp(num(p.depth) ?? 12, 4, 120);
    const machines = (Array.isArray(p.machines) ? p.machines.slice(0, 300) : []).map((m) => parseMachine(m, width, depth)).filter(Boolean);
    out.places.push({ id: p.id.toUpperCase(), name: str(p.name) || 'Ma salle', width, depth, machines });
  }
  const def = typeof raw.defaultPlace === 'string' ? raw.defaultPlace.toUpperCase() : null;
  out.defaultPlace = out.places.some((p) => p.id === def) ? def : out.places[0]?.id ?? null;
  for (const n of Array.isArray(raw.nearby) ? raw.nearby.slice(0, 100) : []) {
    const rssi = num(n?.rssi);
    if (typeof n?.id !== 'string' || !UUID.test(n.id) || rssi === null) continue;
    out.nearby.push({ id: n.id.toUpperCase(), name: str(n.name) || 'Machine', kind: KINDS.has(n.kind) ? n.kind : null, rssi: Math.round(clamp(rssi, -127, 0)) });
  }
  out.nearby.sort((a, b) => b.rssi - a.rssi);
  out.scanning = raw.scanning === true;
  return out;
}

export function placeById(gym, id) {
  return gym?.places.find((p) => p.id === id) || gym?.places.find((p) => p.id === gym.defaultPlace) || gym?.places[0] || null;
}

// La machine convient-elle au mode de jeu ? 'yes', 'maybe' (type inconnu) ou 'no' (autre type de machine).
export function fits(kind, play) {
  if (!kind) return 'maybe';
  return (PLAY_KINDS[play] || PLAY_KINDS.bike).includes(kind) ? 'yes' : 'no';
}

// Proximité en mots d'après le RSSI (mêmes seuils que l'appli, GymSignal.proximity).
export function proximity(rssi) {
  if (rssi === null || rssi === undefined) return null;
  if (rssi >= -55) return 'juste devant toi';
  if (rssi >= -67) return 'tout près';
  if (rssi >= -80) return 'dans la salle';
  return 'loin';
}

// Machines d'un lieu à proposer pour un mode de jeu, dans l'ordre : celle qu'on a devant soi (si elle
// convient), puis les machines adaptées, celles de type inconnu, les autres ; à type égal, la plus proche,
// puis le nom. Les machines entendues mais absentes de toute carte suivent (on peut aussi les choisir).
export function rankMachines(gym, place, play) {
  const heard = new Map((gym?.nearby || []).map((n) => [n.id, n.rssi]));
  const order = { yes: 0, maybe: 1, no: 2 };
  const rows = (place?.machines || []).map((m) => ({ ...m, mapped: true, rssi: heard.get(m.id) ?? null, fit: fits(m.kind, play) }));
  const mapped = new Set((gym?.places || []).flatMap((p) => p.machines.map((m) => m.id)));
  for (const n of gym?.nearby || []) {
    if (!mapped.has(n.id)) rows.push({ id: n.id, name: n.name, label: null, title: n.name, kind: n.kind, x: null, y: null, err: null, mapped: false, rssi: n.rssi, fit: fits(n.kind, play) });
  }
  const close = (r) => r.rssi !== null && r.rssi >= -55 && r.fit !== 'no';
  return rows.sort(
    (a, b) =>
      close(b) - close(a) ||
      order[a.fit] - order[b.fit] ||
      b.mapped - a.mapped ||
      (b.rssi ?? -999) - (a.rssi ?? -999) ||
      a.title.localeCompare(b.title, 'fr', { numeric: true }),
  );
}

// Machine du lieu entendue le plus fort à l'instant (celle devant laquelle on se tient), ou null.
export function nearestId(gym, place) {
  const ids = new Set((place?.machines || []).map((m) => m.id));
  return (gym?.nearby || []).find((n) => ids.has(n.id))?.id ?? null;
}

// Dernière machine choisie pour un lieu et un mode de jeu (mémorisée sur l'appareil).
export const CHOICE_KEY = 'mycycleworld.gym.choice';
export function loadChoices(storage) {
  try {
    const v = JSON.parse(storage?.getItem(CHOICE_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
export function saveChoice(storage, placeId, play, machineId) {
  const all = loadChoices(storage);
  all[`${placeId}|${play}`] = machineId;
  try {
    storage?.setItem(CHOICE_KEY, JSON.stringify(all));
  } catch {
    /* stockage indisponible : choix valable pour cette session seulement */
  }
  return all;
}
export function lastChoice(choices, placeId, play) {
  return choices?.[`${placeId}|${play}`] ?? null;
}

// La machine envoie-t-elle de vraies données d'effort (quelqu'un pédale, rame, marche) ?
// C'est le signal de départ de la course quand on attend la machine choisie sur la carte.
export function isMoving(data) {
  if (!data) return false;
  return (data.power ?? 0) > 0 || (data.cadence ?? 0) > 0 || (data.speed ?? 0) > 0.5 || (data.strokeRate ?? 0) > 0 || (data.stepRate ?? 0) > 0;
}

// Attente de la machine choisie, avant le départ : 'connecting' (elle dort, connexion en attente),
// 'other' (une autre machine est branchée), 'idle' (branchée, on attend le premier effort), 'go'.
export function gateStatus(trainer, machineId) {
  if (!trainer?.connected) return 'connecting';
  if (machineId && trainer.id && trainer.id.toUpperCase() !== machineId.toUpperCase()) return 'other';
  return isMoving(trainer.data) ? 'go' : 'idle';
}
