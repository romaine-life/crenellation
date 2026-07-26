"""Turn recorded calls into the argument list the replay harness drives.

callcap.lua records the full register file at every routine entry the game
actually makes, a7 included. The replay harness sets up its own stack, so it
takes a0-a6 and the words that were on the stack, not the stack pointer.

Fuzzing a routine with random values mostly proves it does not crash: a routine
that expects a valid pointer wanders off and never returns, which is why so
many were never exercised. These are the arguments the game really passed.
"""
import collections
import pathlib

HERE = pathlib.Path(__file__).parent
LOG = HERE / "out" / "calls" / "c.log"
OUT = HERE / "out" / "calls" / "replay.txt"
PER_ROUTINE = 4


def main():
    kept = collections.Counter()
    lines = []
    for raw in LOG.read_text().splitlines():
        p = raw.split()
        if not p or p[0] != "C" or len(p) < 26:
            continue
        entry = p[1]
        if kept[entry] >= PER_ROUTINE:
            continue
        kept[entry] += 1
        d = p[2:10]                 # d0-d7
        a = p[10:17]                # a0-a6; a7 at p[17] is the harness's own
        stk = p[18:27]              # what was on the stack at entry
        lines.append(" ".join([entry] + d + a + stk))
    OUT.write_text("\n".join(lines) + "\n")
    print("replay cases: %d across %d routines -> %s"
          % (len(lines), len(kept), OUT))


if __name__ == "__main__":
    main()
