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
import { call } from './dispatch';

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
export const INSTRUCTIONS_PER_FRAME = 20_000;

export class System {
  readonly m: Machine;

  /** Input port bytes, as the board would present them: 0 means held. */
  // Read from the board rather than assumed. 0x640000 comes back as 0xF7 with
  // bit 3 clear, not 0xFF: the frame handler does  on it and takes a
  // branch the port was never taking, which is where the two boot paths first
  // parted company.
  readonly inputs = new Uint8Array([0xf7, 0xff, 0xff, 0xff]);

  frames = 0;
  private statusToggle = 0;

  constructor(rom: Uint8Array) {
    this.m = new Machine(rom);
    // the devices below are all real memory or handled reads, so nothing here
    // is "off the map"
    this.m.ioModelled = true;
    this.m.sound = true;
    this.m.budget = Number.MAX_SAFE_INTEGER;
    this.m.inputAt = (addr: number): number => {
      const b = this.inputs[(addr - IN0) & 3];
      // Bit 3 of the first byte is not a button. On the board it reads clear
      // most of the time and set some of the time, changing between two reads
      // in the same frame, and the frame handler branches on it - so both
      // paths are real and a constant value takes only one of them.
      if (((addr - IN0) & 3) === 0) {
        this.statusToggle += 1;
        return this.statusToggle % 8 === 0 ? b | 0x08 : b & ~0x08;
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
  run(onFrame: (sys: System) => void): void {
    const pc = this.reset();
    const m = this.m;
    let next = INSTRUCTIONS_PER_FRAME;
    m.atPc = (pc: number) => {
      if (this.m.atPcExtra) this.m.atPcExtra(pc);
      if (m.steps < next) return;
      next = m.steps + INSTRUCTIONS_PER_FRAME;
      this.frames += 1;
      m.irqPending = 4;      // taken at the next instruction boundary
      onFrame(this);
    };
    call(pc, m);
  }

  /** The palette as packed RGBA, ready to index with a playfield byte. */
  palette(): Uint32Array {
    const out = new Uint32Array(PAL_ENTRIES);
    for (let i = 0; i < PAL_ENTRIES; i += 1) {
      const w = this.m.load(PAL_BASE + i * 2, 16);
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
