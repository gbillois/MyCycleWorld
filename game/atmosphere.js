// Atmosphère des graphismes détaillés : ambiances par thème (ciel, brume, soleil), dôme de ciel avec
// diffusion, halo du soleil, cumulus et cirrus calculés dans le shader, brume de distance et de hauteur
// (perspective aérienne) qui remplace la brume linéaire de three.js, textures de bruit partagées.
import * as THREE from 'three';

// Soleil assez bas (environ 26°) : ombres longues, lumière rasante, reflets de lentille possibles.
export const SUN_DIR = new THREE.Vector3(-0.5, 0.39, 0.62).normalize();

// --- Ambiances (une par thème) ---
// zenith / mid / horizon : dégradé du ciel ; la brume prend la couleur de l'horizon pour s'y fondre.
export const MOODS = {
  meadow: {
    zenith: '#1a56c4', mid: '#5594e2', horizon: '#c6dcf2', sun: '#fff1db', sunI: 3.3,
    hemiSky: '#b9d6ff', hemiGround: '#5a6e3a', hemiI: 0.9, env: 0.55,
    fog: [240, 2600], clouds: 0.44, cirrus: 0.55, exposure: 1.0,
  },
  alpine: {
    zenith: '#164fc0', mid: '#4f8fe4', horizon: '#cfe2f6', sun: '#fff7ec', sunI: 3.25,
    hemiSky: '#c3dbff', hemiGround: '#5a6650', hemiI: 0.85, env: 0.6,
    fog: [320, 3400], clouds: 0.4, cirrus: 0.7, exposure: 1.0,
  },
  coast: {
    zenith: '#2368cc', mid: '#6aa8e8', horizon: '#dbe6ec', sun: '#ffe6c2', sunI: 3.3,
    hemiSky: '#cfe2ff', hemiGround: '#9f9470', hemiI: 0.95, env: 0.6,
    fog: [280, 2700], clouds: 0.32, cirrus: 0.45, exposure: 1.02,
  },
  lake: {
    zenith: '#1c5cc6', mid: '#5f9de6', horizon: '#cfe2f4', sun: '#fff0d8', sunI: 3.2,
    hemiSky: '#bcd8ff', hemiGround: '#55693a', hemiI: 0.9, env: 0.6,
    fog: [320, 3200], clouds: 0.42, cirrus: 0.5, exposure: 1.0,
  },
  // Grande Balade (balade.js) : une lumière par région.
  collines: {
    zenith: '#2a62c4', mid: '#6ea2e0', horizon: '#e6dcc4', sun: '#ffe2b0', sunI: 3.3,
    hemiSky: '#c9dcff', hemiGround: '#6a7a3a', hemiI: 0.95, env: 0.55,
    fog: [260, 2600], clouds: 0.4, cirrus: 0.5, exposure: 1.02,
  },
  landes: {
    zenith: '#2a5fae', mid: '#6d97cc', horizon: '#cfd6dc', sun: '#fff0d8', sunI: 3.0,
    hemiSky: '#bccbe0', hemiGround: '#5d6247', hemiI: 0.9, env: 0.55,
    fog: [240, 2400], clouds: 0.58, cirrus: 0.4, exposure: 1.0,
  },
  neiges: {
    zenith: '#1d4fae', mid: '#5a8bd6', horizon: '#d6e2ee', sun: '#fff6ea', sunI: 3.1,
    hemiSky: '#c6d8f2', hemiGround: '#55604c', hemiI: 0.88, env: 0.6,
    fog: [300, 3400], clouds: 0.5, cirrus: 0.65, exposure: 1.0,
  },
  foretdor: {
    zenith: '#2c5cb8', mid: '#7aa2d8', horizon: '#f0e2b8', sun: '#ffe7a8', sunI: 3.2,
    hemiSky: '#e8e0c0', hemiGround: '#7a7432', hemiI: 1.0, env: 0.6,
    fog: [200, 2200], clouds: 0.3, cirrus: 0.6, exposure: 1.04,
  },
  plaines: {
    zenith: '#2463c8', mid: '#6ea4e6', horizon: '#ece0c2', sun: '#ffe9c0', sunI: 3.4,
    hemiSky: '#cfe0ff', hemiGround: '#8a7a42', hemiI: 0.95, env: 0.55,
    fog: [320, 3600], clouds: 0.36, cirrus: 0.55, exposure: 1.0,
  },
  vertbois: {
    zenith: '#225cc0', mid: '#6299dc', horizon: '#d9e2d6', sun: '#fff0d0', sunI: 3.2,
    hemiSky: '#c4dafa', hemiGround: '#4f6a34', hemiI: 0.92, env: 0.55,
    fog: [240, 2600], clouds: 0.46, cirrus: 0.5, exposure: 1.0,
  },
  feu: {
    zenith: '#2a1c1e', mid: '#5e3326', horizon: '#b8653c', sun: '#ffb27a', sunI: 2.3,
    hemiSky: '#a06a54', hemiGround: '#2e2422', hemiI: 0.75, env: 0.35,
    fog: [180, 3000], clouds: 0.78, cirrus: 0.15, exposure: 1.05,
  },
};

