import { describe, it, expect } from 'vitest';
import {
  buildTerrainIndex, terrainAt, elevationAt, isPassableTerrain, canTraverse, MAX_CLIMB,
} from './terrain';
import { legalMoves } from './rules';
import type { GameState, Piece, PieceType, Side, TerrainCell } from './types';

function piece(id: string, side: Side, type: PieceType, x: number, y: number, extra: Partial<Piece> = {}): Piece {
  return { id, side, type, x, y, alive: true, startY: y, ...extra };
}
function state(pieces: Piece[], over: Partial<GameState> = {}): GameState {
  return { size: { cols: 8, rows: 8 }, pieces, turn: 'player', winner: null, ...over };
}
function index(cells: TerrainCell[]) {
  return buildTerrainIndex(cells);
}

describe('terrain index', () => {
  it('looks cells up by coordinate and reports elevation', () => {
    const idx = index([{ x: 2, y: 3, terrain: 'water', elevation: 0 }, { x: 4, y: 4, terrain: 'stone', elevation: 2 }]);
    expect(terrainAt(idx, 2, 3)).toEqual({ terrain: 'water', elevation: 0 });
    expect(terrainAt(idx, 0, 0)).toBeNull();
    expect(elevationAt(idx, 4, 4)).toBe(2);
    expect(elevationAt(idx, 0, 0)).toBe(0); // unauthored == ground
  });
});

describe('isPassableTerrain', () => {
  it('treats water as walkable and cliff/rock as barriers', () => {
    expect(isPassableTerrain('water')).toBe(true);
    expect(isPassableTerrain('cliff')).toBe(false);
    expect(isPassableTerrain('rock')).toBe(false);
    for (const t of ['grass', 'stone', 'road', 'bridge'] as const) expect(isPassableTerrain(t)).toBe(true);
  });
});

describe('canTraverse', () => {
  const idx = index([
    { x: 1, y: 0, terrain: 'water', elevation: 0 },
    { x: 2, y: 0, terrain: 'cliff', elevation: 0 },
    { x: 3, y: 0, terrain: 'grass', elevation: 2 },
    { x: 4, y: 0, terrain: 'bridge', elevation: 0 },
  ]);
  it('allows open/unauthored ground', () => expect(canTraverse(idx, 0, 7, 7)).toBe(true));
  it('allows water terrain', () => expect(canTraverse(idx, 0, 1, 0)).toBe(true));
  it('blocks impassable terrain', () => expect(canTraverse(idx, 0, 2, 0)).toBe(false));
  it('allows a climb within MAX_CLIMB', () => expect(canTraverse(index([{ x: 2, y: 0, terrain: 'grass', elevation: 1 }]), 0, 2, 0)).toBe(true));
  it('blocks a rise greater than MAX_CLIMB', () => expect(canTraverse(idx, 0, 3, 0)).toBe(false));
  it('allows descending any height', () => expect(canTraverse(idx, 5, 3, 0)).toBe(true));
  it('keeps bridges passable over notional gaps', () => expect(canTraverse(idx, 0, 4, 0)).toBe(true));
  it('MAX_CLIMB is one', () => expect(MAX_CLIMB).toBe(1));
});

describe('legalMoves with terrain env', () => {
  it('allows a queen ray through water', () => {
    const queen = piece('r', 'player', 'queen', 4, 4);
    const env = { terrain: index([{ x: 4, y: 2, terrain: 'water', elevation: 0 }]) };
    const up = legalMoves(queen, [queen], { cols: 8, rows: 8 }, env).filter((m) => m.x === 4 && m.y < 4).map((m) => m.y);
    expect(up).toEqual([3, 2, 1, 0]);
  });

  it('removes a knight step that lands on a cliff', () => {
    const kn = piece('k', 'player', 'knight', 4, 4);
    const env = { terrain: index([{ x: 6, y: 5, terrain: 'cliff', elevation: 0 }]) };
    const moves = legalMoves(kn, [kn], { cols: 8, rows: 8 }, env);
    expect(moves.some((m) => m.x === 6 && m.y === 5)).toBe(false); // cliff blocked
    expect(moves.some((m) => m.x === 6 && m.y === 3)).toBe(true); // sibling step still legal
  });

  it('allows a pawn advance into water', () => {
    const pawn = piece('p', 'player', 'pawn', 3, 6);
    const foe = piece('foe', 'enemy', 'pawn', 2, 5);
    const env = { terrain: index([{ x: 3, y: 5, terrain: 'water', elevation: 0 }]) };
    const moves = legalMoves(pawn, [pawn, foe], { cols: 8, rows: 8 }, env);
    expect(moves).toEqual([{ x: 3, y: 5 }, { x: 3, y: 4 }, { x: 2, y: 5, capture: 'foe' }]);
  });

  it('uses the origin elevation: a piece cannot ray up past a +1 rise', () => {
    const queen = piece('r', 'player', 'queen', 4, 4);
    const env = { terrain: index([
      { x: 4, y: 3, terrain: 'grass', elevation: 1 }, // +1 from ground: reachable
      { x: 4, y: 2, terrain: 'grass', elevation: 2 }, // +2 from origin: a wall
    ]) };
    const up = legalMoves(queen, [queen], { cols: 8, rows: 8 }, env).filter((m) => m.x === 4 && m.y < 4).map((m) => m.y);
    expect(up).toEqual([3]);
  });

  it('is identical to plain movement when no terrain is supplied', () => {
    const queen = piece('r', 'player', 'queen', 4, 4);
    const up = legalMoves(queen, [queen], { cols: 8, rows: 8 }).filter((m) => m.x === 4 && m.y < 4).map((m) => m.y);
    expect(up).toEqual([3, 2, 1, 0]);
  });
});
