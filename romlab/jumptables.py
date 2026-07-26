"""Enumerate the targets of pc-relative jump tables.

`jmp $BASE(pc, dN.w)` reads a signed 16-bit offset out of a table and jumps to
BASE plus it. The table is data, so the classifier stops the enclosing function
at it and the code on the far side is never given an entry point. At run time
the port then has no case for the address and the call dies.

The table's length is not stored anywhere. It is bounded by its own contents:
the table cannot run past the first instruction it jumps to, so the lowest
target seen so far is the end of the table.
"""
import json
import pathlib
import re

import capstone

HERE = pathlib.Path(__file__).parent
UP = (HERE / "prog_upper.bin").read_bytes()
LIMIT = 0x20000
JMPIDX = re.compile(r"^\$([0-9a-fA-F]+)\((?:pc),\s*d\d\.w\)$")
ABSTGT = re.compile(r"^\$([0-9a-fA-F]+)$")
TERMINATORS = {"rts", "rte", "rtr", "bra", "jmp"}
BRANCHES = {"bra", "beq", "bne", "bcs", "bcc", "bmi", "bpl", "bvs", "bvc",
            "blt", "bge", "ble", "bgt", "bls", "bhi", "bsr",
            "dbra", "dbf", "dbeq", "dbne", "dbcs", "dbcc", "dbmi", "dbpl",
            "dblt", "dbge", "dble", "dbgt", "dbls", "dbhi", "dbt"}


def table_targets(base):
    """Targets reachable from the table at `base`, and where the table ends."""
    targets = []
    end = base + 0x400          # generous upper bound before the contents narrow it
    i = base
    while i < end and i + 2 <= LIMIT:
        off = int.from_bytes(UP[i:i + 2], "big", signed=True)
        t = base + off
        if t < 0 or t >= LIMIT or off == 0:
            break
        # the table stops where the code it points at starts
        end = min(end, t) if t > base else end
        targets.append(t)
        i += 2
    return sorted(set(targets)), i


def main():
    md = capstone.Cs(capstone.CS_ARCH_M68K,
                     capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)
    facts = json.loads((HERE / "out" / "facts.json").read_text())
    funcs = sorted((a, b) for a, b in facts["funcs"])
    starts = {a for a, _ in funcs}

    def covered(addr):
        for a, b in funcs:
            if a <= addr < b:
                return True
        return False

    found = {}
    for a, b in funcs:
        addr = a
        while addr < b:
            ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
            if ins is None:
                addr += 2
                continue
            if ins.mnemonic.startswith("jmp"):
                m = JMPIDX.match(ins.op_str.strip())
                if m:
                    base = int(m.group(1), 16)
                    tg, tend = table_targets(base)
                    if tg:
                        found[base] = (tg, tend, ins.address)
            addr += ins.size

    def extent(start, region_end):
        """Where the code reached from `start` stops.

        A jump-table case runs until it returns or jumps away, but a `bra`
        inside it is not the end - the block it skips over belongs to the same
        case. So a terminator is only accepted once the scan is past every
        branch target seen so far, which is the ordinary way to find the end of
        a chain of basic blocks. Taking the whole enclosing region instead
        shatters the function map.
        """
        addr = start
        furthest = start
        while addr < region_end:
            ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
            if ins is None:
                return addr
            nxt = addr + ins.size
            base_mn = ins.mnemonic.split(".")[0]
            m = ABSTGT.match(ins.op_str.strip())
            if m and base_mn in BRANCHES:
                tgt = int(m.group(1), 16)
                if start <= tgt < region_end:
                    furthest = max(furthest, tgt)
            if base_mn in TERMINATORS and nxt > furthest:
                return nxt
            addr = nxt
        return region_end

    new = set()
    origin = {}                 # target -> (table base, the jmp that uses it)
    for base, (tg, tend, site) in sorted(found.items()):
        # a target inside a function is already reachable: the switch has a
        # case for every instruction address in the extent, so dispatch can
        # enter mid-routine. Only targets outside every function need one.
        outside = [t for t in tg if not covered(t)]
        print("%05x  table at %05x..%05x  %d targets, %d needing an entry"
              % (site, base, tend, len(tg), len(outside)))
        new.update(outside)
        for x in outside:
            origin.setdefault(x, (base, site))
    print("\njump-table targets needing a function entry: %d" % len(new))

    # Bound each one before the next known function, then follow its blocks.
    spans = []
    for tgt in sorted(new):
        region_end = LIMIT
        for a, b in funcs:
            if a > tgt:
                region_end = min(region_end, a)
                break
        # a 68000 instruction is word-aligned, so an odd target means the
        # table walk ran past the end of the table into unrelated bytes
        if tgt % 2:
            continue
        end = extent(tgt, region_end)
        if end > tgt:
            base, site = origin[tgt]
            spans.append([tgt, end, base, site])
    # Addresses the port was actually observed jumping to and finding nothing.
    # Static analysis finds the pc-relative tables; this catches the rest -
    # dispatch through a pointer, and tables the pattern does not match.
    obs = HERE / "out" / "missing-entries.json"
    if obs.exists():
        for tgt in json.loads(obs.read_text()):
            # A jump-table base is data by construction. The port reaching one
            # means it computed an offset of zero and landed on the table
            # itself, which is a routine diverging earlier - not a missing
            # entry point. Injecting it would turn the table into code.
            if tgt % 2 or covered(tgt) or tgt in found:
                continue
            region_end = LIMIT
            for a, b in funcs:
                if a > tgt:
                    region_end = min(region_end, a)
                    break
            end = extent(tgt, region_end)
            if end > tgt:
                spans.append([tgt, end, 0, 0])

    # Merge with what is already known. describe.py feeds these spans back into
    # the function map, so a second run sees them as covered and would find
    # nothing - overwriting the file would then throw away every target from
    # the previous pass. Run until the count stops rising.
    out = HERE / "out" / "jumptargets.json"
    merged = {}
    if out.exists():
        for r in json.loads(out.read_text()):
            if r[2] == 0 and (r[0] in found or r[0] % 2):
                continue        # drop a table base recorded by an earlier pass
            merged[r[0]] = r
    added = 0
    for r in spans:
        if r[0] not in merged:
            merged[r[0]] = r
            added += 1
    spans = [merged[k] for k in sorted(merged)]
    print("spans: %d covering %d bytes (%d new this pass)"
          % (len(spans), sum(r[1] - r[0] for r in spans), added))
    json.dump(spans, open(out, "w"))


if __name__ == "__main__":
    main()
