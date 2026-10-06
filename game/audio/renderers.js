// Catalogue des sons calculés (module pur) : nom -> fonction (sr, r, options). Utilisé par le travailleur
// de rendu (render-worker.js) et, s'il n'est pas disponible, directement sur le fil principal.
import * as V from './voices.js';
import * as S from './sounds.js';
import { birdSong } from './patterns.js';
import { rng } from './random.js';

const at32 = (data) => ({ sampleRate: 32000, data });

export const RENDERERS = {
  // Nature et animaux : oiseaux et voix rendus à 32 kHz (tout leur spectre tient sous 16 kHz, mémoire réduite)
  song: (sr, r, o) => at32(V.renderSong(32000, birdSong(o.species, r))),
  cow: (sr, r) => at32(V.renderCow(32000, r)),
  sheep: (sr, r) => at32(V.renderSheep(32000, r)),
  rooster: (sr, r) => at32(V.renderRooster(32000, r)),
  duck: (sr, r) => at32(V.renderDuck(32000, r)),
  gull: (sr, r) => at32(V.renderGull(32000, r)),
  raptor: (sr, r) => at32(V.renderRaptor(32000, r)),
  horse: (sr, r) => at32(V.renderHorse(32000, r)),
  bee: (sr, r) => at32(V.renderBee(32000, r)),
  // Boucles et cloches également à 32 kHz (aucun contenu utile au-dessus de 16 kHz)
  cowbell: (sr, r, o) => at32(V.renderCowbell(32000, r, o)),
  church: (sr, r, o) => at32(V.renderChurchBell(32000, r, o)),
  tok: (sr, r, o) => V.renderWoodTok(sr, r, o),
  water: (sr, r, o) => at32(V.renderWaterLoop(32000, r, o)),
  lapping: (sr, r, o) => at32(V.renderLapping(32000, r, o)),
  splash: (sr, r, o) => V.renderSplash(sr, r, o),
  gurgle: (sr, r, o) => V.renderGurgle(sr, r, o),
  drips: (sr, r) => V.renderDrips(sr, r),
  paddle: (sr, r, o) => V.renderPaddle(sr, r, o),
  seat: (sr, r, o) => V.renderSeatSlide(sr, r, o),
  oarlock: (sr, r) => V.renderOarlock(sr, r),
  crunch: (sr, r, o) => at32(V.renderCrunch(32000, r, o)),
  insects: (sr, r, o) => at32(V.renderInsects(32000, r, o)),
  // Foule : voix rendues à 22 kHz (formants sous 4 kHz), applaudissements à 32 kHz
  crowd: async (sr, r, o, env) => ({ sampleRate: 22050, data: await V.renderCrowd(22050, r, { ...o, yieldFn: env.yieldFn }) }),
  chant: (sr, r, o) => ({ sampleRate: 22050, data: V.renderChant(22050, r, o) }),
  applause: async (sr, r, o, env) => ({ sampleRate: 32000, data: await V.renderApplause(32000, r, { ...o, yieldFn: env.yieldFn }) }),
  // Jeu
  beep: (sr, r, o) => S.renderBeep(sr, r, o),
  horn: (sr, r) => S.renderHorn(sr, r),
  whistle: (sr, r) => S.renderWhistle(sr, r),
  pickup: (sr, r) => S.renderPickup(sr, r),
  turbo: (sr, r) => S.renderTurbo(sr, r),
  banana: (sr, r) => S.renderBananaDrop(sr, r),
  skid: (sr, r) => S.renderSkid(sr, r),
  bump: (sr, r) => S.renderBump(sr, r),
  whoosh: (sr, r, o) => S.renderWhoosh(sr, r, o),
  lap: (sr, r) => S.renderLapChime(sr, r),
  finalLap: (sr, r) => S.renderFinalLap(sr, r),
  fanfare: (sr, r) => S.renderFanfare(sr, r),
  sting: (sr, r, o) => S.renderSting(sr, r, o),
  gear: (sr, r) => S.renderGearClick(sr, r),
  ui: (sr, r, o) => S.renderUi(sr, r, o),
  // Kayak
  gateDing: (sr, r) => S.renderGateDing(sr, r),
  gateBuzz: (sr, r) => S.renderGateBuzz(sr, r),
  sprintWhoosh: (sr, r) => S.renderSprintWhoosh(sr, r),
  sprintFail: (sr, r) => S.renderSprintFail(sr, r),
  whirlpool: (sr, r, o) => S.renderWhirlpool(sr, r, o),
  kayakSplash: (sr, r) => S.renderKayakSplash(sr, r),
  // VTT
  jumpChime: (sr, r) => S.renderJumpChime(sr, r),
  land: (sr, r) => S.renderLand(sr, r),
  crash: (sr, r) => S.renderCrash(sr, r),
  squelch: (sr, r) => S.renderSquelch(sr, r),
  woodpecker: (sr, r) => at32(S.renderWoodpecker(32000, r)),
  // Musique et réverbération
  drum: (sr, r, o) => S.renderDrum(sr, r, o),
  // Notes rendues à 32 kHz : timbre intact, un tiers de mémoire en moins (une note par hauteur et instrument)
  note: (sr, r, o) => at32(S.renderNote(32000, r, o)),
  impulse: (sr, r, o) => S.renderImpulse(sr, r, o.preset),
  noise: (sr, r, o) => at32(S.renderNoiseLoop(32000, r, o)),
};

// Rend un son : { sampleRate, channels: [Float32Array, ...] }.
export async function renderSound(name, sr, seed, opts = {}, env = {}) {
  const fn = RENDERERS[name];
  if (!fn) throw new Error(`son inconnu : ${name}`);
  let out = await fn(sr, rng(seed), opts, env);
  let rate = sr;
  if (out && out.sampleRate && out.data) {
    rate = out.sampleRate;
    out = out.data;
  }
  const channels = out.l ? [out.l, out.r] : [out];
  return { sampleRate: rate, channels };
}
