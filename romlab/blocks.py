"""Lift routines that branch, turning the control-flow graph back into if/else.

The single-block pass carries register values forward as expressions, which
works only while there is one path. Once a routine branches, two paths reach
the same instruction with different values, so registers become ordinary local
variables and each block assigns to them. That is what makes a join work.

Branches need conditions, and a 68000 branch tests condition codes rather than
values. The flags almost always come from the instruction immediately before -
`tst`, `cmp`, `cmpi` and the arithmetic account for 93% of them - so the
comparison is reconstructed from that instruction and the branch's sense.

This pass handles routines whose graph has no loops. Loops need the back edge
turned into `while`, and come next.
"""

import json
import re
from pathlib import Path

from cfg import build, decode as cfg_decode, reducible, target_of
from decomp import ADDR, DATA, Bail, Expr, Lifter, SIZE_BITS, decode, num, split_ops

HERE = Path(__file__).parent

COND = {"bhi", "bls", "bcc", "bcs", "bne", "beq", "bvc", "bvs",
        "bpl", "bmi", "bge", "blt", "bgt", "ble"}

# how a branch reads the flags of `lhs - rhs`
COMPARE = {
    "beq": "===", "bne": "!==",
    "blt": "<", "ble": "<=", "bgt": ">", "bge": ">=",
    "bcs": "<", "bls": "<=", "bhi": ">", "bcc": ">=",   # the unsigned pair
}
SIGNED = {"blt", "ble", "bgt", "bge"}


def sx(text, bits):
    """Sign-extend a value of `bits` width to a JavaScript number."""
    if bits == 32:
        return f"({text} | 0)"
    return f"((({text}) << {32 - bits}) >> {32 - bits})"


def uz(text, bits):
    return text if bits == 32 else f"(({text}) & {(1 << bits) - 1})"


