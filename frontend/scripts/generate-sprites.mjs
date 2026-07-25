// Procedural isometric sprite-sheet generator (issue #44 Track 5). Produces the
// tile + piece atlases the Pixi board renders, replacing the placeholder colored
// diamonds/tokens. Pure + deterministic (a fixed-seed PRNG drives the only
// stochastic detail), so the committed sheets can be drift-checked in CI by
// re-running this generator (see scripts/check-sprites.mjs).
//
// Design: integer geometry on a 2:1 iso grid (tileW 64 / tileH 32, matching
// render/iso.ts). Sheets are emitted at @1x and @2x via nearest-neighbour
// integer upscale so the art stays crisp; frame rects in the manifest are in 1x
// coordinates. Hand-drawn art can replace these sheets later without code
// changes — the manifest is the contract.

import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public/assets/sprites');

export const TILE_W = 64;
export const TILE_H = 32;
export const PIECE_CELL = 48;
// Contact point inside a piece cell (where the token meets the tile centre).
export const PIECE_ANCHOR = { x: 0.5, y: 36 / PIECE_CELL };

export const TERRAINS = ['grass', 'water', 'stone', 'road', 'bridge', 'cliff', 'rock'];
export const PIECE_TYPES = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
export const SIDES = ['player', 'enemy'];

// ---- tiny raster toolkit (transparent RGBA buffers) ------------------------

const img = (w, h) => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });
const hex = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

