import type { TileAssetKind, TileFamilyId, TileSocketAsset } from '../core/tileSockets';
import { terrainLabels } from '../core/tileSockets';
import type { FeatureKind, FeatureMaterial } from '../core/featureAutotile';
import type { EdgeFeatureSpec } from '../core/tileBoardGenerator';

export interface TileAsset extends TileSocketAsset {
  id: string;
  label: string;
  src: string;
  role: string;
  kind: TileAssetKind;
  source: string;
  probability: number;
  notes: string;
  /**
   * Non-production tiles: kept in the Studio catalog for reference/comparison but held OUT
   * of `tileFamilies`, board generation, and the shipped game. The legacy textured tiles and
   * the rejected bake-off methods live there — see frontend/src/art/nonProductionTiles.ts.
   */
  speculative?: boolean;
  /** How a tile was produced (e.g. "Codex → Filter", "PixelLab", "Textured"). */
  method?: string;
}

// PRODUCTION TILESET — surface-swap tiles. Each tile is a Blender-derived iso EDGE
// (the codexfilter pixelation, perfect grid geometry) with a separately-generated
// flat top-down PixelLab surface projected into the exact top diamond, then the side
// faces palette-tied to a darker tone of that tile's own top so top↔side reads as one
// material (the approved seam treatment). This sidesteps PixelLab's unreliable iso-top
// drawing: Blender owns the geometry, PixelLab only paints a flat material.
// On the BOARD these render as two layers — top over side (ADR-0039); split-tiles.py derives
// the -top/-side halves, and `src` here is the combined sprite (the split source + the
// catalog/inspector image).
// Built by frontend/scripts/build-surface-tiles.py. Eight variants per family. The raw
// PixelLab blocks, textured Blender tiles, and the rejected conversion methods are
// non-production — see frontend/src/art/nonProductionTiles.ts.
const FAMILIES: readonly TileFamilyId[] = ['grass', 'dirt', 'stone', 'pebble', 'sand', 'water'];

interface ProductionVariant {
  key: string;
  label: string;
  role: 'base' | 'variant';
  probability: number;
}

const PRODUCTION_VARIANTS: ProductionVariant[] = Array.from({ length: 8 }, (_, n) => ({
  key: `${n}`,
  label: `Surface ${n + 1}`,
  role: n === 0 ? 'base' : 'variant',
  probability: n === 0 ? 1 : 0.8,
}));

// Water tops are ANIMATED: each variant ships a ripple sheet (`water-<n>-top-anim.png`,
// frames left-to-right) baked by scripts/build-water-anim.mjs from PixelLab v3 frames
// generated at the native 96x180 footprint. Other families stay static.
const WATER_TOP_ANIM_FRAMES = 8;

const surfaceTile = (family: TileFamilyId, variant: ProductionVariant): TileAsset => ({
  id: `${family}-surf-${variant.key}`,
  label: `${terrainLabels[family]} · ${variant.label}`,
  src: `/assets/tiles/surface/${family}-${variant.key}.png`,
  role: variant.role,
  kind: 'tile',
  source: 'pixel:surface',
  method: 'Surface (Blender edge + PixelLab top)',
  probability: variant.probability,
  notes: `${terrainLabels[family]} — ${variant.label}: Blender-derived iso edge with a generated pixel-art top (production).`,
  ...(family === 'water' ? { topAnimFrames: WATER_TOP_ANIM_FRAMES } : {}),
});

const familyTiles = (family: TileFamilyId): TileAsset[] => PRODUCTION_VARIANTS.map((variant) => surfaceTile(family, variant));

export const tileFamilies: Record<TileFamilyId, readonly TileAsset[]> = {
  grass: familyTiles('grass'),
  dirt: familyTiles('dirt'),
  stone: familyTiles('stone'),
  pebble: familyTiles('pebble'),
  sand: familyTiles('sand'),
  water: familyTiles('water'),
};

// No transition tiles in the hard-edge tileset; kept exported (empty) for back-compat.
export const transitionAssets: readonly TileAsset[] = [];

// Rich perimeter EDGE tiles (ADR-0039). The cliff side is authored GEOLOGY — a codex
// material slab (turf+roots / strata / mossy bedrock …) projected onto the two iso faces and
// masked to the frayed silhouette — composed under the cell's own top. Several DISTINCT
// variants per family so a long board edge reads rich AND non-repeating; the solver picks one
// per void-facing cell (weighted, anti-adjacent). Built by frontend/scripts/build-rich-edges.py.
const EDGE_VARIANTS = 3;
const edgeVariant = (family: TileFamilyId, v: number): TileAsset => ({
  id: `${family}-edge-${v}`,
  label: `${terrainLabels[family]} · Edge ${v + 1}`,
  src: `/assets/tiles/surface/${family}-edge-${v}.png`,
  role: 'edge',
  kind: 'tile',
  source: 'pixel:surface',
  method: 'Edge (rich cliff)',
  probability: v === 0 ? 1 : 0.7, // variant 0 slightly commoner; rest punctuate the run
  notes: `${terrainLabels[family]} — rich perimeter cliff (variant ${v + 1}).`,
  terrains: [family],
});

