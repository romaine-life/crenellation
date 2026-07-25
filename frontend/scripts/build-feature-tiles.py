#!/usr/bin/env python3
"""Bake the linear-FEATURE overlay sets (roads + rivers) — 16 transparent tiles per
material, one per 4-bit connection mask — into
public/assets/tiles/feature/<kind>-<material>-<mask>.png (+ a square -thumb.png).

Per ADR-0040 (own the geometry, generate the material): the connection FOOTPRINT is
ours (so pieces always tessellate), the painted SURFACE is GENERATED art. NO code-drawn
fills.

THE METHOD (authored + seamless), same for every material:
  A code-drawn GUIDE map of all connection cases on a grid
  (docs/art/codex-runs/roads/dirt-base-guide.png) is repainted by codex in ONE pass as
  authored pixel art (committed sources: docs/art/codex-runs/<kind>s/<material>-network.png).
  We slice each case cell out of that single drawing, EDGE-HEAL it (clamp the ribbon to a
  consistent width so it can't bulge/pinch, force the path to cross every tile edge at one
  canonical centred band, fade non-connected edges to grass) so REUSED tiles tessellate,
  rotate the base cases to cover all 16 masks, and project into the iso diamond. Organic
  interior, seam-clean edges. Roads = dirt/cobble; rivers = water (water body + bank), all
  via this one pipeline. To add a material: codex-repaint the guide, drop the result under
  docs/art/codex-runs/<kind>s/, add it to FEATURES, re-run.

Geometry pinned to the canonical iso frame (matches build-surface-tiles.py and the
.tileset-generated-board-tile / boardProjection contract):
  frame 96x180; top diamond APEX(48,41) RIGHT(96,68) FRONT(48,95) LEFT(0,68)
Bit order N,E,S,W = 1,2,4,8, matching featureAutotile.FEATURE_DIRS.

Usage (from frontend/):  python scripts/build-feature-tiles.py
"""
import math
import os
import sys
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
CODEX = os.path.normpath(os.path.join(ROOT, '..', 'docs', 'art', 'codex-runs'))  # /<kind>s/<material>-network.png
OUT = os.path.join(ROOT, 'public', 'assets', 'tiles', 'feature')

W, H = 96, 180
APEX, RIGHT, FRONT, LEFT = (48, 41), (96, 68), (48, 95), (0, 68)
DIA = Image.new('L', (W, H), 0)
ImageDraw.Draw(DIA).polygon([APEX, RIGHT, FRONT, LEFT], fill=255)
CLIP = DIA.filter(ImageFilter.MaxFilter(7))  # dilated clip -> connected stubs overlap the seam

T = 96            # base cell size in the repaint grid
HEAL_W = 40.0     # canonical path width at a tile edge
HEAL_M = 16.0     # heal depth (how far the edge normalisation blends inward)
BANK_W = 6        # river bank rim width (px) — see _river_layers; 0 = water meets grass
ROAD_GRID = (7, 5)
# Each base-case cell's ACTUAL grid-space connection mask in the guide layout (N=1,E=2,S=4,W=8).
# Getting (2,2) wrong (it connects N+E+W = 11, not E+S+W) once dropped the T's third arm.
ROAD_CASES = {'end': ((3, 0), 4), 'straight': ((3, 1), 5), 'corner': ((1, 2), 6), 'T': ((2, 2), 11), 'cross': ((3, 2), 15)}

# kind, material, source kind-dir. Add a row (+ a codex-repaint source) to add a material.
FEATURES = [
    ('road', 'dirt'), ('road', 'cobble'),   # roads (variety)
    ('river', 'water'),                       # river (water body + bank)
]


def project_square(im):
    """Affine-map a top-down SQUARE tile onto the iso top-diamond (NEAREST), clipped to the
    dilated diamond so connected stubs overlap the seam."""
    s = im.size[0]
    dst = np.array([APEX, RIGHT, LEFT], float)
    src = np.array([(0, 0), (s, 0), (0, s)], float)
    M = np.column_stack([dst, np.ones(3)])
    cx = np.linalg.solve(M, src[:, 0]); cy = np.linalg.solve(M, src[:, 1])
    pr = im.transform((W, H), Image.AFFINE, (cx[0], cx[1], cx[2], cy[0], cy[1], cy[2]), resample=Image.NEAREST)
    pr.putalpha(ImageChops.multiply(pr.split()[3], CLIP))
    return pr


def _rotcw(mask, k):
    out = 0
    for p in range(4):
        if mask & (1 << p):
            out |= 1 << ((p + k) % 4)
    return out


def _case_for(mask):
    pc = bin(mask).count('1')
    if pc == 0:
        return None
    name = 'end' if pc == 1 else ('straight' if mask in (5, 10) else 'corner') if pc == 2 else 'T' if pc == 3 else 'cross'
    bm = ROAD_CASES[name][1]
    for k in range(4):
        if _rotcw(bm, k) == mask:
            return name, k
    raise SystemExit(f'no rotation maps {name}({bm}) -> {mask}')


