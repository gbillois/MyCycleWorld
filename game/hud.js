// Affichage tête haute : mesures, position, tour, chrono, objet, mini-carte, messages.
import { ITEMS } from './race.js';
import { minimapPath } from './track.js';

const $ = (id) => document.getElementById(id);

export function formatTime(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '--:--';
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

export const ordinal = (n) => (n === 1 ? '1er' : `${n}e`);

const fmt = (v, digits = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '--' : v.toFixed(digits));
const fmtGrade = (g) => `${g > 0.05 ? '+' : ''}${g.toFixed(1).replace('-0.0', '0.0')}`;

export class Hud {
  constructor(track) {
    this.root = $('hud');
    this.el = {};
    for (const id of ['hPower', 'hCadence', 'hHr', 'hSpeed', 'hGear', 'hGearBar', 'hGrade', 'hTerrain', 'hPos', 'hPosTotal', 'hLap', 'hTime', 'hItem', 'hItemLabel', 'hEffects', 'hHint', 'banner']) {
      this.el[id] = $(id);
    }
    this.lastText = 0;
    this.track = track;
    this.setupMinimap();
  }

  show(visible) {
    this.root.hidden = !visible;
  }

  setupMinimap() {
    const cv = $('minimap');
    this.mini = cv;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = 170;
    cv.width = size * dpr;
    cv.height = size * dpr;
    this.miniCtx = cv.getContext('2d');
    this.miniCtx.scale(dpr, dpr);
    this.miniSize = size;
    this.path = minimapPath(this.track);
  }

  drawMinimap(race) {
    const ctx = this.miniCtx;
    const S = this.miniSize;
    const pad = 14;
    const map = ([u, v]) => [pad + u * (S - pad * 2), pad + v * (S - pad * 2)];
    ctx.clearRect(0, 0, S, S);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.path.pts.forEach((p, i) => {
      const [x, y] = map(p);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = '#e9ecf2';
    ctx.lineWidth = 3.5;
    ctx.stroke();
    // Ligne de départ
    const t = this.track;
    const [sx, sy] = map(this.path.norm(t.x[0], t.z[0]));
    ctx.fillStyle = '#ff5a1f';
    ctx.fillRect(sx - 3, sy - 3, 6, 6);
    if (!race) return;
    const f = {};
    const draw = (r) => {
      t.frame(r.s, r.lateral, f);
      const [x, y] = map(this.path.norm(f.x, f.z));
      ctx.beginPath();
      ctx.arc(x, y, r.isPlayer ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = r.color;
      ctx.fill();
      ctx.lineWidth = r.isPlayer ? 2.5 : 1.5;
      ctx.strokeStyle = r.isPlayer ? '#fff' : 'rgba(0,0,0,0.6)';
      ctx.stroke();
    };
    race.racers.filter((r) => !r.isPlayer).forEach(draw);
    draw(race.player);
  }

  // Mise à jour des textes (au plus 10 fois par seconde) et de la mini-carte.
  update(d, race, now) {
    this.drawMinimap(race);
    if (now - this.lastText < 100) return;
    this.lastText = now;
    const e = this.el;
    e.hPower.textContent = fmt(d.power);
    e.hCadence.textContent = fmt(d.cadence);
    e.hHr.textContent = fmt(d.heartRate);
    e.hSpeed.textContent = fmt(d.speedKmh, 1);
    e.hGear.textContent = `${d.gear}`;
    e.hGearBar.style.width = `${(d.gear / d.gearCount) * 100}%`;
    e.hGrade.textContent = fmtGrade(d.feltGrade);
    e.hTerrain.textContent = `terrain ${fmtGrade(d.terrainGrade)} %`;
    e.hPos.textContent = ordinal(d.position);
    e.hPosTotal.textContent = `/ ${d.total}`;
    e.hLap.textContent = `Tour ${d.lap} / ${d.laps}`;
    e.hTime.textContent = formatTime(Math.max(0, d.time));
    if (d.item) {
      e.hItem.textContent = ITEMS[d.item].icon;
      e.hItemLabel.textContent = `${ITEMS[d.item].label} · Espace`;
      e.hItem.parentElement.classList.add('full');
    } else {
      e.hItem.textContent = '';
      e.hItemLabel.textContent = 'aucun objet';
      e.hItem.parentElement.classList.remove('full');
    }
    const badges = [];
    if (d.turboLeft > 0) badges.push(`<span class="badge turbo">🚀 Turbo ${d.turboLeft.toFixed(1)} s · pente −5 %</span>`);
    if (d.slipLeft > 0) badges.push(`<span class="badge slip">🍌 Glissade ${d.slipLeft.toFixed(1)} s · pente +10 %</span>`);
    if (d.draft < 0.98) badges.push(`<span class="badge draft">Aspiration −${Math.round((1 - d.draft) * 100)} %</span>`);
    if (d.offRoad) badges.push('<span class="badge grass">Dans l’herbe !</span>');
    const html = badges.join('');
    if (html !== this.lastBadges) {
      e.hEffects.innerHTML = html;
      this.lastBadges = html;
    }
    if (!d.keyboard) e.hHint.textContent = '';
    else if (d.touch) e.hHint.textContent = d.power < 5 && d.time > 0 ? 'Maintiens « Pédaler » pour avancer' : '';
    else e.hHint.textContent = d.power < 5 && d.time > 0 ? 'Maintiens ↑ pour pédaler' : 'Mode clavier : ↑ pédaler · ← → se déplacer';
  }

  flash(text, ms = 1500, cls = '') {
    const b = this.el.banner;
    b.textContent = text;
    b.className = `banner show ${cls}`;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => (b.className = 'banner'), ms);
  }

  countdown(text) {
    const b = this.el.banner;
    if (b.textContent !== text || !b.classList.contains('show')) {
      b.textContent = text;
      b.className = 'banner show big';
    }
  }
}
