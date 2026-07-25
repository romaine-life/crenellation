import { createRng } from './rng';
import type { GroundCover } from './groundCover';
import type { EdgeName, EdgeSockets, TerrainPairId, TileFamilyId, TileSocketAsset } from './tileSockets';
import { baseSocketsForFamily, familyIdForAsset, tileSocketsForAsset, transitionPairs } from './tileSockets';
import type { FeatureKind, FeatureMaterial } from './featureAutotile';
import { featureKey, featureMaskAt } from './featureAutotile';

export interface SocketBoardCell<TAsset extends TileSocketAsset = TileSocketAsset> {
  x: number;
  y: number;
  /** The TOP tile for this cell (the walkable surface; also the default SIDE). */
  asset?: TAsset;
  /**
   * Optional independent SIDE layer (ADR-0039). When set, the renderer composes this asset's
   * `-side` under `asset`'s `-top`, so the side (frayed edge, future river/waterfall) varies
   * independently of the top. Unset ⇒ the side comes from `asset` itself (the normal cube).
   */
  sideAsset?: TAsset;
  /** Phase 2: set when this cell's side is part of a multi-tile story feature (fossil, ruins). */
  edgeFeatureId?: string;
  sockets: EdgeSockets;
  terrain: TileFamilyId;
  /** Ambient vegetation resolved at board build (see core/groundCover). Not per-render. */
  groundCover?: GroundCover;
  /**
   * A linear-feature overlay (road; rivers later) riding ON TOP of the base tile.
   * Orthogonal to socket selection — it never affects which base `asset` is chosen.
   * `mask` is the 4-bit connection mask; the renderer maps {kind, material, mask} to a sprite.
   */
  feature?: { kind: FeatureKind; material: FeatureMaterial; mask: number };
  missing?: {
    kind: 'missing-art' | 'unsupported-junction';
    label: string;
    pairId?: TerrainPairId;
    mask?: number;
    families: TileFamilyId[];
  };
}

export interface SocketBoardFallback {
  x: number;
  y: number;
  requiredNorth?: TileFamilyId;
  requiredWest?: TileFamilyId;
  candidateCount: number;
}

export interface SocketBoardStats {
  placed: number;
  missingPlacements: number;
  illegalEdges: number;
  candidateAssets: number;
}

export interface SocketBoardResult<TAsset extends TileSocketAsset = TileSocketAsset> {
  cells: SocketBoardCell<TAsset>[];
  fallbacks: SocketBoardFallback[];
  stats: SocketBoardStats;
}

export interface SocketBoardOptions<TAsset extends TileSocketAsset> {
  assets: readonly TAsset[];
  seed: number;
  columns: number;
  rows: number;
  familyAssets: Record<TileFamilyId, readonly TAsset[]>;
}

const oppositeEdges: Array<[EdgeName, EdgeName]> = [
  ['east', 'west'],
  ['south', 'north'],
];

export function pickWeightedAsset<TAsset extends TileSocketAsset>(assets: readonly TAsset[], next: () => number): TAsset {
  const total = assets.reduce((sum, asset) => sum + Math.max(0.05, asset.probability), 0);
  let cursor = next() * total;
  for (const asset of assets) {
    cursor -= Math.max(0.05, asset.probability);
    if (cursor <= 0) return asset;
  }
  return assets[assets.length - 1];
}

export function countIllegalEdges<TAsset extends TileSocketAsset>(
  cells: readonly SocketBoardCell<TAsset>[],
  familyAssets: Record<TileFamilyId, readonly TAsset[]>,
): number {
  const cellAt = new Map(cells.map((cell) => [`${cell.x}-${cell.y}`, cell]));
  return cells.reduce((count, cell) => {
    const east = cellAt.get(`${cell.x + 1}-${cell.y}`);
    const south = cellAt.get(`${cell.x}-${cell.y + 1}`);
    const eastMismatch = east && cell.sockets[oppositeEdges[0][0]] !== east.sockets[oppositeEdges[0][1]] ? 1 : 0;
    const southMismatch = south && cell.sockets[oppositeEdges[1][0]] !== south.sockets[oppositeEdges[1][1]] ? 1 : 0;
    return count + eastMismatch + southMismatch;
  }, 0);
}

function assetFamily<TAsset extends TileSocketAsset>(asset: TAsset, familyAssets: Record<TileFamilyId, readonly TAsset[]>): TileFamilyId {
  return familyIdForAsset(asset, familyAssets);
}

