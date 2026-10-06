// Textures des bâtiments (module pur, sans three.js : utilisable dans un Worker) : une couche par famille de
// matière (enduit, pierre, pierre de taille, planches, rondins, tuiles, ardoises, bardeaux, tôle, verre, peinture,
// béton, rayures, paille, cadran, vitrail, bûches), peinte sur des toiles (OffscreenCanvas dans un Worker) ou
// calculée pixel par pixel, en mosaïque. Sortie : albédo + masque de teinte (RGBA), normale + rugosité (RGBA).

export const LAYER_COUNT = 17;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Générateur pseudo-aléatoire déterministe (même suite que rng() de track.js).
function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Hachage entier -> 0..1 (même formule que makeHash d'atmosphere.js).
function makeHash(seed) {
  return (ix, iz) => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

// Toile 2D : OffscreenCanvas si disponible (Worker), sinon élément canvas.
function canvas2d(S) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(S, S) : Object.assign(document.createElement('canvas'), { width: S, height: S });
  return c.getContext('2d', { willReadFrequently: true });
}

// Bruit de valeur périodique (période p cellules, octaves doublées), N × N, valeurs dans -1..1.
function periodicField(N, p, octaves, seed) {
  const out = new Float32Array(N * N);
  const r = rng(seed);
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++, p *= 2, amp *= 0.5) {
    const lat = new Float32Array(p * p);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    const cell = N / p;
    for (let y = 0; y < N; y++) {
      const fy = y / cell;
      const iy = Math.floor(fy);
      let ty = fy - iy;
      ty = ty * ty * (3 - 2 * ty);
      const r0 = (iy % p) * p;
      const r1 = ((iy + 1) % p) * p;
      for (let x = 0; x < N; x++) {
        const fx = x / cell;
        const ix = Math.floor(fx);
        let tx = fx - ix;
        tx = tx * tx * (3 - 2 * tx);
        const c0 = ix % p;
        const c1 = (ix + 1) % p;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * tx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * tx;
        out[y * N + x] += amp * (a + (b - a) * ty);
      }
    }
    norm += amp;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] / norm) * 2 - 1;
  return out;
}

// Champs de bruit périodiques (256², calculés une fois).
let noiseCache = null;
function noiseFields() {
  if (noiseCache) return noiseCache;
  noiseCache = { lo: periodicField(256, 4, 3, 71), mid: periodicField(256, 16, 2, 72) };
  return noiseCache;
}

// Toiles de peinture d'une couche : albédo (a), hauteur (h), masque de teinte (m), en coordonnées 0..256.
function painter(S) {
  const make = () => {
    const g = canvas2d(S);
    g.setTransform(S / 256, 0, 0, S / 256, 0, 0);
    return g;
  };
  const P = { a: make(), h: make(), m: make() };
  P.all = [P.a, P.h, P.m];
  // Forme répétée de l'autre côté des bords (raccord parfait en mosaïque).
  P.wrap = (x, y, w, hh, draw) => {
    for (const ox of [-256, 0, 256]) {
      for (const oy of [-256, 0, 256]) {
        if (x + ox > 256 || x + ox + w < 0 || y + oy > 256 || y + oy + hh < 0) continue;
        draw(x + ox, y + oy);
      }
    }
  };
  P.fill = (g, col, x, y, w, h, r = 0) => {
    g.fillStyle = col;
    g.beginPath();
    if (r > 0) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
    g.fill();
  };
  // Bloc en relief : couleur, puis hauteur en trois paliers (arêtes biseautées).
  P.block = (x, y, w, h, r, col, hgt, mask = 255, bev = 2) => {
    P.wrap(x, y, w, h, (X, Y) => {
      P.fill(P.a, col, X, Y, w, h, r);
      P.fill(P.m, `rgb(${mask},${mask},${mask})`, X, Y, w, h, r);
      for (let k = 0; k < 3; k++) {
        const v = Math.round(hgt * (0.55 + 0.225 * k));
        const ins = k * bev;
        if (w - ins * 2 <= 0 || h - ins * 2 <= 0) break;
        P.fill(P.h, `rgb(${v},${v},${v})`, X + ins, Y + ins, w - ins * 2, h - ins * 2, Math.max(0, r - ins));
      }
    });
  };
  return P;
}
const grey = (v) => `rgb(${v},${v},${v})`;
const rgbS = (r, g, b) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

