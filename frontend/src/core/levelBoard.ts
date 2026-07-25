// Converters between the durable `Level` document and the Level Editor's in-memory
// `EditorBoard`. The editor paints in terms of Studio tile ids / unit ids / doodads /
// roads-rivers; the saved `Level` is the canonical schema the game reads. Two functions
// bridge them, kept here (core) so neither the editor nor the game owns the mapping.
//
//  - `levelToEditorBoard` re-seeds the editor from a saved level: it prefers the
//    lossless `boardCode` (round-trips doodads/cover/features/facing), falling back to
//    deriving a board from `layers` for legacy levels that predate boardCode.
//  - `editorBoardToLevel` serializes the painted board into a valid `Level`, stamping the
//    `boardCode` so the next open is exact, and projecting terrain/units into `layers` so
//    the game (which reads `layers`, not `boardCode`) plays the authored board.

import type { Level, LevelEconomy, LevelUnit, ObjectiveType } from './level';
import { BOARD_COLS, BOARD_ROWS, LEVEL_FORMAT_VERSION } from './level';
import type { PlacedProp } from './props';
import type { Side, TerrainCell, TerrainType, UnitFacing } from './types';
import type { TileFamilyId } from './tileSockets';
import { decodeBoard, encodeBoard, type EditorBoard } from '../ui/boardCode';
import { studioFamilies } from '../ui/studioBoard';
import { UNIT_PALETTES } from './pieces';
import { unitAssets, type Faction } from '../ui/unitCatalog';

// Family → terrain material, mirroring game/setup.ts. The six tile families map 1:1 onto
// the playable terrain materials; any unmapped (decorative) family falls back to grass.
const FAMILY_TO_TERRAIN: Record<TileFamilyId, TerrainType> = {
  grass: 'grass',
  stone: 'stone',
  water: 'water',
  dirt: 'dirt',
  pebble: 'pebble',
  sand: 'sand',
};

// Terrain the editor can REPRESENT (and thus round-trip), so the save-time guard need not
// preserve it from the pre-save level: the six tile families above, PLUS `road` — which the
// editor expresses through its feature-overlay layer (not a tile brush), mapped both ways in
// the converters below. Terrain with neither a tile family nor a feature — bridge, cliff, rock —
// stays outside this set: it renders as a grass placeholder and is preserved on save rather than
// flattened (an INV7 data-loss on legacy officials that predate boardCode).
const EDITOR_EXPRESSIBLE_TERRAIN = new Set<TerrainType>([...Object.values(FAMILY_TO_TERRAIN), 'road']);

// Side ↔ faction (team palette). The editor paints a faction; the level stores a side.
const SIDE_TO_FACTION: Record<'player' | 'enemy', Faction> = { player: 'navy-blue', enemy: 'crimson' };
const isFaction = (faction: string | null | undefined): faction is Faction =>
  Boolean(faction && (UNIT_PALETTES as readonly string[]).includes(faction));
const sideForFaction = (faction: string, playerFaction: string | null | undefined): Side =>
  playerFaction && faction === playerFaction ? 'player' : 'enemy';

// Resolve a Studio tile id to its family (so its terrain material is known).
const familyOfTile = (tileId: string): TileFamilyId | undefined =>
  studioFamilies.find((family) => family.assets.some((asset) => asset.id === tileId))?.id;

// The default (first) tile id of a family — used when deriving a board from `layers`,
// which only knows the terrain material, not which specific tile was painted.
const defaultTileOfFamily = (family: TileFamilyId): string | undefined => {
  const fam = studioFamilies.find((f) => f.id === family);
  const tile = fam?.assets.find((asset) => asset.kind === 'tile') ?? fam?.assets[0];
  return tile?.id;
};

// Terrain material → a representative tile id, via its family. Unknown materials (none of
// the playable set maps to a decorative-only family) fall back to grass.
const TERRAIN_TO_FAMILY = (Object.entries(FAMILY_TO_TERRAIN) as Array<[TileFamilyId, TerrainType]>).reduce(
  (acc, [family, terrain]) => { acc[terrain] = family; return acc; },
  {} as Partial<Record<TerrainType, TileFamilyId>>,
);
const tileIdForTerrain = (terrain: TerrainType): string | undefined => {
  const family = TERRAIN_TO_FAMILY[terrain] ?? 'grass';
  return defaultTileOfFamily(family);
};

