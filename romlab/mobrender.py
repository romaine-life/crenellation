"""Render the motion-object (sprite) layer the way the hardware does.

Sprites are not simply "every entry in the display list". The hardware walks a
per-scanline-band chain: each 8-line band has a pointer into the list, entries
are linked, and each object is drawn clipped to that band. Entries that are in
the list but not reachable from any band are never drawn - which is why
rendering the whole list produces stale sprites.
"""
import pathlib
import struct

M = pathlib.Path(__file__).parent / "out" / "mob"
W, H = 336, 240
BAND = 8


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


def entry(mob, i):
    w0, w1, w2, w3 = struct.unpack_from(">4H", mob, (i & 0xFF) * 8)
    h = (w3 & 7) + 1
    return dict(link=w0 & 0xFF, code=w1 & 0x7FFF, hflip=bool(w1 & 0x8000),
                color=w2 & 0x000F, x=(w2 & 0xFF80) >> 7,
                y=(-((w3 & 0xFF80) >> 7) - h * 8) & 0x1FF,
                w=((w3 >> 4) & 7) + 1, h=h)


def render(tag, gfx, base=0x100, slipoff=0):
    bmp = (M / f"bmp-{tag}.bin").read_bytes()
    pal = palette((M / f"pal-{tag}.bin").read_bytes())
    mob = (M / f"mob-{tag}.bin").read_bytes()
    slip = (M / f"slip-{tag}.bin").read_bytes()
    nt = len(gfx) // 32

    idx = [0] * (W * H)
    for y in range(H):
        r = y * 512 + 4
        idx[y * W:(y + 1) * W] = list(bmp[r:r + W])

    nbands = len(slip) // 2
    for band in range(nbands):
        y0, y1 = band * BAND, band * BAND + BAND - 1
        if y0 >= H:
            break
        (sv,) = struct.unpack_from(">H", slip, band * 2)
        start = sv & 0xFF
        cur, seen = start, 0
        while seen < 256:
            e = entry(mob, cur)
            for tx in range(e["w"]):
                for ty in range(e["h"]):
                    c = e["code"] + ty * e["w"] + tx
                    t = (c % nt) * 32
                    for py in range(8):
                        Y = e["y"] + ty * 8 + py + slipoff
                        if not (y0 <= Y <= y1) or not (0 <= Y < H):
                            continue
                        for px in range(8):
                            sx = (7 - px) if e["hflip"] else px
                            b = gfx[t + py * 4 + (sx >> 1)]
                            p = (b >> 4) if (sx & 1) == 0 else (b & 0x0F)
                            if p == 0:
                                continue
                            X = e["x"] + tx * 8 + px
                            if 0 <= X < W:
                                idx[Y * W + X] = base + e["color"] * 16 + p
            seen += 1
            cur = e["link"]
            if cur == start:
                break
    return idx, pal


def score(tag, idx, pal):
    scr = (M / f"scr-{tag}.bin").read_bytes()
    good = 0
    for o in range(W * H):
        v = idx[o]
        c = pal[v] if v < len(pal) else (0, 0, 0)
        q = o * 4
        if c == (scr[q + 2], scr[q + 1], scr[q]):
            good += 1
    return good


if __name__ == "__main__":
    gfx = (M / "gfx.bin").read_bytes()
    tags = ["1500", "2000", "2600", "3200", "4000", "5000", "6200", "7400"]
    for slipoff in (0, -8, 8):
        tot = good = 0
        for tag in tags:
            idx, pal = render(tag, gfx, 0x100, slipoff)
            g = score(tag, idx, pal)
            good += g
            tot += W * H
        print(f"slipoff={slipoff:+d}: {good}/{tot} ({100*good/tot:.3f}%)")
