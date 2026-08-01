// The board: the ported CPU plus the hardware around it.
//
// Every harness so far called one routine with arguments invented for it. This
// starts where the chip starts - stack pointer and program counter from the
// first eight bytes of ROM - and runs. The routines were verified one at a
// time; this is what says whether they compose.
//
// The main loop never returns, because a game's main loop never does. It waits
// on a flag the frame interrupt sets. So `run` does not return either: it calls
// back once per frame, from inside the machine, and the caller draws.

import { Machine, PendingInterrupt } from './machine';
import { call, bind } from './decompiled';

/** Playfield bitmap: one byte per pixel, 512 across, 256 down. */
export const PF_BASE = 0x200000;
export const PF_STRIDE = 512;
export const PF_ROWS = 256;

/** What the monitor actually shows out of that. */
export const SCREEN_W = 336;
export const SCREEN_H = 240;

/** Palette: 1024 entries, one word each, IRGB in 1-5-5-5. */
export const PAL_BASE = 0x3c0000;
export const PAL_ENTRIES = 1024;

/** Watchdog. The game kicks it constantly; nothing here needs to care, but
 *  reads and writes must not be treated as off-map. */
export const WATCHDOG = 0x72fffe;

/** Input ports. Active low - a bit is 0 while its button is held. */
export const IN0 = 0x640000;
export const IN1 = 0x640002;

/**
 * A frame's worth of instructions.
 *
 * The board runs a 7 MHz 68000 and asserts the interrupt at 60 Hz, so a frame
 * is roughly this many instructions. It does not have to be exact - the game
 * waits for the interrupt rather than counting - but too few and it never
 * finishes its work, too many and it idles in the wait loop.
 */
export const INSTRUCTIONS_PER_FRAME = 5_454;

/**
 * Cycles in a frame: a 7.16 MHz 68000 against a 60 Hz screen. This is what
 * paces the interrupt now - the chip interrupts on wall clock, and an
 * instruction count drifts from that because instructions differ so widely in
 * cost.
 */
export const CYCLES_PER_FRAME = 119_318;

export class System {
  readonly m: Machine;

  /** Input port bytes, as the board would present them: 0 means held. */
  // Read from the board rather than assumed. 0x640000 comes back as 0xF7 with
  // bit 3 clear, not 0xFF: the frame handler does  on it and takes a
  // branch the port was never taking, which is where the two boot paths first
  // parted company.
  readonly inputs = new Uint8Array([0xf7, 0xff, 0xff, 0xff]);

  /**
   * The trackball counters, one per axis per station. The game reads these as
   * free-running counters and works on the difference between frames, so
   * moving the cursor means stepping one of them, not holding a value.
   */
  readonly track = new Uint8Array(8);

  frames = 0;
  private statusToggle = 0;
  /** Cycles at which the last frame boundary was crossed. Diagnostic. */
  crossedAt = 0;

  /** Cycles to shift the first interrupt by. */
  irqPhase = 0;
  /** Set to drive interrupts from an external schedule. */
  pacedIrq: ((steps: number) => boolean) | null = null;

  /**
   * Where the board's read-only data sits, and where each block starts in the
   * capture. These are not devices: they are decoded regions the game reads
   * real data out of, and the read probe found them only because it looked for
   * reads - a write probe finds memory and misses every read-only decode.
   * Without them the sound driver decodes zeros, hands back -1, and the game
   * requeues the same sound for ever.
   */
  static readonly BOARD_DATA: ReadonlyArray<{ at: number; from: number; len: number }> = [
    { at: 0x140000, from: 0x04000, len: 0x40000 },
    { at: 0x500000, from: 0x44000, len: 0x20000 },
  ];

  constructor(rom: Uint8Array, board?: Uint8Array) {
    this.m = new Machine(rom);
    if (board) {
      for (const b of System.BOARD_DATA) {
        for (let i = 0; i < b.len; i += 1) this.m.setByte(b.at + i, board[b.from + i]);
      }
    }
    // the devices below are all real memory or handled reads, so nothing here
    // is "off the map"
    this.m.ioModelled = true;
    this.m.sound = true;
    this.m.budget = Number.MAX_SAFE_INTEGER;
    this.m.trackAt = (addr: number): number => this.track[addr & 7];
    this.m.inputAt = (addr: number): number => {
      const b = this.inputs[(addr - IN0) & 3];
      // Bit 3 of the first byte is not a button. On the board it reads clear
      // most of the time and set some of the time, changing between two reads
      // in the same frame, and the frame handler branches on it - so both
      // paths are real and a constant value takes only one of them.
      if (((addr - IN0) & 3) === 0) {
        // Bit 3 reads set. It is not a button - it is the status the frame
        // handler branches on, and the branch decides whether the frame's work
        // happens at all.
        //
        // This used to alternate, one read in eight set, with a comment saying
        // it was "not a model of anything" but got furthest. It got furthest
        // because the correct value sent the game into a routine the port did
        // not have, and dying looked worse than crawling. With 0x71C4 ported,
        // holding it set is unambiguous: the game's per-frame work runs 1.000
        // times per frame, where alternating gave 0.134 - which is the entire
        // reason the game ran seven and a half times too slowly and no round
        // was ever seen finishing.
        return b | 0x08;
      }
      return b;
    };
  }

