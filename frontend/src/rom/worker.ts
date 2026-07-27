// The machine, running in a worker.
//
// `System.run` does not return - the game's main loop does not, and the port
// mirrors the 68000's call stack in JavaScript's, so there is no point to
// unwind to and resume from. That is fine in a worker and impossible on the
// main thread: the worker blocks, the page does not.
//
// Because the worker never gets back to its event loop, it cannot receive
// postMessage while the machine runs. Input and the frame counter therefore
// go through shared memory, which the worker reads at each frame boundary.

import { System, SCREEN_W, SCREEN_H } from './system';

/** Shared control words, by index. */
export const CTRL_FRAME = 0;    // frame counter, bumped when pixels are fresh
export const CTRL_IN0 = 1;      // the four input-port bytes, packed
export const CTRL_WAIT = 2;     // never written; Atomics.wait parks on it
export const CTRL_STEPS = 3;    // instructions run, for the readout
export const CTRL_TRACK = 4;    // trackball direction, two signed bytes packed
export const CTRL_WORDS = 5;

export type StartMessage = {
  rom: ArrayBuffer;
  board: ArrayBuffer;
  ctrl: SharedArrayBuffer;
  pixels: SharedArrayBuffer;
};

const FRAME_MS = 1000 / 60;

self.onmessage = (ev: MessageEvent<StartMessage>) => {
  const { rom, board, ctrl, pixels } = ev.data;
  const c = new Int32Array(ctrl);
  const px = new Uint32Array(pixels);
  const sys = new System(new Uint8Array(rom), new Uint8Array(board));

  // Idle is every bit high - a button reads clear only while it is held. Bit 3
  // of the first byte is not a button and the System drives it itself, so it
  // must not be cleared here: 0xff7fffff, which is what this used to be, holds
  // bit 7 of the second byte down for ever.
  const IDLE = 0xffffffff | 0;
  Atomics.store(c, CTRL_IN0, IDLE);

  const started = performance.now();
  try {
    sys.run((s) => {
      const packed = Atomics.load(c, CTRL_IN0);
      sys.inputs[0] = (packed >>> 24) & 0xff;
      sys.inputs[1] = (packed >>> 16) & 0xff;
      sys.inputs[2] = (packed >>> 8) & 0xff;
      sys.inputs[3] = packed & 0xff;

      // The trackball is a free-running counter the game differences between
      // frames, so a held arrow key steps it rather than setting it.
      const dir = Atomics.load(c, CTRL_TRACK);
      const dx = (dir << 24) >> 24;
      const dy = (dir << 16) >> 24;
      if (dx) sys.track[0] = (sys.track[0] + dx * 3) & 0xff;
      if (dy) sys.track[1] = (sys.track[1] + dy * 3) & 0xff;

      s.screen(px);
      Atomics.store(c, CTRL_STEPS, s.m.steps | 0);
      Atomics.store(c, CTRL_FRAME, s.frames);

      // Pace to the screen. Atomics.wait parks the thread properly rather
      // than spinning on the clock, and nothing ever writes CTRL_WAIT, so it
      // always waits out the whole timeout.
      const behind = started + s.frames * FRAME_MS - performance.now();
      if (behind > 1) Atomics.wait(c, CTRL_WAIT, 0, behind);
    });
  } catch (e) {
    self.postMessage({ stopped: (e as Error).message, frames: sys.frames });
  }
};

export { SCREEN_W, SCREEN_H };
