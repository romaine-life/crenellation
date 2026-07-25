import { describe, expect, it } from 'vitest';
import { countIllegalEdges, generateSocketBoard, solveSocketBoard } from './tileBoardGenerator';
import { transitionPairs } from './tileSockets';
import type { TerrainPairId, TileFamilyId, TileSocketAsset } from './tileSockets';
import type { FeatureKind, RoadMaterial } from './featureAutotile';

type FeatureEntry = { kind: FeatureKind; material: RoadMaterial };
const road = (material: RoadMaterial = 'stone'): FeatureEntry => ({ kind: 'road', material });

const grass: TileSocketAsset = { id: 'grass', kind: 'tile', role: 'base', probability: 1 };
const stone: TileSocketAsset = { id: 'stone', kind: 'tile', role: 'base', probability: 1 };
const water: TileSocketAsset = { id: 'water', kind: 'tile', role: 'base', probability: 1 };
const grassStoneNorth: TileSocketAsset = {
  id: 'grass-stone-n',
  kind: 'tile',
  role: 'transition',
  probability: 1,
  pairId: 'grass-stone',
  terrains: ['grass', 'stone'],
  socketMask: 0b0001,
};

const familyAssets: Record<TileFamilyId, TileSocketAsset[]> = {
  grass: [grass],
  stone: [stone],
  water: [water],
  dirt: [],
  pebble: [],
  sand: [],
};

describe('solveSocketBoard feature layer', () => {
  const grid = (cols: number, rows: number): TileFamilyId[] => Array.from({ length: cols * rows }, () => 'grass' as TileFamilyId);

  it('leaves cells featureless when no featureMap is given (back-compat)', () => {
    const board = solveSocketBoard({ assets: [grass], terrainMap: grid(4, 4), seed: 1, columns: 4, rows: 4, familyAssets });
    expect(board.cells.every((cell) => cell.feature === undefined)).toBe(true);
  });

  it('stamps each featured cell with its kind, material and connection mask, and leaves others bare', () => {
    // An L: (1,1)-(2,1) then down to (2,2). Bend at (2,1), dead-ends at the tips.
    const featureMap = new Map<string, FeatureEntry>([
      ['1,1', road('dirt')],
      ['2,1', road('dirt')],
      ['2,2', road('dirt')],
    ]);
    const board = solveSocketBoard({ assets: [grass], terrainMap: grid(4, 4), seed: 1, columns: 4, rows: 4, familyAssets, featureMap });
    const at = (x: number, y: number) => board.cells.find((cell) => cell.x === x && cell.y === y)!;
    expect(at(1, 1).feature).toEqual({ kind: 'road', material: 'dirt', mask: 0b0010 }); // E only
    expect(at(2, 2).feature).toEqual({ kind: 'road', material: 'dirt', mask: 0b0001 }); // N only
    expect(at(2, 1).feature).toEqual({ kind: 'road', material: 'dirt', mask: 0b1100 }); // S + W (the bend)
    expect(at(0, 0).feature).toBeUndefined();
  });

  it('connects roads of different materials (one shape; surface changes per cell)', () => {
    // (1,1) dirt next to (2,1) stone: they still see each other as road neighbours.
    const featureMap = new Map<string, FeatureEntry>([['1,1', road('dirt')], ['2,1', road('stone')]]);
    const board = solveSocketBoard({ assets: [grass], terrainMap: grid(4, 4), seed: 1, columns: 4, rows: 4, familyAssets, featureMap });
    const at = (x: number, y: number) => board.cells.find((cell) => cell.x === x && cell.y === y)!;
    expect(at(1, 1).feature).toEqual({ kind: 'road', material: 'dirt', mask: 0b0010 }); // sees E neighbour
    expect(at(2, 1).feature).toEqual({ kind: 'road', material: 'stone', mask: 0b1000 }); // sees W neighbour
  });

  it('does not let the feature layer disturb base-terrain selection', () => {
    const map = grid(4, 4);
    const plain = solveSocketBoard({ assets: [grass], terrainMap: map, seed: 7, columns: 4, rows: 4, familyAssets });
    const withRoad = solveSocketBoard({
      assets: [grass], terrainMap: map, seed: 7, columns: 4, rows: 4, familyAssets,
      featureMap: new Map<string, FeatureEntry>([['1,1', road()]]),
    });
    expect(withRoad.cells.map((cell) => cell.asset?.id)).toEqual(plain.cells.map((cell) => cell.asset?.id));
  });
});

