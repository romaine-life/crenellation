"""Turn the replay capture log into the fixture the replay test reads.

Same shape as the fuzz fixture, but the inputs here are the real arguments the
game passed during play rather than random values, so they are stored rather
than regenerated: `R <entry> <n> <8 d> <6 a> <8 stack> | <12 out> | <hash>`.
"""
import json
import pathlib

HERE = pathlib.Path(__file__).parent
LOG = HERE / "out" / "replay" / "f.log"
OUT = HERE.parent / "frontend" / "src" / "rom" / "replay.json"


def main():
    cases = []
    for line in LOG.read_text().splitlines():
        if not line.startswith("R "):
            continue
        body = line[1:].strip().split("|")
        if len(body) < 3:
            continue
        head = body[0].split()
        vals = [int(x, 16) for x in head[2:]]
        if len(vals) < 22:
            continue
        cases.append({
            "entry": int(head[0], 16),
            "din": vals[:8], "ain": vals[8:14], "stk": vals[14:22],
            "out": [int(x, 16) for x in body[1].split()],
            "hash": body[2].strip(),
        })
    OUT.write_text(json.dumps(cases))
    print("replay cases: %d -> %s" % (len(cases), OUT))


if __name__ == "__main__":
    main()
