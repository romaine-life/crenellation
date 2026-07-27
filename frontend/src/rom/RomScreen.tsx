// The game, running on the ported ROM.
//
// Nothing here knows anything about Rampart. It starts the machine, shows the
// bytes the ROM writes into the playfield, and hands it the keyboard. Every
// rule of the game is in the ROM.

import { useEffect, useRef, useState } from 'react';

import romUrl from './rom.bin?url';
import boardUrl from './io-baseline.bin?url';
import { CTRL_FRAME, CTRL_IN0, CTRL_STEPS, CTRL_WORDS } from './worker';

const SCREEN_W = 336;
const SCREEN_H = 240;

/**
 * Which input bit each key holds low.
 *
 * The board presents the ports active-low: a bit reads clear while its button
 * is held. Nothing here was guessed - each was found by running the machine
 * twice from the same boot, once idle and once holding the bit, and comparing
 * the screen. Only these bits change what the game shows.
 *
 *   byte 3 bits 0-2   the three coin slots
 *   byte 0/1/2 bit 0  each player station's first button
 *   byte 0/1/2 bit 1  each player station's second button
 *   byte 2 bit 3      service; holding it takes the machine back through reset
 *
 * Byte 0 bit 0 is the middle station: pressing it at the join screen is what
 * puts RED PLAYER into PLEASE WAIT.
 */
const KEYS: Record<string, [byte: number, bit: number]> = {
  Digit5: [3, 0],      // coin
  Digit6: [3, 1],      // second coin slot
  KeyZ: [0, 0],        // middle station, button one - joins as red
  KeyX: [0, 1],        // middle station, button two
  KeyA: [1, 0],        // left station
  KeyS: [1, 1],
  KeyK: [2, 0],        // right station
  KeyL: [2, 1],
  F2: [2, 3],          // service
};

export function Rampart() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [note, setNote] = useState<string>('starting the machine…');

  useEffect(() => {
    if (typeof SharedArrayBuffer === 'undefined') {
      setNote('This page has to be cross-origin isolated to run the machine: '
        + 'the worker blocks while the game runs, so input and pixels go '
        + 'through shared memory. The server sends the COOP and COEP headers '
        + 'for that - a stale cache or a proxy stripping them will land here.');
      return;
    }

    const ctrl = new SharedArrayBuffer(CTRL_WORDS * 4);
    const pixels = new SharedArrayBuffer(SCREEN_W * SCREEN_H * 4);
    const c = new Int32Array(ctrl);
    const px = new Uint32Array(pixels);
    let worker: Worker | null = null;
    let raf = 0;
    let done = false;

    (async () => {
      const [rom, board] = await Promise.all([
        fetch(romUrl).then((r) => r.arrayBuffer()),
        fetch(boardUrl).then((r) => r.arrayBuffer()),
      ]);
      if (done) return;

      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onerror = (e) => { setNote(`worker failed: ${e.message}`); };
      worker.onmessage = (ev: MessageEvent<{ stopped?: string; frames?: number }>) => {
        if (ev.data.stopped) setNote(`the machine stopped after ${ev.data.frames} frames: ${ev.data.stopped}`);
      };
      worker.postMessage({ rom, board, ctrl, pixels }, [rom, board]);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx) { setNote('no canvas context'); return; }
      const image = ctx.createImageData(SCREEN_W, SCREEN_H);
      const words = new Uint32Array(image.data.buffer);
      let shown = -1;

      const tick = (): void => {
        const frame = Atomics.load(c, CTRL_FRAME);
        if (frame !== shown) {
          shown = frame;
          words.set(px);
          ctx.putImageData(image, 0, 0);
          if (frame % 30 === 0) {
            setNote(`frame ${frame} · ${(Atomics.load(c, CTRL_STEPS) / 1e6).toFixed(1)}M instructions`);
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    // Active-low: holding a key clears its bit. The four port bytes are packed
    // into one word so a single atomic write is always a consistent snapshot.
    const set = (code: string, held: boolean): void => {
      const m = KEYS[code];
      if (!m) return;
      const shift = (3 - m[0]) * 8 + m[1];
      const was = Atomics.load(c, CTRL_IN0);
      Atomics.store(c, CTRL_IN0, held ? (was & ~(1 << shift)) : (was | (1 << shift)));
    };
    const down = (e: KeyboardEvent): void => { if (KEYS[e.code]) { e.preventDefault(); set(e.code, true); } };
    const up = (e: KeyboardEvent): void => { if (KEYS[e.code]) { e.preventDefault(); set(e.code, false); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);

    return () => {
      done = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      worker?.terminate();
    };
  }, []);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
      padding: 24, minHeight: '100vh', background: '#000',
    }}>
      <canvas
        ref={canvasRef}
        width={SCREEN_W}
        height={SCREEN_H}
        style={{
          width: 'min(100%, 1008px)', aspectRatio: `${SCREEN_W} / ${SCREEN_H}`,
          imageRendering: 'pixelated', border: '1px solid #222',
        }}
      />
      <div style={{ color: '#666', fontFamily: 'monospace', fontSize: 12, textAlign: 'center', maxWidth: 640 }}>
        {note}
      </div>
      <div style={{ color: '#444', fontFamily: 'monospace', fontSize: 11 }}>
        5 coin · 1 start · arrows · Z X space
      </div>
    </div>
  );
}

export default Rampart;
