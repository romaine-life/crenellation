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
        self.pushed = 0             # bytes pushed and not yet dropped
        self.temps = []             # named intermediates, in evaluation order
        self.after_call = False     # registers now hold whatever the callee left
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
            if self.after_call:
                # Whatever the callee left there. Not a parameter of this
                # routine, and not knowable statically.
                self.reg[r] = self.temp(Expr(f"getReg('{r}')", "expr"))
            else:
                # Read before written: the routine expects it set by the caller,
                # so it is a parameter. The 68000 has no fixed calling
                # convention and this code uses registers and the stack, at
                # times in the same routine.
                self.used_regs.add(r)
                self.reg[r] = Expr(r, "reg")
        e = self.reg[r]
        if bits == 32 or e.kind == "imm":
            return e
        mask = {8: "0xff", 16: "0xffff"}[bits]
        return Expr(f"({e.text} & {mask})", "expr")

    def mem_read(self, r, off, bits):
        if r == "a7":
            # An incoming argument - but relative to a stack pointer that has
            # moved. A routine that pushes ten bytes and then reads 0xE(a7) is
            # reading offset 4 of the frame it was given, its first argument,
            # not its fourth. Arguments occupy four-byte slots, and a narrower
            # read takes part of one, the high part first, because the 68000 is
            # big-endian.
            off -= self.pushed
            if off < 0:
                raise Bail("reads a value it pushed itself")
            slot = off & ~3
            name = self.param(slot)
            if bits == 32:
                if off != slot:
                    raise Bail("long read straddling two argument slots")
                return Expr(name, "expr")
            within = off - slot
            shift = (4 - within - (bits // 8)) * 8
            mask = {8: "0xff", 16: "0xffff"}[bits]
            inner = name if shift == 0 else f"({name} >>> {shift})"
            return Expr(f"({inner} & {mask})", "expr")
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

    def flush(self):
        """Write every register this routine holds in a local back to the machine."""
        for r, e in sorted(self.reg.items()):
            if e.kind == "reg" and e.text == r:
                continue
            self.stmts.append(f"setReg('{r}', {e.text});")

    def write(self, tok, value, bits):
        tok = tok.strip()
        if tok in DATA or tok in ADDR:
            if tok in ADDR and bits == 16:
                # A word move to an address register sign-extends to all 32
                # bits - there is no such thing as a partial write to one.
                # Storing the bare word loses the top half of every address.
                value = Expr(f"((({value.text}) << 16) >> 16)")
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
                self.stmts.append(f"push({value.text}, {bits // 8});")
                self.pushed += bits // 8
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
                self.stmts.append(f"push(0x{int(m.group(1), 16):x}, 4);")
                self.pushed += 4
                return
            m = re.fullmatch(r"\((a\d)\)", tok)
            if m:
                self.stmts.append(f"push({self.reg_value(m.group(1), 32).text}, 4);")
                self.pushed += 4
                return
            raise Bail(f"pea {tok!r}")
        if b in ("jsr", "bsr"):
            tok = ops[0].strip()
            m = re.fullmatch(r"\$([0-9a-fA-F]+)(\.(w|l))?", tok)
            if not m:
                raise Bail(f"indirect call {tok!r}")
            target = int(m.group(1), 16)
            
            # The callee reads its arguments where the ROM put them: some on the
            # stack, some in registers. So everything this routine holds in a
            # local has to be back in the machine before control leaves, and
            # nothing may be assumed about it afterwards - the callee is free to
            # use any register, and several do.
            self.flush()
            self.stmts.append(f"callRom(0x{target:05x});")
            self.reg = {}
            self.after_call = True
            return
        if b in ("jmp", "bra"):
            tok = ops[0].strip()
            m = re.fullmatch(r"\$([0-9a-fA-F]+)(\.(w|l))?", tok)
            if not m:
                raise Bail("computed jump")
            target = int(m.group(1), 16)
            if self.pushed:
                raise Bail("tail jump with arguments still on the stack")
            self.flush()
            # A jump is not a call: it pushes no return address and hands the
            # callee the frame this routine was given, so the arguments the
            # original caller pushed are still where the callee expects them.
            # Calling instead puts a return address on top and shifts them all.
            self.stmts.append(f"jumpRom(0x{target:05x});")
            self.stmts.append("return;")
            return
        if b in ("addq", "adda", "add", "lea") and ops[-1].strip() == "a7":
            # The ROM's own stack cleanup. It is not always one call's worth:
            # a routine can push, call, push, call and then drop both at the
            # end, so the arguments have to live on the stack exactly as long
            # as the ROM leaves them there.
            if b == "lea":
                m2 = re.fullmatch(r"(-?\$?[0-9a-fA-F]+)?\(a7\)", ops[0].strip())
                if not m2:
                    raise Bail(f"no rule for {mn} {ins.op_str}")
                n = num(m2.group(1)) if m2.group(1) else 0
            else:
                n = num(ops[0])
            self.stmts.append(f"drop({n});")
            self.pushed -= n
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
        if b == "ext":
            # Sign-extend in place: byte to word, or word to long.
            src_bits = 8 if bits == 16 else 16
            v = self.read(ops[0], src_bits)
            shift = 32 - src_bits
            self.write(ops[0], Expr(f"((({v.text}) << {shift}) >> {shift})"), bits)
            return
        if b in ("asl", "lsl", "asr", "lsr"):
            if len(ops) == 1:
                dst, cnt = ops[0], Expr("1", "imm")
            else:
                dst, cnt = ops[1], self.read(ops[0], 32)
            cur = self.read(dst, bits)
            if b in ("asl", "lsl"):
                expr = f"(({cur.text}) << (({cnt.text}) & 63))"
            elif b == "lsr":
                expr = f"(({cur.text}) >>> (({cnt.text}) & 63))"
            else:
                shift = 32 - bits
                signed = cur.text if bits == 32 else f"((({cur.text}) << {shift}) >> {shift})"
                expr = f"(({signed}) >> (({cnt.text}) & 63))"
            self.write(dst, Expr(expr), bits)
            return
        if b == "neg":
            self.write(ops[0], Expr(f"(0 - ({self.read(ops[0], bits).text}))"), bits)
            return
        if b == "not":
            mask = (1 << bits) - 1
            self.write(ops[0], Expr(f"((~({self.read(ops[0], bits).text})) & {mask})"), bits)
            return
        if b == "swap":
            v = self.read(ops[0], 32)
            self.write(ops[0], Expr(
                f"(((({v.text}) >>> 16) & 0xffff) | ((({v.text}) & 0xffff) << 16))"), 32)
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
        # A routine that ended in a tail jump has already handed control away
        # and flushed what it held; anything after the return is dead.
        if not (stmts and stmts[-1] == "return;"):
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
import { call as romCall } from './dispatch';

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
/** Read a register back after a call left something in it. */
const getReg = (r: string): number =>
  ((M as unknown as Record<string, number>)[r] >>> 0);

/**
 * Call another ROM routine the way the machine calls it: arguments pushed on
 * the machine's own stack, then the dispatcher, then the stack unwound. Once
 * the callee is lifted too this becomes an ordinary call with ordinary
 * arguments; until then it has to agree with the oracle exactly.
 */
/** An argument, at the width the ROM pushed it. */
const push = (v: number, bytes: number): void => { M.storePre('a7', bytes, v, bytes * 8); };

/** The ROM's own stack cleanup, `addq.l #n,a7`. */
const drop = (n: number): void => { M.a7 = (M.a7 + n) >>> 0; };

/**
 * Call another ROM routine. `jsr` pushes a return address, so the callee finds
 * its first argument at 4(a7); only that return address is removed here,
 * because the arguments belong to the caller until it drops them - and a
 * routine may push, call, push, call and drop both lots at the end.
 */
const callRom = (addr: number): void => {
  M.storePre('a7', 4, 0, 32);
  romCall(addr, M);
  // No adjustment afterwards: the callee's own `rts` popped the return
  // address. Removing it here as well pops a second four bytes and every
  // argument still on the stack shifts under the next call.
};
void load8; void load16; void load32; void store8; void store16; void store32;
/** Tail-jump to another routine: same stack, no return address. */
const jumpRom = (addr: number): void => { romCall(addr, M); };
/** The machine's stack pointer, for routines that build a frame with `link`. */
const stackPointer = (): number => M.a7 >>> 0;
const setStackPointer = (v: number): void => { M.a7 = v >>> 0; };
const popLong = (): number => { const v = M.load(M.a7 >>> 0, 32); M.a7 = (M.a7 + 4) >>> 0; return v; };
void setReg; void getReg; void callRom; void jumpRom; void push; void drop;
void stackPointer; void setStackPointer; void popLong;
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
    # Routines that branch are lifted by blocks.py, which shares this lifter and
    # this module - and, more to the point, the same oracle.
    blocks = HERE / "out" / "blocks.json"
    if blocks.exists():
        for row in json.loads(blocks.read_text()):
            if "fn_" in row["src"].split("{", 1)[1]:
                continue
            params = ([{"from": "reg", "name": r} for r in row["regs"]]
                      + [{"from": "stack", "off": o} for o in row["stack"]])
            pure.append((row["at"], row["src"], params))
    # Anything the oracle caught disagreeing is held back until it is fixed.
    # The list is written by decomp.test.ts and is deliberately visible.
    unp = HERE / "out" / "unproven.json"
    held = set(json.loads(unp.read_text())) if unp.exists() else set()
    if held:
        print(f"  held back, disagreed with the machine: {len(held)}")
    pure = [x for x in pure if x[0] not in held]
    emit_ts(pure)
    print(f"  of those, {len(pure)} call nothing and go to the verifier")
    if ok:
        print("\nexample:\n")
        sample = [t for t in ok if len(t[1].splitlines()) > 4][:2]
        for _, src, _ in sample:
            print(src, "\n")


if __name__ == "__main__":
    main()
