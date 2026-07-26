"""First-pass ROM characterization: what is each file, and how do the pairs interleave?"""
import math
import pathlib
import re
import struct

ROM = pathlib.Path(__file__).parent / "rom"


def entropy(b: bytes) -> float:
    if not b:
        return 0.0
    counts = [0] * 256
    for x in b:
        counts[x] += 1
    n = len(b)
    return -sum((c / n) * math.log2(c / n) for c in counts if c)


def strings(b: bytes, minlen: int = 6) -> list[str]:
    return [m.decode("ascii") for m in re.findall(rb"[ -~]{%d,}" % minlen, b)]


print("=== files ===")
for f in sorted(ROM.iterdir()):
    b = f.read_bytes()
    if len(b) < 1024:
        continue
    print(f"{f.name:28s} {len(b):>7d}  entropy={entropy(b):.2f}  zeros={b.count(0) * 100 // len(b):>2d}%")

print("\n=== interleave test (68000 code pairs) ===")


def interleave(hi: bytes, lo: bytes) -> bytes:
    out = bytearray(len(hi) * 2)
    out[0::2] = hi
    out[1::2] = lo
    return bytes(out)


def vectors(b: bytes) -> tuple[int, int]:
    sp, pc = struct.unpack(">II", b[:8])
    return sp, pc


pairs = [
    ("136082-1033.13l", "136082-1032.13j"),
    ("136082-1032.13j", "136082-1033.13l"),
    ("136082-2031.13l", "136082-2030.13h"),
    ("136082-2030.13h", "136082-2031.13l"),
]
for hi_name, lo_name in pairs:
    hi = (ROM / hi_name).read_bytes()
    lo = (ROM / lo_name).read_bytes()
    merged = interleave(hi, lo)
    sp, pc = vectors(merged)
    plausible = sp % 2 == 0 and pc % 2 == 0 and pc < len(merged) * 4
    print(f"{hi_name:>18s}(even) + {lo_name:<18s}(odd) -> SP={sp:#010x} PC={pc:#010x} {'PLAUSIBLE' if plausible else ''}")

print("\n=== strings in program ROMs ===")
for name in ("136082-1033.13l", "136082-1032.13j", "136082-2031.13l", "136082-2030.13h"):
    b = (ROM / name).read_bytes()
    s = strings(b, 8)
    print(f"\n--- {name} ({len(s)} strings >=8 chars) ---")
    for line in s[:25]:
        print("   ", line)

print("\n=== interleaved program strings (text split across the pair) ===")
merged = interleave((ROM / "136082-1033.13l").read_bytes(), (ROM / "136082-1032.13j").read_bytes())
(pathlib.Path(__file__).parent / "prog_main.bin").write_bytes(merged)
merged_small = interleave((ROM / "136082-2031.13l").read_bytes(), (ROM / "136082-2030.13h").read_bytes())
(pathlib.Path(__file__).parent / "prog_upper.bin").write_bytes(merged_small)
for label, blob in (("main", merged), ("upper", merged_small)):
    s = strings(blob, 8)
    print(f"\n--- {label} interleaved ({len(s)} strings) ---")
    for line in s[:40]:
        print("   ", line)

print("\n=== gfx ROM structure (128K files) ===")
for name in ("136082-1007.2d", "136082-1008.1d", "136082-1009.2n"):
    b = (ROM / name).read_bytes()
    # Tile-graphics ROMs are usually low-entropy and highly repetitive; audio
    # (OKI ADPCM) is high-entropy with a table of sample pointers up front.
    head = b[:64].hex(" ")
    print(f"\n--- {name} entropy={entropy(b):.2f} ---")
    print("    head:", head)
    print("    strings:", strings(b, 6)[:6])
