// The level / campaign document schema — the durable, serializable format the
// editors write and the game reads. Custom (Tiled/LDtk can't express isometric +
// elevation + gameplay zones); LDtk-inspired structure (defs/instances spirit,
// world/levels model, typed fields). Persisted as a validated JSONB body.

import type { BoardSize, PieceType, Side, TerrainCell, TerrainType, UnitFacing } from './types';
import type { PlacedProp } from './props';

// Terrain vocabulary now lives in the foundational type module so the editor's
// `Level` and the live `GameState` share one definition; re-exported here so
// existing `from './level'` importers are unaffected.
export type { TerrainType, TerrainCell };

export const LEVEL_FORMAT_VERSION = 1;
export const CAMPAIGN_FORMAT_VERSION = 1;

export const BOARD_COLS = { min: 4, max: 16 } as const;
export const BOARD_ROWS = { min: 4, max: 20 } as const;

export type ZoneType = 'player-spawn' | 'enemy-spawn' | 'enemy-threat' | 'objective' | 'falling-rock';
export type ObjectiveType = 'capture-all' | 'capture-king' | 'survive' | 'reach';

export interface Decal {
  x: number;
  y: number;
  type: string;
}

export interface Zone {
  id: string;
  type: ZoneType;
  tiles: Array<[number, number]>;
}

export interface LevelUnit {
  x: number;
  y: number;
  type: PieceType;
  side: Side;
  // The 8-direction sprite facing painted in the editor. Optional + back-compat: the
  // game falls back to the side's default facing when absent (see game/setup.ts).
  facing?: UnitFacing;
}

export interface LevelEconomy {
  startingFunds: number;
  incomePerTurn: number;
}

export interface Level {
  formatVersion: number;
  id: string;
  name: string;
  notes: string;
  board: BoardSize & { heightLevels: number };
  objective: ObjectiveType;
  difficulty: string;
  economy: LevelEconomy;
  theme: string;
  // The Level Editor's compact, lossless board encoding (see ui/boardCode.ts). Optional +
  // back-compat: the validator ignores unknown fields, so older bodies stay valid; when
  // present it is the source of truth for re-seeding the editor (round-trips doodads,
  // cover, roads/rivers and unit facing that `layers` alone can't fully express).
  boardCode?: string;
  layers: {
    terrain: TerrainCell[];
    decals: Decal[];
    zones: Zone[];
    units: LevelUnit[];
    // Multi-cell decorative props (trees/houses). Optional + back-compat: legacy bodies omit
    // it (validator only checks it WHEN PRESENT, never adds it to the required-array loop), and
    // a prop-free editor save leaves it `[]`. This is the durable channel the GAME reads
    // (createFromLevel reads `layers`, not `boardCode`); boardCode carries a parallel 'p' map
    // only to re-seed the editor losslessly.
    props?: PlacedProp[];
  };
}

export interface CampaignLevelRef {
  levelId: string;
  ordinal: number;
  objective?: ObjectiveType;
  stars?: number;
  completed?: boolean;
}

export interface Campaign {
  formatVersion: number;
  id: string;
  name: string;
  difficulty: string;
  chapters: number;
  favorite?: boolean;
  locked?: boolean;
  unlockRequirement?: string;
  levels: CampaignLevelRef[];
  // Tier tag, set at hydrate time and STRIPPED before the per-user Save PUT (so the
  // persisted body stays identical to today). 'official' = global game content;
  // 'mine' = the signed-in user's own campaign. Absent ⇒ treated as 'mine'.
  origin?: 'official' | 'mine';
  // Official campaigns render read-only in the editor (set alongside origin).
  readOnly?: boolean;
}

export function createBlankLevel(id: string, name = 'Untitled', cols = 12, rows = 8): Level {
  const terrain: TerrainCell[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) terrain.push({ x, y, terrain: 'grass', elevation: 0 });
  }
  return {
    formatVersion: LEVEL_FORMAT_VERSION,
    id,
    name,
    notes: '',
    board: { cols, rows, heightLevels: 1 },
    objective: 'capture-all',
    difficulty: 'normal',
    economy: { startingFunds: 1200, incomePerTurn: 150 },
    theme: 'grassland',
    layers: { terrain, decals: [], zones: [], units: [], props: [] },
  };
}

export type ValidateResult = { ok: true; level: Level } | { ok: false; errors: string[] };

/** Structural validation at the trust boundary (editor save / DB read). */
export function validateLevel(value: unknown): ValidateResult {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return { ok: false, errors: ['level is not an object'] };
  const v = value as Partial<Level>;

  if (v.formatVersion !== LEVEL_FORMAT_VERSION) errors.push(`formatVersion must be ${LEVEL_FORMAT_VERSION}`);
  if (typeof v.id !== 'string' || !v.id) errors.push('id is required');
  if (typeof v.name !== 'string') errors.push('name is required');
  if (v.notes !== undefined && typeof v.notes !== 'string') errors.push('notes must be a string');

  const b = v.board;
  if (!b || typeof b.cols !== 'number' || typeof b.rows !== 'number') {
    errors.push('board.cols and board.rows are required');
  } else {
    if (b.cols < BOARD_COLS.min || b.cols > BOARD_COLS.max) errors.push(`board.cols out of range (${BOARD_COLS.min}-${BOARD_COLS.max})`);
    if (b.rows < BOARD_ROWS.min || b.rows > BOARD_ROWS.max) errors.push(`board.rows out of range (${BOARD_ROWS.min}-${BOARD_ROWS.max})`);
  }

  const layers = v.layers;
  if (!layers || typeof layers !== 'object') {
    errors.push('layers is required');
  } else {
    for (const key of ['terrain', 'decals', 'zones', 'units'] as const) {
      if (!Array.isArray(layers[key])) errors.push(`layers.${key} must be an array`);
    }
    if (b && Array.isArray(layers.units)) {
      for (const u of layers.units) {
        if (u.x < 0 || u.x >= b.cols || u.y < 0 || u.y >= b.rows) {
          errors.push(`unit out of bounds at (${u.x}, ${u.y})`);
          break;
        }
      }
    }
    // Props are an OPTIONAL layer (back-compat: legacy bodies omit it, so it is NOT in the
    // required-array loop above). Validate its shape only when present.
    if (layers.props !== undefined) {
      if (!Array.isArray(layers.props)) {
        errors.push('layers.props must be an array');
      } else {
        for (const p of layers.props) {
          if (!p || typeof p !== 'object' || typeof p.propId !== 'string' || typeof p.x !== 'number' || typeof p.y !== 'number') {
            errors.push('malformed prop entry (need numeric x,y and string propId)');
            break;
          }
          // Bounds-check the anchor symmetrically with units: an off-board anchor would otherwise
          // stamp off-board rock colliders in createFromLevel (propCells does not clamp).
          if (b && (p.x < 0 || p.x >= b.cols || p.y < 0 || p.y >= b.rows)) {
            errors.push(`prop out of bounds at (${p.x}, ${p.y})`);
            break;
          }
        }
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, level: value as Level };
}
