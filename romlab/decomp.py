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


_IDENTS = None


def ident(at):
    """The identifier a routine gets: its stated purpose, or its address.

    A name that was never established is left as the address rather than
    invented - `fn_0ccb2` is uninformative and honest, and a plausible name
    nobody checked is neither.
    """
    global _IDENTS
    if _IDENTS is None:
        f = HERE / "out" / "idents.json"
        _IDENTS = ({int(k, 16): v for k, v in json.loads(f.read_text())["idents"].items()}
                   if f.exists() else {})
    return _IDENTS.get(at) or f"fn_{at:05x}"


class Bail(Exception):
    """This routine needs something the pass does not do yet."""


def decode(lo, hi):
    """Every instruction from `lo` up to `hi`, decoded whole.

    The window is sixteen bytes from the instruction's own address, not from
    here to `hi`. Clamping it truncates the last instruction when a routine's
    declared end falls inside one, and capstone then reports a different
    instruction entirely - `move.l #$55555555,d0` at 0x434 read back as
    `#$aaaaaaaa`, because an entry at 0x438 cut it in half. The recompiler
    always decoded from the full image and was right; this was the only place
    that trusted the boundary over the bytes.
    """
    out, at = [], lo
    while at < hi:
        ins = next(md.disasm(UP[at:at + 16], at, 1), None)
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


