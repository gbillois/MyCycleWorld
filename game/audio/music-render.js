// Rendu hors ligne de la musique (module pur, appelé par le travailleur de rendu) : calcule toutes les
// cellules d'une couche d'un morceau (music-gen.js) avec les instruments de music-synth.js, puis égalise la
// couche à une sonie cible (mêmes niveaux d'une ambiance à l'autre) et adoucit ses crêtes.
// Une couche par requête : la nappe arrive en premier et la musique démarre sans attendre le reste.
import { makeSong, MUSIC_SR, DRUM_ROWS, STEREO_LAYERS, LAYER_TAILS, LAYERS, cellLength, layerGains, nextSection } from './music-gen.js';
import * as M from './music-synth.js';
import { Filter, loudness } from './dsp.js';
import { rng, hashSeed } from './random.js';

// Sonie de chaque couche seule sur sa section de référence (LUFS) : fixe l'équilibre du mélange.
// La mélodie passe devant, la batterie reste feutrée, la nappe et la basse portent l'ensemble.
export const LAYER_TARGET = { pad: -25, keys: -25.5, bass: -25.5, groove: -28, drums: -28, lead: -23 };
// Ordre de rendu : ce qui joue dès l'intro d'abord.
export const PART_ORDER = ['pad', 'keys', 'bass', 'groove', 'lead', 'drums'];

const songs = new Map();
export function songFor(mood) {
  if (!songs.has(mood)) songs.set(mood, makeSong(mood));
  return songs.get(mood);
}

// --- Batterie : coups mémorisés par morceau (deux ou trois variantes par instrument) ---
function drumKit(song) {
  const memo = new Map();
  const kit = song.inst.kit || {};
  return (row, variant) => {
    const k = `${row}|${variant}`;
    if (!memo.has(k)) {
      const def = DRUM_ROWS[row];
      const p = { ...kit, f: def.f ? def.f * (kit.tune ?? 1) : undefined, dur: song.barSec };
      memo.set(k, M.drumHit(def.kind, MUSIC_SR, rng(hashSeed(`${song.mood}|${k}`)), p));
    }
    return memo.get(k);
  };
}

const VARIANTS = { hat: 3, shaker: 3, snare: 2, clap: 2, rim: 2, ohat: 2, conga: 2, congaL: 2, bongo: 2, tamb: 2 };

function renderDrums(song, cell, out, kit) {
  const S = song.barLen / 16;
  const sr = MUSIC_SR;
  const evs = cell.events;
  evs.forEach((e, idx) => {
    const def = DRUM_ROWS[e.row];
    const variant = idx % (VARIANTS[e.row] ?? 1);
    let hit = kit(e.row, variant);
    const t = Math.round(e.t * S);
    let n = hit.length;
    // Charleston ouvert étouffé par le coup de charleston suivant
    if (e.row === 'ohat') {
      const next = evs.find((x, j) => j > idx && (x.row === 'hat' || x.row === 'ohat'));
      if (next) n = Math.min(n, Math.round(next.t * S) - t + Math.round(sr * 0.012));
    }
    const g = def.g * Math.pow(e.v, 1.3);
    const a = ((Math.max(-1, Math.min(1, def.pan)) + 1) * Math.PI) / 4;
    const gl = Math.cos(a) * g * Math.SQRT2;
    const gr = Math.sin(a) * g * Math.SQRT2;
    const F = Math.round(sr * 0.012);
    for (let i = 0; i < n && t + i < out.l.length; i++) {
      let y = hit[i];
      if (n < hit.length && i > n - F) y *= (n - i) / F;
      out.l[t + i] += y * gl;
      out.r[t + i] += y * gr;
    }
  });
  // Compresseur de bus : colle les coups ensemble sans écraser la grosse caisse
  let pk = 0;
  for (let i = 0; i < out.l.length; i++) pk = Math.max(pk, Math.abs(out.l[i]), Math.abs(out.r[i]));
  if (pk > 0) M.compress(out, sr, { threshold: pk * 0.45, ratio: 2.5, attack: 0.005, release: 0.12 });
  for (const c of [out.l, out.r]) {
    new Filter('highpass', 30, 0.7, sr).run(c);
    new Filter('lowpass', 10000, 0.6, sr).run(c);
  }
}

