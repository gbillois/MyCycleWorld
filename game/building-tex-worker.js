// Worker : calcule les textures des bâtiments hors du fil principal (voir building-textures.js).
import { generateBuildingTextures } from './building-textures.js';

self.onmessage = (e) => {
  try {
    const out = generateBuildingTextures(e.data.S);
    self.postMessage(out, [out.alb.buffer, out.nrm.buffer]);
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