class BlockLifter(Lifter):
    """Registers are local variables, so two paths can reach one join."""

    def __init__(self, lo, hi, names):
        super().__init__(lo, hi, names)
        self.flags = None
        self.saved = {}

    def reg_value(self, r, bits):
        if r == "a7":
            raise Bail("bare a7")
        if r not in self.used_regs and self.after_call:
            # First touched after a call, so it holds what the callee left -
            # a return value, most often. Introducing it as a parameter gives
            # it the value this routine's own caller passed, which is how a
            # routine came to read the wrong d0 immediately after the call that
            # produced it.
            self.stmts.append(f"{r} = getReg('{r}');")
        self.used_regs.add(r)
        if bits == 32:
            return Expr(r, "reg")
        return Expr(f"({r} & {(1 << bits) - 1})", "expr")

    def write(self, tok, value, bits):
        tok = tok.strip()
        if tok in DATA or tok in ADDR:
            self.used_regs.add(tok)
            if tok in ADDR and bits == 16:
                # Sign-extended to 32 bits: an address register has no partial
                # writes.
                value = Expr(f"((({value.text}) << 16) >> 16)")
            if bits == 32 or tok in ADDR:
                self.stmts.append(f"{tok} = {value.text};")
            else:
                keep = {8: "0xffffff00", 16: "0xffff0000"}[bits]
                mask = (1 << bits) - 1
                self.stmts.append(f"{tok} = (({tok} & {keep}) | ({value.text} & {mask}));")
            return
        super().write(tok, value, bits)

    def bump(self, r, by):
        self.used_regs.add(r)
        self.stmts.append(f"{r} = ({r} {'+' if by > 0 else '-'} {abs(by)});")

    def flush(self):
        """Put the locals back in the machine before control leaves.

        The callee reads its arguments out of registers and is free to change
        any of them. Locals that never reach the machine are invisible to it,
        and locals never reloaded afterwards still hold what this routine put
        there before the call - which is how a routine came to use a stale d0
        that the callee had long since overwritten.
        """
        for r in sorted(self.used_regs):
            self.stmts.append(f"setReg('{r}', {r});")

    def reload(self):
        for r in sorted(self.used_regs):
            self.stmts.append(f"{r} = getReg('{r}');")

    def step(self, ins):
        b = ins.mnemonic.split(".")[0]
        size = ins.mnemonic.rsplit(".", 1)[1] if "." in ins.mnemonic else "w"
        bits = SIZE_BITS.get(size, 16)
        ops = split_ops(ins.op_str or "")

        if b in COND or b == "bra" and False:
            return                                   # handled by the structurer
        if b in ("cmp", "cmpi", "cmpa"):
            rhs = self.read(ops[0], bits)
            lhs = self.read(ops[1], 32 if b == "cmpa" else bits)
            self.flags = ("cmp", lhs.text, rhs.text, 32 if b == "cmpa" else bits)
            return
        if b == "tst":
            v = self.read(ops[0], bits)
            self.flags = ("cmp", v.text, "0", bits)
            return
        if b == "btst":
            n = self.read(ops[0], 32)
            v = self.read(ops[1], bits)
            self.flags = ("bit", v.text, n.text, bits)
            return
        if b.startswith("db") and b != "divs":
            reg = ops[0].strip()
            if reg not in DATA:
                raise Bail(f"{b} on {reg}")
            self.used_regs.add(reg)
            self.stmts.append(
                f"{reg} = (({reg} & 0xffff0000) | ((({reg} & 0xffff) - 1) & 0xffff));")
            self.flags = ("dbcc", f"({reg} & 0xffff)", "0xffff", 16)
            return
        if b == "movem":
            self.movem(ins, ops, bits)
            return
        if b == "link":
            # A stack frame: push the old frame pointer, point a6 at it, and
            # reserve locals below. The locals have to be real machine stack -
            # routines take their address and hand it to callees.
            self.used_regs.add("a6")
            self.stmts.append("push(a6, 4);")
            self.stmts.append("a6 = stackPointer();")
            n = -num(ops[1])
            self.stmts.append(f"drop({-n});")
            self.pushed += 4 + n
            return
        if b == "unlk":
            self.used_regs.add("a6")
            self.stmts.append("setStackPointer(a6);")
            self.stmts.append("a6 = popLong();")
            self.pushed = 0
            return
        if b in ("jsr", "bsr"):
            super().step(ins)
            for r in sorted(self.used_regs):
                self.stmts.append(f"{r} = getReg('{r}');")
            self.after_call = True
            self.flags = None
            return
        before = len(self.stmts)
        super().step(ins)
        # Anything that writes a data register also sets the flags from what it
        # wrote, which is what a bare `bne` after an `addq` is testing.
        if b in ("move", "moveq", "add", "addq", "addi", "sub", "subq", "subi",
                 "and", "andi", "or", "ori", "eor", "eori", "clr", "asl", "asr",
                 "lsl", "lsr", "neg", "not", "ext") and ops:
            dst = ops[-1].strip()
            if dst in DATA:
                self.flags = ("cmp", self.reg_value(dst, bits).text, "0", bits)
            elif b == "clr":
                self.flags = ("cmp", "0", "0", bits)
        del before

    def regs_of(self, tok):
        """Expand a movem register list like `d2-d4/a2` into names."""
        out = []
        for part in tok.split("/"):
            part = part.strip()
            m = re.fullmatch(r"([ad])(\d)-([ad])(\d)", part)
            if m and m.group(1) == m.group(3):
                for n in range(int(m.group(2)), int(m.group(4)) + 1):
                    out.append(f"{m.group(1)}{n}")
                continue
            if re.fullmatch(r"[ad]\d", part):
                out.append(part)
                continue
            raise Bail(f"movem list {tok!r}")
        return out

    def movem(self, ins, ops, bits):
        """Save or restore a set of registers.

        This is the routine keeping its promise to its caller, not part of what
        the routine computes. Saving pins the value in a constant and restoring
        puts it back, which is exactly the promise, and leaves the body free to
        use the register in between.
        """
        wide = bits // 8
        if ops[1].strip() == "-(a7)":
            regs = self.regs_of(ops[0])
            for r in regs:
                self.used_regs.add(r)
                name = f"save_{r}_{len(self.temps)}"
                self.temps.append(name)
                self.stmts.append(f"const {name} = {r};")
                self.saved.setdefault(r, []).append(name)
            self.pushed += wide * len(regs)
            return
        if ops[0].strip() == "(a7)+":
            regs = self.regs_of(ops[1])
            for r in regs:
                if not self.saved.get(r):
                    raise Bail("restores a register it never saved")
                self.stmts.append(f"{r} = {self.saved[r].pop()};")
            self.pushed -= wide * len(regs)
            return
        raise Bail(f"movem {ins.op_str!r}")

    def condition(self, mnemonic):
        """The branch's test, as an expression."""
        if self.flags is None:
            raise Bail(f"{mnemonic} with no flag-setter before it")
        kind, lhs, rhs, bits = self.flags
        if kind == "bit":
            if mnemonic == "beq":
                return f"((({lhs}) >>> (({rhs}) & 7)) & 1) === 0"
            if mnemonic == "bne":
                return f"((({lhs}) >>> (({rhs}) & 7)) & 1) !== 0"
            raise Bail(f"{mnemonic} after btst")
        if kind == "dbcc":
            return f"{lhs} !== {rhs}"
        if mnemonic not in COMPARE:
            raise Bail(f"branch {mnemonic}")
        op = COMPARE[mnemonic]
        conv = sx if mnemonic in SIGNED else uz
        return f"{conv(lhs, bits)} {op} {conv(rhs, bits)}"


