import { describe, it, expect } from 'vitest';
import { editorBoardToLevel, levelToEditorBoard } from './levelBoard';
import type { EditorBoard } from '../ui/boardCode';
import type { TerrainCell } from './types';

// A blank board (no painted cells) derives every cell to grass — enough to exercise the
// save-time projection without depending on specific Studio tile / unit ids.
const emptyBoard = (cols: number, rows: number): EditorBoard => ({
  cols, rows, cells: {}, units: {}, doodads: {}, props: {}, cover: {}, features: {}, featureCuts: {}, featureExits: {},
});

describe('editorBoardToLevel — INV7 round-trip / data-loss guards', () => {
  it('carries non-expressible terrain (bridge) AND elevation through from the pre-save level', () => {
    // The editor can paint neither `bridge` (no tile family, no feature) nor elevation (no height
    // tool), so both must survive a republish of a legacy official rather than flatten.
    const previousTerrain: TerrainCell[] = [
      { x: 0, y: 0, terrain: 'bridge', elevation: 1 },
      { x: 1, y: 0, terrain: 'grass', elevation: 2 },
    ];
    const level = editorBoardToLevel(emptyBoard(4, 4), { id: 'l1', name: 'T', previousTerrain });
    const at = (x: number, y: number) => level.layers.terrain.find((c) => c.x === x && c.y === y)!;

    expect(at(0, 0).terrain).toBe('bridge'); // no family, no feature -> preserved by the guard
    expect(at(0, 0).elevation).toBe(1); // elevation preserved
    expect(at(1, 0).elevation).toBe(2);
    expect(level.board.heightLevels).toBe(3); // follows max elevation, not hard-coded 1
  });

  it('projects a road feature overlay back to `road` terrain so the game sees it', () => {
    const board = emptyBoard(4, 4);
    board.features['2,1'] = { kind: 'road', material: 'cobble' };
    const level = editorBoardToLevel(board, { id: 'l2', name: 'R' });
    expect(level.layers.terrain.find((c) => c.x === 2 && c.y === 1)!.terrain).toBe('road');
  });

  it('a fresh board with no previous terrain is flat grass (heightLevels 1) and stamps boardCode', () => {
    const level = editorBoardToLevel(emptyBoard(4, 4), { id: 'l3', name: 'New' });
    expect(level.board.heightLevels).toBe(1);
    expect(level.layers.terrain.every((c) => c.terrain === 'grass' && c.elevation === 0)).toBe(true);
    expect(typeof level.boardCode).toBe('string');
  });

  it('maps only the assigned player faction to player and leaves unassigned maps CPU-only', () => {
    const board = emptyBoard(4, 4);
    board.playerFaction = 'emerald';
    board.units = {
      '0,0': { unitId: 'rook-blender-v4-calibrated', direction: 'south', faction: 'emerald' },
      '1,0': { unitId: 'knight-fur', direction: 'south', faction: 'crimson' },
    };
    const assigned = editorBoardToLevel(board, { id: 'l6', name: 'Faction' });
    expect(assigned.layers.units.find((unit) => unit.x === 0)?.side).toBe('player');
    expect(assigned.layers.units.find((unit) => unit.x === 1)?.side).toBe('enemy');

    const unassigned = editorBoardToLevel({ ...board, playerFaction: null }, { id: 'l7', name: 'Neutral' });
    expect(unassigned.layers.units.every((unit) => unit.side === 'enemy')).toBe(true);
  });
});

describe('levelToEditorBoard — legacy (no boardCode) derive path', () => {
  it('surfaces legacy `road` terrain as a road feature overlay, round-tripping through layers', () => {
    // Save a board with a road overlay, then drop boardCode to force the layers-derive path —
    // the road must come back as a feature, not vanish into grass (the reported bug).
    const board = emptyBoard(4, 4);
    board.features['2,1'] = { kind: 'road', material: 'cobble' };
    const saved = editorBoardToLevel(board, { id: 'l4', name: 'Road' });
    const legacy = { ...saved, boardCode: undefined };

    const reopened = levelToEditorBoard(legacy);
    expect(reopened.features['2,1']).toEqual({ kind: 'road', material: 'cobble' });
  });

  it('re-seeds exact board dimensions from boardCode on reopen', () => {
    const level = editorBoardToLevel(emptyBoard(6, 5), { id: 'l5', name: 'Dims' });
    const reopened = levelToEditorBoard(level);
    expect(reopened.cols).toBe(6);
    expect(reopened.rows).toBe(5);
  });

  it('derives navy as the player faction for legacy player/enemy levels', () => {
    const saved = editorBoardToLevel(emptyBoard(4, 4), { id: 'l8', name: 'Legacy' });
    const legacy = {
      ...saved,
      boardCode: undefined,
      layers: {
        ...saved.layers,
        units: [{ x: 0, y: 0, type: 'king' as const, side: 'player' as const }],
      },
    };
    expect(levelToEditorBoard(legacy).playerFaction).toBe('navy-blue');
  });
});
