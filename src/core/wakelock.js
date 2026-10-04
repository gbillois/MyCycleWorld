// Garde l'écran allumé pendant qu'on roule (tablette sur le guidon). Sans effet si le navigateur ne sait pas faire.

let sentinel = null;
let wanted = false;

async function acquire() {
  if (!wanted || sentinel || !navigator.wakeLock || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => (sentinel = null));
  } catch {
    sentinel = null; // refusé (batterie faible, navigateur) : pas grave
  }
}

// À appeler depuis un clic (certains navigateurs l'exigent).
export function keepScreenOn() {
  wanted = true;
  acquire();
}

export function allowScreenOff() {
  wanted = false;
  sentinel?.release().catch(() => {});
  sentinel = null;
}

// Le verrou saute quand l'appli passe en arrière-plan : on le reprend au retour.
document.addEventListener('visibilitychange', acquire);
