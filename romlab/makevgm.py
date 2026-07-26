"""Turn the logged YM2413 register writes into a VGM file.

The log holds (time, port, value); port 0 latches a register number and port 2
writes its data, so writes pair up. VGM stores those pairs as 0x51 aa dd
commands separated by sample-accurate waits at 44100 Hz.
"""
import pathlib
import struct

HERE = pathlib.Path(__file__).parent
LOG = HERE / "out" / "music" / "ym2413.log"
OUT = HERE / "out" / "music"

# rampart clocks the YM2413 at ATARI_CLOCK_14MHz/4 = 14.318181 MHz / 4.
YM2413_CLOCK = 3579545
RATE = 44100

entries = []
for line in LOG.read_text().splitlines():
    parts = line.split()
    if len(parts) != 3:
        continue
    t, port, val = float(parts[0]), int(parts[1]), int(parts[2], 16)
    entries.append((t, port, val))

print(f"log entries: {len(entries)}")

# Pair address-latch with the data write that follows it.
pairs = []
pending = None
for t, port, val in entries:
    if port == 0:
        pending = (t, val)
    elif port == 2 and pending is not None:
        pairs.append((pending[0], pending[1], val))
        pending = None
print(f"register writes: {len(pairs)}")
if not pairs:
    raise SystemExit("no paired writes")

t0 = pairs[0][0]
body = bytearray()
cur_samples = 0
total_samples = 0

for t, reg, val in pairs:
    want = int((t - t0) * RATE)
    delta = want - cur_samples
    while delta > 0:
        n = min(delta, 65535)
        body += bytes([0x61]) + struct.pack("<H", n)
        delta -= n
        cur_samples += n
    body += bytes([0x51, reg & 0xFF, val & 0xFF])
total_samples = cur_samples
body += bytes([0x66])  # end of sound data

DATA_OFFSET = 0x40
header = bytearray(DATA_OFFSET)
header[0x00:0x04] = b"Vgm "
struct.pack_into("<I", header, 0x04, DATA_OFFSET + len(body) - 4)  # EOF offset
struct.pack_into("<I", header, 0x08, 0x00000151)                   # version 1.51
struct.pack_into("<I", header, 0x10, YM2413_CLOCK)                 # YM2413 clock
struct.pack_into("<I", header, 0x18, total_samples)                # total samples
struct.pack_into("<I", header, 0x24, 60)                           # rate hint
struct.pack_into("<I", header, 0x34, DATA_OFFSET - 0x34)           # data offset

vgm = bytes(header) + bytes(body)
path = OUT / "rampart-music.vgm"
path.write_bytes(vgm)
print(f"wrote {path.name}: {len(vgm)} bytes, {total_samples / RATE:.1f}s, {len(pairs)} register writes")

# Split into separate tunes on long silences in the write stream.
GAP = 1.2
tracks = []
start = 0
for i in range(1, len(pairs)):
    if pairs[i][0] - pairs[i - 1][0] > GAP:
        tracks.append((start, i))
        start = i
tracks.append((start, len(pairs)))
tracks = [(a, b) for a, b in tracks if b - a > 50]

# The same theme replays through a session; fingerprint each segment by its
# opening register writes and keep only the first (longest) instance of each.
def fingerprint(seg):
    return tuple((r, v) for _, r, v in seg[:120])


seen = {}
unique = []
for a, b in tracks:
    fp = fingerprint(pairs[a:b])
    if fp in seen:
        i = seen[fp]
        if (b - a) > (unique[i][1] - unique[i][0]):
            unique[i] = (a, b)
        continue
    seen[fp] = len(unique)
    unique.append((a, b))
dupes = len(tracks) - len(unique)
tracks = unique
print(f"\n{len(tracks)} distinct tunes (split on >{GAP}s gaps, {dupes} repeats merged):")
for n, (a, b) in enumerate(tracks, 1):
    seg = pairs[a:b]
    dur = seg[-1][0] - seg[0][0]
    st = seg[0][0]
    body = bytearray()
    cur = 0
    for t, reg, val in seg:
        want = int((t - st) * RATE)
        d = want - cur
        while d > 0:
            k = min(d, 65535)
            body += bytes([0x61]) + struct.pack("<H", k)
            d -= k
            cur += k
        body += bytes([0x51, reg & 0xFF, val & 0xFF])
    body += bytes([0x66])
    h = bytearray(DATA_OFFSET)
    h[0x00:0x04] = b"Vgm "
    struct.pack_into("<I", h, 0x04, DATA_OFFSET + len(body) - 4)
    struct.pack_into("<I", h, 0x08, 0x00000151)
    struct.pack_into("<I", h, 0x10, YM2413_CLOCK)
    struct.pack_into("<I", h, 0x18, cur)
    struct.pack_into("<I", h, 0x24, 60)
    struct.pack_into("<I", h, 0x34, DATA_OFFSET - 0x34)
    p = OUT / f"track{n:02d}.vgm"
    p.write_bytes(bytes(h) + bytes(body))
    print(f"  track{n:02d}.vgm  {dur:6.1f}s  {len(seg):5d} writes")
