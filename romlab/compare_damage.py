"""Port of the damage step handler at 0x8606, checked against the ROM.

Damage is a **scripted list of coordinates**, not a computed blast radius.
0x8598 selects a script and queues this handler; each call consumes one packed
(x, y) word from the list at player+0x3E.

The rule is the opposite way round from what "damage" suggests: rubble is
stamped only where the cell is **already empty**. A cell that still holds a
wall is left alone on this pass. Rubble (0x30) is the marker the piece walker
accepts for rebuilding, so this is what turns cleared ground back into
buildable ruin.

When the next entry's high byte is negative the list is finished and the
handler removes its own event, taking the queue count with it.
"""
import pathlib
import re

BOARD_LEN = 42 * 32
RUBBLE = 0x30

CASES = {
    "empty":     ([(10, 10), (11, 10), (-1, 0)], [], 0),
    "occupied":  ([(10, 10), (11, 10), (-1, 0)], [(10, 10, 0x41)], 0),
    "second":    ([(10, 10), (11, 10), (-1, 0)], [], 1),
    "onwall":    ([(12, 12), (-1, 0)], [(12, 12, 0x45)], 0),
    "onrubble":  ([(13, 13), (-1, 0)], [(13, 13, 0x30)], 0),
    "terminate": ([(14, 14), (-1, 0)], [], 0),
    "edge":      ([(0, 0), (41, 29), (-1, 0)], [], 0),
    "corner":    ([(41, 29), (-1, 0)], [], 0),
}


def damage_step(board, words, cursor, count):
    """Returns (cursor_bytes, count). Mutates board."""
    coord = words[cursor]
    x, y = (coord >> 8) & 0xFF, coord & 0xFF
    ptr = x * 32 + y
    if 0 <= ptr < len(board) and board[ptr] == 0:
        board[ptr] = RUBBLE
    cursor += 1
    if (words[cursor] >> 8) & 0x80:          # high byte negative: list ends
        count = (count - 1) & 0xFFFF
    return cursor * 2, count


ok = bad = 0
for line in pathlib.Path("out/verify16/v.log").read_text().splitlines():
    m = re.match(r"^R (\S+) ([0-9A-F]{8}) ([0-9A-F]{4})$", line)
    if not m:
        continue
    name, cur, cnt = m[1], int(m[2], 16), int(m[3], 16)
    lst, pre, idx = CASES[name]
    words = [((x & 0xFF) << 8) | (y & 0xFF) for x, y in lst]
    board = bytearray(BOARD_LEN)
    for px, py, v in pre:
        board[px * 32 + py] = v
    mcur, mcnt = damage_step(board, words, idx, 0)
    want = pathlib.Path(f"out/verify16/{name}.bin").read_bytes()
    same = bytes(board) == want
    if same and mcur == cur and mcnt == cnt:
        ok += 1
    else:
        bad += 1
        d = sum(1 for a, b in zip(board, want) if a != b)
        print(f"  {name}: board {d} cells differ, cursor rom {cur} port {mcur}, "
              f"count rom {cnt:04X} port {mcnt:04X}")

print(f"\n{ok} match, {bad} differ")
print("VERIFIED" if bad == 0 else "NOT VERIFIED")
