import { describe, it, expect } from 'vitest';
import { encodeBoard, decodeBoard, type EditorBoard } from './boardCode';

const base = (over: Partial<EditorBoard> = {}): EditorBoard => ({
  cols: 6, rows: 6, cells: {}, units: {}, doodads: {}, props: {}, cover: {}, features: {}, featureCuts: {}, featureExits: {}, ...over,
});

describe('boardCode — props wire key (p)', () => {
  it('encode -> decode round-trips the props map identically', () => {
    const board = base({ props: { '0,0': { propId: 'oak' }, '3,2': { propId: 'cottage' } } });
    const decoded = decodeBoard(encodeBoard(board))!;
    expect(decoded.props).toEqual(board.props);
  });

  it('a prop-free board encodes byte-identically to the pre-props output', () => {
    // The same board minus the props field — i.e. what an old client produced. The encoded code
    // must match exactly, proving `p` is omitted when empty (no silent format churn).
    const withEmptyProps = base({ cells: { '0,0': 'grass-1' }, props: {} });
    // Construct the legacy-shaped object without the props key at all.
    const legacy = { ...withEmptyProps } as Partial<EditorBoard>;
    delete legacy.props;
    expect(encodeBoard(withEmptyProps)).toBe(encodeBoard(legacy as EditorBoard));
  });

  it('decoding a doodad-only board yields the doodads and an empty props map', () => {
    const board = base({ doodads: { '1,1': { doodadId: 'flower' } } });
    const decoded = decodeBoard(encodeBoard(board))!;
    expect(decoded.doodads).toEqual({ '1,1': { doodadId: 'flower' } });
    expect(decoded.props).toEqual({});
  });

  it('doodads and props coexist and round-trip independently', () => {
    const board = base({ doodads: { '0,0': { doodadId: 'boulder' } }, props: { '2,2': { propId: 'oak' } } });
    const decoded = decodeBoard(encodeBoard(board))!;
    expect(decoded.doodads).toEqual(board.doodads);
    expect(decoded.props).toEqual(board.props);
  });

  it('round-trips the optional player faction without requiring it', () => {
    const assigned = base({ playerFaction: 'emerald' });
    expect(decodeBoard(encodeBoard(assigned))!.playerFaction).toBe('emerald');
    expect(decodeBoard(encodeBoard(base()))!.playerFaction).toBeUndefined();
  });
});
