"""Port of the phase dispatcher at 0xEE44, checked against the ROM.

This is what "phase control" actually is. There is no state machine switching
on a phase number - there is a queue of periodic timers, and the dispatcher
runs it once per pass:

    for each of (count + 1) records:
        record.countdown -= 1
        if countdown > 0: skip                     not due yet
        if gate is set and record.flag == 0: skip  gated out
        countdown = record.period                  reload
        call record.handler(record.parameter)

The count is a word at 0x3E1CF4 and is -1 when empty, tested signed before the
table is touched at all. A record whose countdown is already zero or negative
still fires, because the test is `> 0` after decrementing, not `== 0`.
"""
import pathlib
import re

CASES = [
    ("empty",      0xFFFF, 0, []),
    ("notdue",     0,      0, [(5, 9, 1)]),
    ("fires",      0,      0, [(1, 9, 1)]),
    ("atzero",     0,      0, [(0, 7, 1)]),
    ("gated_off",  0,      1, [(1, 9, 0)]),
    ("gated_on",   0,      1, [(1, 9, 1)]),
    ("gate0flag0", 0,      0, [(1, 9, 0)]),
    ("three",      2,      0, [(1, 4, 1), (3, 6, 1), (1, 8, 1)]),
    ("mixedgate",  2,      1, [(1, 4, 0), (1, 6, 1), (5, 8, 0)]),
    ("negcount",   0,      0, [(0xFFFE, 3, 1)]),
]


def s16(v):
    v &= 0xFFFF
    return v - 0x10000 if v & 0x8000 else v


def dispatch(count, gate, recs):
    """Returns the records' countdown words after one pass, and which fired."""
    slots = [list(r) for r in recs] + [[0, 0, 0]] * (4 - len(recs))
    fired = []
    if count & 0x8000:
        return [r[0] & 0xFFFF for r in slots], fired
    for i in range(count + 1):
        r = slots[i]
        r[0] = (r[0] - 1) & 0xFFFF
        if s16(r[0]) > 0:
            continue
        if gate != 0 and r[2] == 0:
            continue
        r[0] = r[1]                       # reload from the period byte
        fired.append(i)
    return [r[0] & 0xFFFF for r in slots], fired


log = {}
for line in pathlib.Path("out/verify22/v.log").read_text().splitlines():
    m = re.match(r"^D (\S+) ([0-9A-F]{4}) (.+)$", line)
    if m:
        log[m[1]] = (int(m[2], 16), [int(x, 16) for x in m[3].split()])

ok = bad = 0
for name, count, gate, recs in CASES:
    want_count, want = log[name]
    mine, fired = dispatch(count, gate, recs)
    if mine == want:
        ok += 1
    else:
        bad += 1
        print(f"  {name}: rom {[f'{v:04X}' for v in want]}")
        print(f"        port {[f'{v:04X}' for v in mine]}")

print(f"\n{ok} match, {bad} differ")
print("VERIFIED" if bad == 0 else "NOT VERIFIED")
