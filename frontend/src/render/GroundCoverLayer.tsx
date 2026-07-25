import type { CSSProperties, ReactElement } from 'react';
import { boardLabCellPosition } from './boardProjection';
import { groundCoverSet, type CoverSet, type CoverVariantMeta, type GroundCover, type TuftInstance } from '../core/groundCover';
import type { TileFamilyId } from '../core/tileSockets';

// THE single way ground-cover tufts render on a board — shared by the game board
// (SkirmishBoard) and the editor. Each tuft is an animated sprite anchored at the
// tile contact point + its scatter offset, and z-sorted into the unit depth band so
// it brackets units (front-half tufts over the shins, back-half behind) — the same
// occlusion trick <DoodadSprite> uses, generalized from one-per-cell to many-per-tile.
// The 6-frame sway is BAKED art (sheet); CSS only advances the frame index.

interface CoverCell {
  x: number;
  y: number;
  terrain: TileFamilyId;
  groundCover?: GroundCover;
}

const SWAY_DUR = 1.14; // seconds per loop (~5 fps over 6 frames)

function tuftStyle(cell: CoverCell, tuft: TuftInstance, meta: CoverVariantMeta, set: CoverSet): CSSProperties {
  const { left, top, zIndex } = boardLabCellPosition(cell);
  const sheetW = meta.frameW * set.frameCount;
  return {
    position: 'absolute',
    left: left + tuft.dx,
    top: top + tuft.dy,
    width: meta.frameW,
    height: meta.frameH,
    zIndex: zIndex + 20000 + (tuft.dy > 0 ? 1 : -1),
    backgroundImage: `url(${set.basePath}/v${tuft.variant}.png)`,
    backgroundSize: `${sheetW}px ${meta.frameH}px`,
    transformOrigin: `${meta.baseX}px ${meta.baseY}px`,
    transform: `translate(${-meta.baseX}px, ${-meta.baseY}px)${tuft.flip ? ' scaleX(-1)' : ''}`,
    // consumed by the .gc-tuft keyframe / delay in style.css
    ['--gc-travel' as string]: `${-sheetW}px`,
    ['--gc-delay' as string]: `${(-(tuft.phase / set.frameCount) * SWAY_DUR).toFixed(3)}s`,
  } as CSSProperties;
}

export function GroundCoverLayer({ cells }: { cells: readonly CoverCell[] }) {
  const sprites: ReactElement[] = [];
  for (const cell of cells) {
    const cover = cell.groundCover;
    if (!cover) continue;
    const set = groundCoverSet(cell.terrain);
    if (!set) continue;
    cover.tufts.forEach((tuft, i) => {
      const meta = set.variants.find((v) => v.id === tuft.variant);
      if (!meta) return;
      sprites.push(
        <span key={`${cell.x},${cell.y}-${i}`} className="gc-tuft" aria-hidden="true" style={tuftStyle(cell, tuft, meta, set)} />,
      );
    });
  }
  return <>{sprites}</>;
}
