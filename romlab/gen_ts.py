"""Emit every ROM routine as TypeScript.

One file per address range so no single module is unmanageable, plus a dispatch
table so `call(addr, m)` reaches any routine - which is what the emitted jsr and
indirect jsr rely on.

Each function is a switch on the program counter. That is not the prettiest
shape, but it is the only one that handles branches backwards into the middle
of a routine, which the ROM does constantly.
"""
import json
import pathlib

import capstone

import m68kts

HERE = pathlib.Path(__file__).parent
OUT = HERE.parent / "frontend" / "src" / "rom"
# The program ROM is not all the code the game runs: it also calls a small
# routine in the board ROM at 0x140000, which the running port found by
# jumping to it. prog_ext.bin is the program image with that region laid in
# at its real address so the translator can disassemble it like any other.
UP = (HERE / "prog_ext.bin").read_bytes()
md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

BUCKETS = 12


def ident(name):
    out = []
    for ch in name:
        out.append(ch if ch.isalnum() else "_")
    s = "".join(out).strip("_")
    while "__" in s:
        s = s.replace("__", "_")
    return s or "routine"


def emit_function(entry, end, label):
    lines = []
    lines.append("/** %s */" % label.replace("*/", ""))
    # `at` lets the dispatcher enter part-way through: the ROM calls and jumps
    # into the middle of routines, and every address has a case already
    lines.append("export function fn_%05x(m: Machine, at = 0x%05x): void {"
                 % (entry, entry))
    lines.append("  let pc = at;")
    lines.append("  for (;;) {")
    # pass the program counter so a test can recognise an instruction
    # boundary by address rather than by counting to it
    # A halted chip stays halted. STOP set the flag but only returned from
    # its own function, so every caller carried on - which is how the exception
    # stubs ran off the end of their own message text instead of stopping.
    # The tick has to be inside the try. It is what raises an interrupt, and
    # raised outside it the exception leaves the routine altogether - the
    # dispatcher catches it, runs the handler and returns, and the routine it
    # abandoned never reaches its rts. Every caller then loses the four bytes
    # it pushed, and a few thousand instructions later a function pointer comes
    # back holding an argument.
    lines.append("    try {")
    lines.append("    m.tick(pc);")
    lines.append("    if (m.stopped) return;")
    lines.append("    switch (pc) {")
    addr = entry
    while addr < end:
        ins = next(md.disasm(UP[addr:addr + 16], addr, 1), None)
        if ins is None:
            addr += 2
            continue
        nxt = addr + ins.size
        try:
            body = m68kts.emit(ins, nxt)
        except Exception as exc:  # noqa: BLE001 - the emitter must never abort a build
            body = None
        if body is None:
            body = ("throw new Error('unsupported %s %s at 0x%05x');"
                    % (ins.mnemonic, (ins.op_str or "").replace("'", ""), addr))
        # the address after this instruction, which an address-error frame
        # has to push - the chip stacks the next instruction, not this one
        lines.append("      case 0x%05x: { m.next = 0x%05x; m.cycles += %d; %s } break;"
                     % (addr, addr + ins.size, m68kts.cycles(ins), body))
        addr = nxt
    # Falling out of a routine's range is normal: the boundaries come from call
    # targets, so a "routine" is often a label inside a longer stretch of code
    # that simply runs on. Continue in whichever routine covers the address.
    # Not a call. An address this routine has no case for is one the game
    # jumped to, and a jump pushes nothing - the chip's stack does not
    # grow. Calling would grow JavaScript's, and JavaScript does not
    # eliminate tail calls, so a loop that jumps between two routines
    # runs the stack out while the 68000's stays flat. Hand the address
    # back to the dispatcher, which loops.
    lines.append("      default: m.jump = pc; return;")
    lines.append("    }")
    # An interrupt raised by the tick above is taken here, not at the
    # dispatcher: the routine has to carry on afterwards. The chip resumes the
    # instruction it had not started, and the switch does that by going round
    # again with pc unchanged.
    lines.append("    } catch (e) {")
    lines.append("      if (!(e instanceof PendingInterrupt)) throw e;")
    lines.append("      if (e.afterInstruction) pc = m.next;")
    # Counted so a harness can tell when a handler is running. The two
    # dispatchers enter one at different instants by design, and a comparison
    # made while either is inside is a comparison of two different moments.
    lines.append("      m.irqDepth += 1;")
    lines.append("      try { call(m.interruptFrame(e.level), m); }")
    lines.append("      finally { m.irqDepth -= 1;")
    lines.append("        if (m.irqDepth === 0 && m.onIrqReturn) m.onIrqReturn(); }")
    lines.append("    }")
    lines.append("  }")
    lines.append("}")
    return "\n".join(lines)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    facts = json.loads((HERE / "out" / "facts.json").read_text())
    names = json.loads((HERE / "out" / "names.json").read_text())["names"]
    funcs = sorted((a, b) for a, b in facts["funcs"])
    label = {int(k, 16): v for k, v in names.items()}

    per = (len(funcs) + BUCKETS - 1) // BUCKETS
    written = []
    for i in range(BUCKETS):
        chunk = funcs[i * per:(i + 1) * per]
        if not chunk:
            continue
        path = OUT / ("routines%02d.ts" % i)
        body = ["// Generated by romlab/gen_ts.py - do not edit by hand.",
                "// Routines 0x%05x - 0x%05x of the Rampart program overlay."
                % (chunk[0][0], chunk[-1][1]),
                "",
                "import { PendingInterrupt, type Machine } from './machine';",
                "import { call } from './dispatch';",
                ""]
        for a, b in chunk:
            body.append(emit_function(a, b, label.get(a, "routine")))
            body.append("")
        path.write_text("\n".join(body), encoding="utf-8")
        written.append((path.name, len(chunk)))

    # dispatch table: address -> routine
    d = ["// Generated by romlab/gen_ts.py - do not edit by hand.",
         "import { AddressError, PendingInterrupt, type Machine } from './machine';"]
    for i, (fname, _) in enumerate(written):
        d.append("import * as r%02d from './%s';" % (i, fname[:-3]))
    d.append("")
    d.append("type Routine = (m: Machine, at?: number) => void;")
    d.append("")
    d.append("/** Routine entry addresses, ascending, with their functions. */")
    d.append("const STARTS: number[] = [")
    idx = 0
    starts = []
    for i in range(BUCKETS):
        chunk = funcs[i * per:(i + 1) * per]
        if not chunk:
            continue
        for a, b in chunk:
            starts.append((a, b, idx))
        idx += 1
    starts.sort()
    for a, _, _ in starts:
        d.append("  0x%05x," % a)
    d.append("];")
    d.append("const ENDS: number[] = [")
    for _, b, _ in starts:
        d.append("  0x%05x," % b)
    d.append("];")
    d.append("const FNS: Routine[] = [")
    for a, _, bucket in starts:
        d.append("  r%02d.fn_%05x," % (bucket, a))
    d.append("];")
    d.append("")
    d.append("/**")
    d.append(" * Call by ROM address. The address need not be a routine's first")
    d.append(" * instruction: the ROM jumps into the middle of routines, so this finds")
    d.append(" * the routine containing the address and enters it there.")
    d.append(" */")
    d.append("/** Run one routine on the lift instead. The mirror of decompiled.ts's")
    d.append(" *  useOracle: with both set, a bisection can isolate a SINGLE routine")
    d.append(" *  rather than a whole subtree, because each side hands its callees")
    d.append(" *  back to the other. Without it, routing an address to either")
    d.append(" *  dispatcher takes everything that address calls with it, which is")
    d.append(" *  how a subtree localisation came to be reported as a routine one. */")
    d.append("let viaLift: { pick: (a: number) => boolean; run: (a: number, m: Machine) => void } | null = null;")
    d.append("export function useLift(")
    d.append("  o: { pick: (a: number) => boolean; run: (a: number, m: Machine) => void } | null): void {")
    d.append("  viaLift = o;")
    d.append("}")
    d.append("")
    d.append("export function call(addr: number, m: Machine): void {")
    d.append("  if (viaLift && viaLift.pick(addr >>> 0)) { viaLift.run(addr >>> 0, m); return; }")
    d.append("  // a halted chip does not start another routine")
    d.append("  if (m.stopped) return;")
    d.append("  let at = addr >>> 0;")
    d.append("  // A routine that runs off its own end has jumped, not called.")
    d.append("  // Continuing here keeps that flat, the way it is on the chip.")
    d.append("  for (;;) {")
    d.append("  try {")
    d.append("  const a = at;")
    d.append("  let lo = 0;")
    d.append("  let hi = STARTS.length - 1;")
    d.append("  let found = -1;")
    d.append("  while (lo <= hi) {")
    d.append("    const mid = (lo + hi) >> 1;")
    d.append("    if (STARTS[mid] <= a) { found = mid; lo = mid + 1; } else { hi = mid - 1; }")
    d.append("  }")
    d.append("  if (found < 0 || a >= ENDS[found]) {")
    d.append("    // stubbing only ever applies outside the overlay - a call")
    d.append("    // through an uninitialised pointer into hardware space. An")
    d.append("    // address inside the overlay is real code that failed to get")
    d.append("    // ported, and swallowing it hides the gap.")
    d.append("    if (m.stubMissing && a >= 0x20000) { m.missingCalls.push(a); return; }")
    d.append("    throw new Error('no routine covers 0x' + a.toString(16));")
    d.append("  }")
    # A hook around the call itself, so a caller can see the stack pointer on
    # the way in and on the way out. A routine that does not balance it shows
    # up here by name instead of as a wrong value several thousand
    # instructions later.
    d.append("  m.jump = 0;")
    d.append("  if (m.onCall) {")
    d.append("    const before = m.a7 >>> 0;")
    d.append("    FNS[found](m, a);")
    d.append("    m.onCall(a, before, m.a7 >>> 0);")
    d.append("  } else {")
    d.append("    FNS[found](m, a);")
    d.append("  }")
    d.append("  if (!m.jump) return;")
    d.append("  at = m.jump; m.jump = 0;")
    d.append("  continue;")
    d.append("  } catch (e) {")
    d.append("    // An odd word access is an address error: the chip stacks a")
    d.append("    // seven-word frame and vectors through 0x0C. The transfer of")
    d.append("    // control cannot happen inside the instruction, so it is")
    d.append("    // raised there and turned into the exception here.")
    # Not caught here: an interrupt is taken inside the routine that was
    # running, which resumes afterwards. Handling it at this level would
    # abandon that routine.
    d.append("    if (e instanceof PendingInterrupt) throw e;")
    d.append("    if (!(e instanceof AddressError)) throw e;")
    d.append("    call(m.addressErrorFrame(), m);")
    d.append("    return;")
    d.append("  }")
    d.append("  }")
    d.append("}")
    d.append("")
    d.append("export const ROUTINE_COUNT = %d;" % len(funcs))
    (OUT / "dispatch.ts").write_text("\n".join(d), encoding="utf-8")

    total = sum(n for _, n in written)
    print("routines emitted: %d across %d files" % (total, len(written)))
    for n, c in written:
        print("   %-16s %d" % (n, c))


if __name__ == "__main__":
    main()
