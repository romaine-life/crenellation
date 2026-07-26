"""Port of the second decompressor (terrain painter) at 0x124BE.

Read from the disassembly at 0x124E2. Differences from the first decoder:
  * literal mode copies 8-bit bytes straight through, no nibble expansion
  * after a literal or run mode, d2 (the palette base for later nibble runs)
    is reloaded from the high nibble of the last byte read
  * control byte with bit7 CLEAR is TEXTURE mode: pattern (c & 0x0F) selects a
    128-byte block in the table at 0x3A390, a rotating offset held in RAM at
    0x3E0E76 picks the start, and (c >> 4) + 1 bytes are copied. The low byte
    of that offset then advances by 13 and wraps to 6 bits.
  * row advance is +0x1F8 after every 8 pixels, same as the first decoder
"""
import pathlib

HERE = pathlib.Path(__file__).parent
ROM = (HERE / "prog_main.bin").read_bytes()

TEXTURE_TABLE = 0x3A390
STRIDE = 512
DEST_LEN = 8192


def decode(src: int, rot: int, dest_len: int = DEST_LEN):
    """Returns (buffer, rot_after). rot is the 16-bit word at 0x3E0E76."""
    buf = bytearray(dest_len)
    pos = 0
    left = 8            # d4 starts at 7, meaning 8 pixels before the row jump
    d2 = 0              # palette base, reloaded from the data
    p = src

    def put(value: int):
        nonlocal pos, left
        if 0 <= pos < dest_len:
            buf[pos] = value & 0xFF
        pos += 1
        left -= 1
        if left == 0:
            pos += STRIDE - 8
            left = 8

    while True:
        if p >= len(ROM):
            return buf, rot
        c = ROM[p]
        p += 1

        if not (c & 0x80):
            # texture fill
            count = (c >> 4) + 1
            pattern = (c & 0x0F) << 7
            offset = (pattern + rot) & 0xFFFF
            # the low byte advances by 13, wrapping at 6 bits; the high byte
            # is untouched, exactly as the routine does it
            lo = ((rot & 0xFF) + 13) & 0x3F
            rot = (rot & 0xFF00) | lo
            for i in range(count):
                a = TEXTURE_TABLE + offset + i
                put(ROM[a] if a < len(ROM) else 0)
            continue

        count = (c & 0x1F) + 1
        if c & 0x40:
            if c & 0x20:
                if c == 0xFF:
                    return buf, rot
                if p + 1 >= len(ROM):
                    return buf, rot
                a, b = ROM[p], ROM[p + 1]
                p += 2
                for _ in range(count):
                    put(a)
                    put(b)
            else:
                if p >= len(ROM):
                    return buf, rot
                b = ROM[p]
                p += 1
                d2 = b & 0xF0
                for _ in range(count):
                    put(b)
        else:
            if c & 0x20:
                remaining = count
                while remaining > 0:
                    if p >= len(ROM):
                        return buf, rot
                    b = ROM[p]
                    p += 1
                    put((b >> 4) + d2)
                    remaining -= 1
                    if remaining == 0:
                        break
                    put((b & 0x0F) + d2)
                    remaining -= 1
            else:
                # literal bytes, copied straight through
                for _ in range(count):
                    if p >= len(ROM):
                        return buf, rot
                    b = ROM[p]
                    p += 1
                    put(b)
                d2 = ROM[p - 1] & 0xF0
    return buf, rot
