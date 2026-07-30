// Trace one diverging routine both ways and name the first differing state.
//
// decomp.test.ts says WHICH routine differs and in what register at the end;
// this says WHERE along the way the two runs part. Same setup, same seed,
// but every tick's registers are recorded from both sides and the streams
// are aligned: the lifted side ticks per block, so its stream is a
// subsequence of the oracle's per-instruction stream. The first lifted
// snapshot with no match in the oracle's stream from the current position
// names the block where the wheels came off.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Machine } from './machine';
import { call } from './dispatch';
import { call as viaDecompiled, bind, DECOMPILED, useCallee } from './decompiled';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const ramBaseline = new Uint8Array(readFileSync(join(here, 'ram-baseline.bin')));

const RAM_LO = 0x3e0000;
const SCRATCH = 0x3e4000;
const SCRATCH_LEN = 0x400;
const STACK = 0x3e5000;
const SENTINEL = 0x3e7000;
const ENTRY = Number(process.env.TRACE_ENTRY ?? '0x19786');
const TRIAL = Number(process.env.TRACE_TRIAL ?? '0');

function fresh(seed: number): Machine {
  const m = new Machine(rom);
  for (let i = 0; i < ramBaseline.length; i += 1) m.setByte(RAM_LO + i, ramBaseline[i]);
  let s = seed >>> 0;
  const next = (): number => {
    s = (s ^ (s << 13)) >>> 0; s = (s ^ (s >>> 17)) >>> 0; s = (s ^ (s << 5)) >>> 0;
    return s;
  };
  for (let i = 0; i < SCRATCH_LEN; i += 1) m.setByte(SCRATCH + i, (next() % 256) & 0xfe);
  for (let k = 0; k < 7; k += 1) {
    (m as never as Record<string, number>)[`a${k}`] = SCRATCH + (next() % 0x100) * 2;
  }
  m.budget = 200_000;
  return m;
}

function valueFor(i: number, seed: number): number {
  let s = (seed + i * 2654435761) >>> 0;
  s = (s ^ (s << 13)) >>> 0; s = (s ^ (s >>> 17)) >>> 0; s = (s ^ (s << 5)) >>> 0;
  return SCRATCH + 0x200 + (s % 0x40) * 8;
}

// The state handed to a callee, at the moment control enters it: the
// registers the chip's calling convention uses plus the top of the
// stack. Two runs that reach the same callee with the same inputs
// cannot behave differently, so a difference here localises the fault
// to the caller rather than the callee.
const AT = Number(process.env.TRACE_AT ?? '0');
function atCall(m: Machine): string {
  const regs = [m.d0, m.d1, m.d2, m.d3, m.a0, m.a1, m.a2, m.a3, m.a6]
    .map((v) => (v >>> 0).toString(16)).join(' ');
  const stack = [0, 4, 8, 12, 16, 20].map((o) =>
    (m.load((m.a7 + o) >>> 0, 32) >>> 0).toString(16)).join(' ');
  return `a7=${(m.a7 >>> 0).toString(16)} regs[${regs}] stack[${stack}]`;
}

type Snap = { pc: number; regs: string };
function snap(m: Machine, pc: number): Snap {
  const r = [m.d0, m.d1, m.d2, m.d3, m.d4, m.d5, m.d6, m.d7, m.a7]
    .map((v) => (v >>> 0).toString(16)).join(' ');
  return { pc, regs: r };
}

