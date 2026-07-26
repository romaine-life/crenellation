"""Compare the ported RNG against the original at 0x11E58.

    random(n):
      d0 = seed (word)
      d0 = muls.w(d0, 0x3619)        signed 16x16 -> 32
      d0 = d0 + 0x5D35               WORD add: only the low half changes
      seed = low word of d0
      d0 = muls.w(d0, n)             low words, signed -> 32
      d1 = (n << 16) >> 1            swap, clear low word, asr.l #1
      d0 = d0 + d1
      return sign_extend16(high word of d0)
"""
import pathlib
import re


def s16(v):
    v &= 0xFFFF
    return v - 0x10000 if v & 0x8000 else v


def s32(v):
    v &= 0xFFFFFFFF
    return v - 0x100000000 if v & 0x80000000 else v


def random(seed: int, n: int):
    d0 = s16(seed) * 0x3619                 # muls.w
    # addi.w touches only the low word, leaving the upper half alone
    low = (d0 + 0x5D35) & 0xFFFF
    d0 = (d0 & 0xFFFF0000) | low
    new_seed = low
    d0 = s16(low) * s16(n)                  # muls.w d1,d0
    d1 = s32(((n & 0xFFFF) << 16)) >> 1     # swap, clr.w, asr.l #1
    total = (d0 + d1) & 0xFFFFFFFF
    ret = s16((total >> 16) & 0xFFFF)       # swap + ext.l
    return ret & 0xFFFFFFFF, new_seed


rows = []
for line in (pathlib.Path(__file__).parent / "out" / "verify6" / "v.log").read_text().splitlines():
    m = re.match(r"R seed=([0-9A-F]+) n=(\d+) ret=([0-9A-F]+) newseed=([0-9A-F]+)", line)
    if m:
        rows.append((int(m.group(1), 16), int(m.group(2)), int(m.group(3), 16), int(m.group(4), 16)))

print(f"cases: {len(rows)}")
bad = 0
for seed, n, ret, newseed in rows:
    my_ret, my_seed = random(seed, n)
    if my_ret != ret or my_seed != newseed:
        if bad < 6:
            print(f"  MISMATCH seed={seed:04X} n={n}: got ret={my_ret:08X} seed={my_seed:04X}, want ret={ret:08X} seed={newseed:04X}")
        bad += 1

print(f"matched: {len(rows) - bad}/{len(rows)}")
print()
print("VERIFIED" if bad == 0 and rows else "NOT VERIFIED")