// Applique l'ambiance aux lumières de la scène (créées par main.js) et à la brume.
export function applyMood(scene, mood) {
  for (const o of scene.children) {
    if (o.isHemisphereLight) {
      o.color.set(mood.hemiSky);
      o.groundColor.set(mood.hemiGround);
      o.intensity = mood.hemiI;
    } else if (o.isDirectionalLight) {
      o.color.set(mood.sun);
      o.intensity = mood.sunI;
    }
  }
  scene.fog = new THREE.Fog(new THREE.Color(mood.horizon), mood.fog[0], mood.fog[1]);
}

// --- Brume « perspective aérienne » (remplace les morceaux de shader de three.js) ---
// Distance exponentielle à partir de fogNear, moins dense en altitude, teintée de soleil vers le soleil.
// Installée une seule fois, seulement en graphismes détaillés (le mode simple garde la brume d'origine).
let fogInstalled = false;
export function installFog() {
  if (fogInstalled) return;
  fogInstalled = true;
  const s = SUN_DIR;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogWorld;\n#endif';
  C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogWorld = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;\n#endif';
  C.fog_pars_fragment = '#ifdef USE_FOG\n\tuniform vec3 fogColor;\n\tvarying float vFogDepth;\n\tvarying vec3 vFogWorld;\n\t#ifdef FOG_EXP2\n\t\tuniform float fogDensity;\n\t#else\n\t\tuniform float fogNear;\n\t\tuniform float fogFar;\n\t#endif\n#endif';
  C.fog_fragment = /* glsl */ `#ifdef USE_FOG
	float fogDist = length( vFogWorld );
	vec3 fogDir = vFogWorld / max( fogDist, 0.001 );
	#ifdef FOG_EXP2
		float fogAmount = 1.0 - exp( - fogDensity * fogDensity * fogDist * fogDist );
	#else
		float fogAmount = 1.0 - exp( - max( fogDist - fogNear, 0.0 ) * 2.3 / ( fogFar - fogNear ) );
	#endif
	// Air plus clair au-dessus de la caméra, brume de vallée en dessous.
	fogAmount *= exp( - clamp( vFogWorld.y, -25.0, 600.0 ) * 0.0014 );
	fogAmount = clamp( fogAmount, 0.0, 1.0 );
	float fogSun = pow( max( dot( fogDir, vec3( ${s.x.toFixed(4)}, ${s.y.toFixed(4)}, ${s.z.toFixed(4)} ) ), 0.0 ), 6.0 );
	vec3 fogTint = fogColor * mix( vec3( 0.86, 0.92, 1.04 ), vec3( 1.12, 1.03, 0.9 ), fogSun );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogAmount );
#endif`;
}

// --- Textures de bruit (raccord parfait en mosaïque), générées une fois puis réutilisées ---

function makeHash(seed) {
  return (ix, iz) => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
// Bruit de valeur périodique (période p cellules).
function periodicNoise(hash, x, z, p) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const m = (a) => ((a % p) + p) % p;
  const a = hash(m(ix), m(iz));
  const b = hash(m(ix + 1), m(iz));
  const c = hash(m(ix), m(iz + 1));
  const d = hash(m(ix + 1), m(iz + 1));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function periodicFbm(hash, x, z, p, octaves, gain = 0.5) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(hash, x, z, p);
    norm += amp;
    x *= 2;
    z *= 2;
    p *= 2;
    amp *= gain;
  }
  return sum / norm;
}
export { makeHash };

