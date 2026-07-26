"""Turn each ripped song log into a clean, loop-aware VGM.

Each log is one song played from silence with the sample chip muted, so the
only cleanup needed is: trim trailing silence, find where the tune repeats,
and record that as the VGM loop point so it can loop seamlessly as an asset.
"""
import json
import pathlib
import struct

HERE = pathlib.Path(__file__).parent
RIP = HERE / "out" / "song" / "rip"
OUT = HERE / "out" / "music_final"
OUT.mkdir(parents=True, exist_ok=True)

YM2413_CLOCK = 3579545
RATE = 44100
END_GAP = 2.0     # silence longer than this means the tune finished
MATCH = 250       # writes that must match to call it a loop


def parse(path):
    ents = []
    for line in path.read_text().splitlines():
        p = line.split()
        if len(p) == 3:
            ents.append((float(p[0]), int(p[1]), int(p[2], 16)))
    pairs, pend = [], None
    for t, port, val in ents:
        if port == 0:
            pend = (t, val)
        elif port == 2 and pend is not None:
            pairs.append((pend[0], pend[1], val))
            pend = None
    return pairs


def trim(pairs):
    for i in range(1, len(pairs)):
        if pairs[i][0] - pairs[i - 1][0] > END_GAP:
            return pairs[:i]
    return pairs


SETUP = 400   # one-time instrument/volume programming at the start


def find_loop(pairs):
    """Return (loop_start, period) where the tune repeats, or None.

    The head can't be matched directly: a song begins with one-time instrument
    setup that never replays. So skip that, then look for the period p where
    the write stream repeats itself.
    """
    seq = [(r, v) for _, r, v in pairs]
    n = len(seq)
    if n < SETUP + MATCH * 3:
        return None
    start = SETUP
    probe = seq[start : start + MATCH]
    for p in range(MATCH, (n - start) // 2):
        if seq[start + p : start + p + MATCH] == probe:
            return (start, p)
    return None


def build_vgm(seg, loop_index=None):
    t0 = seg[0][0]
    body = bytearray()
    cur = 0
    loop_offset = None
    for i, (t, reg, val) in enumerate(seg):
        if loop_index is not None and i == loop_index:
            loop_offset = len(body)
        want = int((t - t0) * RATE)
        d = want - cur
        while d > 0:
            n = min(d, 65535)
            body += bytes([0x61]) + struct.pack("<H", n)
            d -= n
            cur += n
        body += bytes([0x51, reg & 0xFF, val & 0xFF])
    body += bytes([0x66])

    DATA = 0x40
    h = bytearray(DATA)
    h[0:4] = b"Vgm "
    struct.pack_into("<I", h, 0x04, DATA + len(body) - 4)
    struct.pack_into("<I", h, 0x08, 0x00000151)
    struct.pack_into("<I", h, 0x10, YM2413_CLOCK)
    struct.pack_into("<I", h, 0x18, cur)
    struct.pack_into("<I", h, 0x24, 60)
    struct.pack_into("<I", h, 0x34, DATA - 0x34)
    if loop_offset is not None:
        struct.pack_into("<I", h, 0x1C, DATA + loop_offset - 0x1C)  # loop offset
        struct.pack_into("<I", h, 0x20, cur)                        # loop samples
    return bytes(h) + bytes(body), cur


songs = []
for path in sorted(RIP.glob("song-*.log")):
    sid = int(path.stem.split("-")[1])
    pairs = parse(path)
    if len(pairs) < 200:
        print(f"id {sid:3d}: only {len(pairs)} writes - skipped (not a tune)")
        continue
    kept = trim(pairs)
    found = find_loop(kept)
    if found:
        loop_start, period = found
        # Keep the intro plus exactly one full cycle; the VGM loop point makes
        # it repeat forever without a seam.
        seg = kept[: loop_start + period]
        loop_index = loop_start
    else:
        loop_start = period = None
        seg = kept
        loop_index = None
    vgm, samples = build_vgm(seg, loop_index)
    name = f"song-{sid:03d}"
    (OUT / f"{name}.vgm").write_bytes(vgm)
    dur = samples / RATE
    songs.append({"id": sid, "file": f"{name}.vgm", "seconds": round(dur, 1),
                  "writes": len(seg), "loops": found is not None})
    loopinfo = f"loops after {loop_start} writes, period {period}" if found else "no loop found"
    print(f"id {sid:3d}: {len(kept):6d} writes -> {dur:5.1f}s, {loopinfo}")

(OUT / "songs.json").write_text(json.dumps({
    "source": "Rampart arcade, YM2413 FM music",
    "method": "sound id injected into the game's own sound queue (0x3E3D46); only YM2413 writes logged, sample chip muted - no sound effects present",
    "ym2413_clock": YM2413_CLOCK,
    "songs": songs,
}, indent=1))
print(f"\n{len(songs)} songs -> {OUT}")
