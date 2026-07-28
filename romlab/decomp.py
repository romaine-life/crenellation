"""Lift 68000 routines to readable TypeScript.

The static recompilation runs the game but understands none of it: a program
counter, a switch, and registers written by name. This turns instructions back
into expressions and statements - stack arguments become parameters, registers
become locals or vanish into the expressions that used them, and a call becomes
a call.

Nothing here is trusted on sight. Every routine it emits is checked against the
recompiled one on the same inputs by decomp.test.ts, which is the whole reason
the recompilation was worth building first: it is the oracle.

This first pass handles routines with a single basic block. Control-flow
structuring comes next; 302 of 778 routines need none at all.
"""

import json
import re
from pathlib import Path

import capstone

HERE = Path(__file__).parent
UP = (HERE / "prog_ext.bin").read_bytes()
FACTS = json.loads((HERE / "out" / "facts.json").read_text())

md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

SIZE_BITS = {"b": 8, "w": 16, "l": 32}
DATA = [f"d{n}" for n in range(8)]
ADDR = [f"a{n}" for n in range(8)]


class Bail(Exception):
    """This routine needs something the pass does not do yet."""


def decode(lo, hi):
    out, at = [], lo
    while at < hi:
        ins = next(md.disasm(UP[at:min(at + 16, hi)], at, 1), None)
        if ins is None:
            raise Bail(f"undecodable at 0x{at:x}")
        out.append(ins)
        at += ins.size
    return out


def split_ops(op_str):
    """Split on commas that are not inside brackets."""
    out, depth, cur = [], 0, ""
    for ch in op_str:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def num(tok):
    tok = tok.strip()
    if tok.startswith("#"):
        tok = tok[1:]
    neg = tok.startswith("-")
    if neg:
        tok = tok[1:]
    v = int(tok[1:], 16) if tok.startswith("$") else int(tok, 10)
    return -v if neg else v


class Expr:
    """A value, as source text plus how it was built."""

    def __init__(self, text, kind="expr", base=None, off=0):
        self.text = text
        self.kind = kind            # "imm", "reg", "addr", "expr"
        self.base = base            # for addresses: the symbolic base
        self.off = off

    def __repr__(self):
        return self.text


