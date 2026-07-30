"""The byte-level census: every byte of the program image gets a verdict.

code     - inside a facts.json routine (recompiled)
data     - inside a named data run (datanames.json), or an analyzed but
           unnamed one (dataruns.json)
unknown  - nothing claims it; each unknown run gets an evidence bundle so the
           verdict that follows is a measurement, not a guess

The image is the CPU's view: the committed rom.bin, which prog_upper.bin and
prog_ext.bin's overlay both match byte for byte. prog_main.bin is a different
build of the program (every vector's low word disagrees) and is not used.
The 0x140000 board region comes from prog_ext.bin; the 0x500000 board region
from io-baseline.bin, which stores it at file offset 0x44000.

Evidence gathered for an unknown run:
- every control transfer into it from recompiled code (jsr/jmp/bsr/bcc,
  pc-relative lea continuations, jump-table sites and their targets)
- every aligned 32-bit pointer anywhere in the image that lands in it
- opcode-marker density, linear-disassembly coverage from the run's start,
  printable-text ratio, zero/0xFFFF fill

Usage: python3 census_image.py [--lab DIR] [--rom FILE] [--json FILE]
--lab defaults to this script's directory (the main checkout is the only
place out/ and the binaries exist); --rom defaults to the committed
frontend/src/rom/rom.bin next to the lab.
"""
import argparse
import json
import pathlib
import re
import struct

import capstone

TARGET = re.compile(r"^\$([0-9a-fA-F]+)(?:\.[wl])?$")
PCREL = re.compile(r"\$([0-9a-fA-F]+)\(pc\)")
JMPIDX = re.compile(r"^\$([0-9a-fA-F]+)\((?:pc),\s*d\d\.w\)$")
BRANCH = ("jsr", "jmp", "bsr", "bra", "beq", "bne", "bcs", "bcc", "bmi",
          "bpl", "bvs", "bvc", "blt", "bge", "ble", "bgt", "bls", "bhi")
# rts / link / movem-save / unlk / movem-restore
MARKERS = (0x4E75, 0x4E56, 0x48E7, 0x4E5E, 0x4CDF)

REGIONS = [
    ("overlay", 0x00000, 0x20000),
    ("upper", 0x20000, 0x100000),
    ("board140", 0x140000, 0x180000),
    ("board500", 0x500000, 0x520000),
]


class Image:
    """The composite CPU view over the four ROM regions."""

    def __init__(self, rom, ext, io):
        self.rom = rom
        self.ext = ext
        self.io = io

    def read(self, a, n):
        end = a + n
        if end <= 0x100000:
            return self.rom[a:end]
        if 0x140000 <= a and end <= 0x180000:
            return self.ext[a:end]
        if 0x500000 <= a and end <= 0x520000:
            off = a - 0x500000 + 0x44000
            return self.io[off:off + n]
        return b""

    def word(self, a):
        b = self.read(a, 2)
        return struct.unpack(">H", b)[0] if len(b) == 2 else None

    def long(self, a):
        b = self.read(a, 4)
        return struct.unpack(">I", b)[0] if len(b) == 4 else None


def in_regions(a):
    return any(lo <= a < hi for _, lo, hi in REGIONS)


def inside(a, ranges):
    return any(lo <= a < hi for lo, hi in ranges)


def code_refs(md, img, funcs):
    """Every control transfer out of recompiled code, with its source."""
    refs = []          # (src, kind, target)
    tables = []        # (site, base, targets, table_end)
    for a, b in funcs:
        addr = a
        while addr < b:
            ins = next(md.disasm(img.read(addr, 16), addr, 1), None)
            if ins is None:
                addr += 2
                continue
            op = (ins.op_str or "").strip()
            if ins.mnemonic.startswith("jmp"):
                m = JMPIDX.match(op)
                if m:
                    base = int(m.group(1), 16)
                    tg, tend = jump_table(img, base)
                    tables.append((ins.address, base, tg, tend))
                    for t in tg:
                        refs.append((ins.address, "jumptable", t))
                    addr += ins.size
                    continue
            mnem = ins.mnemonic.split(".")[0]
            if mnem in BRANCH:
                m = TARGET.match(op)
                if m:
                    refs.append((ins.address, mnem, int(m.group(1), 16)))
            elif mnem == "lea":
                m = PCREL.search(op)
                if m:
                    refs.append((ins.address, "lea-pc", int(m.group(1), 16)))
            addr += ins.size
    return refs, tables


