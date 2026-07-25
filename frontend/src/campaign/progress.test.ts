import { describe, it, expect } from 'vitest';
import { computeStars, isLevelUnlocked, nextLevelRef, orderedLevels } from './progress';
import type { Campaign, CampaignLevelRef } from '../core/level';

const refs: CampaignLevelRef[] = [
  { levelId: 'l1', ordinal: 0 },
  { levelId: 'l2', ordinal: 1 },
  { levelId: 'l3', ordinal: 2 },
];

describe('computeStars', () => {
  it('3 for a flawless clear, 2 for light losses, 1 for any win', () => {
    expect(computeStars(4, 4)).toBe(3); // lost none
    expect(computeStars(4, 2)).toBe(2); // lost half
    expect(computeStars(4, 1)).toBe(1); // lost more than half
    expect(computeStars(1, 1)).toBe(3); // a lone survivor still flawless
  });
});

describe('isLevelUnlocked', () => {
  it('first is always playable; later levels need the previous cleared', () => {
    expect(isLevelUnlocked(refs, 0, {})).toBe(true);
    expect(isLevelUnlocked(refs, 1, {})).toBe(false);
    expect(isLevelUnlocked(refs, 1, { l1: { completed: true, stars: 1 } })).toBe(true);
    expect(isLevelUnlocked(refs, 2, { l1: { completed: true, stars: 3 } })).toBe(false); // l2 not cleared
  });
});

describe('nextLevelRef', () => {
  it('returns the following level, or null at the end / for an unknown id', () => {
    expect(nextLevelRef(refs, 'l1')?.levelId).toBe('l2');
    expect(nextLevelRef(refs, 'l3')).toBeNull();
    expect(nextLevelRef(refs, 'missing')).toBeNull();
  });
});

describe('orderedLevels', () => {
  it('sorts a campaign\'s levels by ordinal', () => {
    const campaign = { levels: [{ levelId: 'b', ordinal: 1 }, { levelId: 'a', ordinal: 0 }] } as unknown as Campaign;
    expect(orderedLevels(campaign).map((r) => r.levelId)).toEqual(['a', 'b']);
  });
});
