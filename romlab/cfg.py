"""Control-flow graphs for every routine, and how hard each is to structure.

Decompiling means turning a program counter and a switch back into `if`, `while`
and `for`. Whether that is possible routine-by-routine, and how much of the
corpus falls out easily, is a property of the control-flow graph - so measure it
before writing an emitter that assumes an answer.

A CFG is *reducible* when every loop has a single entry point. Reducible graphs
structure into ordinary nested control flow with no duplication and no goto.
Irreducible ones - loops entered at two different places, which hand-written
assembly produces and compilers mostly do not - need node splitting or a
dispatch loop, and are the ones that will cost real effort.
"""

import json
from collections import defaultdict
from pathlib import Path

import capstone

HERE = Path(__file__).parent
UP = (HERE / "prog_ext.bin").read_bytes()
FACTS = json.loads((HERE / "out" / "facts.json").read_text())

md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)
md.detail = False

# Instructions that end a basic block, and whether flow can continue past them.
TERMINAL = {"rts", "rte", "rtr", "jmp", "bra", "bral", "stop", "trap", "reset"}
CONDITIONAL = {
    "bhi", "bls", "bcc", "bcs", "bne", "beq", "bvc", "bvs",
    "bpl", "bmi", "bge", "blt", "bgt", "ble",
}
DBCC = {"dbra", "dbf", "dbt", "dbhi", "dbls", "dbcc", "dbcs", "dbne", "dbeq",
        "dbvc", "dbvs", "dbpl", "dbmi", "dbge", "dblt", "dbgt", "dble"}


def base(mnemonic):
    return mnemonic.split(".")[0]


def target_of(ins):
    """The branch target, if the operand is a plain address."""
    op = (ins.op_str or "").strip()
    if op.startswith("$"):
        try:
            return int(op[1:].split(".")[0], 16)
        except ValueError:
            return None
    # dbra has the counter first: `dbra d4, $11f4c`
    if "," in op:
        last = op.rsplit(",", 1)[1].strip()
        if last.startswith("$"):
            try:
                return int(last[1:].split(".")[0], 16)
            except ValueError:
                return None
    return None


def decode(lo, hi):
    """Every instruction in [lo, hi), in address order."""
    out = []
    at = lo
    while at < hi:
        ins = next(md.disasm(UP[at:min(at + 16, hi)], at, 1), None)
        if ins is None:
            at += 2
            continue
        out.append(ins)
        at += ins.size
    return out


def build(lo, hi):
    """Basic blocks and edges for one routine."""
    ins = decode(lo, hi)
    if not ins:
        return None
    by_addr = {i.address: i for i in ins}

    # leaders: the entry, every branch target, and everything after a branch
    leaders = {lo}
    for i in ins:
        b = base(i.mnemonic)
        t = target_of(i)
        if b in CONDITIONAL or b in DBCC or b in ("bra", "bral", "bsr", "jmp", "jsr"):
            if t is not None and lo <= t < hi:
                leaders.add(t)
        if b in TERMINAL or b in CONDITIONAL or b in DBCC:
            nxt = i.address + i.size
            if lo <= nxt < hi:
                leaders.add(nxt)

    starts = sorted(leaders)
    index = {a: n for n, a in enumerate(starts)}
    ends = starts[1:] + [hi]

    edges = defaultdict(set)
    for n, (s, e) in enumerate(zip(starts, ends)):
        # the last real instruction in this block
        last = None
        for a in range(s, e):
            if a in by_addr:
                last = by_addr[a]
        if last is None:
            if n + 1 < len(starts):
                edges[n].add(n + 1)
            continue
        b = base(last.mnemonic)
        t = target_of(last)
        if b in ("rts", "rte", "rtr", "stop"):
            pass                                   # leaves the routine
        elif b in ("bra", "bral", "jmp"):
            if t is not None and t in index:
                edges[n].add(index[t])
        elif b in CONDITIONAL or b in DBCC:
            if t is not None and t in index:
                edges[n].add(index[t])
            if last.address + last.size in index:
                edges[n].add(index[last.address + last.size])
        else:
            if last.address + last.size in index:
                edges[n].add(index[last.address + last.size])
    return {"blocks": starts, "edges": {k: sorted(v) for k, v in edges.items()}, "count": len(ins)}


