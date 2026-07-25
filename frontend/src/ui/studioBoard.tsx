// Shared Studio board core — the small set that BOTH the design Studio
// (TilePreview.tsx → TilesetStudio) and the standalone Level Editor
// (LevelEditor.tsx) build on: the tile-family model derived from the shipped
// tileset, the per-asset animation frame source, the animation clock, and the
// 8-way facing compass. Pulling this out of TilePreview.tsx lets the Level Editor
// ship its own tiny lazy chunk instead of dragging the entire Studio behind it.
// Keep this lean — anything Studio-only stays in TilePreview.tsx.
import { useEffect, useState, type ReactElement } from 'react';
import { tileFamilies } from '../art/tileset';
import {
  terrainLabels,
  type TileAssetKind,
  type TileFamilyId,
  type TileSocketAsset,
} from '../core/tileSockets';
import { directionCompassCells, rookDirectionLabel, type Direction } from './unitCatalog';

export type StudioFamilyId = TileFamilyId;
export type StudioAssetKind = TileAssetKind;

export interface StudioAsset extends TileSocketAsset {
  id: string;
  label: string;
  src: string;
  animation?: {
    label: string;
    frames: string[];
    frameMs: number;
    status: 'prototype' | 'raw candidate' | 'approved';
  };
  role: string;
  kind: StudioAssetKind;
  source: string;
  probability: number;
  notes: string;
  /** Non-production reference tile (held out of the board/game); shown in the catalog only. */
  speculative?: boolean;
  /** How a tile was produced, e.g. "Codex → Filter", "Textured". */
  method?: string;
}

export interface StudioFamily {
  id: StudioFamilyId;
  label: string;
  purpose: string;
  status: string;
  review: string;
  assets: StudioAsset[];
}

export const assetFrameSrc = (asset: StudioAsset, animationFrame: number): string =>
  asset.animation ? asset.animation.frames[animationFrame % asset.animation.frames.length] ?? asset.src : asset.src;

const STUDIO_FAMILY_META: Record<TileFamilyId, { purpose: string; status: string; review: string }> = {
  grass: { purpose: 'High-volume base terrain for most playable cells.', status: 'Production', review: 'Variation + same-footprint repetition.' },
  dirt: { purpose: 'Bare-earth ground.', status: 'Production', review: 'Variation across the patch.' },
  stone: { purpose: 'Stone / cobble footing.', status: 'Production', review: 'Variation + readability.' },
  pebble: { purpose: 'Loose pebble ground.', status: 'Production', review: 'Variation.' },
  sand: { purpose: 'Sandy ground.', status: 'Production', review: 'Variation.' },
  water: { purpose: 'Open water (impassable to land units).', status: 'Production', review: 'Variation + surface read.' },
};

// Derived from the shipped tileset registry (frontend/src/art/tileset.ts) so the tile
// studio ALWAYS mirrors the board — a tile can't exist on the board but not here.
export const studioFamilies: StudioFamily[] = (Object.keys(tileFamilies) as TileFamilyId[]).map((id) => ({
  id,
  label: terrainLabels[id],
  ...STUDIO_FAMILY_META[id],
  assets: tileFamilies[id].map((asset): StudioAsset => ({ ...asset })),
}));

export function useAnimationClock(isPlaying = true, frameCount = 9, frameMs = 150): number {
  const [animationFrame, setAnimationFrame] = useState(0);

  useEffect(() => {
    if (!isPlaying || frameCount <= 1) return undefined;
    const timer = window.setInterval(() => setAnimationFrame((frame) => (frame + 1) % frameCount), frameMs);
    return () => window.clearInterval(timer);
  }, [frameCount, frameMs, isPlaying]);

  useEffect(() => {
    if (frameCount > 0) setAnimationFrame((frame) => frame % frameCount);
  }, [frameCount]);

  return animationFrame;
}

// The 8-way facing compass (iso 3×3 grid + a center ↻ rotate hub). Shared by the
// Level Editor (rotates the selected unit) and the Units catalog (rotates the card
// preview). `available` greys out directions a unit lacks; omit to enable all 8.
export function FacingCompass({ direction, onSelect, onRotate, available }: {
  direction: Direction;
  onSelect: (dir: Direction) => void;
  onRotate: () => void;
  available?: (dir: Direction) => boolean;
}): ReactElement {
  return (
    <div className="unit-facing-compass" aria-label="Unit facing (8-way)">
      {directionCompassCells.map((cell) =>
        cell === 'center' ? (
          <button key="center" type="button" className="unit-facing-cell unit-facing-rotate" onClick={onRotate} title="Rotate clockwise" aria-label="Rotate clockwise">↻</button>
        ) : (
          <button
            key={cell}
            type="button"
            className={`unit-facing-cell${direction === cell ? ' is-active' : ''}${available && !available(cell) ? ' is-unavailable' : ''}`}
            disabled={available ? !available(cell) : false}
            onClick={() => onSelect(cell)}
            title={`Face ${cell}`}
            aria-label={`Face ${cell}`}
          >
            {rookDirectionLabel[cell]}
          </button>
        ),
      )}
    </div>
  );
}