function terrainFamiliesForAssets<TAsset extends TileSocketAsset>(assets: readonly TAsset[], familyAssets: Record<TileFamilyId, readonly TAsset[]>): TileFamilyId[] {
  const families = new Set<TileFamilyId>();
  assets.forEach((asset) => {
    if (asset.kind !== 'tile' || asset.probability <= 0) return;
    if (asset.terrains) {
      asset.terrains.forEach((terrain) => families.add(terrain));
    } else {
      families.add(assetFamily(asset, familyAssets));
    }
  });
  return [...families];
}

function generateTerrainMap(families: readonly TileFamilyId[], seed: number, columns: number, rows: number): TileFamilyId[] {
  if (families.length <= 1) return Array.from({ length: columns * rows }, () => families[0] ?? 'grass');
  const rng = createRng(seed);
  const anchors = families.flatMap((family) =>
    Array.from({ length: 2 }, () => ({
      family,
      x: rng.int(columns),
      y: rng.int(rows),
      bias: rng.next() * 2.4,
    })),
  );
  return Array.from({ length: columns * rows }, (_, index) => {
    const y = Math.floor(index / columns);
    const x = index % columns;
    const best = anchors.reduce((winner, anchor) => {
      const distance = Math.abs(anchor.x - x) + Math.abs(anchor.y - y) + anchor.bias;
      return distance < winner.distance ? { family: anchor.family, distance } : winner;
    }, { family: families[0], distance: Number.POSITIVE_INFINITY });
    return best.family;
  });
}

function terrainAt(map: readonly TileFamilyId[], x: number, y: number, columns: number, rows: number): TileFamilyId | undefined {
  if (x < 0 || y < 0 || x >= columns || y >= rows) return undefined;
  return map[y * columns + x];
}

function boundaryChoice(a: TileFamilyId, b: TileFamilyId, x: number, y: number, seed: number): TileFamilyId {
  if (a === b) return a;
  const n = (x * 374761393 + y * 668265263 + seed * 1442695041) >>> 0;
  return (n ^ (n >>> 13)) % 2 === 0 ? a : b;
}

function compatibleEdgeFamilies(
  knownEdges: readonly TileFamilyId[],
  preferredEdges: readonly TileFamilyId[],
  center: TileFamilyId,
  x: number,
  y: number,
  seed: number,
): Set<TileFamilyId> {
  const allowed = new Set(knownEdges);
  if (allowed.size >= 2) return allowed;
  if (allowed.size === 0) allowed.add(center);

  const [only] = allowed;
  const preferredBoundary = preferredEdges.find((family) => family !== only);
  const alternate = preferredBoundary ?? (center !== only ? center : only);
  if (alternate !== only) {
    const chosenAlternate = preferredEdges.length > 1 && preferredEdges[0] !== preferredEdges[1]
      ? boundaryChoice(preferredEdges[0], preferredEdges[1], x, y, seed)
      : alternate;
    allowed.add(chosenAlternate);
  }
  return allowed;
}

function compatibleEdgeValue(preferred: TileFamilyId, allowed: ReadonlySet<TileFamilyId>, x: number, y: number, seed: number): TileFamilyId {
  if (allowed.has(preferred)) return preferred;
  const families = [...allowed];
  if (families.length <= 1) return families[0] ?? preferred;
  return boundaryChoice(families[0], families[1], x, y, seed);
}

function buildSocketGrid(map: readonly TileFamilyId[], columns: number, rows: number, seed: number): EdgeSockets[] {
  const horizontalEdges: TileFamilyId[][] = Array.from({ length: rows + 1 }, () => Array<TileFamilyId>(columns));
  const verticalEdges: TileFamilyId[][] = Array.from({ length: rows }, () => Array<TileFamilyId>(columns + 1));

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const center = terrainAt(map, x, y, columns, rows) ?? 'grass';
      if (y === 0) horizontalEdges[y][x] = center;
      if (x === 0) verticalEdges[y][x] = center;

      const eastTerrain = terrainAt(map, x + 1, y, columns, rows);
      const southTerrain = terrainAt(map, x, y + 1, columns, rows);
      const preferredEast = eastTerrain ? boundaryChoice(center, eastTerrain, x + 1, y, seed + 43) : center;
      const preferredSouth = southTerrain ? boundaryChoice(center, southTerrain, x, y + 1, seed + 17) : center;
      const allowed = compatibleEdgeFamilies(
        [horizontalEdges[y][x], verticalEdges[y][x]],
        [preferredEast, preferredSouth],
        center,
        x,
        y,
        seed + 71,
      );

      verticalEdges[y][x + 1] = compatibleEdgeValue(preferredEast, allowed, x + 1, y, seed + 89);
      horizontalEdges[y + 1][x] = compatibleEdgeValue(preferredSouth, allowed, x, y + 1, seed + 107);
    }
  }

  return Array.from({ length: columns * rows }, (_, index) => {
    const y = Math.floor(index / columns);
    const x = index % columns;
    return {
      north: horizontalEdges[y][x],
      east: verticalEdges[y][x + 1],
      south: horizontalEdges[y + 1][x],
      west: verticalEdges[y][x],
    };
  });
}

