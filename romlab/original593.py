"""How many of the original 593 routines are verified.

The goal was set against the map as it stood then: 593 functions, before the
trampolines, the jump-table cases and the pointer-table handlers were found to
be code. Those additions moved the denominator, so the headline figure is not
directly comparable to what was asked for. This computes the original list the
same way describe.py did before any of them existed - code runs and entries
straight out of the classifier, with nothing injected - and reports how many of
those specific routines are verified now.

Where an original function has since been split, it counts as verified only if
every piece it was split into is.
"""
import json
import pathlib

HERE = pathlib.Path(__file__).parent
M = json.loads((HERE / "out" / "codemap2.json").read_text())
VERIFIED = HERE.parent / "frontend" / "src" / "rom" / "verified.json"


def main():
    entries = sorted(set(M["entries"]))
    funcs = []
    for a, b in M["code"]:
        inside = sorted(set([a] + [e for e in entries if a < e < b]))
        for i, e in enumerate(inside):
            funcs.append((e, inside[i + 1] if i + 1 < len(inside) else b))
    widest = {}
    for a, b in funcs:
        if b > widest.get(a, -1):
            widest[a] = b
    funcs = sorted(widest.items())

    v = json.loads(VERIFIED.read_text())
    ok = set(v["verified"])
    now = sorted(set(ok) | set(v["failing"]) | set(v["conflicted"])
                 | set(v["stepStateOnlyMismatch"]) | set(v["neverJudged"]))

    full = 0
    partial = 0
    none = 0
    for a, b in funcs:
        pieces = [x for x in now if a <= x < b] or [a]
        good = [x for x in pieces if x in ok]
        if len(good) == len(pieces):
            full += 1
        elif good:
            partial += 1
        else:
            none += 1

    print("original routines: %d" % len(funcs))
    print("  fully verified (every piece they were split into): %d" % full)
    print("  partly verified: %d" % partial)
    print("  not verified: %d" % none)


if __name__ == "__main__":
    main()
