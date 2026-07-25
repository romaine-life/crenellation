#!/usr/bin/env python3
"""Build a labeled contact sheet of tile_*.png in a dir (for me to pick from)."""
import sys, glob
from PIL import Image, ImageDraw, ImageFont

d = sys.argv[1]; out = sys.argv[2]; title = sys.argv[3] if len(sys.argv) > 3 else d
fs = sorted(glob.glob(f'{d}/tile_*.png'), key=lambda p: int(p.replace('\\', '/').split('_')[-1].split('.')[0]))
if not fs:
    print('no tiles in', d); sys.exit(1)
Z = 4; cell = 64 * Z; pad = 26; cols = 4
rows = (len(fs) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (cell + pad) + pad, rows * (cell + pad) + pad + 24), (22, 24, 30))
dr = ImageDraw.Draw(sheet)
try:
    f = ImageFont.truetype('arialbd.ttf', 16)
except Exception:
    f = ImageFont.load_default()
dr.text((pad, 6), title, fill=(235, 235, 240), font=f)
for i, p in enumerate(fs):
    r, c = divmod(i, cols)
    x = pad + c * (cell + pad); y = 30 + pad + r * (cell + pad)
    im = Image.open(p).convert('RGBA').resize((cell, cell), Image.NEAREST)
    bg = Image.new('RGBA', (cell, cell), (40, 44, 52, 255)); bg.alpha_composite(im)
    sheet.paste(bg.convert('RGB'), (x, y))
    dr.text((x, y - 18), f'tile_{i}', fill=(220, 220, 225), font=f)
sheet.save(out)
print('saved', out, 'tiles', len(fs))
