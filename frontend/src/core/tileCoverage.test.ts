import { describe, expect, it } from 'vitest';
import { buildTileCoverageReport } from './tileCoverage';
import type { TileFamilyId, TileSocketAsset } from './tileSockets';

const families: Record<TileFamilyId, TileSocketAsset[]> = {
  grass: [{ id: 'grass', kind: 'tile', role: 'base', probability: 1 }],
  stone: [{ id: 'stone', kind: 'tile', role: 'base', probability: 1 }],
  water: [],
  dirt: [],
  pebble: [],
  sand: [],
};

describe('buildTileCoverageReport', () => {
  it('reports transition slot coverage and missing base families', () => {
    const report = buildTileCoverageReport(families, [
      { id: 'grass-stone-a', kind: 'tile', role: 'transition', probability: 1, pairId: 'grass-stone', socketMask: 1 },
      { id: 'bad-transition', kind: 'tile', role: 'transition', probability: 1, pairId: 'grass-water', socketMask: 15 },
    ]);

    expect(report.expectedTransitionSlots).toBe(42);
    expect(report.filledTransitionSlots).toBe(1);
    expect(report.missingTransitionSlots).toHaveLength(41);
    expect(report.invalidTransitionAssets.map((asset) => asset.id)).toEqual(['bad-transition']);
    expect(report.familiesWithoutBase).toEqual(['water', 'dirt', 'pebble', 'sand']);
  });
});
