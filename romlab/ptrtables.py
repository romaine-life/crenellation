"""Find the handler entry points held in tables of 32-bit function pointers.

A dispatcher that indexes a table of addresses reaches code the call graph
never names: nothing does `jsr <handler>`, so the handler is not an entry
point, and several handlers end up merged into whichever function happens to
start before them. The pointers themselves are the evidence - a run of longs
that all land inside known code is a table, and each value is an entry.

Targets are not required to be function starts. The one table checked by hand
(0xFCF6, walked by the routine at 0x14DC) points at 0xF630 and 0xF79E, both of
which sit in the middle of one 0x32C-byte "function" that is really several
handlers.
"""
import json
import pathlib

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
LIMIT = 0x20000
LO = 0x100           # below this is the vector table, not code
MIN_RUN = 3


def main():
    facts = json.loads((HERE / "out" / "facts.json").read_text())
    funcs = sorted({(a, b) for a, b in facts["funcs"]})
    starts = {a for a, _ in funcs}

    def inside(v):
        for a, b in funcs:
            if a <= v < b:
                return True
            if a > v:
                return False
        return False

    def plausible(v):
        return LO <= v < LIMIT and v % 2 == 0 and inside(v)

    targets = set()
    tables = 0
    a = 0
    while a + 4 <= LIMIT:
        run = []
        b = a
        while b + 4 <= LIMIT and plausible(int.from_bytes(UP[b:b + 4], "big")):
            run.append(int.from_bytes(UP[b:b + 4], "big"))
            b += 4
        if len(run) >= MIN_RUN:
            tables += 1
            targets.update(run)
            a = b
        else:
            a += 2

    fresh = sorted(t for t in targets if t not in starts)
    print("pointer tables: %d   distinct targets: %d   not already an entry: %d"
          % (tables, len(targets), len(fresh)))
    json.dump(fresh, open(HERE / "out" / "ptrtargets.json", "w"))


if __name__ == "__main__":
    main()
