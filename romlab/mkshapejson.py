"""Build the fixture for the one-shape-per-run captures.

Each run drives every routine with a single argument shape and its own draw
sequence, so each is its own stream: the port has to replay them one at a time,
resetting the generator between, or the inputs stop matching after the first.
"""
import json
import pathlib

HERE = pathlib.Path(__file__).parent
OUT = HERE.parent / "frontend" / "src" / "rom" / "fuzz-shapes.json"


def main():
    streams = []
    for f in sorted((HERE / "out" / "fuzz").glob("f-*.log")):
        shape = int(f.stem.split("-")[1])
        cases = []
        for line in f.read_text().splitlines():
            p = line.split()
            if not p or p[0] != "R":
                continue
            body = line[1:].strip().split("|")
            if len(body) < 3:
                continue
            head = body[0].split()
            cases.append({
                "entry": int(head[0], 16),
                "out": [int(x, 16) for x in body[1].split()],
                "hash": body[2].strip(),
            })
        streams.append({"shape": shape, "cases": cases})
    OUT.write_text(json.dumps({"streams": streams}))
    print("shape streams: %d   cases: %d -> %s"
          % (len(streams), sum(len(s["cases"]) for s in streams), OUT))


if __name__ == "__main__":
    main()
