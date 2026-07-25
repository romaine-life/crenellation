// Bake an EditorBoard to a single flat raster (a Blob), so a long list of level rows can show
// one cheap <img> per row instead of N live isometric boards. This is the consensus
// "pre-render once and reuse" fix (MDN; Godot bakes+caches its scene thumbnails): the LIST
// uses a baked thumbnail, the SELECTED viewer stays live (StudioEditableBoard).
//
// The bake MUST match the live editor pixel-for-pixel, so it does NOT reinvent any geometry:
// it composites the SAME image srcs at the SAME projected positions the editor draws —
//   - tile positions from boardLabCellPosition (render/boardProjection),
//   - tile srcs from the studio tileset (assetFrameSrc over studioFamilies, same as the editor),
//   - feature (road/river) masks from featureMaskAt + featureFrameSrc,
//   - unit sprites from the unit roster (UnitAsset.sprite, ultimately pieceSpritePath),
//   - doodad halves from the doodad catalog.
// The render happens at the board's NATIVE tile pixel size and is z-sorted exactly like the
// DOM (tiles by x+y; doodad-back / unit / doodad-front bracket at +20000); the display layer
// (LevelThumbnail) downscales the result with nearest-neighbour.

import { boardLabCellPosition } from './boardProjection';
import {
  TILE_FRAME_HEIGHT,
  TILE_STEP_X,
  TILE_STEP_Y,
} from '../art/projectionContract';
import { studioFamilies, assetFrameSrc, type StudioAsset } from '../ui/studioBoard';
import { featureFrameSrc } from '../art/tileset';
import {
  unitAssets,
  hasDirectionSprite,
  MISSING_DIRECTION_SPRITE,
  type UnitAsset,
  type Direction,
  type Faction,
} from '../ui/unitCatalog';
import { DOODAD_ASSETS, type DoodadAsset } from '../ui/doodadCatalog';
import { featureMaskAt, type FeatureKind } from '../core/featureAutotile';
import type { EditorBoard } from '../ui/boardCode';

// --- Editor render geometry (mirrors style.css, kept in ONE place) -----------------------
// The tile <img> is the 96x180 frame, placed so the cell's contact diamond (equator) seats on
// the projected point: CSS `.tileset-generated-board-tile { transform: translate(-stepX, -equator) }`
// then the img fills the frame at (0,0). Feature overlays share that exact frame.
const TILE_FRAME_W = TILE_STEP_X * 2; // 96 — the full tile sprite width
const TILE_FRAME_H = TILE_FRAME_HEIGHT; // 180 — the full tile sprite frame
const TILE_EQUATOR = 69; // --iso-tile-equator: the frame's contact diamond, from the apex
// The doodad sprite is the same 96x180 frame seated by `translate(-50%, -38.333%)` ⇒ the
// contact pixel (48,69) lands on the cell point. So its frame origin is (-stepX, -equator) too.
const DOODAD_FRAME_W = TILE_FRAME_W;
const DOODAD_FRAME_H = TILE_FRAME_H;
// The unit seat (.board-unit-seat) is a 72x86 box seated by `translate(-50%, -78%)`, with the
// sprite object-fit:contain into max 78x92 centred in that box.
const UNIT_SEAT_W = 72;
const UNIT_SEAT_H = 86;
const UNIT_SEAT_OFFSET_X = -0.5; // translate(-50%)
const UNIT_SEAT_OFFSET_Y = -0.78; // translate(-78%)
const UNIT_IMG_MAX_W = 78;
const UNIT_IMG_MAX_H = 92;

// One drawable: a source image and the destination rect it fills, plus its z for paint order.
interface DrawOp {
  src: string;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  z: number;
  /** When true, fit the natural image into (dw,dh) with object-fit:contain centring (units). */
  contain?: boolean;
}

type Canvas2D = HTMLCanvasElement | OffscreenCanvas;

// Resolve a Studio tile id to its asset (the production families the editor paints from).
const studioTiles: StudioAsset[] = studioFamilies.flatMap((family) => family.assets);
const resolveTile = (id: string): StudioAsset | undefined => studioTiles.find((asset) => asset.id === id);
const resolveUnit = (id: string): UnitAsset | undefined => unitAssets.find((unit) => unit.id === id);
const resolveDoodad = (id: string): DoodadAsset | undefined => DOODAD_ASSETS.find((d) => d.id === id);

/**
 * The flat, z-sorted list of image draws for a board — the bake's "scene graph". Pure (no
 * canvas, no DOM), so it can be unit-tested and so the unique-src set is trivially derivable.
 * Mirrors StudioEditableBoard exactly: tiles + feature overlays in the cell band; doodad-back /
 * unit / doodad-front bracketing in the +20000 band.
 */
