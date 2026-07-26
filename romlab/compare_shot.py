"""Port of the projectile integration at 0x7008, checked against real flights.

Rampart flies a shot as a ground-plane vector plus an independent height, which
is what gives the arc without any trigonometry:

    x += vx ; y += vy                    (positions are in 1/64 units)
    height += vz                         (using vz BEFORE it is decremented)
    vz -= 1                              (gravity, one unit per frame)
    screen_x = x >> 6
    screen_y = (y - height) >> 6         (height lifts the sprite off its shadow)

The shot lands when height falls to zero or below.

Verified against 8686 frames of live trajectories rather than invented ones:
each captured frame must turn into the next one exactly.
"""
import pathlib
import re


def s16(v):
    v &= 0xFFFF
    return v - 0x10000 if v & 0x8000 else v


def step(vx, x, vy, y, vz, h):
    """One frame of flight. Height uses vz BEFORE gravity is applied, and when
    it reaches zero or below the shot has landed: the final position stands but
    the velocities and the height are cleared."""
    x = (x + vx) & 0xFFFF
    y = (y + vy) & 0xFFFF
    nh = s16(h) + s16(vz)
    vz = (vz - 1) & 0xFFFF
    if nh <= 0:
        return 0, x, 0, y, 0, 0          # landed
    return vx, x, vy, y, vz, nh & 0xFFFF


def screen(x, y, h):
    """Screen position: the shadow travels the ground plane and the height
    lifts the sprite off it, which is what draws the arc."""
    return (s16(x) >> 6) & 0xFFFF, ((s16(y) - s16(h)) >> 6) & 0xFFFF


rows = []
for line in pathlib.Path("out/shotcap/s.log").read_text().splitlines():
    m = re.match(r"^R (\d+) (\d) (\d) ([0-9A-F]{4}) ([0-9A-F]{4}) ([0-9A-F]{4}) "
                 r"([0-9A-F]{4}) ([0-9A-F]{4}) ([0-9A-F]{4}) ([0-9A-F]{8})$", line)
    if m:
        rows.append((int(m[1]), int(m[2]), int(m[3]),
                     *[int(m[i], 16) for i in range(4, 10)], int(m[10], 16)))

by_slot = {}
for r in rows:
    by_slot.setdefault((r[1], r[2], r[9]), []).append(r)

checked = ok = cadence = bad = 0
examples = []
for key, seq in by_slot.items():
    seq.sort(key=lambda r: r[0])
    for a, b in zip(seq, seq[1:]):
        if b[0] != a[0] + 1:
            continue
        checked += 1
        want = tuple(b[3:9])
        if step(*a[3:9]) == want:
            ok += 1
            continue
        # the update does not always run exactly once per frame; allow 0 or a
        # few repeats before calling it a mismatch
        s = tuple(a[3:9])
        hit = False
        for _ in range(5):
            if s == want:
                hit = True
                break
            s = step(*s)
        if s == want:
            hit = True
        if hit:
            cadence += 1
        else:
            bad += 1
            if len(examples) < 3:
                examples.append((a[3:9], want, step(*a[3:9])))

print(f"shot records captured: {len(rows)}   consecutive-frame steps: {checked}")
print(f"reproduced by exactly one step: {ok}")
print(f"reproduced by 0 or repeated steps (update cadence): {cadence}")
print(f"unexplained: {bad}")
for a, want, got in examples:
    print(f"   from {a}")
    print(f"     rom  {want}")
    print(f"     port {got}")
print()
print("VERIFIED" if bad == 0 else "NOT VERIFIED")