function px(im, x, y, r, g, b, a = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= im.w || y >= im.h) return;
  const i = (y * im.w + x) * 4;
  const sa = a / 255;
  const da = im.data[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  im.data[i] = (r * sa + im.data[i] * da * (1 - sa)) / oa;
  im.data[i + 1] = (g * sa + im.data[i + 1] * da * (1 - sa)) / oa;
  im.data[i + 2] = (b * sa + im.data[i + 2] * da * (1 - sa)) / oa;
  im.data[i + 3] = oa * 255;
}
const fill = (im, x, y, w, h, c, a = 255) => {
  for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) px(im, xx, yy, c[0], c[1], c[2], a);
};
const inDiamond = (x, y, cx, cy, hw, hh) => Math.abs((x - cx) / hw) + Math.abs((y - cy) / hh) <= 1;
function ellipse(im, cx, cy, rx, ry, c, a = 255) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y += 1) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) px(im, x, y, c[0], c[1], c[2], a);
    }
  }
}
// Even-odd scanline polygon fill over integer rows. Points are [x, y] pairs.
function poly(im, pts, c, a = 255) {
  const ys = pts.map((p) => p[1]);
  const y0 = Math.floor(Math.min(...ys));
  const y1 = Math.ceil(Math.max(...ys));
  for (let y = y0; y <= y1; y += 1) {
    const xs = [];
    for (let i = 0; i < pts.length; i += 1) {
      const a1 = pts[i];
      const b1 = pts[(i + 1) % pts.length];
      const [x1, yy1] = a1;
      const [x2, yy2] = b1;
      if ((yy1 <= y && yy2 > y) || (yy2 <= y && yy1 > y)) {
        xs.push(x1 + ((y - yy1) / (yy2 - yy1)) * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x += 1) px(im, x, y, c[0], c[1], c[2], a);
    }
  }
}
// Deterministic PRNG (mulberry32) so the only non-geometric detail is stable.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- tile faces ------------------------------------------------------------

const TILE_PALETTE = {
  grass: { base: 0x4a8f57, hi: 0x60a96c, sh: 0x356a42 },
  water: { base: 0x2f6fae, hi: 0x539ad6, sh: 0x244f86 },
  stone: { base: 0x7b7f86, hi: 0x989ca3, sh: 0x5b5e64 },
  road: { base: 0xb09668, hi: 0xc8af80, sh: 0x8c764d },
  bridge: { base: 0x86643c, hi: 0x9d7a4c, sh: 0x5e4628 },
  cliff: { base: 0x4a5058, hi: 0x5f666f, sh: 0x32363c },
  rock: { base: 0x6a6f77, hi: 0x878d96, sh: 0x4b4f56 },
};

function drawTile(im, ox, terrain) {
  const cx = ox + TILE_W / 2;
  const cy = TILE_H / 2;
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const p = TILE_PALETTE[terrain];
  const base = hex(p.base); const hi = hex(p.hi); const sh = hex(p.sh);
  const r = rng(0x5eed ^ (terrain.length * 2654435761));
  for (let y = 0; y < TILE_H; y += 1) {
    for (let x = ox; x < ox + TILE_W; x += 1) {
      if (!inDiamond(x + 0.5, y + 0.5, cx, cy, hw - 0.5, hh - 0.5)) continue;
      // Light from the top-left: upper-left half brighter, lower-right darker.
      const t = (cx - (x + 0.5)) / hw + (cy - (y + 0.5)) / hh; // >0 upper-left
      let c = base;
      if (t > 0.55) c = hi; else if (t < -0.55) c = sh;
      px(im, x, y, c[0], c[1], c[2]);
    }
  }
  // Terrain-specific detail, clipped to the diamond.
  const clip = (x, y) => inDiamond(x + 0.5, y + 0.5, cx, cy, hw - 1, hh - 1);
  if (terrain === 'water') {
    for (let y = 6; y < TILE_H; y += 5) for (let x = ox + 8; x < ox + TILE_W - 8; x += 1) if (clip(x, y)) px(im, x, y, ...hex(p.hi), 150);
  } else if (terrain === 'road') {
    for (let y = 4; y < TILE_H; y += 1) if (clip(cx, y)) { px(im, cx - 1, y, ...hex(p.sh), 120); px(im, cx, y, ...hex(p.hi), 120); }
  } else if (terrain === 'bridge') {
    for (let x = ox + 6; x < ox + TILE_W - 6; x += 6) for (let y = 0; y < TILE_H; y += 1) if (clip(x, y)) px(im, x, y, ...hex(p.sh), 140);
  } else if (terrain === 'stone' || terrain === 'cliff' || terrain === 'rock') {
    const n = terrain === 'stone' ? 10 : 16;
    for (let i = 0; i < n; i += 1) {
      const x = ox + 6 + Math.floor(r() * (TILE_W - 12));
      const y = 4 + Math.floor(r() * (TILE_H - 8));
      if (clip(x, y)) px(im, x, y, ...(r() > 0.5 ? hex(p.hi) : hex(p.sh)), 160);
    }
  }
  // Crisp top-edge highlight + bottom outline for slab read.
  for (let s = 0; s <= hw; s += 1) {
    px(im, cx - 1 + s, cy - hh + s * (hh / hw), ...hi, 200); // top-right edge
    px(im, cx - s, cy - hh + s * (hh / hw), ...hi, 200); // top-left edge
  }
}

// ---- piece glyphs ----------------------------------------------------------

const SIDE_COLOR = { player: 0x3f7fd6, enemy: 0xcb4a3c, neutral: 0x6b6f76 };
const INK = hex(0x141a20);
const RIM = hex(0xf3efe4);

function drawToken(im, ox, side) {
  const cx = ox + PIECE_CELL / 2;
  ellipse(im, cx, 39, 14, 5, [8, 14, 20], 130); // ground shadow
  ellipse(im, cx, 28, 13, 13, RIM); // light rim
  ellipse(im, cx, 28, 11, 11, hex(SIDE_COLOR[side])); // coin body
  ellipse(im, cx - 3, 24, 4, 3, hex(SIDE_COLOR[side]).map((v) => Math.min(255, v + 40))); // sheen
}

function drawGlyph(im, ox, type) {
  const cx = ox + PIECE_CELL / 2; // 24 within cell
  const g = (pts) => poly(im, pts.map(([x, y]) => [ox + x, y]), INK);
  const rect = (x, y, w, h) => fill(im, ox + x, y, w, h, INK);
  switch (type) {
    case 'pawn':
      ellipse(im, cx, 19, 4, 4, INK);
      g([[20, 31], [28, 31], [26, 23], [22, 23]]);
      rect(17, 31, 14, 2);
      break;
    case 'rook':
      rect(18, 20, 12, 11);
      rect(17, 16, 3, 5); rect(22, 16, 4, 5); rect(28, 16, 3, 5);
      rect(16, 31, 16, 2);
      break;
    case 'bishop':
      ellipse(im, cx, 21, 5, 8, INK);
      rect(23, 12, 2, 4);
      fill(im, ox + 20, 19, 8, 2, RIM); // mitre slit
      rect(17, 31, 14, 2);
      break;
    case 'knight':
      g([[18, 32], [18, 23], [21, 16], [28, 14], [31, 19], [26, 21], [29, 25], [24, 25], [24, 32]]);
      rect(16, 32, 17, 2);
      break;
    case 'queen':
      g([[20, 31], [28, 31], [27, 21], [21, 21]]);
      g([[18, 21], [20, 14], [22, 20], [24, 13], [26, 20], [28, 14], [30, 21]]);
      ellipse(im, ox + 20, 13, 1.4, 1.4, INK); ellipse(im, cx, 12, 1.4, 1.4, INK); ellipse(im, ox + 28, 13, 1.4, 1.4, INK);
      rect(16, 31, 16, 2);
      break;
    default: break;
  }
}

function drawRock(im, ox, variant) {
  const cx = ox + PIECE_CELL / 2;
  const r = rng(variant === 'random-rock' ? 0xc0ffee : 0xb0a17e);
  ellipse(im, cx, 39, 13, 5, [8, 14, 20], 120); // shadow
  ellipse(im, cx, 30, 14, 10, hex(0x595e66)); // boulder
  ellipse(im, cx - 4, 25, 6, 4, hex(0x767c84)); // top light
  for (let i = 0; i < 14; i += 1) {
    const x = cx - 11 + Math.floor(r() * 22);
    const y = 22 + Math.floor(r() * 14);
    px(im, x, y, ...(r() > 0.5 ? hex(0x434851) : hex(0x767c84)), 170);
  }
  if (variant === 'random-rock') { // distinguishing facets
    poly(im, [[cx - 2, 24], [cx + 5, 27], [cx + 1, 33], [cx - 5, 30]], hex(0x6f757d), 200);
  }
}

// ---- compose sheets + manifest ---------------------------------------------

function upscale2x(im) {
  const out = img(im.w * 2, im.h * 2);
  for (let y = 0; y < im.h; y += 1) for (let x = 0; x < im.w; x += 1) {
    const i = (y * im.w + x) * 4;
    for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) {
      const j = ((y * 2 + dy) * out.w + (x * 2 + dx)) * 4;
      out.data[j] = im.data[i]; out.data[j + 1] = im.data[i + 1]; out.data[j + 2] = im.data[i + 2]; out.data[j + 3] = im.data[i + 3];
    }
  }
  return out;
}
function writePNG(im, p) {
  const png = new PNG({ width: im.w, height: im.h });
  png.data = Buffer.from(im.data);
  fs.writeFileSync(p, PNG.sync.write(png));
}

