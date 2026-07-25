import { describe, it, expect, beforeEach } from 'vitest';
import { useCampaigns } from './store';
import { validateLevel } from '../core/level';

function reset() {
  useCampaigns.setState({ campaigns: [], levels: {}, selectedCampaignId: null, selectedLevelId: null, counter: 1 });
}

const OFFICIAL_ID = /^off-[a-z]+(-[a-z]+)*$/; // backend validateOfficialWorkspaceIds contract

function makeLevel(id: string, name = 'L') {
  return {
    formatVersion: 1, id, name, notes: '',
    board: { cols: 8, rows: 8, heightLevels: 1 }, objective: 'capture-all' as const, difficulty: 'normal',
    economy: { startingFunds: 1000, incomePerTurn: 100 }, theme: 'grassland',
    layers: { terrain: [], decals: [], zones: [], units: [] },
  };
}
const officialWs = {
  campaigns: [{ formatVersion: 1, id: 'off-c-crown', name: 'Crown', difficulty: 'normal', chapters: 1, levels: [{ levelId: 'off-l-break', ordinal: 0, objective: 'capture-all' as const }] }],
  levels: { 'off-l-break': makeLevel('off-l-break', 'Break') },
};

describe('campaign store', () => {
  beforeEach(reset);

  it('creates and selects a campaign', () => {
    useCampaigns.getState().newCampaign();
    const s = useCampaigns.getState();
    expect(s.campaigns).toHaveLength(1);
    expect(s.selectedCampaignId).toBe(s.campaigns[0].id);
  });

  it('adds levels with valid starter docs and increasing ordinals', () => {
    useCampaigns.getState().newCampaign();
    useCampaigns.getState().addLevel();
    useCampaigns.getState().addLevel();
    const s = useCampaigns.getState();
    const camp = s.campaigns[0];
    expect(camp.levels.map((r) => r.ordinal)).toEqual([0, 1]);
    for (const ref of camp.levels) {
      const level = s.levels[ref.levelId];
      expect(validateLevel(level).ok).toBe(true);
      expect(level.layers.units.some((unit) => unit.side === 'player')).toBe(true);
      expect(level.layers.units.some((unit) => unit.side === 'enemy')).toBe(true);
    }
  });

  it('reorders levels with moveLevel', () => {
    useCampaigns.getState().newCampaign();
    useCampaigns.getState().addLevel();
    useCampaigns.getState().addLevel();
    const first = useCampaigns.getState().campaigns[0].levels.find((r) => r.ordinal === 0)!.levelId;
    useCampaigns.getState().moveLevel(first, 1);
    const refs = useCampaigns.getState().campaigns[0].levels;
    expect(refs.find((r) => r.levelId === first)!.ordinal).toBe(1);
  });

  it('deletes a level and drops its doc', () => {
    useCampaigns.getState().newCampaign();
    useCampaigns.getState().addLevel();
    const id = useCampaigns.getState().selectedLevelId!;
    useCampaigns.getState().deleteLevel(id);
    expect(useCampaigns.getState().campaigns[0].levels).toHaveLength(0);
    expect(useCampaigns.getState().levels[id]).toBeUndefined();
  });

  it('edits level objective + economy', () => {
    useCampaigns.getState().newCampaign();
    useCampaigns.getState().addLevel();
    const id = useCampaigns.getState().selectedLevelId!;
    useCampaigns.getState().setLevelObjective(id, 'survive');
    useCampaigns.getState().setLevelEconomy(id, 2000, 250);
    useCampaigns.getState().setLevelNotes(id, 'Hold until dawn.');
    const lvl = useCampaigns.getState().levels[id];
    expect(lvl.objective).toBe('survive');
    expect(lvl.economy).toEqual({ startingFunds: 2000, incomePerTurn: 250 });
    expect(lvl.notes).toBe('Hold until dawn.');
  });

  it('tracks favorites and level stars as real state', () => {
    useCampaigns.getState().newCampaign();
    const campaignId = useCampaigns.getState().selectedCampaignId!;
    useCampaigns.getState().toggleCampaignFavorite(campaignId);
    useCampaigns.getState().addLevel();
    const levelId = useCampaigns.getState().selectedLevelId!;
    useCampaigns.getState().setLevelStars(levelId, 2);
    const campaign = useCampaigns.getState().campaigns[0];
    expect(campaign.favorite).toBe(true);
    expect(campaign.levels[0]).toMatchObject({ stars: 2, completed: true });
  });

  it('duplicates campaigns with copied level documents and new ids', () => {
    useCampaigns.getState().newCampaign();
    useCampaigns.getState().addLevel();
    const originalCampaignId = useCampaigns.getState().selectedCampaignId!;
    const originalLevelId = useCampaigns.getState().selectedLevelId!;
    useCampaigns.getState().setLevelNotes(originalLevelId, 'Original note');
    useCampaigns.getState().setLevelStars(originalLevelId, 3);
    useCampaigns.getState().duplicateCampaign(originalCampaignId);
    const state = useCampaigns.getState();
    expect(state.campaigns).toHaveLength(2);
    const duplicate = state.campaigns[1];
    expect(duplicate.id).not.toBe(originalCampaignId);
    expect(duplicate.levels[0].levelId).not.toBe(originalLevelId);
    expect(duplicate.levels[0].stars).toBeUndefined();
    expect(duplicate.levels[0].completed).toBeUndefined();
    expect(state.levels[duplicate.levels[0].levelId].notes).toBe('Original note');
  });

  it('deletes unreferenced level docs when deleting a campaign', () => {
    useCampaigns.getState().newCampaign();
    useCampaigns.getState().addLevel();
    const campaignId = useCampaigns.getState().selectedCampaignId!;
    const levelId = useCampaigns.getState().selectedLevelId!;
    useCampaigns.getState().deleteCampaign(campaignId);
    expect(useCampaigns.getState().campaigns).toHaveLength(0);
    expect(useCampaigns.getState().levels[levelId]).toBeUndefined();
  });

  it('imports workspaces by remapping ids instead of overwriting existing levels', () => {
    useCampaigns.getState().newCampaign();
    useCampaigns.getState().addLevel();
    const existingLevelId = useCampaigns.getState().selectedLevelId!;
    const importedLevel = { ...useCampaigns.getState().levels[existingLevelId], name: 'Imported Level' };
    useCampaigns.getState().importWorkspace({
      campaigns: [{ formatVersion: 1, id: 'c1', name: 'Imported', difficulty: 'normal', chapters: 1, levels: [{ levelId: existingLevelId, ordinal: 0 }] }],
      levels: { [existingLevelId]: importedLevel },
    });
    const state = useCampaigns.getState();
    expect(state.campaigns).toHaveLength(2);
    expect(state.campaigns[1].levels[0].levelId).not.toBe(existingLevelId);
    expect(state.levels[existingLevelId].name).not.toBe('Imported Level');
  });
});