def back_edges(edges, n):
    """Edges returning to a block already on the current path."""
    colour = [0] * n
    found = set()
    stack = [(0, iter(edges.get(0, [])))]
    colour[0] = 1
    while stack:
        v, it = stack[-1]
        moved = False
        for w in it:
            if colour[w] == 1:
                found.add((v, w))
            elif colour[w] == 0:
                colour[w] = 1
                stack.append((w, iter(edges.get(w, []))))
                moved = True
                break
        if not moved:
            colour[v] = 2
            stack.pop()
    return found


def loop_body(edges, latches, header):
    """Blocks that can reach the header again without leaving the loop."""
    body = {header}
    stack = list(latches)
    while stack:
        n = stack.pop()
        if n in body:
            continue
        body.add(n)
        for pred, outs in edges.items():
            if n in outs and pred not in body:
                stack.append(pred)
    return body


def loop_exit(edges, body):
    outs = {m for n in body for m in edges.get(n, []) if m not in body}
    if len(outs) > 1:
        raise Bail("loop with more than one way out")
    return next(iter(outs)) if outs else None



def sccs(edges, n):
    """Strongly connected components, by Tarjan's algorithm, iteratively."""
    index = {}
    low = {}
    on = set()
    stack = []
    out = []
    counter = [0]
    for root in range(n):
        if root in index:
            continue
        work = [(root, iter(edges.get(root, [])))]
        index[root] = low[root] = counter[0]
        counter[0] += 1
        stack.append(root)
        on.add(root)
        while work:
            v, it = work[-1]
            pushed = False
            for w in it:
                if w not in index:
                    index[w] = low[w] = counter[0]
                    counter[0] += 1
                    stack.append(w)
                    on.add(w)
                    work.append((w, iter(edges.get(w, []))))
                    pushed = True
                    break
                if w in on:
                    low[v] = min(low[v], index[w])
            if pushed:
                continue
            work.pop()
            if work:
                low[work[-1][0]] = min(low[work[-1][0]], low[v])
            if low[v] == index[v]:
                comp = []
                while True:
                    w = stack.pop()
                    on.discard(w)
                    comp.append(w)
                    if w == v:
                        break
                out.append(comp)
    return out


