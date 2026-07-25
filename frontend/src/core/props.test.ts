import { describe, it, expect } from 'vitest';
import { propCells, propDef, PROP_DEFS, type PropDef } from './props';

const sortCells = (cells: Array<{ x: number; y: number }>) =>
  [...cells].sort((a, b) => a.y - b.y || a.x - b.x);

describe('props core', () => {
  it('propCells(0,0,oak) is exactly the 2×2 block (order-insensitive)', () => {
    const oak = propDef('oak')!;
    expect(oak.w).toBe(2);
    expect(oak.h).toBe(2);
    expect(sortCells(propCells(0, 0, oak))).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 },
    ]);
  });

  it('propCells respects the anchor offset', () => {
    const oak = propDef('oak')!;
    expect(sortCells(propCells(3, 5, oak))).toEqual([
      { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 6 }, { x: 4, y: 6 },
    ]);
  });

  it('a 2×1 def returns exactly 2 cells', () => {
    const def: PropDef = { id: 'x', label: 'X', kind: 'tree', w: 2, h: 1, blocking: true, terrains: ['grass'], sprite: { w: 96, h: 96, anchorX: 48, anchorY: 80 } };
    expect(propCells(0, 0, def)).toHaveLength(2);
    expect(sortCells(propCells(0, 0, def))).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  });

  it('propDef returns undefined for an unknown id (no fallback to [0])', () => {
    expect(propDef('not-a-real-prop')).toBeUndefined();
  });

  it('seeds an oak (tree) and a cottage (house), both blocking 2×2', () => {
    const ids = PROP_DEFS.map((d) => d.id);
    expect(ids).toContain('oak');
    expect(ids).toContain('cottage');
    expect(propDef('oak')!.kind).toBe('tree');
    expect(propDef('cottage')!.kind).toBe('house');
    for (const d of PROP_DEFS) {
      expect(d.blocking).toBe(true);
      expect(d.w).toBe(2);
      expect(d.h).toBe(2);
    }
  });
});
