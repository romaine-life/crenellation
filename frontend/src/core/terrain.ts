// Terrain movement effects (issue #44 Track 4): cliffs/rocks block movement and
// elevation limits where a piece can step — the isometric multi-height axis from
// the concepts. Pure + deterministic, built from a level's terrain layer and fed
// into movement generation as an optional environment so terrain-free callers are
// completely unaffected.

import type { TerrainCell, TerrainType, Vec } from './types';

export interface TerrainInfo {
  terrain: TerrainType;
  elevation: number;
}

export type TerrainIndex = ReadonlyMap<string, TerrainInfo>;

export const terrainKey = (x: number, y: number): string => `${x},${y}`;

/** Index a terrain layer by "x,y" for O(1) lookups during movement generation. */
export function buildTerrainIndex(cells: readonly TerrainCell[]): TerrainIndex {
  const map = new Map<string, TerrainInfo>();
  for (const c of cells) map.set(terrainKey(c.x, c.y), { terrain: c.terrain, elevation: c.elevation });
  return map;
}

export function terrainAt(index: TerrainIndex, x: number, y: number): TerrainInfo | null {
  return index.get(terrainKey(x, y)) ?? null;
}

export function elevationAt(index: TerrainIndex, x: number, y: number): number {
  return terrainAt(index, x, y)?.elevation ?? 0;
}

// Tiles a piece can never stand on. Water is just a board surface; `cliff` and
// `rock` are the blocking terrain families.
const IMPASSABLE: ReadonlySet<TerrainType> = new Set<TerrainType>(['cliff', 'rock']);

export function isPassableTerrain(t: TerrainType): boolean {
  return !IMPASSABLE.has(t);
}

/** Max elevation a piece may climb in a single step; greater rises are walls. */
export const MAX_CLIMB = 1;

/**
 * Whether a piece whose origin tile sits at `originElevation` may move INTO the
 * cell at (x, y). Unauthored cells are treated as open ground (elevation 0) so a
 * partial terrain layer never traps pieces. A cell blocks traversal when its
 * terrain is impassable or it rises more than `MAX_CLIMB` above the origin —
 * descents are always allowed (you can drop off a ledge, not scale a cliff).
 */
export function canTraverse(index: TerrainIndex, originElevation: number, x: number, y: number): boolean {
  const cell = terrainAt(index, x, y);
  if (!cell) return true;
  if (!isPassableTerrain(cell.terrain)) return false;
  return cell.elevation - originElevation <= MAX_CLIMB;
}

/** Convenience: traverse-check using a Vec origin (its authored elevation). */
export function canTraverseFrom(index: TerrainIndex, from: Vec, to: Vec): boolean {
  return canTraverse(index, elevationAt(index, from.x, from.y), to.x, to.y);
}
