import { readFileSync, writeFileSync } from 'node:fs';
const { System } = await import('./system.ts');
const rom = new Uint8Array(readFileSync('src/rom/rom.bin'));
const board = new Uint8Array(readFileSync('src/rom/io-baseline.bin'));
const IDLE = [0xf7, 0xff, 0xff, 0xff];
const sys = new System(rom, board);
const m = sys.m;

// a coarse sample of the screen, to notice when the scene changes wholesale
function sample() {
  const out = [];
  for (let y = 8; y < 232; y += 8) for (let x = 8; x < 328; x += 8) out.push(m.byte(0x200000 + y * 512 + x));
  return out;
}
let last = null;
const scenes = [];
const hold = (f, b, from, times, period, len) => {
  if (f >= from && f < from + times * period && ((f - from) % period) < len) sys.inputs[b >> 3] &= ~(1 << (b & 7));
};
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
    if (f % 60 === 0 && f >= 3000) {
      const cur = sample();
      if (last) {
        let diff = 0;
        for (let i = 0; i < cur.length; i += 1) if (cur[i] !== last[i]) diff += 1;
        if (diff > cur.length * 0.30 && (!scenes.length || f - scenes[scenes.length - 1] > 240)) {
          scenes.push(f);
          writeFileSync(`src/rom/scene-${f}.rgba`, Buffer.from(sys.screen().buffer));
        }
      }
      last = cur;
    }
    if ([12000, 20000, 30000, 39000].includes(f)) writeFileSync(`src/rom/late-${f}.rgba`, Buffer.from(sys.screen().buffer));
    if (f >= 40000) throw new Error('done');
  });
} catch (e) { msg = e.message.slice(0, 60); }
console.log('outcome:', msg, ' frames', sys.frames);
console.log('scene changes at frames:', scenes.join(' '));
