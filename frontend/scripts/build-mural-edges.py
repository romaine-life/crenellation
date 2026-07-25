#!/usr/bin/env python3
"""Slice a WIDE cliff MURAL into N ordered windows and project each onto the iso side
faces (ADR-0039 continuity system). Consecutive windows are ADJACENT columns of the
mural, so when the solver hands consecutive board-edge cells consecutive windows the
cliff FLOWS across tiles (this replaces the random per-tile edge variant).

The projection generalises project-tile-side.py to a RECTANGULAR window (any aspect):
src triangle TL(0,0) TR(W,0) BL(0,H) -> the iso face parallelogram. Same lighting
contract (upper-left light: left face lit, right shadowed, base darken, front-edge lip).

  python build-mural-edges.py <mural.png> <mask-side.png> <out-dir> <prefix> <N> [start]

Writes <out-dir>/<prefix>-mural-<start+i>-side.png (+ -top.png + combined .png) for i in 0..N-1.
`start` (default 0) lets several murals share ONE numbered window bank (e.g. 3 murals × 16 →
windows 0..47), so the whole bank reads continuous AND uses every generated mural.
"""
import sys
import os
import numpy as np
from PIL import Image

CANVAS = (96, 180)
APEX = (48, 41); RIGHT = (96, 68); FRONT = (48, 95); LEFT = (0, 68)
BASE_Y = 180


def inverse_affine(dst3, W, H):
    """PIL AFFINE coeffs (OUTPUT->INPUT) for src rect TL(0,0) TR(W,0) BL(0,H) -> dst3."""
    dst = np.array(dst3, dtype=float)
    src = np.array([(0, 0), (W, 0), (0, H)], dtype=float)
    M = np.column_stack([dst, np.ones(3)])
    a, b, c = np.linalg.solve(M, src[:, 0])
    d, e, f = np.linalg.solve(M, src[:, 1])
    return (a, b, c, d, e, f)


def project(win, dst3):
    W, H = win.size
    coeffs = inverse_affine(dst3, W, H)
    return win.transform(CANVAS, Image.AFFINE, coeffs, resample=Image.NEAREST).convert('RGBA')


def rich_side(win, side):
    H, W = side.shape[0], side.shape[1]
    alpha = side[:, :, 3] > 20
    xs = np.arange(W)[None, :].repeat(H, 0)
    left_region = alpha & (xs < 48)
    right_region = alpha & (xs >= 48)

    pl = np.array(project(win, [LEFT, FRONT, (LEFT[0], BASE_Y)]))
    pr = np.array(project(win, [FRONT, RIGHT, (FRONT[0], BASE_Y)]))

    out = np.zeros((H, W, 4), dtype=float)
    out[left_region] = pl[left_region]
    out[right_region] = pr[right_region]
    out[left_region, :3] = np.clip(out[left_region, :3] * 1.06, 0, 255)
    out[right_region, :3] = np.clip(out[right_region, :3] * 0.78, 0, 255)

    ys = np.where(alpha)[0]
    if ys.size:
        top, bot = int(ys.min()), int(ys.max())
        yy = np.arange(H)[:, None].repeat(W, 1).astype(float)
        f = np.clip(1.0 - 0.42 * (yy - top) / max(1, (bot - top)), 0.5, 1.0)
        out[alpha, :3] = np.clip(out[alpha, :3] * f[alpha][:, None], 0, 255)
    for fx in (47, 48):
        col = alpha[:, fx]
        out[col, fx, :3] = np.clip(out[col, fx, :3] * 1.18 + 14, 0, 255)

    out[:, :, 3] = side[:, :, 3]
    return out.astype('uint8')


def main():
    mural_path, mask_path, out_dir, prefix, N = sys.argv[1:6]
    N = int(N)
    start = int(sys.argv[6]) if len(sys.argv) > 6 else 0
    mural = Image.open(mural_path).convert('RGBA')
    side = np.array(Image.open(mask_path).convert('RGBA'))
    W, H = mural.size
    ww = W // N
    os.makedirs(out_dir, exist_ok=True)
    # Only the -side layer is needed: the board composes this under the cell's OWN base-tile
    # -top (the side asset's top is never used), so we don't bake redundant -top/combined files.
    for i in range(N):
        x0 = i * ww
        win = mural.crop((x0, 0, (x0 + ww) if i < N - 1 else W, H))
        idx = start + i
        Image.fromarray(rich_side(win, side), 'RGBA').save(os.path.join(out_dir, f"{prefix}-{idx}-side.png"))
    print(f"wrote windows {start}..{start + N - 1} ({ww}px each) -> {out_dir}/{prefix}-*-side.png")


if __name__ == '__main__':
    main()
