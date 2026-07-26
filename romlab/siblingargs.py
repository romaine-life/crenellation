"""Give a never-called routine the arguments its table siblings are called with.

134 of the routines that were never exercised have no direct caller anywhere in
the ROM: they are reached only through tables of function pointers. Fuzzing
them with generated values does not work - they expect a particular shape of
argument and wander off - and the game never happened to select them during the
capture, so there are no real arguments either.

But a pointer table is a set of handlers for one dispatcher, and a dispatcher
calls every one of its handlers the same way. So a handler that was never
selected can be driven with the arguments a handler that *was* selected
received. That is a real calling convention, taken from the program, not a
guess: if the borrowed arguments are wrong for it, the routine fails to return
on the hardware side and the case is dropped, exactly as any other case is.
"""
import collections
import json
import pathlib

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
LIMIT = 0x20000
REPLAY = HERE / "out" / "calls" / "replay.txt"
MIN_RUN = 3          # a table needs at least this many pointers to count
PER_ROUTINE = 2      # borrowed cases per routine


def pointer_tables(starts):
    """Runs of consecutive 32-bit words that all name a function."""
    tables = []
    a = 0
    while a + 4 <= LIMIT:
        run = []
        b = a
        while b + 4 <= LIMIT:
            v = int.from_bytes(UP[b:b + 4], "big")
            if v in starts:
                run.append(v)
                b += 4
            else:
                break
        if len(run) >= MIN_RUN:
            tables.append((a, run))
            a = b
        else:
            a += 2
    return tables


def main():
    facts = json.loads((HERE / "out" / "facts.json").read_text())
    starts = {a for a, _ in facts["funcs"]}
    tables = pointer_tables(starts)

    have = collections.defaultdict(list)
    for line in REPLAY.read_text().splitlines():
        p = line.split()
        if len(p) >= 22:
            have[int(p[0], 16)].append(line)

    added = []
    covered = set()
    for base, members in tables:
        donors = [m for m in members if m in have]
        if not donors:
            continue
        for m in members:
            if m in have or m in covered:
                continue
            for donor in donors[:PER_ROUTINE]:
                src = have[donor][0].split()
                added.append(" ".join(["%X" % m] + src[1:]))
            covered.add(m)

    print("pointer tables: %d   routines given borrowed arguments: %d   cases: %d"
          % (len(tables), len(covered), len(added)))
    if added:
        with REPLAY.open("a") as f:
            f.write("\n".join(added) + "\n")


if __name__ == "__main__":
    main()
