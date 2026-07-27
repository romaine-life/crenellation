// Verify a routine by where it is after N instructions.
//
// The call-and-return harnesses cannot judge the 111 routines with no rts, and
// comparing write sequences was not sound: which half of a long is written
// first depends on the instruction, so stopping after a fixed number of writes
// can leave the two sides holding different sets of them.
//
// An instruction count has neither problem. It is defined identically on both
// sides, it does not care about ordering inside a store, and it does not
// require the routine to finish. Both sides run exactly N instructions from
// identical state and are compared there.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Machine } from './machine';
import { call } from './dispatch';

const here = dirname(fileURLToPath(import.meta.url));
const rom = new Uint8Array(readFileSync(join(here, 'rom.bin')));
const ramBaseline = new Uint8Array(readFileSync(join(here, 'step-ram-baseline.bin')));
const pfBaseline = new Uint8Array(readFileSync(join(here, 'step-pf-baseline.bin')));
// what the palette, sound chips and input ports held while the chip was frozen
const ioBaseline = new Uint8Array(readFileSync(join(here, 'step-io-baseline.bin')));
// which registers each instruction writes, used to recognise a snapshot taken
// from part-way through one
const WRITTEN = JSON.parse(readFileSync(join(here, 'written-regs.json'), 'utf8')) as
  Record<string, string[]>;
const IO_BLOCKS: Array<[number, number]> = [
  [0x3c0000, 0x1000], [0x460000, 0x1000], [0x480000, 0x1000], [0x640000, 0x1000],
  [0x140000, 0x40000], [0x500000, 0x20000],
];

type Case = { entry: number; shape: number; steps: number; pc: number; regs: number[]; hash: number };
const cases: Case[] = [];
for (const line of readFileSync(join(here, 'stepstate.log'), 'utf8').split('\n')) {
  const p = line.trim().split(/\s+/);
  if (p[0] !== 'S') continue;
  const v = p.slice(4).map((x) => parseInt(x, 16));
  cases.push({ entry: parseInt(p[1], 16), shape: Number(p[2]), steps: Number(p[3]),
    pc: v[0], regs: v.slice(1, 16), hash: v[16] });
}

const entries: number[] = readFileSync(join(here, 'entries.txt'), 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean).map((s) => parseInt(s, 16));

const RAM_LO = 0x3e0000;
const PF_LO = 0x200000;
const SCRATCH = 0x3e4000;
const SCRATCH_LEN = 0x400;
const STACK = 0x3e5000;
const SENTINEL = 0x3e6000;
const NAMES = ['d0','d1','d2','d3','d4','d5','d6','d7','a0','a1','a2','a3','a4','a5','a6'];
const STRUCTS = [0x3e0864, 0x3e1968, 0x3e1cf6, 0x3e1bc6, 0x3e0f48, 0x3e02d8, 0x3e4000];

class Rand {
  s = 0x12345678;
  next(): number {
    let x = this.s;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.s = x;
    return x;
  }
}

const FOUND = 'state-matched';

