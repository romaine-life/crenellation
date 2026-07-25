import { describe, expect, it } from 'vitest';
import {
  applyDeadzone,
  claimPads,
  createRepeater,
  justPressed,
  stepRepeater,
  type PadSnapshot,
} from './input';

function pad(index: number, buttons: number[] = [], axes: [number, number] = [0, 0]): PadSnapshot {
  const b = Array.from({ length: 17 }, () => false);
  for (const i of buttons) b[i] = true;
  return { index, axes, buttons: b };
}

describe('applyDeadzone', () => {
  it('zeroes drift inside the radial deadzone and passes real deflection through', () => {
    expect(applyDeadzone(0.05, -0.08, 0.2)).toEqual([0, 0]);
    expect(applyDeadzone(0.7, 0.1, 0.2)).toEqual([0.7, 0.1]);
  });
});

describe('justPressed', () => {
  it('fires only on the frame a button goes down', () => {
    expect(justPressed(pad(0), pad(0, [0]), 0)).toBe(true);
    expect(justPressed(pad(0, [0]), pad(0, [0]), 0)).toBe(false);
    expect(justPressed(pad(0, [0]), pad(0), 0)).toBe(false);
    expect(justPressed(null, pad(0, [0]), 0)).toBe(true);
  });
});

describe('stepRepeater', () => {
  it('steps once immediately, repeats after the delay, then at the interval', () => {
    const r = createRepeater();
    expect(stepRepeater(r, 1, 0, 16, 220, 55)).toBe(1);
    // 13 held ticks x 16ms = 208ms — still inside the 220ms delay window.
    let steps = 0;
    for (let i = 0; i < 13; i += 1) steps += stepRepeater(r, 1, 0, 16, 220, 55);
    expect(steps).toBe(0);
    // 14th tick crosses 220ms -> first repeat; +55ms -> next repeat.
    expect(stepRepeater(r, 1, 0, 16, 220, 55)).toBe(1);
    expect(stepRepeater(r, 1, 0, 55, 220, 55)).toBe(1);
  });

  it('resets the delay on direction change so taps stay precise', () => {
    const r = createRepeater();
    stepRepeater(r, 1, 0, 16, 220, 55);
    expect(stepRepeater(r, 0, 1, 16, 220, 55)).toBe(1);
    expect(stepRepeater(r, 0, 1, 100, 220, 55)).toBe(0);
  });

  it('emits nothing while centred', () => {
    const r = createRepeater();
    expect(stepRepeater(r, 0, 0, 16, 220, 55)).toBe(0);
    expect(stepRepeater(r, 0, 0, 1000, 220, 55)).toBe(0);
  });
});

describe('claimPads', () => {
  it('assigns the first button-pressing pad to the first free seat, once', () => {
    let claimed: (number | null)[] = [null, null];
    claimed = claimPads(claimed, [pad(0), null]);
    expect(claimed).toEqual([null, null]);
    claimed = claimPads(claimed, [pad(0, [0]), null]);
    expect(claimed).toEqual([0, null]);
    claimed = claimPads(claimed, [pad(0, [0]), pad(1, [3])]);
    expect(claimed).toEqual([0, 1]);
    claimed = claimPads(claimed, [pad(0, [0]), pad(1, [3])]);
    expect(claimed).toEqual([0, 1]);
  });

  it('ignores extra pads once both seats are taken', () => {
    const claimed = claimPads([0, 1], [pad(0), pad(1), pad(2, [0])]);
    expect(claimed).toEqual([0, 1]);
  });
});
