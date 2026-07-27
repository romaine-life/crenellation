import { readFileSync, writeFileSync } from 'node:fs';
const { System } = await import('./system.ts');
const rom = new Uint8Array(readFileSync('src/rom/rom.bin'));
const board = new Uint8Array(readFileSync('src/rom/io-baseline.bin'));
const IDLE = [0xf7, 0xff, 0xff, 0xff];
const END = Number(process.argv[2] ?? 4600);
const sys = new System(rom, board);
const hold = (s, bit, from, times, period, len) => {
  const f = s.frames;
  if (f >= from && f < from + times * period && ((f - from) % period) < len) {
    sys.inputs[bit >> 3] &= ~(1 << (bit & 7));
  }
};
try {
  sys.run((s) => {
    sys.inputs.set(IDLE);
    hold(s, 24, 2600, 6, 30, 12);        // coin, byte 3 bit 0
    hold(s, 0, 3200, 4, 40, 15);         // byte 0 bit 0 - left place
    if (s.frames >= END) throw new Error('done');
  });
} catch (e) { if (!/done/.test(e.message)) console.log('stopped:', e.message.slice(0, 50)); }
writeFileSync('src/rom/coin.rgba', Buffer.from(sys.screen().buffer));
console.log('frames', sys.frames);
