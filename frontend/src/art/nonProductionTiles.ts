import type { TileFamilyId } from '../core/tileSockets';
import { terrainLabels } from '../core/tileSockets';
import type { TileAsset } from './tileset';

// ─────────────────────────────────────────────────────────────────────────────
// NON-PRODUCTION TILES — kept in the Studio catalog for reference/comparison only.
//
// Held OUT of `tileFamilies`, board generation, coverage, and the shipped game.
// Groups:
//   • Legacy textured Blender tiles — the FORMER production set. PNGs under
//     /assets/tiles/textured/ (the doodad editor / glossary reference them by path).
//   • codex→filter — a faithful pixelation of the Blender tile; lost the bake-off to PixelLab.
//     PNGs under /assets/tiles/pixel/<fam>-codexfilter.png.
//   • Rejected bake-off methods — filter ×3, filter ×2, codex. PNGs under /assets/tiles/speculative/.
//
// The PRODUCTION set (PixelLab variants) lives in tileset.ts.
// To drop a whole group later: delete its block below + its PNGs.
// ─────────────────────────────────────────────────────────────────────────────

const FAMILIES: readonly TileFamilyId[] = ['grass', 'dirt', 'stone', 'pebble', 'sand', 'water'];

const REMOVAL_NOTE = 'Non-production — not shipped; kept in the catalog for reference.';

// --- Legacy textured Blender tiles (former production) -----------------------
const TEXTURED_FILES: Record<TileFamilyId, string[]> = {
  grass: ['grass-a', 'grass-b', 'grass-c', 'grass-d', 'grass-e', 'grass-f', 'grass-g'],
  dirt: ['dirt-a', 'dirt-b', 'dirt-c', 'dirt-d'],
  stone: ['stone-a', 'stone-b', 'stone-c'],
  pebble: ['pebble-a'],
  sand: ['sand-a'],
  water: ['water-a', 'water-b'],
};

const titleCase = (file: string): string =>
  file.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');

const texturedTile = (family: TileFamilyId, file: string): TileAsset => ({
  id: file,
  label: titleCase(file),
  src: `/assets/tiles/textured/${file}.png`,
  role: file.endsWith('-a') ? 'base' : 'variant',
  kind: 'tile',
  source: 'textured',
  method: 'Textured',
  probability: 0,
  speculative: true,
  notes: `${terrainLabels[family]} terrain, legacy textured Blender tile. ${REMOVAL_NOTE}`,
});

// --- codex→filter (bake-off runner-up) --------------------------------------
const codexFilterTile = (family: TileFamilyId): TileAsset => ({
  id: `${family}-codexfilter`,
  label: `${terrainLabels[family]} · Codex → Filter`,
  src: `/assets/tiles/pixel/${family}-codexfilter.png`,
  role: 'non-production',
  kind: 'tile',
  source: 'legacy:codexfilter',
  method: 'Codex → Filter',
  probability: 0,
  speculative: true,
  notes: `${terrainLabels[family]} terrain, codex→filter pixelation of the Blender tile. ${REMOVAL_NOTE}`,
});

// --- Rejected bake-off methods ----------------------------------------------
export interface NonProductionMethod {
  key: string;
  label: string;
  blurb: string;
}

export const REJECTED_BAKEOFF_METHODS: readonly NonProductionMethod[] = [
  { key: 'filter3', label: 'Filter ×3', blurb: 'Deterministic downscale ×3 + palette quantize of the Blender tile (chunky).' },
  { key: 'filter2', label: 'Filter ×2', blurb: 'Deterministic downscale ×2 + palette quantize of the Blender tile (finer).' },
  { key: 'codex', label: 'Codex', blurb: 'Codex (gpt-image) img2img redraw of the actual tile; soft "fake pixels".' },
];

const bakeoffTile = (family: TileFamilyId, method: NonProductionMethod): TileAsset => ({
  id: `spec-${family}-${method.key}`,
  label: `${terrainLabels[family]} · ${method.label}`,
  src: `/assets/tiles/speculative/${family}-${method.key}.png`,
  role: 'non-production',
  kind: 'tile',
  source: `bakeoff:${method.key}`,
  method: method.label,
  probability: 0,
  speculative: true,
  notes: `${terrainLabels[family]} terrain, ${method.blurb} ${REMOVAL_NOTE}`,
});

export const nonProductionTileAssets: readonly TileAsset[] = [
  ...FAMILIES.map((family) => codexFilterTile(family)),
  ...FAMILIES.flatMap((family) => TEXTURED_FILES[family].map((file) => texturedTile(family, file))),
  ...FAMILIES.flatMap((family) => REJECTED_BAKEOFF_METHODS.map((method) => bakeoffTile(family, method))),
];

/** Family lookup for the catalog filter (these assets aren't in `tileFamilies`). */
export const nonProductionTileFamilyOf = new Map<string, TileFamilyId>([
  ...FAMILIES.map((family) => [`${family}-codexfilter`, family] as const),
  ...FAMILIES.flatMap((family) => TEXTURED_FILES[family].map((file) => [file, family] as const)),
  ...FAMILIES.flatMap((family) => REJECTED_BAKEOFF_METHODS.map((method) => [`spec-${family}-${method.key}`, family] as const)),
]);
