#!/usr/bin/env python3
"""Build the PRODUCTION surface-swap tileset from committed inputs — self-contained,
re-runnable, the single source of truth for /assets/tiles/surface/<fam>-<n>.png.

NOTE (ADR-0039): the board now renders tiles as LAYERED top/side. After this script,
`split-tiles.py` derives <fam>-<n>-top.png / -side.png from each combined tile here; the
board composes those halves, while this combined PNG stays the split source and the
catalog/inspector image. Re-run split-tiles.py whenever this output changes.

Pipeline per tile (see scripts/TILE_PIPELINE.md for the full flow incl. generation):
  1. take a curated flat top-down PixelLab surface  (docs/art/pixellab-runs/surfaces/)
  2. PROJECT it into the exact iso top-diamond        (square -> rhombus affine, NEAREST)
  3. COMPOSITE over the Blender-derived edge          (public/.../pixel/<fam>-codexfilter.png)
  4. PALETTE-TIE the side faces to a darker tone of    (the approved seam treatment)
     that tile's own top so top + side read as one material

To add/replace variants: generate a new pool (TILE_PIPELINE.md), drop it under the
archive, edit CURATION_MAP, re-run. Nothing here depends on a temp/scratch dir.
"""
import os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
TILES = os.path.normpath(os.path.join(HERE, '..', 'public', 'assets', 'tiles'))
RAW = os.path.normpath(os.path.join(HERE, '..', '..', 'docs', 'art', 'pixellab-runs', 'surfaces'))
OUT = os.path.join(TILES, 'surface')

W, H = 96, 180
APEX, RIGHT, FRONT, LEFT = (48, 41), (96, 68), (48, 95), (0, 68)

# Which raw pool index (tile_<i>.png) becomes production variant 0..7, per family.
# Curated by eye from the 16-variation pools (dropped near-black / empty / one-off
# surfaces). The user is the judge of this map — see TILE_PIPELINE.md.
CURATION_MAP = {
    'grass':  [0, 1, 2, 3, 5, 6, 8, 9],
    'dirt':   [0, 3, 5, 6, 10, 11, 12, 13],
    'stone':  [0, 1, 2, 3, 8, 9, 10, 11],
    'pebble': [0, 1, 2, 4, 5, 8, 9, 13],
    'sand':   [0, 1, 4, 6, 7, 8, 10, 13],
    'water':  [4, 5, 6, 7, 12, 13, 14, 15],
}

def diamond_mask():
    m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).polygon([APEX, RIGHT, FRONT, LEFT], fill=255)
    return np.array(m) > 0
DIA = diamond_mask()

def project_into_diamond(surface):
    """square top-down surface -> our iso top-diamond (affine, NEAREST, masked)."""
    surface = surface.convert('RGBA'); S = surface.size[0]
    dst = np.array([APEX, RIGHT, LEFT], float); src = np.array([(0, 0), (S, 0), (0, S)], float)
    M = np.column_stack([dst, np.ones(3)])
    coeffs = (*np.linalg.solve(M, src[:, 0]), *np.linalg.solve(M, src[:, 1]))
    coeffs = (coeffs[0], coeffs[1], coeffs[2], coeffs[3], coeffs[4], coeffs[5])
    proj = surface.transform((W, H), Image.AFFINE, coeffs, resample=Image.NEAREST)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.paste(proj, (0, 0), Image.fromarray((DIA * 255).astype(np.uint8)))
    return out

def build_tile(edge, side, raw_path):
    proj = project_into_diamond(Image.open(raw_path))
    parr = np.array(proj); top = DIA & (parr[:, :, 3] > 20)
    top_rgb = parr[top][:, :3].mean(0); tint = top_rgb / max(top_rgb.max(), 1)
    tile = edge.copy(); tile.alpha_composite(proj)
    a = np.array(tile).astype(float)
    luma = a[side][:, :3] @ np.array([0.299, 0.587, 0.114])
    a[side, :3] = np.clip(luma[:, None] * tint[None, :] * 1.04, 0, 255)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')

def main():
    count = 0
    for fam, pool in CURATION_MAP.items():
        edge = Image.open(f'{TILES}/pixel/{fam}-codexfilter.png').convert('RGBA')
        side = (np.array(edge)[:, :, 3] > 20) & ~DIA
        for n, idx in enumerate(pool):
            build_tile(edge, side, f'{RAW}/{fam}/tile_{idx}.png').save(f'{OUT}/{fam}-{n}.png')
            count += 1
    print(f'wrote {count} production tiles to {OUT}')

if __name__ == '__main__':
    main()
