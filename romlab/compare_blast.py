"""Port of the damage-script selector at 0x8598, checked against the ROM.

Blast patterns are a **list of sub-lists**. A player's script pointer comes from
the level descriptor at 0x3E0DCA, offset 0x22 + player[3]*4. From there the
routine skips forward past player[0x1D] sub-lists - each a run of packed (x, y)
words ending on a byte with the high bit set - parks the cursor at player+0x3E
and queues the verified handler 0x8606.

A player whose word0 lacks bit 0x8000 is skipped, as is one whose descriptor
slot is null, and neither posts an event.
"""
import pathlib
import re

SCRIPT = [0x0A0A, 0x0B0B, 0xFFFF, 0x0C0C, 0x0D0D, 0x0E0E, 0xFFFF, 0x0F0F, 0xFFFF]
MEM = bytearray()
for w in SCRIPT:
    MEM += bytes([w >> 8, w & 0xFF])

CASES = [
    ("p0_sel3_skip0", [0x8000, 0, 0], [3, 0, 0], [0, 0, 0]),
    ("p0_sel3_skip1", [0x8000, 0, 0], [3, 0, 0], [1, 0, 0]),
    ("p0_sel3_skip2", [0x8000, 0, 0], [3, 0, 0], [2, 0, 0]),
    ("p1_only",       [0, 0x8000, 0], [0, 3, 0], [0, 1, 0]),
    ("p2_only",       [0, 0, 0x8000], [0, 0, 3], [0, 0, 2]),
    ("none",          [0, 0, 0],      [3, 3, 3], [0, 0, 0]),
    ("all_three",     [0x8000] * 3,   [3, 3, 3], [0, 1, 2]),
    ("null_ptr",      [0x8000, 0, 0], [1, 0, 0], [0, 0, 0]),
]
# descriptor: only slot 3 holds a script; slot 1 is null, others unset
SLOTS = {3: 0}


def select(flags, sel, skip):
    """Returns (cursor offset or None per player, number of events posted)."""
    cursors, posted = [], 0
    for i in range(3):
        if not (flags[i] & 0x8000):
            cursors.append(None)
            continue
        if sel[i] not in SLOTS:
            cursors.append(None)
            continue
        a0 = SLOTS[sel[i]]
        d0 = skip[i]
        while d0 > 0:
            a0 += 2
            while a0 < len(MEM) and MEM[a0] < 0x80:
                a0 += 2
            a0 += 2
            d0 -= 1
        cursors.append(a0)
        posted += 1
    return cursors, posted


log = {}
for f in sorted(pathlib.Path("out/verify25").glob("*.log")):
    for line in f.read_text().splitlines():
        m = re.match(r"^S (\S+) ([0-9A-F]{4}) (.+)$", line)
        if m:
            log[m[1]] = (int(m[2], 16), m[3].split())

ok = bad = 0
for name, flags, sel, skip in CASES:
    rom_count, rom_cur = log[name]
    cur, posted = select(flags, sel, skip)
    mine = [("-" if c is None else str(c)) for c in cur]
    # the queue count is -1 when empty and otherwise the last index used
    mine_count = 0xFFFF if posted == 0 else posted - 1
    if mine == rom_cur and mine_count == rom_count:
        ok += 1
    else:
        bad += 1
        print(f"  {name}: rom count {rom_count:04X} cursors {rom_cur}")
        print(f"          port count {mine_count:04X} cursors {mine}")

print(f"\n{ok} match, {bad} differ")
print("VERIFIED" if bad == 0 else "NOT VERIFIED")
