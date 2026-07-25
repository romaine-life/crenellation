// Round structure and timings.
//
// Durations measured from the arcade, not invented: RAM 0x3E1870 is the
// countdown, decrementing once per 59.3 frames. It resets to 20 for a phase
// that runs exactly 1199-1200 frames (20.0s), to 10 for a shorter phase, and
// sits at 255 (no countdown shown) through the ~30s battle.

export const PHASE_ORDER = ['place', 'battle', 'build'] as const;
export type Phase = (typeof PHASE_ORDER)[number];

export const PHASE_SECONDS: Record<Phase, number> = {
  place: 10,
  battle: 30,
  build: 20,
};

export const PHASE_DURATIONS_MS: Record<Phase, number> = {
  place: PHASE_SECONDS.place * 1000,
  battle: PHASE_SECONDS.battle * 1000,
  build: PHASE_SECONDS.build * 1000,
};

export const PHASE_LABEL: Record<Phase, string> = {
  place: 'PLACE CANNONS',
  battle: 'FIRE!',
  build: 'REBUILD WALLS',
};

export interface PhaseState {
  phase: Phase;
  remainingMs: number;
  round: number;
}

export function createPhaseState(): PhaseState {
  return { phase: 'place', remainingMs: PHASE_DURATIONS_MS.place, round: 1 };
}

export function advancePhase(state: PhaseState, dtMs: number): { state: PhaseState; changed: boolean } {
  let { phase, remainingMs, round } = state;
  let changed = false;
  remainingMs -= dtMs;
  while (remainingMs <= 0) {
    const idx = PHASE_ORDER.indexOf(phase);
    const nextPhase = PHASE_ORDER[(idx + 1) % PHASE_ORDER.length];
    if (nextPhase === 'place') round += 1;
    phase = nextPhase;
    remainingMs += PHASE_DURATIONS_MS[phase];
    changed = true;
  }
  return { state: { phase, remainingMs, round }, changed };
}
