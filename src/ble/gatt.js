// Aides GATT communes : choix de l'appareil, connexion, inventaire des services, file d'écriture.
import { uuidName, propsList, toBytes } from './bytes.js';
import { info, warn } from './log.js';

export const SERVICES = {
  FTMS: 0x1826,
  CPS: 0x1818,
  CSC: 0x1816,
  HR: 0x180d,
  BATTERY: 0x180f,
  DIS: 0x180a,
  ZWIFT: '00000001-19ca-4651-86e5-fa29dcdd09d1',
  ZWIFT_FW2: 0xfc82,
  RSC: 0x1814,
  // Service propriétaire des vélos Technogym (repéré par qdomyos-zwift) : listé dans le journal s'il existe.
  TECHNOGYM_BIKE: 'a913bfc0-929e-11e5-b928-0002a5d5c51b',
};

export const ALL_OPTIONAL_SERVICES = Object.values(SERVICES);

// Le navigateur sait-il parler Bluetooth ?
export async function bluetoothSupport() {
  const res = { api: !!navigator.bluetooth, secure: window.isSecureContext, available: null };
  if (res.api && navigator.bluetooth.getAvailability) {
    try {
      res.available = await navigator.bluetooth.getAvailability();
    } catch {
      res.available = null;
    }
  }
  return res;
}

export function realRequestDevice(options) {
  if (!navigator.bluetooth) throw new Error("Web Bluetooth n'est pas disponible dans ce navigateur (utilise Chrome ou Edge).");
  return navigator.bluetooth.requestDevice(options);
}

// Connexion avec quelques essais : le premier connect() échoue parfois sous Windows.
export async function connectGatt(device, src, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      info(src, `Connexion GATT à "${device.name || '?'}" (essai ${i}/${attempts})...`);
      const server = await device.gatt.connect();
      info(src, 'GATT connecté');
      return server;
    } catch (e) {
      lastErr = e;
      warn(src, `Échec connexion GATT: ${e.message}`);
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
  throw lastErr;
}

// Liste tous les services/caractéristiques accessibles dans le journal. Renvoie les services.
export async function dumpGatt(server, src) {
  let services;
  try {
    services = await server.getPrimaryServices();
  } catch (e) {
    // Certains navigateurs (Bluefy sur iPad) ne savent pas lister tous les services : ce n'est pas bloquant.
    warn(src, `Inventaire des services impossible (${e.message}), on continue.`);
    return [];
  }
  info(src, `${services.length} service(s) accessibles :`);
  for (const s of services) {
    let chars = [];
    try {
      chars = await s.getCharacteristics();
    } catch (e) {
      warn(src, `  ${uuidName(s.uuid)} : caractéristiques illisibles (${e.message})`);
      continue;
    }
    info(src, `  • ${uuidName(s.uuid)}`);
    for (const c of chars) info(src, `      - ${uuidName(c.uuid)} (${propsList(c.properties)})`);
  }
  return services;
}

export async function getServiceOrNull(server, uuid) {
  try {
    return await server.getPrimaryService(uuid);
  } catch {
    return null;
  }
}

export async function getCharOrNull(service, uuid) {
  if (!service) return null;
  try {
    return await service.getCharacteristic(uuid);
  } catch {
    return null;
  }
}

// Lit fabricant / modèle / firmware (Device Information) si dispo.
export async function readDeviceInfo(server, src) {
  const dis = await getServiceOrNull(server, SERVICES.DIS);
  const out = {};
  if (!dis) return out;
  const fields = { manufacturer: 0x2a29, model: 0x2a24, firmware: 0x2a26, hardware: 0x2a27, software: 0x2a28 };
  const dec = new TextDecoder();
  for (const [k, uuid] of Object.entries(fields)) {
    const c = await getCharOrNull(dis, uuid);
    if (!c) continue;
    try {
      out[k] = dec.decode(toBytes(await c.readValue())).replace(/\0+$/, '');
    } catch {
      /* lecture refusée : on ignore */
    }
  }
  if (Object.keys(out).length) info(src, `Infos appareil : ${JSON.stringify(out)}`);
  return out;
}

export async function readBattery(server, src) {
  const bas = await getServiceOrNull(server, SERVICES.BATTERY);
  const c = await getCharOrNull(bas, 0x2a19);
  if (!c) return null;
  try {
    const level = toBytes(await c.readValue())[0];
    info(src, `Batterie : ${level} %`);
    return level;
  } catch {
    return null;
  }
}

export async function subscribe(char, handler) {
  char.addEventListener('characteristicvaluechanged', (ev) => handler(toBytes(ev.target.value)));
  await char.startNotifications();
}

// Les opérations GATT simultanées échouent ("operation already in progress") : on les sérialise.
export class GattQueue {
  constructor() {
    this.tail = Promise.resolve();
  }
  run(fn) {
    const p = this.tail.then(fn, fn);
    this.tail = p.catch(() => {});
    return p;
  }
}

export async function writeChar(char, bytes) {
  const data = Uint8Array.from(bytes);
  if (char.properties?.write && char.writeValueWithResponse) return char.writeValueWithResponse(data);
  if (char.properties?.writeWithoutResponse && char.writeValueWithoutResponse) return char.writeValueWithoutResponse(data);
  return char.writeValue(data);
}
