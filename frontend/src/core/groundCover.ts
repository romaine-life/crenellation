// Ground cover — a general per-tile feature: ambient vegetation (grass tufts now,
// pebbles/reeds later) scattered ON a tile, keyed by terrain. NOT a doodad (a
// doodad is a discrete prop you place); this is a density attribute of the tile,
// resolved to concrete tufts ONCE when the tile is placed/built — never per render.
//
// Authored art (the baked tuft sheets) + procedural PLACEMENT (this file): every
// game separates the two. Sheets + the typed manifest are produced by
// scripts/build-groundcover.mjs.

import type { TileFamilyId } from './tileSockets';
import grassManifest from '../art/groundcover/grass.generated';
import waterManifest from '../art/groundcover/water.generated';
import sandManifest from '../art/groundcover/sand.generated';

export type GroundCoverDensity = 'sparse' | 'filled';

/** One scattered tuft, in cell-local board px relative to the tile contact point. */
export interface TuftInstance {
  dx: number;
  dy: number;
  variant: number;
  flip: boolean;
  phase: number; // 0..5, staggers the sway so a field never pulses in unison
}

/** Resolved at placement and cached on the cell; the toggle/value persisted is just `density`. */
export interface GroundCover {
  density: GroundCoverDensity;
  tufts: TuftInstance[];
}

export interface CoverVariantMeta {
  id: number;
  frameW: number;
  frameH: number;
  baseX: number;
  baseY: number;
  w: number;
}
export interface CoverSet {
  terrain: string;
  frameCount: number;
  basePath: string;
  variants: CoverVariantMeta[];
  /** Only place on a tile that borders a DIFFERENT terrain (e.g. reeds at the water's edge). */
  edgeOnly?: boolean;
  /** Instances per tile by density. Defaults to grass's {sparse:3, filled:7}; pebble/reed
   *  CLUSTERS each already hold several rocks/stalks, so they need far fewer than grass blades. */
  count?: Record<GroundCoverDensity, number>;
}

// Registry keyed by terrain family. Grass is the first set; add stone/water/etc.
// by committing sources + re-running the bake and registering the manifest here.
const SETS: Partial<Record<TileFamilyId, CoverSet>> = {
  grass: { ...grassManifest, basePath: '/assets/groundcover/grass' } as unknown as CoverSet,
  water: { ...waterManifest, basePath: '/assets/groundcover/water', edgeOnly: true, count: { sparse: 2, filled: 3 } } as unknown as CoverSet,
  sand: { ...sandManifest, basePath: '/assets/groundcover/sand', count: { sparse: 2, filled: 4 } } as unknown as CoverSet,
};

export function groundCoverSet(terrain: TileFamilyId): CoverSet | undefined {
  return SETS[terrain];
}

// --- deterministic scatter (per tile) ------------------------------------------
// The tile top-diamond, in board px relative to the contact point (48,69): half
// width 46, half height 26. We scatter a few tufts inside it with a min-distance
// rule (even-but-random — blue-noise in miniature), deterministic from cell+seed.

const DIAMOND_HW = 44;
const DIAMOND_HH = 24;
const inDiamond = (dx: number, dy: number) => Math.abs(dx) / 46 + Math.abs(dy) / 26 <= 1;

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNT: Record<GroundCoverDensity, number> = { sparse: 3, filled: 7 };
const MIN_DIST: Record<GroundCoverDensity, number> = { sparse: 17, filled: 11 };

/** Roll the tufts for one cell. Deterministic from (terrain, x, y, seed, density). */
export function rollGroundCover(
  terrain: TileFamilyId,
  x: number,
  y: number,
  seed: number,
  density: GroundCoverDensity,
): TuftInstance[] {
  const set = SETS[terrain];
  if (!set || set.variants.length === 0) return [];
  const rnd = mulberry((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(seed, 83492791)) >>> 0);
  const target = (set.count ?? COUNT)[density];
  const minD = MIN_DIST[density];
  const tufts: TuftInstance[] = [];
  for (let tries = 0; tufts.length < target && tries < target * 14; tries += 1) {
    const dx = Math.round((rnd() * 2 - 1) * DIAMOND_HW);
    const dy = Math.round((rnd() * 2 - 1) * DIAMOND_HH);
    if (!inDiamond(dx, dy)) continue;
    // weight dy in the spacing test for the iso foreshortening so clumps read even
    if (tufts.some((t) => { const a = t.dx - dx, b = (t.dy - dy) * 1.7; return a * a + b * b < minD * minD; })) continue;
    tufts.push({
      dx,
      dy,
      variant: set.variants[Math.floor(rnd() * set.variants.length)].id,
      flip: rnd() > 0.5,
      phase: Math.floor(rnd() * 6),
    });
  }
  // back-to-front within the cell so overlapping tufts stack correctly
  tufts.sort((a, b) => a.dy - b.dy);
  return tufts;
}

// --- density field (for generated boards, where nobody painted a density) ------
// A low-frequency value-noise field decides each grass tile's default cover:
// patches of filled, stretches of sparse, and honest bare ground (null).

const hash2 = (ix: number, iy: number, s: number) => {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 2654435761)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Cell-resolution density field (lattice ~5 tiles). Returns a density or null (bare). */
export function densityFieldAt(x: number, y: number, seed: number): GroundCoverDensity | null {
  const L = 5;
  const ix = Math.floor(x / L), iy = Math.floor(y / L), tx = x / L - ix, ty = y / L - iy;
  const sx = smooth(tx), sy = smooth(ty);
  const v = hash2(ix, iy, seed) * (1 - sx) * (1 - sy)
    + hash2(ix + 1, iy, seed) * sx * (1 - sy)
    + hash2(ix, iy + 1, seed) * (1 - sx) * sy
    + hash2(ix + 1, iy + 1, seed) * sx * sy;
  if (v < 0.42) return null;       // bare ground
  if (v > 0.72) return 'filled';   // dense patch
  return 'sparse';
}

/** A board cell carrying terrain + position, the minimum `resolveGroundCover` needs. */
interface CoverCell {
  x: number;
  y: number;
  terrain: TileFamilyId;
  groundCover?: GroundCover;
}

/**
 * Resolve cover onto each cell ONCE (at board build, not render). `densityFor`
 * supplies the per-cell density (painted level value, or the density field for a
 * generated board); return null to leave a cell bare.
 */
export function resolveGroundCover<T extends CoverCell>(
  cells: T[],
  seed: number,
  densityFor: (cell: T) => GroundCoverDensity | null,
): void {
  const terrainAt = new Map(cells.map((c) => [`${c.x},${c.y}`, c.terrain]));
  const bordersOther = (c: T): boolean =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const n = terrainAt.get(`${c.x + dx},${c.y + dy}`);
      return n !== undefined && n !== c.terrain;
    });
  for (const cell of cells) {
    const set = SETS[cell.terrain];
    if (!set) continue;
    // Edge-only cover (reeds) sits at the shoreline, not in open water.
    if (set.edgeOnly && !bordersOther(cell)) { cell.groundCover = undefined; continue; }
    const density = densityFor(cell);
    if (!density) { cell.groundCover = undefined; continue; }
    cell.groundCover = { density, tufts: rollGroundCover(cell.terrain, cell.x, cell.y, seed, density) };
  }
}
