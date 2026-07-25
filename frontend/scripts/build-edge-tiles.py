#!/usr/bin/env python3
"""Build FRAYED EDGE tile variants for the board's outer ring.

Takes a production surface tile (<fam>-0.png) and re-treats its lower SIDE faces so the
board perimeter reads as a torn chunk of land ("don't terminate abruptly" — the diorama
"tearaway base") instead of a clean machine cut: an earthy rock/strata recolor, a fade
into shadow toward the bottom, and an IRREGULAR broken silhouette (jagged carve + a little
rubble) where the cube currently ends on a flat line.

The TOP diamond is left pixel-identical, so an edge tile seams invisibly with the interior
tiles of the same family — only the cliff face changes. Native 96x180, grafted 1:1 (no
fractional downscale, per the tile pipeline rules).

Cell selection (which cells get this) is done at render time in the board solver: any cell
on a front screen edge (x==cols-1 or y==rows-1). One "both faces frayed" tile covers the
straight edges AND the front corner, because the non-void face is occluded by the tile in
front of it.
"""
import os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SURF = os.path.normpath(os.path.join(HERE, '..', 'public', 'assets', 'tiles', 'surface'))
W, H = 96, 180
APEX, RIGHT, FRONT, LEFT = (48, 41), (96, 68), (48, 95), (0, 68)

# Per-family cliff cross-section tint (multiplier on the tile's own luma). Earthy by default;
# stone/sand/water lean their own way. Tuned by eye.
TINT = {
    'grass':  np.array([1.00, 0.80, 0.58]),  # soil + rock under the turf
    'dirt':   np.array([1.00, 0.82, 0.62]),
    'stone':  np.array([0.96, 0.96, 1.00]),  # cool grey bedrock
    'pebble': np.array([0.98, 0.94, 0.86]),
    'sand':   np.array([1.00, 0.90, 0.66]),  # sandstone shelf
    'water':  np.array([0.80, 0.92, 1.00]),
}
SEED = {'grass': 7, 'dirt': 11, 'stone': 13, 'pebble': 17, 'sand': 19, 'water': 23}


def diamond_mask():
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).polygon([APEX, RIGHT, FRONT, LEFT], fill=255)
    return np.array(m) > 0


DIA = diamond_mask()


def smooth(x, k=6):
    ker = np.ones(k) / k
    return np.convolve(np.pad(x, k, mode='edge'), ker, mode='same')[k:-k]


def build_edge(fam):
    src = f'{SURF}/{fam}-0.png'
    out = f'{SURF}/{fam}-edge.png'
    rng = np.random.default_rng(SEED.get(fam, 1))
    a = np.array(Image.open(src).convert('RGBA')).astype(float)
    alpha = a[:, :, 3]
    side = (alpha > 20) & ~DIA
    ys = np.where(side)[0]
    Btop, Bbot = int(ys.min()), int(ys.max())
    tint = TINT.get(fam, np.array([1.0, 0.85, 0.65]))

    # 1. recolor the side faces to an earthy rock cross-section
    luma = a[:, :, :3] @ np.array([0.299, 0.587, 0.114])
    a[side, :3] = np.clip(luma[side][:, None] * tint[None, :] * 0.97, 0, 255)

    # 2. darken toward the bottom so the torn edge sits in shadow / fades to void
    yy = np.arange(H)[:, None].repeat(W, 1).astype(float)
    f = np.clip(1.0 - 0.60 * (yy - Btop) / max(1, (Bbot - Btop)), 0.38, 1.0)
    a[side, :3] = np.clip(a[side, :3] * f[side][:, None], 0, 255)

    # 3. fray the bottom silhouette: per-column carve depth from smoothed noise + a few notches
    base = smooth(rng.random(W), 7)
    base = (base - base.min()) / max(1e-6, (base.max() - base.min()))
    depth = (3 + base * 13).astype(int)
    for _ in range(3):
        c = int(rng.integers(8, W - 8))
        depth[max(0, c - 2):c + 3] += int(rng.integers(6, 13))

    alpha_out = a[:, :, 3].copy()
    for x in range(W):
        col = np.where(side[:, x])[0]
        if col.size == 0:
            continue
        b = int(col.max())
        d = int(min(depth[x], col.size - 2))
        if d > 0:
            alpha_out[b - d + 1:b + 1, x] = 0
        # occasional rubble fleck hanging just below the torn edge
        if rng.random() < 0.16:
            base_rgb = a[max(Btop, b - 8), x, :3] * 0.7
            for k in range(int(rng.integers(1, 3))):
                ry = (b - d) + 2 + k + int(rng.integers(0, 3))
                if 0 <= ry < H:
                    alpha_out[ry, x] = 210
                    a[ry, x, :3] = base_rgb

    a[:, :, 3] = alpha_out
    Image.fromarray(np.clip(a, 0, 255).astype('uint8'), 'RGBA').save(out)
    print(f'wrote {out}  (side y {Btop}..{Bbot})')


if __name__ == '__main__':
    import sys
    fams = sys.argv[1:] or ['grass']
    for fam in fams:
        build_edge(fam)
