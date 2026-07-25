import { describe, expect, it } from 'vitest';
import { PHASE_DURATIONS_MS, advancePhase, createPhaseState } from './phases';

describe('advancePhase', () => {
  it('holds the current phase until its duration elapses', () => {
    const { state, changed } = advancePhase(createPhaseState(), PHASE_DURATIONS_MS.place - 1);
    expect(changed).toBe(false);
    expect(state.phase).toBe('place');
    expect(state.remainingMs).toBe(1);
  });

  it('cycles place -> battle -> rebuild and bumps the round on wrap', () => {
    let state = createPhaseState();
    state = advancePhase(state, PHASE_DURATIONS_MS.place).state;
    expect(state.phase).toBe('battle');
    state = advancePhase(state, PHASE_DURATIONS_MS.battle).state;
    expect(state.phase).toBe('build');
    expect(state.round).toBe(1);
    state = advancePhase(state, PHASE_DURATIONS_MS.build).state;
    expect(state.phase).toBe('place');
    expect(state.round).toBe(2);
  });

  it('crosses multiple boundaries in one large step without losing time', () => {
    const dt = PHASE_DURATIONS_MS.place + PHASE_DURATIONS_MS.battle + 100;
    const { state, changed } = advancePhase(createPhaseState(), dt);
    expect(changed).toBe(true);
    expect(state.phase).toBe('build');
    expect(state.remainingMs).toBe(PHASE_DURATIONS_MS.build - 100);
  });
});
