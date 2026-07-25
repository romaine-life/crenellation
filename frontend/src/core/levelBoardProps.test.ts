import { describe, it, expect } from 'vitest';
import { editorBoardToLevel, levelToEditorBoard } from './levelBoard';
import type { EditorBoard } from '../ui/boardCode';
import { decodeBoard } from '../ui/boardCode';
import { createBlankLevel } from './level';

const board = (over: Partial<EditorBoard> = {}): EditorBoard => ({
  cols: 6, rows: 6, cells: {}, units: {}, doodads: {}, props: {}, cover: {}, features: {}, featureCuts: {}, featureExits: {}, ...over,
});

describe('levelBoard — props dual-write + round-trip', () => {
  it('editorBoardToLevel writes BOTH boardCode "p" AND layers.props with matching anchors', () => {
    const level = editorBoardToLevel(board({ props: { '1,1': { propId: 'oak' } } }), { id: 'l1', name: 'P' });
    // Durable game channel.
    expect(level.layers.props).toEqual([{ x: 1, y: 1, propId: 'oak' }]);
    // Lossless editor channel.
    const fromCode = decodeBoard(level.boardCode!)!;
    expect(fromCode.props).toEqual({ '1,1': { propId: 'oak' } });
  });

  it('levelToEditorBoard(level with boardCode) round-trips props', () => {
    const level = editorBoardToLevel(board({ props: { '2,3': { propId: 'cottage' } } }), { id: 'l2', name: 'P' });
    const reopened = levelToEditorBoard(level);
    expect(reopened.props).toEqual({ '2,3': { propId: 'cottage' } });
  });

  it('legacy fallback (no boardCode, has layers.props) derives the props map', () => {
    const level = createBlankLevel('legacy', 'L', 8, 8);
    level.layers.props = [{ x: 0, y: 0, propId: 'oak' }, { x: 4, y: 4, propId: 'cottage' }];
    delete level.boardCode; // force the layers-derived path
    const derived = levelToEditorBoard(level);
    expect(derived.props).toEqual({ '0,0': { propId: 'oak' }, '4,4': { propId: 'cottage' } });
  });

  it('a prop-free editor board yields layers.props []', () => {
    const level = editorBoardToLevel(board(), { id: 'l3', name: 'Empty' });
    expect(level.layers.props).toEqual([]);
  });
});
