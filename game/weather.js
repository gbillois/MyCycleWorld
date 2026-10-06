// Météo en jeu : état de la course (vent, pluie, route mouillée, d'après src/core/weather.js), effets sur
// la physique (lus par race.js : tailwindAt, crrFactor, steer) et rendu.
//
// Rendu (graphismes détaillés) : ciel qui se couvre et nuages poussés par le vent, brume plus dense,
// lumière plus terne, route mouillée (uniform uWet du décor) qui sèche lentement, arbres et herbe qui
// s'agitent avec le vent (uWind), pluie autour de la caméra (une seule géométrie, traînées animées dans le
// shader), ronds de gouttes sur la route et dans les flaques, gerbes d'eau derrière les roues.
// Graphisme simple : pluie réduite, brume et ciel assombris. Trois appels de dessin au plus, et seulement
// quand il pleut ; aucune allocation par image ; tout est libéré au changement de circuit (detach).
import * as THREE from 'three';
import {
  rollWeather, weatherAt, stepWetness, wetCrrFactor, wetSteer, tailwind, crosswind, describeWind, skyIcon,
} from '../src/core/weather.js';
import { STEER } from '../src/core/steering.js';
import { mod, ROAD_HALF } from './track.js';
import { noiseTexture } from './atmosphere.js';

// Ciel couvert : teintes vers lesquelles glissent le dégradé du ciel et la brume.
const OVERCAST = {
  zenith: new THREE.Color('#56606c'),
  mid: new THREE.Color('#78818c'),
  horizon: new THREE.Color('#a2aab3'),
  fog: new THREE.Color('#959ea8'),
  sunColor: new THREE.Color('#c9cfd6'),
  simpleSky: new THREE.Color('#8f99a3'),
};

// Nombre de gouttes, de ronds et de gerbes selon la qualité (la pluie visible suit l'intensité).
const COUNTS = {
  high: { drops: 9000, box: [36, 22], splash: 360, spray: 22 },
  medium: { drops: 4400, box: [30, 18], splash: 220, spray: 16 },
  low: { drops: 2800, box: [26, 16], splash: 120, spray: 10 },
  simple: { drops: 1600, box: [26, 16], splash: 0, spray: 0 },
};
const SEG = 17; // échantillons de route pour les ronds de gouttes (tous les 4 m, de 8 m derrière à 56 m devant)
const SEG_STEP = 4;
const SEG_SPAN = (SEG - 1) * SEG_STEP;
const MAX_RIDERS = 8;

