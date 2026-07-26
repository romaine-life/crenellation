"""Track motion objects across frames and measure ship behaviour.

The display list is rebuilt every frame, so a slot index does not follow one
object. Match instead by sprite code plus nearest position — that reconstructs
real tracks, from which speed and firing cadence can be read.
"""
import pathlib
import statistics
import struct
from collections import Counter, defaultdict

HERE = pathlib.Path(__file__).parent
data = (HERE / "out" / "traj" / "mob.bin").read_bytes()
SZ, ENTRY = 2048, 8
N = SZ // ENTRY
FRAMES = len(data) // SZ


def objects(f: int):
    out = []
    for e in range(N):
        o = f * SZ + e * ENTRY
        w0, w1, w2, w3 = struct.unpack_from("<4H", data, o)
        x = (w2 & 0xFF80) >> 7
        y = (w3 & 0xFF80) >> 7
        code = w1 & 0x7FFF
        if 0 < x < 400 and 0 < y < 300 and code:
            out.append({"x": x, "y": y, "code": code})
    return out


# Greedy nearest-neighbour tracking, same code only, max 6px per frame.
tracks = []          # each: {"pts": [(f,x,y)], "code": c, "last": f}
MAXD = 6
for f in range(FRAMES):
    objs = objects(f)
    open_tracks = [t for t in tracks if t["last"] == f - 1]
    used = set()
    for t in open_tracks:
        best = None
        bx, by = t["pts"][-1][1], t["pts"][-1][2]
        for i, o in enumerate(objs):
            if i in used or o["code"] != t["code"]:
                continue
            d = ((o["x"] - bx) ** 2 + (o["y"] - by) ** 2) ** 0.5
            if d <= MAXD and (best is None or d < best[0]):
                best = (d, i)
        if best:
            used.add(best[1])
            o = objs[best[1]]
            t["pts"].append((f, o["x"], o["y"]))
            t["last"] = f
    for i, o in enumerate(objs):
        if i in used:
            continue
        tracks.append({"pts": [(f, o["x"], o["y"])], "code": o["code"], "last": f})

long_tracks = [t for t in tracks if len(t["pts"]) >= 45]
print(f"tracks: {len(tracks)}, sustained (>=45 frames): {len(long_tracks)}")


def stats(t):
    pts = t["pts"]
    steps = []
    for i in range(1, len(pts)):
        dx = pts[i][1] - pts[i - 1][1]
        dy = pts[i][2] - pts[i - 1][2]
        steps.append((dx * dx + dy * dy) ** 0.5)
    moving = [s for s in steps if s > 0]
    return {
        "n": len(pts),
        "code": t["code"],
        "speed": statistics.median(moving) if moving else 0.0,
        "moving_frac": len(moving) / max(1, len(steps)),
        "span_x": max(p[1] for p in pts) - min(p[1] for p in pts),
        "span_y": max(p[2] for p in pts) - min(p[2] for p in pts),
    }


rows = [stats(t) for t in long_tracks]
ships = [r for r in rows if 0.1 < r["speed"] <= 2.0 and r["moving_frac"] > 0.5 and r["span_x"] + r["span_y"] > 20]
print(f"\nship-like tracks: {len(ships)}")
for r in sorted(ships, key=lambda r: -r["n"])[:10]:
    print(
        f"  code {r['code']:5d}: {r['n']:4d} frames, {r['speed']:.2f} px/frame, "
        f"travel {r['span_x']}x{r['span_y']}, moving {r['moving_frac']:.0%}"
    )

if ships:
    med = statistics.median([r["speed"] for r in ships])
    print(f"\nSHIP SPEED: {med:.2f} px/frame = {med * 60:.0f} px/sec = {med * 60 / 16:.2f} cells/sec")

# Projectiles: short tracks that move fast and then stop existing.
shots = [stats(t) for t in tracks if 6 <= len(t["pts"]) <= 40]
fast = [r for r in shots if r["speed"] >= 1.5]
print(f"\nprojectile-like tracks: {len(fast)} over {FRAMES / 60:.0f}s")
if fast:
    print(f"  median speed {statistics.median([r['speed'] for r in fast]):.2f} px/frame")
    print(f"  median lifetime {statistics.median([r['n'] for r in fast]):.0f} frames")
    print(f"  spawn rate {len(fast) / (FRAMES / 60):.2f} per second")
