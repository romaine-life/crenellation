import { boardLabCellPosition } from './boardProjection';
import { TILE_TEMPLATE } from '../art/tileTemplate';
import { propDef, type PlacedProp, type PropDef } from '../core/props';

// THE single way a multi-cell board STRUCTURE (prop) renders on a board — shared by the game
// board (SkirmishBoard) and the Studio editor so a prop seats identically in both. A prop is a
// back/front sprite pair (split at the contact plane, like a doodad), contact-anchored at the
// footprint's visual GROUND CENTRE and z-sorted off the FRONT-MOST footprint cell so it brackets
// a unit standing on that cell (back behind, front over the shins).
//
// This generalises the old 1×1 BoardDoodad: frame size + contact anchor come from the prop's
// `def.sprite` (not the hardcoded 96×180 / (48,69) of a doodad), and the seat is shifted down by
// the footprint-centre offset so a W×H block sits centred on all of its cells.
//
// CAVEAT (verify by screenshot, do NOT claim pixel-perfection): the prop is ONE un-sliced sprite,
// so its z lives in a single bracket keyed off the front cell. For a unit standing on a cell to
// the SIDE of the prop (same x+y diagonal band) the bracket is an approximation — exactly the
// imperfection DoodadSprite already ships with its single 96×180 sprite. A future per-cell slice
// could sort each footprint column independently; v1 deliberately does not.

const DOODAD_SPRITE = { w: 96, h: 180, anchorX: 48, anchorY: 69 } as const;

/**
 * The z-index bracket a W×H prop anchored at (ax,ay) renders with. Depth keys off the FRONT-MOST
 * footprint cell (max x, max y) — sharing the unit depth band (+20000) so cross-cell sorting
 * holds — with the back half one below and the front half one above, bracketing a unit standing
 * on that front cell. Pure + exported so it can be asserted without rendering. E.g. a 2×2 at (3,3)
 * → front cell (4,4) → base 20008 → { back: 20007, front: 20009 }.
 */
export function propZBracket(ax: number, ay: number, w: number, h: number): { base: number; back: number; front: number } {
  const base = (ax + w - 1) + (ay + h - 1) + 20000;
  return { base, back: base - 1, front: base + 1 };
}

/**
 * The CSS translate (in %) that seats a sprite's contact pixel (anchorX, anchorY, both from the
 * frame's top-left) onto the cell's ground point: each axis pulls the pixel back by its fraction
 * of the frame. Pure + exported so the seat can be asserted without a DOM. The 1×1 doodad
 * (96×180 @ 48,69) MUST yield (-50, -38.333…) — the shipped value; a regression here re-floats
 * every doodad/prop.
 */
export function seatTransformPercent(sprite: { w: number; h: number; anchorX: number; anchorY: number }): { x: number; y: number } {
  return { x: -(sprite.anchorX / sprite.w) * 100, y: -(sprite.anchorY / sprite.h) * 100 };
}

/** Seat a sprite (frame `sw×sh`, contact pixel at `ax,ay`) over a footprint anchored at `anchor`. */
function StructureSprite({
  anchor,
  w,
  h,
  sprite,
  srcFor,
  attrsFor,
}: {
  anchor: { x: number; y: number };
  /** Gameplay footprint width in cells. */
  w: number;
  /** Gameplay footprint height in cells. */
  h: number;
  sprite: { w: number; h: number; anchorX: number; anchorY: number };
  srcFor: (half: 'back' | 'front') => string;
  /** Per-half data-* attributes (e.g. `(half) => ({ 'data-doodad': half })`) for hooks/styling. */
  attrsFor: (half: 'back' | 'front') => Record<string, string>;
}) {
  const base0 = boardLabCellPosition(anchor);
  // A W×H footprint's ground centre is offset from the anchor cell's projected point by
  // +((w-1)+(h-1))/2 cells down (iso top) and ((w-1)-(h-1))/2 cells across (iso left). Bake that
  // so the sprite sits centred on its cells rather than on the anchor (min) corner. For a 1×1
  // both terms are 0 — identical to the doodad seat.
  const left = base0.left + (((w - 1) - (h - 1)) / 2) * TILE_TEMPLATE.stepX;
  const top = base0.top + (((w - 1) + (h - 1)) / 2) * TILE_TEMPLATE.stepY;
  // Depth-sort off the FRONT-MOST cell (max x, max y) so the prop brackets a unit on that cell.
  const { back: zBack, front: zFront } = propZBracket(anchor.x, anchor.y, w, h);
  // Seat the contact pixel (anchorX, anchorY) — both measured from the frame's TOP-LEFT — onto the
  // ground-centre point. The element's top-left starts at (left, top), so each axis pulls the
  // contact pixel back by its fraction of the frame: -(anchorX/w) and -(anchorY/h). (For the 1×1
  // doodad, 96×180 @ (48,69), this reproduces the shipped translate(-50%, -38.333%).)
  const { x: translateX, y: translateY } = seatTransformPercent(sprite);
  const common = {
    position: 'absolute' as const,
    left,
    top,
    width: sprite.w,
    height: sprite.h,
    transform: `translate(${translateX}%, ${translateY}%)`,
    pointerEvents: 'none' as const,
  };
  return (
    <>
      <img src={srcFor('back')} alt="" {...attrsFor('back')} draggable={false} style={{ ...common, zIndex: zBack }} />
      <img src={srcFor('front')} alt="" {...attrsFor('front')} draggable={false} style={{ ...common, zIndex: zFront }} />
    </>
  );
}

/** Render a placed multi-cell prop. Skips silently if `def` is given for an unknown id. */
export function PropSprite({ prop, def }: { prop: PlacedProp; def?: PropDef }) {
  const resolved = def ?? propDef(prop.propId);
  if (!resolved) return null; // unknown prop id — render nothing (matches the bridge's skip)
  return (
    <StructureSprite
      anchor={{ x: prop.x, y: prop.y }}
      w={resolved.w}
      h={resolved.h}
      sprite={resolved.sprite}
      srcFor={(half) => `/assets/props/${prop.propId}/${half}.png`}
      attrsFor={(half) => ({ 'data-prop': prop.propId, 'data-half': half })}
    />
  );
}

export type Doodad = { x: number; y: number; type: string };

/**
 * The 1×1 doodad case, kept for back-compat. It's the general structure sprite at a 96×180
 * frame with the contact anchor at (48,69) and a single-cell footprint — so it seats and
 * z-brackets exactly as before (back base-1, front base+1, contact pixel on the cell centre).
 */
export function DoodadSprite({ doodad }: { doodad: Doodad }) {
  return (
    <StructureSprite
      anchor={{ x: doodad.x, y: doodad.y }}
      w={1}
      h={1}
      sprite={DOODAD_SPRITE}
      srcFor={(half) => `/assets/doodads/${doodad.type}/${half}.png`}
      attrsFor={(half) => ({ 'data-doodad': half })}
    />
  );
}