// Définition des couches : peinture sur toile (paint), calcul par pixel (px), rugosité, relief, bruit.
// px(u, v, o) : u, v en 0..256 ; o = { r, g, b (0..1), h (0..1), m (0..1), ro (rugosité) } à modifier.
const LAYER_DEFS = [
  // Enduit : grain fin, nuances douces.
  { rough: 0.93, normal: 1.4, noise: [0.07, 0.04, 0.05], hn: [0.3, 0.35, 0.6], base: [0.97, 0.96, 0.94], h: 0.5 },
  // Pierre (moellons irréguliers et joints)
  {
    rough: 0.9, normal: 2.6, noise: [0.06, 0.05, 0.07], hn: [0.05, 0.12, 0.3],
    paint(P, r) {
      P.fill(P.a, '#8a857b', 0, 0, 256, 256);
      P.fill(P.h, grey(40), 0, 0, 256, 256);
      P.fill(P.m, grey(70), 0, 0, 256, 256);
      const rows = [];
      let tot = 0;
      while (tot < 256) {
        const hh = 22 + r() * 16;
        rows.push(hh);
        tot += hh;
      }
      const k = 256 / tot;
      let y = 0;
      for (const rh0 of rows) {
        const rh = rh0 * k;
        const ws = [];
        let tw = 0;
        while (tw < 256) {
          const w = 24 + r() * 38;
          ws.push(w);
          tw += w;
        }
        const kw = 256 / tw;
        let x = r() * 256;
        for (const w0 of ws) {
          const w = w0 * kw;
          const v = 150 + r() * 62;
          const warm = (r() - 0.4) * 18;
          const jy = (r() - 0.5) * 3;
          P.block(x + 1.4, y + 1.4 + jy, w - 2.8, rh - 2.8, 3 + r() * 4, rgbS(v + warm, v + warm * 0.4, v - warm * 0.5), 190 + r() * 65, 190, 1.8);
          x += w;
        }
        y += rh;
      }
    },
  },
  // Pierre de taille (blocs réguliers)
  {
    rough: 0.86, normal: 2.2, noise: [0.05, 0.04, 0.05], hn: [0.05, 0.1, 0.2],
    paint(P, r) {
      P.fill(P.a, '#b7b0a3', 0, 0, 256, 256);
      P.fill(P.h, grey(50), 0, 0, 256, 256);
      P.fill(P.m, grey(160), 0, 0, 256, 256);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 64 : 0;
        for (let c = 0; c < 2; c++) {
          const v = 222 + r() * 30;
          P.block(off + c * 128 + 1.5, row * 64 + 1.5, 125, 61, 3, rgbS(v, v * 0.985, v * 0.95), 230 + r() * 25, 220, 1.6);
        }
      }
    },
  },
  // Planches verticales (bardage, granges)
  {
    rough: 0.82, normal: 2.0, noise: [0.04, 0.04, 0.05], hn: [0.02, 0.05, 0.12],
    paint(P, r) {
      P.fill(P.a, '#4a3a2c', 0, 0, 256, 256);
      P.fill(P.h, grey(20), 0, 0, 256, 256);
      P.fill(P.m, grey(255), 0, 0, 256, 256);
      for (let i = 0; i < 8; i++) {
        const x = i * 32;
        const v = 225 + r() * 30;
        P.block(x + 1.2, -2, 29.6, 260, 2, rgbS(v, v * 0.97, v * 0.93), 235, 255, 1.4);
        for (let k = 0; k < 22; k++) {
          const gx = x + 3 + r() * 26;
          P.a.strokeStyle = `rgba(70,45,25,${0.06 + r() * 0.12})`;
          P.a.lineWidth = 0.6 + r() * 0.9;
          P.a.beginPath();
          for (let yy = 0; yy <= 256; yy += 16) P.a.lineTo(gx + Math.sin(yy * 0.05 + k) * 1.2, yy);
          P.a.stroke();
        }
        if (r() < 0.6) {
          const ky = r() * 240;
          const kx = x + 8 + r() * 16;
          P.a.fillStyle = 'rgba(70,40,20,0.45)';
          P.a.beginPath();
          P.a.ellipse(kx, ky, 2.6, 4.2, 0, 0, Math.PI * 2);
          P.a.fill();
        }
        P.a.fillStyle = 'rgba(40,40,40,0.7)';
        for (const ny of [36, 196]) P.a.fillRect(x + 15, ny, 2, 2);
      }
    },
  },
  // Planches horizontales arrondies (rondins de chalet, bardage, platelage)
  {
    rough: 0.82, normal: 2.0, noise: [0.04, 0.04, 0.05], hn: [0.02, 0.04, 0.1],
    paint(P, r) {
      P.fill(P.a, '#3e2e22', 0, 0, 256, 256);
      P.fill(P.m, grey(255), 0, 0, 256, 256);
      for (let i = 0; i < 10; i++) {
        const y = i * 25.6;
        let x = r() * 256;
        let left = 256;
        while (left > 0) {
          const len = Math.min(left, 70 + r() * 140);
          const v = 222 + r() * 33;
          P.wrap(x, y, len, 25.6, (X, Y) => {
            P.fill(P.a, rgbS(v, v * 0.96, v * 0.9), X + 0.8, Y + 1, len - 1.6, 23.6, 2);
            const g = P.h.createLinearGradient(0, Y, 0, Y + 25.6);
            g.addColorStop(0, grey(70));
            g.addColorStop(0.5, grey(235));
            g.addColorStop(1, grey(90));
            P.h.fillStyle = g;
            P.h.fillRect(X + 0.8, Y + 1, len - 1.6, 23.6);
            for (let k = 0; k < 7; k++) {
              P.a.strokeStyle = `rgba(80,50,28,${0.06 + r() * 0.12})`;
              P.a.lineWidth = 0.5 + r() * 0.8;
              const gy = Y + 3 + r() * 20;
              P.a.beginPath();
              P.a.moveTo(X + 2, gy);
              P.a.bezierCurveTo(X + len * 0.3, gy + (r() - 0.5) * 4, X + len * 0.7, gy + (r() - 0.5) * 4, X + len - 2, gy);
              P.a.stroke();
            }
          });
          x += len;
          left -= len;
        }
      }
    },
  },
  // Tuiles (rangées qui se chevauchent, galbées)
  {
    rough: 0.72, normal: 2.6, noise: [0.06, 0.05, 0.04], hn: [0.02, 0.04, 0.06], base: [1, 0.98, 0.95],
    px(u, v, o, H) {
      const row = Math.floor(v / 32);
      const f = (v - row * 32) / 32;
      const uu = u + (row % 2) * 16;
      const col = Math.floor(uu / 32) % 8;
      const g = (uu % 32) / 32;
      const t = H(row, col);
      o.h = 0.92 - 0.55 * f + 0.22 * Math.sin(Math.PI * g);
      let lum = (0.86 + t * 0.2) * (1 - 0.32 * smoothstep(0.62, 1, f)) * (0.86 + 0.14 * Math.sin(Math.PI * g));
      if (g < 0.035 || g > 0.965) { lum *= 0.7; o.h -= 0.18; }
      o.r = lum * (1 + (t - 0.5) * 0.08);
      o.g = lum * (1 - (t - 0.5) * 0.04);
      o.b = lum * (0.97 - (t - 0.5) * 0.06);
      o.ro = 0.62 + t * 0.2;
    },
  },
  // Ardoises / lauzes (largeurs irrégulières, bords inférieurs inégaux)
  {
    rough: 0.6, normal: 2.6, noise: [0.06, 0.05, 0.05], hn: [0.02, 0.04, 0.08],
    init(r) {
      const rows = [];
      for (let k = 0; k < 8; k++) {
        const cuts = [0];
        let x = r() * 20;
        while (x < 256 - 18) {
          cuts.push(x);
          x += 18 + r() * 22;
        }
        rows.push({ cuts: cuts.slice(1), shift: r() * 256 });
      }
      return rows;
    },
    px(u, v, o, H, D) {
      const row = Math.floor(v / 32);
      const R = D[row];
      const uu = (u + R.shift) % 256;
      let c = 0;
      while (c < R.cuts.length && R.cuts[c] <= uu) c++;
      const a = c === 0 ? R.cuts[R.cuts.length - 1] - 256 : R.cuts[c - 1];
      const b = c === R.cuts.length ? R.cuts[0] + 256 : R.cuts[c];
      const g = (uu - a) / (b - a);
      const t = H(row, c);
      const jag = (H(row + 31, c) - 0.5) * 5;
      const f = Math.max(0, (v - row * 32 - jag) / 32);
      o.h = 0.85 - 0.45 * Math.min(1, f) + (t - 0.5) * 0.25 * (g - 0.5);
      let lum = (0.72 + t * 0.34) * (1 - 0.35 * smoothstep(0.6, 1, f));
      if (g < 0.05 || g > 0.95) { lum *= 0.72; o.h -= 0.15; }
      if (f < 0.06) lum *= 1.08;
      const hue = H(row + 7, c) - 0.5;
      o.r = lum * (1 + hue * 0.08);
      o.g = lum;
      o.b = lum * (1.03 - hue * 0.06);
      o.ro = 0.48 + t * 0.25;
    },
  },
  // Bardeaux de bois
  {
    rough: 0.86, normal: 2.4, noise: [0.05, 0.05, 0.06], hn: [0.02, 0.04, 0.1],
    init(r) {
      const rows = [];
      for (let k = 0; k < 16; k++) {
        const cuts = [];
        let x = r() * 8;
        while (x < 256 - 9) {
          cuts.push(x);
          x += 9 + r() * 12;
        }
        rows.push({ cuts, shift: r() * 256 });
      }
      return rows;
    },
    px(u, v, o, H, D) {
      const row = Math.floor(v / 16);
      const R = D[row];
      const uu = (u + R.shift) % 256;
      let c = 0;
      while (c < R.cuts.length && R.cuts[c] <= uu) c++;
      const a = c === 0 ? R.cuts[R.cuts.length - 1] - 256 : R.cuts[c - 1];
      const b = c === R.cuts.length ? R.cuts[0] + 256 : R.cuts[c];
      const g = (uu - a) / (b - a);
      const t = H(row, c);
      const f = (v - row * 16) / 16;
      o.h = 0.85 - 0.5 * f;
      let lum = (0.78 + t * 0.26) * (1 - 0.38 * smoothstep(0.55, 1, f)) * (0.93 + 0.07 * Math.sin(u * 2.1 + t * 40));
      if (g < 0.08 || g > 0.92) { lum *= 0.68; o.h -= 0.2; }
      o.r = lum;
      o.g = lum * 0.97;
      o.b = lum * 0.92;
    },
  },
  // Tôle ondulée
  {
    rough: 0.5, normal: 2.0, noise: [0.07, 0.04, 0.03], hn: [0, 0.01, 0.02],
    px(u, v, o, H) {
      o.h = 0.5 + 0.5 * Math.sin((u / 16) * Math.PI * 2);
      const seam = u % 128 < 2 ? 0.8 : 1;
      const streak = 0.93 + 0.07 * H(Math.floor(u / 3), 99);
      const l = (0.86 + 0.12 * Math.sin((u / 16) * Math.PI * 2 + 0.9)) * seam * streak;
      o.r = l;
      o.g = l;
      o.b = l * 1.01;
    },
  },
  // Verre (reflet doux, traînées en biais)
  {
    rough: 0.05, normal: 0, noise: [0.03, 0.02, 0.0], hn: [0, 0, 0],
    px(u, v, o) {
      const l = 0.82 + 0.1 * (v / 256) + 0.06 * Math.max(0, Math.sin((u + v * 0.6) * 0.04));
      o.r = l;
      o.g = l;
      o.b = l;
    },
  },
  // Peinture lisse (métal peint, plastique, tissu uni)
  { rough: 0.55, normal: 0.8, noise: [0.03, 0.02, 0.02], hn: [0.05, 0.05, 0.2], base: [0.97, 0.97, 0.97], h: 0.5 },
  // Béton (banches, pores)
  {
    rough: 0.92, normal: 1.6, noise: [0.08, 0.05, 0.06], hn: [0.1, 0.2, 0.5],
    px(u, v, o, H) {
      const l = 0.9 * (v % 64 < 1.2 ? 0.8 : 1) * (H(Math.floor(u / 2), Math.floor(v / 2)) > 0.985 ? 0.6 : 1);
      o.r = l;
      o.g = l;
      o.b = l * 0.98;
      o.h = 0.5 - (v % 64 < 1.2 ? 0.3 : 0);
    },
  },
  // Rayures peintes sur planches (cabines de plage, auvents, parasols)
  {
    rough: 0.6, normal: 1.6, noise: [0.03, 0.03, 0.03], hn: [0.02, 0.03, 0.08],
    px(u, v, o, H) {
      const b = Math.floor(u / 32);
      const g = (u % 32) / 32;
      o.m = b % 2;
      const l = 0.96 * (0.97 + 0.03 * Math.sin(v * 0.3 + b * 7)) * (H(b, Math.floor(v / 4)) > 0.97 ? 0.92 : 1);
      o.r = l;
      o.g = l;
      o.b = l * 0.99;
      o.h = g < 0.04 || g > 0.96 ? 0.15 : 0.6;
      if (g < 0.03 || g > 0.97) { o.r *= 0.6; o.g *= 0.6; o.b *= 0.6; }
    },
  },
  // Paille (foin)
  {
    rough: 0.95, normal: 2.2, noise: [0.05, 0.05, 0.08], hn: [0.05, 0.1, 0.2],
    paint(P, r) {
      P.fill(P.a, '#c9a447', 0, 0, 256, 256);
      P.fill(P.h, grey(90), 0, 0, 256, 256);
      P.fill(P.m, grey(40), 0, 0, 256, 256);
      for (let i = 0; i < 1600; i++) {
        const x = r() * 256;
        const y = r() * 256;
        const a = (r() - 0.5) * 0.9;
        const len = 8 + r() * 18;
        const v = r();
        P.wrap(x - len, y - len, len * 2, len * 2, (X, Y) => {
          P.a.strokeStyle = v < 0.5 ? `rgba(245,215,120,0.7)` : v < 0.8 ? `rgba(190,150,60,0.6)` : `rgba(120,90,40,0.5)`;
          P.a.lineWidth = 0.8 + r() * 0.8;
          P.a.beginPath();
          P.a.moveTo(X, Y);
          P.a.lineTo(X + Math.cos(a) * len, Y + Math.sin(a) * len);
          P.a.stroke();
          P.h.strokeStyle = grey(140 + Math.round(v * 110));
          P.h.lineWidth = 1;
          P.h.beginPath();
          P.h.moveTo(X, Y);
          P.h.lineTo(X + Math.cos(a) * len, Y + Math.sin(a) * len);
          P.h.stroke();
        });
      }
    },
  },
  // Cadran d'horloge (toute la case : bleu nuit, chiffres et aiguilles dorés)
  {
    rough: 0.6, normal: 2, noise: [0.02, 0.02, 0.02], hn: [0, 0, 0.05],
    paint(P) {
      P.fill(P.a, '#ece6da', 0, 0, 256, 256);
      P.fill(P.h, grey(80), 0, 0, 256, 256);
      P.fill(P.m, grey(0), 0, 0, 256, 256);
      const disc = (g, r0, col) => { g.fillStyle = col; g.beginPath(); g.arc(128, 128, r0, 0, Math.PI * 2); g.fill(); };
      disc(P.a, 122, '#c9a23a');
      disc(P.h, 122, grey(220));
      disc(P.a, 112, '#1d2b4a');
      disc(P.h, 112, grey(110));
      P.a.fillStyle = '#e2bf55';
      P.h.fillStyle = grey(230);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        for (const g of [P.a, P.h]) {
          g.save();
          g.translate(128, 128);
          g.rotate(a);
          g.fillRect(-3, -104, 6, k % 3 ? 14 : 22);
          g.restore();
        }
      }
      // Aiguilles à 10 h 10 (le haut de l'image est le bas de la face : v vers le haut)
      const hand = (a, len, wd) => {
        for (const g of [P.a, P.h]) {
          g.save();
          g.translate(128, 128);
          g.rotate(a);
          g.beginPath();
          g.moveTo(-wd, 0);
          g.lineTo(0, len);
          g.lineTo(wd, 0);
          g.lineTo(0, -12);
          g.closePath();
          g.fill();
          g.restore();
        }
      };
      hand(Math.PI * 2 * (10.17 / 12) + Math.PI, 62, 6);
      hand(Math.PI * 2 * (2 / 12) + Math.PI, 92, 4);
      disc(P.a, 8, '#e2bf55');
    },
    rf: (o) => (o.h > 0.75 ? 0.35 : 0.7),
  },
  // Vitrail en ogive dans son encadrement de pierre (toute la case)
  {
    rough: 0.85, normal: 2.2, noise: [0.04, 0.03, 0.03], hn: [0.02, 0.03, 0.05],
    paint(P, r) {
      P.fill(P.a, '#d9d1c2', 0, 0, 256, 256);
      P.fill(P.h, grey(205), 0, 0, 256, 256);
      P.fill(P.m, grey(0), 0, 0, 256, 256);
      // v vers le haut = y vers le bas de la toile : l'ogive est en bas de l'image
      const shape = (g, inset) => {
        g.beginPath();
        g.moveTo(34 + inset, 6 + inset);
        g.lineTo(222 - inset, 6 + inset);
        g.lineTo(222 - inset, 150);
        g.arc(128, 150, 94 - inset, 0, Math.PI, false);
        g.closePath();
      };
      P.a.fillStyle = '#8c8578';
      shape(P.a, 0);
      P.a.fill();
      P.h.fillStyle = grey(150);
      shape(P.h, 0);
      P.h.fill();
      P.a.save();
      shape(P.a, 9);
      P.a.clip();
      const pal = ['#1f4fb8', '#c4202f', '#e8b52c', '#2f8f4a', '#6a3fa0', '#2a78c8', '#d8641e'];
      for (let y = -20; y < 270; y += 26) {
        for (let x = -20; x < 280; x += 26) {
          P.a.fillStyle = pal[Math.floor(r() * pal.length)];
          P.a.beginPath();
          P.a.moveTo(x, y - 13);
          P.a.lineTo(x + 13, y);
          P.a.lineTo(x, y + 13);
          P.a.lineTo(x - 13, y);
          P.a.fill();
        }
      }
      P.a.fillStyle = '#e8b52c';
      P.a.beginPath();
      P.a.arc(128, 168, 44, 0, Math.PI * 2);
      P.a.fill();
      P.a.fillStyle = '#c4202f';
      P.a.beginPath();
      P.a.arc(128, 168, 30, 0, Math.PI * 2);
      P.a.fill();
      for (let k = 0; k < 8; k++) {
        P.a.fillStyle = k % 2 ? '#1f4fb8' : '#2f8f4a';
        P.a.beginPath();
        P.a.arc(128 + Math.cos((k / 8) * Math.PI * 2) * 37, 168 + Math.sin((k / 8) * Math.PI * 2) * 37, 8, 0, Math.PI * 2);
        P.a.fill();
      }
      P.a.restore();
      // Plombs
      P.h.save();
      shape(P.h, 9);
      P.h.clip();
      P.h.fillStyle = grey(70);
      P.h.fillRect(0, 0, 256, 256);
      P.h.strokeStyle = grey(150);
      P.a.strokeStyle = 'rgba(30,30,34,0.95)';
      for (const g of [P.a, P.h]) {
        g.lineWidth = 2.2;
        for (let d = -300; d < 600; d += 26) {
          g.beginPath();
          g.moveTo(d, 0);
          g.lineTo(d + 300, 300);
          g.moveTo(d, 300);
          g.lineTo(d + 300, 0);
          g.stroke();
        }
        g.beginPath();
        g.arc(128, 168, 44, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(128, 0);
        g.lineTo(128, 124);
        g.stroke();
      }
      P.h.restore();
    },
    rf: (o) => (o.h < 0.45 ? 0.12 : 0.85),
  },
  // Bûches empilées (bois de bout, cernes)
  {
    rough: 0.9, normal: 2.6, noise: [0.04, 0.04, 0.06], hn: [0.02, 0.05, 0.1],
    paint(P, r) {
      P.fill(P.a, '#2b2016', 0, 0, 256, 256);
      P.fill(P.h, grey(10), 0, 0, 256, 256);
      P.fill(P.m, grey(90), 0, 0, 256, 256);
      for (let row = 0; row < 8; row++) {
        for (let c = 0; c < 8; c++) {
          const rad = 13 + r() * 3;
          const x = c * 32 + (row % 2) * 16 + 16 + (r() - 0.5) * 4;
          const y = row * 32 + 16 + (r() - 0.5) * 4;
          P.wrap(x - rad, y - rad, rad * 2, rad * 2, (X, Y) => {
            const cx = X + rad;
            const cy = Y + rad;
            P.a.fillStyle = '#5a3d24';
            P.a.beginPath();
            P.a.arc(cx, cy, rad, 0, Math.PI * 2);
            P.a.fill();
            const v = 200 + r() * 40;
            P.a.fillStyle = rgbS(v, v * 0.82, v * 0.6);
            P.a.beginPath();
            P.a.arc(cx, cy, rad - 2.2, 0, Math.PI * 2);
            P.a.fill();
            P.a.strokeStyle = 'rgba(120,80,40,0.35)';
            P.a.lineWidth = 0.8;
            for (let k = 3; k < rad - 3; k += 2.4) {
              P.a.beginPath();
              P.a.arc(cx + 0.6, cy, k, 0, Math.PI * 2);
              P.a.stroke();
            }
            P.h.fillStyle = grey(200);
            P.h.beginPath();
            P.h.arc(cx, cy, rad, 0, Math.PI * 2);
            P.h.fill();
            P.h.fillStyle = grey(235);
            P.h.beginPath();
            P.h.arc(cx, cy, rad - 3, 0, Math.PI * 2);
            P.h.fill();
          });
        }
      }
    },
  },
];

