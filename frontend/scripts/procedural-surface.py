#!/usr/bin/env python
# Procedural pixel-art SURFACE generator (bake-off approach "A").
#
# The point: pixel art needs AUTHORED pixels, not a downsampled photo. So we build the
# surface at native resolution from organic noise fields (fBm value noise + Worley/Voronoi
# crack networks, directional warped grain for wood), then map the continuous value through
# a hand-CURATED palette ramp with ORDERED (Bayer) dithering — the deliberate, structured
# shading that reads as crafted 16-bit pixel art rather than mush. Generated at panel size,
# so there is no tile and no repeat.
#
#   python procedural-surface.py --material stone-blue --size 460x300 --seed 7 --out tile.png
import argparse
import numpy as np
from PIL import Image, ImageEnhance

BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], dtype=np.float64) / 16.0

# Curated low-glare ramps (dark -> light), built from the app shell tokens.
PALETTES = {
    'stone-blue':  ['#0a1018', '#101d28', '#192c3a', '#23394a', '#2f4a5c', '#3d5d70', '#4e7184', '#608798'],
    'stone-grey':  ['#1b1e22', '#24282d', '#2f3439', '#3a4046', '#474e54', '#565e65', '#666f77', '#79828b'],
    'wood-oak':    ['#241608', '#33210f', '#432b18', '#553a23', '#67492e', '#7a5938', '#8f6c45', '#a78457'],
    'wood-walnut': ['#160d07', '#221710', '#2f2016', '#3b2a1d', '#492f1f', '#5a3d28', '#6d4d34', '#825f42'],
}

def hex2rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)], dtype=np.uint8)

def rng(seed):
    return np.random.default_rng(seed)

REF_W, REF_H = 460, 300  # feature sizes are authored at this canvas; they scale to keep a
                         # constant PIXEL feature-size as the real canvas grows.

def value_noise(h, w, cells, r, octaves=4, persistence=0.55):
    # fractional Brownian motion from upscaled random lattices.
    cells = max(2, round(cells * w / REF_W))   # constant pixel-wavelength at any width
    out = np.zeros((h, w), dtype=np.float64)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        cy, cx = max(2, cells * (2 ** o)), max(2, int(cells * 1.5) * (2 ** o))
        grid = r.random((cy, cx))
        layer = np.asarray(Image.fromarray((grid * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR), dtype=np.float64) / 255.0
        out += amp * layer
        tot += amp
        amp *= persistence
    out /= tot
    return (out - out.min()) / (np.ptp(out) + 1e-9)

def worley(h, w, n, r, pad=0.15):
    # F1, F2 distance fields from scattered feature points (points spill past edges so cracks
    # don't stop at the border). Cell EDGES (cracks) are where F1≈F2.
    px = r.uniform(-pad * w, w + pad * w, n)
    py = r.uniform(-pad * h, h + pad * h, n)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float64)
    f1 = np.full((h, w), 1e9)
    f2 = np.full((h, w), 1e9)
    for i in range(n):
        d = np.hypot(xs - px[i], ys - py[i])
        closer = d < f1
        f2 = np.where(closer, f1, np.minimum(f2, d))
        f1 = np.where(closer, d, f1)
    return f1, f2

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)

def crack_field(h, w, scales, r):
    area = (w * h) / (REF_W * REF_H)            # point COUNT scales with area → constant density
    cracks = np.zeros((h, w))
    for (n, width, depth) in scales:
        f1, f2 = worley(h, w, max(8, round(n * area)), r)
        edge = f2 - f1
        mask = 1.0 - smoothstep(0, width, edge)        # 1 on the seam, 0 in the cell body
        cracks = np.maximum(cracks, depth * mask)
    return cracks

def stone_value(h, w, r):
    mottle = value_noise(h, w, cells=3, r=r, octaves=5)            # broad tone patches
    speck = value_noise(h, w, cells=24, r=r, octaves=2)           # fine grain
    cracks = crack_field(h, w, [(70, 1.6, 1.0), (200, 0.9, 0.6)], r)  # slab + hairline cracks
    v = 0.62 * mottle + 0.18 * speck
    v = v - 0.85 * cracks                                          # cut the cracks dark
    return np.clip((v - v.min()) / (np.ptp(v) + 1e-9), 0, 1)