def _canonical_ribbon(mask):
    """Consistent-width ribbon SHAPE the path is CLAMPED to, so the variable-width codex path
    can't bulge mid-tile / pinch at seams. Slightly wider than HEAL_W so organic edge nibbles
    survive inside."""
    img = Image.new('L', (T, T), 0); d = ImageDraw.Draw(img); c = (T / 2, T / 2)
    mids = {1: (T / 2, 0), 2: (T, T / 2), 4: (T / 2, T), 8: (0, T / 2)}
    half = (HEAL_W + 6) / 2
    for bit, (mx, my) in mids.items():
        if mask & bit:
            dx, dy = mx - c[0], my - c[1]; L = math.hypot(dx, dy) or 1.0; nx, ny = -dy / L * half, dx / L * half
            ex, ey = mx + dx / L * 4, my + dy / L * 4
            d.polygon([(c[0] + nx, c[1] + ny), (ex + nx, ey + ny), (ex - nx, ey - ny), (c[0] - nx, c[1] - ny)], fill=255)
    d.ellipse([c[0] - half, c[1] - half, c[0] + half, c[1] + half], fill=255)
    return np.array(img) > 0


def _erode(mask_bool, px):
    """Shrink a boolean mask inward by `px` pixels (morphological erosion via MinFilter)."""
    if px <= 0:
        return mask_bool
    im = Image.fromarray((mask_bool * 255).astype(np.uint8), 'L').filter(ImageFilter.MinFilter(px * 2 + 1))
    return np.array(im) > 127


def _silhouette(arr, mask):
    """The shared geometry step for every feature: clamp the path to a consistent-width ribbon
    (no bulge), force every connected edge to cross at one canonical centred band, fade
    non-connected edges to grass. Returns the soft alpha `a` (0..1) and the grass mask."""
    R, G, B = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    grass = (G > R + 6) & (G > B - 4) & (G > 90)
    a = (~grass).astype(float)  # path = NOT dithered grass (keeps water + bank too)
    a *= _canonical_ribbon(mask)
    ys, xs = np.mgrid[0:T, 0:T]
    edges = {1: (ys, xs), 4: (T - 1 - ys, xs), 2: (T - 1 - xs, ys), 8: (xs, ys)}  # bit:(depth, perp)
    for bit, (d, perp) in edges.items():
        near = d < HEAL_M; w = np.clip((HEAL_M - d) / HEAL_M, 0, 1)
        if mask & bit:
            canon = (np.abs(perp - T / 2) <= HEAL_W / 2).astype(float)
            a = np.where(near, a * (1 - w) + canon * w, a)
        else:
            a = np.where(near, a * (d / HEAL_M), a)
    return np.clip(a, 0, 1), grass


def _heal(arr, mask, kind='road', bank_w=BANK_W):
    """Author one base-case cell. The silhouette geometry is OURS; codex supplies the material.

    Road (dirt/cobble): one material edge-to-edge — keep codex texture inside the clamped
    ribbon, recolour any grass-coloured holes to the road's own median.

    River: TWO concentric bands, both geometry-owned so the edge is consistent everywhere
    (codex's painted bank wandered in width — see _river_layers). The water core is the ribbon
    eroded inward by `bank_w`; the bank is the uniform rim between core and silhouette; the
    water OPENS at every connected seam so it flows through with no brown cap. bank_w=0 drops
    the bank (water meets grass)."""
    a, grass = _silhouette(arr, mask)
    if kind == 'river':
        return _river_layers(arr, a, mask, grass, bank_w)
    rb = arr.copy(); need = (a > 0.4) & grass  # path-alpha pixels still grass-coloured -> fill path colour
    if ((a > 0.4) & ~grass).any():
        med = np.median(arr[(a > 0.4) & ~grass][:, :3], axis=0)
        rb[need, 0], rb[need, 1], rb[need, 2] = med[0], med[1], med[2]
    return Image.fromarray(np.dstack([rb[:, :, 0], rb[:, :, 1], rb[:, :, 2], a * 255]).astype(np.uint8), 'RGBA')


