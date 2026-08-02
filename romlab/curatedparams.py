"""Hand-read parameter names, re-applied after the source is regenerated.

The mechanical levers are exhausted - `whyunread.py`, `whyrole.py`,
`whypassed.py` and `rolecandidates.py` between them say so, and the passes
that name from roles and from the call graph are at a joint fixed point. What
is left is reading, and a name that comes from reading has to survive
`decomp.py` overwriting the file, exactly as a routine name does.

This is `names.curated.json` for parameters. The file is `params.curated.json`:

    {
      "0x005b4": {
        "d0": {"name": "port", "why": "0 picks 0x640002, 1 picks 0x640000, ..."},
        "d1": {"name": "wanted", "why": "the byte at 0xf(a7) masks which bits ..."}
      }
    }

The key is the routine's address in the DECOMPILED table and the inner key is
the REGISTER the parameter arrives in, not its current name - a name changes
when a pass renames it and the register does not, so keying on the register is
the only form that stays valid across a regeneration.

A STACK ARGUMENT THE ROUTINE ONLY TAKES THE ADDRESS OF IS NOT IN THE TABLE,
and the guard below is how that gets found. `decomp.py` records a stack slot as
a parameter when it READS a value out of it; 0x8fc8 does `lea $8(a6),a2` and
walks from there, so its first argument - which the disassembly shows plainly -
appears nowhere in `params`, and the entry for it is rejected rather than
silently dropped. That is a gap in parameter recovery rather than a mistake in
the reading, and it will bite again on anything that treats an argument as a
buffer.

A REGISTER THE ROUTINE LOADS A CONSTANT INTO IS NOT NAMEABLE HERE EITHER, and
that is roles.py's rule rather than a new one: `lea $460000,a2` inside 0x1b1d2
means a2 holds the sound chip for most of the routine and something else on
entry, so calling the PARAMETER `chip` is right by the end and wrong at the
start - the exact defect that took namedParams from 2852 to 2314 when it was
found. The register is still worth a name in the body; the parameter is not.

`why` is not optional, for the reason `idents.py` refuses a curated routine
name without one: a wrong name costs more than `d3` does, and the only defence
is being able to read afterwards why it was chosen. An entry whose routine or
register cannot be found is an ERROR, like a hand edit that no longer applies -
it means the map moved and the reading has to be redone against what the
lifter now produces.

Runs inside `namepasses.py`, first, so a hand-read name is a seed for
`paramnames.py` and `callernames.py` in the same round rather than the round
after. Idempotent: a parameter that already carries its curated name is left
alone, so a second run reports zero.

    python3 curatedparams.py [--dry]
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
DEST = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"
CURATED = HERE / "params.curated.json"

FUNC = re.compile(r"^export function (\w+)\(([^)]*)\): void \{$", re.M)
ENTRY = re.compile(
    r"\{ at: (0x[0-9a-f]+), fn: (\w+) as [^,]+, params: \[(.*?)\] \}")
SOURCE = re.compile(
    r"\{ from: 'reg', name: '(\w+)' \}|\{ from: 'stack', off: (-?\d+) \}")
IDENT = re.compile(r"^[A-Za-z_]\w*$")


def split_functions(text):
    out = []
    for m in FUNC.finditer(text):
        start = m.start()
        end = text.find("\n}\n", start)
        end = len(text) if end < 0 else end + 3
        out.append((m.group(1), m.group(2), text[start:end], (start, end)))
    return out


def main():
    dry = "--dry" in sys.argv
    if not CURATED.exists():
        print("no params.curated.json yet")
        return
    curated = json.loads(CURATED.read_text(encoding="utf-8"))

    text = DEST.read_text(encoding="utf-8")
    funcs = split_functions(text)
    by_name = {n: (sig, body, span) for n, sig, body, span in funcs}

    # address -> {register or stack offset -> current parameter name}
    slot = {}
    fn_at = {}
    for m in ENTRY.finditer(text):
        addr, fn = int(m.group(1), 16), m.group(2)
        if fn not in by_name:
            continue
        fn_at[addr] = fn
        sig = [p.strip().split(":")[0].strip()
               for p in by_name[fn][0].split(",") if p.strip()]
        sources = SOURCE.findall(m.group(3))
        if len(sources) != len(sig):
            continue
        for i, (reg, off) in enumerate(sources):
            slot.setdefault(addr, {})[reg or f"stack{off}"] = sig[i]

    want, moved = {}, 0
    for key, entries in curated.items():
        addr = int(key, 16)
        if addr not in fn_at:
            raise SystemExit(
                f"params.curated.json: no decompiled routine at {key}."
                " The map moved; redo the reading against what the lifter"
                " produces now.")
        here = slot.get(addr) or {}
        for reg, spec in entries.items():
            if reg not in here:
                raise SystemExit(
                    f"params.curated.json: {key} takes no parameter in {reg}."
                    f" It has {sorted(here)}. Either the lifter dropped it"
                    " (dropunread.py moves an unread register into the body)"
                    " or the reading was wrong.")
            if not isinstance(spec, dict) or not spec.get("why"):
                raise SystemExit(
                    f"params.curated.json: {key}/{reg} has no `why`."
                    " A wrong name costs more than the register does.")
            name = spec.get("name")
            if not name or not IDENT.match(name):
                raise SystemExit(
                    f"params.curated.json: {key}/{reg} has no usable name.")
            cur = here[reg].rstrip("_")
            if cur == name:
                continue                       # already applied
            want.setdefault(fn_at[addr], {})[cur] = name

    pieces = []
    for name, sig, body, (start, end) in funcs:
        renames = want.get(name)
        if not renames:
            continue
        words = set(re.findall(r"[A-Za-z_]\w*", body))
        new = body
        for local, got in sorted(renames.items()):
            cand, k = got, 2
            while cand in words and cand != local:
                cand = f"{got}{k}"
                k += 1
            words.add(cand)
            new = re.sub(r"(?<!')\b" + re.escape(local) + r"(_?)\b(?!')",
                         lambda m: cand + m.group(1), new)
            moved += 1
        pieces.append((start, end, new))

    out, cur = [], 0
    for start, end, new in pieces:
        out.append(text[cur:start])
        out.append(new)
        cur = end
    out.append(text[cur:])
    if not dry:
        DEST.write_text("".join(out), encoding="utf-8")
    print(f"parameters named from params.curated.json: {moved}")


if __name__ == "__main__":
    main()
