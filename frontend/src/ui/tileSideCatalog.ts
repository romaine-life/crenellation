// Tile-side inspection items. The board's tiles are iso cubes whose lower SIDE/CLIFF faces
// are easy to overlook in the placement catalog (which routes to the Level Editor). This
// read-only catalog category exists to inspect those faces — every production tile plus the
// frayed perimeter EDGE tiles — one item per tile. Mirrors surfaceCatalog.ts: adding nothing
// here is needed when a family/variant is added; the list derives from the shipped tileset.

import { tileFamilies, edgeTiles, type TileAsset } from '../art/tileset';
import type { TileFamilyId } from '../core/tileSockets';

export interface TileSideItem {
  id: string;
  label: string;
  src: string; // served path under public/
  family: TileFamilyId;
  /** 'base' | 'variant' for surface tiles, 'edge' for the frayed perimeter tiles. */
  role: string;
}

const surfaceItems: TileSideItem[] = (Object.keys(tileFamilies) as TileFamilyId[]).flatMap((family) =>
  tileFamilies[family]
    .filter((asset) => asset.kind === 'tile')
    .map((asset) => ({ id: asset.id, label: asset.label, src: asset.src, family, role: asset.role })),
);

const edgeItems: TileSideItem[] = (Object.entries(edgeTiles) as [TileFamilyId, TileAsset[] | undefined][])
  .flatMap(([family, assets]) => (assets ?? []).map((asset) => ({ id: asset.id, label: asset.label, src: asset.src, family, role: asset.role })));

export const TILE_SIDE_ITEMS: TileSideItem[] = [...surfaceItems, ...edgeItems];

export const tileSideItemById = (id: string | undefined): TileSideItem | undefined =>
  TILE_SIDE_ITEMS.find((item) => item.id === id);

/** How many side items belong to a family (for the family filter sub-counts). */
export const tileSideFamilyCount = (family: TileFamilyId): number =>
  TILE_SIDE_ITEMS.filter((item) => item.family === family).length;
