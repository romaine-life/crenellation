// A PNG writer, so a change to the game can be looked at rather than
// summarised. No dependency: the format is small enough.
import { deflateSync } from 'node:zlib';

/** Minimal PNG writer - no dependency, and the format is small enough. */
export function png(w: number, h: number, rgba: Uint32Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y += 1) {
    raw[o] = 0;
    o += 1;
    for (let x = 0; x < w; x += 1) {
      const v = rgba[y * w + x];
      raw[o] = v & 0xff;
      raw[o + 1] = (v >> 8) & 0xff;
      raw[o + 2] = (v >> 16) & 0xff;
      raw[o + 3] = (v >> 24) & 0xff;
      o += 4;
    }
  }
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc = (b: Buffer) => {
    let c = -1;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (tag: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(tag, 'ascii'), data]);
    const cr = Buffer.alloc(4);
    cr.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
