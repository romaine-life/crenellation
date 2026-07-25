#!/usr/bin/env python3
"""Project a FLAT cliff cross-section slab onto the two iso SIDE faces (ADR-0039).

The side is two parallelograms meeting at the front vertical edge (x=48):
  left face : LEFT(0,68) -> FRONT(48,95) on top, straight down to the base
  right face: FRONT(48,95) -> RIGHT(96,68) on top, straight down to the base
We affine-skew the slab onto each (so codex never draws our iso angle), clip to the
EXISTING side silhouette (so the frayed bottom etc. is preserved), then bake the lighting
contract: light from upper-left -> left face lit, right face shadowed, a 1px highlight on
the front edge, and a stepped darken into the void. Output replaces <fam>-<n>-side.png.

  python project-tile-side.py <slab.png> <existing-side.png> <out-side.png>
"""
import sys
import numpy as np
from PIL import Image

CANVAS = (96, 180)
APEX = (48, 41); RIGHT = (96, 68); FRONT = (48, 95); LEFT = (0, 68)
BASE_Y = 180  # project down to the frame bottom; the existing alpha clips the real silhouette


def inverse_affine(dst3, S):
    """PIL AFFINE coeffs mapping OUTPUT->INPUT, source square TL(0,0) TR(S,0) BL(0,S)."""
    dst = np.array(dst3, dtype=float)
    src = np.array([(0, 0), (S, 0), (0, S)], dtype=float)
    M = np.column_stack([dst, np.ones(3)])
    a, b, c = np.linalg.solve(M, src[:, 0])
    d, e, f = np.linalg.solve(M, src[:, 1])
    return (a, b, c, d, e, f)


def project(slab, dst3):
    S = slab.size[0]
    coeffs = inverse_affine(dst3, S)
    return slab.transform(CANVAS, Image.AFFINE, coeffs, resample=Image.NEAREST).convert('RGBA')


def rich_side(slab, side):
    """slab: RGBA Image (flat cliff cross-section). side: RGBA np array (frayed silhouette,
    its alpha defines the exact side shape). Returns the rich side as a uint8 RGBA array."""
    H, W = side.shape[0], side.shape[1]
    alpha = side[:, :, 3] > 20            # the real side silhouette (incl. frayed bottom)
    xs = np.arange(W)[None, :].repeat(H, 0)
    left_region = alpha & (xs < 48)
    right_region = alpha & (xs >= 48)

    pl = np.array(project(slab, [LEFT, FRONT, (LEFT[0], BASE_Y)]))    # left face
    pr = np.array(project(slab, [FRONT, RIGHT, (FRONT[0], BASE_Y)]))  # right face

    out = np.zeros((H, W, 4), dtype=float)
    out[left_region] = pl[left_region]
    out[right_region] = pr[right_region]

    # lighting contract: upper-left light -> left lit, right shadowed
    out[left_region, :3] = np.clip(out[left_region, :3] * 1.06, 0, 255)
    out[right_region, :3] = np.clip(out[right_region, :3] * 0.78, 0, 255)

    # stepped darken into the void (reinforce base shadow)
    ys = np.where(alpha)[0]
    if ys.size:
        top, bot = int(ys.min()), int(ys.max())
        yy = np.arange(H)[:, None].repeat(W, 1).astype(float)
        f = np.clip(1.0 - 0.42 * (yy - top) / max(1, (bot - top)), 0.5, 1.0)
        out[alpha, :3] = np.clip(out[alpha, :3] * f[alpha][:, None], 0, 255)

    # 1px front-edge highlight (the lip catch) along x=47..48
    for fx in (47, 48):
        col = alpha[:, fx]
        out[col, fx, :3] = np.clip(out[col, fx, :3] * 1.18 + 14, 0, 255)

    out[:, :, 3] = side[:, :, 3]          # preserve the exact silhouette alpha
    return out.astype('uint8')


def main():
    slab_path, side_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    slab = Image.open(slab_path).convert('RGBA')
    side = np.array(Image.open(side_path).convert('RGBA'))
    Image.fromarray(rich_side(slab, side), 'RGBA').save(out_path)
    print('wrote', out_path)


if __name__ == '__main__':
    main()