// Point de la route (comme Track.frame, sans allouer) : out = { x, y, z, tx, tz }.
function roadPoint(tr, s, lateral, out) {
  const f = mod(s, tr.length) / tr.step;
  const i = Math.min(tr.count - 1, Math.floor(f));
  const a = f - i;
  let tx = tr.tx[i] + (tr.tx[i + 1] - tr.tx[i]) * a;
  let tz = tr.tz[i] + (tr.tz[i + 1] - tr.tz[i]) * a;
  const l = Math.hypot(tx, tz) || 1;
  tx /= l;
  tz /= l;
  out.tx = tx;
  out.tz = tz;
  out.x = tr.x[i] + (tr.x[i + 1] - tr.x[i]) * a - tz * lateral;
  out.z = tr.z[i] + (tr.z[i + 1] - tr.z[i]) * a + tx * lateral;
  out.y = tr.y[i] + (tr.y[i + 1] - tr.y[i]) * a;
  return out;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// --- Pluie : quads étirés dans le sens de la chute apparente (vent + mouvement de la caméra) ---
function makeRain(count, [bw, bh]) {
  const pos = new Float32Array(count * 12);
  const seed = new Float32Array(count * 16);
  const idx = new Uint16Array(count * 6);
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const corners = [-1, 0, 1, 0, 1, 1, -1, 1];
  for (let i = 0; i < count; i++) {
    const a = [r(), r(), r(), r()];
    for (let k = 0; k < 4; k++) {
      pos[i * 12 + k * 3] = corners[k * 2];
      pos[i * 12 + k * 3 + 1] = corners[k * 2 + 1];
      seed.set(a, i * 16 + k * 4);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uBox: { value: new THREE.Vector3(bw, bh, bw) },
      uOffset: { value: new THREE.Vector3() },
      uAxis: { value: new THREE.Vector3(0, -1, 0) },
      uLen: { value: 0.6 },
      uWidth: { value: 0.012 },
      uAlpha: { value: 0 },
      uColor: { value: new THREE.Color(0.78, 0.82, 0.88) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform vec3 uBox, uOffset, uAxis;
      uniform float uLen, uWidth;
      varying float vA;
      varying vec2 vQ;
      void main() {
        // Gouttes fixes dans le monde, recyclées dans une boîte qui suit la caméra.
        vec3 c = cameraPosition - uBox * vec3( 0.5, 0.42, 0.5 );
        vec3 p = c + mod( aSeed.xyz * uBox + uOffset - c, uBox );
        vec3 toCam = normalize( cameraPosition - p );
        vec3 side = normalize( cross( uAxis, toCam ) );
        float len = uLen * ( 0.65 + 0.7 * aSeed.w );
        vec3 wp = p + side * position.x * uWidth * ( 0.8 + aSeed.w ) - uAxis * position.y * len;
        vec4 mv = viewMatrix * vec4( wp, 1.0 );
        float d = - mv.z;
        vA = smoothstep( 0.7, 2.2, d ) * ( 1.0 - smoothstep( uBox.x * 0.32, uBox.x * 0.5, d ) );
        vQ = position.xy;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying float vA;
      varying vec2 vQ;
      void main() {
        float a = ( 1.0 - abs( vQ.x ) ) * smoothstep( 0.0, 0.35, vQ.y ) * ( 1.0 - smoothstep( 0.75, 1.0, vQ.y ) );
        gl_FragColor = vec4( uColor, a * vA * uAlpha );
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide, // quads orientés vers la caméra dans le shader : sens des faces quelconque
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 950; // après le ciel (900) : les traînées passent devant
  mesh.userData.count = count;
  return mesh;
}

// --- Ronds de gouttes sur la route (plus grands et plus nets dans les flaques) ---
function makeSplashes(count, wetUniform) {
  const pos = new Float32Array(count * 12);
  const seed = new Float32Array(count * 16);
  const idx = new Uint16Array(count * 6);
  let s = 11;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
  for (let i = 0; i < count; i++) {
    const a = [r(), r(), r(), r()];
    for (let k = 0; k < 4; k++) {
      pos[i * 12 + k * 3] = corners[k * 2];
      pos[i * 12 + k * 3 + 1] = corners[k * 2 + 1];
      seed.set(a, i * 16 + k * 4);
    }
    idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2], i * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uRoadP: { value: Array.from({ length: SEG }, () => new THREE.Vector3()) },
      uRoadR: { value: Array.from({ length: SEG }, () => new THREE.Vector2(1, 0)) },
      uBaseMod: { value: 0 },
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uWet: wetUniform || { value: 1 },
      uNoise: { value: noiseTexture() },
    },
    vertexShader: /* glsl */ `
      #define SEG ${SEG}
      uniform vec3 uRoadP[ SEG ];
      uniform vec2 uRoadR[ SEG ];
      uniform float uBaseMod, uTime, uWet;
      uniform sampler2D uNoise;
      attribute vec4 aSeed;
      varying vec2 vQ;
      varying float vT, vA;
      float hash( float n ) { return fract( sin( n ) * 43758.5453 ); }
      void main() {
        // Chaque rond vit une fraction de seconde puis renaît ailleurs (position tirée par cycle),
        // à une distance fixe le long de la route : il ne glisse pas quand on avance.
        float life = 0.38 + aSeed.w * 0.22;
        float cyc = uTime / life + aSeed.z * 7.0;
        float k = floor( cyc );
        float t = fract( cyc );
        float h1 = hash( k * 12.9898 + aSeed.x * 78.233 );
        float h2 = hash( k * 39.3468 + aSeed.y * 11.135 );
        float sRel = mod( h1 * ${SEG_SPAN.toFixed(1)} - uBaseMod, ${SEG_SPAN.toFixed(1)} );
        float fi = sRel / ${SEG_STEP.toFixed(1)};
        int i = min( int( floor( fi ) ), SEG - 2 );
        float a = fi - float( i );
        vec3 P = mix( uRoadP[ i ], uRoadP[ i + 1 ], a );
        vec2 R = mix( uRoadR[ i ], uRoadR[ i + 1 ], a );
        vec3 c = P + vec3( R.x, 0.0, R.y ) * ( h2 * 2.0 - 1.0 ) * ${(ROAD_HALF - 0.25).toFixed(2)};
        // Même masque de flaques que la matière de la route (scenery.js, roadMaterial).
        float pz = texture2D( uNoise, c.xz * 0.016 + 0.3 ).g + ( texture2D( uNoise, c.xz * 0.11 ).a - 0.5 ) * 0.12;
        float thr = mix( 0.875, 0.74, uWet );
        float puddle = smoothstep( thr, thr + 0.035, pz );
        float size = ( 0.03 + 0.13 * t ) * ( 0.7 + aSeed.w * 0.6 ) * ( 1.0 + puddle * 0.7 );
        vec3 wp = c + vec3( position.x, 0.0, position.y ) * size;
        wp.y += 0.065;
        vec4 mv = viewMatrix * vec4( wp, 1.0 );
        vQ = position.xy;
        vT = t;
        vA = ( 0.22 + 0.78 * puddle ) * ( 1.0 - t ) * ( 1.0 - smoothstep( 22.0, 38.0, - mv.z ) );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      varying vec2 vQ;
      varying float vT, vA;
      void main() {
        float r = length( vQ );
        float ring = smoothstep( 0.55, 0.78, r ) * ( 1.0 - smoothstep( 0.82, 1.0, r ) );
        float drop = ( 1.0 - smoothstep( 0.0, 0.3, r ) ) * ( 1.0 - smoothstep( 0.0, 0.25, vT ) );
        float a = ( ring * 0.75 + drop ) * vA * uAlpha;
        if ( a < 0.004 ) discard;
        gl_FragColor = vec4( 0.86, 0.9, 0.95, a );
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide, // quads orientés vers la caméra dans le shader : sens des faces quelconque
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.count = count;
  return mesh;
}

// --- Gerbes d'eau soulevées par la roue arrière des coureurs (points calculés dans le shader) ---
function makeSpray(perRider) {
  const n = MAX_RIDERS * perRider;
  const seed = new Float32Array(n * 4);
  let s = 5;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let j = 0; j < MAX_RIDERS; j++) {
    for (let k = 0; k < perRider; k++) seed.set([j, r(), r(), r()], (j * perRider + k) * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uRider: { value: Array.from({ length: MAX_RIDERS }, () => new THREE.Vector4()) },
      uDir: { value: Array.from({ length: MAX_RIDERS }, () => new THREE.Vector2(0, 1)) },
      uTime: { value: 0 },
      uScale: { value: 500 },
    },
    vertexShader: /* glsl */ `
      #define RIDERS ${MAX_RIDERS}
      uniform vec4 uRider[ RIDERS ];
      uniform vec2 uDir[ RIDERS ];
      uniform float uTime, uScale;
      attribute vec4 aSeed;
      varying float vA;
      void main() {
        int j = int( aSeed.x + 0.5 );
        vec4 R = uRider[ j ];
        vec2 D = uDir[ j ];
        float t = fract( uTime * 2.3 + aSeed.y );
        vec3 fwd = vec3( D.x, 0.0, D.y );
        vec3 side = vec3( - D.y, 0.0, D.x );
        vec3 start = R.xyz - fwd * 0.62 + vec3( 0.0, 0.3, 0.0 );
        vec3 vel = - fwd * ( 1.0 + aSeed.z * 1.8 ) + vec3( 0.0, 1.3 + aSeed.w * 1.3, 0.0 ) + side * ( aSeed.z - 0.5 ) * 1.1;
        float tt = t * 0.5;
        vec3 p = start + vel * tt;
        p.y = max( p.y - 4.9 * tt * tt, R.y + 0.03 );
        vec4 mv = viewMatrix * vec4( p, 1.0 );
        vA = ( 1.0 - t ) * R.w;
        gl_PointSize = R.w > 0.0 ? ( 0.07 + 0.24 * t ) * uScale / max( 0.5, - mv.z ) : 0.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float a = ( 1.0 - smoothstep( 0.15, 0.5, length( gl_PointCoord - 0.5 ) ) ) * vA * 0.3;
        if ( a < 0.004 ) discard;
        gl_FragColor = vec4( 0.84, 0.88, 0.92, a );
      }`,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

export class WeatherSystem {
  // onEvent(type, detail) : 'rain-start', 'rain-stop', 'windy' (bannières du HUD).
  constructor({ scene, renderer = null, detailed = true, quality = 'high', onEvent = null } = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.detailed = detailed;
    this.counts = detailed ? COUNTS[quality] || COUNTS.medium : COUNTS.simple;
    this.onEvent = onEvent;
    this.plan = null;
    this.active = false;
    this.now = weatherAt(null, 0, {});
    this.wet = 0;
    this.cloudVis = 0;
    this.windVis = 1;
    this.crrFactor = 1;
    this.steer = undefined; // réglages de direction sur route mouillée (undefined = réglages d'origine)
    this.steerCfg = { ...STEER };
    this.track = null;
    this.scenery = null;
    this.base = null;
    this.fx = null;
    this.raining = false;
    this.windyShown = false;
    this.lastSeg = NaN;
    this.time = 0;
    this.camPrev = new THREE.Vector3();
    this.camVel = new THREE.Vector3();
    this.tmpV = new THREE.Vector3();
    this.size = new THREE.Vector2();
    this.frameTmp = {};
    // Lus par le HUD et le son (objets réutilisés).
    this.hud = { on: false, icon: '☀️', rain: 0, wet: 0, kind: 'calm', text: '', kmh: 0, arrow: 0, tail: 0 };
    this.audio = { on: false, rain: 0, wet: 0, wind: 0, head: 0, tail: 0, gust: 1, theme: 'meadow' };
  }

  // Décor courant (après sa construction) : on mémorise son ambiance d'origine pour y revenir.
  attach(scenery, track) {
    this.detach();
    this.scenery = scenery;
    this.track = track;
    const sc = this.scene;
    const sky = scenery?.sky?.userData?.uniforms || null;
    const lights = [];
    for (const o of sc.children) if (o.isHemisphereLight || o.isDirectionalLight) lights.push([o, o.intensity]);
    this.base = {
      fog: sc.fog ? { color: sc.fog.color.clone(), near: sc.fog.near, far: sc.fog.far } : null,
      background: sc.background?.isColor ? sc.background.clone() : null,
      lights,
      env: sc.environmentIntensity,
      sky: sky ? { zenith: sky.uZenith.value.clone(), mid: sky.uMid.value.clone(), horizon: sky.uHorizon.value.clone(), sun: sky.uSunColor.value.clone(), cover: sky.uCover.value, cirrus: sky.uCirrus.value } : null,
      simpleSky: !sky && scenery?.sky?.material?.color ? scenery.sky.material.color.clone() : null,
    };
    this.lastSeg = NaN;
    if (this.active) this.applyLook();
  }

  // Avant de libérer le décor : ambiance d'origine rétablie, particules libérées.
  detach() {
    if (this.scenery) this.restore();
    this.disposeFx();
    this.scenery = null;
    this.track = null;
    this.base = null;
  }

  // Nouvelle course : tirage de la météo (null en mode « Désactivée » : rien ne change).
  start(theme, mode, seed) {
    this.plan = rollWeather({ theme, mode, seed });
    this.active = !!this.plan;
    this.raining = false;
    this.rainShown = false;
    this.windyShown = false;
    this.time = 0;
    this.audio.theme = theme;
    if (!this.active) {
      this.stop();
      return null;
    }
    // Il pleuvait déjà avant le départ : route mouillée et ciel couvert d'emblée.
    weatherAt(this.plan, -3, this.now);
    this.wet = Math.min(1, this.now.rain * 1.25);
    this.cloudVis = this.now.cloud;
    this.raining = this.now.rain > 0.15;
    this.windVis = this.windScale();
    this.crrFactor = wetCrrFactor(this.wet);
    this.steer = wetSteer(this.wet, STEER, this.steerCfg);
    return this.plan;
  }

  // Accueil, autre mode, météo désactivée : retour au temps neutre.
  stop() {
    this.plan = null;
    this.active = false;
    weatherAt(null, 0, this.now);
    this.wet = 0;
    this.crrFactor = 1;
    this.steer = undefined;
    this.hud.on = false;
    this.audio.on = false;
    if (this.scenery) this.restore();
    if (this.fx) for (const k of ['rain', 'splash', 'spray']) if (this.fx[k]) this.fx[k].visible = false;
  }

  windScale() {
    return Math.min(2.6, Math.max(0.5, 0.55 + this.now.speed * 0.2));
  }

  // État de la météo à l'instant t de la course (avant la physique). running : la route mouille / sèche.
  step(dt, t, running) {
    if (!this.active) return;
    weatherAt(this.plan, t, this.now);
    if (running) this.wet = stepWetness(this.wet, this.now.rain, dt);
    this.crrFactor = wetCrrFactor(this.wet);
    this.steer = wetSteer(this.wet, STEER, this.steerCfg);
    // Bannières : début et fin d'averse (avec hystérésis), vent fort annoncé peu après le départ.
    if (running && t > 0) {
      if (this.raining && !this.rainShown && t > 1.5) {
        // Il pleuvait déjà au départ : annoncé juste après « Partez ! ».
        this.rainShown = true;
        this.onEvent?.('rain-start');
      } else if (!this.raining && this.now.rain > 0.15) {
        this.rainShown = true;
        this.raining = true;
        this.onEvent?.('rain-start');
      } else if (this.raining && this.now.rain < 0.04) {
        this.raining = false;
        this.onEvent?.('rain-stop');
      }
      if (!this.windyShown && t > 4.5) {
        this.windyShown = true;
        if (this.plan.speed >= 5) this.onEvent?.('windy', { kmh: Math.round(this.plan.speed * 3.6) });
      }
    }
  }

  // Vent le long de la route au point s (m/s, > 0 de dos). Utilisé par race.js pour chaque coureur.
  tailwindAt(s) {
    const tr = this.track;
    if (!this.active || !tr) return 0;
    const i = Math.min(tr.count - 1, Math.floor(mod(s, tr.length) / tr.step));
    return tailwind(this.now.speed, this.now.dirX, this.now.dirZ, tr.tx[i], tr.tz[i]);
  }

  // Informations du coureur (HUD, son) : vent de face ou de dos à sa position, flèche du vent.
  // (tx, tz) : direction de la course si elle n'est pas donnée par le circuit (bassin d'aviron).
  observe(player, tx, tz) {
    const h = this.hud;
    const a = this.audio;
    h.on = this.active;
    a.on = this.active;
    if (!this.active) return;
    const tr = this.track;
    if (tx === undefined) {
      if (!tr) return;
      const i = Math.min(tr.count - 1, Math.floor(mod(player.s, tr.length) / tr.step));
      tx = tr.tx[i];
      tz = tr.tz[i];
    }
    const n = this.now;
    const tail = tailwind(n.speed, n.dirX, n.dirZ, tx, tz);
    const cross = crosswind(n.speed, n.dirX, n.dirZ, tx, tz);
    const w = describeWind(tail, n.speed);
    h.icon = skyIcon(n.rain, this.cloudVis);
    h.rain = n.rain;
    h.wet = this.wet;
    h.kind = w.kind;
    h.text = w.text;
    h.kmh = w.kmh;
    h.tail = tail;
    // Flèche : 0° = le vent pousse vers l'avant (de dos), 180° = de face ; sens horaire = vers la droite.
    h.arrow = Math.round((Math.atan2(cross, tail) * 180) / Math.PI);
    a.rain = n.rain;
    a.wet = this.wet;
    a.wind = n.speed;
    a.tail = tail;
    a.head = Math.max(0, -tail);
    a.gust = n.gust;
  }

  // --- Rendu ---
  render(dt, camera, race) {
    if (!this.active || !this.scenery) return;
    const n = this.now;
    this.time += dt;
    this.cloudVis += (n.cloud - this.cloudVis) * (1 - Math.exp(-dt / 2.5));
    this.windVis += (this.windScale() - this.windVis) * (1 - Math.exp(-dt / 1.5));
    this.applyLook(dt);
    // Vitesse de la caméra (traînées de pluie inclinées par le mouvement), lissée.
    if (dt > 0) {
      this.tmpV.copy(camera.position).sub(this.camPrev).divideScalar(dt);
      if (this.tmpV.lengthSq() < 900) this.camVel.lerp(this.tmpV, 1 - Math.exp(-dt / 0.2));
    }
    this.camPrev.copy(camera.position);
    const wantFx = n.rain > 0.005 || (this.wet > 0.12 && this.counts.spray > 0);
    if (wantFx && !this.fx) this.buildFx();
    if (this.fx) this.updateFx(dt, camera, race);
  }

  // Ciel, brume, lumières, route mouillée et vent dans les arbres.
  applyLook(dt = 0) {
    const b = this.base;
    if (!b) return;
    const sc = this.scene;
    const k = this.cloudVis;
    const rain = this.now.rain;
    const sky = this.scenery.sky?.userData?.uniforms;
    if (sky && b.sky) {
      sky.uZenith.value.copy(b.sky.zenith).lerp(OVERCAST.zenith, k * 0.9);
      sky.uMid.value.copy(b.sky.mid).lerp(OVERCAST.mid, k * 0.9);
      sky.uHorizon.value.copy(b.sky.horizon).lerp(OVERCAST.horizon, k * 0.85);
      sky.uSunColor.value.copy(b.sky.sun).lerp(OVERCAST.sunColor, k);
      sky.uCover.value = b.sky.cover + (0.97 - b.sky.cover) * k;
      sky.uCirrus.value = b.sky.cirrus * (1 - k);
      sky.uShade.value = k * 0.92;
      // Les nuages filent dans le sens du vent (la texture glisse en sens inverse).
      const off = sky.uCloudOff.value;
      off.x = (off.x - this.now.dirX * this.now.speed * dt * 0.00045) % 1;
      off.y = (off.y - this.now.dirZ * this.now.speed * dt * 0.00045) % 1;
    }
    if (b.simpleSky) this.scenery.sky.material.color.copy(b.simpleSky).lerp(OVERCAST.simpleSky, k);
    if (sc.fog && b.fog) {
      sc.fog.color.copy(b.fog.color).lerp(OVERCAST.fog, k * 0.85);
      const thick = Math.max(k * 0.3, rain);
      sc.fog.near = b.fog.near * (1 - 0.8 * thick);
      sc.fog.far = b.fog.far * (1 - 0.7 * thick);
    }
    if (b.background && sc.background?.isColor) sc.background.copy(b.background).lerp(OVERCAST.fog, k * 0.85);
    for (const [light, intensity] of b.lights) light.intensity = intensity * (light.isDirectionalLight ? 1 - 0.72 * k : 1 - 0.3 * k);
    if (b.env !== undefined) sc.environmentIntensity = b.env * (1 - 0.45 * k);
    if (this.scenery.wet) this.scenery.wet.value = this.wet;
    if (this.scenery.wind) this.scenery.wind.value = this.windVis;
  }

  // Ambiance d'origine exactement (valeurs mémorisées à l'attache).
  restore() {
    const b = this.base;
    if (!b) return;
    const sc = this.scene;
    const sky = this.scenery?.sky?.userData?.uniforms;
    if (sky && b.sky) {
      sky.uZenith.value.copy(b.sky.zenith);
      sky.uMid.value.copy(b.sky.mid);
      sky.uHorizon.value.copy(b.sky.horizon);
      sky.uSunColor.value.copy(b.sky.sun);
      sky.uCover.value = b.sky.cover;
      sky.uCirrus.value = b.sky.cirrus;
      sky.uShade.value = 0;
      sky.uCloudOff.value.set(0, 0);
    }
    if (b.simpleSky) this.scenery.sky.material.color.copy(b.simpleSky);
    if (sc.fog && b.fog) {
      sc.fog.color.copy(b.fog.color);
      sc.fog.near = b.fog.near;
      sc.fog.far = b.fog.far;
    }
    if (b.background && sc.background?.isColor) sc.background.copy(b.background);
    for (const [light, intensity] of b.lights) light.intensity = intensity;
    if (b.env !== undefined) sc.environmentIntensity = b.env;
    if (this.scenery?.wet) this.scenery.wet.value = 0;
    if (this.scenery?.wind) this.scenery.wind.value = 1;
    this.cloudVis = 0;
    this.windVis = 1;
  }

  buildFx() {
    const c = this.counts;
    const fx = { rain: makeRain(c.drops, c.box), splash: null, spray: null };
    this.scene.add(fx.rain);
    if (c.splash) {
      fx.splash = makeSplashes(c.splash, this.scenery?.wet);
      this.scene.add(fx.splash);
    }
    if (c.spray) {
      fx.spray = makeSpray(c.spray);
      this.scene.add(fx.spray);
    }
    this.fx = fx;
    this.lastSeg = NaN;
  }

  disposeFx() {
    if (!this.fx) return;
    for (const m of [this.fx.rain, this.fx.splash, this.fx.spray]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.fx = null;
  }

  updateFx(dt, camera, race) {
    const fx = this.fx;
    const n = this.now;
    const rain = n.rain;
    // Pluie : la quantité de gouttes dessinées suit l'intensité (drawRange : rien à calculer pour les autres).
    const drops = Math.ceil(fx.rain.userData.count * Math.min(1, rain * 1.1));
    fx.rain.visible = drops > 0;
    fx.rain.geometry.setDrawRange(0, drops * 6);
    if (drops > 0) {
      const u = fx.rain.material.uniforms;
      const fall = 8.5 + rain * 1.5;
      const wx = n.dirX * n.speed * 0.85;
      const wz = n.dirZ * n.speed * 0.85;
      const box = u.uBox.value;
      const o = u.uOffset.value;
      o.set(mod(o.x + wx * dt, box.x), mod(o.y - fall * dt, box.y), mod(o.z + wz * dt, box.z));
      // Traînée : mouvement apparent de la goutte (chute + vent − caméra) pendant ~1/45 s.
      const ax = u.uAxis.value.set(wx - this.camVel.x, -fall - this.camVel.y, wz - this.camVel.z);
      const speed = ax.length();
      ax.divideScalar(speed || 1);
      u.uLen.value = Math.min(1.6, Math.max(0.45, speed / 20));
      u.uAlpha.value = (this.detailed ? 0.32 : 0.4) * (0.55 + 0.45 * Math.min(1, rain * 1.5));
      u.uWidth.value = this.detailed ? 0.011 : 0.016;
    }
    // Ronds de gouttes sur la route autour du joueur.
    if (fx.splash) {
      const count = Math.ceil(fx.splash.userData.count * Math.min(1, rain * 1.2));
      fx.splash.visible = count > 0 && !!race && !!this.track;
      fx.splash.geometry.setDrawRange(0, count * 6);
      if (fx.splash.visible) {
        const u = fx.splash.material.uniforms;
        u.uTime.value = this.time;
        u.uAlpha.value = 0.55 + 0.45 * rain;
        this.updateRoadSamples(u, race.player.s);
      }
    }
    // Gerbes derrière les roues (route mouillée, coureurs rapides et proches).
    if (fx.spray) {
      const u = fx.spray.material.uniforms;
      u.uTime.value = this.time;
      let any = false;
      const tr = this.track;
      const f = this.frameTmp;
      const racers = race?.racers || [];
      for (let j = 0; j < MAX_RIDERS; j++) {
        const R = u.uRider.value[j];
        const r = racers[j];
        if (!r || !tr || this.wet < 0.12) {
          R.w = 0;
          continue;
        }
        roadPoint(tr, r.s, r.lateral, f);
        const dist = Math.hypot(f.x - camera.position.x, f.z - camera.position.z);
        const k = Math.min(1, (this.wet - 0.12) * 1.6) * smooth(2, 9, r.v) * (1 - smooth(25, 40, dist));
        R.set(f.x, f.y + 0.03, f.z, k);
        const c = Math.cos(r.heading || 0);
        const s = Math.sin(r.heading || 0);
        // Direction du vélo : tangente de la route tournée de son cap.
        u.uDir.value[j].set(f.tx * c - f.tz * s, f.tz * c + f.tx * s); // droite de la route = (−tz, tx)
        if (k > 0) any = true;
      }
      fx.spray.visible = any;
      if (any && this.renderer) {
        this.renderer.getDrawingBufferSize(this.size);
        u.uScale.value = this.size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      }
    }
  }

  // Échantillons de route (tous les 4 m) autour du joueur, recalculés seulement quand on change de tronçon.
  updateRoadSamples(u, s) {
    const tr = this.track;
    const seg = Math.floor(s / SEG_STEP);
    if (seg === this.lastSeg) return;
    this.lastSeg = seg;
    const s0 = seg * SEG_STEP - 8;
    u.uBaseMod.value = mod(s0, SEG_SPAN);
    const f = this.frameTmp;
    for (let j = 0; j < SEG; j++) {
      roadPoint(tr, s0 + j * SEG_STEP, 0, f);
      u.uRoadP.value[j].set(f.x, f.y + 0.04, f.z);
      u.uRoadR.value[j].set(-f.tz, f.tx); // vecteur « droite » de la route (voir Track.frame)
    }
  }
}
