import { readFileSync } from 'node:fs';
const { System } = await import('./system.ts');
const rom = new Uint8Array(readFileSync('src/rom/rom.bin'));
const board = new Uint8Array(readFileSync('src/rom/io-baseline.bin'));
const IDLE = [0xf7, 0xff, 0xff, 0xff];
const sys = new System(rom, board);
const m = sys.m;
// score words measured in an earlier session: round bonus and battle award
const WATCH = [0x3e20aa, 0x3e20e4, 0x3e19f4, 0x3e1870];
const hits = new Map(WATCH.map((a) => [a, []]));
const hold = (f, b, from, times, period, len) => {
  if (f >= from && f < from + times * period && ((f - from) % period) < len) sys.inputs[b >> 3] &= ~(1 << (b & 7));
};
const prev = new Map(WATCH.map((a) => [a, 0]));
let msg = 'ran to the end';
try {
  sys.run((s) => {
    const f = s.frames;
    sys.inputs.set(IDLE);
    hold(f, 24, 2600, 6, 30, 12);
    hold(f, 0, 3200, 4, 40, 15);
    if (f > 6000) {
      const t = f % 240;
      if (t < 60) sys.track[0] = (sys.track[0] + 2) & 0xff;
      else if (t < 120) sys.track[1] = (sys.track[1] + 2) & 0xff;
      else if (t < 180) sys.track[0] = (sys.track[0] - 2) & 0xff;
      else sys.track[1] = (sys.track[1] - 2) & 0xff;
      if (f % 30 < 8) sys.inputs[0] &= ~1;
      if (f % 97 < 6) sys.inputs[0] &= ~2;
    }
    if (f % 10 === 0) {
      for (const a of WATCH) {
        const v = m.load(a, 32) >>> 0;
        if (v !== prev.get(a)) { const l = hits.get(a); if (l.length < 14) l.push(`f${f}:${v}`); prev.set(a, v); }
      }
    }
    if (f >= 40000) throw new Error('done');
  });
} catch (e) { msg = e.message.slice(0, 60); }
console.log('outcome:', msg, ' frames', sys.frames);
for (const a of WATCH) {
  const l = hits.get(a);
  console.log(`  0x${a.toString(16)}: ${l.length ? l.join(' ') : 'never changed'}`);
}
