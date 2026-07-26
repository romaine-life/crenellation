"""Port of the piece walker at 0x8B4, checked cell for cell against the ROM.

A piece is a script, not a bitmap: two bytes of offset from the cursor, then a
run of direction indices, terminated by any byte with the high bit set. 0x0B is
an escape meaning "take an extra step first", which is how the diagonal shapes
are expressed.

At each cell the routine checks the cell is on the board and either unowned or
already the player's, and that the terrain is clear (type 0) or exactly 0x30.
Failing any of those it returns 0 without stamping the rest. Otherwise it
writes owner|1 and returns 2 if it ever landed on a cell the player already
owned, 1 if not.
"""
import pathlib
import re

FWD = [32, -1, -32, 1, 33, 31, -31, -33]     # 0xFCCA
DX = [1, 0, -1, 0, 1, 1, -1, -1]             # 0xFCDA
DY = [0, -1, 0, 1, 1, -1, 1, -1]             # 0xFCE2
BOARD_W, BOARD_H, STRIDE = 42, 30, 32
TABLE = 0xFE4E


def s8(v):
    return v - 256 if v > 127 else v


def place(rom: bytes, board: bytearray, script: int, x: int, y: int, owner: int = 0x40):
    """Returns the routine's result: 0 invalid, 1 placed, 2 placed over own wall."""
    wall = owner | 1
    x = (x + s8(rom[script])) & 0xFF
    y = (y + s8(rom[script + 1])) & 0xFF
    p = script + 2
    ptr = x * STRIDE + y
    result = 1
    while True:
        cell = board[ptr] if 0 <= ptr < len(board) else 0
        if s8(x) < 0 or s8(y) < 0 or x >= 0x2A or y >= 0x1E:
            return 0
        if (cell & 0xC0) != owner and (cell & 0xC0) != 0:
            return 0
        if (cell & 0x3F) != 0 and cell != 0x30:
            return 0
        if (board[ptr] & 0xC0) == owner:
            result = 2
        d = rom[p]
        p += 1
        board[ptr] = wall
        if d & 0x80:
            return result
        if d == 0x0B:
            e = rom[p]
            p += 1
            ptr += FWD[e & 7]
            x = (x + DX[e & 7]) & 0xFF
            y = (y + DY[e & 7]) & 0xFF
            d = rom[p]
            p += 1
        ptr += FWD[d & 7]
        x = (x + DX[d & 7]) & 0xFF
        y = (y + DY[d & 7]) & 0xFF


if __name__ == "__main__":
    HERE = pathlib.Path(__file__).parent
    rom = (HERE / "prog_upper.bin").read_bytes()
    OUT = HERE / "out" / "verify10"
    ok = bad = 0
    for line in (OUT / "v.log").read_text().splitlines():
        m = re.match(r"^R ([0-9A-F]{2}) ([0-9A-F]+) (\d+) (\d+) (\S+)$", line)
        if not m:
            continue
        pid, script, x, y, res = int(m[1], 16), int(m[2], 16), int(m[3]), int(m[4]), m[5]
        want = (OUT / f"p{pid:02X}.bin").read_bytes()
        board = bytearray(len(want))
        got = place(rom, board, script, x, y)
        same = bytes(board) == want
        rv = int(res, 16) & 0xFF if res != "NORETURN" else None
        if same and got == rv:
            ok += 1
        else:
            bad += 1
            diff = sum(1 for a, b in zip(board, want) if a != b)
            print(f"  piece {pid:02X}: board {diff} cells differ, return rom {rv} port {got}")
    print(f"\npieces compared: {ok + bad}")
    print(f"identical board and return value: {ok}/{ok + bad}")
    print("\nVERIFIED" if bad == 0 else "\nNOT VERIFIED")