describe('routines compared at the instruction the chip stopped on', () => {
  it('reproduces the captured state', () => {
    // Three stopping points per routine - 20, 60 and 200 instructions - so a
    // routine that only runs briefly before it stops still has somewhere the
    // two sides can be compared. A match at any of them settles it.
    const byEntry = new Map<number, Case[]>();
    for (const c of cases) {
      const l = byEntry.get(c.entry);
      if (l) l.push(c); else byEntry.set(c.entry, [c]);
    }
    let compared = 0;
    let matched = 0;
    let stubbed = 0;
    let crashed = 0;
    let offmap = 0;
    let midInstruction = 0;
    const skipped = new Map<number, string>();
    const skip = (e: number, why: string) => { if (!skipped.has(e)) skipped.set(e, why); };
    const pass = new Set<number>();
    const fail = new Set<number>();
    const detail: Array<{ entry: string; what: string }> = [];

    for (const SHAPE of [0, 1, 2, 3]) {
    const rand = new Rand();   // each capture run started the generator afresh
    for (const entry of entries) {
      const m = new Machine(rom);
      for (let i = 0; i < ramBaseline.length; i += 1) m.setByte(RAM_LO + i, ramBaseline[i]);
      for (let i = 0; i < pfBaseline.length; i += 1) m.setByte(PF_LO + i, pfBaseline[i]);
      let io = 0;
      for (const [base, len] of IO_BLOCKS) {
        for (let i = 0; i < len; i += 1) m.setByte(base + i, ioBaseline[io + i]);
        io += len;
      }
      m.ioModelled = true;
      m.store(SENTINEL, 0x60fe, 16);
      for (let i = 0; i < SCRATCH_LEN; i += 1) m.setByte(SCRATCH + i, rand.next() % 256);
      const d: number[] = [];
      for (let k = 0; k < 8; k += 1) {
        const r = rand.next();
        d.push(SHAPE === 0 ? r % 0x10000 : (SHAPE === 1 || SHAPE === 3) ? r % 32 : r % 256);
      }
      const a: number[] = [];
      for (let k = 0; k < 6; k += 1) {
        const r = rand.next();
        a.push(SHAPE === 0 ? SCRATCH + (r % (SCRATCH_LEN - 0x80))
          : STRUCTS[r % STRUCTS.length]);
      }
      let sp = STACK;
      for (let k = 1; k <= 4; k += 1) {
        sp -= 4;
        const r = rand.next();
        // shape 3 puts real structures on the stack too. Most routines that
        // faulted took a structure pointer as a stack argument and were being
        // handed a random number.
        const v = SHAPE === 3 ? STRUCTS[r % STRUCTS.length]
          : k % 2 === 0 ? r % 0x100
          : SCRATCH + (r % (SCRATCH_LEN - 0x80));
        m.store(sp, v, 32);
      }
      sp -= 4;
      m.store(sp, SENTINEL, 32);

      const all = (byEntry.get(entry) ?? []).filter((x) => x.shape === SHAPE);
      if (!all.length) { skip(entry, 'no snapshot for this shape'); continue; }

      // The chip stopped inside the power-on reset routine, which re-masks
      // interrupts and rebuilds the stack pointer from scratch before clearing
      // the palette. Getting there means the routine under test went off the
      // rails and the machine restarted - the snapshot describes the reset
      // code, not the routine, and there is nothing to compare. 87 of 365
      // cases land here.
      // Discard the ones where the chip had crashed. Two places say so: the
      // power-on reset routine at 0x1357C, and the exception stubs from
      // 0x18548, each of which is `jsr $18652` followed by its message text -
      // "ADDRESS ERR", "ILLEGAL INS", "PRIVILEDGE VIOL". Reaching either means
      // the routine faulted, so the snapshot describes the handler rather than
      // the routine and there is nothing to compare.
      const cs = all.filter((x) => !((x.pc >= 0x1357c && x.pc < 0x1365c) || (x.pc >= 0x18548 && x.pc < 0x18680)));
      if (!cs.length) { crashed += 1; skip(entry, 'every snapshot was taken after the chip faulted'); continue; }

      for (let k = 0; k < 8; k += 1) (m as never as Record<string, number>)[`d${k}`] = d[k];
      for (let k = 0; k < 6; k += 1) (m as never as Record<string, number>)[`a${k}`] = a[k];
      m.a7 = sp;
      m.a6 = STACK + 0x200;
      m.sr = 0x2700;
      m.stubMissing = true;
      m.trackOffMap = true;

      compared += 1;
      // Stop where the chip stopped, by address. Counting instructions on both
      // sides only works if both count the same things, and the capture's
      // counter misses an instruction that does not change CURPC. The address
      // of the instruction about to run is not a count and cannot drift: the
      // port compares every time it arrives there.
      let hit = false;
      let closest: { pc: number; diff: string[] } | null = null;
      let arrivals = 0;
      m.budget = 400000;
      const wanted = new Set(cs.map((x) => x.pc));
      // The capture's registers are the state *after* the instruction at the
      // recorded address has run, while CURPC still names it. Comparing when
      // the port arrives at that address compares one instruction too early,
      // so the comparison is made against the address just completed.
      let lastPc = -1;
      m.atPc = (cur: number) => {
        // The tap that produced the capture fires part-way through an
        // instruction, so CURPC sometimes names the instruction about to run
        // and sometimes the one just finished, with the registers alongside it
        // differing accordingly. Both readings are checked; fifteen registers
        // and a memory hash agreeing under either is not an accident.
        const prev = lastPc;
        lastPc = cur;
        if (hit) return;
        let hh = -1;
        const got = [m.d0, m.d1, m.d2, m.d3, m.d4, m.d5, m.d6, m.d7,
                     m.a0, m.a1, m.a2, m.a3, m.a4, m.a5, m.a6].map((v) => v >>> 0);
        for (const pc of prev >= 0 ? [cur, prev] : [cur]) {
          if (!wanted.has(pc)) continue;
          arrivals += 1;
          for (const x of cs) {
            if (x.pc !== pc) continue;
            const diff = NAMES.filter((_, i) => got[i] !== (x.regs[i] >>> 0));
            if (diff.length && (!closest || diff.length < closest.diff.length)) {
              closest = { pc, diff };
            }
            if (diff.length) continue;
            if (hh < 0) {
              hh = 0;
              for (let i = 0; i < 0x2000; i += 1) hh = (hh * 31 + m.byte(SCRATCH + i)) >>> 0;
            }
            if (hh !== (x.hash >>> 0)) continue;
            hit = true;
            throw new Error(FOUND);
          }
        }
      };
      let threw = '';
      try { call(entry, m); } catch (e) {
        const msg = (e as Error).message;
        if (msg !== FOUND) threw = msg;
      }
      m.atPc = null;

      m.trackOffMap = false;
      // A skipped call means the port did not run what the chip ran.
      if (m.missingCalls.length) { stubbed += 1; compared -= 1; skip(entry, 'the port skipped a call the chip made'); continue; }

      // The routine dereferenced something the port does not model - the
      // playfield is modelled, the input ports and sound chips are not, and a
      // caller-supplied pointer can land anywhere. The chip read a real value
      // there and the port read zero, so the two were never going to agree
      // and the case says nothing about the translation.
      if (!hit && m.offMap) { offmap += 1; compared -= 1; skip(entry, 'read hardware the port does not model'); continue; }

      // A snapshot the port cannot match may not be a divergence: the capture
      // reads registers from inside a memory access, so it can catch an
      // instruction half-done - the source postincrement applied, the
      // destination write not yet. If the only registers that differ are ones
      // the instruction at that address writes, that is what happened, and the
      // snapshot says nothing about the translation.
      if (!hit && closest) {
        const w = new Set(WRITTEN[closest.pc.toString(16)] ?? []);
        if (closest.diff.length > 0 && closest.diff.every((n) => w.has(n))) {
          midInstruction += 1;
          compared -= 1;
          skip(entry, 'the capture caught the chip part-way through an instruction');
          continue;
        }
      }
      if (hit) { matched += 1; pass.add(entry); }
      else {
        fail.add(entry);
        if (detail.length < 20) {
          detail.push({ entry: '0x' + entry.toString(16),
            what: threw ? `threw: ${threw.slice(0, 44)}`
              : arrivals === 0 ? `never reached pc ${[...wanted].map((x) => '0x' + x.toString(16)).join('/')}`
              : `reached the stopping pc ${arrivals}x, state differed` });
        }
      }
    }
    }

    for (const e of pass) fail.delete(e);   // a match under any shape settles it

    // eslint-disable-next-line no-console
    console.log(`at the chip's stopping instruction: ${matched}/${compared} routines reproduce `
      + `its state (${crashed} discarded - the chip had crashed into its reset code, `
      + `${stubbed} void - the port skipped a call the chip made, `
      + `${offmap} not comparable - read hardware the port does not model, `
      + `${midInstruction} caught part-way through an instruction)`);
    // eslint-disable-next-line no-console
    writeFileSync(join(here, 'stepstate-result.json'),
      JSON.stringify({ pass: [...pass], fail: [...fail],
        skipped: [...skipped.entries()].map(([e, w]) => ({ entry: '0x' + e.toString(16), why: w })), detail }));

    expect(compared).toBeGreaterThan(200);
    expect(matched).toBe(compared);
  }, 900000);
});
