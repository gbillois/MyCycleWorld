// Post-traitement des graphismes détaillés.
//   high   : rendu HDR multiéchantillonné, halo lumineux (bloom) léger, puis une passe finale :
//            courbe filmique ACES + étalonnage (lift / gamma / gain, saturation, hautes lumières chaudes),
//            reflets de lentille quand on regarde le soleil, vignettage et grain très léger.
//   medium : aucune passe en plus (tablettes, iPad) : l'étalonnage est fait directement dans chaque matière
//            (tone mapping « personnalisé » de three.js), le vignettage par un calque CSS.
//   low    : rien (rendu direct, tone mapping neutre d'origine).
// Une petite régulation ajuste la résolution de rendu si l'image n'arrive plus à suivre (objectif 60 i/s,
// jamais sous 40) ; elle est coupée pendant les tests automatisés.
import * as THREE from 'three';
import { SUN_DIR } from './atmosphere.js';

// Étalonnage commun (dans la passe finale en high, dans chaque matière en medium).
const GRADE_GLSL = /* glsl */ `
vec3 CustomToneMapping( vec3 color ) {
	color *= toneMappingExposure / 0.6;
	// Balance des blancs légèrement chaude.
	color *= vec3( 1.03, 1.0, 0.96 );
	const mat3 ACESIn = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
	const mat3 ACESOut = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
	color = clamp( ACESOut * RRTAndODTFit( ACESIn * color ), 0.0, 1.0 );
	// Lift / gamma / gain dans un espace perceptuel.
	vec3 g = pow( color, vec3( 1.0 / 2.2 ) );
	g = g * vec3( 1.0, 0.995, 0.975 ) + vec3( 0.004, 0.006, 0.014 ) * ( 1.0 - g );
	g = pow( max( g, 0.0 ), vec3( 1.0 / 1.03 ) );
	g = mix( g, g * g * ( 3.0 - 2.0 * g ), 0.22 ); // contraste en S
	// Saturation (un peu plus dans les tons moyens), hautes lumières chaudes, ombres légèrement bleutées.
	float l = dot( g, vec3( 0.2126, 0.7152, 0.0722 ) );
	g = mix( vec3( l ), g, 1.07 - 0.08 * abs( l - 0.5 ) * 2.0 );
	g *= mix( vec3( 0.985, 1.0, 1.03 ), vec3( 1.025, 1.0, 0.955 ), smoothstep( 0.25, 0.85, l ) );
	return pow( clamp( g, 0.0, 1.0 ), vec3( 2.2 ) );
}`;

let gradeInstalled = false;
function installGrade() {
  if (gradeInstalled) return;
  gradeInstalled = true;
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    'vec3 CustomToneMapping( vec3 color ) { return color; }',
    GRADE_GLSL,
  );
}