describe('tiered campaigns (ADR-0038)', () => {
  beforeEach(reset);

  it('merges officials (tagged, first) then the user tier on top, both coexisting', () => {
    useCampaigns.getState().mergeOfficial(officialWs);
    useCampaigns.getState().mergeUser({ campaigns: [{ formatVersion: 1, id: 'c5', name: 'Mine', difficulty: 'normal', chapters: 1, levels: [] }], levels: {} });
    const s = useCampaigns.getState();
    expect(s.campaigns.map((c) => c.id)).toEqual(['off-c-crown', 'c5']);
    expect(s.campaigns[0]).toMatchObject({ origin: 'official', readOnly: true });
    expect(s.campaigns[1]).toMatchObject({ origin: 'mine' });
  });

  it('keeps the user counter free of official ids so user ids never collide', () => {
    useCampaigns.getState().mergeOfficial(officialWs); // off- ids must NOT bump the counter
    useCampaigns.getState().newCampaign();
    expect(useCampaigns.getState().campaigns.find((c) => c.origin !== 'official')!.id).toBe('c1');
  });

  it('mints off- ids driven by the SELECTED campaign origin, not a global mode', () => {
    // newOfficialCampaign mints an off-c-… id and selects it…
    useCampaigns.getState().newOfficialCampaign();
    const official = useCampaigns.getState().campaigns[0];
    expect(official.id).toMatch(OFFICIAL_ID);
    expect(official).toMatchObject({ origin: 'official' });
    expect(useCampaigns.getState().selectedCampaignId).toBe(official.id);
    // …and adding a level to it mints an off-l-… level (origin follows the selection).
    useCampaigns.getState().addLevel();
    const officialLevelId = useCampaigns.getState().campaigns[0].levels[0].levelId;
    expect(officialLevelId).toMatch(OFFICIAL_ID);

    // A private campaign mints plain l<n> levels — the official ids above did not bump
    // the user counter, so this lands on c1 / l1.
    useCampaigns.getState().newCampaign();
    const mine = useCampaigns.getState().campaigns.find((c) => c.origin !== 'official')!;
    expect(mine.id).toBe('c1');
    useCampaigns.getState().selectCampaign(mine.id);
    useCampaigns.getState().addLevel();
    const mineLevelId = useCampaigns.getState().campaigns.find((c) => c.id === mine.id)!.levels[0].levelId;
    expect(mineLevelId).toMatch(/^l\d+$/);

    // No id appears twice across campaigns or levels.
    const s = useCampaigns.getState();
    const ids = [...s.campaigns.map((c) => c.id), ...Object.keys(s.levels)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mints fresh off- ids that do NOT collide across sessions (counter-reset bug)', () => {
    // Author one default-named official campaign + level…
    useCampaigns.getState().newOfficialCampaign();
    useCampaigns.getState().addLevel();
    const s1 = useCampaigns.getState();
    const c1 = s1.campaigns[0];
    const l1 = c1.levels[0].levelId;
    const published = { campaigns: s1.campaigns.map((c) => ({ ...c })), levels: { ...s1.levels } };

    // Re-merge the published officials (a new session), then author again with the same
    // default names: the new ids must be FRESH, not re-mint the existing ones.
    reset();
    useCampaigns.getState().mergeOfficial(published);
    useCampaigns.getState().newOfficialCampaign();
    const c2 = useCampaigns.getState().campaigns.find((c) => c.id !== c1.id)!;
    expect(c2.id).toMatch(OFFICIAL_ID);
    expect(c2.id).not.toBe(c1.id);
    useCampaigns.getState().selectCampaign(c2.id);
    useCampaigns.getState().addLevel();
    const l2 = useCampaigns.getState().campaigns.find((c) => c.id === c2.id)!.levels[0].levelId;
    expect(l2).not.toBe(l1);
    const ids = [c1.id, c2.id, ...Object.keys(useCampaigns.getState().levels)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('strips the official tag on import so a re-imported official is saved as the user\'s own', () => {
    useCampaigns.getState().importWorkspace({
      campaigns: [{ formatVersion: 1, id: 'off-c-crown', name: 'Crown', difficulty: 'normal', chapters: 1, levels: [], origin: 'official', readOnly: true }],
      levels: {},
    });
    expect(useCampaigns.getState().campaigns[0]).toMatchObject({ origin: 'mine', readOnly: false });
  });

  it('clears a stale selection when a merge removes the selected campaign', () => {
    useCampaigns.getState().mergeOfficial(officialWs);
    useCampaigns.getState().selectCampaign('off-c-crown');
    useCampaigns.getState().mergeOfficial({ campaigns: [], levels: {} }); // crown gone
    expect(useCampaigns.getState().selectedCampaignId).toBeNull();
  });
});