function pairForFamilies(families: readonly TileFamilyId[]) {
  return transitionPairs.find((pair) => families.every((family) => pair.terrains.includes(family)));
}

function assetMatchesSockets<TAsset extends TileSocketAsset>(asset: TAsset, sockets: EdgeSockets, familyAssets: Record<TileFamilyId, readonly TAsset[]>): boolean {
  const assetSockets = tileSocketsForAsset(asset, familyAssets);
  return assetSockets.north === sockets.north && assetSockets.east === sockets.east && assetSockets.south === sockets.south && assetSockets.west === sockets.west;
}

function missingForSockets(sockets: EdgeSockets): SocketBoardCell['missing'] {
  const families = [...new Set(Object.values(sockets))];
  if (families.length <= 1) {
    return { kind: 'missing-art', label: `${families[0]} base`, families };
  }
  const pair = pairForFamilies(families);
  if (!pair) {
    return { kind: 'unsupported-junction', label: `${families.join('-')} junction`, families };
  }
  const mask = pair.terrains.reduce((bits, family, pairIndex) => {
    if (pairIndex !== 0) return bits;
    return (Object.entries(sockets) as Array<[EdgeName, TileFamilyId]>).reduce((edgeBits, [edge, socketFamily], edgeIndex) => {
      return socketFamily === family ? edgeBits | (1 << edgeIndex) : edgeBits;
    }, bits);
  }, 0);
  return { kind: 'missing-art', label: `${pair.label} ${mask.toString(2).padStart(4, '0')}`, pairId: pair.id, mask, families };
}

/**
 * A multi-tile STORY FEATURE (Phase 2): a set-piece (dino fossil, buried ruins) baked as one
 * wide cliff image and sliced into ordered side `pieces` (head→tail). The solver lays it along
 * a straight board edge and substitutes `cap` (a clean terminator) for the piece that would
 * otherwise clip at the corner / board end. `families` restricts which terrains it suits.
 */
export interface EdgeFeatureSpec<TAsset extends TileSocketAsset = TileSocketAsset> {
  id: string;
  pieces: TAsset[];
  cap: TAsset;
  families?: TileFamilyId[];
}

export interface SolveSocketBoardOptions<TAsset extends TileSocketAsset> {
  assets: readonly TAsset[];
  /** Painted terrain family per cell, row-major (length must be columns * rows). */
  terrainMap: readonly TileFamilyId[];
  seed: number;
  columns: number;
  rows: number;
  familyAssets: Record<TileFamilyId, readonly TAsset[]>;
  /**
   * Sparse linear-feature layer: cell key ("x,y") -> {kind, material}. Optional and
   * orthogonal to `terrainMap`; cells in here get a `feature` with the connection
   * mask resolved from same-kind neighbours. Omit it for the original behaviour.
   */
  featureMap?: ReadonlyMap<string, { kind: FeatureKind; material: FeatureMaterial }>;
  /**
   * Optional per-family edge tiles. When supplied, any cell on a FRONT screen edge
   * (`x === columns - 1` or `y === rows - 1` — the void-facing rows in `x+y` paint order)
   * gets the family's edge tile as its independent SIDE layer (ADR-0039), so the outer ring
   * frays while keeping its own top variant. The top (`asset`) and sockets are untouched, so
   * terrain and adjacency are unchanged — only the cliff face changes.
   */
  edgeAssets?: Partial<Record<TileFamilyId, TAsset[]>>;
  /**
   * Optional per-family ORDERED continuity-mural windows (ADR-0039). When a family is present
   * here, its void-facing edge cells get a SEQUENTIAL window by run-position instead of the
   * random `edgeAssets` variant — so the cliff FLOWS continuously across adjacent tiles. The
   * run wraps the bottom corner: the right edge (p = y) continues into the bottom edge. A
   * family absent here falls back to `edgeAssets`. Index order == window order.
   */
  muralEdges?: Partial<Record<TileFamilyId, TAsset[]>>;
  /**
   * Optional multi-tile STORY FEATURES (Phase 2). Sparse set-pieces laid head→tail along the
   * straight board edges, OVERRIDING the mural side, with a clean terminator when they'd clip.
   */
  edgeFeatures?: EdgeFeatureSpec<TAsset>[];
}

