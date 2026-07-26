"""Decode OKI6295 ADPCM samples to WAV.

The ROM opens with a phrase table: 8 bytes per entry, 24-bit start and end
addresses. Sample data is Dialogic-style 4-bit ADPCM, 2 nibbles per byte.
"""
import pathlib
import struct
import wave

HERE = pathlib.Path(__file__).parent
OUT = HERE / "out" / "sfx"
OUT.mkdir(parents=True, exist_ok=True)

STEP_TABLE = [
    16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97,
    107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449,
    494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552,
]
# OKI's delta index adjustment, indexed by the low 3 bits of the nibble.
INDEX_ADJUST = [-1, -1, -1, -1, 2, 4, 6, 8]


def decode_adpcm(payload: bytes) -> bytes:
    signal = 0
    step = 0
    out = bytearray()
    for byte in payload:
        for nibble in (byte >> 4, byte & 0xF):
            delta = STEP_TABLE[step] >> 3
            if nibble & 1:
                delta += STEP_TABLE[step] >> 2
            if nibble & 2:
                delta += STEP_TABLE[step] >> 1
            if nibble & 4:
                delta += STEP_TABLE[step]
            signal += -delta if nibble & 8 else delta
            signal = max(-2048, min(2047, signal))
            step = max(0, min(48, step + INDEX_ADJUST[nibble & 7]))
            out += struct.pack("<h", signal * 16)
    return bytes(out)


def phrase_table(data: bytes) -> list[tuple[int, int]]:
    entries = []
    for i in range(128):
        e = data[i * 8 : i * 8 + 8]
        if len(e) < 6:
            break
        start = (e[0] << 16) | (e[1] << 8) | e[2]
        end = (e[3] << 16) | (e[4] << 8) | e[5]
        if start == 0 and end == 0:
            entries.append((0, 0))
            continue
        if not (0 < start < end < len(data)):
            break
        entries.append((start, end))
    return entries


SAMPLE_RATE = 7575  # OKI6295 at rampart's 1.023 MHz / 132 divisor

# The OKI addresses one flat 256K region: 1007 at 0x00000, 1008 at 0x20000.
# The phrase table lives only in the first ROM but its pointers span both, so
# the banks must be concatenated before parsing (parsing 1007 alone truncates
# the table at the first cross-bank entry).
for rom_name in ("combined",):
    data = (HERE / "rom" / "136082-1007.2d").read_bytes() + (HERE / "rom" / "136082-1008.1d").read_bytes()
    table = phrase_table(data)
    real = [(i, s, e) for i, (s, e) in enumerate(table) if e > s]
    print(f"\n{rom_name}: {len(real)} phrases in table")
    total = 0
    for i, start, end in real:
        pcm = decode_adpcm(data[start:end])
        secs = len(pcm) / 2 / SAMPLE_RATE
        total += secs
        path = OUT / f"{rom_name.split('.')[0]}-{i:03d}.wav"
        with wave.open(str(path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            w.writeframes(pcm)
    print(f"  wrote {len(real)} wavs, {total:.1f}s total audio")
    if real:
        longest = max(real, key=lambda r: r[2] - r[1])
        print(f"  longest phrase #{longest[0]}: {(longest[2] - longest[1]) / SAMPLE_RATE * 2:.1f}s")
