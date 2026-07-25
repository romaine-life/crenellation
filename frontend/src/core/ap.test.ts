import { describe, it, expect } from 'vitest';
import { applyMove, pieceAp, pieceMaxAp, sideHasAp, refreshAp, endTurn } from './rules';
import type { GameState, Piece, PieceType, Side } from './types';

function piece(id: string, side: Side, type: PieceType, x: number, y: number, extra: Partial<Piece> = {}): Piece {
  return { id, side, type, x, y, alive: true, startY: y, ...extra };
}
function state(pieces: Piece[], over: Partial<GameState> = {}): GameState {
  return { size: { cols: 8, rows: 8 }, pieces, turn: 'player', winner: null, ...over };
}

describe('AP accessors', () => {
  it('pieceAp defaults to 1, pieceMaxAp falls back to ap then 1', () => {
    expect(pieceAp(piece('a', 'player', 'pawn', 0, 0))).toBe(1);
    expect(pieceAp(piece('a', 'player', 'pawn', 0, 0, { ap: 3 }))).toBe(3);
    expect(pieceMaxAp(piece('a', 'player', 'pawn', 0, 0))).toBe(1);
    expect(pieceMaxAp(piece('a', 'player', 'pawn', 0, 0, { ap: 2 }))).toBe(2);
    expect(pieceMaxAp(piece('a', 'player', 'pawn', 0, 0, { ap: 1, maxAp: 4 }))).toBe(4);
  });

  it('sideHasAp reflects remaining action points', () => {
    expect(sideHasAp(state([piece('a', 'player', 'pawn', 0, 0, { ap: 1 })]), 'player')).toBe(true);
    expect(sideHasAp(state([piece('a', 'player', 'pawn', 0, 0, { ap: 0 })]), 'player')).toBe(false);
    expect(sideHasAp(state([piece('a', 'player', 'pawn', 0, 0, { ap: 2 })]), 'enemy')).toBe(false);
  });
});

describe('applyMove AP turn model', () => {
  it('spends an AP and keeps the turn while the side still has AP', () => {
    const s = state([
      piece('kn', 'player', 'knight', 1, 1, { ap: 2, maxAp: 2 }),
      piece('rk', 'player', 'queen', 7, 7, { ap: 2, maxAp: 2 }),
      piece('foe', 'enemy', 'pawn', 4, 4, { ap: 0, maxAp: 1 }),
    ]);
    const { state: next } = applyMove(s, 'kn', { x: 2, y: 3 }, { ap: true });
    expect(next.pieces.find((p) => p.id === 'kn')!.ap).toBe(1);
    expect(next.turn).toBe('player'); // queen still has AP — side keeps acting
  });

  it('hands off and refreshes the incoming side once AP is exhausted', () => {
    const s = state([
      piece('kn', 'player', 'knight', 1, 1, { ap: 1, maxAp: 1 }),
      piece('foe', 'enemy', 'pawn', 4, 4, { ap: 0, maxAp: 3 }),
    ]);
    const { state: next } = applyMove(s, 'kn', { x: 2, y: 3 }, { ap: true });
    expect(next.pieces.find((p) => p.id === 'kn')!.ap).toBe(0);
    expect(next.turn).toBe('enemy');
    expect(next.pieces.find((p) => p.id === 'foe')!.ap).toBe(3); // refreshed to maxAp
  });

  it('spends AP on an attack-in-place (no displacement)', () => {
    const s = state([
      piece('rk', 'player', 'queen', 4, 4, { ap: 2, maxAp: 2 }),
      piece('pw', 'player', 'pawn', 0, 0, { ap: 2, maxAp: 2 }), // keeps side AP alive
      piece('tank', 'enemy', 'pawn', 4, 5, { hp: 2, maxHp: 2, ap: 0, maxAp: 1 }),
    ]);
    const { state: next } = applyMove(s, 'rk', { x: 4, y: 5, capture: 'tank' }, { ap: true });
    const rk = next.pieces.find((p) => p.id === 'rk')!;
    expect(rk).toMatchObject({ x: 4, y: 4, ap: 1 }); // stayed put, still spent an action
    expect(next.pieces.find((p) => p.id === 'tank')).toMatchObject({ alive: true, hp: 1 });
    expect(next.turn).toBe('player');
  });

  it('leaves AP untouched and flips the turn when AP mode is off', () => {
    const s = state([
      piece('kn', 'player', 'knight', 1, 1, { ap: 5, maxAp: 5 }),
      piece('foe', 'enemy', 'pawn', 4, 4),
    ]);
    const { state: next } = applyMove(s, 'kn', { x: 2, y: 3 });
    expect(next.pieces.find((p) => p.id === 'kn')!.ap).toBe(5); // unchanged
    expect(next.turn).toBe('enemy'); // classic single-action handoff
  });
});

describe('refreshAp / endTurn', () => {
  it('refreshAp restores a side to full AP', () => {
    const s = state([
      piece('a', 'player', 'pawn', 0, 0, { ap: 0, maxAp: 3 }),
      piece('b', 'enemy', 'pawn', 7, 7, { ap: 0, maxAp: 3 }),
    ]);
    const next = refreshAp(s, 'player');
    expect(next.pieces.find((p) => p.id === 'a')!.ap).toBe(3);
    expect(next.pieces.find((p) => p.id === 'b')!.ap).toBe(0); // enemy untouched
  });

  it('endTurn flips the side and refreshes the incoming AP', () => {
    const s = state([
      piece('a', 'player', 'pawn', 0, 0, { ap: 2, maxAp: 2 }),
      piece('b', 'enemy', 'pawn', 7, 7, { ap: 0, maxAp: 2 }),
    ], { turn: 'player' });
    const next = endTurn(s);
    expect(next.turn).toBe('enemy');
    expect(next.pieces.find((p) => p.id === 'b')!.ap).toBe(2);
  });

  it('endTurn is a no-op once the game is over', () => {
    const s = state([piece('a', 'player', 'pawn', 0, 0)], { turn: 'done', winner: 'player' });
    expect(endTurn(s)).toBe(s);
  });
});