const cache = {};
// R : fBm large (nuages), G : fBm moyen (ombres des nuages, flaques), B : bruit « ondulant » (cirrus),
// A : bruit fin. Texture RGBA 256², filtrée, en mosaïque.
export function noiseTexture() {
  if (cache.noise) return cache.noise;
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const h1 = makeHash(1);
  const h2 = makeHash(2);
  const h3 = makeHash(3);
  const h4 = makeHash(4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const r = periodicFbm(h1, (x / N) * 6, (y / N) * 6, 6, 5, 0.55);
      const g = periodicFbm(h2, (x / N) * 8, (y / N) * 8, 8, 4);
      const b = 1 - Math.abs(periodicFbm(h3, (x / N) * 5, (y / N) * 5, 5, 4) * 2 - 1);
      const a = periodicFbm(h4, (x / N) * 32, (y / N) * 32, 32, 2);
      data[i] = Math.min(255, Math.max(0, (r - 0.5) * 1.9 * 255 + 128));
      data[i + 1] = Math.min(255, Math.max(0, (g - 0.5) * 1.9 * 255 + 128));
      data[i + 2] = Math.round(b * 255);
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  cache.noise = tex;
  return tex;
}

// --- Ciel ---

// Couleur du ciel dans une direction (partagée par le dôme et les reflets de l'eau).
export const SKY_GLSL = /* glsl */ `
uniform vec3 uZenith, uMid, uHorizon, uSunDir, uSunColor;
vec3 skyGradient( vec3 d ) {
  float h = d.y;
  float hp = max( h, 0.0 );
  // Diffusion : l'horizon est plus clair et plus blanc, le zénith plus profond.
  vec3 col = mix( uHorizon, uMid, 1.0 - exp( - hp * 7.0 ) );
  col = mix( col, uZenith, smoothstep( 0.18, 0.95, hp ) );
  col = mix( col, uHorizon * 0.96, smoothstep( 0.0, -0.08, h ) );
  float s = max( dot( d, uSunDir ), 0.0 );
  // Halo de Mie autour du soleil, plus large près de l'horizon.
  col += uSunColor * ( pow( s, 48.0 ) * 0.45 + pow( s, 6.0 ) * 0.14 ) ;
  col *= mix( vec3( 0.86, 0.92, 1.04 ), vec3( 1.12, 1.03, 0.9 ), pow( s, 6.0 ) * ( 1.0 - smoothstep( 0.0, 0.5, hp ) ) );
  return col;
}`;

export function makeSkyDome(mood, quality = 'high') {
  const octaves = quality === 'high' ? 3 : quality === 'medium' ? 2 : 1;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(mood.zenith) },
      uMid: { value: new THREE.Color(mood.mid) },
      uHorizon: { value: new THREE.Color(mood.horizon) },
      uSunDir: { value: SUN_DIR.clone() },
      uSunColor: { value: new THREE.Color(mood.sun) },
      uNoise: { value: noiseTexture() },
      uTime: { value: 0 },
      uCover: { value: mood.clouds },
      uCirrus: { value: mood.cirrus },
      // Météo (game/weather.js) : décalage des nuages poussés par le vent, ciel couvert qui assombrit
      // les nuages et voile le soleil. Valeurs neutres par défaut : ciel d'origine.
      uCloudOff: { value: new THREE.Vector2() },
      uShade: { value: 0 },
    },
    defines: { CLOUD_OCTAVES: octaves },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        p.z = p.w * 0.99999; // toujours au fond
        gl_Position = p;
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform sampler2D uNoise;
      uniform float uTime, uCover, uCirrus, uShade;
      uniform vec2 uCloudOff;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize( vDir );
        vec3 col = skyGradient( d );
        float s = max( dot( d, uSunDir ), 0.0 );
        if ( d.y > 0.0 ) {
          // Couche de cumulus : projection sur un plan, deux échelles de bruit, éclairage vers le soleil.
          vec2 p = d.xz / ( d.y + 0.06 );
          vec2 wind = vec2( uTime * 0.0016, uTime * 0.0006 ) + uCloudOff;
          float n = texture2D( uNoise, p * 0.075 + wind ).r;
          #if CLOUD_OCTAVES > 1
            n = n * 0.72 + texture2D( uNoise, p * 0.37 - wind * 1.7 ).g * 0.28;
          #endif
          #if CLOUD_OCTAVES > 2
            n += ( texture2D( uNoise, p * 1.3 + wind * 2.3 ).a - 0.5 ) * 0.09;
          #endif
          float base = 1.0 - uCover;
          float dens = smoothstep( base, base + 0.13, n );
          // Éclairage : plus d'épaisseur entre le point et le soleil = dessous plus sombre.
          vec2 toSun = normalize( uSunDir.xz + 1e-4 ) * 0.035;
          float n2 = texture2D( uNoise, ( p + toSun * 4.0 ) * 0.075 + wind ).r;
          float shade = clamp( 0.5 + ( n - n2 ) * 4.0, 0.0, 1.0 );
          vec3 lit = mix( vec3( 0.58, 0.64, 0.75 ), vec3( 1.12, 1.1, 1.05 ), shade );
          lit = mix( lit, uHorizon * 1.02, 1.0 - smoothstep( 0.02, 0.35, d.y ) ); // perspective aérienne
          lit += uSunColor * pow( s, 12.0 ) * ( 1.0 - dens ) * 0.9 * ( 1.0 - uShade ); // liseré lumineux face au soleil
          lit *= 1.0 - uShade * 0.5; // ciel couvert : nuages gris et épais
          float fade = smoothstep( 0.015, 0.16, d.y );
          // Cirrus : voiles étirés très haut.
          vec2 pc = d.xz / ( d.y + 0.2 );
          float ci = texture2D( uNoise, vec2( pc.x * 0.05, pc.y * 0.22 ) + wind * 0.5 ).b;
          ci = smoothstep( 0.62, 0.95, ci ) * uCirrus * smoothstep( 0.05, 0.4, d.y );
          col = mix( col, vec3( 1.0, 0.99, 0.97 ), ci * 0.45 );
          col = mix( col, lit, dens * fade * 0.95 );
        }
        // Disque du soleil (HDR : le halo lumineux et les reflets de lentille s'en servent).
        col += uSunColor * smoothstep( 0.99965, 0.99985, s ) * 22.0 * max( 0.0, 1.0 - uShade * 1.25 );
        gl_FragColor = vec4( col, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  // Rendu après les objets opaques : seuls les pixels de ciel visibles sont calculés.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3500, 40, 20), mat);
  sky.renderOrder = 900;
  sky.frustumCulled = false;
  sky.userData.uniforms = mat.uniforms;
  return sky;
}

