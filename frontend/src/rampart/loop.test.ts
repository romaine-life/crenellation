import { describe, expect, it } from 'vitest';
import { MAX_FRAME_MS, stepAccumulator } from './loop';

// A 20ms step keeps every expectation exact in IEEE-754 (unlike 1000/60,
// where 3 steps sum to 50.00000000000001 and boundary tests go flaky).
const STEP = 20;

describe('stepAccumulator', () => {
  it('emits one step per elapsed step interval and banks the remainder', () => {
    const r = stepAccumulator(0, 50, STEP);
    expect(r.steps).toBe(2);
    expect(r.accMs).toBe(10);
  });

  it('carries the banked remainder into the next frame', () => {
    const first = stepAccumulator(0, 10, STEP);
    expect(first.steps).toBe(0);
    expect(first.accMs).toBe(10);
    const second = stepAccumulator(first.accMs, 10, STEP);
    expect(second.steps).toBe(1);
    expect(second.accMs).toBe(0);
  });

  it('clamps a background-tab resume to MAX_FRAME_MS instead of grinding catch-up ticks', () => {
    const r = stepAccumulator(0, 5 * 60_000, STEP);
    expect(r.steps).toBe(Math.floor(MAX_FRAME_MS / STEP));
    expect(r.accMs).toBe(MAX_FRAME_MS - Math.floor(MAX_FRAME_MS / STEP) * STEP);
  });
});
