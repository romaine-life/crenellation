#!/usr/bin/env python
# Snap a PixelLab (or any) isometric tile to OUR canonical iso grid.
#
# Why: PixelLab generates isometric tiles at its own (and tile-to-tile inconsistent) diamond
# angle, with side depth that varies by material — neither matches our fixed 30deg, 96x180
# grid, so tops don't tessellate and sides are too short/tall.
#
# How: a two-segment vertical anchor that is robust to any block proportions —
#   * apex (topmost opaque, after stripping any detached cap) -> canonical apex_y
#   * widest row (the diamond's left/right corners, where the tile first spans full width) -> wide_y
#   * block bottom -> canvas bottom
# Anchoring apex->41 and the corners->68 makes the diamond's top edges exactly 27/48 = ~29deg
# BY CONSTRUCTION (no angle measurement, no squash/clamp conflict); the lower segment is scaled
# independently to fill the footprint, so the sides always reach the bottom without clipping.
#
#   python correct-iso-tile-angle.py --input raw.png --out tile.png
#     [--apex-y 41] [--wide-y 68] [--width 96] [--height 180]
import argparse
from PIL import Image
import numpy as np


def strip_floating_cap(im):
    # PixelLab sometimes leaves a detached dark sliver floating above the block (a separate
    # vertical run of opaque rows). Drop anything above the largest run so it isn't treated as
    # the apex or carried into the output.
    a = np.array(im.convert('RGBA'))
    rows = (a[:, :, 3] > 40).any(axis=1)
    runs, start = [], None
    for y, on in enumerate(rows):
        if on and start is None:
            start = y
        if (not on) and start is not None:
            runs.append((start, y - 1)); start = None
    if start is not None:
        runs.append((start, len(rows) - 1))
    if len(runs) > 1:
        main_top = max(runs, key=lambda r: r[1] - r[0])[0]
        a[:main_top, :, 3] = 0
        return Image.fromarray(a)
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--apex-y', type=int, default=41, help='canonical y of the diamond apex')
    ap.add_argument('--wide-y', type=int, default=68, help='canonical y of the diamond left/right corners')
    ap.add_argument('--front-y', type=int, default=95, help='canonical y of the diamond front tip (top-face bottom)')
    ap.add_argument('--width', type=int, default=96)
    ap.add_argument('--height', type=int, default=180)
    a = ap.parse_args()

    im = strip_floating_cap(Image.open(a.input).convert('RGBA'))
    content = im.crop(im.getbbox())
    cw, ch = content.size
    if cw != a.width:
        content = content.resize((a.width, round(ch * a.width / cw)), Image.NEAREST)
        cw, ch = content.size

    al = np.array(content)[:, :, 3] > 40
    widths = al.sum(axis=1)
    rows = np.where(widths > 0)[0]
    apex = int(rows.min())
    bottom = int(rows.max())
    full = int(widths.max())
    widest = int(np.where(widths >= full - 2)[0].min())  # first row reaching ~full width = a corner
    widest = max(widest, apex + 1)
    # Bottom tip of the top face. The iso diamond is symmetric about its corners line, so the
    # lower half equals the upper half — compute it instead of trying to detect an interior edge.
    front = min(2 * widest - apex, bottom - 1)
    front = max(front, widest + 1)

    # THREE fixed anchors -> identical block geometry for EVERY tile, so mixed variants tessellate
    # with no depth ledges: apex->apex_y, corners->wide_y, front tip->front_y, bottom->height.
    #   upper diamond half (apex..corners)    -> apex_y..wide_y  (sets the ~29deg top edges)
    #   lower diamond half (corners..front)   -> wide_y..front_y
    #   side faces         (front..bottom)    -> front_y..height (normalized to a fixed depth)
    upper = content.crop((0, apex, cw, widest)).resize((cw, a.wide_y - a.apex_y), Image.NEAREST)
    lowerdia = content.crop((0, widest, cw, front)).resize((cw, a.front_y - a.wide_y), Image.NEAREST)
    sides = content.crop((0, front, cw, bottom + 1)).resize((cw, a.height - a.front_y), Image.NEAREST)

    canvas = Image.new('RGBA', (a.width, a.height), (0, 0, 0, 0))
    canvas.paste(upper, (0, a.apex_y), upper)
    canvas.paste(lowerdia, (0, a.wide_y), lowerdia)
    canvas.paste(sides, (0, a.front_y), sides)
    canvas.save(a.out)
    print(f'{a.out}  apex@{a.apex_y} corners@{a.wide_y} front@{a.front_y} bottom@{a.height}')


main()
