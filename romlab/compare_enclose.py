"""Port of the enclosure test at 0xBC2, checked against the ROM routine.

Rampart does not flood fill to decide whether a castle is sealed. It follows
the wall like a maze runner - keep a wall on one side, turn left when the side
cell is wall, go straight when the cell ahead is wall, otherwise turn right -
and counts turns. Returning to the starting cell having accumulated four
quarter-turns means the boundary closed; the sign of the count says which way
round it went, and only one of the two is an enclosure.

A cell counts as wall if it equals owner|1 or owner|3, so a decorated cell
(a cannon, say) still forms part of the boundary.
"""
import pathlib
import re

FWD = [32, -1, -32, 1, 33, 31, -31, -33]        # 0xFCCA, pointer delta per direction
TURN = [1, 32, -1, -32, 0, -3778, 0, -2512]     # 0xFCEA, the same directions rotated 90
LIMIT = 200000                                  # a boundary that never closes


def enclosed(board: bytes, start: int, direction: int, owner: int = 0x40):
    """0xBC2. start is an index into the board array, direction selects the
    initial pair of deltas. Returns 1 (enclosed), 0, or None when the trace
    never comes back to its starting cell - which the ROM routine expresses by
    looping forever, so the port has to reproduce that too."""
    wall, variant = owner | 1, owner | 3
    d1 = direction & 0xFFFF
    fwd = FWD[d1 & 7]                           # both tables are indexed by the
    side = TURN[d1 & 7]                         # raw direction on entry
    cur, count = start, 0

    def at(i):
        return board[i] if 0 <= i < len(board) else 0

    for _ in range(LIMIT):
        if at(cur + side) in (wall, variant):
            d1 = (d1 - 1) & 3                   # wall to the side: turn toward it
            fwd, side = side, TURN[d1]
            count -= 1
            cur += fwd                          # a left turn also steps
        elif at(cur + fwd) in (wall, variant):
            cur += fwd                          # wall ahead: carry straight on
        else:
            d1 = (d1 + 1) & 3                   # nothing to follow: turn away
            side, fwd = fwd, FWD[d1]
            count += 1                          # and stay put
        if cur == start and count in (-4, 4):
            return 1 if count < 0 else 0
    return None


if __name__ == "__main__":
    OUT = pathlib.Path(__file__).parent / "out" / "verify9"
    ok = bad = 0
    fails = []
    for line in (OUT / "v.log").read_text().splitlines():
        m = re.match(r"^R (\S+) (\d+) (\d+) (\d+) (\S+)$", line)
        if not m:
            continue
        name, x, y, d, res = m[1], int(m[2]), int(m[3]), int(m[4]), m[5]
        board = (OUT / f"{name}-in.bin").read_bytes()
        mine = enclosed(board, x * 32 + y, d)
        want = None if res == "NORETURN" else int(res, 16) & 0xFF
        got = "NORETURN" if mine is None else f"{mine}"
        exp = "NORETURN" if want is None else f"{want}"
        if mine == want:
            ok += 1
        else:
            bad += 1
            fails.append((name, exp, got))
        print(f"  {name:10s} start ({x:2d},{y:2d}) dir {d}: rom {exp:8s} port {got:8s}"
              f" {'ok' if mine == want else 'MISMATCH'}")
    print(f"\n{ok} match, {bad} differ")
    print("VERIFIED" if bad == 0 else "NOT VERIFIED")
