// Find the first instruction where the port diverges from the hardware.
//
// Comparing final state tells you a routine is wrong. This tells you which
// instruction made it wrong, which is the difference between guessing at rules
// and fixing them.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { Machine } = await import('./machine.ts');
const { call } = await import('./dispatch.ts');

const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const baseline = new Uint8Array(readFileSync(join(here, 'replay-baseline.bin')));
const trace = readFileSync(join(here, 'step.log'), 'utf8')
  .split('\n')
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const p = l.trim().split(/\s+/);
    return { pc: parseInt(p[0], 16), regs: p.slice(1).map((x) => parseInt(x, 16)) };
  })
  // The tap fires on every fetch, so one instruction can produce several
  // samples and the registers move partway through it. Only the first sample
  // of each consecutive run at the same pc is an instruction boundary.
  .filter((e, i, all) => i === 0 || all[i - 1].pc !== e.pc);

const entry = trace.length ? trace[0].pc : 0;
const replay = readFileSync(join(here, '../../../romlab/out/calls/replay.txt'), 'utf8')
  .split('\n').filter(Boolean)
  .map((l) => l.trim().split(/\s+/).map((x) => parseInt(x, 16)))
  .find((t) => t[0] === entry);

if (!replay) {
  console.log('no replay case for entry', entry.toString(16));
  process.exit(1);
}

const RAM_LO = 0x3e0000;
const STACK = 0x3e5000;
const SENTINEL = 0x3e6000;

const m = new Machine(rom);
for (let i = 0; i < baseline.length; i += 1) m.setByte(RAM_LO + i, baseline[i]);
m.store(SENTINEL, 0x60fe, 16);
let sp = STACK;
for (let k = 8; k >= 1; k -= 1) { sp -= 4; m.store(sp, replay[16 + k], 32); }
sp -= 4;
m.store(sp, SENTINEL, 32);
for (let k = 0; k < 8; k += 1) m[`d${k}`] = replay[1 + k];
for (let k = 0; k < 6; k += 1) m[`a${k}`] = replay[9 + k];
m.a7 = sp;
m.a6 = STACK + 0x200;
m.stubMissing = true;

// step the port alongside the trace by hooking the instruction counter
const names = ['d0','d1','d2','d3','d4','d5','d6','d7','a0','a1','a2','a3','a4','a5','a6','a7'];
let idx = 0;
let reported = false;
const origTick = Machine.prototype.tick;
Machine.prototype.tick = function patched() {
  origTick.call(this);
  if (reported || idx >= trace.length) return;
  const want = trace[idx];
  const got = names.map((n) => this[n] >>> 0);
  const bad = [];
  for (let i = 0; i < names.length; i += 1) {
    if (got[i] !== (want.regs[i] >>> 0)) bad.push(names[i]);
  }
  if (bad.length) {
    reported = true;
    console.log(`diverged at step ${idx}, pc 0x${want.pc.toString(16)}`);
    for (const n of bad) {
      const i = names.indexOf(n);
      console.log(`   ${n}  rom ${(want.regs[i] >>> 0).toString(16).padStart(8, '0')}` +
                  `  port ${got[i].toString(16).padStart(8, '0')}`);
    }
    if (idx > 0) console.log(`   previous instruction was at 0x${trace[idx - 1].pc.toString(16)}`);
  }
  idx += 1;
};

try { call(entry, m); } catch (e) { console.log('threw:', e.message); }
Machine.prototype.tick = origTick;
if (!reported) console.log(`no divergence in ${Math.min(idx, trace.length)} traced steps`);
