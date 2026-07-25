// Fixed-timestep game loop (the standard accumulator pattern). Simulation
// advances in constant-size ticks regardless of display refresh, so game logic
// is deterministic across 60/120/144 Hz screens; rendering happens once per
// animation frame with an interpolation alpha for anything that wants
// sub-tick smoothness.

export const STEP_MS = 1000 / 60;

// A backgrounded tab suspends rAF; on resume the frame delta can be minutes.
// Clamp how much wall-clock a single frame may simulate so we skip time
// instead of grinding through thousands of catch-up ticks.
export const MAX_FRAME_MS = 250;

export interface AccumulatorResult {
  accMs: number;
  steps: number;
}

export function stepAccumulator(accMs: number, frameMs: number, stepMs: number): AccumulatorResult {
  let acc = accMs + Math.min(frameMs, MAX_FRAME_MS);
  let steps = 0;
  while (acc >= stepMs) {
    acc -= stepMs;
    steps += 1;
  }
  return { accMs: acc, steps };
}

export interface GameLoop {
  start(): void;
  stop(): void;
}

export function createGameLoop(opts: {
  stepMs?: number;
  update: (stepMs: number) => void;
  render: (alpha: number) => void;
}): GameLoop {
  const stepMs = opts.stepMs ?? STEP_MS;
  let rafId = 0;
  let running = false;
  let last = 0;
  let accMs = 0;

  const frame = (now: number): void => {
    if (!running) return;
    const frameMs = last === 0 ? stepMs : now - last;
    last = now;
    const result = stepAccumulator(accMs, frameMs, stepMs);
    accMs = result.accMs;
    for (let i = 0; i < result.steps; i += 1) opts.update(stepMs);
    opts.render(accMs / stepMs);
    rafId = requestAnimationFrame(frame);
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      last = 0;
      accMs = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop(): void {
      running = false;
      cancelAnimationFrame(rafId);
    },
  };
}