// Families with rich edges. Water is intentionally excluded — its edge is the (animated)
// waterfall, gated on river types; a static frayed water lip reads as clip-art.
const EDGE_FAMILIES: readonly TileFamilyId[] = ['grass', 'dirt', 'stone', 'pebble', 'sand'];
export const edgeTiles: Partial<Record<TileFamilyId, TileAsset[]>> = Object.fromEntries(
  EDGE_FAMILIES.map((family) => [family, Array.from({ length: EDGE_VARIANTS }, (_, v) => edgeVariant(family, v))]),
) as Partial<Record<TileFamilyId, TileAsset[]>>;

// CONTINUITY murals (ADR-0039). One WIDE codex cliff mural per family, sliced into
// MURAL_WINDOWS ORDERED windows (build-mural-edges.py): consecutive windows are adjacent
// columns of the same mural, so when the solver hands consecutive void-facing edge cells
// consecutive windows the cliff FLOWS across tiles instead of each tile re-starting at a
// random variant. The index IS the window order; `probability` is unused (the solver picks
// sequentially by run-position, not weighted). Supersedes the random `edgeTiles` pick for any
// family present here; families absent here fall back to `edgeTiles`.
// 48 = three codex murals (16 windows each) pooled into ONE ordered bank: every generated
// mural is used, and the bank is long enough that no realistic board edge repeats a window.
export const MURAL_WINDOWS = 48;
const muralVariant = (family: TileFamilyId, i: number): TileAsset => ({
  id: `${family}-mural-${i}`,
  label: `${terrainLabels[family]} · Mural ${i + 1}`,
  src: `/assets/tiles/surface/${family}-mural-${i}.png`,
  role: 'edge',
  kind: 'tile',
  source: 'pixel:surface',
  method: 'Edge mural (continuous cliff)',
  probability: 1,
  notes: `${terrainLabels[family]} — continuous cliff mural, window ${i + 1} of ${MURAL_WINDOWS}.`,
  terrains: [family],
});
// Families with a baked continuity mural (water excluded — its edge is the waterfall).
const MURAL_FAMILIES: readonly TileFamilyId[] = ['grass', 'dirt', 'stone', 'sand', 'pebble'];
export const muralTiles: Partial<Record<TileFamilyId, TileAsset[]>> = Object.fromEntries(
  MURAL_FAMILIES.map((family) => [family, Array.from({ length: MURAL_WINDOWS }, (_, i) => muralVariant(family, i))]),
) as Partial<Record<TileFamilyId, TileAsset[]>>;

// Phase 2 — STORY FEATURES (ADR-0039). A feature is a multi-tile set-piece (dino fossil,
// buried ruins) baked as one wide cliff image, sliced into ordered side `pieces` + a clean
// `cap` terminator (build-mural-edges.py + forge-feature.mjs). The solver lays it head→tail
// along a straight board edge and caps it where it would clip. Soil families only for now.
const FEATURE_FAMILIES: readonly TileFamilyId[] = ['grass', 'dirt'];
const featurePiece = (feature: string, key: string): TileAsset => ({
  id: `${feature}-${key}`,
  label: `${feature} · ${key}`,
  src: `/assets/tiles/surface/${feature}-${key}.png`,
  role: 'edge',
  kind: 'tile',
  source: 'pixel:surface',
  method: 'Edge feature (story set-piece)',
  probability: 1,
  notes: `${feature} story feature (${key}).`,
  terrains: [...FEATURE_FAMILIES],
});
const FEATURE_PIECE_COUNT: Record<string, number> = { fossil: 6, ruins: 5 };
export const edgeFeatures: EdgeFeatureSpec<TileAsset>[] = Object.entries(FEATURE_PIECE_COUNT).map(([feature, count]) => ({
  id: feature,
  pieces: Array.from({ length: count }, (_, i) => featurePiece(feature, String(i))),
  cap: featurePiece(feature, 'cap'),
  families: [...FEATURE_FAMILIES],
}));

export const tileAssets: readonly TileAsset[] = FAMILIES.flatMap((family) => tileFamilies[family]);

export const tileFrameSrc = (asset: TileAsset): string => asset.src;

// Linear-feature overlays (roads, rivers) live in their OWN registry,
// deliberately apart from the socket base tiles above: a feature is a transparent
// ribbon composited OVER any base tile, keyed by its material and 4-bit connection
// mask (0–15), not selected by the socket solver. Baked by scripts/build-feature-tiles.py.
export const featureFrameSrc = (kind: FeatureKind, material: FeatureMaterial, mask: number): string =>
  `/assets/tiles/feature/${kind}-${material}-${mask}.png`;

// A square, pre-centered preview icon for editor palettes/brush (the board sprites
// are tall 96x180 frames with the art only in the top diamond, so they don't center
// in a small box — this is cropped + squared at bake time). See build-feature-tiles.py.
export const featureThumbSrc = (kind: FeatureKind, material: FeatureMaterial): string =>
  `/assets/tiles/feature/${kind}-${material}-thumb.png`;