describe('trace one routine', () => {
  it('finds the first diverging block', () => {
    const row = DECOMPILED.find((d) => d.at === ENTRY);
    expect(row).toBeTruthy();
    const params = row!.params;
    const seed = (0x1234567 + TRIAL * 7919 + ENTRY) >>> 0;
    const args = params.map((_, i) => valueFor(i, seed));

    const setup = (m: Machine): void => {
      const stack = params.map((p, i) => ({ p, v: args[i] }))
        .filter((x) => x.p.from === 'stack');
      const sp = STACK - 0x40;
      m.a7 = sp;
      m.store(sp, SENTINEL, 32);
      for (const { p, v } of stack) m.store(sp + (p as never as { off: number }).off, v, 32);
      m.store(SENTINEL, 0x4e75, 16);
      params.forEach((p, i) => {
        if (p.from !== 'reg') return;
        (m as never as Record<string, number>)[(p as never as { name: string }).name] = args[i];
      });
      m.stubMissing = true;
    };

    const a = fresh(seed); setup(a);
    const oracle: Snap[] = [];
    let oracleAt = '';
    a.atPc = (pc: number) => {
      if (oracle.length < 30000) oracle.push(snap(a, pc));
      if (AT && pc === AT && !oracleAt) oracleAt = atCall(a);
    };
    try { call(ENTRY, a); } catch { /* budget or wild - the trace matters */ }
    a.atPc = null;

    const b = fresh(seed); setup(b);
    // Same isolation decomp.test uses: calls out of the routine under
    // test go to the recompiled callee, so a divergence here is this
    // routine's and not something it reached.
    useCallee(call);
    const lifted: Snap[] = [];
    // Where the machine stopped, and the last few addresses before it: a
    // `stop` is the one event that ends a run without returning, and knowing
    // which routine executed it is the difference between "the lift is wrong"
    // and "the lift took a path the chip did not".
    let stopAt = -1;
    let liftedAt = '';
    const recent: number[] = [];
    b.atPc = (pc: number) => {
      if (lifted.length < 30000) lifted.push(snap(b, pc));
      recent.push(pc);
      if (recent.length > 8) recent.shift();
      if (stopAt < 0 && b.stopped) stopAt = pc;
      if (AT && pc === AT && !liftedAt) liftedAt = atCall(b);
    };
    bind(b);
    let liftedThrew = '';
    try { viaDecompiled(ENTRY, b); } catch (e) { liftedThrew = (e as Error).message; }
    b.atPc = null;

    // subsequence alignment: each lifted snapshot must appear in the oracle
    // stream at or after the previous match
    let oi = 0;
    let verdict = `aligned all ${lifted.length} lifted snapshots against ${oracle.length} oracle ticks`;
    for (let li = 0; li < lifted.length; li += 1) {
      let found = -1;
      for (let k = oi; k < oracle.length; k += 1) {
        if (oracle[k].regs === lifted[li].regs) { found = k; break; }
      }
      if (found < 0) {
        const prev = li > 0 ? lifted[li - 1] : null;
        verdict = [
          `lifted snapshot ${li} has no oracle match from oracle[${oi}] on`,
          `  previous match: ${prev ? prev.regs : '(start)'}`,
          `  lifted now:     ${lifted[li].regs}`,
          `  oracle[${oi}]:    ${oracle[oi] ? oracle[oi].regs : '(end)'}`,
          `  oracle[${oi}+1]:  ${oracle[oi + 1] ? oracle[oi + 1].regs : '(end)'}`,
          `  oracle pc at ${oi}: 0x${oracle[oi] ? oracle[oi].pc.toString(16) : '?'}`,
        ].join('\n');
        break;
      }
      oi = found;
    }
    // The lifted world keeps its registers in JavaScript locals until
    // something flushes them, so an intermediate snapshot of the machine says
    // nothing about it. What is comparable is the state after the run - both
    // sides have flushed by then - plus whether either stopped and which
    // calls each skipped, which is where two runs of the same routine part
    // for reasons that are about the harness rather than the lifting.
    const after = (m: Machine): string =>
      [m.d0, m.d1, m.d2, m.d3, m.a0, m.a1, m.a2, m.a7]
        .map((v) => (v >>> 0).toString(16)).join(' ')
      + ` stopped=${m.stopped} missing=${m.missingCalls.length}`
      + ` fault=0x${(m.faultAddr >>> 0).toString(16)}`;
    const post = `after oracle: ${after(a)}\nafter lifted: ${after(b)}\n`
      + (b.stopped
        ? `lifted stopped at 0x${stopAt.toString(16)}; last pcs `
          + `${recent.map((p) => p.toString(16)).join(' ')}\n`
        : '');

    const dump = process.env.TRACE_DUMP === '1'
      ? '\n-- oracle stream --\n'
        + oracle.slice(0, 40).map((s, i) => `${i}: pc=0x${s.pc.toString(16)} ${s.regs}`).join('\n')
        + '\n-- lifted stream --\n'
        + lifted.slice(0, 40).map((s, i) => `${i}: pc=0x${s.pc.toString(16)} ${s.regs}`).join('\n')
      : '';
    writeFileSync(join(here, 'trace-one.txt'),
      `entry 0x${ENTRY.toString(16)} trial ${TRIAL}\n${verdict}\n`
      + (liftedThrew ? `lifted threw: ${liftedThrew}\n` : '')
      + post
      + (AT ? `at 0x${AT.toString(16)} oracle: ${oracleAt || '(never reached)'}
`
        + `at 0x${AT.toString(16)} lifted: ${liftedAt || '(never reached)'}
` : '')
      + dump);
    expect(true).toBe(true);
  }, 900000);
});