// Une cellule : { l, r } (r nul pour les couches mono), longueur = mesures + traîne de la couche.
export function renderCell(song, cell, kit = null) {
  const sr = MUSIC_SR;
  const S = song.barLen / 16;
  const n = cellLength(song, cell);
  const out = { l: new Float32Array(n), r: STEREO_LAYERS[cell.layer] ? new Float32Array(n) : null };
  const r = rng(hashSeed(`${song.mood}|${cell.id}`));
  const I = song.inst;
  const ev = (e) => ({ t: Math.round(e.t * S), n: Math.max(1, Math.round(e.n * S)), m: e.m, v: e.v, pan: e.pan, notes: e.notes });
  const post = (hp, lp) => {
    for (const c of out.r ? [out.l, out.r] : [out.l]) {
      new Filter('highpass', hp, 0.7, sr).run(c);
      new Filter('lowpass', lp, 0.6, sr).run(c);
    }
  };
  switch (cell.layer) {
    case 'pad':
      for (const e of cell.events) M.renderPad(out, sr, ev(e), I.pad, r);
      post(130, 7000);
      break;
    case 'keys': {
      let body = false;
      for (const e of cell.events) {
        const p = I[e.inst];
        const x = ev(e);
        if (p.type === 'string') {
          M.renderString(out, sr, x, p, r);
          body ||= p.body;
        } else if (p.type === 'ep') M.renderEP(out, sr, x, p, r);
        else if (p.type === 'modal') M.renderModal(out, sr, x, p, r);
        else if (p.type === 'pluck') M.renderPluck(out, sr, x, p, r);
      }
      if (body) {
        // Caisse de guitare : un peu de rondeur vers 200 Hz, moins de nasillard vers 1 kHz
        new Filter('peaking', 210, 1, sr, 2.5).run(out.l);
        new Filter('peaking', 1100, 1.2, sr, -2).run(out.l);
      }
      post(180, 7500);
      break;
    }
    case 'bass': {
      const p = I.bass;
      if (p.type === 'string') for (const e of cell.events) M.renderString(out, sr, ev(e), p, r);
      else M.renderMono(out, sr, cell.events.map(ev), p, r);
      post(32, 2400);
      break;
    }
    case 'lead': {
      const p = I.lead;
      // Voix 0 : la mélodie (et sa doublure) ; voix 1 : la seconde voix du dernier refrain
      for (const voice of [0, 1]) {
        const evs = cell.events.filter((e) => (e.voice ?? 0) === voice);
        if (!evs.length) continue;
        if (p.type === 'modal') for (const e of evs) M.renderModal(out, sr, ev(e), p, r);
        else M.renderMono(out, sr, evs.map(ev), p, r);
        if (p.double && voice === 0) for (const e of evs) M.renderModal(out, sr, { ...ev(e), m: e.m + (p.double.oct ?? 12), v: e.v * p.double.gain }, p.double, r);
      }
      post(200, 7500);
      break;
    }
    default:
      renderDrums(song, cell, out, kit || drumKit(song));
  }
  return out;
}

// Section de référence d'une couche (refrain, sinon la première section où elle joue).
function refSection(song, layer) {
  for (const name of ['B', 'A', ...song.form]) {
    const s = song.sections[name];
    if (s && s.layers[layer].some(Boolean)) return s;
  }
  return null;
}

// Mixage d'une couche sur une section (cellules posées à leurs mesures), pour mesurer sa sonie.
export function layerSequence(song, layer, section, cells) {
  const len = section.bars * song.barLen + Math.round(LAYER_TAILS[layer] * song.sr);
  const stereo = STEREO_LAYERS[layer];
  const l = new Float32Array(len);
  const r = stereo ? new Float32Array(len) : null;
  section.layers[layer].forEach((id, b) => {
    const c = id && cells.get(id);
    if (!c) return;
    const at = b * song.barLen;
    for (let i = 0; i < c.l.length && at + i < len; i++) {
      l[at + i] += c.l[i];
      if (r) r[at + i] += c.r[i];
    }
  });
  return { l, r, end: section.bars * song.barLen };
}

