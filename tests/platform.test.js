// Détection de la plateforme (PC/Chrome, iPad/Safari, iPad/Bluefy). Lancer : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform } from '../src/core/platform.js';

const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

test('PC Windows + Chrome', () => {
  const p = detectPlatform({ ua: WIN_CHROME, platform: 'Win32', hasBluetooth: true });
  assert.equal(p.ios, false);
  assert.equal(p.windows, true);
  assert.equal(p.browser, 'Chrome');
  assert.equal(p.major, 141);
});

test('iPad récent (se présente comme un Mac) dans Safari', () => {
  const p = detectPlatform({ ua: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 5, hasBluetooth: false });
  assert.equal(p.ios, true);
  assert.equal(p.browser, 'Safari');
  assert.equal(p.ok, false);
});

test('iPad dans Bluefy (Web Bluetooth présent)', () => {
  const p = detectPlatform({ ua: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 5, hasBluetooth: true });
  assert.equal(p.browser, 'Bluefy');
  assert.equal(p.ok, true);
});

test('Un vrai Mac (pas tactile) n’est pas pris pour un iPad', () => {
  assert.equal(detectPlatform({ ua: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 0 }).ios, false);
});
