import { describe, expect, it } from 'vitest';
import { productionUnitAssets, unitAssets } from './unitCatalog';

describe('unit catalog production subset', () => {
  it('keeps speculative comparison units out of editor paint choices', () => {
    expect(unitAssets.length).toBeGreaterThan(productionUnitAssets.length);
    expect(productionUnitAssets.length).toBeGreaterThan(0);
    expect(productionUnitAssets.every((unit) => unit.factionMode === 'palette' && !unit.speculative)).toBe(true);
  });
});
