import { describe, it, expect } from 'vitest';
import { createSkirmish } from './setup';
import { livingPieces } from '../core/rules';
import { isPassableTerrain } from '../core/terrain';
import { tileAssets, tileFamilies } from '../art/tileset';
import { solveSocketBoard } from '../core/tileBoardGenerator';
import type { TerrainType } from '../core/types';
import type { TileFamilyId } from '../core/tileSockets';

const terrainToFamily: Record<TerrainType, TileFamilyId> = {
  grass: 'grass',
  road: 'stone',
  stone: 'stone',
  bridge: 'stone',
  cliff: 'stone',
  rock: 'stone',
  water: 'water',
  dirt: 'dirt',
  pebble: 'pebble',
  sand: 'sand',
};

describe('createSkirmish', () => {
  it('is deterministic for a given seed', () => {
    expect(createSkirmish({ seed: 42 })).toEqual(createSkirmish({ seed: 42 }));
  });
  it('differs across seeds', () => {
    const a = JSON.stringify(createSkirmish({ seed: 1 }).pieces.map((p) => [p.x, p.y]));
    const b = JSON.stringify(createSkirmish({ seed: 2 }).pieces.map((p) => [p.x, p.y]));
    expect(a).not.toBe(b);
  });
  it('fields the player party + a pawn, three enemies, and 3-6 rocks', () => {
    const s = createSkirmish({ seed: 7, party: ['knight', 'bishop'] });
    expect(livingPieces(s.pieces, 'player')).toHaveLength(3);
    expect(livingPieces(s.pieces, 'enemy')).toHaveLength(3);
    const rocks = s.pieces.filter((p) => p.type === 'rock');
    expect(rocks.length).toBeGreaterThanOrEqual(3);
    expect(rocks.length).toBeLessThanOrEqual(6);
    expect(s.turn).toBe('player');
    expect(s.winner).toBeNull();
  });
  it('places every piece in-bounds with no overlaps', () => {
    const s = createSkirmish({ seed: 99 });
    const seen = new Set<string>();
    for (const p of s.pieces) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(s.size.cols);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(s.size.rows);
      const key = `${p.x},${p.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
  it('spawns players near the bottom and enemies near the top', () => {
    const s = createSkirmish({ seed: 5 });
    for (const p of livingPieces(s.pieces, 'player')) expect(p.y).toBeGreaterThanOrEqual(s.size.rows - 2);
    for (const p of livingPieces(s.pieces, 'enemy')) expect(p.y).toBeLessThanOrEqual(1);
  });

  it('spawns opposing sides facing each other across the board', () => {
    const s = createSkirmish({ seed: 5 });
    for (const p of livingPieces(s.pieces, 'player')) expect(p.facing).toBe('north');
    for (const p of livingPieces(s.pieces, 'enemy')) expect(p.facing).toBe('south');
  });

  it('marks spawned pawns as being on their home rank', () => {
    for (const seed of [1, 2, 5, 7, 13, 42, 99]) {
      const s = createSkirmish({ seed });
      for (const pawn of s.pieces.filter((p) => p.type === 'pawn')) {
        expect(pawn.startY).toBe(pawn.y);
      }
    }
  });

  it('authors a full terrain grid (one cell per tile)', () => {
    const s = createSkirmish({ seed: 7 });
    expect(s.terrain).toBeDefined();
    expect(s.terrain).toHaveLength(s.size.cols * s.size.rows);
    const keys = new Set(s.terrain!.map((c) => `${c.x},${c.y}`));
    expect(keys.size).toBe(s.size.cols * s.size.rows); // no duplicate/missing tiles
    for (const c of s.terrain!) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThan(s.size.cols);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThan(s.size.rows);
    }
  });

  it('never spawns a piece on impassable terrain', () => {
    for (const seed of [1, 2, 7, 42, 99]) {
      const s = createSkirmish({ seed });
      const impassable = new Set(
        s.terrain!.filter((c) => !isPassableTerrain(c.terrain)).map((c) => `${c.x},${c.y}`),
      );
      for (const p of s.pieces) expect(impassable.has(`${p.x},${p.y}`)).toBe(false);
    }
  });

  it('authors terrain that resolves to a legal socket board', () => {
    for (const seed of [1, 7, 13, 42, 99]) {
      const s = createSkirmish({ seed });
      const terrainMap = s.terrain!.map((cell) => terrainToFamily[cell.terrain]);
      const board = solveSocketBoard({
        assets: tileAssets,
        terrainMap,
        seed,
        columns: s.size.cols,
        rows: s.size.rows,
        familyAssets: tileFamilies,
      });
      expect(board.stats.illegalEdges).toBe(0);
      expect(board.stats.missingPlacements).toBe(0);
    }
  });
});