/**
 * Resolve a board from an explicit (e.g. hand-painted) terrain map, reusing the
 * exact socket-legality contract that the random generator uses. Each shared
 * edge is written once, so adjacency is always internally consistent; cells whose
 * resolved sockets have no matching asset (3-family junctions, unmade transition
 * art) come back marked `missing` instead of guessing an illegal tile.
 */
export function solveSocketBoard<TAsset extends TileSocketAsset>({
  assets,
  terrainMap,
  seed,
  columns,
  rows,
  familyAssets,
  featureMap,
  edgeAssets,
  muralEdges,
  edgeFeatures,
}: SolveSocketBoardOptions<TAsset>): SocketBoardResult<TAsset> {
  const usableAssets = assets.filter((asset) => asset.kind === 'tile' && asset.probability > 0);
  const boardAssets = usableAssets.length > 0 ? usableAssets : assets.filter((asset) => asset.kind === 'tile');
  const rng = createRng(seed + 99);
  const socketGrid = buildSocketGrid(terrainMap, columns, rows, seed);
  const cells: SocketBoardCell<TAsset>[] = [];
  const fallbacks: SocketBoardFallback[] = [];

  // Group featured cells by kind once, so each cell's connection mask is resolved
  // against only its OWN kind's neighbours (a road connects to roads, not rivers).
  // Material is per-cell and does NOT split connectivity — all roads connect.
  const featurePresence = new Map<FeatureKind, Set<string>>();
  if (featureMap) {
    for (const [key, { kind }] of featureMap) {
      const set = featurePresence.get(kind) ?? new Set<string>();
      set.add(key);
      featurePresence.set(kind, set);
    }
  }
  const featureAt = (x: number, y: number): SocketBoardCell<TAsset>['feature'] => {
    const entry = featureMap?.get(featureKey(x, y));
    if (!entry) return undefined;
    return { kind: entry.kind, material: entry.material, mask: featureMaskAt(featurePresence.get(entry.kind)!, x, y) };
  };

  for (let index = 0; index < columns * rows; index += 1) {
    const y = Math.floor(index / columns);
    const x = index % columns;
    const terrain = terrainAt(terrainMap, x, y, columns, rows) ?? 'grass';
    const sockets = socketGrid[index];
    const feature = featureAt(x, y);
    const candidates = boardAssets.filter((asset) => assetMatchesSockets(asset, sockets, familyAssets));
    if (candidates.length > 0) {
      cells.push({ x, y, sockets, terrain, feature, asset: pickWeightedAsset(candidates, rng.next) });
      continue;
    }
    // Hard edge: no socket-legal tile (a terrain boundary with no transition asset).
    // Fall back to the cell's own family base/variants so the tile butts up directly
    // instead of leaving a gap. The socket mismatch at the seam is intentional.
    const familyTiles = (familyAssets[terrain] ?? []).filter((asset) => asset.kind === 'tile' && asset.probability > 0) as TAsset[];
    if (familyTiles.length > 0) {
      cells.push({ x, y, sockets, terrain, feature, asset: pickWeightedAsset(familyTiles, rng.next) });
    } else {
      const missing = missingForSockets(sockets);
      fallbacks.push({ x, y, requiredNorth: sockets.north, requiredWest: sockets.west, candidateCount: candidates.length });
      cells.push({ x, y, sockets, terrain, feature, missing });
    }
  }

  // Give front-edge cells a rich SIDE layer (ADR-0039). Two strategies, per family:
  //  • CONTINUITY MURAL (muralEdges): consecutive cells get consecutive ORDERED windows of one
  //    wide cliff, so the geology FLOWS across tiles. Run-position wraps the bottom corner —
  //    the right edge (p = y, top→bottom corner) continues into the bottom edge
  //    (p = rows-1 + (columns-1 - x), bottom corner→left corner) as one unbroken count.
  //  • RANDOM VARIANT (edgeAssets): a weighted, anti-adjacent pick — rich but non-continuous.
  // Either keeps each cell's own top + sockets, so legality and the stats below are unaffected.
  if (edgeAssets || muralEdges) {
    const edgeRng = createRng(seed + 271);
    const sideById = new Map<string, string>();
    for (const cell of cells) {
      if (!cell.asset || !(cell.x === columns - 1 || cell.y === rows - 1)) continue;

      const mural = muralEdges?.[cell.terrain];
      if (mural && mural.length > 0) {
        const p = cell.x === columns - 1
          ? cell.y                                    // right edge (incl. bottom corner)
          : (rows - 1) + (columns - 1 - cell.x);      // bottom edge, continuing past the corner
        const pick = mural[((p % mural.length) + mural.length) % mural.length];
        cell.sideAsset = pick;
        sideById.set(`${cell.x}-${cell.y}`, pick.id);
        continue;
      }

      const variants = edgeAssets?.[cell.terrain];
      if (!variants || variants.length === 0) continue;
      const neighborIds = [
        sideById.get(`${cell.x - 1}-${cell.y}`),
        sideById.get(`${cell.x}-${cell.y - 1}`),
        sideById.get(`${cell.x + 1}-${cell.y}`),
        sideById.get(`${cell.x}-${cell.y + 1}`),
      ];
      let pick = pickWeightedAsset(variants, edgeRng.next);
      if (variants.length > 1 && neighborIds.includes(pick.id)) {
        pick = pickWeightedAsset(variants, edgeRng.next); // re-roll once…
        if (neighborIds.includes(pick.id)) pick = variants.find((v) => !neighborIds.includes(v.id)) ?? pick; // …then force a different one
      }
      cell.sideAsset = pick;
      sideById.set(`${cell.x}-${cell.y}`, pick.id);
    }
  }

  // Phase 2 — STORY FEATURES (ADR-0039). Sparse multi-tile set-pieces (fossil, ruins) laid
  // head→tail along a STRAIGHT board edge, OVERRIDING the mural side. The corner is never
  // crossed (a rigid skeleton can't bend it), and when a feature would run off the edge before
  // it completes we swap its clipping piece for the `cap` terminator — never a sliced neck.
  if (edgeFeatures && edgeFeatures.length > 0) {
    const fRng = createRng(seed + 613);
    const cellAt = new Map(cells.map((c) => [`${c.x}-${c.y}`, c] as const));
    const at = (x: number, y: number) => cellAt.get(`${x}-${y}`);
    const isEdgeCell = (c: SocketBoardCell<TAsset> | undefined): c is SocketBoardCell<TAsset> => !!c?.asset;
    // Two straight runs in lay order. The bottom corner belongs to the right run, so the
    // bottom run starts one cell in from it (no double-placement, no bending).
    const rightRun = Array.from({ length: rows }, (_, y) => at(columns - 1, y)).filter(isEdgeCell);
    const bottomRun = Array.from({ length: columns - 1 }, (_, k) => at(columns - 2 - k, rows - 1)).filter(isEdgeCell);
    for (const run of [rightRun, bottomRun]) {
      let p = 1 + Math.floor(fRng.next() * 3); // a gap before the first feature
      while (p < run.length) {
        const eligible = edgeFeatures.filter((f) => !f.families || f.families.includes(run[p].terrain));
        const avail = run.length - p;
        if (eligible.length === 0 || avail < 2) break; // need head + at least a cap
        const feat = eligible[Math.floor(fRng.next() * eligible.length)];
        const span = Math.min(feat.pieces.length, avail);
        for (let i = 0; i < span; i += 1) {
          const truncated = i === span - 1 && span < feat.pieces.length;
          run[p + i].sideAsset = truncated ? feat.cap : feat.pieces[i];
          run[p + i].edgeFeatureId = feat.id;
        }
        p += span + 2 + Math.floor(fRng.next() * 4); // feature + a gap before the next
      }
    }
  }

  return {
    cells,
    fallbacks,
    stats: {
      placed: cells.length,
      missingPlacements: fallbacks.length,
      illegalEdges: countIllegalEdges(cells, familyAssets),
      candidateAssets: boardAssets.length,
    },
  };
}

export function generateSocketBoard<TAsset extends TileSocketAsset>({
  assets,
  seed,
  columns,
  rows,
  familyAssets,
}: SocketBoardOptions<TAsset>): SocketBoardResult<TAsset> {
  const usableAssets = assets.filter((asset) => asset.kind === 'tile' && asset.probability > 0);
  const boardAssets = usableAssets.length > 0 ? usableAssets : assets.filter((asset) => asset.kind === 'tile');
  const terrainFamilies = terrainFamiliesForAssets(boardAssets, familyAssets);
  const terrainMap = generateTerrainMap(terrainFamilies, seed, columns, rows);
  return solveSocketBoard({ assets, terrainMap, seed, columns, rows, familyAssets });
}
