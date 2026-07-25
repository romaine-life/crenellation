// Gamepad input for two players on one machine. The Gamepad API is poll-only:
// each simulation tick snapshots every connected pad, and everything above the
// raw snapshot (deadzone, edge detection, hold-to-repeat, pad claiming) is a
// pure function over snapshots so it unit-tests without a browser.

export interface PadSnapshot {
  index: number;
  axes: [number, number];
  buttons: boolean[];
}

export const DEADZONE = 0.2;

// Standard-mapping button indices (Xbox/PS pads on every desktop browser).
export const BTN_A = 0;
export const BTN_B = 1;
export const DPAD_UP = 12;
export const DPAD_DOWN = 13;
export const DPAD_LEFT = 14;
export const DPAD_RIGHT = 15;

export function snapshotPads(): (PadSnapshot | null)[] {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  return Array.from(pads, (p) =>
    p
      ? {
          index: p.index,
          axes: [p.axes[0] ?? 0, p.axes[1] ?? 0] as [number, number],
          buttons: p.buttons.map((b) => b.pressed),
        }
      : null,
  );
}

// Radial deadzone: a stick resting slightly off-centre reads as centred;
// outside the circle the vector passes through untouched.
export function applyDeadzone(x: number, y: number, dz: number = DEADZONE): [number, number] {
  return Math.hypot(x, y) < dz ? [0, 0] : [x, y];
}

export function justPressed(prev: PadSnapshot | null, curr: PadSnapshot | null, button: number): boolean {
  const was = prev?.buttons[button] ?? false;
  const is = curr?.buttons[button] ?? false;
  return is && !was;
}

// Hold-to-repeat for grid cursors (the Tetris DAS shape): one step the moment
// a direction is pressed, the first repeat after delayMs, then one every
// intervalMs while held. Any direction change resets the delay so taps stay
// precise under time pressure — the rebuild phase lives or dies on this feel.
export const REPEAT_DELAY_MS = 220;
export const REPEAT_INTERVAL_MS = 55;

export interface Repeater {
  dirX: number;
  dirY: number;
  heldMs: number;
  repeatsEmitted: number;
}

export function createRepeater(): Repeater {
  return { dirX: 0, dirY: 0, heldMs: 0, repeatsEmitted: 0 };
}

export function stepRepeater(
  r: Repeater,
  dirX: number,
  dirY: number,
  dtMs: number,
  delayMs: number = REPEAT_DELAY_MS,
  intervalMs: number = REPEAT_INTERVAL_MS,
): number {
  if (dirX !== r.dirX || dirY !== r.dirY) {
    r.dirX = dirX;
    r.dirY = dirY;
    r.heldMs = 0;
    r.repeatsEmitted = 0;
    return dirX !== 0 || dirY !== 0 ? 1 : 0;
  }
  if (dirX === 0 && dirY === 0) return 0;
  r.heldMs += dtMs;
  const due = r.heldMs < delayMs ? 0 : 1 + Math.floor((r.heldMs - delayMs) / intervalMs);
  const steps = due - r.repeatsEmitted;
  r.repeatsEmitted = due;
  return steps;
}

// Seat assignment: the first pad to press any button claims the first free
// player slot. Pads keep their seat across snapshots (index-stable) and a
// disconnected pad's seat survives so reconnecting resumes the same player.
export function claimPads(claimed: (number | null)[], pads: (PadSnapshot | null)[]): (number | null)[] {
  const next = claimed.slice();
  for (const pad of pads) {
    if (!pad) continue;
    if (next.includes(pad.index)) continue;
    if (!pad.buttons.some(Boolean)) continue;
    const free = next.indexOf(null);
    if (free !== -1) next[free] = pad.index;
  }
  return next;
}