def jump_table(img, base):
    """Bound a pc-relative offset table by its own contents (jumptables.py)."""
    targets = []
    end = base + 0x400
    i = base
    while i < end:
        w = img.read(i, 2)
        if len(w) < 2:
            break
        off = struct.unpack(">h", w)[0]
        t = base + off
        # an odd target cannot be 68000 code: the word being read is the
        # table's own bytes, not an offset, so the table ended
        if t < 0 or (t & 1) or not in_regions(t) or off == 0:
            break
        if t > base:
            end = min(end, t)
        targets.append(t)
        i += 2
    return sorted(set(targets)), i


def pointer_scan(img, interesting):
    """Aligned 32-bit values anywhere in the image that land in a run."""
    import bisect
    runs = sorted(interesting)
    starts = [r[0] for r in runs]
    hits = {}
    for name, lo, hi in REGIONS:
        buf = img.read(lo, hi - lo)
        for off in range(0, len(buf) - 4, 2):
            v = struct.unpack_from(">I", buf, off)[0]
            i = bisect.bisect_right(starts, v) - 1
            if i >= 0 and runs[i][0] <= v < runs[i][1]:
                hits.setdefault(runs[i], []).append((lo + off, v))
    return hits


def disasm_coverage(md, img, a, b):
    """How much of [a,b) a linear disassembly from a accepts, and how it ends."""
    buf = img.read(a, b - a)
    off = 0
    bad = 0
    last = None
    while off < len(buf):
        ins = next(md.disasm(buf[off:off + 16], a + off, 1), None)
        if ins is None:
            bad += 2
            off += 2
            last = None
            continue
        last = ins.mnemonic
        off += ins.size
    return 100.0 * (b - a - bad) / max(1, b - a), last


def run_stats(img, a, b):
    buf = img.read(a, b - a)
    zeros = ff = printable = markers = 0
    for c in buf:
        if c == 0:
            zeros += 1
        elif c == 0xFF:
            ff += 1
        if 0x20 <= c < 0x7F:
            printable += 1
    for off in range(0, len(buf) - 1, 2):
        if struct.unpack_from(">H", buf, off)[0] in MARKERS:
            markers += 1
    n = max(1, b - a)
    return {"zeros": round(zeros / n, 3), "ff": round(ff / n, 3),
            "printable": round(printable / n, 3),
            "markers_per_100b": round(100.0 * markers / n, 2)}