// Piece type → a production unit id (the first non-speculative asset of that family), so a
// level derived from `layers` paints a real, shippable sprite.
const unitIdForType = (type: string): string | undefined => {
  const asset = unitAssets.find((u) => u.family === type && !u.speculative) ?? unitAssets.find((u) => u.family === type);
  return asset?.id;
};
// Unit id → its piece type (the asset's family), so a painted unit serializes to a PieceType.
const typeOfUnitId = (unitId: string): LevelUnit['type'] | undefined =>
  unitAssets.find((u) => u.id === unitId)?.family as LevelUnit['type'] | undefined;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export interface LevelMeta {
  id: string;
  name: string;
  notes?: string;
  objective?: ObjectiveType;
  difficulty?: string;
  economy?: LevelEconomy;
  theme?: string;
  // The terrain of the level being edited, BEFORE this save. Used to preserve non-editor-
  // expressible terrain (road/bridge/cliff/rock) on cells the editor can only render as a grass
  // placeholder — without it, republishing a legacy official level (no boardCode) flattens those
  // surfaces to grass for every player (INV7 data-loss). Absent for a brand-new/blank board.
  previousTerrain?: TerrainCell[];
}

// Re-seed the editor from a saved level. The lossless `boardCode` is preferred (it carries
// doodads, ground cover, roads/rivers and exact unit facing); otherwise we derive a board
// from `layers`, which only knows terrain materials + unit placements.
export function levelToEditorBoard(level: Level): EditorBoard {
  if (level.boardCode) {
    const decoded = decodeBoard(level.boardCode);
    if (decoded) return decoded;
  }

  const cols = clamp(level.board.cols, BOARD_COLS.min, BOARD_COLS.max);
  const rows = clamp(level.board.rows, BOARD_ROWS.min, BOARD_ROWS.max);

  const cells: EditorBoard['cells'] = {};
  const cover: EditorBoard['cover'] = {};
  const features: EditorBoard['features'] = {};
  const fallbackTile = defaultTileOfFamily('grass');
  for (const cell of level.layers.terrain) {
    if (cell.x < 0 || cell.x >= cols || cell.y < 0 || cell.y >= rows) continue;
    const key = `${cell.x},${cell.y}`;
    cells[key] = tileIdForTerrain(cell.terrain) ?? fallbackTile ?? '';
    if (cell.cover) cover[key] = cell.cover.density;
    // `road` is a game TerrainType but, in the editor, a feature overlay sitting on a (grass)
    // tile — surface it as a road feature so a legacy official's roads don't vanish into grass.
    if (cell.terrain === 'road') features[key] = { kind: 'road', material: 'cobble' };
  }
  // Fill any unauthored cell with grass so the whole board is paintable.
  if (fallbackTile) for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
    const key = `${x},${y}`;
    if (!(key in cells)) cells[key] = fallbackTile;
  }

  const units: EditorBoard['units'] = {};
  for (const unit of level.layers.units) {
    if (unit.x < 0 || unit.x >= cols || unit.y < 0 || unit.y >= rows) continue;
    const unitId = unitIdForType(unit.type);
    if (!unitId) continue;
    units[`${unit.x},${unit.y}`] = {
      unitId,
      direction: unit.facing ?? 'south',
      faction: SIDE_TO_FACTION[unit.side === 'enemy' ? 'enemy' : 'player'],
    };
  }

  // Legacy fallback: a level with no boardCode still carries props in layers.props (the durable
  // game channel), so re-derive the editor's anchor-keyed props map from it.
  const props: EditorBoard['props'] = {};
  for (const p of level.layers.props ?? []) {
    if (p.x < 0 || p.x >= cols || p.y < 0 || p.y >= rows) continue;
    props[`${p.x},${p.y}`] = { propId: p.propId };
  }

  const hasAuthoredPlayer = level.layers.units.some((unit) => unit.side === 'player');
  return {
    cols,
    rows,
    playerFaction: hasAuthoredPlayer ? SIDE_TO_FACTION.player : undefined,
    cells,
    units,
    doodads: {},
    props,
    cover,
    features,
    featureCuts: {},
    featureExits: {},
  };
}

