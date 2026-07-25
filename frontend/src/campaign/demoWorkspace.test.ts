import { describe, expect, it } from 'vitest';
import { validateLevel } from '../core/level';
import { createDemoWorkspace, DEMO_SELECTED_CAMPAIGN_ID, DEMO_SELECTED_LEVEL_ID } from './demoWorkspace';

describe('demo campaign workspace', () => {
  it('contains valid campaigns, levels, and the default selection', () => {
    const workspace = createDemoWorkspace();
    expect(workspace.campaigns.length).toBeGreaterThanOrEqual(8);
    expect(workspace.campaigns.some((campaign) => campaign.locked)).toBe(true);
    expect(workspace.campaigns.some((campaign) => campaign.favorite)).toBe(true);
    expect(workspace.campaigns.find((campaign) => campaign.id === DEMO_SELECTED_CAMPAIGN_ID)).toBeTruthy();
    expect(workspace.levels[DEMO_SELECTED_LEVEL_ID]).toBeTruthy();

    for (const campaign of workspace.campaigns) {
      for (const ref of campaign.levels) {
        expect(workspace.levels[ref.levelId]).toBeTruthy();
      }
    }

    for (const level of Object.values(workspace.levels)) {
      expect(validateLevel(level).ok).toBe(true);
      expect(level.layers.terrain).toHaveLength(level.board.cols * level.board.rows);
      expect(level.layers.units.some((unit) => unit.side === 'player')).toBe(true);
      expect(level.layers.units.some((unit) => unit.side === 'enemy')).toBe(true);
    }
  });
});