def wood_value(h, w, r, plank_px=46):
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float64)
    warp = value_noise(h, w, cells=5, r=r, octaves=4)
    grain = 0.5 + 0.5 * np.sin((xs * 0.16) + warp * 7.0 + value_noise(h, w, 8, r, 3) * 5.0)
    grain = grain ** 1.6                                           # tighten the grain lines
    planks = (ys // plank_px).astype(int)
    tone = r.uniform(-0.12, 0.12, planks.max() + 2)[planks]        # per-plank tone shift
    gap = smoothstep(0, 2.0, np.abs((ys % plank_px) - 0)) * smoothstep(0, 2.0, (plank_px - (ys % plank_px)))
    v = 0.30 + 0.42 * grain + tone
    v = v * (0.45 + 0.55 * gap)                                    # darken plank seams
    # knots — count scales with area so big boards aren't bare
    for _ in range(max(2, round(r.uniform(2, 4) * (w * h) / (REF_W * REF_H)))):
        ky, kx = r.uniform(0, h), r.uniform(0, w)
        d = np.hypot(xs - kx, ys - ky)
        v -= 0.5 * np.exp(-(d ** 2) / (2 * (r.uniform(5, 9) ** 2)))
    return np.clip((v - v.min()) / (np.ptp(v) + 1e-9), 0, 1)

# Approach "B" (hybrid): use a generated organic render's LUMINANCE as the value field, so the
# natural crack/grain LAYOUT comes from codex but the PIXELS are authored (curated ramp + dither).
def image_value(path, w, h, contrast=1.35):
    im = ImageEnhance.Contrast(Image.open(path).convert('L')).enhance(contrast).resize((w, h), Image.LANCZOS)
    v = np.asarray(im, dtype=np.float64) / 255.0
    return (v - v.min()) / (np.ptp(v) + 1e-9)

def make_seamless(v):
    # Offset + 2-pass edge blend so the tile wraps seamlessly, applied to the VALUE field
    # (before palette/dither) so the output stays crisp pixel art. Near each pair of edges we
    # cross-fade in a half-shifted copy — whose opposite edges already match — killing the seam.
    h, w = v.shape
    ax = (np.minimum(np.arange(w), w - np.arange(w)) / (w / 2.0))[None, :]   # 0 at L/R edges, 1 mid
    v = ax * v + (1 - ax) * np.roll(v, w // 2, axis=1)
    ay = (np.minimum(np.arange(h), h - np.arange(h)) / (h / 2.0))[:, None]
    v = ay * v + (1 - ay) * np.roll(v, h // 2, axis=0)
    return v

def render(value, palette_hex):
    h, w = value.shape
    pal = np.stack([hex2rgb(c) for c in palette_hex])
    n = len(pal)
    pos = value * (n - 1)
    lo = np.floor(pos).astype(int)
    frac = pos - lo
    thresh = np.tile(BAYER4, (h // 4 + 1, w // 4 + 1))[:h, :w]
    idx = np.clip(lo + (frac > thresh).astype(int), 0, n - 1)
    return Image.fromarray(pal[idx].astype(np.uint8), 'RGB')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--material', required=True, choices=list(PALETTES))
    ap.add_argument('--size', default='460x300')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--from-image', default=None, help='hybrid mode: drive the value field from this image\'s luminance')
    ap.add_argument('--seamless', action='store_true', help='make the tile wrap seamlessly for repeat-tiling')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    w, h = (int(x) for x in a.size.lower().split('x'))
    r = rng(a.seed)
    if a.from_image:
        value = image_value(a.from_image, w, h)
    else:
        value = (wood_value if a.material.startswith('wood') else stone_value)(h, w, r)
    if a.seamless:
        value = make_seamless(value)
    render(value, PALETTES[a.material]).save(a.out)
    print(f'{a.out}  {w}x{h}  {a.material}  seed={a.seed}  ({len(PALETTES[a.material])}-color ramp, Bayer dither)')

main()
