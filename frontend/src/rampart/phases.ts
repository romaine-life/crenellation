// Rampart's round structure: place cannons -> battle -> rebuild walls, looping
// until an end condition (a player who can't enclose a castle) that the port
// hasn't built yet. Durations are placeholders eyeballed from arcade footage;
// they get replaced by ROM-extracted constants, which is why every number
// lives in this one table and nowhere else.

export const PHASE_ORDER = ['place', 'battle', 'rebuild'] as const;
export type Phase = (typeof PHASE_ORDER)[number];

export const PHASE_DURATIONS_MS: Record<Phase, number> = {
  place: 10_000,
  battle: 15_000,
  rebuild: 25_000,
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
