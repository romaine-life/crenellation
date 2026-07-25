// Per-player campaign progress: which levels are cleared and the best star rating
// earned, kept in localStorage (the play loop's source of truth — distinct from the
// demo's authored sample stars). A custom event lets open screens refresh live when
// a battle is won.

import type { Campaign, CampaignLevelRef } from '../core/level';

const KEY = 'chess-tactics-campaign-progress-v1';
export const CAMPAIGN_PROGRESS_EVENT = 'chess-tactics:campaign-progress';

export interface LevelProgress {
  completed: boolean;
  stars: number;
}

export type CampaignProgress = Record<string, LevelProgress>;

export function readProgress(): CampaignProgress {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object' ? (parsed as CampaignProgress) : {};
  } catch {
    return {};
  }
}

/** Record a cleared level, keeping the best star rating, and notify open screens. */
export function recordLevelWin(levelId: string, stars: number): void {
  const progress = readProgress();
  const prev = progress[levelId];
  progress[levelId] = { completed: true, stars: Math.max(stars, prev?.stars ?? 0) };
  try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(CAMPAIGN_PROGRESS_EVENT)); } catch { /* ignore */ }
}

/** A campaign's levels in play order. */
export function orderedLevels(campaign: Campaign): CampaignLevelRef[] {
  return [...campaign.levels].sort((a, b) => a.ordinal - b.ordinal);
}

/** A level is playable once it's the first or the previous one is cleared. */
export function isLevelUnlocked(levels: CampaignLevelRef[], index: number, progress: CampaignProgress): boolean {
  if (index <= 0) return true;
  return Boolean(progress[levels[index - 1].levelId]?.completed);
}

/** The next level after `levelId` in play order, or null at the end. */
export function nextLevelRef(levels: CampaignLevelRef[], levelId: string): CampaignLevelRef | null {
  const i = levels.findIndex((ref) => ref.levelId === levelId);
  return i >= 0 && i + 1 < levels.length ? levels[i + 1] : null;
}

/** Stars: 3 for a flawless clear, 2 for light losses, 1 for any win. */
export function computeStars(initialPlayerUnits: number, survivingPlayerUnits: number): number {
  const lost = Math.max(0, initialPlayerUnits - survivingPlayerUnits);
  if (lost === 0) return 3;
  if (lost <= Math.floor(initialPlayerUnits / 2)) return 2;
  return 1;
}
