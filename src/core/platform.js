// Détection de la plateforme, pour adapter les conseils (PC + Chrome, ou iPad + Bluefy).

export const BLUEFY_URL = 'https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055';

// Fonction pure (testable) : tout vient des paramètres.
export function detectPlatform({ ua = '', platform = '', maxTouchPoints = 0, hasBluetooth = false } = {}) {
  // Les iPad récents se présentent comme un Mac : on les reconnaît à l'écran tactile.
  const ios = /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
  const edge = /Edg\//.test(ua);
  const chrome = !ios && /Chrome\//.test(ua) && !edge && !/OPR\//.test(ua);
  const android = /Android/.test(ua);
  const windows = /Windows/.test(ua);
  const major = Number((ua.match(/(?:Chrome|Edg)\/(\d+)/) || [])[1] || 0);
  let browser = 'autre';
  if (ios) browser = hasBluetooth ? 'Bluefy' : 'Safari';
  else if (edge) browser = 'Edge';
  else if (chrome) browser = 'Chrome';
  return { ios, android, windows, browser, major, hasBluetooth, ok: hasBluetooth };
}

export function currentPlatform() {
  return detectPlatform({
    ua: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    hasBluetooth: !!navigator.bluetooth,
  });
}

// Conseil à afficher quand Web Bluetooth manque.
export function bluetoothAdvice(p = currentPlatform()) {
  if (p.hasBluetooth) return '';
  if (p.ios) return 'Sur iPad/iPhone, Safari ne gère pas le Bluetooth : installe l’appli gratuite Bluefy et ouvre cette page dedans.';
  if (!window.isSecureContext) return 'La page doit être ouverte en https (ou sur localhost) pour accéder au Bluetooth.';
  return 'Ce navigateur ne gère pas Web Bluetooth. Ouvre la page dans Chrome ou Edge (pas Firefox, pas Safari).';
}
