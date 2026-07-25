#!/usr/bin/env python3
"""Split each baked surface tile into TOP (diamond) + SIDE (cliff) layers — ADR-0039.

The board renders a tile as a SIDE layer with the TOP composited over it, so a side can
vary independently of its top (frayed edges now; river/waterfall sides next). This cuts
every existing baked tile along the top-diamond mask:
  - <name>-top.png  = pixels INSIDE the diamond (the walkable surface)
  - <name>-side.png = pixels OUTSIDE it (the cliff faces)
By construction the two are disjoint, so compositing side then top reproduces the original
exactly (verified below). Native 96x180 frame, no rescale — pure alpha masking.
"""
import os
import glob
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SURF = os.path.normpath(os.path.join(HERE, '..', 'public', 'assets', 'tiles', 'surface'))
W, H = 96, 180
APEX, RIGHT, FRONT, LEFT = (48, 41), (96, 68), (48, 95), (0, 68)


def diamond_mask():
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).polygon([APEX, RIGHT, FRONT, LEFT], fill=255)
    return np.array(m) > 0


DIA = diamond_mask()


def split(path):
    a = np.array(Image.open(path).convert('RGBA'))
    top = a.copy(); top[~DIA, 3] = 0   # top keeps only the diamond
    side = a.copy(); side[DIA, 3] = 0  # side keeps only everything outside it
    base = path[:-4]
    Image.fromarray(top, 'RGBA').save(base + '-top.png')
    Image.fromarray(side, 'RGBA').save(base + '-side.png')
    # verify: side, then top over it, must equal the original pixel-for-pixel
    recomb = Image.fromarray(side, 'RGBA').copy()
    recomb.alpha_composite(Image.fromarray(top, 'RGBA'))
    return int(np.abs(np.array(recomb).astype(int) - a.astype(int)).sum())


def main():
    files = sorted(p for p in glob.glob(os.path.join(SURF, '*.png'))
                   if not p.endswith(('-top.png', '-side.png')))
    bad = 0
    for p in files:
        diff = split(p)
        if diff != 0:
            bad += 1
            print(f'  MISMATCH ({diff}) {os.path.basename(p)}')
    print(f'split {len(files)} tiles into top/side layers; {len(files) - bad} verified identical, {bad} mismatched')


if __name__ == '__main__':
    main()
