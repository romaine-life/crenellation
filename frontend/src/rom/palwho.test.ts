// Who writes the palette once the game is running, in each dispatcher?
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { System } from './system';
import { call as viaRecompiled } from './dispatch';
import { call as viaDecompiled, bind } from './decompiled';
const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const board = new Uint8Array(readFileSync(join(here, 'io-baseline.bin')));
function who(entry: (a: number, m: System['m']) => void, label: string): string {
  const sys = new System(rom, board);
  bind(sys.m);
  const m = sys.m as unknown as {
    setByte(a: number, v: number): void; store(a: number, v: number, b: number): void;
  };
  const seen = new Map<string, number>();
  let frame = 0;
  let lastCall = 0;
  sys.m.onCall = (a: number): void => { lastCall = a; };
  const note = (a: number): void => {
    if (a < 0x3c0000 || a >= 0x3c0800 || frame < 350) return;
    const key = `0x${lastCall.toString(16)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  };
  const sb = m.setByte.bind(m); const st2 = m.store.bind(m);
  m.setByte = (a, v) => { note(a); sb(a, v); };
  m.store = (a, v, b) => { note(a); st2(a, v, b); };
  const STOP = new Error('enough');
  try {
    sys.run(() => {
      frame += 1;
      sys.inputs[3] = frame > 500 && frame < 515 ? 0xfe : 0xff;
      sys.inputs[0] = frame > 540 && frame < 555 ? 0xf6 : 0xf7;
      if (frame >= 900) throw STOP;
    }, entry);
  } catch (e) { if (e !== STOP) return `${label}: threw ${(e as Error).message.slice(0, 40)}`; }
  const top = [...seen.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
  const head = sys.m.load(0x3e20a0, 32) >>> 0;
  const node = head !== 0x3e20a0 ? sys.m.byte(head + 0xe) : -1;
  return `${label}: list head 0x${head.toString(16)} counter ${node}`
    + ` | ${top.map(([s, c]) => `${c}x ${s}`).join(' ') || 'no palette writes'}`;
}
describe('palette writers', () => {
  it('after the game starts', () => {
    const o = [who(viaRecompiled, 'recompiled'), who(viaDecompiled, 'decompiled')];
    writeFileSync(join(here, 'palwho.txt'), o.join('\n'));
    expect(o.length).toBe(2);
  }, 900000);
});