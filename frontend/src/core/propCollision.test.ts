import { describe, it, expect } from 'vitest';
import type { BoardSize, GameState, Piece, PieceType, Side } from './types';
import { applyMove, isEnemy, legalMoves, livingPieces } from './rules';
import { propCells, propDef } from './props';

const SIZE: BoardSize = { cols: 8, rows: 8 };

function P(side: Side, type: PieceType, x: number, y: number, extra: Partial<Piece> = {}): Piece {
  return { id: `${side}-${type}-${x}-${y}`, side, type, x, y, alive: true, startY: side === 'player' ? 7 : 0, ...extra };
}

// Stamp a blocking oak's footprint as 4 neutral `rock` colliders — exactly what
// game/setup.ts createFromLevel does — anchored at (ax, ay).
function stampOak(ax: number, ay: number): Piece[] {
  const def = propDef('oak')!;
  return propCells(ax, ay, def).map((c, i) => ({
    id: `prop-oak-${ax}-${ay}-${i}`,
    side: 'neutral' as const,
    type: 'rock' as const,
    x: c.x,
    y: c.y,
    alive: true,
    startY: -1,
  }));
}

describe('prop collision (blocking oak = 4 neutral rock colliders)', () => {
  it('a rook ray stops at the first footprint cell', () => {
    // Rook at (0,0); oak footprint at (3,0)-(4,1). The ray east should reach (1,0),(2,0)
    // then STOP at the rock on (3,0) — never (3,0)+ themselves, never past.
    const rook = P('player', 'rook', 0, 0);
    const colliders = stampOak(3, 0);
    const pieces = [rook, ...colliders];
    const moves = legalMoves(rook, pieces, SIZE);
    const east = moves.filter((m) => m.y === 0).map((m) => m.x).sort((a, b) => a - b);
    expect(east).toEqual([1, 2]); // stops before x=3 (the first footprint cell)
  });

  it('legalMoves never includes any footprint cell for any piece', () => {
    const queen = P('player', 'queen', 0, 0);
    const colliders = stampOak(2, 2);
    const pieces = [queen, ...colliders];
    const footprint = new Set(propCells(2, 2, propDef('oak')!).map((c) => `${c.x},${c.y}`));
    for (const p of [queen]) {
      for (const m of legalMoves(p, pieces, SIZE)) {
        expect(footprint.has(`${m.x},${m.y}`)).toBe(false);
      }
    }
  });

  it('a collider is never an enemy of any unit', () => {
    const knight = P('player', 'knight', 0, 0);
    const enemyKnight = P('enemy', 'knight', 5, 5);
    const colliders = stampOak(2, 2);
    for (const c of colliders) {
      expect(isEnemy(knight, c)).toBe(false);
      expect(isEnemy(enemyKnight, c)).toBe(false);
    }
  });

  it('a collider cell is never a legal destination, so no move onto it is ever generated', () => {
    // The real protection: legalMoves never offers a collider cell, so the store never builds a
    // move onto one. (applyMove itself only refuses to MOVE when given an in-range legal move;
    // it is never handed a collider destination because legalMoves excludes them.)
    const rook = P('player', 'rook', 3, 7); // shares a column with the (3,0)/(3,1) colliders
    const colliders = stampOak(3, 0);
    const pieces = [rook, ...colliders];
    const moves = legalMoves(rook, pieces, SIZE);
    expect(moves.some((m) => m.x === 3 && m.y <= 1)).toBe(false); // never reaches the footprint
    // The rook's north ray stops just before the nearest collider (3,1): it can reach (3,2)..(3,6).
    const north = moves.filter((m) => m.x === 3 && m.y < 7).map((m) => m.y).sort((a, b) => a - b);
    expect(north).toEqual([2, 3, 4, 5, 6]);
  });

  it('applyMove never captures/destroys a collider even if handed it as a target', () => {
    // applyMove guards capture with !isObstacle(target): a rock is an obstacle, so it is never
    // marked dead. (The piece would still occupy the square, but legalMoves never produces such a
    // move — see the test above — so this only guarantees the collider survives a stray call.)
    const rook = P('player', 'rook', 3, 7);
    const colliders = stampOak(3, 0);
    const state: GameState = { size: SIZE, pieces: [rook, ...colliders], turn: 'player', winner: null };
    const target = colliders[0];
    const res = applyMove(state, rook.id, { x: target.x, y: target.y, capture: target.id });
    expect(res.state.pieces.find((p) => p.id === target.id)!.alive).toBe(true);
  });

  it('livingPieces(player/enemy) excludes the neutral colliders', () => {
    const player = P('player', 'king', 0, 0);
    const enemy = P('enemy', 'king', 7, 7);
    const colliders = stampOak(3, 3);
    const pieces = [player, enemy, ...colliders];
    expect(livingPieces(pieces, 'player')).toHaveLength(1);
    expect(livingPieces(pieces, 'enemy')).toHaveLength(1);
    expect(livingPieces(pieces, 'neutral')).toHaveLength(4);
  });
});