def main():
    here = pathlib.Path(__file__).parent
    ap = argparse.ArgumentParser()
    ap.add_argument("--lab", type=pathlib.Path, default=here)
    ap.add_argument("--rom", type=pathlib.Path, default=None)
    ap.add_argument("--json", type=pathlib.Path, default=None)
    args = ap.parse_args()
    lab = args.lab
    rompath = args.rom or (lab.parent / "frontend" / "src" / "rom" / "rom.bin")
    iopath = rompath.parent / "io-baseline.bin"

    img = Image(rompath.read_bytes(), (lab / "prog_ext.bin").read_bytes(),
                iopath.read_bytes())
    md = capstone.Cs(capstone.CS_ARCH_M68K,
                     capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)

    facts = json.loads((lab / "out" / "facts.json").read_text())
    funcs = sorted((a, b) for a, b in facts["funcs"])
    named = [(d["a"], d["b"], d["name"]) for d in
             json.loads((lab / "out" / "datanames.json").read_text())]
    runs = [(d["a"], d["b"]) for d in
            json.loads((lab / "out" / "dataruns.json").read_text())]
    # region-level verdicts read and recorded in reviewed_entries.json: the
    # upper image and the board regions are data by judged evidence, minus
    # whatever code islands the function map carries inside them
    rev_path = pathlib.Path(__file__).parent / "reviewed_entries.json"
    rev = json.loads(rev_path.read_text()) if rev_path.exists() else {}
    judged_ranges = [(int(r["lo"], 16), int(r["hi"], 16))
                     for r in rev.get("ranges", [])
                     if r.get("verdict") == "data"]

    # byte-level verdicts, code winning over data claims; disagreements are
    # reported rather than silently resolved
    CODE, NAMED, RUN = 1, 2, 3
    verdict = {}
    for name, lo, hi in REGIONS:
        verdict[name] = bytearray(hi - lo)
    def paint(a, b, v):
        conflicts = []
        for name, lo, hi in REGIONS:
            s, e = max(a, lo), min(b, hi)
            for i in range(s, e):
                cur = verdict[name][i - lo]
                if cur and cur != v:
                    conflicts.append(i)
                else:
                    verdict[name][i - lo] = v
        return conflicts

    # datanames and dataruns both describe the complement of the code map, so
    # a byte claimed by both is agreement, not conflict; only a data claim on
    # a code byte is a real dispute
    overlap = {"code_vs_named": 0, "code_vs_run": 0}
    for a, b in funcs:
        paint(a, b, CODE)
    for a, b, _ in named:
        overlap["code_vs_named"] += sum(1 for i in paint(a, b, NAMED)
                                        if inside(i, funcs))
    for a, b in runs:
        overlap["code_vs_run"] += sum(1 for i in paint(a, b, RUN)
                                      if inside(i, funcs))
    for a, b in judged_ranges:
        paint(a, b, NAMED)

    # unknown runs
    unknown = []
    for name, lo, hi in REGIONS:
        v = verdict[name]
        i = 0
        while i < len(v):
            if v[i] == 0:
                j = i
                while j < len(v) and v[j] == 0:
                    j += 1
                unknown.append((lo + i, lo + j))
                i = j
            else:
                i += 1

    # non-code runs (data-claimed or unknown) all get the same scrutiny: a
    # data verdict is a measurement here, not an inheritance
    noncode = []
    for name, lo, hi in REGIONS:
        v = verdict[name]
        i = 0
        while i < len(v):
            if v[i] != CODE:
                j = i
                while j < len(v) and v[j] != CODE:
                    j += 1
                noncode.append((lo + i, lo + j))
                i = j
            else:
                i += 1

    refs, tables = code_refs(md, img, funcs)
    ptr_hits = pointer_scan(img, unknown)

    refs_into = {}
    for src, kind, t in refs:
        for (ra, rb) in unknown:
            if ra <= t < rb:
                refs_into.setdefault((ra, rb), []).append((src, kind, t))

    # the misclassification alarm: a control transfer from live code into a
    # byte no routine covers is code the port cannot run, wherever it lands
    alarms = []
    for src, kind, t in refs:
        if kind == "lea-pc":
            continue
        covered = any(a <= t < b for a, b in funcs)
        if not covered and in_regions(t):
            alarms.append((src, kind, t))

    # a suspect that has been read and judged in reviewed_entries.json is
    # adjudicated: it stays in the record with its verdict, out of the alarm
    reviewed_path = pathlib.Path(__file__).parent / "reviewed_entries.json"
    reviewed = json.loads(reviewed_path.read_text()) if reviewed_path.exists() else {}
    judged = {int(k, 16): v["verdict"] for k, v in reviewed.items()
              if isinstance(v, dict) and "verdict" in v}

    # per-run evidence for every non-code run in the overlay and board140,
    # where code could plausibly hide; the upper image and board500 are
    # reported as single regions
    suspects = []
    for (a, b) in noncode:
        if b - a < 4 or a >= 0x20000 and not (0x140000 <= a < 0x180000):
            continue
        stats = run_stats(img, a, b)
        inbound = [(s, k, t) for s, k, t in refs
                   if a <= t < b and k != "lea-pc"]
        if stats["markers_per_100b"] >= 0.8 or inbound:
            suspects.append({"a": a, "b": b, "n": b - a, "stats": stats,
                             "verdict": judged.get(a),
                             "inbound": [{"src": s, "kind": k, "target": t}
                                         for s, k, t in inbound]})

    report = []
    for (a, b) in unknown:
        stats = run_stats(img, a, b)
        cov, last = disasm_coverage(md, img, a, b)
        entry = {
            "a": a, "b": b, "n": b - a,
            "hex_head": img.read(a, 16).hex(),
            "stats": stats,
            "disasm_pct": round(cov, 1), "disasm_last": last,
            "code_refs": [{"src": s, "kind": k, "target": t}
                          for s, k, t in refs_into.get((a, b), [])],
            "ptr_refs": [{"at": p, "value": v}
                         for p, v in ptr_hits.get((a, b), [])[:40]],
            "ptr_ref_count": len(ptr_hits.get((a, b), [])),
        }
        report.append(entry)

    total_unknown = sum(e["n"] for e in report)
    by_region = {}
    for name, lo, hi in REGIONS:
        u = sum(e["n"] for e in report if lo <= e["a"] < hi)
        c = sum(1 for x in verdict[name] if x == CODE)
        d = sum(1 for x in verdict[name] if x in (NAMED, RUN))
        by_region[name] = {"size": hi - lo, "code": c, "data": d, "unknown": u}

    print("=== census of the program image ===")
    for name, lo, hi in REGIONS:
        r = by_region[name]
        print(f"{name:9s} {lo:06x}-{hi:06x}: code {r['code']:7d}  "
              f"data {r['data']:7d}  unknown {r['unknown']:7d}  "
              f"of {r['size']}")
    print(f"overlap conflicts: {overlap}")
    print(f"unknown runs: {len(report)}, {total_unknown} bytes")
    print(f"misclassification alarms (branch into uncovered byte): {len(alarms)}")
    for src, kind, t in alarms[:20]:
        print(f"   {kind} from {src:06x} into {t:06x}")
    fresh = [s for s in suspects if not s["verdict"]]
    print(f"suspect data runs (markers >= 0.8/100B or inbound transfer): "
          f"{len(fresh)} unjudged, {len(suspects) - len(fresh)} adjudicated")
    for s in sorted(suspects, key=lambda s: -s['n'])[:20]:
        st = s["stats"]
        tag = f"  [{s['verdict']}]" if s["verdict"] else ""
        print(f"   {s['a']:06x}-{s['b']:06x} {s['n']:6d}B  markers {st['markers_per_100b']:5.2f}"
              f"  text {st['printable']:.2f}  inbound {len(s['inbound'])}{tag}")
        for r in s["inbound"][:4]:
            print(f"      <- {r['kind']} from {r['src']:06x} to {r['target']:06x}")
    print()
    for e in sorted(report, key=lambda e: -e["n"])[:40]:
        s = e["stats"]
        tag = []
        if e["code_refs"]:
            tag.append(f"{len(e['code_refs'])} code refs")
        if e["ptr_ref_count"]:
            tag.append(f"{e['ptr_ref_count']} ptr refs")
        print(f"{e['a']:06x}-{e['b']:06x} {e['n']:6d}B  "
              f"markers {s['markers_per_100b']:5.2f}  disasm {e['disasm_pct']:5.1f}%  "
              f"text {s['printable']:.2f}  zeros {s['zeros']:.2f}  "
              f"{', '.join(tag)}")
        for r in e["code_refs"][:6]:
            print(f"     <- {r['kind']} from {r['src']:06x} to {r['target']:06x}")

    out = args.json or (lab / "out" / "census.json")
    json.dump({"regions": by_region, "overlap": overlap, "unknown": report,
               "alarms": [{"src": s, "kind": k, "target": t}
                          for s, k, t in alarms],
               "suspects": suspects,
               "tables": [{"site": s, "base": bb, "targets": t, "end": e}
                          for s, bb, t, e in tables]},
              open(out, "w"), indent=1)
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