export function boardDrawOps(board: EditorBoard): DrawOp[] {
  const ops: DrawOp[] = [];

  // Tiles + feature overlays. Each cell's frame origin is the projected point shifted by the
  // CSS translate(-stepX, -equator); the img fills the 96x180 frame.
  const presentByKind: Record<FeatureKind, Set<string>> = { road: new Set(), river: new Set(), fence: new Set() };
  for (const [key, f] of Object.entries(board.features)) presentByKind[f.kind].add(key);
  const isSevered = (edge: string): boolean => board.featureCuts[edge] === true;

  for (let y = 0; y < board.rows; y += 1) {
    for (let x = 0; x < board.cols; x += 1) {
      const key = `${x},${y}`;
      const { left, top, zIndex } = boardLabCellPosition({ x, y });
      const frameX = left - TILE_STEP_X;
      const frameY = top - TILE_EQUATOR;

      const tile = board.cells[key] ? resolveTile(board.cells[key]) : undefined;
      if (tile) {
        ops.push({ src: assetFrameSrc(tile, 0), dx: frameX, dy: frameY, dw: TILE_FRAME_W, dh: TILE_FRAME_H, z: zIndex });
      }

      const feature = board.features[key];
      if (feature) {
        const mask = featureMaskAt(presentByKind[feature.kind], x, y, isSevered);
        ops.push({
          src: featureFrameSrc(feature.kind, feature.material, mask),
          dx: frameX,
          dy: frameY,
          dw: TILE_FRAME_W,
          dh: TILE_FRAME_H,
          // Feature rides OVER its own tile but stays within the cell band (DOM: same cell div).
          z: zIndex + 0.5,
        });
      }
    }
  }

  // Doodads + units share the +20000 depth band so cross-cell sorting holds (BoardDoodad.tsx).
  for (const key of new Set([...Object.keys(board.units), ...Object.keys(board.doodads)])) {
    const [x, y] = key.split(',').map(Number);
    const { left, top, zIndex } = boardLabCellPosition({ x, y });
    const base = zIndex + 20000;

    const doodadPlacement = board.doodads[key];
    const doodad = doodadPlacement ? resolveDoodad(doodadPlacement.doodadId) : undefined;
    if (doodad) {
      const frameX = left - TILE_STEP_X;
      const frameY = top - TILE_EQUATOR;
      ops.push({ src: doodad.back, dx: frameX, dy: frameY, dw: DOODAD_FRAME_W, dh: DOODAD_FRAME_H, z: base - 1 });
      ops.push({ src: doodad.front, dx: frameX, dy: frameY, dw: DOODAD_FRAME_W, dh: DOODAD_FRAME_H, z: base + 1 });
    }

    const placement = board.units[key];
    const unit = placement ? resolveUnit(placement.unitId) : undefined;
    if (unit && placement) {
      const direction = placement.direction as Direction;
      const src = hasDirectionSprite(unit, direction)
        ? unit.sprite(placement.faction as Faction, direction)
        : MISSING_DIRECTION_SPRITE;
      // The seat box top-left, then the sprite is contained+centred inside it.
      const seatX = left + UNIT_SEAT_OFFSET_X * UNIT_SEAT_W;
      const seatY = top + UNIT_SEAT_OFFSET_Y * UNIT_SEAT_H;
      ops.push({ src, dx: seatX, dy: seatY, dw: UNIT_SEAT_W, dh: UNIT_SEAT_H, z: base, contain: true });
    }
  }

  ops.sort((a, b) => a.z - b.z);
  return ops;
}

/** Every UNIQUE image src a board's bake will draw — so each is fetched/decoded ONCE. */
export function uniqueDrawSrcs(board: EditorBoard): string[] {
  return [...new Set(boardDrawOps(board).map((op) => op.src))];
}

/**
 * A stable CONTENT hash of everything that affects a board's bake — so two boards that render
 * identically share one cached bake, and any pixel-affecting change (a moved unit, a new road,
 * a different tile) yields a new key and re-bakes. Built from the canonicalised, SORTED layers
 * (object key order must NOT matter) via FNV-1a. Pure + deterministic; unit-tested.
 */
export function boardContentHash(board: EditorBoard): string {
  const sortedEntries = (record: Record<string, unknown>): string =>
    Object.keys(record)
      .sort()
      .map((key) => `${key}=${JSON.stringify(record[key])}`)
      .join(';');
  const parts = [
    `c${board.cols}`,
    `r${board.rows}`,
    `t:${sortedEntries(board.cells)}`,
    `u:${sortedEntries(board.units)}`,
    `d:${sortedEntries(board.doodads)}`,
    `v:${sortedEntries(board.cover)}`,
    `f:${sortedEntries(board.features)}`,
    `x:${Object.keys(board.featureCuts).sort().join(',')}`,
  ];
  return fnv1a(parts.join('|'));
}