def split_nodes(edges, nblocks, limit):
    """Duplicate blocks until every loop has one way in.

    Assembly written by hand jumps into the middle of loops, which no
    combination of `while` and `if` can express - the block genuinely has two
    entries. Giving each entry its own copy of the region is the standard
    remedy: the copies are identical code, and the graph that results nests.
    """
    edges = {k: list(v) for k, v in edges.items()}
    total = nblocks
    clone_of = {}
    for _ in range(24):
        ok, _ = reducible(total, edges)
        if ok:
            return edges, total, clone_of
        target = None
        for comp in sccs(edges, total):
            if len(comp) < 2:
                continue
            inside = set(comp)
            entries = sorted({w for v, outs in edges.items() for w in outs
                              if w in inside and v not in inside})
            if 0 in inside:
                entries = sorted(set(entries) | {0})
            if len(entries) > 1:
                target = (inside, entries)
                break
        if target is None:
            return None, None, None
        inside, entries = target
        keep, extra = entries[0], entries[1:]
        for entry in extra:
            if total + len(inside) > limit:
                return None, None, None
            mapping = {}
            for node in sorted(inside):
                mapping[node] = total
                clone_of[total] = node
                total += 1
            for node in sorted(inside):
                edges[mapping[node]] = [mapping.get(m, m) for m in edges.get(node, [])]
            # every edge from outside that went to `entry` now goes to its copy
            for v, outs in list(edges.items()):
                if v in inside or v in mapping.values():
                    continue
                edges[v] = [mapping[entry] if m == entry else m for m in outs]
            del keep
    return None, None, None


def structure(blocks, edges, lifted, conds, node, stop, depth=0, backs=frozenset(),
              open_loops=()):
    """Emit one region as nested if/else and for(;;)."""
    out = []
    seen = set()
    while node is not None and node != stop:
        if node in open_loops:
            out.append("continue;")
            return out
        if any(w == node for _, w in backs):
            header = node
            latches = [v for v, w in backs if w == header]
            body = loop_body(edges, latches, header)
            after = loop_exit(edges, body)
            inner = structure(blocks, edges, lifted, conds, header, after, depth + 1,
                              frozenset((v, w) for v, w in backs if w != header),
                              open_loops + (header,))
            out.append("for (;;) {")
            out.append(f"  if (++_guard > 4000000) throw new Error('loop {header} did not end');")
            out.extend("  " + s for s in inner)
            out.append("  break;")
            out.append("}")
            node = after
            continue
        if node in seen or depth > 40:
            raise Bail("control flow this pass cannot shape")
        seen.add(node)
        out.extend(lifted[node])
        outs = edges.get(node, [])
        if not outs:
            return out
        if len(outs) == 1:
            node = outs[0]
            continue
        if node not in conds:
            raise Bail("two-way branch with no condition")
        cond_text, taken = conds[node]
        fall = [x for x in outs if x != taken]
        if len(fall) != 1:
            raise Bail("branch whose two edges cannot be told apart")
        fall = fall[0]
        join = meet(edges, taken, fall)
        cond = cond_text
        then = structure(blocks, edges, lifted, conds, taken, join, depth + 1,
                         backs, open_loops)
        other = structure(blocks, edges, lifted, conds, fall, join, depth + 1,
                          backs, open_loops)
        if other:
            out.append(f"if ({cond}) {{")
            out.extend("  " + s for s in then)
            out.append("} else {")
            out.extend("  " + s for s in other)
            out.append("}")
        else:
            out.append(f"if ({cond}) {{")
            out.extend("  " + s for s in then)
            out.append("}")
        node = join
    return out


def meet(edges, a, b):
    """The first node both paths reach - where an if/else joins again."""
    def reach(n, seen):
        if n in seen:
            return
        seen.add(n)
        for m in edges.get(n, []):
            reach(m, seen)
    ra, rb = set(), set()
    reach(a, ra)
    reach(b, rb)
    both = ra & rb
    if not both:
        return None
    # the one nothing else in the set reaches first: the earliest join
    order = sorted(both)
    for n in order:
        others = set()
        for m in both:
            if m != n:
                reach(m, others)
        if n not in others:
            return n
    return order[0]


