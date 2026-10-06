// Réglages du son dans Options : curseurs de volume (souris, doigt, ← → au clavier et à la manette)
// et bouton de coupure générale. Les éléments sont repérés par leurs attributs data-vol / data-mute.
import { BUSES, percentLabel } from './settings.js';

export function bindVolumeControls(root, engine, preview = () => {}) {
  if (!root?.querySelectorAll) return () => {};
  const sliders = [...root.querySelectorAll('input[type="range"][data-vol]')];
  const mutes = [...root.querySelectorAll('[data-mute]')];
  const note = root.querySelector('#soundNote');
  let lastPreview = 0;

  const refresh = () => {
    const s = engine.settings;
    for (const el of sliders) {
      const bus = el.dataset.vol;
      if (!BUSES.includes(bus)) continue;
      if (document.activeElement !== el || el.value !== String(s[bus])) el.value = String(s[bus]);
      el.style.setProperty('--fill', `${s[bus]}%`);
      el.setAttribute('aria-valuetext', percentLabel(s[bus]));
      const out = root.querySelector(`[data-vol-out="${bus}"]`);
      if (out) out.textContent = percentLabel(s[bus]);
      el.closest('.opt-row')?.classList.toggle('muted', s.muted);
    }
    for (const b of mutes) b.setAttribute('aria-pressed', String((b.dataset.mute === 'off') === s.muted));
  };

  for (const el of sliders) {
    const bus = el.dataset.vol;
    el.addEventListener('input', () => {
      engine.setVolume(bus, Number(el.value), false);
      refresh();
      const now = performance.now();
      if (now - lastPreview > 140) {
        lastPreview = now;
        preview(bus, Number(el.value));
      }
    });
    el.addEventListener('change', () => {
      engine.setVolume(bus, Number(el.value), true);
      refresh();
    });
  }
  for (const b of mutes) {
    b.addEventListener('click', () => {
      engine.setMuted(b.dataset.mute === 'off');
      refresh();
    });
  }
  engine.addEventListener('settings', refresh);
  if (!engine.available) {
    for (const el of [...sliders, ...mutes]) el.disabled = true;
    if (note) {
      note.hidden = false;
      note.textContent = 'Le son n’est pas disponible dans ce navigateur.';
    }
  }
  refresh();
  return refresh;
}