describe('generateSocketBoard', () => {
  it('is deterministic for a seed', () => {
    const options = { assets: [grass, stone, grassStoneNorth], seed: 42, columns: 5, rows: 4, familyAssets };
    const first = generateSocketBoard(options).cells.map((cell) => cell.asset?.id ?? cell.missing?.label);
    const second = generateSocketBoard(options).cells.map((cell) => cell.asset?.id ?? cell.missing?.label);
    expect(first).toEqual(second);
  });

  it('keeps generated neighboring sockets legal when possible', () => {
    const board = generateSocketBoard({ assets: [grass, stone, grassStoneNorth], seed: 5, columns: 6, rows: 4, familyAssets });
    expect(board.stats.placed).toBe(24);
    expect(board.stats.illegalEdges).toBe(0);
    expect(board.stats.missingPlacements).toBeGreaterThanOrEqual(0);
  });

  it('falls back to the cell family base at hard edges instead of leaving gaps', () => {
    // No transition tiles in the catalog: a grass/stone boundary has no socket-legal tile,
    // so each cell falls back to its own family base (a hard edge) rather than a missing gap.
    const board = generateSocketBoard({ assets: [grass, stone], seed: 5, columns: 6, rows: 4, familyAssets });
    expect(board.stats.missingPlacements).toBe(0);
    expect(board.cells.every((cell) => cell.asset)).toBe(true);
  });

  it('counts illegal edges in explicit cell lists', () => {
    expect(countIllegalEdges([
      { x: 0, y: 0, asset: grass, terrain: 'grass', sockets: { north: 'grass', east: 'grass', south: 'grass', west: 'grass' } },
      { x: 1, y: 0, asset: stone, terrain: 'stone', sockets: { north: 'stone', east: 'stone', south: 'stone', west: 'stone' } },
    ], familyAssets)).toBe(1);
  });

  it('stress-tests complete mixed catalogs without illegal or unsupported placements', () => {
    const completeCatalog = [grass, stone, water, ...transitionAssetsForPairs(['grass-stone', 'grass-water', 'stone-water'])];

    for (let seed = 1; seed <= 80; seed += 1) {
      const board = generateSocketBoard({ assets: completeCatalog, seed, columns: 10, rows: 7, familyAssets });

      expect(board.stats.placed).toBe(70);
      expect(board.stats.illegalEdges).toBe(0);
      expect(board.stats.missingPlacements).toBe(0);
      expect(board.cells.some((cell) => cell.missing?.kind === 'unsupported-junction')).toBe(false);
    }
  });

  it('reports missing art without creating illegal neighbor edges', () => {
    const catalogWithMissingArt = [
      grass,
      stone,
      water,
      ...transitionAssetsForPairs(['grass-stone', 'grass-water']),
    ];

    for (let seed = 1; seed <= 40; seed += 1) {
      const board = generateSocketBoard({ assets: catalogWithMissingArt, seed, columns: 10, rows: 7, familyAssets });

      expect(board.stats.illegalEdges).toBe(0);
      expect(board.stats.missingPlacements).toBe(board.cells.filter((cell) => cell.missing).length);
      expect(board.cells.every((cell) => cell.missing?.kind !== 'unsupported-junction')).toBe(true);
    }
  });
});

function transitionAssetsForPairs(pairIds: TerrainPairId[]): TileSocketAsset[] {
  return transitionPairs
    .filter((pair) => pairIds.includes(pair.id))
    .flatMap((pair) =>
      Array.from({ length: 14 }, (_, index) => {
        const mask = index + 1;
        return {
          id: `${pair.id}-${mask.toString(2).padStart(4, '0')}`,
          kind: 'tile',
          role: 'transition',
          probability: 1,
          terrains: pair.terrains,
          pairId: pair.id,
          socketMask: mask,
        } satisfies TileSocketAsset;
      }),
    );
}
