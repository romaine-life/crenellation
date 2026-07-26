"""Find data (non-code) regions in the program ROM and render them as bitmaps.

68000 code has a characteristic byte profile; packed graphics/tables don't.
Score each block, merge the data-looking runs, and draw the biggest ones at
several widths so recognizable shapes can be spotted by eye.
"""
import math
import pathlib

from PIL import Image

HERE = pathlib.Path(__file__).parent
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
data = (HERE / "prog_main.bin").read_bytes()
BLOCK = 4096


def entropy(b: bytes) -> float:
    counts = [0] * 256
    for x in b:
        counts[x] += 1
    n = len(b)
    return -sum((c / n) * math.log2(c / n) for c in counts if c)


# 68000 opcodes cluster hard in a few high-nibble families (4=misc/jsr/lea,
# 6=branches, 2/3=move.l/move.w). Data blocks spread far more evenly.
def code_score(b: bytes) -> float:
    hi = [0] * 16
    for x in b[::2]:
        hi[x >> 4] += 1
    n = max(1, sum(hi))
    return (hi[0x4] + hi[0x6] + hi[0x2] + hi[0x3] + hi[0x0]) / n


blocks = []
for off in range(0, len(data), BLOCK):
    chunk = data[off : off + BLOCK]
    blocks.append((off, entropy(chunk), code_score(chunk)))

# A block is "data" when the opcode families don't dominate.
data_blocks = [(o, e, c) for o, e, c in blocks if c < 0.55]
print(f"program image {len(data)} bytes, {len(blocks)} blocks of {BLOCK}")
print(f"data-looking blocks: {len(data_blocks)}  ({len(data_blocks) * BLOCK // 1024} KB)")

runs = []
for off, e, c in data_blocks:
    if runs and runs[-1][1] == off:
        runs[-1][1] = off + BLOCK
        runs[-1][2].append(e)
    else:
        runs.append([off, off + BLOCK, [e]])

runs.sort(key=lambda r: r[1] - r[0], reverse=True)
print("\nlargest contiguous data regions:")
for start, end, ents in runs[:12]:
    print(f"  {start:#08x}-{end:#08x}  {(end - start) // 1024:>4d} KB  mean entropy {sum(ents) / len(ents):.2f}")

# Render the biggest regions as 4bpp images at plausible playfield widths.
palette = []
for i in range(16):
    v = i * 17
    palette += [v, v, v]
palette += [0, 0, 0] * (256 - 16)

for idx, (start, end, _) in enumerate(runs[:4]):
    blob = data[start:end]
    for width in (256, 320, 512):
        rows = len(blob) * 2 // width
        if rows < 32:
            continue
        img = Image.new("P", (width, rows))
        img.putpalette(palette)
        px = img.load()
        for i in range(rows * width // 2):
            byte = blob[i]
            x = (i * 2) % width
            y = (i * 2) // width
            px[x, y] = byte >> 4
            px[x + 1, y] = byte & 0xF
        name = OUT / f"data{idx}-{start:06x}-w{width}.png"
        img.crop((0, 0, width, min(rows, 400))).save(name)
        print(f"  rendered {name.name} ({width}x{min(rows, 400)})")
