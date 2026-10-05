import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameDue, nextScale, FrameGovernor } from '../src/core/framerate.js';

test('plafond à 60 images/s : une image sur deux à 120 Hz', () => {
  let last = -Infinity;
  let drawn = 0;
  for (let i = 0; i < 120; i++) {
    const now = i * (1000 / 120);
    if (frameDue(now, last)) {
      drawn++;
      last = now;
    }
  }
  assert.ok(drawn >= 58 && drawn <= 61, `images dessinées : ${drawn}`);
  // À 60 Hz, aucune image n'est sautée
  last = -Infinity;
  drawn = 0;
  for (let i = 0; i < 60; i++) if (frameDue(i * 16.67, last)) (drawn++, (last = i * 16.67));
  assert.equal(drawn, 60);
});

test('résolution adaptative : baisse sous 50 i/s, remonte au-dessus de 57, bornée', () => {
  assert.ok(nextScale(1, 25) < 1);
  assert.equal(nextScale(0.56, 40), 0.55);
  assert.equal(nextScale(1, 16), 1);
  assert.ok(nextScale(0.7, 16) > 0.7);
  assert.equal(nextScale(0.8, 18.5), 0.8, 'entre 50 et 57 i/s : on ne bouge pas');
});

test('le régulateur réagit à une machine lente puis rapide', () => {
  const scales = [];
  const g = new FrameGovernor({ onScale: (s) => scales.push(s) });
  let t = 0;
  for (let i = 0; i < 200; i++) {
    t += 30; // ~33 i/s
    g.allow(t);
  }
  assert.ok(g.scale < 0.8, `échelle ${g.scale}`);
  for (let i = 0; i < 1400; i++) {
    t += 16.7;
    g.allow(t);
  }
  assert.ok(g.scale > 0.95, `échelle remontée ${g.scale}`);
  assert.ok(scales.length >= 3);
});