def _river_layers(arr, a, mask, grass, bank_w):
    """Author the river entirely on OUR geometry so the bank is uniform everywhere.

    The silhouette is the canonical ribbon itself (NOT codex coverage) — codex's two-tone
    paint underfills the guide path in spots, so gating the shape on it (like roads do) made
    the bank wander. Here the shape is ours: water core = ribbon eroded inward by `bank_w`,
    bank = the constant-width rim between core and ribbon, opened to water at every connected
    seam so the flow is continuous tile-to-tile. Codex supplies only the colours (median water
    + bank) and the ripple/foam texture kept wherever it actually painted blue. bank_w=0 drops
    the bank (water meets grass)."""
    R, G, B = arr[:, :, 0].astype(int), arr[:, :, 1].astype(int), arr[:, :, 2].astype(int)
    outer = _canonical_ribbon(mask)  # uniform clean geometry — arms to each connected edge + centre
    ys, xs = np.mgrid[0:T, 0:T]
    edges = {1: (ys, xs), 4: (T - 1 - ys, xs), 2: (T - 1 - xs, ys), 8: (xs, ys)}  # bit:(depth, perp)
    conn = np.zeros((T, T), bool)  # near a connected edge, on-axis -> water (no bank cap across the flow)
    for bit, (d, perp) in edges.items():
        if mask & bit:
            conn |= (d < bank_w * 1.6 + 3) & (np.abs(perp - T / 2) <= HEAL_W / 2)
    water_mask = (_erode(outer, bank_w) | conn) & outer
    bank_mask = outer & ~water_mask
    blue = B > R + 6
    is_water = outer & ~grass & blue                 # codex blue (for the median + kept texture)
    is_bank = outer & ~grass & ~blue & (a > 0.2)     # codex brown/earth where it actually painted
    water_med = np.median(arr[is_water][:, :3], axis=0) if is_water.any() else np.array([60, 120, 180.0])
    bank_med = np.median(arr[is_bank][:, :3], axis=0) if is_bank.any() else water_med * np.array([1.35, 0.85, 0.55])
    rb = arr.copy()
    fill_water = water_mask & ~(is_water)            # keep codex ripple/foam where it's blue; fill the rest
    rb[fill_water, 0], rb[fill_water, 1], rb[fill_water, 2] = water_med[0], water_med[1], water_med[2]
    rb[bank_mask, 0], rb[bank_mask, 1], rb[bank_mask, 2] = bank_med[0], bank_med[1], bank_med[2]
    alpha = outer.astype(float)                       # silhouette is ours -> hard pixel edge (no codex raggedness)
    return Image.fromarray(np.dstack([rb[:, :, 0], rb[:, :, 1], rb[:, :, 2], alpha * 255]).astype(np.uint8), 'RGBA')


def bake_feature(kind, material, total, source=None, bank_w=BANK_W):
    """Bake one 16-mask material set. `source` overrides the codex network filename stem
    (default = material) so comparison variants can share one source; `bank_w` is the river
    bank rim width."""
    rep = Image.open(f'{CODEX}/{kind}s/{source or material}-network.png').convert('RGBA').resize((ROAD_GRID[0] * T, ROAD_GRID[1] * T))
    cells = {name: np.array(rep.crop((cx * T, cy * T, cx * T + T, cy * T + T))).astype(float) for name, ((cx, cy), _m) in ROAD_CASES.items()}
    healed = {name: _heal(cells[name], ROAD_CASES[name][1], kind=kind, bank_w=bank_w) for name in ROAD_CASES}
    for mask in range(16):
        cf = _case_for(mask)
        if cf is None:  # isolated: a small node from the cross centre
            base = healed['cross']; node = Image.new('RGBA', (T, T), (0, 0, 0, 0))
            node.paste(base.crop((T // 2 - 22, T // 2 - 22, T // 2 + 22, T // 2 + 22)), (T // 2 - 22, T // 2 - 22)); sq = node
        else:
            name, k = cf; sq = healed[name].rotate(-90 * k, expand=False)
        project_square(sq).save(f'{OUT}/{kind}-{material}-{mask}.png'); total[0] += 1
    cross = project_square(healed['cross']); al = np.array(cross)[:, :, 3]; yy, xx = np.where(al > 10)
    crop = cross.crop((int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1))
    side = max(crop.size) + 8; thumb = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    thumb.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2)); thumb.save(f'{OUT}/{kind}-{material}-thumb.png')


# River bank-treatment comparison variants (NOT shipped): bake extra throwaway materials from
# the SAME water source so they can be rendered side-by-side via ?board. Run with --compare;
# delete river-water{nb,wide}-*.png before committing.
COMPARE = [('river', 'waternb', 'water', 0), ('river', 'waterwide', 'water', 11)]


def main():
    compare = '--compare' in sys.argv
    os.makedirs(OUT, exist_ok=True)
    for stale in os.listdir(OUT):
        if stale.endswith('.png') and (stale.startswith('road-') or stale.startswith('river-')):
            os.remove(os.path.join(OUT, stale))
    total = [0]
    for kind, material in FEATURES:
        bake_feature(kind, material, total)
    if compare:
        for kind, material, source, bank_w in COMPARE:
            bake_feature(kind, material, total, source=source, bank_w=bank_w)
    print(f'wrote {total[0]} feature overlays ({", ".join(k+"/"+m for k, m in FEATURES)}'
          f'{" + compare variants" if compare else ""}) to {OUT}')


if __name__ == '__main__':
    main()
