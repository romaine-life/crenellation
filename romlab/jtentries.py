"""Every target of every pc-relative jump table, as an entry point.

`jmp $BASE(pc, dN.w)` reads a signed 16-bit offset out of a table at BASE and
jumps to BASE plus it. The targets are ordinary code, but nothing points at them
with a branch, so a scan of branch targets never finds them - and a decompiled
function has one entry, so each target needs one of its own.

The table's length is not stored anywhere. It is bounded by its own contents:
the table cannot run past the first instruction it jumps to, so the lowest
target seen so far is the end of the table. An entry that would land outside a
routine, or on something that is not an instruction boundary, is not a case -
it is the table's own bytes being read as an offset.
"""
import bisect
import json
import pathlib
import re

from cfg import decode
from decomp import UP, md

HERE = pathlib.Path(__file__).parent


def main():
    facts = json.loads((HERE / "out" / "facts.json").read_text())
    funcs = sorted((f["at"] if isinstance(f, dict) else f[0],
                    f["end"] if isinstance(f, dict) else f[1]) for f in facts["funcs"])
    los = [a for a, _ in funcs]

    def host(a):
        k = bisect.bisect_right(los, a) - 1
        return funcs[k] if k >= 0 and funcs[k][0] <= a < funcs[k][1] else None

    bounds = {}
    for lo, hi in funcs:
        try:
            for i in decode(lo, hi):
                bounds.setdefault(lo, set()).add(i.address)
        except Exception:                       # noqa: BLE001
            continue

    found = set()
    tables = 0
    for lo, hi in funcs:
        try:
            ins = decode(lo, hi)
        except Exception:                       # noqa: BLE001
            continue
        for i in ins:
            if i.mnemonic.split(".")[0] != "jmp":
                continue
            m = re.fullmatch(r"\$([0-9a-fA-F]+)\(pc,\s*[ad]\d\.w\)", (i.op_str or "").strip())
            if not m:
                continue
            base = int(m.group(1), 16)
            tables += 1
            limit = base + 0x200                # a table longer than this is not one
            k = 0
            while base + k * 2 < limit:
                off = int.from_bytes(UP[base + k * 2:base + k * 2 + 2], "big", signed=True)
                t = base + off
                h = host(t)
                # The table ends where its own bytes start being jumped over,
                # and a target that is not an instruction boundary of the
                # routine it lands in was never a case.
                if off == 0 or h is None or t not in bounds.get(h[0], ()):
                    break
                limit = min(limit, t)
                if t != h[0]:
                    found.add(t)
                k += 1

    p = HERE / "out" / "inner_entries.json"
    cur = set(json.loads(p.read_text())) if p.exists() else set()
    p.write_text(json.dumps(sorted(cur | found)))
    print(f"pc-relative jump tables: {tables}")
    print(f"  case targets inside a routine: {len(found)}, new: {len(found - cur)}")
    print(f"  entry set now: {len(cur | found)}")


if __name__ == "__main__":
    main()
