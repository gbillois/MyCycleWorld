// Journal partagé par tous les modules BLE. L'UI s'y abonne, et on peut tout copier/télécharger.

const entries = [];
const listeners = new Set();
const t0 = performance.now();

export function log(level, source, message) {
  const entry = {
    t: (performance.now() - t0) / 1000,
    time: new Date().toISOString().slice(11, 23),
    level,
    source,
    message,
  };
  entries.push(entry);
  if (entries.length > 5000) entries.shift();
  listeners.forEach((fn) => fn(entry));
  if (level === 'error') console.error(`[${source}]`, message);
}

export const info = (src, msg) => log('info', src, msg);
export const warn = (src, msg) => log('warn', src, msg);
export const error = (src, msg) => log('error', src, msg);
export const debug = (src, msg) => log('debug', src, msg);

export function onLog(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function formatEntry(e) {
  return `${e.time} ${e.level.toUpperCase().padEnd(5)} [${e.source}] ${e.message}`;
}

export function logText() {
  return entries.map(formatEntry).join('\n');
}

// Limiteur pour les flux rapides : n'écrit que les N premiers paquets puis 1 sur `every`.
export function packetSampler(first = 5, every = 100) {
  let n = 0;
  return () => {
    n++;
    return n <= first || n % every === 0;
  };
}
