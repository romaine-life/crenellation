#!/usr/bin/env python
# Grid-snap a generated surface tile to TRUE pixel art: downscale to a small native footprint
# and quantize to a limited palette (optionally Floyd-Steinberg dithered). This is the
# deterministic cleanup that guarantees real, chunky pixels on a consistent grid even if the
# model's output is a high-res "fake pixel" render. A seamless tile stays seamless (area
# resampling preserves wrap continuity; per-pixel quantization can't introduce a seam).
# Output is the SMALL native tile — display it upscaled with image-rendering: pixelated.
#
#   python pixelate-surface.py --input raw.png --out tile.png [--size 128] [--colors 24] [--dither fs|none]
import argparse
from PIL import Image

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--size', type=int, default=128, help='native tile size in px (refined pixel ~128, chunkier ~64)')
    ap.add_argument('--colors', type=int, default=24, help='palette size (~16-32 reads as 16-bit)')
    ap.add_argument('--dither', choices=['none', 'fs'], default='fs')
    a = ap.parse_args()
    im = Image.open(a.input).convert('RGB')
    small = im.resize((a.size, a.size), Image.LANCZOS)
    d = Image.Dither.FLOYDSTEINBERG if a.dither == 'fs' else Image.Dither.NONE
    q = small.quantize(colors=a.colors, method=Image.MEDIANCUT, dither=d).convert('RGB')
    q.save(a.out)
    print(f'{a.out}  {a.size}px  {a.colors}c  dither={a.dither}')

main()