// Carte d'environnement (reflets du ciel) : rendue depuis le dôme, nuages compris.
export function makeEnvironment(renderer, sky) {
  const envScene = new THREE.Scene();
  const s = sky.clone();
  s.renderOrder = 0;
  envScene.add(s);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0, 1, 4000);
  pmrem.dispose();
  // Libérer la texture seule laisserait la cible de rendu (et sa texture GPU) : on garde de quoi tout libérer.
  rt.texture.userData.release = () => rt.dispose();
  return rt.texture;
}

// Placement du soleil : sa zone d'ombres (boîte serrée) est centrée un peu devant la caméra, et calée sur
// la grille des texels de l'ombre pour qu'elle ne scintille pas quand on avance.
const _f = new THREE.Vector3();
const _ls = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _m = new THREE.Matrix4();
export function followSun(sun, focus, camera = null, ahead = 12) {
  if (!sun) return;
  _f.copy(focus);
  if (camera) {
    camera.getWorldDirection(_ls);
    _ls.y = 0;
    if (_ls.lengthSq() > 1e-6) _f.addScaledVector(_ls.normalize(), ahead);
  }
  const cam = sun.shadow?.camera;
  if (cam && sun.castShadow) {
    // Repère de la lumière : on arrondit la position du centre au texel près.
    _m.lookAt(SUN_DIR, _ls.set(0, 0, 0), THREE.Object3D.DEFAULT_UP);
    _q.setFromRotationMatrix(_m);
    _qi.copy(_q).invert();
    _ls.copy(_f).applyQuaternion(_qi);
    const texel = (cam.right - cam.left) / sun.shadow.mapSize.x;
    _ls.x = Math.round(_ls.x / texel) * texel;
    _ls.y = Math.round(_ls.y / texel) * texel;
    _f.copy(_ls).applyQuaternion(_q);
  }
  sun.target.position.copy(_f);
  sun.position.copy(_f).addScaledVector(SUN_DIR, 220);
}

