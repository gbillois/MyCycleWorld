// Banque de sons : demande les rendus au travailleur (deux files : sons lourds et sons rapides, pour qu'un
// bip d'interface n'attende jamais la foule), garde les résultats en AudioBuffer, entretient des réserves
// de variantes (chants d'oiseaux toujours différents). Sans Worker module : rendu sur le fil principal.
import { hashSeed } from './random.js';
import { renderSound } from './renderers.js';

const HEAVY = new Set(['crowd', 'applause', 'water', 'insects', 'impulse', 'noise', 'lapping', 'crunch', 'church', 'fanfare', 'sting']);
// La musique a son propre travailleur : ses couches (une à deux secondes de calcul) ne retardent aucun effet.
const MUSIC = new Set(['music']);

const keyOf = (name, opts) => `${name}${opts && Object.keys(opts).length ? JSON.stringify(opts) : ''}`;

export class Bank {
  constructor(ctx) {
    this.ctx = ctx;
    this.sr = ctx.sampleRate;
    this.cache = new Map();
    this.pending = new Map();
    this.pools = new Map();
    this.nextId = 1;
    this.lanes = { quick: this.lane('quick'), heavy: this.lane('heavy') };
    this.stats = { rendered: 0, ms: 0, worker: !!this.lanes.quick.worker };
  }

  lane(name) {
    const lane = { name, queue: [], busy: null, worker: null };
    try {
      if (typeof Worker !== 'undefined') {
        lane.worker = new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' });
        lane.worker.onmessage = (e) => this.finish(lane, e.data);
        lane.worker.onerror = (e) => {
          // Worker module non pris en charge (navigateur ancien) : on continue sur le fil principal.
          e.preventDefault?.();
          lane.worker?.terminate();
          lane.worker = null;
          this.stats.worker = false;
          const job = lane.busy;
          lane.busy = null;
          if (job) lane.queue.unshift(job);
          this.pump(lane);
        };
      }
    } catch {
      lane.worker = null;
    }
    return lane;
  }

  // Son déjà prêt (AudioBuffer) ou null ; lance le rendu s'il n'a pas encore été demandé.
  get(name, opts = {}) {
    const k = keyOf(name, opts);
    const b = this.cache.get(k);
    if (!b && !this.pending.has(k)) this.load(name, opts).catch(() => {});
    return b || null;
  }

  // Promesse d'un son mis en cache (graine fixe : le même son à chaque partie).
  load(name, opts = {}, prio = 1) {
    const k = keyOf(name, opts);
    if (this.cache.has(k)) return Promise.resolve(this.cache.get(k));
    if (this.pending.has(k)) return this.pending.get(k);
    const p = this.request(name, opts, hashSeed(k), prio).then((buf) => {
      this.cache.set(k, buf);
      this.pending.delete(k);
      return buf;
    }, (err) => {
      this.pending.delete(k);
      throw err;
    });
    this.pending.set(k, p);
    return p;
  }

  // Résultat brut, non mis en cache ni converti : { sampleRate, channels, meta } (couches de la musique).
  raw(name, opts = {}, prio = 1) {
    return this.request(name, opts, hashSeed(keyOf(name, opts)), prio, true);
  }

  // Variante neuve, non mise en cache (graine au hasard).
  fresh(name, opts = {}, prio = 0) {
    return this.request(name, opts, (Math.random() * 4294967296) >>> 0, prio);
  }

  // Réserve de variantes : renvoie l'une d'elles (ou null tant qu'aucune n'est prête) et la renouvelle peu à peu.
  pool(name, opts = {}, size = 4, renew = 0.35) {
    const k = keyOf(name, opts);
    let p = this.pools.get(k);
    if (!p) {
      p = { items: [], waiting: 0 };
      this.pools.set(k, p);
    }
    const refill = () => {
      p.waiting++;
      this.fresh(name, opts).then((b) => {
        p.waiting--;
        p.items.push(b);
        if (p.items.length > size) p.items.splice(Math.floor(Math.random() * (p.items.length - 1)), 1);
      }, () => p.waiting--);
    };
    if (p.items.length + p.waiting < size) refill();
    if (!p.items.length) return null;
    const b = p.items[Math.floor(Math.random() * p.items.length)];
    if (Math.random() < renew && p.waiting === 0) refill();
    return b;
  }

  request(name, opts, seed, prio, raw = false) {
    return new Promise((resolve, reject) => {
      if (MUSIC.has(name) && !this.lanes.music) this.lanes.music = this.lane('music');
      const lane = MUSIC.has(name) ? this.lanes.music : HEAVY.has(name) ? this.lanes.heavy : this.lanes.quick;
      const job = { id: this.nextId++, name, opts, seed, prio, resolve, reject, raw, t: performance.now() };
      // Priorité : les sons urgents (interface, départ) passent devant les variantes d'ambiance.
      let i = lane.queue.length;
      while (i > 0 && lane.queue[i - 1].prio < prio) i--;
      lane.queue.splice(i, 0, job);
      this.pump(lane);
    });
  }

  pump(lane) {
    if (lane.busy || !lane.queue.length) return;
    const job = lane.queue.shift();
    lane.busy = job;
    if (lane.worker) {
      lane.worker.postMessage({ id: job.id, name: job.name, sr: this.sr, seed: job.seed, opts: job.opts });
      return;
    }
    // Repli : rendu sur le fil principal, un son par tranche de temps (la foule se découpe toute seule).
    setTimeout(async () => {
      try {
        const res = await renderSound(job.name, this.sr, job.seed, job.opts, { yieldFn: () => new Promise((r) => setTimeout(r, 12)) });
        this.finish(lane, { id: job.id, ...res });
      } catch (err) {
        this.finish(lane, { id: job.id, error: String(err) });
      }
    }, 0);
  }

  finish(lane, data) {
    const job = lane.busy;
    if (!job || job.id !== data.id) return;
    lane.busy = null;
    if (data.error) job.reject(new Error(data.error));
    else if (job.raw) {
      this.stats.rendered++;
      this.stats.ms += performance.now() - job.t;
      job.resolve({ sampleRate: data.sampleRate, channels: data.channels, meta: data.meta });
    } else {
      try {
        const ch = data.channels;
        const buf = this.ctx.createBuffer(ch.length, ch[0].length, data.sampleRate);
        ch.forEach((c, i) => buf.getChannelData(i).set(c));
        this.stats.rendered++;
        this.stats.ms += performance.now() - job.t;
        job.resolve(buf);
      } catch (err) {
        job.reject(err);
      }
    }
    this.pump(lane);
  }

  // Libère les sons d'une famille qui ne servent plus (notes d'un autre instrument, par exemple).
  evict(test) {
    for (const k of [...this.cache.keys()]) if (test(k)) this.cache.delete(k);
  }

  evictPools(test) {
    for (const k of [...this.pools.keys()]) if (test(k)) this.pools.delete(k);
  }

  dispose() {
    for (const lane of Object.values(this.lanes)) lane.worker?.terminate();
  }
}
