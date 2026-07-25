// The starter workspace seeded when there's no server workspace yet: a SINGLE
// campaign, so the Campaign play screen and the editor both open with one campaign
// to build on (more get added as they're authored). It's derived from the first
// demo campaign so it ships with real levels; createDemoWorkspace (the full
// multi-campaign sample) stays available as a fixture. Replace this with the real
// campaign when its scenario lands.

import { createDemoWorkspace } from './demoWorkspace';
import type { Campaign, Level } from '../core/level';

export function createDefaultWorkspace(): { campaigns: Campaign[]; levels: Record<string, Level> } {
  const demo = createDemoWorkspace();
  const campaign = demo.campaigns[0];
  const levels: Record<string, Level> = {};
  for (const ref of campaign.levels) {
    const level = demo.levels[ref.levelId];
    if (level) levels[ref.levelId] = level;
  }
  return { campaigns: [campaign], levels };
}
