import type { TerrainPairId, TileFamilyId, TileSocketAsset, TransitionSlot } from './tileSockets';
import { transitionPairs, transitionSlotsForPair } from './tileSockets';

export interface TileCoverageReport<TAsset extends TileSocketAsset = TileSocketAsset> {
  expectedTransitionSlots: number;
  filledTransitionSlots: number;
  missingTransitionSlots: Array<TransitionSlot<TAsset> & { pairId: TerrainPairId }>;
  invalidTransitionAssets: TAsset[];
  familiesWithoutBase: TileFamilyId[];
}

export function buildTileCoverageReport<TAsset extends TileSocketAsset>(
  familyAssets: Record<TileFamilyId, readonly TAsset[]>,
  transitionAssets: readonly TAsset[],
): TileCoverageReport<TAsset> {
  const missingTransitionSlots = transitionPairs.flatMap((pair) =>
    transitionSlotsForPair(pair, transitionAssets)
      .filter((slot) => slot.assets.length === 0)
      .map((slot) => ({ ...slot, pairId: pair.id })),
  );
  const invalidTransitionAssets = transitionAssets.filter((asset) => !asset.pairId || typeof asset.socketMask !== 'number' || asset.socketMask < 1 || asset.socketMask > 14);
  const familiesWithoutBase = (Object.keys(familyAssets) as TileFamilyId[]).filter(
    (familyId) => !familyAssets[familyId].some((asset) => asset.kind === 'tile' && asset.role === 'base'),
  );

  return {
    expectedTransitionSlots: transitionPairs.length * 14,
    filledTransitionSlots: transitionPairs.length * 14 - missingTransitionSlots.length,
    missingTransitionSlots,
    invalidTransitionAssets,
    familiesWithoutBase,
  };
}
