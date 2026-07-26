"""Decode motion-object RAM and measure ship behaviour.

Entry layout from MAME's rampart mob config (4 words, 8 bytes each):
  word0 link 0x00ff
  word1 code 0x7fff, hflip 0x8000
  word2 color 0x000f, X 0xff80 (>>7)
  word3 Y 0xff80 (>>7), width 0x0070 (>>4), height 0x0007
Words come back byte-reversed from MAME's Lua share reads, same as the palette.
"""
import pathlib
import struct
from collections import Counter, defaultdict

HERE = pathlib.Path(__file__).parent
MOB = HERE / "out" / "traj" / "mob.bin"

SZ = 2048
ENTRY = 8
ENTRIES = SZ // ENTRY

data = MOB.read_bytes()
frames = len(data) // SZ
print(f"frames: {frames}, entries per frame: {ENTRIES}")


def decode(frame: int):
    out = []
    base = frame * SZ
    for e in range(ENTRIES):
        o = base + e * ENTRY
        w0, w1, w2, w3 = struct.unpack_from("<4H", data, o)
        x = (w2 & 0xFF80) >> 7
        y = (w3 & 0xFF80) >> 7
        code = w1 & 0x7FFF
        color = w2 & 0x000F
        wid = ((w3 & 0x0070) >> 4) + 1
        hgt = (w3 & 0x0007) + 1
        out.append({"e": e, "x": x, "y": y, "code": code, "color": color, "w": wid, "h": hgt})
    return out


# Which slots hold something that moves on screen at all?
tracks = defaultdict(list)
for f in range(frames):
    for o in decode(f):
        if 0 < o["x"] < 400 and 0 < o["y"] < 300 and o["code"] != 0:
            tracks[o["e"]].append((f, o["x"], o["y"], o["code"], o["w"], o["h"]))

live = {e: t for e, t in tracks.items() if len(t) > 30}
print(f"slots with sustained on-screen objects: {len(live)}")

# Ships patrol: long-lived, steady motion, mostly along one axis.
print("\nmotion summary per slot (first 14):")
movers = []
for e, t in sorted(live.items())[:60]:
    xs = [p[1] for p in t]
    ys = [p[2] for p in t]
    dx = max(xs) - min(xs)
    dy = max(ys) - min(ys)
    steps = [
        (abs(t[i][1] - t[i - 1][1]), abs(t[i][2] - t[i - 1][2]))
        for i in range(1, len(t))
        if t[i][0] == t[i - 1][0] + 1
    ]
    if not steps:
        continue
    sx = sum(s[0] for s in steps) / len(steps)
    sy = sum(s[1] for s in steps) / len(steps)
    if dx + dy > 12:
        movers.append((e, len(t), dx, dy, sx, sy, Counter(p[3] for p in t).most_common(1)[0]))

movers.sort(key=lambda m: -(m[2] + m[3]))
for e, n, dx, dy, sx, sy, code in movers[:14]:
    print(
        f"  slot {e:3d}: {n:4d} frames, travel {dx:3d}x{dy:3d}px, "
        f"avg step {sx:.2f}/{sy:.2f} px/frame, code {code[0]} x{code[1]}"
    )

if movers:
    # Ships move steadily and slowly; projectiles move fast and briefly.
    slow = [m for m in movers if 0 < max(m[4], m[5]) < 2.0 and m[1] > 200]
    fast = [m for m in movers if max(m[4], m[5]) >= 2.0]
    print(f"\nslow sustained movers (ship-like): {len(slow)}")
    for m in slow[:6]:
        print(f"  slot {m[0]}: {m[4]:.2f}/{m[5]:.2f} px/frame over {m[1]} frames")
    print(f"fast brief movers (projectile-like): {len(fast)}")
    for m in fast[:6]:
        print(f"  slot {m[0]}: {m[4]:.2f}/{m[5]:.2f} px/frame over {m[1]} frames")
