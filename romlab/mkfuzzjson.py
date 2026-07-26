"""Turn the routine capture log into the fixture the differential test reads.

The log is one line per case: `R <entry> <trial> <inputs> | <outputs> | <hash>`
for a routine that returned, and `N <entry> <trial>` for one that did not. The
inputs are not stored in the fixture - both sides regenerate them from the same
xorshift32 sequence - so only the entry, the trial, the outputs and the hash of
the compared window are kept.
"""
import json
import pathlib

HERE = pathlib.Path(__file__).parent
LOG = HERE / "out" / "fuzz" / "f.log"
OUT = HERE.parent / "frontend" / "src" / "rom" / "fuzz.json"


def main():
    cases = []
    noreturn = {}
    for line in LOG.read_text().splitlines():
        p = line.split()
        if not p:
            continue
        if p[0] == "N" and len(p) >= 3:
            noreturn.setdefault(str(int(p[1], 16)), []).append(int(p[2]))
            continue
        if p[0] != "R":
            continue
        body = line[1:].strip().split("|")
        if len(body) < 3:
            continue
        head = body[0].split()
        entry = int(head[0], 16)
        trial = int(head[1])
        vals = [int(x, 16) for x in head[2:]]
        out = [int(x, 16) for x in body[1].split()]
        cases.append({
            "entry": entry, "trial": trial,
            "din": vals[:8], "ain": vals[8:14],
            "out": out, "hash": body[2].strip(),
        })
    OUT.write_text(json.dumps({"cases": cases, "noreturn": noreturn}))
    print("cases: %d   no-return: %d   -> %s"
          % (len(cases), sum(len(v) for v in noreturn.values()), OUT))


if __name__ == "__main__":
    main()