// Génère toutes les couches à la taille S (puissance de deux) : { alb, nrm } (Uint8ClampedArray, S × S × 4 × couches).
export function generateBuildingTextures(S = 256) {
  const { lo, mid } = noiseFields();
  const NN = S * S;
  const alb = new Uint8ClampedArray(NN * 4 * LAYER_COUNT);
  const nrm = new Uint8ClampedArray(NN * 4 * LAYER_COUNT);
  const hgt = new Float32Array(NN);
  const k = 256 / S;
  const sh = S / 256;
  const o = { r: 1, g: 1, b: 1, h: 0.5, m: 1, ro: 1 };
  // Grain fin (un tirage par pixel) et correspondance pixel -> case des champs de bruit 256²
  const fineT = new Float32Array(NN);
  const nIdx = new Int32Array(NN);
  const rf = rng(91);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      fineT[i] = rf() * 2 - 1;
      nIdx[i] = ((y * k) | 0) * 256 + ((x * k) | 0);
    }
  }
  const times = [];
  LAYER_DEFS.forEach((def, li) => {
    const t0 = performance.now();
    const r = rng(1000 + li * 17);
    const H = makeHash(500 + li);
    const D = def.init ? def.init(r) : null;
    let img = null;
    if (def.paint) {
      const P = painter(S);
      def.paint(P, r);
      img = { a: P.a.getImageData(0, 0, S, S).data, h: P.h.getImageData(0, 0, S, S).data, m: P.m.getImageData(0, 0, S, S).data };
    }
    const base = def.base || [1, 1, 1];
    const off = li * NN * 4;
    const [na, nb, nc] = def.noise;
    const [ha, hb, hc] = def.hn;
    const px = def.px;
    const rfn = def.rf;
    const h0 = def.h ?? 0.5;
    const rough = def.rough;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        if (img) {
          const q = i * 4;
          o.r = img.a[q] / 255;
          o.g = img.a[q + 1] / 255;
          o.b = img.a[q + 2] / 255;
          o.h = img.h[q] / 255;
          o.m = img.m[q] / 255;
        } else {
          o.r = base[0];
          o.g = base[1];
          o.b = base[2];
          o.h = h0;
          o.m = 1;
        }
        o.ro = rough;
        if (px) px(x * k, y * k, o, H, D);
        const ni = nIdx[i];
        const f = fineT[i];
        const n = 1 + lo[ni] * na + mid[ni] * nb + f * nc;
        hgt[i] = o.h + lo[ni] * ha + mid[ni] * hb + f * hc * 0.5;
        const ro = rfn ? rfn(o) : o.ro;
        const p = off + i * 4;
        alb[p] = o.r * n * 255;
        alb[p + 1] = o.g * n * 255;
        alb[p + 2] = o.b * n * 255;
        alb[p + 3] = o.m * 255 + 0.5;
        nrm[p + 3] = (ro + f * 0.04 * Math.min(1, ro * 3)) * 255;
      }
    }
    // Normales depuis la hauteur (raccord en mosaïque)
    const s = def.normal * sh;
    for (let y = 0; y < S; y++) {
      const y0 = ((y - 1 + S) % S) * S;
      const y1 = ((y + 1) % S) * S;
      const yc = y * S;
      for (let x = 0; x < S; x++) {
        const x0 = x === 0 ? S - 1 : x - 1;
        const x1 = x === S - 1 ? 0 : x + 1;
        const dx = (hgt[yc + x1] - hgt[yc + x0]) * s;
        const dy = (hgt[y1 + x] - hgt[y0 + x]) * s;
        const l = 127.5 / Math.sqrt(dx * dx + dy * dy + 1);
        const p = off + (yc + x) * 4;
        nrm[p] = 127.5 - dx * l;
        nrm[p + 1] = 127.5 - dy * l;
        nrm[p + 2] = 127.5 + l;
      }
    }
    times.push(Math.round(performance.now() - t0));
  });
  return { alb, nrm, times };
}
