import { describe, it, expect } from 'vitest';
import { applyMove, chooseEnemyMove, forecastEnemyIntents, withForecast, pieceHp, legalMoves } from './rules';
import type { GameState, Piece, PieceType, Side } from './types';

function piece(id: string, side: Side, type: PieceType, x: number, y: number, extra: Partial<Piece> = {}): Piece {
  return { id, side, type, x, y, alive: true, startY: y, ...extra };
}

function state(pieces: Piece[], over: Partial<GameState> = {}): GameState {
  return { size: { cols: 8, rows: 8 }, pieces, turn: 'player', winner: null, ...over };
}

describe('pieceHp', () => {
  it('defaults to 1 when hp is unset', () => {
    expect(pieceHp(piece('a', 'enemy', 'pawn', 0, 0))).toBe(1);
    expect(pieceHp(piece('a', 'enemy', 'pawn', 0, 0, { hp: 3 }))).toBe(3);
  });
});

describe('forecastEnemyIntents', () => {
  it('is deterministic — identical output across calls', () => {
    const s = state([
      piece('p1', 'player', 'pawn', 3, 6),
      piece('e1', 'enemy', 'queen', 4, 4),
      piece('e2', 'enemy', 'knight', 1, 1),
    ]);
    expect(forecastEnemyIntents(s)).toEqual(forecastEnemyIntents(s));
  });

  it('telegraphs an attack on a reachable player target', () => {
    const s = state([
      piece('queen', 'enemy', 'queen', 4, 4),
      piece('victim', 'player', 'pawn', 4, 6),
    ]);
    const intents = forecastEnemyIntents(s);
    const queenIntent = intents.find((i) => i.pieceId === 'queen');
    expect(queenIntent).toMatchObject({ kind: 'attack', targetId: 'victim', to: { x: 4, y: 6 }, damage: 1 });
  });

  it('prefers the higher-value capture', () => {
    const s = state([
      piece('q', 'enemy', 'queen', 4, 4),
      piece('queen', 'player', 'queen', 4, 6), // value 5, straight down
      piece('pawn', 'player', 'pawn', 6, 4), // value 1, straight right
    ]);
    const intent = forecastEnemyIntents(s).find((i) => i.pieceId === 'q');
    expect(intent).toMatchObject({ kind: 'attack', targetId: 'queen' });
  });

  it('advances toward the nearest player when no capture is available', () => {
    const s = state([
      piece('e', 'enemy', 'pawn', 3, 1, { startY: 1 }),
      piece('p', 'player', 'pawn', 3, 6),
    ]);
    const intent = forecastEnemyIntents(s).find((i) => i.pieceId === 'e');
    // Double-step is the legal move that closes the most distance to the player.
    expect(intent).toMatchObject({ kind: 'move', to: { x: 3, y: 3 } });
  });

  it('withForecast attaches intents to the state', () => {
    const s = state([
      piece('queen', 'enemy', 'queen', 4, 4),
      piece('victim', 'player', 'pawn', 4, 6),
    ]);
    const next = withForecast(s);
    expect(next.intents).toHaveLength(1);
    expect(next.intents![0]).toMatchObject({ pieceId: 'queen', kind: 'attack' });
  });

  it('chooseEnemyMove returns null with no moves', () => {
    expect(chooseEnemyMove(piece('e', 'enemy', 'rock', 0, 0), [], state([]))).toBeNull();
  });
});

describe('applyMove with hp', () => {
  it('damages a multi-hp target without displacing the attacker (attack-in-place)', () => {
    const s = state([
      piece('queen', 'player', 'queen', 4, 4),
      piece('tank', 'enemy', 'pawn', 4, 5, { hp: 2, maxHp: 2 }),
    ]);
    const { state: next, events } = applyMove(s, 'queen', { x: 4, y: 5, capture: 'tank' });
    const queen = next.pieces.find((p) => p.id === 'queen')!;
    const tank = next.pieces.find((p) => p.id === 'tank')!;
    expect(queen).toMatchObject({ x: 4, y: 4 }); // did not move onto the square
    expect(tank).toMatchObject({ alive: true, hp: 1 });
    expect(events).toContainEqual({ kind: 'damaged', pieceId: 'tank', by: 'queen', amount: 1, hp: 1 });
    expect(events.some((e) => e.kind === 'moved')).toBe(false);
    expect(next.turn).toBe('enemy'); // turn still passes
  });

  it('kills a 1-hp target and displaces onto the square (classic capture)', () => {
    const s = state([
      piece('queen', 'player', 'queen', 4, 4),
      piece('foe', 'enemy', 'pawn', 4, 5),
    ]);
    const { state: next, events } = applyMove(s, 'queen', { x: 4, y: 5, capture: 'foe' });
    expect(next.pieces.find((p) => p.id === 'queen')).toMatchObject({ x: 4, y: 5 });
    expect(next.pieces.find((p) => p.id === 'foe')).toMatchObject({ alive: false });
    expect(events.some((e) => e.kind === 'captured')).toBe(true);
    expect(events.some((e) => e.kind === 'moved')).toBe(true);
  });
});