  /** Stack pointer and program counter, exactly as the chip takes them. */
  reset(): number {
    const rom = this.m.rom;
    const sp = ((rom[0] << 24) | (rom[1] << 16) | (rom[2] << 8) | rom[3]) >>> 0;
    const pc = ((rom[4] << 24) | (rom[5] << 16) | (rom[6] << 8) | rom[7]) >>> 0;
    this.m.a7 = sp;
    this.m.sr = 0x2700;
    return pc;
  }

  /**
   * Run the machine. Does not return: the game's main loop does not.
   * `onFrame` is called from inside it, once per frame's worth of work.
   */
  run(onFrame: (sys: System) => void, entry: (addr: number, m: Machine) => void = call): void {
    const pc = this.reset();
    this.m.wakeOnIrq = true;
    const m = this.m;
    // The first interrupt's phase. The board's own phase is not special - the
    // game has to work at any of them - so if the port stalls at every offset
    // the stall is not timing.
    let next = CYCLES_PER_FRAME + this.irqPhase;
    m.atPc = (pc: number) => {
      if (this.m.atPcExtra) this.m.atPcExtra(pc);
      // a caller can take over the timing entirely, to deliver interrupts
      // where the chip delivered them rather than on a schedule of our own
      if (this.pacedIrq) {
        if (this.pacedIrq(m.steps)) { this.frames += 1; m.irqPending = 4; onFrame(this); }
        return;
      }
      // Tested where the interrupt may be taken, not everywhere. The
      // recompiled dispatcher calls this once per instruction and the
      // decompiled one once per block, so inside a two-instruction wait the
      // recompiled sees the threshold crossed half an iteration sooner and
      // leaves the wait first - which is how the sound driver's spin ended
      // forty-four iterations apart in the two runs. pollAt is set only by the
      // comparisons; with it null this is every instruction, as the chip is.
      if (m.pollAt !== null && !m.pollAt.has(pc)) return;
      if (m.cycles < next) return;
      next = m.cycles + CYCLES_PER_FRAME;
      this.frames += 1;
      // The cycle count at which this frame boundary was actually decided.
      // A hook that runs before this test sees the poll AFTER the crossing,
      // which is a different quantity and differs between runs even when the
      // schedule is identical - so read it here or not at all.
      this.crossedAt = m.cycles;
      m.irqPending = 4;      // taken at the next instruction boundary
      onFrame(this);
    };
    bind(m);
    entry(pc, m);
  }

  /** The palette as packed RGBA, ready to index with a playfield byte. */
  palette(): Uint32Array {
    const out = new Uint32Array(PAL_ENTRIES);
    for (let i = 0; i < PAL_ENTRIES; i += 1) {
      // One entry spans two 16-bit slots, not one. The palette RAM is byte-wide
      // on a 16-bit bus - every odd byte reads back zero, on the board as well
      // as here - so the sixteen bits of a colour arrive as the high bytes of
      // two consecutive words, four bytes apart. Reading it as a single word at
      // stride two takes the right red and the wrong green and blue, which
      // looks like a plausible picture in the wrong colours rather than like a
      // fault, and it drew every screenshot in this repo until now.
      const w = (this.m.byte(PAL_BASE + i * 4) << 8) | this.m.byte(PAL_BASE + i * 4 + 2);
      // IRGB 1-5-5-5: the intensity bit is a sixth low bit shared by all three
      // channels, and MAME expands each six-bit value as (x << 2) | (x >> 4)
      const inten = (w >> 15) & 1;
      const r = (((w >> 10) & 0x1f) << 1) | inten;
      const g = (((w >> 5) & 0x1f) << 1) | inten;
      const b = ((w & 0x1f) << 1) | inten;
      const e = (v: number) => ((v << 2) | (v >> 4)) & 0xff;
      out[i] = (0xff << 24) | (e(b) << 16) | (e(g) << 8) | e(r);
    }
    return out;
  }

  /** The visible screen as RGBA, one word per pixel. */
  screen(into?: Uint32Array): Uint32Array {
    const out = into ?? new Uint32Array(SCREEN_W * SCREEN_H);
    const pal = this.palette();
    for (let y = 0; y < SCREEN_H; y += 1) {
      const row = PF_BASE + y * PF_STRIDE;
      for (let x = 0; x < SCREEN_W; x += 1) {
        out[y * SCREEN_W + x] = pal[this.m.byte(row + x)];
      }
    }
    return out;
  }
}
