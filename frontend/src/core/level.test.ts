import { describe, it, expect } from 'vitest';
import { createBlankLevel, validateLevel, LEVEL_FORMAT_VERSION } from './level';

describe('level schema', () => {
  it('creates a full-size, valid blank level', () => {
    const lvl = createBlankLevel('l1', 'Test', 12, 8);
    expect(lvl.formatVersion).toBe(LEVEL_FORMAT_VERSION);
    expect(lvl.layers.terrain).toHaveLength(96); // 12 * 8
    const res = validateLevel(lvl);
    expect(res.ok).toBe(true);
  });
  it('rejects a bad formatVersion and out-of-range board', () => {
    const bad = { ...createBlankLevel('l1'), formatVersion: 99, board: { cols: 2, rows: 8, heightLevels: 1 } };
    const res = validateLevel(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('formatVersion'))).toBe(true);
      expect(res.errors.some((e) => e.includes('board.cols'))).toBe(true);
    }
  });
  it('rejects an out-of-bounds unit', () => {
    const lvl = createBlankLevel('l1', 'T', 8, 8);
    lvl.layers.units.push({ x: 99, y: 0, type: 'knight', side: 'player' });
    expect(validateLevel(lvl).ok).toBe(false);
  });
  it('rejects non-objects', () => {
    expect(validateLevel(null).ok).toBe(false);
    expect(validateLevel('nope').ok).toBe(false);
  });

  it('validates a legacy body with NO layers.props (back-compat)', () => {
    const lvl = createBlankLevel('l1', 'T', 8, 8);
    delete (lvl.layers as { props?: unknown }).props; // pre-props body
    expect(validateLevel(lvl).ok).toBe(true);
  });

  it('accepts a well-formed layers.props when present', () => {
    const lvl = createBlankLevel('l1', 'T', 8, 8);
    lvl.layers.props = [{ x: 0, y: 0, propId: 'oak' }];
    expect(validateLevel(lvl).ok).toBe(true);
  });

  it('rejects a malformed layers.props entry when present', () => {
    const lvl = createBlankLevel('l1', 'T', 8, 8);
    // missing propId / non-numeric coords
    (lvl.layers as { props: unknown }).props = [{ x: 'a', propId: 5 }];
    expect(validateLevel(lvl).ok).toBe(false);
  });

  it('rejects a non-array layers.props when present', () => {
    const lvl = createBlankLevel('l1', 'T', 8, 8);
    (lvl.layers as { props: unknown }).props = 'nope';
    expect(validateLevel(lvl).ok).toBe(false);
  });

  it('rejects an out-of-bounds prop anchor (symmetric with the unit bounds check)', () => {
    const lvl = createBlankLevel('l1', 'T', 8, 8);
    lvl.layers.props = [{ x: 99, y: 0, propId: 'oak' }];
    expect(validateLevel(lvl).ok).toBe(false);
  });
});
