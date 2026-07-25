import { describe, it, expect } from 'vitest';
import { evaluateObjective, objectiveContextForLevel, DEFAULT_SURVIVE_TURNS } from './objectives';
import { createBlankLevel } from './level';
import type { GameState, Piece, PieceType, Side } from './types';

function piece(id: string, side: Side, type: PieceType, x: number, y: number): Piece {
  return { id, side, type, x, y, alive: true, startY: y };
}
function state(pieces: Piece[]): GameState {
  return { size: { cols: 8, rows: 8 }, pieces, turn: 'player', winner: null };
}

describe('evaluateObjective', () => {
  it('loses on a full player wipe regardless of objective', () => {
    const s = state([piece('e', 'enemy', 'king', 0, 0)]);
    for (const obj of ['capture-all', 'capture-king', 'survive', 'reach'] as const) {
      expect(evaluateObjective(s, obj)).toBe('enemy');
    }
  });

  it('capture-all: undecided while enemies live, won when none remain', () => {
    expect(evaluateObjective(state([piece('p', 'player', 'pawn', 0, 0), piece('e', 'enemy', 'pawn', 1, 1)]), 'capture-all')).toBeNull();
    expect(evaluateObjective(state([piece('p', 'player', 'pawn', 0, 0)]), 'capture-all')).toBe('player');
  });

  it('capture-king: won when the enemy royal is gone even if lesser pieces remain', () => {
    const withKing = state([piece('p', 'player', 'pawn', 0, 0), piece('ek', 'enemy', 'king', 5, 5), piece('ep', 'enemy', 'pawn', 4, 4)]);
    expect(evaluateObjective(withKing, 'capture-king')).toBeNull();
    const noKing = state([piece('p', 'player', 'pawn', 0, 0), piece('ep', 'enemy', 'pawn', 4, 4)]);
    expect(evaluateObjective(noKing, 'capture-king')).toBe('player');
  });

  it('survive: won once the required turns elapse', () => {
    const s = state([piece('p', 'player', 'pawn', 0, 0), piece('e', 'enemy', 'pawn', 1, 1)]);
    expect(evaluateObjective(s, 'survive', { surviveTurns: 5, turnsElapsed: 3 })).toBeNull();
    expect(evaluateObjective(s, 'survive', { surviveTurns: 5, turnsElapsed: 5 })).toBe('player');
  });

  it('reach: won when a living player stands on a target cell', () => {
    const s = state([piece('p', 'player', 'knight', 3, 3), piece('e', 'enemy', 'pawn', 1, 1)]);
    expect(evaluateObjective(s, 'reach', { reachCells: [{ x: 7, y: 0 }] })).toBeNull();
    expect(evaluateObjective(s, 'reach', { reachCells: [{ x: 3, y: 3 }, { x: 7, y: 0 }] })).toBe('player');
  });
});

describe('objectiveContextForLevel', () => {
  it('capture objectives imply no extra context', () => {
    expect(objectiveContextForLevel(createBlankLevel('a'))).toEqual({}); // createBlankLevel = capture-all
  });

  it('survive implies the default turn target', () => {
    const level = { ...createBlankLevel('a'), objective: 'survive' as const };
    expect(objectiveContextForLevel(level)).toEqual({ surviveTurns: DEFAULT_SURVIVE_TURNS });
  });

  it('reach uses authored objective-zone tiles when present', () => {
    const base = createBlankLevel('a', 'x', 4, 4);
    const level = {
      ...base,
      objective: 'reach' as const,
      layers: { ...base.layers, zones: [{ id: 'z', type: 'objective' as const, tiles: [[1, 1], [2, 2]] as Array<[number, number]> }] },
    };
    expect(objectiveContextForLevel(level).reachCells).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
  });

  it('reach falls back to the enemy back rank (y=0) when no zone is authored', () => {
    const level = { ...createBlankLevel('a', 'x', 3, 3), objective: 'reach' as const };
    expect(objectiveContextForLevel(level).reachCells).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
  });
});
