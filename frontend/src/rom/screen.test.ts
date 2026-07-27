// Boot the machine and look at what it draws.
//
// The routines were verified one at a time against the chip. This is the first
// thing that asks whether they compose: run the game from its reset vector and
// write out the playfield it fills in. A picture is the shortest way to tell
// "it is drawing the attract screen" from "it is drawing nothing".

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, it } from 'vitest';

import { System, SCREEN_W, SCREEN_H } from './system';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));

/** Minimal PNG writer - no dependency, and the format is small enough. */
function png(w: number, h: number, rgba: Uint32Array): Buffer {
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

describe('what the booted machine draws', () => {
  it('writes the screen out', () => {
    const sys = new System(rom);
    const STOP_AFTER = 600;          // ten seconds of game time
    let done = false;
    const notes: string[] = [];

    const visits = new Map<number, number>();
    const masks = new Map<number, number>();
    // the last addresses before a failure, so a bad jump can be traced back to
    // whatever computed it
    const ring = new Int32Array(64);
    let ri = 0;
    let a2In = -1; let a2Out = -1;
    // where a2 last took each value, so a bad function pointer can be traced
    // to whatever wrote it
    let prevA2 = -1;
    let spBefore = -1; const spDrift: string[] = [];
    let inHandler = false; let firstAbove = '';
    let waitOn = -1;
    const chanTrace: string[] = [];
    const writers = new Map<number, number>();
    sys.m.watchLo = 0x3e34ea; sys.m.watchHi = 0x3e34ed;
    const order: string[] = [];
    sys.m.onWrite = (a, v, pc) => {
      writers.set(pc, (writers.get(pc) ?? 0) + 1);
      if (order.length < 12) order.push(`f${sys.frames} 0x${a.toString(16)}=${v} by 0x${pc.toString(16)}`);
    };
    const a2Writes: string[] = [];
    sys.m.atPcExtra = (pc: number) => {
      visits.set(pc, (visits.get(pc) ?? 0) + 1);
      ring[ri & 63] = pc; ri += 1;
      if (sys.m.a2 !== prevA2) {
        prevA2 = sys.m.a2;
        a2Writes.push('0x' + (sys.m.a2 >>> 0).toString(16) + '@' + pc.toString(16));
        if (a2Writes.length > 14) a2Writes.shift();
      }
      if (pc === 0x14562 && waitOn < 0) waitOn = sys.m.a2 >>> 0;
      if (pc === 0x133b2) { a2In = sys.m.a2; spBefore = sys.m.a7; inHandler = true; }
      if (inHandler && !firstAbove && spBefore >= 0 && sys.m.a7 > spBefore) {
        firstAbove = `a7 first rose above the frame at 0x${pc.toString(16)}: `
          + `0x${(sys.m.a7 >>> 0).toString(16)} vs 0x${(spBefore >>> 0).toString(16)}`;
      }
      if (pc === 0x133ea) inHandler = false;
      if (pc === 0x133ea && spBefore >= 0) {
        // a7 at the rte should be exactly what it was at the handler entry
        if (sys.m.a7 !== spBefore && spDrift.length < 6) {
          spDrift.push(`entry 0x${(spBefore >>> 0).toString(16)} -> rte 0x${(sys.m.a7 >>> 0).toString(16)}`);
        }
      }
      if (pc === 0x133b2) a2In = sys.m.a2;
      if (pc === 0x133ea) a2Out = sys.m.a2;
      const k = (sys.m.sr >> 8) & 7;
      masks.set(k, (masks.get(k) ?? 0) + 1);
    };
    try {
      sys.run((s) => {
        if (s.frames <= 8 || s.frames % 120 === 0) {
          chanTrace.push(`f${s.frames}:0x${(s.m.load(0x3e3536, 32) >>> 0).toString(16)}`);
        }
        if (s.frames % 120 === 0 || s.frames === 1) {
          let lit = 0;
          for (let i = 0; i < 0x20000; i += 1) if (s.m.byte(0x200000 + i)) lit += 1;
          let pal = 0;
          for (let i = 0; i < 1024; i += 1) if (s.m.load(0x3c0000 + i * 2, 16)) pal += 1;
          notes.push(`frame ${s.frames}: ${lit} playfield bytes set, ${pal} palette entries set`);
        }
        if (s.frames >= STOP_AFTER) { done = true; throw new Error('enough'); }
      });
    } catch (e) {
      if (!done) notes.push(`stopped early: ${(e as Error).message}`);
    }

    writeFileSync(join(here, 'screen.png'), png(SCREEN_W, SCREEN_H, sys.screen()));
    notes.push(`frames run: ${sys.frames}   instructions: ${sys.m.steps}`);
    notes.push(`missing routines: ${sys.m.missingCalls.length}`);
    notes.push(`interrupt handler 0x133b2 entered: ${visits.get(0x133b2) ?? 0} times`);
    notes.push(`rte at handler exit reached: ${visits.get(0x133ea) ?? 0}`);
    notes.push('interrupt mask the machine runs at: '
      + [...masks.entries()].sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `level ${k}: ${n}`).join(', '));
    {
      const tail: string[] = [];
      for (let i = Math.max(0, ri - 24); i < ri; i += 1) tail.push('0x' + (ring[i & 63] >>> 0).toString(16));
      notes.push('last addresses before it stopped: ' + tail.join(' '));
    }
    notes.push(`a2 entering the handler: 0x${(a2In >>> 0).toString(16)}   leaving it: 0x${(a2Out >>> 0).toString(16)}`);
    notes.push('a2 changed at: ' + a2Writes.join(' '));
    notes.push('stack drift across the handler: ' + (spDrift.length ? spDrift.join(', ') : 'none'));
    notes.push(firstAbove || 'a7 never rose above the frame inside the handler');
    for (const a of [0x580, 0x596, 0x618, 0x125da, 0x1512, 0x53f8, 0x512, 0x51a, 0x522]) {
      notes.push(`   0x${a.toString(16)} reached ${visits.get(a) ?? 0} times`);
    }
    notes.push(`sound queue: 0x3E3528=${sys.m.load(0x3e3528,16)} 0x3E352A=${sys.m.load(0x3e352a,16)}`);
    notes.push(`routines that write them: 0x1425c ${visits.get(0x1425c) ?? 0}, 0x143b0 ${visits.get(0x143b0) ?? 0}, 0x144ae ${visits.get(0x144ae) ?? 0}, 0x144d0 ${visits.get(0x144d0) ?? 0}`);
    notes.push(`sound driver 0x196ac reached ${visits.get(0x196ac) ?? 0}; channel work 8(a2) still pending: ${sys.m.load(0x3e3536 + 8, 32)}`);
    notes.push(`the spin at 0x14562 waits on a2=0x${(waitOn >>> 0).toString(16)}`
      + (waitOn >= 0 ? `, whose first long is ${sys.m.load(waitOn, 32)}` : ''));
    notes.push('channel pointer over time: ' + chanTrace.join(' '));
    {
      const at = sys.m.load(0x3e3536, 32) >>> 0;
      const bytes: string[] = [];
      for (let i = -4; i < 12; i += 1) bytes.push(sys.m.byte(at + i).toString(16).padStart(2, '0'));
      notes.push(`sequence around 0x${at.toString(16)}: ${bytes.join(' ')}`);
      notes.push(`channel struct at 0x3E3536: ` + Array.from({length: 8},
        (_, i) => sys.m.load(0x3e3536 + i * 4, 32).toString(16)).join(' '));
    }
    notes.push('writes to 0x3E34EA: ' + (order.join(' | ') || 'none'));
    notes.push('who writes it: ' + ([...writers.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([p, n]) => `0x${p.toString(16)}x${n}`).join(' ') || 'nobody'));
    notes.push('busiest addresses:');
    for (const [a, n] of [...visits.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10)) {
      notes.push(`   0x${a.toString(16)}  ${n}`);
    }
    // eslint-disable-next-line no-console
    console.log(notes.join('\n'));
    writeFileSync(join(here, 'screen.txt'), notes.join('\n'));
  }, 300000);
});
