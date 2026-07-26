"""Reproduce the hardware's rendered screen: playfield + motion objects.

The playfield is bitmap RAM through the palette. Motion objects (sprites) are a
display list of 4-word entries indexing 8x8 4bpp tiles in the :gfx ROM. If the
composition rules are right, playfield + sprites reproduces the screen the
emulator actually drew, pixel for pixel.
"""
import pathlib
import struct

M = pathlib.Path(__file__).parent / "out" / "mob"


def e6(x):
    return ((x << 2) | (x >> 4)) & 0xFF


def palette(buf):
    out = []
    for v in range(len(buf) // 2):
        (w,) = struct.unpack_from("<H", buf, v * 2)
        i = (w >> 15) & 1
        out.append((e6(((w >> 9) & 0x3E) | i), e6(((w >> 4) & 0x3E) | i),
                    e6(((w << 1) & 0x3E) | i)))
    return out


def entries(mob):
    out = []
    for i in range(len(mob) // 8):
        w0, w1, w2, w3 = struct.unpack_from(">4H", mob, i * 8)
        if (w0, w1, w2, w3) == (0, 0, 0, 0):
            continue
        h = (w3 & 7) + 1
        out.append(dict(i=i, link=w0 & 0xFF, code=w1 & 0x7FFF, hflip=bool(w1 & 0x8000),
                        color=w2 & 0x000F, x=(w2 & 0xFF80) >> 7,
                        y=(-((w3 & 0xFF80) >> 7) - h * 8) & 0x1FF,
                        w=((w3 >> 4) & 7) + 1, h=h))
    return out


def render(tag, gfx, hi_first=True, ymajor=True, base=0x100, order=1):
    bmp = (M / f"bmp-{tag}.bin").read_bytes()
    pal = palette((M / f"pal-{tag}.bin").read_bytes())
    mob = (M / f"mob-{tag}.bin").read_bytes()
    idx = bytearray(336 * 240)
    for y in range(240):
        row = y * 512 + 4
        idx[y * 336:(y + 1) * 336] = bmp[row:row + 336]
    nt = len(gfx) // 32
    ents = entries(mob)
    if order < 0:
        ents = ents[::-1]
    for e in ents:
        for tx in range(e["w"]):
            for ty in range(e["h"]):
                c = e["code"] + (tx * e["h"] + ty if ymajor else ty * e["w"] + tx)
                t = (c % nt) * 32
                for py in range(8):
                    Y = e["y"] + ty * 8 + py
                    if not (0 <= Y < 240):
                        continue
                    for px in range(8):
                        sx = (7 - px) if e["hflip"] else px
                        b = gfx[t + py * 4 + (sx >> 1)]
                        p = (b >> 4) if ((sx & 1) == 0) == hi_first else (b & 0x0F)
                        if p == 0:
                            continue
                        X = e["x"] + tx * 8 + px
                        if 0 <= X < 336:
                            idx[Y * 336 + X] = 0  # marker replaced below
                            idx[Y * 336 + X] = min(255, 0)  # placeholder
                            # store full index separately
                            full[Y * 336 + X] = base + e["color"] * 16 + p
    return idx, pal


if __name__ == "__main__":
    gfx = (M / "gfx.bin").read_bytes()
    print("configurations tested against the hardware's own frame:")
    for tag in ["3200"]:
        bmp = (M / f"bmp-{tag}.bin").read_bytes()
        pal = palette((M / f"pal-{tag}.bin").read_bytes())
        mob = (M / f"mob-{tag}.bin").read_bytes()
        scr = (M / f"scr-{tag}.bin").read_bytes()
        ents = entries(mob)
        nt = len(gfx) // 32
        best = None
        for hi_first in (True, False):
            for ymajor in (True, False):
                for base in (0x100, 0x000, 0x200):
                    for order in (1, -1):
                        full = [None] * (336 * 240)
                        seq = ents if order > 0 else ents[::-1]
                        for e in seq:
                            for tx in range(e["w"]):
                                for ty in range(e["h"]):
                                    c = e["code"] + (tx * e["h"] + ty if ymajor else ty * e["w"] + tx)
                                    t = (c % nt) * 32
                                    for py in range(8):
                                        Y = e["y"] + ty * 8 + py
                                        if not (0 <= Y < 240):
                                            continue
                                        for px in range(8):
                                            sx = (7 - px) if e["hflip"] else px
                                            b = gfx[t + py * 4 + (sx >> 1)]
                                            p = (b >> 4) if ((sx & 1) == 0) == hi_first else (b & 0x0F)
                                            if p == 0:
                                                continue
                                            X = e["x"] + tx * 8 + px
                                            if 0 <= X < 336:
                                                full[Y * 336 + X] = base + e["color"] * 16 + p
                        good = 0
                        for y in range(240):
                            for x in range(336):
                                o = (y * 336 + x)
                                v = full[o]
                                col = pal[v] if v is not None and v < len(pal) else pal[bmp[y * 512 + x + 4]]
                                q = o * 4
                                if col == (scr[q + 2], scr[q + 1], scr[q]):
                                    good += 1
                        if best is None or good > best[0]:
                            best = (good, hi_first, ymajor, base, order)
                        print(f"  hi={int(hi_first)} ymaj={int(ymajor)} base={base:#05x} "
                              f"order={order:+d}: {good}/80640 ({100*good/80640:.2f}%)")
        print(f"\nbest: {best[1:]} -> {best[0]}/80640 ({100*best[0]/80640:.2f}%)")