class Lifter:
    def __init__(self, lo, hi, names):
        self.lo, self.hi = lo, hi
        self.names = names
        self.reg = {}               # register -> Expr
        self.stmts = []
        self.params = {}            # stack offset -> parameter name
        self.pushed = []            # arguments pushed but not yet consumed
        self.temps = []             # named intermediates, in evaluation order
        self.used_regs = set()

    # ---- reading operands -------------------------------------------------

    def read(self, tok, bits):
        tok = tok.strip()
        if tok.startswith("#"):
            return Expr(hex(num(tok)), "imm")
        if tok in DATA or tok in ADDR:
            return self.reg_value(tok, bits)
        m = re.fullmatch(r"\$([0-9a-fA-F]+)\.(w|l)", tok)
        if m:
            return Expr(f"load{bits}(0x{int(m.group(1), 16):x})", "expr")
        m = re.fullmatch(r"(-?\$?[0-9a-fA-F]+)?\((a\d)\)", tok)
        if m:
            off = num(m.group(1)) if m.group(1) else 0
            return self.mem_read(m.group(2), off, bits)
        m = re.fullmatch(r"\((a\d)\)\+", tok)
        if m:
            r = m.group(1)
            v = self.mem_read(r, 0, bits)
            self.bump(r, bits // 8)
            return v
        m = re.fullmatch(r"-\((a\d)\)", tok)
        if m:
            r = m.group(1)
            self.bump(m.group(1), -(bits // 8))
            return self.mem_read(r, 0, bits)
        raise Bail(f"operand {tok!r}")

    def reg_value(self, r, bits):
        if r == "a7":
            raise Bail("bare a7")
        if r not in self.reg:
            # Read before written: the routine expects it set by the caller, so
            # it is a parameter. The 68000 has no fixed calling convention and
            # this code uses both registers and the stack, sometimes together.
            self.used_regs.add(r)
            self.reg[r] = Expr(r, "reg")
        e = self.reg[r]
        if bits == 32 or e.kind == "imm":
            return e
        mask = {8: "0xff", 16: "0xffff"}[bits]
        return Expr(f"({e.text} & {mask})", "expr")

    def mem_read(self, r, off, bits):
        if r == "a7":
            # a stack slot: an incoming argument, since nothing has pushed here
            return Expr(self.param(off), "expr")
        b = self.reg_value(r, 32)
        addr = b.text if off == 0 else f"{b.text} + {hex(off)}"
        return Expr(f"load{bits}({addr})", "expr")

    def param(self, off):
        # 4(a7) is the first argument: 0(a7) holds the return address
        if off < 4:
            raise Bail("reads below the first argument")
        if off not in self.params:
            self.params[off] = f"arg{(off - 4) // 4}"
        return self.params[off]

    def bump(self, r, by):
        cur = self.reg_value(r, 32)
        self.reg[r] = Expr(f"({cur.text} + {by})" if by > 0 else f"({cur.text} - {-by})", "expr")

    # ---- writing ----------------------------------------------------------

    def temp(self, value):
        """Give an expression a name, and evaluate it here.

        Carrying expressions forward unevaluated looks like it saves a variable
        and does two harmful things. It grows the text exponentially - one
        routine came out as a single 700-character store - and, worse, it is
        unsound: an expression holding `load16(p)` that is re-materialised after
        a `store16(p, ...)` reads the value the routine just wrote instead of
        the one it read. Naming it pins the moment it was evaluated.
        """
        if value.kind == "imm" or re.fullmatch(r"[A-Za-z_]\w*", value.text):
            return value
        name = f"t{len(self.temps)}"
        self.temps.append(name)
        self.stmts.append(f"const {name} = {value.text};")
        return Expr(name, "expr")

    def write(self, tok, value, bits):
        tok = tok.strip()
        if tok in DATA or tok in ADDR:
            value = self.temp(value)
            if bits == 32 or tok in ADDR:
                self.reg[tok] = value
            else:
                keep = {8: "0xffffff00", 16: "0xffff0000"}[bits]
                old = self.reg_value(tok, 32)
                self.reg[tok] = self.temp(Expr(
                    f"(({old.text} & {keep}) | ({value.text} & "
                    f"{ {8: '0xff', 16: '0xffff'}[bits] }))", "expr"))
            return
        m = re.fullmatch(r"\$([0-9a-fA-F]+)\.(w|l)", tok)
        if m:
            self.stmts.append(f"store{bits}(0x{int(m.group(1), 16):x}, {value.text});")
            return
        m = re.fullmatch(r"(-?\$?[0-9a-fA-F]+)?\((a\d)\)", tok)
        if m:
            off = num(m.group(1)) if m.group(1) else 0
            r = m.group(2)
            if r == "a7":
                raise Bail("writes to the stack")
            b = self.reg_value(r, 32)
            addr = b.text if off == 0 else f"{b.text} + {hex(off)}"
            self.stmts.append(f"store{bits}({addr}, {value.text});")
            return
        m = re.fullmatch(r"\((a\d)\)\+", tok)
        if m:
            r = m.group(1)
            b = self.reg_value(r, 32)
            self.stmts.append(f"store{bits}({b.text}, {value.text});")
            self.bump(r, bits // 8)
            return
        m = re.fullmatch(r"-\((a\d)\)", tok)
        if m:
            r = m.group(1)
            if r == "a7":
                self.pushed.append(value)
                return
            self.bump(r, -(bits // 8))
            b = self.reg_value(r, 32)
            self.stmts.append(f"store{bits}({b.text}, {value.text});")
            return
        raise Bail(f"destination {tok!r}")

    # ---- the pass ---------------------------------------------------------

    def run(self):
        ins = decode(self.lo, self.hi)
        # A block that runs off its own end is not a function. Several entries
        # in the map are labels the ROM jumps to that simply continue into the
        # next routine, and lifting one produces something that stops where the
        # machine carries on - which the oracle catches as a register left
        # unset, correctly.
        last = ins[-1].mnemonic.split(".")[0] if ins else ""
        if last not in ("rts", "rte", "rtr", "jmp", "bra", "bral"):
            raise Bail("falls through its end, so it is a block and not a function")
        for i in ins:
            self.step(i)
        return self

    def step(self, ins):
        mn = ins.mnemonic
        b = mn.split(".")[0]
        size = mn.rsplit(".", 1)[1] if "." in mn else "w"
        bits = SIZE_BITS.get(size, 16)
        ops = split_ops(ins.op_str or "")

        if b == "rts":
            return
        if b == "nop":
            return
        if b == "pea":
            tok = ops[0].strip()
            m = re.fullmatch(r"\$([0-9a-fA-F]+)\.(w|l)", tok)
            if m:
                self.pushed.append(Expr(f"0x{int(m.group(1), 16):x}", "imm"))
                return
            m = re.fullmatch(r"\((a\d)\)", tok)
            if m:
                self.pushed.append(self.reg_value(m.group(1), 32))
                return
            raise Bail(f"pea {tok!r}")
        if b in ("jsr", "bsr"):
            tok = ops[0].strip()
            m = re.fullmatch(r"\$([0-9a-fA-F]+)(\.(w|l))?", tok)
            if not m:
                raise Bail(f"indirect call {tok!r}")
            target = int(m.group(1), 16)
            args = ", ".join(a.text for a in self.pushed)
            self.pushed = []
            self.stmts.append(f"{self.names.get(target, 'fn_%05x' % target)}({args});")
            # a call clobbers the scratch registers
            for r in ("d0", "d1", "a0", "a1"):
                self.reg.pop(r, None)
            self.reg["d0"] = Expr("_ret", "expr")
            return
        if b in ("jmp", "bra"):
            tok = ops[0].strip()
            m = re.fullmatch(r"\$([0-9a-fA-F]+)(\.(w|l))?", tok)
            if not m:
                raise Bail("computed jump")
            target = int(m.group(1), 16)
            args = ", ".join(a.text for a in self.pushed)
            self.pushed = []
            self.stmts.append(f"return {self.names.get(target, 'fn_%05x' % target)}({args});")
            return
        if b in ("addq", "adda", "add") and ops[-1].strip() == "a7":
            # stack cleanup after a call - the arguments are already consumed
            return
        if b in ("move", "movea"):
            self.write(ops[1], self.read(ops[0], bits), bits)
            return
        if b == "moveq":
            self.write(ops[1], Expr(hex(num(ops[0])), "imm"), 32)
            return
        if b == "clr":
            self.write(ops[0], Expr("0", "imm"), bits)
            return
        if b in ("add", "addq", "adda", "addi"):
            dst = ops[-1]
            cur = self.read(dst, bits)
            self.write(dst, Expr(f"({cur.text} + {self.read(ops[0], bits).text})"), bits)
            return
        if b in ("sub", "subq", "suba", "subi"):
            dst = ops[-1]
            cur = self.read(dst, bits)
            self.write(dst, Expr(f"({cur.text} - {self.read(ops[0], bits).text})"), bits)
            return
        if b in ("and", "andi"):
            dst = ops[-1]
            self.write(dst, Expr(f"({self.read(dst, bits).text} & {self.read(ops[0], bits).text})"), bits)
            return
        if b in ("or", "ori"):
            dst = ops[-1]
            self.write(dst, Expr(f"({self.read(dst, bits).text} | {self.read(ops[0], bits).text})"), bits)
            return
        if b in ("eor", "eori"):
            dst = ops[-1]
            self.write(dst, Expr(f"({self.read(dst, bits).text} ^ {self.read(ops[0], bits).text})"), bits)
            return
        if b == "lea":
            tok = ops[0].strip()
            m = re.fullmatch(r"\$([0-9a-fA-F]+)(\.(w|l))?", tok)
            if m:
                self.write(ops[1], Expr(f"0x{int(m.group(1), 16):x}", "imm"), 32)
                return
            m = re.fullmatch(r"(-?\$?[0-9a-fA-F]+)?\((a\d)\)", tok)
            if m:
                off = num(m.group(1)) if m.group(1) else 0
                base = self.reg_value(m.group(2), 32)
                self.write(ops[1], Expr(base.text if off == 0 else f"({base.text} + {hex(off)})"), 32)
                return
            raise Bail(f"lea {tok!r}")
        raise Bail(f"no rule for {mn} {ins.op_str}")

    def order(self):
        """Parameters in signature order, with where each comes from."""
        regs = [{"from": "reg", "name": r} for r in sorted(self.used_regs)]
        stack = [{"from": "stack", "off": k, "name": self.params[k]}
                 for k in sorted(self.params)]
        return regs + stack

    def outputs(self):
        """Registers this routine leaves changed - its results.

        A routine whose whole effect is `moveq #5,d4` produces nothing at all
        if only memory writes are emitted, which is how the first version of
        this pass turned one into an empty function that the oracle promptly
        caught. Until the callers are lifted too and these can become return
        values, they are written back where the caller looks for them.
        """
        out = []
        for r, e in sorted(self.reg.items()):
            if e.kind == "reg" and e.text == r:
                continue                      # untouched: still the entry value
            out.append((r, e))
        return out

    def emit(self, addr, label):
        args = [p["name"] for p in self.order()]
        sig = ", ".join(f"{a}: number" for a in args)
        head = f"/** {label} */" if label else ""
        stmts = list(self.stmts)
        for r, e in self.outputs():
            stmts.append(f"setReg('{r}', {e.text});")
        body = "\n".join("  " + s for s in stmts) or "  // nothing observable"
        return (f"{head}\nexport function fn_{addr:05x}({sig}): void {{\n{body}\n}}").strip()


TS_HEAD = """// Generated by romlab/decomp.py - do not edit by hand.
//
// Decompiled routines: recovered source, not transliterated machine code.
// Stack arguments have become parameters and registers have become expressions.
// Every function here is checked against the recompiled routine at the same
// address by decomp.test.ts, on random machine states, and none of it is
// trusted without that.

import type { Machine } from './machine';

let M: Machine;
/** Point the decompiled code at a machine before calling anything. */
export function bind(m: Machine): void { M = m; }

const load8 = (a: number): number => M.byte(a);
const load16 = (a: number): number => M.load(a, 16);
const load32 = (a: number): number => M.load(a, 32);
const store8 = (a: number, v: number): void => M.setByte(a, v);
const store16 = (a: number, v: number): void => M.store(a, v, 16);
const store32 = (a: number, v: number): void => M.store(a, v, 32);
/** A result the caller reads out of a register. These become ordinary return
 *  values once the call sites are lifted too; for now they go back where the
 *  ROM's caller expects to find them. */
const setReg = (r: string, v: number): void => {
  (M as unknown as Record<string, number>)[r] = v;
};
void load8; void load16; void load32; void store8; void store16; void store32; void setReg;
"""


def emit_ts(rows):
    out = [TS_HEAD]
    index = []
    for at, src, params in sorted(rows):
        out.append(src)
        srcs = ", ".join(
            ("{ from: 'reg', name: '%s' }" % q["name"]) if q["from"] == "reg"
            else ("{ from: 'stack', off: %d }" % q["off"]) for q in params)
        index.append(f"  {{ at: 0x{at:05x}, fn: fn_{at:05x} as (...a: number[]) => void,"
                     f" params: [{srcs}] }},")
    out.append("/** Where each routine's parameters come from - the 68000 has no")
    out.append(" *  fixed calling convention, and this code uses registers and the")
    out.append(" *  stack, sometimes in the same routine. */")
    out.append("export type ParamSource = { from: 'reg'; name: string } | { from: 'stack'; off: number };")
    out.append("")
    out.append("/** Every decompiled routine, by the ROM address it came from. */")
    out.append("export const DECOMPILED: ReadonlyArray<{")
    out.append("  at: number; fn: (...a: number[]) => void; params: ParamSource[];")
    out.append("}> = [")
    out.extend(index)
    out.append("];")
    dest = HERE.parent / "frontend" / "src" / "rom" / "decompiled.ts"
    dest.write_text("\n\n".join(out) + "\n", encoding="utf-8")


def main():
    rows = json.loads((HERE / "out" / "cfg.json").read_text())
    names = {}
    ok, failed = [], {}
    for r in rows:
        if r["blocks"] != 1:
            continue
        try:
            lift = Lifter(r["at"], r["end"], names).run()
            ok.append((r["at"], lift.emit(r["at"], None), lift.order()))
        except Bail as e:
            failed.setdefault(str(e).split("'")[0].strip(), 0)
            failed[str(e).split("'")[0].strip()] += 1
        except Exception as e:                       # noqa: BLE001 - report, do not hide
            failed.setdefault(f"crash: {type(e).__name__}", 0)
            failed[f"crash: {type(e).__name__}"] += 1

    total = sum(1 for r in rows if r["blocks"] == 1)
    print(f"single-block routines: {total}")
    print(f"  lifted: {len(ok)} ({len(ok) / total * 100:.0f}%)")
    print("  not yet, by reason:")
    for k, n in sorted(failed.items(), key=lambda kv: -kv[1])[:10]:
        print(f"    {n:4}  {k}")
    (HERE / "out" / "decomp.json").write_text(json.dumps(
        [{"at": a, "src": s, "params": p} for a, s, p in ok]))
    print(f"wrote out/decomp.json")

    # A routine that calls another is only verifiable once the call is modelled
    # the way the machine models it, so the first proved batch is the ones that
    # call nothing. The rest are lifted and held back, not thrown away.
    pure = [(a, s, p) for a, s, p in ok if "fn_" not in s.split("{", 1)[1]]
    emit_ts(pure)
    print(f"  of those, {len(pure)} call nothing and go to the verifier")
    if ok:
        print("\nexample:\n")
        sample = [t for t in ok if len(t[1].splitlines()) > 4][:2]
        for _, src, _ in sample:
            print(src, "\n")


if __name__ == "__main__":
    main()
