// Travailleur de rendu : calcule les sons (oiseaux, cloches, foule, boucles d'eau...) hors du fil principal,
// pour que la synthèse ne fasse jamais sauter une image du jeu. Les tableaux sont transférés sans copie.
import { renderSound } from './renderers.js';

self.onmessage = async (e) => {
  const { id, name, sr, seed, opts } = e.data;
  try {
    const res = await renderSound(name, sr, seed, opts, { yieldFn: null });
    self.postMessage({ id, sampleRate: res.sampleRate, channels: res.channels, meta: res.meta }, res.channels.map((c) => c.buffer));
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