def reducible(nblocks, edges):
    """Whether every loop has one entry - the test for ordinary nesting.

    Depth-first search classifies each edge. A back edge goes to a node still on
    the search stack; that node dominates its loop and the loop is well behaved.
    An edge into the middle of an already-finished region is a cross edge, and a
    loop reached through one has two ways in.
    """
    colour = [0] * nblocks                          # 0 unseen, 1 on stack, 2 done
    order = []
    back = 0
    stack = [(0, iter(edges.get(0, [])))]
    colour[0] = 1
    while stack:
        node, it = stack[-1]
        advanced = False
        for nxt in it:
            if colour[nxt] == 0:
                colour[nxt] = 1
                stack.append((nxt, iter(edges.get(nxt, []))))
                advanced = True
                break
            if colour[nxt] == 1:
                back += 1
        if not advanced:
            colour[node] = 2
            order.append(node)
            stack.pop()

    # A graph is reducible exactly when removing the back edges leaves a DAG
    # whose every cycle is gone. Collapse test: repeatedly remove nodes with a
    # single predecessor into it (T1/T2 reduction).
    preds = defaultdict(set)
    for a, outs in edges.items():
        for b in outs:
            if b != a:
                preds[b].add(a)
    alive = {n for n in range(nblocks) if colour[n] != 0}
    changed = True
    while changed and len(alive) > 1:
        changed = False
        for n in sorted(alive):
            if n == 0:
                continue
            p = preds[n] & alive
            if len(p) == 1:
                only = next(iter(p))
                for t in edges.get(n, []):
                    if t in alive and t != n:
                        preds[t].discard(n)
                        # Not if that makes it its own predecessor. Collapsing
                        # a loop's body into its header turns the back edge
                        # into a self-edge, and a self-edge is removed by T1,
                        # not counted as a second way in. Without this, every
                        # ordinary loop reads as irreducible - which is what
                        # the 194 "irreducible" routines mostly were.
                        if only != t:
                            preds[t].add(only)
                alive.discard(n)
                changed = True
                break
    return len(alive) == 1, back


def main():
    funcs = FACTS["funcs"]
    rows = []
    for f in funcs:
        lo, hi = (f["at"], f["end"]) if isinstance(f, dict) else (f[0], f[1])
        g = build(lo, hi)
        if not g:
            continue
        n = len(g["blocks"])
        ok, back = reducible(n, {int(k): v for k, v in g["edges"].items()})
        rows.append({"at": lo, "end": hi, "blocks": n, "insns": g["count"],
                     "loops": back, "reducible": ok})

    total = len(rows)
    red = sum(1 for r in rows if r["reducible"])
    straight = sum(1 for r in rows if r["blocks"] == 1)
    loops = sum(1 for r in rows if r["loops"] > 0)
    print(f"routines analysed: {total}")
    print(f"  structurable with ordinary control flow: {red} ({red / total * 100:.1f}%)")
    print(f"  irreducible (a loop with two entries):   {total - red}")
    print(f"  straight-line, no branches at all:       {straight}")
    print(f"  containing at least one loop:            {loops}")
    sizes = sorted(r["insns"] for r in rows)
    print(f"  instructions: median {sizes[len(sizes) // 2]}, "
          f"largest {sizes[-1]}, total {sum(sizes)}")
    bl = sorted(r["blocks"] for r in rows)
    print(f"  basic blocks: median {bl[len(bl) // 2]}, largest {bl[-1]}")
    (HERE / "out" / "cfg.json").write_text(json.dumps(rows))
    print("wrote out/cfg.json")


if __name__ == "__main__":
    main()
