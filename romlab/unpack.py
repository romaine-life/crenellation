"""Reimplementation of Rampart's graphics decompressor (routine at 0x11F2A).

Control byte c, read from the stream:
  bit7 clear -> count=(c>>4)+1 copies of pixel (c & 0x0F)
  bit7 set, count=(c & 0x1F)+1, and:
      bit6 clear, bit5 clear -> skip `count` pixels
      bit6 clear, bit5 set   -> `count` source bytes, each two 4-bit pixels
      bit6 set,  bit5 clear  -> one source byte repeated `count` times
      bit6 set,  bit5 set    -> 0xFF ends the strip; else two bytes alternating
Each strip is 8 pixels wide: after every 8 pixels the destination jumps a full
row (stride 512), so a strip runs top-to-bottom and the caller moves right by 8.
"""
import pathlib

STRIDE = 512
STRIP_W = 8


def decode_strip(data: bytes, pos: int, max_px: int = 8192):
    """Decode one strip. Returns (pixels, next_pos) where pixels is a flat list
    of 4-bit values in write order (column-major within the 8-wide strip)."""
    out = []
    while True:
        if pos >= len(data) or len(out) > max_px:
            return out, pos, False
        c = data[pos]
        pos += 1
        if not (c & 0x80):
            count = (c >> 4) + 1
            val = c & 0x0F
            out.extend([val] * count)
            continue
        count = (c & 0x1F) + 1
        if c & 0x40:
            if c & 0x20:
                if c == 0xFF:
                    return out, pos, True
                if pos + 1 >= len(data):
                    return out, pos, False
                a, b = data[pos], data[pos + 1]
                pos += 2
                for i in range(count):
                    out.append(a)
                    out.append(b)
            else:
                if pos >= len(data):
                    return out, pos, False
                b = data[pos]
                pos += 1
                out.extend([b] * count)
        else:
            if c & 0x20:
                # Nibble mode: the count is PIXELS, not source bytes. In the
                # original the `dbra d1` at 0x11F68 sits between the high and
                # low nibble writes, so a run can end after a high nibble
                # without its low half ever being emitted. Emitting both
                # unconditionally overruns by up to one pixel per run.
                remaining = count
                while remaining > 0:
                    if pos >= len(data):
                        return out, pos, False
                    b = data[pos]
                    pos += 1
                    out.append(b >> 4)
                    remaining -= 1
                    if remaining == 0:
                        break
                    out.append(b & 0x0F)
                    remaining -= 1
            else:
                out.extend([None] * count)
    return out, pos, False


def decode_object(data: bytes, start: int, max_strips: int = 64):
    """Decode consecutive strips laid left-to-right into a pixel grid."""
    pos = start
    strips = []
    for _ in range(max_strips):
        px, pos, ok = decode_strip(data, pos)
        if not ok or not px:
            break
        strips.append(px)
    if not strips:
        return None
    height = max(len(s) for s in strips)
    grid = [[None] * (len(strips) * STRIP_W) for _ in range(height)]
    for si, s in enumerate(strips):
        for i, v in enumerate(s):
            col = si * STRIP_W + (i % STRIP_W)
            row = i // STRIP_W
            if row < height:
                grid[row][col] = v
    return grid


if __name__ == "__main__":
    rom = pathlib.Path(__file__).parent / "prog_main.bin"
    data = rom.read_bytes()
    for addr in (0xD2608, 0xD726F, 0xD48EA, 0xDC60F, 0x5B4E0):
        g = decode_object(data, addr, max_strips=48)
        if not g:
            print(f"{addr:#08x}: nothing")
            continue
        filled = sum(1 for r in g for v in r if v is not None)
        print(f"{addr:#08x}: {len(g[0])}x{len(g)} px, {filled} written")