/** FNV-1a (32-bit) → a short hex string. Fast, deterministic, no crypto dependency. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// --- Bounds ------------------------------------------------------------------------------
// The bake canvas must cover every drawn rect at native size, with the board origin folded in
// so the first pixel is at (0,0). Derived from the actual draw rects (not the live centring
// metrics), so nothing drawn is ever clipped.
export interface BakeBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export function boardBounds(board: EditorBoard): BakeBounds {
  const ops = boardDrawOps(board);
  if (ops.length === 0) {
    // An empty board still occupies one tile frame, so the placeholder size is sane.
    return { minX: -TILE_STEP_X, minY: -TILE_EQUATOR, width: TILE_FRAME_W, height: TILE_FRAME_H };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const op of ops) {
    minX = Math.min(minX, op.dx);
    minY = Math.min(minY, op.dy);
    maxX = Math.max(maxX, op.dx + op.dw);
    maxY = Math.max(maxY, op.dy + op.dh);
  }
  return { minX, minY, width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) };
}

// --- Image loading -----------------------------------------------------------------------
// Load each unique src ONCE, awaiting decode() so drawImage never paints a half-loaded image.
// A module-level cache survives across bakes in a session (the same tile/unit srcs recur on
// every board), so a list of 200 levels decodes each sprite a single time.
const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // decode() is best-effort; some browsers reject for data: URLs already decoded by onload.
      img.decode().then(() => resolve(img)).catch(() => resolve(img));
    };
    img.onerror = () => reject(new Error(`bakeBoardThumbnail: failed to load ${src}`));
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

// --- Canvas ------------------------------------------------------------------------------
// Prefer OffscreenCanvas (no DOM node, off the main document) but fall back to a detached
// <canvas> where it's unavailable. Both expose convertToBlob/toBlob below.
function createCanvas(width: number, height: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas: Canvas2D): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise<Blob>((resolve, reject) => {
    // toBlob (NOT toDataURL): toDataURL holds a base64 copy per item, ballooning memory across
    // a long list; a Blob + object URL is the cheap, revocable form (MDN).
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('bakeBoardThumbnail: toBlob returned null'))), 'image/png');
  });
}

/**
 * Bake a board to a PNG Blob at its native tile pixel size (× `scale`). The caller (the
 * <img> in LevelThumbnail) downscales with nearest-neighbour, so pixel art is never
 * fractionally resampled here. `scale` should be an INTEGER (1 for the displayed size, 2 for
 * the HiDPI variant) — non-integer scales are clamped to ≥1 but pass through for flexibility.
 */
export async function bakeBoardThumbnail(board: EditorBoard, opts?: { scale?: number }): Promise<Blob> {
  const scale = Math.max(1, opts?.scale ?? 1);
  const bounds = boardBounds(board);
  const ops = boardDrawOps(board);

  const canvas = createCanvas(Math.max(1, Math.round(bounds.width * scale)), Math.max(1, Math.round(bounds.height * scale)));
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('bakeBoardThumbnail: 2D context unavailable');
  // Pixel art: nearest-neighbour at every step (the native bake is itself unscaled, but ops can
  // be drawn at integer `scale`, and unit sprites are `contain`-fit).
  ctx.imageSmoothingEnabled = false;

  // Decode every unique src once, then composite in z-order.
  const srcs = [...new Set(ops.map((op) => op.src))];
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(
    srcs.map(async (src) => {
      try {
        images.set(src, await loadImage(src));
      } catch {
        // A missing sprite must not abort the whole bake — skip it (the live board would show a
        // broken <img>, but a thumbnail is better off omitting it).
      }
    }),
  );

  for (const op of ops) {
    const img = images.get(op.src);
    if (!img) continue;
    if (op.contain) {
      // object-fit: contain into (op.dw × op.dh) capped at the seat's max box, then centred.
      const boxW = Math.min(op.dw, UNIT_IMG_MAX_W);
      const boxH = Math.min(op.dh, UNIT_IMG_MAX_H);
      const natW = img.naturalWidth || boxW;
      const natH = img.naturalHeight || boxH;
      const fit = Math.min(boxW / natW, boxH / natH);
      const w = natW * fit;
      const h = natH * fit;
      const cx = op.dx + (op.dw - w) / 2;
      const cy = op.dy + (op.dh - h) / 2;
      ctx.drawImage(img, (cx - bounds.minX) * scale, (cy - bounds.minY) * scale, w * scale, h * scale);
    } else {
      ctx.drawImage(img, (op.dx - bounds.minX) * scale, (op.dy - bounds.minY) * scale, op.dw * scale, op.dh * scale);
    }
  }

  return canvasToBlob(canvas);
}

// Re-export the geometry constants for the display layer (so the placeholder + <img> box use
// the SAME native aspect ratio the bake produces, keeping layout stable before the bake lands).
export const BAKE_GEOMETRY = { TILE_FRAME_W, TILE_FRAME_H, TILE_STEP_X, TILE_STEP_Y, TILE_EQUATOR } as const;
