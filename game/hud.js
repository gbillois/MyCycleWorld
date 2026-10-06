// Affichage tête haute : mesures, position, tour, chrono, objet (avec roulette), mini-carte, messages.
// Léger par construction : un texte n'est réécrit que s'il change, les animations passent par des classes
// CSS (transform / opacity) et le tracé de la mini-carte est dessiné une seule fois dans un cache.
import { ITEMS } from './race.js';
import { minimapPath } from './track.js';
import { formatSplit } from '../src/core/rowing.js';

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
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Zones de puissance (repères pour un FTP d'environ 200 W) : couleur du compteur de watts.
const ZONES = [110, 150, 180, 210, 240];
export const powerZone = (w) => (w === null || w === undefined || !Number.isFinite(w) || w < 1 ? 0 : 1 + ZONES.filter((z) => w >= z).length);

// Jauge de vitesse : arc de 270° sur un cercle de rayon 52.
const ARC_FULL = 2 * Math.PI * 52;
const ARC = ARC_FULL * 0.75;
const SPEED_MAX = 60;

// Position « 1er » : grand chiffre, suffixe en exposant.
export const ordinalHtml = (n) => `<b>${n}</b><sup>${n === 1 ? 'er' : 'e'}</sup>`;

// Écran d'arrivée : podium des trois premiers et tableau complet (vélo, rameur ou kayak).
// rows : [{ r: { name, color, isPlayer }, time, estimated }] déjà triés.
export function renderResults(rows, { kind = 'bike', distance = 0 } = {}) {
  const best = rows[0]?.time ?? 0;
  const order = [1, 0, 2].filter((i) => rows[i]);
  const podium = order
    .map((i) => {
      const x = rows[i];
      return `<div class="pd pd-${i + 1}${x.r.isPlayer ? ' me' : ''}" style="--c:${x.r.color}"><span class="pd-avatar">${esc(x.r.name.slice(0, 1))}</span><span class="pd-name">${esc(x.r.name)}</span><span class="pd-time">${x.estimated ? '≈ ' : ''}${formatTime(x.time)}</span><span class="pd-step"><b>${i + 1}</b></span></div>`;
    })
    .join('');
  const split = (t) => formatSplit((t / distance) * 500);
  const head = kind === 'row' ? '<tr><th>#</th><th>Rameur</th><th>Temps</th><th>Allure</th></tr>'
    : kind === 'kayak' ? '<tr><th>#</th><th>Kayakiste</th><th>Temps <small>pénalités comprises</small></th><th>Pénalités</th></tr>'
      : '<tr><th>#</th><th>Coureur</th><th>Temps</th><th>Écart</th></tr>';
  // Kayak : pénalités (portes manquées, porte sprint trop juste) et nombre de portes manquées.
  const pen = (r) => (r.penalty ? `+${r.penalty} s${r.missed ? ` <small>${r.missed} porte${r.missed > 1 ? 's' : ''}</small>` : ''}` : '<small>aucune</small>');
  const body = rows
    .map((x, i) => {
      const gap = i === 0 ? '' : `+${formatTime(x.time - best)}`;
      const last = kind === 'row' ? `${split(x.time)} <small>/500 m</small>` : kind === 'kayak' ? pen(x.r) : gap;
      const time = `${x.estimated ? '≈ ' : ''}${formatTime(x.time)}${(kind === 'row' || kind === 'kayak') && i ? ` <small>${gap}</small>` : ''}`;
      return `<tr class="${x.r.isPlayer ? 'me' : ''}${i < 3 ? ` top${i + 1}` : ''}"><td><span class="rk">${i + 1}</span></td><td><span class="dot" style="background:${x.r.color}"></span>${esc(x.r.name)}${x.r.isPlayer && x.r.name.toLowerCase() !== 'toi' ? ' <em class="you">toi</em>' : ''}</td><td>${time}</td><td>${last}</td></tr>`;
    })
    .join('');
  return { podium, table: head + body };
}

export class Hud {
  constructor(track) {
    this.root = $('hud');
    this.el = {};
    for (const id of ['hPower', 'hPowerBox', 'hZone', 'hCadence', 'hHr', 'hSpeed', 'hSpeedArc', 'hGear', 'hGearBar', 'hGrade', 'hGradeBox', 'hSlope', 'hTerrain', 'hPos', 'hPosTotal', 'hLap', 'hTime', 'hItem', 'hItemLabel', 'hEffects', 'hHint', 'banner', 'hWeather', 'hWxSky', 'hWxRainBox', 'hWxRain', 'hWxWind', 'hWxArrow', 'hWxText']) {
      this.el[id] = $(id);
    }
    this.cache = new Map(); // dernière valeur écrite par élément (évite de relire le DOM)
    this.lastText = 0;
    this.track = track;
    this.slot = this.el.hItem.parentElement;
    this.setupMinimap();
  }

  show(visible) {
    this.root.hidden = !visible;
  }

  // Écrit un texte (ou un attribut) seulement s'il a changé.
  set(key, value, apply) {
    if (this.cache.get(key) === value) return false;
    this.cache.set(key, value);
    if (apply) apply(value);
    else this.el[key].textContent = value;
    return true;
  }

  // Changement de circuit : nouvelle mini-carte.
  setTrack(track) {
    this.track = track;
    this.path = minimapPath(track);
    this.drawMapCache();
  }

  setupMinimap() {
    const cv = $('minimap');
    this.mini = cv;
    // Le HUD est agrandi sur les grands écrans (voir game.css) : on dessine assez fin pour rester net.
    const dpr = Math.min(3, (window.devicePixelRatio || 1) * (innerWidth >= 1600 && innerHeight >= 900 ? 1.7 : 1));
    const size = 170;
    cv.width = size * dpr;
    cv.height = size * dpr;
    this.miniCtx = cv.getContext('2d');
    this.miniCtx.scale(dpr, dpr);
    this.miniSize = size;
    this.dpr = dpr;
    this.path = minimapPath(this.track);
    this.drawMapCache();
  }

  mapPoint([u, v]) {
    const S = this.miniSize;
    const pad = 16;
    return [pad + u * (S - pad * 2), pad + v * (S - pad * 2)];
  }

  // Tracé statique (ombre, route, revêtements, ligne de départ) dessiné une fois dans un canevas caché.
  drawMapCache() {
    const S = this.miniSize;
    const c = document.createElement('canvas');
    c.width = S * this.dpr;
    c.height = S * this.dpr;
    const ctx = c.getContext('2d');
    ctx.scale(this.dpr, this.dpr);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const pts = this.path.pts.map((p) => this.mapPoint(p));
    const line = () => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };
    line();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,200,255,0.28)';
    ctx.lineWidth = 6.5;
    ctx.stroke();
    ctx.strokeStyle = '#eef3fb';
    ctx.lineWidth = 3.2;
    ctx.stroke();
    // Passerelle et sable en couleur, comme sur les cartes du menu.
    const t = this.track;
    const every = Math.max(1, Math.round(t.count / Math.max(1, this.path.pts.length - 1)));
    const colors = { sand: '#f2cf7a', boardwalk: '#c08a55' };
    for (let i = 1; i < pts.length; i++) {
      const col = colors[t.surf?.[Math.min(t.count, i * every)]];
      if (!col) continue;
      ctx.beginPath();
      ctx.moveTo(...pts[i - 1]);
      ctx.lineTo(...pts[i]);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3.4;
      ctx.stroke();
    }
    const [sx, sy] = this.mapPoint(this.path.norm(t.x[0], t.z[0]));
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx - 4, sy - 4, 8, 8);
    ctx.fillStyle = '#11151f';
    ctx.fillRect(sx - 4, sy - 4, 4, 4);
    ctx.fillRect(sx, sy, 4, 4);
    this.mapCache = c;
  }

  drawMinimap(race) {
    const ctx = this.miniCtx;
    const S = this.miniSize;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.mapCache, 0, 0, S, S);
    if (!race) return;
    const t = this.track;
    const f = (this.frameTmp ||= {});
    const draw = (r) => {
      t.frame(r.s, r.lateral, f);
      const [x, y] = this.mapPoint(this.path.norm(f.x, f.z));
      ctx.beginPath();
      if (r.isPlayer) {
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,90,31,0.28)';
        ctx.fill();
        ctx.beginPath();
      }
      ctx.arc(x, y, r.isPlayer ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = r.color;
      ctx.fill();
      ctx.lineWidth = r.isPlayer ? 2.5 : 1.5;
      ctx.strokeStyle = r.isPlayer ? '#fff' : 'rgba(0,0,0,0.6)';
      ctx.stroke();
    };
    for (const r of race.racers) if (!r.isPlayer) draw(r);
    draw(race.player);
  }

  // Position : animation verte si on gagne une place, rouge si on en perd.
  setPosition(pos) {
    const prev = this.cache.get('pos');
    if (prev === pos) return;
    this.cache.set('pos', pos);
    this.el.hPos.innerHTML = ordinalHtml(pos);
    if (prev === undefined) return;
    const box = this.el.hPos.closest('.hud-card');
    const flip = box.classList.contains('chg-a');
    box.classList.remove('chg-a', 'chg-b', 'up', 'down');
    box.classList.add(flip ? 'chg-b' : 'chg-a', pos < prev ? 'up' : 'down');
  }

  // Objet ramassé : la roulette tourne un instant avant de s'arrêter sur l'objet.
  setItem(item) {
    if (this.cache.get('item') === (item || '')) return;
    const had = this.cache.get('item');
    this.cache.set('item', item || '');
    const e = this.el;
    clearTimeout(this.rollTimer);
    this.slot.classList.remove('rolling', 'landed');
    if (item) {
      e.hItem.textContent = ITEMS[item].icon;
      e.hItemLabel.textContent = `${ITEMS[item].label} · Espace`;
      this.slot.classList.add('full');
      if (had !== undefined && !this.reduced()) {
        this.slot.classList.add('rolling');
        this.rollTimer = setTimeout(() => {
          this.slot.classList.remove('rolling');
          this.slot.classList.add('landed');
        }, 780);
      } else this.slot.classList.add('landed');
    } else {
      e.hItem.textContent = '';
      e.hItemLabel.textContent = 'aucun objet';
      this.slot.classList.remove('full');
    }
  }

  reduced() {
    return (this.motionQuery ||= matchMedia('(prefers-reduced-motion: reduce)')).matches;
  }

  // Mise à jour des textes (au plus 10 fois par seconde) et de la mini-carte.
  update(d, race, now) {
    this.drawMinimap(race);
    if (now - this.lastText < 100) return;
    this.lastText = now;
    const e = this.el;
    this.set('hPower', fmt(d.power));
    const zone = powerZone(d.power);
    this.set('zone', zone, (z) => {
      e.hPowerBox.dataset.zone = z;
      e.hZone.textContent = z ? `Z${z}` : '';
    });
    this.set('hCadence', fmt(d.cadence));
    this.set('hHr', fmt(d.heartRate));
    this.set('hSpeed', fmt(d.speedKmh, 1));
    const arc = Math.round(Math.min(1, Math.max(0, (d.speedKmh || 0) / SPEED_MAX)) * ARC);
    this.set('arc', arc, (a) => (e.hSpeedArc.style.strokeDasharray = `${a} ${ARC_FULL.toFixed(1)}`));
    this.set('hGear', `${d.gear}`);
    this.set('gearbar', d.gear / d.gearCount, (k) => (e.hGearBar.style.transform = `scaleX(${k.toFixed(3)})`));
    const g = fmtGrade(d.feltGrade);
    this.set('hGrade', g);
    const level = d.feltGrade <= -1.5 ? 'down' : d.feltGrade < 1.5 ? 'flat' : d.feltGrade < 6 ? 'up' : 'steep';
    this.set('gradeLevel', level, (l) => (e.hGradeBox.dataset.g = l));
    const tilt = Math.round(Math.max(-12, Math.min(12, d.feltGrade)));
    this.set('tilt', tilt, (k) => (e.hSlope.style.transform = `scale(${k < 0 ? -1 : 1}, ${(0.18 + Math.abs(k) / 14).toFixed(2)})`));
    // Avec la météo, la part du vent dans la pente ressentie est indiquée à côté du terrain.
    const wind = Math.abs(d.windGrade || 0) >= 0.15 ? ` · vent ${fmtGrade(d.windGrade)} %` : '';
    this.set('hTerrain', `terrain ${fmtGrade(d.terrainGrade)} %${wind}`);
    this.setWeather(d.weather);
    this.setPosition(d.position);
    this.set('hPosTotal', `/ ${d.total}`);
    this.set('hLap', `Tour ${d.lap} / ${d.laps}`);
    this.set('lastLap', d.lap === d.laps && d.laps > 1, (on) => e.hLap.parentElement.classList.toggle('final', on));
    this.set('hTime', formatTime(Math.max(0, d.time)));
    this.setItem(d.item);
    const badges = [];
    if (d.turboLeft > 0) badges.push(`<span class="badge turbo">🚀 Turbo ${d.turboLeft.toFixed(1)} s · pente −5 %</span>`);
    if (d.slipLeft > 0) badges.push(`<span class="badge slip">🍌 Glissade ${d.slipLeft.toFixed(1)} s · pente +10 %</span>`);
    if (d.draft < 0.98) badges.push(`<span class="badge draft">Aspiration −${Math.round((1 - d.draft) * 100)} %</span>`);
    if (d.autoSteer) badges.push('<span class="badge auto">🧭 Pilote auto</span>');
    if (d.gearAdvice === 'down') badges.push('<span class="badge grass">Trop dur : passe une vitesse plus petite (−)</span>');
    else if (d.gearAdvice === 'up') badges.push('<span class="badge draft">Tu mouilles : passe une vitesse plus grande (+)</span>');
    if (d.offRoad) badges.push('<span class="badge grass">Dans l’herbe !</span>');
    else if (d.surface === 'sand') badges.push('<span class="badge sand">Sable : pédalage plus dur</span>');
    else if (d.surface === 'boardwalk') badges.push('<span class="badge wood">Passerelle en bois</span>');
    this.set('hEffects', badges.join(''), (html) => (e.hEffects.innerHTML = html));
    let hint = '';
    if (!d.keyboard) hint = '';
    else if (d.touch) hint = d.power < 5 && d.time > 0 ? (d.tap ? 'Tape l’écran pour pédaler (ou maintiens « Pédaler »)' : 'Maintiens « Pédaler » pour avancer') : '';
    else hint = d.power < 5 && d.time > 0 ? (d.tap ? 'Maintiens ↑ ou clique en rythme pour pédaler' : 'Maintiens ↑ pour pédaler') : 'Mode clavier : ↑ pédaler · ← → se déplacer';
    this.set('hHint', hint);
  }

  // Badge météo : ciel, intensité de la pluie, vent de face ou de dos et sa flèche (repère du coureur).
  setWeather(w) {
    const e = this.el;
    if (!e.hWeather) return;
    const on = !!w?.on;
    this.set('wxOn', on, (v) => (e.hWeather.hidden = !v));
    if (!on) return;
    this.set('hWxSky', w.icon);
    const rain = w.rain > 0.02 ? Math.round(w.rain * 20) * 5 : 0;
    this.set('wxRain', rain, (r) => {
      e.hWxRainBox.hidden = !r;
      e.hWxRain.style.width = `${Math.max(10, r)}%`;
      e.hWxRainBox.title = `Pluie ${r} %`;
    });
    this.set('wxKind', w.kind, (k) => (e.hWxWind.dataset.k = k));
    this.set('hWxText', w.text);
    this.set('wxArrow', Math.round(w.arrow / 5) * 5, (a) => (e.hWxArrow.style.transform = `rotate(${a}deg)`));
  }

  // Message au centre de l'écran. « Partez ! » a droit à son propre effet.
  flash(text, ms = 1500, cls = '') {
    const b = this.el.banner;
    clearTimeout(this.countTimer);
    if (text === 'Partez !') cls = 'go big';
    b.textContent = text;
    delete b.dataset.n;
    const flip = b.classList.contains('pop-a') ? 'pop-b' : 'pop-a';
    b.className = text ? `banner show ${flip} ${cls}` : 'banner';
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => (b.className = 'banner'), ms);
  }

  // Décompte « 3, 2, 1 » : chaque chiffre arrive avec un effet de zoom. Il s'efface tout seul
  // si plus rien ne l'appelle (départ donné, pause, course quittée).
  countdown(text) {
    const b = this.el.banner;
    if (b.textContent !== text || !b.classList.contains('show')) {
      b.textContent = text;
      b.dataset.n = text; // couleur du chiffre : 3 rouge, 2 orange, 1 jaune
      const flip = b.classList.contains('pop-a') ? 'pop-b' : 'pop-a';
      b.className = `banner show big count ${flip}`;
    }
    clearTimeout(this.countTimer);
    this.countTimer = setTimeout(() => {
      if (b.classList.contains('count')) b.className = 'banner';
    }, 1200);
  }
}