// Fondu de fin de cellule (la traîne finit à zéro, aucun clic si la cellule suivante ne la recouvre pas).
function fadeTail(c, song, layer) {
  const F = Math.round(LAYER_TAILS[layer] * song.sr * 0.45);
  for (const ch of c.r ? [c.l, c.r] : [c.l]) {
    const n = ch.length;
    for (let i = 0; i < F; i++) ch[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / F);
  }
}

// Rend une couche entière d'un morceau : { sampleRate, channels, meta: { cells: [{ id, ch, n }], gain } }.
// part 'verb' : réponse impulsionnelle de la réverbération du morceau, au taux du contexte audio.
export async function renderMusicPart(ctxSr, { mood, part }, env = {}) {
  const song = songFor(mood);
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  if (part === 'verb') {
    const ir = M.renderPlate(ctxSr, rng(hashSeed(`verb|${mood}`)), { t60: song.fx.t60 });
    return { sampleRate: ctxSr, channels: [ir.l, ir.r], meta: { part, mood } };
  }
  const list = Object.values(song.cells).filter((c) => c.layer === part);
  const kit = part === 'groove' || part === 'drums' ? drumKit(song) : null;
  const cells = new Map();
  for (const c of list) {
    cells.set(c.id, renderCell(song, c, kit));
    if (env.yieldFn) await env.yieldFn();
  }
  let gain = 1;
  const ref = refSection(song, part);
  if (ref) {
    const seq = layerSequence(song, part, ref, cells);
    // Couche mono : jouée au centre à 0,707 de chaque côté (panoramique à puissance constante), soit -3 dB
    const lu = loudness(seq.l, seq.r, MUSIC_SR, 0, seq.end) - (seq.r ? 0 : 3.01);
    gain = Math.pow(10, (LAYER_TARGET[part] + (song.mix[part] ?? 0) - lu) / 20);
  }
  const channels = [];
  const meta = { part, mood, gain, cells: [], ms: 0 };
  for (const c of list) {
    const buf = cells.get(c.id);
    const chans = buf.r ? [buf.l, buf.r] : [buf.l];
    for (const ch of chans) {
      for (let i = 0; i < ch.length; i++) ch[i] *= gain;
      M.softLimit(ch, 0.5, 0.72);
    }
    fadeTail(buf, song, part);
    meta.cells.push({ id: c.id, ch: channels.length, n: chans.length });
    channels.push(...chans);
  }
  meta.ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  return { sampleRate: MUSIC_SR, channels, meta };
}

// Mixage hors ligne d'un passage (tests, analyses) : enchaîne les sections comme le lecteur, à intensité fixe.
// cells : Map id -> { l, r } (couches rendues). Renvoie { l, r, sections: [{ name, at }] } au taux de la musique.
// Les couches mono sont posées au centre (le chorus et le panoramique du lecteur ne sont pas simulés).
export function mixdown(song, cells, { intensity = 2, bars = 48, from = 0, weights = null } = {}) {
  const g = layerGains(song, intensity);
  if (weights) for (const k of LAYERS) g[k] *= weights[k] ?? 0;
  const total = bars * song.barLen;
  const pad = Math.round(2 * song.sr);
  const l = new Float32Array(total + pad);
  const r = new Float32Array(total + pad);
  const sections = [];
  let idx = from;
  let b = 0;
  while (b < bars) {
    const name = song.form[idx];
    const sec = song.sections[name];
    sections.push({ name, at: b * song.barLen });
    for (let k = 0; k < sec.bars && b < bars; k++, b++) {
      for (const layer of LAYERS) {
        const id = sec.layers[layer][k];
        const c = id && cells.get(id);
        if (!c || !(g[layer] > 0)) continue;
        const at = b * song.barLen;
        const gl = g[layer];
        const cr = c.r || c.l;
        const k2 = c.r ? 1 : Math.SQRT1_2;
        for (let i = 0; i < c.l.length && at + i < l.length; i++) {
          l[at + i] += c.l[i] * gl * k2;
          r[at + i] += cr[i] * gl * k2;
        }
      }
    }
    idx = nextSection(song, idx, intensity);
  }
  return { l, r, sections, length: total };
}
