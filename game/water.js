// Eau des graphismes détaillés (lac, mer, bassin d'aviron) : deux cartes de normales qui défilent plus une
// houle large, Fresnel, reflet du ciel calculé (même dégradé que le dôme), scintillement du soleil,
// couleur selon la profondeur (lue dans la carte d'altitude du terrain), écume sur le rivage.
// En qualité high, le bassin d'aviron peut ajouter un vrai reflet plan (Reflector, demi-résolution).
// Rivière du kayak (option flow) : vaguelettes emportées par le courant, eau blanche dans les rapides.
import * as THREE from 'three';
import { SKY_GLSL, SUN_DIR, noiseTexture, makeHash, periodicFbm } from './atmosphere.js';
import { TERRAIN_GLSL } from './nature.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

// Carte de normales de vaguelettes (bruit périodique, raccord parfait), générée une fois.
let normalCache = null;
export function waterNormalTexture() {
  if (normalCache) return normalCache;
  const N = 256;
  const h = new Float32Array(N * N);
  const hash = makeHash(17);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] = periodicFbm(hash, (x / N) * 8, (y / N) * 8, 8, 4, 0.5);
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)]) * 14;
      const dy = (h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x]) * 14;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      data[i] = Math.round((-dx / l * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  normalCache = tex;
  return tex;
}

const VERT = /* glsl */ `
  uniform float uTime, uSwell;
  uniform mat4 textureMatrix;
  varying vec3 vWorld;
  varying vec4 vReflUv;
  #ifdef HAS_FLOW
    // Rivière : vitesse du courant (m/s, plan xz) et écume des rapides (0..1) dans les sommets
    attribute vec3 aFlow;
    varying vec3 vFlow;
  #endif
  #include <fog_pars_vertex>
  void main() {
    #ifdef HAS_FLOW
      vFlow = aFlow;
    #endif
    vec4 wp = modelMatrix * vec4( position, 1.0 );
    // Houle douce et va-et-vient sur le rivage (mer).
    wp.y += ( sin( uTime * 0.55 ) * 0.06 + sin( wp.x * 0.02 + uTime * 0.7 ) * 0.05 + sin( wp.z * 0.031 - uTime * 0.9 ) * 0.04 ) * uSwell;
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #ifdef USE_REFLECTOR
      vReflUv = textureMatrix * vec4( position, 1.0 );
    #endif
    #include <fog_vertex>
  }`;

const FRAG = /* glsl */ `
  ${SKY_GLSL}
  #ifdef HAS_FIELD
    ${TERRAIN_GLSL}
  #endif
  uniform sampler2D uNormal, uNoise, tDiffuse;
  uniform float uTime, uChop, uWaterY, uFoam, uDepthScale;
  uniform vec3 uShallow, uDeep, uSandTint;
  varying vec3 vWorld;
  varying vec4 vReflUv;
  #ifdef HAS_FLOW
    varying vec3 vFlow;
  #endif
  #include <fog_pars_fragment>
  void main() {
    vec3 V = cameraPosition - vWorld;
    float dist = length( V );
    V /= dist;
    vec2 p = vWorld.xz;
    #ifdef HAS_FLOW
      // Carte de courant : deux phases décalées qui avancent avec l'eau et se relaient (pas d'étirement).
      float fph0 = fract( uTime * 0.5 );
      float fph1 = fract( uTime * 0.5 + 0.5 );
      float fw = abs( fph0 - 0.5 ) * 2.0;
      vec2 fo0 = vFlow.xy * fph0 * 2.0;
      vec2 fo1 = vFlow.xy * fph1 * 2.0;
      vec2 n1 = mix( texture2D( uNormal, ( p - fo0 ) * 0.043 ).xy, texture2D( uNormal, ( p - fo1 ) * 0.043 + 0.37 ).xy, fw ) * 2.0 - 1.0;
      vec2 n2 = mix( texture2D( uNormal, ( p - fo0 ) * 0.117 + 0.21 ).xy, texture2D( uNormal, ( p - fo1 ) * 0.117 + 0.61 ).xy, fw ) * 2.0 - 1.0;
      vec2 n3 = texture2D( uNormal, p * 0.0085 + uTime * vec2( 0.003, -0.0025 ) ).xy * 2.0 - 1.0;
      float rapid = vFlow.z;
      float chop = uChop * ( 1.0 + rapid * 1.8 );
    #else
      vec2 n1 = texture2D( uNormal, p * 0.043 + uTime * vec2( 0.011, 0.007 ) ).xy * 2.0 - 1.0;
      vec2 n2 = texture2D( uNormal, p * 0.117 + uTime * vec2( -0.016, 0.012 ) ).xy * 2.0 - 1.0;
      vec2 n3 = texture2D( uNormal, p * 0.0085 + uTime * vec2( 0.003, -0.0025 ) ).xy * 2.0 - 1.0;
      float chop = uChop;
    #endif
    // Les vaguelettes s'adoucissent au loin (pas de scintillement), la houle large reste.
    float near = 1.0 / ( 1.0 + dist * 0.015 );
    vec2 slope = ( n1 * 0.6 + n2 * 0.4 ) * chop * near + n3 * chop * 0.55;
    vec3 N = normalize( vec3( slope.x, 1.0, slope.y ) );
    float NdV = max( dot( N, V ), 0.0 );
    float fres = min( 0.02 + 0.98 * pow( 1.0 - NdV, 5.0 ), 0.8 );
    vec3 R = reflect( - V, N );
    // Les vagues renvoient surtout le ciel au-dessus de l'horizon (plus bleu que l'horizon lui-même).
    R.y = abs( R.y ) + 0.08;
    vec3 refl = skyGradient( normalize( R ) ) * 0.92;
    #ifdef USE_REFLECTOR
      vec4 ru = vReflUv;
      ru.xy += slope * 0.22 * ru.w * near;
      vec3 planar = texture2DProj( tDiffuse, ru ).rgb;
      refl = planar;
    #endif
    float depth = 8.0;
    #ifdef HAS_FIELD
      #ifdef HAS_FLOW
        depth = vWorld.y - terrainH( p ); // la rivière descend : niveau de l'eau dans les sommets
      #else
        depth = uWaterY - terrainH( p );
      #endif
    #endif
    float dk = 1.0 - exp( - max( depth, 0.0 ) * uDepthScale );
    vec3 body = mix( uShallow, uDeep, dk );
    // Fond de sable visible près du bord
    body = mix( uSandTint, body, smoothstep( 0.0, 1.1, depth ) );
    float sunUp = max( uSunDir.y, 0.0 );
    body *= 0.55 + 0.6 * sunUp;
    vec3 col = mix( body, refl, fres );
    // Scintillement du soleil sur les vaguelettes
    vec3 H = normalize( uSunDir + V );
    float NdH = max( dot( N, H ), 0.0 );
    col += uSunColor * ( pow( NdH, 900.0 ) * 22.0 + pow( NdH, 160.0 ) * 0.12 ) * ( 0.4 + 0.6 * near );
    #ifdef HAS_FIELD
      // Écume : vagues qui arrivent sur le rivage, mousse irrégulière
      float fn = texture2D( uNoise, p * 0.09 + uTime * vec2( 0.012, 0.02 ) ).a;
      float waves = 0.5 + 0.5 * sin( depth * 5.5 - uTime * 1.7 + fn * 5.0 );
      float shore = 1.0 - smoothstep( 0.0, 1.2, depth );
      float foam = shore * smoothstep( 0.5, 0.85, waves * 0.7 + fn * 0.5 ) + smoothstep( 0.22, 0.0, depth ) * 0.9;
      col = mix( col, vec3( 0.93, 0.96, 1.0 ) * ( 0.65 + 0.45 * sunUp ), clamp( foam * uFoam, 0.0, 0.92 ) );
    #endif
    #ifdef HAS_FLOW
      // Eau blanche des rapides : bouillons et traînées emportés par le courant.
      // Repère du courant : traînées étirées dans le sens de l'eau.
      vec2 fd = normalize( vFlow.xy + vec2( 1e-4, 0.0 ) );
      vec2 fq0 = vec2( dot( p - fo0, fd ), dot( p - fo0, vec2( -fd.y, fd.x ) ) );
      vec2 fq1 = vec2( dot( p - fo1, fd ), dot( p - fo1, vec2( -fd.y, fd.x ) ) );
      float wn = mix( texture2D( uNoise, fq0 * vec2( 0.035, 0.12 ) ).b, texture2D( uNoise, fq1 * vec2( 0.035, 0.12 ) + 0.5 ).b, fw );
      float wf = mix( texture2D( uNoise, fq0 * 0.16 ).a, texture2D( uNoise, fq1 * 0.16 + 0.3 ).a, fw );
      float wb = texture2D( uNoise, p * 0.021 ).g;
      float white = rapid * smoothstep( 0.8, 0.98, wn * 0.7 + wf * 0.2 + wb * 0.25 ) * 0.9;
      white += smoothstep( 0.5, 0.0, depth ) * 0.55 * ( 0.35 + rapid ); // écume au pied des berges et des rochers
      col = mix( col, vec3( 0.94, 0.97, 1.0 ) * ( 0.7 + 0.4 * sunUp ), clamp( white, 0.0, 0.85 ) );
      // Eau vive plus claire et plus verte (bulles en suspension)
      col = mix( col, col * vec3( 1.05, 1.18, 1.14 ) + vec3( 0.03, 0.05, 0.05 ), rapid * 0.45 );
    #endif
    gl_FragColor = vec4( col, 1.0 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

// Uniformes et paramètres de shader de l'eau.
// flow : la géométrie porte un attribut aFlow (courant x, z et écume des rapides), le niveau de l'eau suit les sommets.
function waterShader({ mood, maps, waterY, shared, chop, swell, foam, shallow, deep, sand, depthScale, flow = false }) {
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uZenith: { value: new THREE.Color(mood.zenith) },
    uMid: { value: new THREE.Color(mood.mid) },
    uHorizon: { value: new THREE.Color(mood.horizon) },
    uSunDir: { value: SUN_DIR.clone() },
    uSunColor: { value: new THREE.Color(mood.sun) },
    uNormal: { value: waterNormalTexture() },
    uNoise: { value: noiseTexture() },
    uTime: shared.uTime,
    uChop: { value: chop },
    uSwell: { value: swell },
    uFoam: { value: foam },
    uWaterY: { value: waterY },
    uDepthScale: { value: depthScale },
    uShallow: { value: new THREE.Color(shallow) },
    uDeep: { value: new THREE.Color(deep) },
    uSandTint: { value: new THREE.Color(sand) },
    tDiffuse: { value: null },
    color: { value: new THREE.Color(1, 1, 1) },
    textureMatrix: { value: new THREE.Matrix4() },
    ...(maps ? maps.uniforms : {}),
  };
  const defines = {};
  if (maps) defines.HAS_FIELD = '';
  if (flow) defines.HAS_FLOW = '';
  return { uniforms, defines, vertexShader: VERT, fragmentShader: FRAG };
}

// Surface d'eau plane : geometry dans le plan XZ (déjà tournée).
export function makeWater(geometry, opts) {
  const o = {
    chop: 0.32, swell: 0, foam: 1, shallow: '#3fb7c4', deep: '#0f4f78', sand: '#c9b98a', depthScale: 0.35, ...opts,
  };
  const sh = waterShader(o);
  const mat = new THREE.ShaderMaterial({ ...sh, fog: true });
  const mesh = new THREE.Mesh(geometry, mat);
  return mesh;
}

// Eau avec reflet plan (bassin d'aviron, qualité high) : Reflector de three.js avec notre shader.
export function makeReflectiveWater(width, depth, opts, resolution) {
  const o = {
    chop: 0.32, swell: 0, foam: 1, shallow: '#3fb7c4', deep: '#0f4f78', sand: '#c9b98a', depthScale: 0.35, ...opts,
  };
  const sh = waterShader(o);
  sh.defines.USE_REFLECTOR = '';
  const refl = new Reflector(new THREE.PlaneGeometry(width, depth), {
    textureWidth: resolution.x,
    textureHeight: resolution.y,
    clipBias: 0.002,
    multisample: 0,
    shader: { name: 'WaterReflector', uniforms: sh.uniforms, vertexShader: sh.vertexShader, fragmentShader: sh.fragmentShader },
  });
  // Le Reflector clone les uniformes : on rebranche les objets partagés (temps, textures, cartes).
  const mu = refl.material.uniforms;
  for (const [k, v] of Object.entries(sh.uniforms)) if (!['tDiffuse', 'color', 'textureMatrix'].includes(k)) mu[k] = v;
  refl.material.defines = { ...refl.material.defines, ...sh.defines };
  refl.material.fog = true;
  refl.material.needsUpdate = true;
  refl.rotation.x = -Math.PI / 2;
  return refl;
}