/** Build the atlas in-memory and return { manifest, sheets }. Pure (no disk). */
export function buildAtlas() {
  // Tiles: one diamond per terrain in a horizontal strip.
  const tiles = img(TILE_W * TERRAINS.length, TILE_H);
  const tileFrames = {};
  TERRAINS.forEach((t, i) => { drawTile(tiles, i * TILE_W, t); tileFrames[t] = { x: i * TILE_W, y: 0, w: TILE_W, h: TILE_H }; });

  // Pieces: player/enemy for each chess type, plus neutral rock + random-rock.
  const cells = [];
  for (const side of SIDES) for (const type of PIECE_TYPES) cells.push({ key: `${side}.${type}`, side, type, kind: 'unit' });
  cells.push({ key: 'neutral.rock', kind: 'rock', variant: 'rock' });
  cells.push({ key: 'neutral.random-rock', kind: 'rock', variant: 'random-rock' });

  const pieces = img(PIECE_CELL * cells.length, PIECE_CELL);
  const pieceFrames = {};
  cells.forEach((c, i) => {
    const ox = i * PIECE_CELL;
    if (c.kind === 'rock') drawRock(pieces, ox, c.variant);
    else { drawToken(pieces, ox, c.side); drawGlyph(pieces, ox, c.type); }
    pieceFrames[c.key] = { x: ox, y: 0, w: PIECE_CELL, h: PIECE_CELL };
  });

  const manifest = {
    version: 1,
    tile: {
      image: '/assets/sprites/tiles.png', image2x: '/assets/sprites/tiles@2x.png',
      w: tiles.w, h: tiles.h, cellW: TILE_W, cellH: TILE_H, frames: tileFrames,
    },
    piece: {
      image: '/assets/sprites/pieces.png', image2x: '/assets/sprites/pieces@2x.png',
      w: pieces.w, h: pieces.h, cellW: PIECE_CELL, cellH: PIECE_CELL,
      anchor: PIECE_ANCHOR, frames: pieceFrames,
    },
  };
  return { manifest, sheets: { tiles, pieces } };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { manifest, sheets } = buildAtlas();
  writePNG(sheets.tiles, path.join(OUT_DIR, 'tiles.png'));
  writePNG(upscale2x(sheets.tiles), path.join(OUT_DIR, 'tiles@2x.png'));
  writePNG(sheets.pieces, path.join(OUT_DIR, 'pieces.png'));
  writePNG(upscale2x(sheets.pieces), path.join(OUT_DIR, 'pieces@2x.png'));
  fs.writeFileSync(path.join(OUT_DIR, 'atlas.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Generated sprite atlas: ${TERRAINS.length} tiles, ${Object.keys(manifest.piece.frames).length} pieces -> ${OUT_DIR}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
