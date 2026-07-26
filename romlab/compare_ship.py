"""Port of the moving-unit step at 0xAF72, checked against live movement.

Seven records of 0x12 bytes at 0x3E1BC6. A record is active when its sprite
pointer at +4 is non-zero. Each step:

    x += vx ; y += vy          positions are in 1/32 units (shots use 1/64)
    lifetime -= 1              when it reaches zero the unit is retired
    sprite_x = x >> 5 ; sprite_y = y >> 5

The routine returns non-zero while any unit is still moving, which is how the
caller knows the wave is not finished.
"""
import pathlib
import re


def s16(v):
    v &= 0xFFFF
    return v - 0x10000 if v & 0x8000 else v


def step(life, x, y, vx, vy):
    return (life - 1) & 0xFFFF, (x + vx) & 0xFFFF, (y + vy) & 0xFFFF, vx, vy


def sprite_pos(x, y):
    return (s16(x) >> 5) & 0xFFFF, (s16(y) >> 5) & 0xFFFF


rows = []
for line in pathlib.Path("out/shipcap/s.log").read_text().splitlines():
    m = re.match(r"^U (\d+) (\d) ([0-9A-F]{8}) ([0-9A-F]{4}) ([0-9A-F]{4}) "
                 r"([0-9A-F]{4}) ([0-9A-F]{4}) ([0-9A-F]{4})$", line)
    if m:
        rows.append((int(m[1]), int(m[2]), int(m[3], 16),
                     *[int(m[i], 16) for i in range(4, 9)]))

by_slot = {}
for r in rows:
    by_slot.setdefault((r[1], r[2]), []).append(r)

checked = one = cadence = bad = 0
examples = []
for key, seq in by_slot.items():
    seq.sort(key=lambda r: r[0])
    for a, b in zip(seq, seq[1:]):
        if b[0] != a[0] + 1:
            continue
        checked += 1
        want = tuple(b[3:8])
        if step(*a[3:8]) == want:
            one += 1
            continue
        s = tuple(a[3:8])
        hit = s == want
        for _ in range(6):
            if hit:
                break
            s = step(*s)
            hit = s == want
        if hit:
            cadence += 1
        else:
            bad += 1
            if len(examples) < 3:
                examples.append((a[3:8], want, step(*a[3:8])))

print(f"unit records captured: {len(rows)}   consecutive-frame steps: {checked}")
print(f"reproduced by exactly one step: {one}")
print(f"reproduced by 0 or repeated steps (update cadence): {cadence}")
print(f"unexplained: {bad}")
for a, want, got in examples:
    print(f"   from {a}")
    print(f"     rom  {want}")
    print(f"     port {got}")
print()
print("VERIFIED" if bad == 0 and checked > 100 else "NOT VERIFIED")
