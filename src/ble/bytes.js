// Petits outils binaires partagés : hex, UUID, décodeur protobuf générique.

export function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof DataView) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}

export function hex(data) {
  return Array.from(toBytes(data), (b) => b.toString(16).padStart(2, '0')).join(' ');
}

export function startsWith(bytes, prefix) {
  if (bytes.length < prefix.length) return false;
  return prefix.every((b, i) => bytes[i] === b);
}

// Nom lisible d'un UUID Bluetooth (services/caractéristiques connus).
const KNOWN_UUIDS = {
  '1800': 'Generic Access',
  '1801': 'Generic Attribute',
  '180a': 'Device Information',
  '180d': 'Heart Rate',
  '180f': 'Battery',
  '1816': 'Cycling Speed & Cadence',
  '1818': 'Cycling Power',
  '1826': 'Fitness Machine (FTMS)',
  '1814': 'Running Speed & Cadence',
  '2acd': 'Treadmill Data',
  '2ace': 'Cross Trainer Data',
  '2ad1': 'Rower Data',
  'a913bfc0-929e-11e5-b928-0002a5d5c51b': 'Technogym (propriétaire)',
  'fc82': 'Zwift (FW2 / Ride)',
  '2a19': 'Battery Level',
  '2a24': 'Model Number',
  '2a25': 'Serial Number',
  '2a26': 'Firmware Revision',
  '2a27': 'Hardware Revision',
  '2a28': 'Software Revision',
  '2a29': 'Manufacturer Name',
  '2a37': 'Heart Rate Measurement',
  '2a5d': 'Sensor Location',
  '2a63': 'Cycling Power Measurement',
  '2a65': 'Cycling Power Feature',
  '2a66': 'Cycling Power Control Point',
  '2acc': 'Fitness Machine Feature',
  '2ad2': 'Indoor Bike Data',
  '2ad3': 'Training Status',
  '2ad6': 'Supported Resistance Level Range',
  '2ad8': 'Supported Power Range',
  '2ad9': 'Fitness Machine Control Point',
  '2ada': 'Fitness Machine Status',
  '00000001-19ca-4651-86e5-fa29dcdd09d1': 'Zwift (service)',
  '00000002-19ca-4651-86e5-fa29dcdd09d1': 'Zwift Async (notify)',
  '00000003-19ca-4651-86e5-fa29dcdd09d1': 'Zwift Sync RX (write)',
  '00000004-19ca-4651-86e5-fa29dcdd09d1': 'Zwift Sync TX (indicate)',
};

export function uuidName(uuid) {
  const u = uuid.toLowerCase();
  const m = u.match(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/);
  const short = m ? m[1] : u;
  const name = KNOWN_UUIDS[short];
  return name ? `${name} [${short}]` : short;
}

export function propsList(p) {
  return ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate']
    .filter((k) => p && p[k])
    .join(',');
}

// Décodeur protobuf générique : renvoie [{field, wire, value}] ou lève une erreur.
// wire 0 = varint (Number), 2 = bytes (Uint8Array), 1/5 = fixe (Number).
export function decodeProtobuf(input) {
  const bytes = toBytes(input);
  const out = [];
  let i = 0;
  const readVarint = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (i >= bytes.length) throw new Error('varint tronqué');
      const b = bytes[i++];
      result += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return result;
      shift += 7;
      if (shift > 63) throw new Error('varint trop long');
    }
  };
  while (i < bytes.length) {
    const key = readVarint();
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (field === 0) throw new Error('numéro de champ 0');
    let value;
    if (wire === 0) value = readVarint();
    else if (wire === 2) {
      const len = readVarint();
      if (i + len > bytes.length) throw new Error('longueur hors limites');
      value = bytes.slice(i, i + len);
      i += len;
    } else if (wire === 5) {
      if (i + 4 > bytes.length) throw new Error('fixed32 tronqué');
      value = new DataView(bytes.buffer, bytes.byteOffset + i, 4).getUint32(0, true);
      i += 4;
    } else if (wire === 1) {
      if (i + 8 > bytes.length) throw new Error('fixed64 tronqué');
      value = Number(new DataView(bytes.buffer, bytes.byteOffset + i, 8).getBigUint64(0, true));
      i += 8;
    } else throw new Error(`wire type ${wire} inconnu`);
    out.push({ field, wire, value });
  }
  return out;
}

export function zigzag(n) {
  return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
}

// Représentation texte compacte d'un message protobuf (récursif sur les sous-messages).
export function protobufToString(input, depth = 0) {
  try {
    const fields = decodeProtobuf(input);
    return fields
      .map(({ field, wire, value }) => {
        if (wire === 2 && depth < 3) {
          try {
            decodeProtobuf(value);
            return `${field}:{${protobufToString(value, depth + 1)}}`;
          } catch {
            return `${field}:<${hex(value)}>`;
          }
        }
        return `${field}:${value}`;
      })
      .join(' ');
  } catch (e) {
    return `(pas du protobuf: ${e.message})`;
  }
}

export function encodeVarint(n) {
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}