// Serialize the painted board into a valid `Level`. `boardCode` is stamped for a lossless
// re-open; `layers.terrain` / `layers.units` are projected so the game (which reads
// `layers`) plays the authored board. Decals/zones stay empty (doodads ride in boardCode;
// decals mapping is Phase 4).
export function editorBoardToLevel(board: EditorBoard, meta: LevelMeta): Level {
  const cols = clamp(board.cols, BOARD_COLS.min, BOARD_COLS.max);
  const rows = clamp(board.rows, BOARD_ROWS.min, BOARD_ROWS.max);

  // Index the pre-save cells so terrain the editor cannot express (road/bridge/cliff/rock)
  // AND elevation (the editor has no height tool at all) can be carried through rather than
  // coerced to grass / flattened to 0 on republish (INV7 data-loss on legacy officials).
  const prevCell = new Map<string, TerrainCell>();
  for (const cell of meta.previousTerrain ?? []) prevCell.set(`${cell.x},${cell.y}`, cell);

  const terrain: TerrainCell[] = [];
  let maxElevation = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const key = `${x},${y}`;
      const prev = prevCell.get(key);
      const tileId = board.cells[key];
      const family = tileId ? familyOfTile(tileId) : undefined;
      // Decorative / unknown families fall back to grass (a playable material).
      let cellTerrain: TerrainType = family ? FAMILY_TO_TERRAIN[family] ?? 'grass' : 'grass';
      // A road feature overlay IS the cell's terrain in the game's schema — project it back to
      // `road` so roads painted (or loaded) in the editor reach layers.terrain, which the game
      // reads. Erasing the overlay leaves no road feature, so the cell reverts to its tile
      // (grass) — i.e. an admin can actually remove a road.
      if (board.features[key]?.kind === 'road') {
        cellTerrain = 'road';
      } else if (cellTerrain === 'grass' && prev && !EDITOR_EXPRESSIBLE_TERRAIN.has(prev.terrain)) {
        // Preserve terrain the editor can neither paint nor feature-map (bridge/cliff/rock) so a
        // republished legacy official keeps those surfaces instead of flattening them to grass.
        cellTerrain = prev.terrain;
      }
      // The editor has no elevation tool, so it can never change height — carry the prior cell's
      // elevation through unchanged rather than flattening every cell to 0 for all players.
      const elevation = prev?.elevation ?? 0;
      if (elevation > maxElevation) maxElevation = elevation;
      const cell: TerrainCell = { x, y, terrain: cellTerrain, elevation };
      const density = board.cover[key];
      if (density) cell.cover = { density };
      terrain.push(cell);
    }
  }

  const units: LevelUnit[] = [];
  for (const [key, placement] of Object.entries(board.units)) {
    const [x, y] = key.split(',').map(Number);
    if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
    const type = typeOfUnitId(placement.unitId);
    if (!type) continue;
    const side = sideForFaction(placement.faction, isFaction(board.playerFaction) ? board.playerFaction : undefined);
    units.push({ x, y, type, side, facing: placement.direction as UnitFacing });
  }

  // Dual-write props: the durable game channel (layers.props) AND the lossless boardCode 'p' map
  // (via encodeBoard below). The game reads layers.props; the editor re-opens from boardCode. The
  // anchor (the prop's min-corner) is the map key; out-of-bounds anchors are dropped on resize so
  // this is just a projection. (Footprint bounds are enforced at paint time, not re-checked here.)
  const props: PlacedProp[] = [];
  for (const [key, placement] of Object.entries(board.props ?? {})) {
    const [x, y] = key.split(',').map(Number);
    if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
    props.push({ x, y, propId: placement.propId });
  }

  return {
    formatVersion: LEVEL_FORMAT_VERSION,
    id: meta.id,
    name: meta.name,
    notes: meta.notes ?? '',
    // heightLevels follows the preserved elevation (the editor can't change height) — never
    // hard-coded, else a republished elevated official would collapse to a flat board.
    board: { cols, rows, heightLevels: Math.max(1, maxElevation + 1) },
    objective: meta.objective ?? 'capture-all',
    difficulty: meta.difficulty ?? 'normal',
    economy: meta.economy ?? { startingFunds: 1200, incomePerTurn: 150 },
    theme: meta.theme ?? 'grassland',
    boardCode: encodeBoard({ ...board, cols, rows }),
    layers: { terrain, decals: [], zones: [], units, props },
  };
}