def lift(lo, hi, names):
    g = build(lo, hi)
    if not g:
        raise Bail("nothing to decode")
    starts, edges = g["blocks"], {int(k): v for k, v in g["edges"].items()}
    ok, back = reducible(len(starts), edges)
    clone_of = {}
    if not ok:
        edges, grown, clone_of = split_nodes(edges, len(starts), len(starts) * 4 + 8)
        if edges is None:
            raise Bail("irreducible even after splitting")
    ends = starts[1:] + [hi]

    index = {a: k for k, a in enumerate(starts)}
    lifter = BlockLifter(lo, hi, names)
    lifted, conds = {}, {}
    for n, (s, e) in enumerate(zip(starts, ends)):
        lifter.stmts = []
        ins = decode(s, e)
        for i in ins:
            b = i.mnemonic.split(".")[0]
            if b in COND:
                # Which successor is the taken one has to come from the branch
                # itself. The graph stores successors sorted by block index, so
                # for a forward branch the fall-through sorts first - reading
                # them positionally inverts every condition in the routine.
                tgt = target_of(i)
                if tgt is None or tgt not in index:
                    raise Bail("conditional branch out of the routine")
                conds[n] = (lifter.condition(b), index[tgt])
                continue
            if b in ("bra", "bral", "jmp"):
                tgt = target_of(i)
                if tgt is not None and tgt in index:
                    continue                     # an edge the graph already has
                if tgt is None:
                    raise Bail("computed jump")
                # Outside this routine: a tail jump, which hands the callee the
                # frame this routine was given. The graph has no edge for it, so
                # without this the block simply runs off its end and control
                # never goes anywhere.
                if lifter.pushed:
                    raise Bail("tail jump with arguments still on the stack")
                lifter.flush()
                lifter.stmts.append(f"jumpRom(0x{tgt:05x});")
                lifter.stmts.append("return;")
                continue
            lifter.step(i)
        lifted[n] = list(lifter.stmts)
    for copy, orig in clone_of.items():
        lifted[copy] = list(lifted[orig])
        if orig in conds:
            conds[copy] = conds[orig]
    backs = frozenset(back_edges(edges, len(starts) + len(clone_of)))
    body = structure(starts, edges, lifted, conds, 0, None, 0, backs, ())
    return lifter, body


def main():
    rows = json.loads((HERE / "out" / "cfg.json").read_text())
    # Irreducible graphs are included now: split_nodes duplicates the
    # multi-entry regions until they nest.
    targets = [r for r in rows if r["blocks"] > 1]
    ok, failed = [], {}
    for r in targets:
        try:
            lifter, body = lift(r["at"], r["end"], {})
            regs = sorted(lifter.used_regs)
            args = [f"{x}: number" for x in regs] + \
                   [f"{lifter.params[k]}: number" for k in sorted(lifter.params)]
            decl = "\n".join(f"  let {x} = {x}_;" for x in regs)
            sig = ", ".join(
                [f"{x}_: number" for x in regs]
                + [f"{lifter.params[k]}: number" for k in sorted(lifter.params)])
            tail = "\n".join(f"  setReg('{x}', {x});" for x in regs)
            # Declared unconditionally. A loop guard is referenced from inside
            # a nested region, and deciding whether to declare it by looking
            # for the name in the assembled body missed three routines - which
            # ran correctly and failed to type-check, the one combination the
            # oracle cannot catch.
            guard = "  let _guard = 0;\n  void _guard;\n"
            src = (f"export function fn_{r['at']:05x}({sig}): void {{\n"
                   + guard
                   + (decl + "\n" if decl else "")
                   + "\n".join("  " + s for s in body)
                   + ("\n" + tail if tail else "") + "\n}")
            ok.append((r["at"], src, regs, sorted(lifter.params)))
            del args
        except Bail as e:
            key = str(e).split("'")[0].strip()
            failed[key] = failed.get(key, 0) + 1
        except RecursionError:
            failed["deep recursion"] = failed.get("deep recursion", 0) + 1
        except Exception as e:                       # noqa: BLE001
            k = f"crash: {type(e).__name__}"
            failed[k] = failed.get(k, 0) + 1

    print(f"branching routines: {len(targets)}")
    print(f"  lifted: {len(ok)} ({len(ok) * 100 // max(1, len(targets))}%)")
    for k, n in sorted(failed.items(), key=lambda kv: -kv[1])[:8]:
        print(f"    {n:4}  {k}")
    (HERE / "out" / "blocks.json").write_text(json.dumps(
        [{"at": a, "src": s, "regs": g, "stack": st} for a, s, g, st in ok]))
    if ok:
        print("\nexample:\n")
        for _, src, _, _ in sorted(ok, key=lambda x: len(x[1]))[3:4]:
            print(src)


if __name__ == "__main__":
    main()