def expand_regs(tok):
    """`d2-d4/a2` -> the register names it names."""
    out = []
    for part in tok.split("/"):
        part = part.strip()
        m = re.fullmatch(r"([ad])(\d)-([ad])(\d)", part)
        if m and m.group(1) == m.group(3):
            out.extend(f"{m.group(1)}{n}" for n in range(int(m.group(2)), int(m.group(4)) + 1))
            continue
        if re.fullmatch(r"[ad]\d", part):
            out.append(part)
            continue
        raise Bail(f"movem list {tok!r}")
    return out


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
        self.saved = {}             # registers a movem is holding
        self.restored = set()       # registers a movem put back
        self.dirty = set()          # argument slots this routine wrote back
        self.frame = None           # the register `link` made the frame pointer

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
        m = re.fullmatch(r"(-?\$?[0-9a-fA-F]+)?\((a\d),\s*([ad]\d)\.(w|l)\)", tok)
        if m:
            return Expr(f"load{bits}({self.indexed(m)})", "expr")
        if re.fullmatch(r"\$[0-9a-fA-F]+\(pc(,\s*[ad]\d\.(w|l))?\)", tok):
            return Expr(f"load{bits}({self.effective_address(tok)})", "expr")
        m = re.fullmatch(r"\((a\d)\)\+", tok)
        if m:
            r = m.group(1)
            # Pinned before the increment. Left as an expression it is
            # materialised after the pointer has already moved, and for a7 the
            # increment is a real `drop`, so the read lands a slot too high.
            v = self.temp(self.mem_read(r, 0, bits))
            self.bump(r, self.step_of(r, bits))
            return v
        m = re.fullmatch(r"-\((a\d)\)", tok)
        if m:
            r = m.group(1)
            self.bump(r, -self.step_of(r, bits))
            return self.mem_read(r, 0, bits)
        if tok == "sr":
            # `move sr,dN` reads the real condition codes, which nothing here
            # models - the lifted code never sets N/Z/V/C, so it would return
            # whatever the last machine instruction happened to leave. Writing
            # sr is fine; reading it is not.
            raise Bail("reads the condition codes")
        raise Bail(f"operand {tok!r}")

    def reg_value(self, r, bits):
        if r == "a7":
            # Reading the stack pointer as a value - `lea 4(a7),a0` and friends.
            # It is the machine's, so it is read from the machine; only writes
            # to it have to go through push and drop.
            return Expr("stackPointer()", "expr")
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
        if r == self.frame and off >= 8:
            # Through the frame pointer. After `link a6`, 0(a6) holds the saved
            # a6 and 4(a6) the return address, so 8(a6) is the first argument -
            # the same slot `4(a7)` names before anything is pushed. Reading it
            # as ordinary memory instead of an argument leaves the harness with
            # no reason to put a value there, and the routine then runs on
            # whatever the stack happened to contain.
            return self.slot_read(off - 4, bits, f"{r} + {hex(off)}")
        if r == "a7":
            # An incoming argument - but relative to a stack pointer that has
            # moved. A routine that pushes ten bytes and then reads 0xE(a7) is
            # reading offset 4 of the frame it was given, its first argument,
            # not its fourth. Arguments occupy four-byte slots, and a narrower
            # read takes part of one, the high part first, because the 68000 is
            # big-endian.
            if off < self.pushed:
                # Inside what this routine pushed. The pushes are real machine
                # stack operations, so this is simply a read of the machine's
                # stack - no need to track the values symbolically.
                return Expr(f"load{bits}(stackPointer() + {off})", "expr")
            return self.slot_read(off - self.pushed, bits,
                                  f"stackPointer() + {off}")
        b = self.reg_value(r, 32)
        addr = b.text if off == 0 else f"{b.text} + {hex(off)}"
        return Expr(f"load{bits}({addr})", "expr")

    def indexed(self, m):
        """`disp(an, xn.w)` - a base register, a displacement and an index.

        The index is sign-extended from its stated width, so a negative index
        walks backwards through the table. Taking it unsigned reads somewhere
        far away that happens to exist, which is worse than crashing.
        """
        disp = num(m.group(1)) if m.group(1) else 0
        base = self.reg_value(m.group(2), 32).text
        idx = self.reg_value(m.group(3), 32).text
        if m.group(4) == "w":
            idx = f"(({idx} << 16) >> 16)"
        else:
            idx = f"({idx} | 0)"
        addr = f"{base} + {idx}"
        if disp:
            addr += f" + {hex(disp)}" if disp > 0 else f" - {hex(-disp)}"
        return f"({addr})"

    def param(self, off):
        # 4(a7) is the first argument: 0(a7) holds the return address
        if off < 4:
            raise Bail("reads below the first argument")
        if off not in self.params:
            self.params[off] = f"arg{(off - 4) // 4}"
        return self.params[off]

    def slot_read(self, off, bits, live):
        """Read argument slot `off` of the frame this routine was given.

        Arguments occupy four-byte slots and a narrower read takes part of one,
        the high part first, because the 68000 is big-endian. `live` is how to
        reach the same bytes in memory, for a slot this routine has written.
        """
        if off < 4:
            # Below the first argument: the return address slot, or the frame
            # the caller is still using. A routine reached by a tail jump reads
            # here on purpose. There is no parameter for it, but the stack is
            # real and holds what the machine sees.
            return Expr(f"load{bits}({live})", "expr")
        slot = off & ~3
        if slot in self.dirty:
            return Expr(f"load{bits}({live})", "expr")
        if bits == 32 and off != slot:
            # Spanning two slots: the low half of one argument and the high
            # half of the next. There is no parameter that names those bytes,
            # but the frame is real memory holding exactly what the machine
            # sees, so read it from there.
            return Expr(f"load32({live})", "expr")
        name = self.param(slot)
        if bits == 32:
            return Expr(name, "expr")
        within = off - slot
        shift = (4 - within - (bits // 8)) * 8
        mask = {8: "0xff", 16: "0xffff"}[bits]
        inner = name if shift == 0 else f"({name} >>> {shift})"
        return Expr(f"({inner} & {mask})", "expr")

    def step_of(self, r, bits):
        """How far a pre-decrement or post-increment moves the register.

        A byte access through the stack pointer moves it by two, not one: the
        68000 keeps the stack word-aligned, so a7 never lands on an odd
        address. The recompiler has had this rule since it was checked against
        the chip; this pass did not, and a byte pushed onto the stack left it
        odd for the word pop that followed.
        """
        return 2 if r == "a7" and bits == 8 else bits // 8

    def bump(self, r, by):
        if r == "a7":
            # The stack pointer belongs to the machine. Tracking it as an
            # expression makes every later `stackPointer()` disagree with it -
            # which is what `tst.l (a7)+` did the moment `tst` stopped bailing.
            if by <= 0:
                raise Bail("pre-decrement of the stack pointer")
            self.stmts.append(f"drop({by});")
            self.pushed -= by
            return
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

    def reload(self):
        """Forget the register locals: control left through the machine and
        whatever ran there was free to change any of them. From here a read of
        an untouched register is what the handler left, not a parameter - the
        same rule a call boundary already applies. Clearing without setting
        after_call handed the final `move.w d1,d0` of the divide helper its
        entry d0 back, and the quotient came out wearing the caller's high
        word."""
        self.reg.clear()
        self.after_call = True

    def write(self, tok, value, bits):
        tok = tok.strip()
        if tok.startswith("__at:"):
            self.stmts.append(f"store{bits}({tok[5:]}, {value.text});")
            return
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
                if off < self.pushed:
                    self.stmts.append(
                        f"store{bits}(stackPointer() + {off}, {value.text});")
                    return
                # Above the frame is an argument slot: the routine is writing
                # its result back through the stack. The machine stack is the
                # real one, so the store lands where the caller will read it -
                # but the slot was also bound to a parameter, and a later read
                # of it has to see the new value, not the incoming one.
                self.dirty.add((off - self.pushed) & ~3)
                self.stmts.append(
                    f"store{bits}(stackPointer() + {off}, {value.text});")
                return
            if r == self.frame and off >= 8:
                # Writing an argument through the frame pointer. The store is
                # right either way - the stack is real - but the slot is also
                # bound to a parameter, and a later read has to see the new
                # value. The a7 path has always done this; the frame pointer
                # reaches the same bytes by another name.
                self.dirty.add((off - 4) & ~3)
            b = self.reg_value(r, 32)
            addr = b.text if off == 0 else f"{b.text} + {hex(off)}"
            self.stmts.append(f"store{bits}({addr}, {value.text});")
            return
        m = re.fullmatch(r"(-?\$?[0-9a-fA-F]+)?\((a\d),\s*([ad]\d)\.(w|l)\)", tok)
        if m:
            self.stmts.append(f"store{bits}({self.indexed(m)}, {value.text});")
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
                if bits == 8:
                    # Two bytes of stack for one byte of data, and the byte
                    # lands at the new, even, stack pointer.
                    self.stmts.append("drop(-2);")
                    self.stmts.append(f"store8(stackPointer(), {value.text});")
                    self.pushed += 2
                    return
                self.stmts.append(f"push({value.text}, {bits // 8});")
                self.pushed += bits // 8
                return
            self.bump(r, -(bits // 8))
            b = self.reg_value(r, 32)
            self.stmts.append(f"store{bits}({b.text}, {value.text});")
            return
        if tok == "sr":
            # With the address of the next instruction, so that an interrupt
            # let in by lowering the mask stacks what the chip stacks.
            at = getattr(self, "nxt", 0)
            self.stmts.append(f"setSr({value.text}, 0x{at:05x});")
            return
        if tok == "ccr":
            # The low byte of the status register: the condition codes alone.
            self.stmts.append(f"setSr((getSr() & 0xff00) | (({value.text}) & 0xff));")
            return
        raise Bail(f"destination {tok!r}")

    def rmw(self, tok, bits):
        """An operand that is read and then written, with its side effect once.

        `neg.b -(a0)` decrements a0 once and negates the byte there. Reading the
        operand and writing it separately applies the pre-decrement twice, so
        the value comes from one address and goes to another. The recompiler
        solved this long ago; this pass was written without it.

        Returns the value read and a token to write through.
        """
        tok = tok.strip()
        m = re.fullmatch(r"-\((a\d)\)", tok)
        if m:
            r = m.group(1)
            if r == "a7":
                raise Bail("read-modify-write through the stack pointer")
            self.bump(r, -(bits // 8))
            addr = self.temp(self.reg_value(r, 32))
            return Expr(f"load{bits}({addr.text})", "expr"), f"__at:{addr.text}"
        m = re.fullmatch(r"\((a\d)\)\+", tok)
        if m:
            r = m.group(1)
            if r == "a7":
                raise Bail("read-modify-write through the stack pointer")
            addr = self.temp(self.reg_value(r, 32))
            self.bump(r, bits // 8)
            return Expr(f"load{bits}({addr.text})", "expr"), f"__at:{addr.text}"
        return self.read(tok, bits), tok

    # ---- the pass ---------------------------------------------------------

    def run(self):
        ins = decode(self.lo, self.hi)
        # A block that runs off its own end is not a function. Several entries
        # in the map are labels the ROM jumps to that simply continue into the
        # next routine, and lifting one produces something that stops where the
        # machine carries on - which the oracle catches as a register left
        # unset, correctly.
        last = ins[-1].mnemonic.split(".")[0] if ins else ""
        self.falls_through = last not in ("rts", "rte", "rtr", "jmp", "bra", "bral")
        from m68kts import cycles as insn_cycles
        self.cost = sum(insn_cycles(i) for i in ins)
        for i in ins:
            self.step(i)
        return self

    def step(self, ins):
        mn = ins.mnemonic
        b = mn.split(".")[0]
        size = mn.rsplit(".", 1)[1] if "." in mn else "w"
        bits = SIZE_BITS.get(size, 16)
        ops = split_ops(ins.op_str or "")
        nxt = ins.address + ins.size          # what `jsr` pushes as the return
        # ...and what an interrupt taken *inside* this instruction stacks. A
        # `move to sr` that lowers the mask is the case: the chip lets the
        # interrupt in as part of that instruction and stacks the instruction
        # after it, not the head of the block the lifted world polls at.
        self.nxt = nxt

        if b == "rts":
            return
        if b == "nop":
            return
        if b == "movem":
            # Saving is the routine's promise to its caller, not part of what
            # it computes: hold each register's current value and put it back
            # on restore. The stack really moves, so a callee in between sees
            # the same stack the ROM gives it.
            wide = bits // 8
            if ops[1].strip() == "-(a7)":
                regs = expand_regs(ops[0])
                for r in reversed(regs):
                    self.stmts.append(f"push({self.reg_value(r, 32).text}, {wide});")
                for r in regs:
                    self.saved.setdefault(r, []).append(self.reg_value(r, 32))
                self.pushed += wide * len(regs)
                return
            if ops[0].strip() == "(a7)+":
                regs = expand_regs(ops[1])
                for n, r in enumerate(regs):
                    if not self.saved.get(r):
                        # Popping something this routine did not push - it is
                        # unwinding a frame its caller built, or a jump target
                        # sharing another routine's epilogue. The stack is the
                        # machine's, so read the value off it. A word restore
                        # sign-extends across the whole register.
                        at = f"stackPointer() + {n * wide}" if n else "stackPointer()"
                        text = (f"load32({at})" if wide == 4
                                else f"((load16({at}) << 16 >> 16) >>> 0)")
                        self.reg[r] = self.temp(Expr(text, "expr"))
                        self.restored.add(r)
                        continue
                    self.reg[r] = self.saved[r].pop()
                    # Restoring puts the entry value back, so nothing about the
                    # symbolic value changed and the writeback would be skipped
                    # as a no-op. The machine's copy is another matter: a call
                    # in between clobbered it, and the ROM's pop is what puts it
                    # right. Force the writeback.
                    self.restored.add(r)
                self.stmts.append(f"drop({wide * len(regs)});")
                self.pushed -= wide * len(regs)
                return
            raise Bail(f"movem {ins.op_str!r}")
        if b == "link":
            self.frame = ops[0].strip()
            self.stmts.append(f"push({self.reg_value(ops[0].strip(), 32).text}, 4);")
            self.stmts.append("__sp = stackPointer();")
            self.reg[ops[0].strip()] = Expr("__sp", "expr")
            # The displacement is a signed word: `link a6,#$fffc` reserves
            # four bytes, not 65,532. Reading it unsigned moved the stack
            # pointer most of the way across memory in the wrong direction.
            disp = num(ops[1]) & 0xffff
            if disp & 0x8000:
                disp -= 0x10000
            self.stmts.append(f"drop({disp});")
            self.pushed += 4 - disp
            return
        if b == "unlk":
            r = ops[0].strip()
            self.stmts.append(f"setStackPointer({self.reg_value(r, 32).text});")
            self.stmts.append("__sp = popLong();")
            self.reg[r] = Expr("__sp", "expr")
            self.pushed = 0
            return
        if b == "pea":
            self.stmts.append(f"push({self.effective_address(ops[0])}, 4);")
            self.pushed += 4
            return
        if b in ("jsr", "bsr"):
            tok = ops[0].strip()
            m = re.fullmatch(r"\$([0-9a-fA-F]+)(\.(w|l))?", tok)
            if not m:
                # `jsr (a0)` - through a pointer the routine computed. The
                # dispatcher takes an address either way; only the literal is
                # missing, and refusing these turns away every routine that
                # calls through a table.
                m2 = re.fullmatch(r"\((a\d)\)", tok)
                if not m2:
                    raise Bail(f"indirect call {tok!r}")
                where = self.reg_value(m2.group(1), 32).text
                self.flush()
                self.stmts.append(f"callRom({where}, 0x{nxt:05x});")
                self.stmts.append("if (halted()) return;")
                self.reg = {}
                self.after_call = True
                return
            target = int(m.group(1), 16)
            
            # The callee reads its arguments where the ROM put them: some on the
            # stack, some in registers. So everything this routine holds in a
            # local has to be back in the machine before control leaves, and
            # nothing may be assumed about it afterwards - the callee is free to
            # use any register, and several do.
            self.flush()
            self.stmts.append(f"callRom(0x{target:05x}, 0x{nxt:05x});")
            self.stmts.append("if (halted()) return;")
            self.reg = {}
            self.after_call = True
            return
        if b in ("jmp", "bra"):
            tok = ops[0].strip()
            m = re.fullmatch(r"\$([0-9a-fA-F]+)(\.(w|l))?", tok)
            if not m:
                # `jmp (a0)` or through a table - the dispatcher takes an
                # address either way, exactly as for an indirect call.
                self.flush()
                self.stmts.append(f"jumpRom({self.effective_address(tok)});")
                self.stmts.append("return;")
                return
            target = int(m.group(1), 16)
            # Arguments still on the stack are not a problem: a jump hands the
            # callee this frame, which is exactly how the ROM passes them on.
            self.flush()
            # A jump is not a call: it pushes no return address and hands the
            # callee the frame this routine was given, so the arguments the
            # original caller pushed are still where the callee expects them.
            # Calling instead puts a return address on top and shifts them all.
            self.stmts.append(f"jumpRom(0x{target:05x});")
            self.stmts.append("return;")
            return
        if b in ("subq", "suba", "sub", "subi") and ops[-1].strip() == "a7":
            # Reserving stack without pushing anything - `subq.w #4,a7` before
            # a call that writes its result into the gap. Only the add family
            # had a rule for a7, so this went through the ordinary address
            # arithmetic and made the stack pointer a local.
            n = num(ops[0])
            self.stmts.append(f"drop({-n});")
            self.pushed += n
            return
        if b in ("addq", "adda", "add", "lea") and ops[-1].strip() == "a7":
            # The ROM's own stack cleanup. It is not always one call's worth:
            # a routine can push, call, push, call and then drop both at the
            # end, so the arguments have to live on the stack exactly as long
            # as the ROM leaves them there.
            if b == "lea":
                m2 = re.fullmatch(r"(-?\$?[0-9a-fA-F]+)?\(a7\)", ops[0].strip())
                if not m2:
                    # `lea $3e32fe.l,a7` resets the stack outright rather than
                    # unwinding it, which is what the boot path does.
                    self.stmts.append(
                        f"setStackPointer({self.effective_address(ops[0])});")
                    self.pushed = 0
                    return
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
            # Sign-extended from eight bits to thirty-two. `moveq #$ff,d0` is
            # how this ROM loads -1, and storing the raw 255 gives a number
            # that is wrong by 4,294,967,040 and looks entirely plausible.
            v = num(ops[0]) & 0xff
            if v & 0x80:
                v -= 0x100
            self.write(ops[1], Expr(str(v), "imm"), 32)
            return
        if b == "clr":
            self.write(ops[0], Expr("0", "imm"), bits)
            return
        if b in ("add", "addq", "adda", "addi", "sub", "subq", "suba", "subi"):
            dst = ops[-1].strip()
            sign = "-" if b.startswith("sub") else "+"
            if dst in ADDR:
                # Address arithmetic is always on all 32 bits, and a word source
                # is sign-extended first. Reading the register at the
                # instruction's size instead - `adda.w d1,a0` as
                # `(a0 & 0xffff) + (d1 & 0xffff)` - throws away the top half of
                # the address and gets the sign of the offset wrong.
                src = self.read(ops[0], bits).text
                if bits == 16:
                    src = f"((({src}) << 16) >> 16)"
                elif bits == 8:
                    src = f"((({src}) << 24) >> 24)"
                self.write(dst, Expr(f"({self.reg_value(dst, 32).text} {sign} {src})"), 32)
                return
            cur = self.read(dst, bits)
            self.write(dst, Expr(f"({cur.text} {sign} {self.read(ops[0], bits).text})"), bits)
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
            # The 68000 takes the count modulo 64 and a count at or past the
            # operand's width shifts every bit out. JavaScript's shift operators
            # use only the low five bits of the count, so `x >> 40` becomes
            # `x >> 8` and the result is wrong in exactly the cases the chip
            # makes trivial. The count is clamped, not masked.
            c = self.temp(Expr(f"(({cnt.text}) & 63)", "expr"))
            if b in ("asl", "lsl"):
                expr = f"({c.text} >= {bits} ? 0 : (({cur.text}) << {c.text}))"
            elif b == "lsr":
                expr = f"({c.text} >= {bits} ? 0 : (({cur.text}) >>> {c.text}))"
            else:
                shift = 32 - bits
                signed = cur.text if bits == 32 else f"((({cur.text}) << {shift}) >> {shift})"
                expr = (f"({c.text} >= {bits} ? ((({signed}) < 0) ? -1 : 0)"
                        f" : (({signed}) >> {c.text}))")
            self.write(dst, Expr(expr), bits)
            return
        if b == "neg":
            _v, _dst = self.rmw(ops[0], bits)
            self.write(_dst, Expr(f"(0 - ({_v.text}))"), bits)
            return
        if b == "not":
            _v, _dst = self.rmw(ops[0], bits)
            mask = (1 << bits) - 1
            self.write(_dst, Expr(f"((~({_v.text})) & {mask})"), bits)
            return
        if b == "swap":
            v = self.read(ops[0], 32)
            self.write(ops[0], Expr(
                f"(((({v.text}) >>> 16) & 0xffff) | ((({v.text}) & 0xffff) << 16))"), 32)
            return
        if b in ("mulu", "muls"):
            src = self.read(ops[0], 16).text
            dst = ops[1]
            cur = self.read(dst, 16).text
            if b == "muls":
                src = f"((({src}) << 16) >> 16)"
                cur = f"((({cur}) << 16) >> 16)"
            self.write(dst, Expr(f"Math.imul({cur}, {src})"), 32)
            return
        if b == "stop":
            # A stopped machine is still a machine somebody looks at: the
            # crash screen dumps every register, and the frozen state the
            # step-state harness compares is read after the stop. The lifted
            # registers live in locals until something flushes them, so a
            # bare halt-and-return left every one of them at its entry value
            # - 0x19B06 reached its stop having walked a table and counted
            # down, and the machine afterwards showed the arguments it was
            # called with.
            self.flush()
            # With the address after the stop, because a stop is a wait rather
            # than an end: the chip halts until an interrupt arrives and then
            # carries on at the next instruction, charging cycles the whole
            # time it waits. The recompiler has always modelled that - it is
            # Machine.halt - and the lifted world only set the flag, so the two
            # clocks parted every time the game waited.
            at = getattr(self, "nxt", 0)
            self.stmts.append(f"halt(0x{at:05x});")
            self.stmts.append("return;")
            return
        if b == "lea":
            self.write(ops[1], Expr(self.effective_address(ops[0])), 32)
            return
        if b in ("divu", "divs"):
            # 32 / 16, quotient in the low word and remainder in the high one.
            # Division by zero traps on the 68000: the helper stacks the next
            # instruction and vectors through 0x14, and the guard emitted here
            # stops the lifted flow when the handler halts the machine - this
            # ROM's handler prints and stops, and running on would spill stale
            # shadow registers over the state the crash dump just wrote. The
            # divide-by-zero paths were invisible while the lifted helper
            # quietly returned the numerator; the oracle vectored, and the two
            # parted by an exception frame's worth of stack.
            src = self.read(ops[0], 16).text
            dst = ops[1]
            num32 = self.read(dst, 32).text
            if b == "divs":
                src = f"((({src}) << 16) >> 16)"
                num32 = f"(({num32}) | 0)"
            nxt = ins.address + ins.size
            # A trap boundary is a call boundary: the handler dumps and can
            # change registers, so the shadows go to the machine first and
            # come back after, exactly as around a callRom.
            self.flush()
            v = self.temp(Expr(
                f"div{'s' if b == 'divs' else 'u'}({num32}, {src}, 0x{nxt:05x})",
                "expr"))
            self.stmts.append("if (halted()) return;")
            self.reload()
            self.write(dst, v, 32)
            return
        if b in ("bset", "bclr", "bchg", "btst"):
            # The bit number is modulo 32 on a register and modulo 8 in memory,
            # and only the memory forms are byte-sized.
            wide = 32 if ops[1].strip() in DATA else 8
            n = self.read(ops[0], 32).text
            v, dst = self.rmw(ops[1], wide)
            bit = f"(1 << (({n}) & {wide - 1}))"
            if b == "btst":
                return                    # tests only; the flags belong to the
                                          # branching pass, which handles btst
                                          # itself before reaching here
            op = {"bset": "|", "bclr": "& ~", "bchg": "^"}[b]
            # Z comes from the bit *before* the change - and nothing here was
            # setting it. `bclr` left in Z whatever an earlier instruction had
            # put there, so the `beq` two instructions after
            # `bclr.b #5,$2(a3)` at 0xF1CE branched on a stale flag: the
            # decompiled run skipped the `jsr $F1FA` the chip makes, the loop
            # that call feeds never reached its exit, and the service-switch
            # pattern hung at frame 276 pushing the same return address for
            # ever. The recompiler had this right all along (m68kts.emit sets
            # m.z from the pre-modification value); only the lift dropped it.
            # The value has to be held before the write, hence the temporary.
            pre = self.temp(v)
            self.flags = ("cmp",
                          f"((({pre.text}) >>> (({n}) & {wide - 1})) & 1)",
                          "0", wide)
            self.flags_certain = True
            self.write(dst, Expr(f"((({pre.text}) {op}{bit}) >>> 0)"), wide)
            return
        if b == "exg":
            a, c = ops[0].strip(), ops[1].strip()
            va = self.temp(self.read(a, 32))
            vc = self.read(c, 32)
            self.write(a, vc, 32)
            self.write(c, va, 32)
            return
        if b in ("addx", "subx"):
            # X is the carry from the last arithmetic, which nothing here
            # tracks. The ROM uses these to widen a single add, where the
            # operands are registers and X is whatever the previous
            # instruction left - so it comes from the machine.
            src = self.read(ops[0], bits).text
            dst = ops[1]
            cur = self.read(dst, bits).text
            sign = "+" if b == "addx" else "-"
            self.write(dst, Expr(f"(({cur}) {sign} ({src}) {sign} extend())"), bits)
            return
        if b == "cmpm":
            self.read(ops[0], bits)                 # both post-increment
            self.read(ops[1], bits)
            return
        if b in ("tst", "cmp", "cmpi", "cmpa", "cmp2"):
            # Flags only. A single-block routine has no branch to read them,
            # and the branching pass models them itself - but the operands can
            # post-increment, so they still have to be evaluated.
            for tok in ops:
                self.read(tok, 32 if b == "cmpa" else bits)
            return
        if b in ("rol", "ror"):
            # The count is modulo 64 when it comes from a register, and the
            # rotate itself is modulo the operand width.
            if len(ops) == 1:
                cnt, dst = "1", ops[0]
            else:
                cnt, dst = self.read(ops[0], 32).text, ops[1]
            v = self.read(dst, bits).text
            self.write(dst, Expr(f"{b}{bits}({v}, {cnt})"), bits)
            return
        if b == "movep":
            # A register through every other byte of memory, for a device wired
            # to one half of the data bus. It is the only instruction whose
            # bytes are not contiguous, so nothing else here produces the right
            # addresses. Treating it as a no-op - on the assumption only the
            # unmodelled sound chips used it - left the palette, which is wired
            # exactly this way, never written at all: the game drew every frame
            # correctly in black.
            n = bits // 8
            src, dst = ops[0].strip(), ops[1].strip()
            if src in DATA:
                ea = self.temp(Expr(self.effective_address(dst), "expr")).text
                v = self.temp(self.read(src, 32)).text
                for i in range(n):
                    self.stmts.append(
                        f"store8({ea} + {i * 2}, {v} >>> {(n - 1 - i) * 8});")
                return
            if dst not in DATA:
                raise Bail(f"movep {ins.op_str!r}")
            ea = self.temp(Expr(self.effective_address(src), "expr")).text
            parts = " | ".join(f"(load8({ea} + {i * 2}) << {(n - 1 - i) * 8})"
                               for i in range(n))
            keep = "" if n == 4 else f"({self.read(dst, 32).text} & 0xffff0000) | "
            self.write(dst, Expr(f"(({keep}({parts})) >>> 0)"), 32)
            return
        if b == "rte":
            # Return from exception. The status register and the program
            # counter come back off the stack, and the stack has to be
            # balanced - but the resume is a JavaScript return, not a jump.
            # Every exception in the lifted world is entered by a call: the
            # interrupt poll at a block head calls the handler, and so does
            # `trap`. Jumping to the popped address instead asks the
            # dispatcher to enter mid-routine, which a decompiled function
            # cannot do - it worked only while the stacked address was zero,
            # and the census duly recorded a jump to 0x0. With a real address
            # stacked it fails loudly at 0x14510 instead, which is how this
            # was found.
            self.stmts.append("setSr(popWord());")
            self.flush()
            self.stmts.append("popLong();")
            self.stmts.append("return;")
            return
        if b == "reset":
            # Asserts the RESET line to the peripherals. The CPU carries on and
            # nothing here models the chips it would reset.
            return
        if b == "trap":
            # The handler runs inline through the dispatcher. If it halted the
            # machine - trap #0 in the exception stubs resolves to the halt
            # trampoline - the guard stops the lifted flow before it can spill
            # stale shadows over what the handler wrote; if it returned, the
            # flow continues at the next statement, which is the stacked
            # address.
            nxt = ins.address + ins.size
            self.flush()
            self.stmts.append(f"trap({num(ops[0])}, 0x{nxt:05x});")
            self.stmts.append("if (halted()) return;")
            self.reload()
            return
        raise Bail(f"no rule for {mn} {ins.op_str}")

    def effective_address(self, tok):
        """The address an operand names, whatever mode it uses.

        `pea` and `lea` both want exactly this and had separate half
        implementations that each understood a different subset of the modes.
        """
        tok = tok.strip()
        m = re.fullmatch(r"\$([0-9a-fA-F]+)(\.(w|l))?", tok)
        if m:
            a = int(m.group(1), 16)
            # Absolute short sign-extends. `$ffff.w` is 0xFFFFFFFF, not
            # 0x0000FFFF - one word reaches both the bottom of the address
            # space and the top. The suffix was captured here and thrown
            # away, so every high short address became a different place:
            # `pea $ffff.w` in fn_16af8 pushed 0x0000FFFF where the chip
            # pushes 0xFFFFFFFF, which is the whole of the service-switch
            # pattern's remaining write divergence. m68kts.abs_addr has had
            # this right from the start; only the lift dropped it.
            if m.group(3) == "w" and a & 0x8000:
                a = (a - 0x10000) & 0xFFFFFFFF
            return f"0x{a:x}"
        # pc-relative: capstone has already resolved it to an address
        m = re.fullmatch(r"\$([0-9a-fA-F]+)\(pc\)", tok)
        if m:
            return f"0x{int(m.group(1), 16):x}"
        m = re.fullmatch(r"\$([0-9a-fA-F]+)\(pc,\s*([ad]\d)\.(w|l)\)", tok)
        if m:
            idx = self.reg_value(m.group(2), 32).text
            idx = f"(({idx} << 16) >> 16)" if m.group(3) == "w" else f"({idx} | 0)"
            return f"(0x{int(m.group(1), 16):x} + {idx})"
        m = re.fullmatch(r"(-?\$?[0-9a-fA-F]+)?\((a\d),\s*([ad]\d)\.(w|l)\)", tok)
        if m:
            return self.indexed(m)
        m = re.fullmatch(r"(-?\$?[0-9a-fA-F]+)?\((a\d)\)", tok)
        if m:
            off = num(m.group(1)) if m.group(1) else 0
            base = self.reg_value(m.group(2), 32).text
            return base if off == 0 else f"({base} + {hex(off)})"
        raise Bail(f"address of {tok!r}")

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
            if e.kind == "reg" and e.text == r and r not in self.restored:
                continue                      # untouched: still the entry value
            out.append((r, e))
        return out

    def emit(self, addr, label):
        args = [p["name"] for p in self.order()]
        sig = ", ".join(f"{a}: number" for a in args)
        head = f"/** {label} */" if label else ""
        stmts = list(self.stmts)
        # The single-block pass has one block, so its whole cost is charged at
        # the top - same reason as the branching pass.
        # The routine's own address goes with the cost, so an interrupt taken
        # at this poll has a return address to stack - see blocks.py. The
        # registers this routine holds in locals go back to the machine first,
        # because the handler saves them with movem and would otherwise save
        # whatever the machine last held.
        if getattr(self, 'cost', 0):
            spill = "".join(f"setReg('{r}', {r}); "
                            for r in sorted(self.used_regs) if r != "a7")
            stmts.insert(0, f'if (tick({self.cost}, 0x{addr:05x})) '
                            f'{{ {spill}takeIrq(); }}')
        if getattr(self, "falls_through", False):
            # No terminator: the machine carries straight on into whatever
            # follows, so this does too. Several map entries are labels the ROM
            # jumps to rather than functions that return.
            for r, e in self.outputs():
                stmts.append(f"setReg('{r}', {e.text});")
            stmts.append(f"jumpRom(0x{self.hi:05x});")
            stmts.append("return;")
        # A routine that ended in a tail jump has already handed control away
        # and flushed what it held; anything after the return is dead.
        # ...but `rts` emits `return;` as well, and it is *not* a tail jump: the
        # routine hands control back with its registers still live, and the
        # caller - or the next entry the dispatcher reaches - reads them from
        # the machine. Skipping the spill there stranded every register a
        # returning routine computed inside a JavaScript local, which is how
        # `a3` arrived at 0x1378E as 0 where the chip had the watchdog pointer
        # it was given at 0x1397A. Only a jumpRom-then-return is already
        # flushed; anything else spills, and spills *before* the return rather
        # than after it, where it would be dead.
        tail_jump = (len(stmts) >= 2 and stmts[-1] == "return;"
                     and "jumpRom(" in stmts[-2])
        if not tail_jump:
            spill = [f"setReg('{r}', {e.text});" for r, e in self.outputs()]
            if stmts and stmts[-1] == "return;":
                stmts[-1:-1] = spill
            else:
                stmts.extend(spill)
        body = "\n".join("  " + s for s in stmts) or "  // nothing observable"
        return (f"{head}\nexport function {ident(addr)}({sig}): void {{\n{body}\n}}").strip()


TS_HEAD = """// Generated by romlab/decomp.py - do not edit by hand.
//
// Decompiled routines: recovered source, not transliterated machine code.
// Stack arguments have become parameters and registers have become expressions.
// Every function here is checked against the recompiled routine at the same
// address by decomp.test.ts, on random machine states, and none of it is
// trusted without that.

import { AddressError, PendingInterrupt, type Machine } from './machine';

let M: Machine;
/** Where a call inside a decompiled routine goes. The game runs on the
 *  decompiled routines, so this is the dispatcher below. The verifier points it
 *  at the recompiler instead, to prove one routine at a time rather than that
 *  routine and everything it reaches. */
let callee: (addr: number, m: Machine) => void;
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
  // 32 bits unsigned, always - an expression that overflowed on its way here
  // must not be stored as a number the machine can never produce.
  v = v >>> 0;
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
/** Whether the machine has halted. `stop` leaves it that way and nothing in
 *  the ROM runs afterwards, so decompiled code has to notice too. */
const halted = (): boolean => M.stopped;
// The status register is composed from the real flags, so it has to come from
// the machine rather than be tracked here.
const getSr = (): number => M.getSR();
// The X flag, for addx/subx, and division, which sets flags the machine owns.
const extend = (): number => (M.x ? 1 : 0);
// Quotient in the low word, remainder in the high one. A quotient too wide for
// the low word overflows: the 68000 sets V and leaves the destination alone,
// where truncating it would silently write a plausible wrong number.
// Dividing by zero is an exception, not an error: the chip stacks the next
// instruction and the status register and vectors through 0x14. The handler
// runs here through the dispatcher, the same shape as an interrupt at a
// block head. In this ROM the handler prints and halts, and the caller's
// `if (halted()) return` stops the lifted flow before it can spill stale
// shadows over the registers the crash dump just wrote; a handler that
// came back with rte would resume at the next instruction, which is exactly
// where the lifted flow continues.
const divZero = (next: number): void => {
  M.storePre('a7', 4, next, 32);
  M.storePre('a7', 2, M.getSR(), 16);
  call(M.load(0x14, 32), M);
};
const divu = (n: number, d: number, next: number): number => {
  if (d === 0) { divZero(next); return n; }
  const q = Math.floor((n >>> 0) / d);
  if (q > 0xffff) return n;
  return ((q & 0xffff) | (((n >>> 0) % d) << 16)) >>> 0;
};
const divs = (n: number, d: number, next: number): number => {
  if (d === 0) { divZero(next); return n; }
  const q = Math.trunc((n | 0) / d);
  if (q > 32767 || q < -32768) return n;
  return ((q & 0xffff) | (((n | 0) % d) << 16)) >>> 0;
};
const setSr = (v: number, at = 0): void => {
  // Lowering the mask lets a pending interrupt in as part of the instruction
  // that lowered it, and the machine says so by raising. There is nothing to
  // resume here - the write has happened - so the handler runs and returns.
  //
  // `at` is the instruction after this one, which is what the chip stacks:
  // the interrupt belongs to this instruction, so the address to come back to
  // is past it, not the head of the block the poll normally reports.
  if (at) M.next = at;
  try {
    M.setSR(v & 0xffff);
  } catch (e) {
    if (!(e instanceof PendingInterrupt)) throw e;
    if (M.clearOnTake) M.irqPending = 0;
    M.irqDepth += 1;
    try {
      call(M.interruptFrame(e.level), M);
    } finally {
      M.irqDepth -= 1;
      if (M.irqDepth === 0 && M.onIrqReturn) M.onIrqReturn();
    }
  }
};
// `move sr,dN` reads the real condition codes. Nothing in the lifted source
// keeps them, but whatever set them last is known at the point of the read, so
// they are computed there and handed to the machine, which composes the word.
const widthMask = (bits: number): number => (bits === 32 ? 0xffffffff : (1 << bits) - 1);
// A compare leaves X alone; a subtract sets it from the borrow. One helper
// each, because the difference is visible the moment a routine saves sr.
// `btst` touches Z and nothing else.
// A branch whose flags nothing here set - at a routine's entry, or straight
// after a call - is asking about the machine's real flags, which at that point
// are current precisely because the lifted code has not touched them.
const cc = (name: string): boolean => {
  switch (name) {
    case 'eq': return M.z; case 'ne': return !M.z;
    case 'mi': return M.n; case 'pl': return !M.n;
    case 'cs': return M.c; case 'cc': return !M.c;
    case 'vs': return M.v; case 'vc': return !M.v;
    case 'hi': return !M.c && !M.z; case 'ls': return M.c || M.z;
    case 'ge': return M.n === M.v; case 'lt': return M.n !== M.v;
    case 'gt': return !M.z && M.n === M.v; case 'le': return M.z || M.n !== M.v;
    default: throw new Error(`condition ${name}`);
  }
};
const setFlagsBit = (v: number, n: number, mask: number): void => {
  M.z = ((v >>> (n & mask)) & 1) === 0;
};
const setFlagsCmp = (a: number, b: number, bits: number): void => {
  const x = M.x; setFlagsSub(a, b, bits); M.x = x;
};
const setFlagsSub = (a: number, b: number, bits: number): void => {
  const mask = widthMask(bits); const sh = 32 - bits;
  const ua = (a & mask) >>> 0; const ub = (b & mask) >>> 0;
  const r = (ua - ub) & mask;
  const sa = (ua << sh) >> sh; const sb = (ub << sh) >> sh; const sr = (r << sh) >> sh;
  M.z = r === 0; M.n = sr < 0; M.c = ua < ub; M.x = M.c; M.v = (sa - sb) !== sr;
};
const setFlagsAdd = (a: number, b: number, bits: number): void => {
  const mask = widthMask(bits); const sh = 32 - bits;
  const ua = (a & mask) >>> 0; const ub = (b & mask) >>> 0;
  const wide = ua + ub; const r = wide & mask;
  const sa = (ua << sh) >> sh; const sb = (ub << sh) >> sh; const sr = (r << sh) >> sh;
  M.z = r === 0; M.n = sr < 0; M.c = wide > mask; M.x = M.c; M.v = (sa + sb) !== sr;
};
// X alone, from the last instruction that set it.
//
// X is the one condition code that outlives the instruction after it: a move,
// a compare or a logic op leaves it exactly as it was, so on the chip it can
// have been set by arithmetic long ago and several routines away. The lifted
// world computes its branches in JavaScript and only puts flags in the machine
// at a call boundary, from whatever set them last - and if that was a move, X
// never arrives at all. `move sr` then saves a word with X clear where the
// chip has it set, which is where all six input patterns' write streams parted
// company.
const setXAdd = (a: number, b: number, bits: number): void => {
  const mask = widthMask(bits);
  M.x = (((a & mask) >>> 0) + ((b & mask) >>> 0)) > mask;
};
const setXSub = (a: number, b: number, bits: number): void => {
  const mask = widthMask(bits);
  M.x = ((a & mask) >>> 0) < ((b & mask) >>> 0);
};
/** A shift's X is the last bit shifted out; a zero count leaves it alone. */
const setXShift = (out: number, count: number): void => {
  if (count !== 0) M.x = (out & 1) !== 0;
};
const movep = (v: number): void => { M.movep(v); };
// A trap is not a no-op: the chip stacks the next instruction and the status
// register and vectors through the table, and this ROM leans on it - TRAP #0's
// vector holds 0x18658, the continuation after the jsr that reached the
// printer, so for the exception stubs "trap #0" means "halt". The handler runs
// through the dispatcher like an interrupt at a block head; when it comes back
// the lifted flow continues at the next statement, which is exactly the
// address the frame carries.
const trap = (n: number, next: number): void => {
  M.trap(n);
  M.storePre('a7', 4, next, 32);
  M.storePre('a7', 2, M.getSR(), 16);
  call(M.load((32 + n) * 4, 32), M);
};
const rot = (v: number, c: number, bits: number, left: boolean): number => {
  const n = (c & 63) % bits;
  const mask = bits === 32 ? 0xffffffff : (1 << bits) - 1;
  const x = v & mask;
  if (n === 0) return x >>> 0;
  const r = left ? (x << n) | (x >>> (bits - n)) : (x >>> n) | (x << (bits - n));
  return (r & mask) >>> 0;
};
const rol8 = (v: number, c: number): number => rot(v, c, 8, true);
const rol16 = (v: number, c: number): number => rot(v, c, 16, true);
const rol32 = (v: number, c: number): number => rot(v, c, 32, true);
const ror8 = (v: number, c: number): number => rot(v, c, 8, false);
const ror16 = (v: number, c: number): number => rot(v, c, 16, false);
const ror32 = (v: number, c: number): number => rot(v, c, 32, false);

const callRom = (addr: number, ret = 0): void => {
  // The real return address, not a placeholder. `jsr` pushes the address of
  // the instruction after it, and ROM code reads that value off the stack -
  // one routine popped it straight into d2. A zero there is a wrong answer
  // that only shows up in routines that look at their own return address.
  M.storePre('a7', 4, ret, 32);
  // Popping the return address is the callee's business, because who does it
  // depends on which callee ran. A recompiled routine executes its own `rts`;
  // a decompiled one just returns, so the dispatcher pops for it. Doing it in
  // both places pops twice and shifts every argument still on the stack.
  callee(addr, M);
};
void load8; void load16; void load32; void store8; void store16; void store32;
void setXAdd; void setXSub; void setXShift;
/** Tail-jump to another routine: same stack, no return address.
 *
 *  Recorded rather than called, so the dispatcher below can carry on with it
 *  at the same depth. A chain of tail jumps is a loop on the chip; calling
 *  through would make it a stack of frames deep enough to overflow. */
// The last transfers before a budget blowout name the loop that blew it -
// dispatch cycles have no program counter to point at.
const __ring: number[] = [];
const __note = (a: number): void => {
  __ring.push(a);
  if (__ring.length > 12) __ring.shift();
};
const jumpRom = (addr: number): void => { __note(addr); M.jump = addr >>> 0; };
/** The machine's stack pointer, for routines that build a frame with `link`. */
const stackPointer = (): number => M.a7 >>> 0;
const setStackPointer = (v: number): void => { M.a7 = v >>> 0; };
const popLong = (): number => { const v = M.load(M.a7 >>> 0, 32); M.a7 = (M.a7 + 4) >>> 0; return v; };
const popWord = (): number => { const v = M.load(M.a7 >>> 0, 16); M.a7 = (M.a7 + 2) >>> 0; return v; };
/**
 * Charge a block's cycles and let an interrupt in.
 *
 * The recompiler does this per instruction and unwinds with an exception,
 * because it has to resume at a particular program counter inside a switch.
 * Decompiled code has no such place to resume: it is ordinary statements, and
 * the boundary between two of them is exactly as good as the boundary between
 * two instructions. So the handler runs here and returns, and the block carries
 * on. Without it nothing can ever interrupt a busy-wait - and the sound driver
 * spins on a byte that only an interrupt changes.
 */
const tick = (n: number, at = 0): boolean => {
  M.steps += 1;
  // Where the machine is, as far as the lifted world can say: the head of the
  // block about to run. `interruptFrame` stacks `next`, so without this every
  // exception frame the decompiled game pushed carried a program counter of
  // zero where the chip pushed a real address - seven bytes of difference per
  // interrupt, in the middle of the sound driver's busy-waits.
  if (at) { M.pc = at; M.next = at; }
  if (M.atPc) M.atPc(M.pc);
  // The same bound the machine enforces per instruction, charged per block:
  // several routines loop forever on arbitrary input, and an unbounded lifted
  // side turns a comparison harness into a hang. Composed runs set the budget
  // to MAX_SAFE_INTEGER and never feel this.
  if (M.steps > M.budget) {
    throw new Error('instruction budget exhausted after ' + M.steps + ' blocks; recent transfers ' + __ring.map((a) => a.toString(16)).join(' '));
  }
  // Whether an interrupt is waiting, rather than taking it here. The caller
  // has to put its registers back in the machine first, and only the caller
  // knows where they are - see takeIrq.
  //
  // Asked before this block's cycles are charged, which is what the recompiled
  // dispatcher does too: its `tick` runs before the instruction's own
  // `cycles +=`. Charging first put the decompiled run one block ahead on the
  // clock, so the frame boundary arrived at a different point and a loop that
  // spins until an interrupt comes stopped on a different iteration.
  const take = M.irqPending !== 0 && ((M.sr >> 8) & 7) < M.irqPending;
  M.cycles += n;
  return take;
};
/**
 * Take the interrupt the poll found.
 *
 * The handler's first act is `movem.l d2-d7/a2-a3,-(a7)`: it saves the
 * registers of whatever it interrupted. On the chip those are in the chip. In
 * the lifted world they are JavaScript locals, so the block head spills them
 * before calling in - otherwise the handler saves whatever the machine last
 * happened to hold, restores that afterwards, and the two runs' stacks differ
 * by eight longs every time an interrupt lands. The spill is emitted inside
 * the `if`, so it costs nothing on the blocks where no interrupt is waiting -
 * which is nearly all of them.
 */
const takeIrq = (): void => {
  const lvl = M.irqPending;
  if (M.clearOnTake) M.irqPending = 0;
  M.irqDepth += 1;
  try {
    call(M.interruptFrame(lvl), M);
  } finally {
    M.irqDepth -= 1;
    if (M.irqDepth === 0 && M.onIrqReturn) M.onIrqReturn();
  }
};
/** `stop` - the chip halts until an interrupt arrives, charging cycles while
 *  it waits, and then carries on at `at`. The same Machine.halt the recompiled
 *  dispatcher uses: modelling it as "set the flag and stop" made the lifted
 *  world skip the wait entirely, so the two ran different numbers of cycles
 *  every time the game stopped for one. */
const halt = (at = 0): void => { M.halt(at); };
void setReg; void getReg; void callRom; void jumpRom; void push; void drop;
void halted; void halt; void tick; void takeIrq;
let __sp = 0;
void stackPointer; void setStackPointer; void popLong; void __sp;
"""


DISPATCHER = """const BY_ADDR: Map<number, number> = new Map(DECOMPILED.map((d, i) => [d.at, i]));

/** Send calls made from inside decompiled routines somewhere else. */
export function useCallee(f: (addr: number, m: Machine) => void): void { callee = f; }

/** The default: run the decompiled routine, then pop the return address its
 *  implicit `rts` did not. */
const callDecompiled = (addr: number, m: Machine): void => {
  call(addr, m);
  m.a7 = (m.a7 + 4) >>> 0;
};

/**
 * Run the decompiled routine at `addr`.
 *
 * This is what the recompiled dispatcher used to be, and it does three things
 * that a plain function call does not. It marshals arguments, because the
 * 68000 has no calling convention and each routine decided for itself which
 * registers and stack slots it reads. It carries on after a tail jump at the
 * same depth, because a chain of them is a loop on the chip and calling
 * through would build a stack of frames instead. And it turns an odd word
 * access into the exception the chip takes, which cannot happen inside the
 * instruction that caused it.
 */
export function call(addr: number, m: Machine): void {
  if (!callee) callee = callDecompiled;
  if (m.stopped) return;
  const outer = M;
  M = m;
  try {
    let at = addr >>> 0;
    for (;;) {
      const found = BY_ADDR.get(at);
      if (found === undefined) {
        // Only ever outside the overlay: a call through an uninitialised
        // pointer into hardware space. An address inside it is real code that
        // failed to lift, and swallowing that hides the gap.
        if (m.stubMissing && at >= 0x20000) { m.missingCalls.push(at); return; }
        throw new Error('no decompiled routine at 0x' + at.toString(16));
      }
      const { fn, params } = DECOMPILED[found];
      const args: number[] = [];
      for (const p of params) {
        args.push(p.from === 'reg'
          ? (m as unknown as Record<string, number>)[p.name] >>> 0
          : m.load((m.a7 + p.off) >>> 0, 32));
      }
      m.jump = 0;
      try {
        if (m.onCall) {
          const before = m.a7 >>> 0;
          fn(...args);
          m.onCall(at, before, m.a7 >>> 0);
        } else {
          fn(...args);
        }
      } catch (e) {
        if (e instanceof PendingInterrupt) throw e;
        if (!(e instanceof AddressError)) throw e;
        call(m.addressErrorFrame(), m);
        return;
      }
      if (!m.jump) return;
      at = m.jump;
      m.jump = 0;
    }
  } finally {
    M = outer;
  }
}
"""


def emit_ts(rows):
    out = [TS_HEAD]
    index = []
    for at, src, params in sorted(rows):
        out.append(src)
        srcs = ", ".join(
            ("{ from: 'reg', name: '%s' }" % q["name"]) if q["from"] == "reg"
            else ("{ from: 'stack', off: %d }" % q["off"]) for q in params)
        index.append(f"  {{ at: 0x{at:05x}, fn: {ident(at)} as (...a: number[]) => void,"
                     f" params: [{srcs}] }},")
    # Every address this source polls an interrupt at - the head of each block,
    # taken from the `tick` calls just emitted, which is where they come from
    # in the first place. The recompiled dispatcher can be told to poll at
    # exactly these and nowhere else, and then both runs take the same
    # interrupt at the same instruction: a loop that spins until one arrives
    # stops on the same iteration in both, instead of leaving the comparison to
    # measure the schedule rather than the code.
    heads = sorted({int(m.group(1), 16)
                    for line in out
                    for m in re.finditer(r"tick\(\d+, 0x([0-9a-fA-F]+)\)", line)})
    out.append("/** Where the decompiled source polls for interrupts: one per")
    out.append(" *  basic block. See Machine.pollAt. */")
    out.append("export const POLL_AT: ReadonlySet<number> = new Set([")
    for i in range(0, len(heads), 8):
        out.append("  " + " ".join(f"0x{h:05x}," for h in heads[i:i + 8]))
    out.append("]);")
    out.append("")
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
    out.append(DISPATCHER)
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
        already = {a for a, _, _ in pure}
        for row in json.loads(blocks.read_text()):
            if "fn_" in row["src"].split("{", 1)[1]:
                continue
            if row["at"] in already:
                # Both passes can lift it now. The single-block form is the
                # simpler source, so it wins; this pass is the fallback.
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
