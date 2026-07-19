// Minimal pure-JS ZIP reader — enough to open Office Open XML packages (.pptx/.docx/.xlsx),
// which are ZIP containers. Decompression uses Node's zlib (deflate). No dependencies.
// Returns a Map<string, Uint8Array> of entry name → bytes.

import zlib from 'node:zlib';

export function readZip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  // locate End Of Central Directory record (signature 0x06054b50)
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: end-of-central-directory record not found (not a zip?)');

  const cdCount = view.getUint16(eocd + 10, true);
  let cdOffset = view.getUint32(eocd + 16, true);

  const entries = new Map();
  for (let e = 0; e < cdCount; e++) {
    if (view.getUint32(cdOffset, true) !== 0x02014b50) break;
    const compMethod = view.getUint16(cdOffset + 8, true);
    const compSize = view.getUint32(cdOffset + 20, true);
    const uncompSize = view.getUint32(cdOffset + 24, true);
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);
    const name = bufferToString(u8, cdOffset + 46, nameLen);

    // jump to local header to find real data offset
    const lhNameLen = view.getUint16(localHeaderOffset + 26, true);
    const lhExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
    const comp = u8.subarray(dataStart, dataStart + compSize);

    let bytes;
    if (compMethod === 0) bytes = comp;                       // stored
    else if (compMethod === 8) bytes = zlib.inflateRawSync(comp); // deflate
    else throw new Error(`zip: unsupported compression method ${compMethod} for ${name}`);

    // store at declared uncompressed length when available
    entries.set(name, uncompSize > 0 ? bytes.subarray(0, uncompSize) : bytes);
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function zipEntryText(entries, name) {
  const b = entries.get(name);
  if (!b) return null;
  return bufferToString(b, 0, b.length);
}

// ---- writer (for pptx export + self-tests) ----

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}

export function crc32(u8) {
  const tab = crcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = tab[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// entries: array of { name, data } where data is string | Uint8Array. Returns Uint8Array.
export function writeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const raw = data instanceof Uint8Array ? data : Buffer.from(String(data), 'utf8');
    const crc = crc32(raw);
    const comp = zlib.deflateRawSync(raw);
    const useComp = comp.length < raw.length;
    const store = useComp ? comp : raw;
    const method = useComp ? 8 : 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);          // version
    localHeader.writeUInt16LE(0, 6);           // flags
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);          // mod time
    localHeader.writeUInt16LE(0, 12);          // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(store.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    chunks.push(localHeader, nameBytes, Buffer.from(store));

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(method, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(store.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // internal attr
    cd.writeUInt32LE(0, 38); // external attr
    cd.writeUInt32LE(offset, 42);
    central.push(cd, Buffer.from(nameBytes));

    offset += localHeader.length + nameBytes.length + store.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const b of central) cdSize += b.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...central, eocd]);
}

function bufferToString(u8, start, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(u8[start + i]);
  // interpret as UTF-8
  return Buffer.from(s, 'binary').toString('utf8');
}
