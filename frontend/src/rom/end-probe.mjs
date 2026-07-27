import { readFileSync, writeFileSync } from 'node:fs';
const { System } = await import('./system.ts');
const rom = new Uint8Array(readFileSync('src/rom/rom.bin'));
const board = new Uint8Array(readFileSync('src/rom/io-baseline.bin'));
const IDLE = [0xf7, 0xff, 0xff, 0xff];
const sys = new System(rom, board);
const AT = [7300, 7700, 8100, 8500, 8900, 9400, 10200];
const hold = (f, b, from, times, period, len) => {
  if (f >= from && f < from + times * period && ((f - from) % period) < len) sys.inputs[b >> 3] &= ~(1 << (b & 7));
};
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
    if (AT.includes(f)) writeFileSync(`src/rom/end-${f}.rgba`, Buffer.from(sys.screen().buffer));
    if (f >= 10400) throw new Error('done');
  });
} catch (e) { if (!/done/.test(e.message)) console.log('stopped:', e.message.slice(0, 50)); }
console.log('frames', sys.frames);
