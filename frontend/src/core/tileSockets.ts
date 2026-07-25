export type TileFamilyId = 'grass' | 'stone' | 'water' | 'dirt' | 'pebble' | 'sand';
export type TerrainPairId = 'grass-stone' | 'grass-water' | 'stone-water';
export type EdgeName = 'north' | 'east' | 'south' | 'west';
export type TileAssetKind = 'tile' | 'reference';

export interface TransitionPair {
  id: TerrainPairId;
  label: string;
  terrains: [TileFamilyId, TileFamilyId];
}

export type EdgeSockets = Record<EdgeName, TileFamilyId>;

export interface TileSocketAsset {
  id: string;
  kind: TileAssetKind;
  role: string;
  probability: number;
  edgeSockets?: EdgeSockets;
  terrains?: TileFamilyId[];
  pairId?: TerrainPairId;
  socketMask?: number;
  /**
   * Animated walkable surface: alongside the static `-top` half, the tile ships an
   * N-frame horizontal sheet (`<src base>-top-anim.png`, frames left-to-right, each at
   * the same 96x180 tile frame). The board renders the top layer from the sheet via a
   * steps() background animation. Absent = static top.
   */
  topAnimFrames?: number;
}

export interface TransitionSlot<TAsset extends TileSocketAsset = TileSocketAsset> {
  mask: number;
  code: string;
  label: string;
  sockets: EdgeSockets;
  assets: TAsset[];
}

export const socketEdges: EdgeName[] = ['north', 'east', 'south', 'west'];

export const terrainLabels: Record<TileFamilyId, string> = {
  grass: 'Grass',
  stone: 'Stone',
  water: 'Water',
  dirt: 'Dirt',
  pebble: 'Pebble',
  sand: 'Sand',
};

// The transition socket model is retained for the tile studio, but the shipped tileset
// has no transition tiles — so on the board every boundary is a HARD EDGE (the solver
// falls back to each cell's own family base; see solveSocketBoard).
export const transitionPairs: TransitionPair[] = [
  { id: 'grass-stone', label: 'Grass-Stone', terrains: ['grass', 'stone'] },
  { id: 'grass-water', label: 'Grass-Water', terrains: ['grass', 'water'] },
  { id: 'stone-water', label: 'Stone-Water', terrains: ['stone', 'water'] },
];

export function transitionPairById(pairId: TerrainPairId): TransitionPair {
  return transitionPairs.find((pair) => pair.id === pairId) ?? transitionPairs[0];
}

export function transitionPairsForFamily(familyId: TileFamilyId): TransitionPair[] {
  return transitionPairs.filter((pair) => pair.terrains.includes(familyId));
}

export function transitionMaskCode(mask: number): string {
  return mask.toString(2).padStart(4, '0');
}

export function transitionSlotLabel(mask: number, pair: TransitionPair): string {
  return socketEdges
    .filter((_, index) => (mask & (1 << index)) !== 0)
    .map((edge) => edge[0].toUpperCase())
    .join(' + ');
}

export function baseSocketsForFamily(familyId: TileFamilyId): EdgeSockets {
  return {
    north: familyId,
    east: familyId,
    south: familyId,
    west: familyId,
  };
}

export function transitionSocketsForMask(mask: number, pair: TransitionPair): EdgeSockets {
  return socketEdges.reduce(
    (sockets, edge, index) => ({
      ...sockets,
      [edge]: (mask & (1 << index)) !== 0 ? pair.terrains[0] : pair.terrains[1],
    }),
    {} as EdgeSockets,
  );
}

export function familyIdForAsset<TAsset extends TileSocketAsset>(
  asset: TAsset,
  familyAssets: Record<TileFamilyId, readonly TAsset[]>,
): TileFamilyId {
  const owningFamily = Object.entries(familyAssets).find(([, assets]) => assets.some((item) => item.id === asset.id))?.[0] as TileFamilyId | undefined;
  return owningFamily ?? asset.terrains?.[0] ?? 'grass';
}

export function tileSocketsForAsset<TAsset extends TileSocketAsset>(
  asset: TAsset,
  familyAssets: Record<TileFamilyId, readonly TAsset[]>,
): EdgeSockets {
  if (asset.edgeSockets) return asset.edgeSockets;
  if (asset.pairId && typeof asset.socketMask === 'number') {
    return transitionSocketsForMask(asset.socketMask, transitionPairById(asset.pairId));
  }
  return baseSocketsForFamily(familyIdForAsset(asset, familyAssets));
}

export function transitionSlotsForPair<TAsset extends TileSocketAsset>(pair: TransitionPair, assets: readonly TAsset[]): TransitionSlot<TAsset>[] {
  return Array.from({ length: 14 }, (_, index) => {
    const mask = index + 1;
    return {
      mask,
      code: transitionMaskCode(mask),
      label: transitionSlotLabel(mask, pair),
      sockets: transitionSocketsForMask(mask, pair),
      assets: assets.filter((asset) => asset.pairId === pair.id && asset.socketMask === mask),
    };
  });
}
