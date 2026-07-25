#!/usr/bin/env python3
"""Bake the animated water-top ripple sheets (water-<n>-top-anim.png).

Input: PixelLab v3 animation frames generated at the NATIVE 96x180 tile frame
(custom_start_frame = the variant's static `water-<n>-top.png`), downloaded to
a run directory (see docs/art/pixellab-runs/) laid out as `v<n>/<i>.png`.

The generated frames are CANDIDATES, not authority (docs/pixellab-api-notes.md):
this script owns acceptance of the geometry.

Per variant:
  1. hard-abort unless every frame is exactly 96x180;
  2. LOCK each frame to the static top's alpha channel — the alpha (silhouette,
     socket edge) is copied verbatim from the static art, generated RGB is used
     only where the static top is opaque, and any pixel the model erased falls
     back to the static RGB. Nothing can move outside the diamond and the
     tile's footprint is bit-identical across frames (no wobble);
  3. assemble the kept frames left-to-right into one horizontal sheet at
     frontend/public/assets/tiles/surface/water-<n>-top-anim.png.

Frame selection: PixelLab v3 stores 9 frames — index 0 is the input reference
(the static top itself) and 1..8 are generated. We keep 0..7 so the loop's
wrap lands back on the real static art (frame 8 is usually ~= frame 0 anyway).

Usage:
  python scripts/build-water-anim.py <runDir> [--variants 0,1,...] [--frames 8]

The frame count baked here must match WATER_TOP_ANIM_FRAMES in src/art/tileset.ts.
"""

import argparse
import sys
from pathlib import Path

from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
SURFACE_DIR = SCRIPT_DIR.parent / "public" / "assets" / "tiles" / "surface"
FRAME_W, FRAME_H = 96, 180


def lock_frame(frame: Image.Image, static: Image.Image) -> tuple[Image.Image, int]:
    """Clamp a generated frame to the static top's exact silhouette.

    Returns the locked frame and the count of opaque pixels whose RGB changed
    (the "motion" measure used for the sanity report).
    """
    frame_px = frame.load()
    static_px = static.load()
    out = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    out_px = out.load()
    changed = 0
    for y in range(FRAME_H):
        for x in range(FRAME_W):
            sr, sg, sb, sa = static_px[x, y]
            if sa == 0:
                continue  # outside the authored silhouette: stays empty
            fr, fg, fb, fa = frame_px[x, y]
            if fa == 0:
                out_px[x, y] = (sr, sg, sb, sa)  # model erased it: keep static art
            else:
                out_px[x, y] = (fr, fg, fb, sa)  # generated colour, authored alpha
                if (fr, fg, fb) != (sr, sg, sb):
                    changed += 1
    return out, changed


def bake_variant(run_dir: Path, n: int, frames: int) -> None:
    static_path = SURFACE_DIR / f"water-{n}-top.png"
    static = Image.open(static_path).convert("RGBA")
    if static.size != (FRAME_W, FRAME_H):
        sys.exit(f"{static_path}: static top is {static.size}, expected {(FRAME_W, FRAME_H)}")
    opaque = sum(1 for _, _, _, a in static.getdata() if a > 0)

    sheet = Image.new("RGBA", (FRAME_W * frames, FRAME_H), (0, 0, 0, 0))
    report = []
    for i in range(frames):
        frame_path = run_dir / f"v{n}" / f"{i}.png"
        frame = Image.open(frame_path).convert("RGBA")
        if frame.size != (FRAME_W, FRAME_H):
            sys.exit(f"{frame_path}: frame is {frame.size}, expected {(FRAME_W, FRAME_H)} — refusing to rescale pixel art")
        locked, changed = lock_frame(frame, static)
        sheet.paste(locked, (FRAME_W * i, 0))
        report.append(f"{changed * 100 // max(opaque, 1)}%")

    out_path = SURFACE_DIR / f"water-{n}-top-anim.png"
    sheet.save(out_path, optimize=True)
    print(f"water-{n}: {out_path.name} ({sheet.size[0]}x{sheet.size[1]}), moved-vs-static per frame: {' '.join(report)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run_dir", type=Path, help="downloaded PixelLab frames, laid out v<n>/<i>.png")
    parser.add_argument("--variants", default="0,1,2,3,4,5,6,7")
    parser.add_argument("--frames", type=int, default=8)
    args = parser.parse_args()
    for n in (int(v) for v in args.variants.split(",")):
        bake_variant(args.run_dir, n, args.frames)


if __name__ == "__main__":
    main()
