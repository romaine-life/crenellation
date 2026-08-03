"""Name a register parameter after the one thing the routine does with it.

`stackroles.py` does this for stack slots; the same evidence exists for
registers and is easier to read, because a register needs no offset model - it
is named in the operand text.

Two roles only, and both are decided from EVERY use in the extent rather than
the first, because the first use of a pointer is often the load that puts it
somewhere else:

  ptr     some instruction dereferences it - `(a3)`, `(a3)+`, `-(a3)`,
          `$4(a3)`. Whatever else happens to it, it is an address.
  index   it appears inside another register's indexed addressing -
          `(a0, d1.l)` - and is never dereferenced itself.

Everything else is left alone. "Used in arithmetic" is 339 of the 439 left and
says nothing a reader could not see; `roles.py`'s vocabulary has `count`,
`limit` and the rest for the shapes that do say something, and whylimit.py
counts what happens when one of those is handed out on thin evidence - 91
parameters called `limit` whose only comparison is against zero.

A register that is killed before anything reads it is deadregs.py's business
and is skipped here: `unused` is a better name than `ptr` for a pointer the
routine builds itself, and running deadregs first is what keeps the two apart.

    python3 regroles.py            # report only
    python3 regroles.py --write    # write them to params.curated.json
"""
import collections
import json
import re
import sys

import capstone

import deadregs as D


def main():
    write = "--write" in sys.argv
    funcs = json.loads(D.FACTS.read_text())["funcs"]
    src = D.SRC.read_text(encoding="utf-8")
    sig = {m.group(1): m.group(2) for m in D.FUNC.finditer(src)}
    image = D.IMAGE.read_bytes()
    md = capstone.Cs(capstone.CS_ARCH_M68K,
                     capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

    def extent(a):
        for lo, hi in funcs:
            if lo <= a < hi:
                return lo, hi
        return a, a + 64

    bins, found = collections.Counter(), {}
    for m in D.ENTRY.finditer(src):
        a, fn = int(m.group(1), 16), m.group(2)
        names = [p.strip().split(":")[0].strip()
                 for p in sig.get(fn, "").split(",") if p.strip()]
        slots = D.SOURCE.findall(m.group(3))
        if len(slots) != len(names):
            continue
        want = {r for (r, _), n in zip(slots, names)
                if r and D.UNNAMED.match(n.rstrip("_"))}
        if not want:
            continue
        lo, hi = extent(a)
        line = list(md.disasm(image[lo:hi], lo))
        for reg in sorted(want):
            uses = [i for i in line if D.mentions(i, reg)
                    and not i.mnemonic.startswith("movem")]
            if not uses:
                continue
            deref = [i for i in uses
                     if re.search(r"[-(]?\(%s\)" % reg, i.op_str)
                     or re.search(r"\(%s\)\+" % reg, i.op_str)
                     or re.search(r"\(%s\)" % reg, i.op_str)]
            index = [i for i in uses if re.search(r"\(a\d, ?%s" % reg,
                                                  i.op_str)]
            if deref:
                role, at = "ptr", deref[0]
            elif index:
                role, at = "index", index[0]
            else:
                bins["no role"] += 1
                continue
            bins[role] += 1
            found.setdefault(a, {})[reg] = (role, at)

    print(f"{sum(bins.values())} unnamed register parameters")
    for k, v in bins.most_common():
        print(f"{v:5}  {k}")
    if not write:
        print("\n(report only; pass --write to put them in "
              "params.curated.json)")
        return

    import familyparams as F
    reached = 0
    for a, regs in sorted(found.items()):
        names, seen = {}, collections.Counter()
        for reg, (role, at) in sorted(regs.items()):
            seen[role] += 1
            n = seen[role]
            names[reg] = {
                "name": role + ("" if n == 1 else str(n)),
                "why": f"0x{at.address:05x} is `{at.mnemonic} {at.op_str}` -"
                       + (" the register is dereferenced, so it holds an"
                          " address." if role == "ptr" else
                          " the register appears inside another register's"
                          " indexed addressing and is never dereferenced"
                          " itself, so it holds an index.")
                       + " Found by regroles.py, from every use in the"
                         " routine's extent rather than the first.",
            }
        r, _ = F.apply(a, names, only=True)
        reached += r
    print(f"\nwrote names for {reached} entries")


if __name__ == "__main__":
    main()