// --- Vie dans le ciel et dans l'air ---

// Oiseaux qui tournent lentement en battant des ailes (tout est calculé dans le shader).
export function makeBirds(shared, center, count = 24, seed = 5) {
  const wing = [
    0, 0, 0.25, 0, 0, -0.25, -1.1, 0.05, -0.1,
    0, 0, 0.25, 1.1, 0.05, -0.1, 0, 0, -0.25,
  ];
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(wing, 3));
  const a = new Float32Array(count * 4);
  const b = new Float32Array(count * 2);
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    const flock = Math.floor(i / 6);
    a[i * 4] = center.x + Math.cos(flock * 2.4) * (120 + flock * 90) + (r() - 0.5) * 20;
    a[i * 4 + 1] = center.z + Math.sin(flock * 2.4) * (120 + flock * 90) + (r() - 0.5) * 20;
    a[i * 4 + 2] = 40 + r() * 60;
    a[i * 4 + 3] = center.y + 45 + flock * 12 + r() * 10;
    b[i * 2] = 7 + r() * 4;
    b[i * 2 + 1] = r() * 6.28;
  }
  geo.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(a, 4));
  geo.setAttribute('aFlap', new THREE.InstancedBufferAttribute(b, 2));
  geo.instanceCount = count;
  const mat = new THREE.MeshBasicMaterial({ color: '#2b2f38', side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aOrbit;\nattribute vec2 aFlap;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `
        float ang = aFlap.y + uTime * aFlap.x / aOrbit.z;
        vec3 transformed = position * 0.9;
        transformed.y += sin( uTime * 9.0 + aFlap.y * 3.0 ) * 0.5 * abs( position.x );
        // Cap : tangent à l'orbite
        float yaw = ang;
        transformed.xz = mat2( cos( yaw ), sin( yaw ), - sin( yaw ), cos( yaw ) ) * transformed.xz;
        transformed += vec3( aOrbit.x + cos( ang ) * aOrbit.z, aOrbit.w + sin( ang * 2.0 ) * 3.0, aOrbit.y + sin( ang ) * aOrbit.z );`);
  };
  mat.customProgramCacheKey = () => 'birds';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// Poussières et pollens qui brillent dans la lumière (autour de la caméra, qualité high).
export function makeMotes(shared, count = 320) {
  const size = 28;
  const pos = new Float32Array(count * 3);
  let s = 3;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count * 3; i++) pos[i] = r() * size;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uSun: { value: SUN_DIR.clone() }, uScale: { value: 300 } },
    vertexShader: /* glsl */ `
      uniform float uTime, uScale;
      uniform vec3 uSun;
      varying float vA;
      void main() {
        vec3 p = position + vec3( sin( uTime * 0.3 + position.y ) * 0.6, uTime * 0.12, cos( uTime * 0.25 + position.x ) * 0.6 );
        vec3 c = cameraPosition - vec3( ${size / 2}.0 );
        p = c + mod( p - c, ${size}.0 );
        vec4 mv = viewMatrix * vec4( p, 1.0 );
        vec3 dir = normalize( p - cameraPosition );
        float d = length( mv.xyz );
        vA = ( 0.25 + 0.75 * pow( max( dot( dir, uSun ), 0.0 ), 3.0 ) ) * smoothstep( 1.5, 4.0, d ) * ( 1.0 - smoothstep( 9.0, 14.0, d ) );
        gl_PointSize = uScale * 0.03 / d;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a = smoothstep( 0.5, 0.0, length( q ) ) * vA;
        gl_FragColor = vec4( vec3( 1.0, 0.95, 0.8 ) * a * 0.9, a );
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.uniforms = mat.uniforms;
  return pts;
}
