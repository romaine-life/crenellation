import type { CSSProperties, ReactElement } from 'react';

// The one walkable-surface layer, shared by every board render path (the game's
// BoardLabBoard and the Studio/Level-Editor studioCellArt). A static tile's top is a
// plain <img> of the baked `-top` half; an ANIMATED top (water ripple) is a <span>
// showing one frame of the `-top-anim` horizontal sheet, advanced by a CSS steps()
// background animation (same model as the ground-cover sway — see .tile-layer-top-anim
// in style.css). The motion itself is BAKED frames (scripts/build-water-anim.py); code
// only picks the frame. Per-cell phase is a deterministic whole-frame offset from the
// board coords so a body of water shimmers loosely instead of pulsing in unison.

const TILE_FRAME_W = 96;

export function TileTopLayer({
  baseSrc,
  animFrames = 0,
  x = 0,
  y = 0,
}: {
  /** The tile's combined sprite path (`.../water-0.png`); halves are derived from it. */
  baseSrc: string;
  /** Frame count of the `-top-anim` sheet; absent/≤1 renders the static top. */
  animFrames?: number;
  x?: number;
  y?: number;
}): ReactElement {
  if (animFrames > 1) {
    const style = {
      backgroundImage: `url("${baseSrc.replace(/\.png$/, '-top-anim.png')}")`,
      '--tile-anim-frames': `${animFrames}`,
      '--tile-anim-travel': `${animFrames * -TILE_FRAME_W}px`,
      '--tile-anim-phase': `${((x * 7 + y * 13) % animFrames) / animFrames}`,
    } as CSSProperties;
    return <span className="tile-layer-top tile-layer-top-anim" style={style} />;
  }
  return <img className="tile-layer-top" src={baseSrc.replace(/\.png$/, '-top.png')} alt="" draggable={false} />;
}