// Passe finale (high) : reflets de lentille, étalonnage (via tone mapping), vignettage, grain.
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector3(0.5, 0.5, 0) }, // x, y (uv), z = visibilité (devant la caméra)
    uAspect: { value: 1 },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.022 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uSun;
    uniform float uAspect, uTime, uVignette, uGrain;
    varying vec2 vUv;
    float ghost( vec2 uv, vec2 c, float r ) {
      vec2 d = ( uv - c ) * vec2( uAspect, 1.0 );
      return smoothstep( r, r * 0.55, length( d ) );
    }
    void main() {
      vec3 col = texture2D( tDiffuse, vUv ).rgb;
      if ( uSun.z > 0.0 ) {
        // Le soleil est-il visible ? On lit la luminance HDR autour de sa position (aucune lecture CPU).
        float lum = 0.0;
        for ( int i = 0; i < 5; i ++ ) {
          vec2 o = vec2( float( i - 2 ) * 0.004, float( ( i * 3 ) % 5 - 2 ) * 0.004 );
          vec3 s = texture2D( tDiffuse, uSun.xy + o ).rgb;
          lum += dot( s, vec3( 0.3, 0.6, 0.1 ) );
        }
        float vis = smoothstep( 3.0, 9.0, lum / 5.0 ) * uSun.z;
        if ( vis > 0.0 ) {
          vec2 axis = vec2( 0.5 ) - uSun.xy;
          vec3 f = vec3( 0.0 );
          f += vec3( 1.0, 0.75, 0.45 ) * ghost( vUv, uSun.xy + axis * 0.55, 0.035 ) * 0.22;
          f += vec3( 0.5, 0.8, 1.0 ) * ghost( vUv, uSun.xy + axis * 1.25, 0.07 ) * 0.14;
          f += vec3( 0.7, 1.0, 0.6 ) * ghost( vUv, uSun.xy + axis * 1.6, 0.025 ) * 0.25;
          f += vec3( 1.0, 0.6, 0.8 ) * ghost( vUv, uSun.xy + axis * 2.0, 0.11 ) * 0.07;
          vec2 d = ( vUv - uSun.xy ) * vec2( uAspect, 1.0 );
          float r = length( d );
          f += vec3( 1.0, 0.9, 0.75 ) * exp( - r * 9.0 ) * 0.35; // voile autour du soleil
          float ring = smoothstep( 0.02, 0.0, abs( r - 0.22 ) ) * 0.05;
          f += vec3( 0.8, 0.9, 1.0 ) * ring;
          col += f * vis;
        }
      }
      gl_FragColor = vec4( col, 1.0 );
      #include <tonemapping_fragment>
      // Vignettage et grain après la courbe (sur les valeurs affichées).
      vec2 v = ( vUv - 0.5 ) * vec2( uAspect, 1.0 ) * 0.9;
      gl_FragColor.rgb *= mix( 1.0, 1.0 - uVignette, smoothstep( 0.35, 1.05, dot( v, v ) * 1.6 ) );
      float n = fract( sin( dot( gl_FragCoord.xy + fract( uTime * 7.31 ) * 97.0, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
      gl_FragColor.rgb += ( n - 0.5 ) * uGrain * ( 1.0 - gl_FragColor.rgb * 0.6 );
      #include <colorspace_fragment>
    }`,
};

// Vignettage CSS (medium) : un calque fixe au-dessus de la vue 3D, sous l'interface.
function cssVignette(canvas) {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none',
    background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(8,12,24,0.28) 100%)',
  });
  canvas.insertAdjacentElement('afterend', el);
  return el;
}

// Régulation de la résolution : 2 s au-dessus de 20 ms par image => on baisse ; longtemps fluide => on remonte.
function makeGovernor(renderer, onChange, maxRatio, minRatio) {
  const auto = !navigator.webdriver && !new URLSearchParams(location.search).has('fixedres');
  let ratio = renderer.getPixelRatio();
  let last = performance.now();
  let acc = 0;
  let n = 0;
  let calm = 0;
  let ceiling = maxRatio;
  return () => {
    if (!auto) return;
    const now = performance.now();
    const dt = now - last;
    last = now;
    if (dt > 250 || document.hidden) return; // onglet en pause, chargement : on ignore
    acc += dt;
    n++;
    if (acc < 2000) return;
    const avg = acc / n;
    acc = 0;
    n = 0;
    if (avg > 21 && ratio > minRatio) {
      // Trop lent : on baisse, et on ne remontera pas au-dessus de ce palier.
      ceiling = Math.min(ceiling, ratio);
      ratio = Math.max(minRatio, ratio * 0.85);
      calm = 0;
      onChange(ratio);
    } else if (avg < 17.6) {
      calm++;
      if (calm >= 5 && ratio < ceiling - 0.01) {
        ratio = Math.min(ceiling, ratio * 1.1);
        calm = 0;
        onChange(ratio);
      }
    } else calm = 0;
  };
}

// Construit la chaîne d'effets. Renvoie { render(), setSize(w, h), dispose() } ou null (rendu direct).
export async function createPost(renderer, scene, camera, quality) {
  if (quality === 'low') return null;
  installGrade();
  renderer.toneMapping = THREE.CustomToneMapping;
  renderer.toneMappingExposure = 1.0;
  const maxRatio = renderer.getPixelRatio();
  const minRatio = Math.min(maxRatio, quality === 'high' ? 1 : 0.75);

  if (quality !== 'high') {
    const vignette = cssVignette(renderer.domElement);
    const governor = makeGovernor(renderer, (r) => renderer.setPixelRatio(r), maxRatio, minRatio);
    return {
      render() {
        governor();
        renderer.render(scene, camera);
      },
      setSize() {},
      dispose() {
        vignette.remove();
      },
    };
  }

  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { ShaderPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/ShaderPass.js'),
    ]);
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.95);
    composer.addPass(bloom);
    const final = new ShaderPass(FinalShader);
    composer.addPass(final);
    const u = final.material.uniforms;
    const sunPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    const size = new THREE.Vector2();
    const t0 = performance.now();
    const governor = makeGovernor(renderer, (r) => {
      renderer.setPixelRatio(r);
      composer.setPixelRatio(r);
    }, maxRatio, minRatio);
    return {
      composer,
      bloom,
      render() {
        governor();
        // Position du soleil à l'écran (pour les reflets de lentille).
        camera.getWorldDirection(camDir);
        const facing = camDir.dot(SUN_DIR);
        sunPos.copy(camera.position).addScaledVector(SUN_DIR, 1000).project(camera);
        const onScreen = Math.max(Math.abs(sunPos.x), Math.abs(sunPos.y));
        u.uSun.value.set(sunPos.x * 0.5 + 0.5, sunPos.y * 0.5 + 0.5, facing > 0 && onScreen < 1.15 ? 1 - THREE.MathUtils.smoothstep(onScreen, 0.85, 1.15) : 0);
        renderer.getSize(size);
        u.uAspect.value = size.x / Math.max(1, size.y);
        u.uTime.value = (performance.now() - t0) / 1000;
        composer.render();
      },
      setSize(w, h) {
        composer.setSize(w, h);
      },
      dispose() {
        composer.dispose();
        bloom.dispose();
        target.dispose();
      },
    };
  } catch (e) {
    console.warn('Post-traitement indisponible, rendu direct.', e);
    return null;
  }
}
