"""Fold the recaptured step-state session into the frontend's fixtures.

The original capture session's baselines cannot be reproduced: MAME writes
nvram back on every clean exit, so nvram_clean drifted one bookkeeping byte
at a time across every run since, and the frozen EEPROM at frame 2400
includes boot-time counter increments on top of whatever the file held. The
recapture therefore replaces the whole set - log, baselines, entry list -
with one self-consistent session: every run starts from the reconstructed
EEPROM (romlab/eeprom-original.bin restored before each), so every run
freezes the identical machine.

Gates, in order:
1. every (shape, steps) log finished with its done-line and covers every
   entry in entries-new.txt
2. the baselines the last run wrote equal the copies taken after the first
   run - all 32 runs froze the same machine, or nothing is believed
3. only then are stepstate.log, step-*-baseline.bin, io-track.bin and
   entries.txt replaced in frontend/src/rom

Run stepstate.test.ts afterwards; verified.json is rebuilt from its result.
"""
import pathlib
import sys

STEP = pathlib.Path("D:/repos/crenellation/romlab/out/step")
FRONT = pathlib.Path(__file__).parent.parent / "frontend" / "src" / "rom"
SHAPES = [0, 1, 2, 3]
STEPS = [1, 2, 3, 5, 10, 20, 60, 200]


def main():
    entries = [line.strip() for line in
               (STEP / "entries-new.txt").read_text().splitlines() if line.strip()]
    want = {int(e, 16) for e in entries}

    lines = []
    for shape in SHAPES:
        for n in STEPS:
            p = STEP / f"sn{shape}-{n}.log"
            if not p.exists():
                sys.exit(f"missing {p.name} - the matrix has not finished")
            text = p.read_text().splitlines()
            if not text or not text[-1].startswith("done"):
                sys.exit(f"{p.name} has no done-line - that run died early")
            covered = set()
            for line in text:
                parts = line.split()
                if parts and parts[0] in ("S", "X"):
                    covered.add(int(parts[1], 16))
                    lines.append(line)
            if covered != want:
                sys.exit(f"{p.name} covered {len(covered)} of {len(want)} entries")

    # io-baseline2 replaces step-io-baseline.bin only: io-baseline.bin seeds
    # the composed tests' board and belongs to the original session's world
    for name, committed in [("ram-baseline2.bin", "step-ram-baseline.bin"),
                            ("pf-baseline2.bin", "step-pf-baseline.bin"),
                            ("io-baseline2.bin", "step-io-baseline.bin"),
                            ("io-track.bin", None)]:
        last = (STEP / name).read_bytes()
        first = (STEP / (name.replace(".bin", ".first")
                         if name != "io-track.bin" else "io-track.first")).read_bytes()
        if last != first:
            sys.exit(f"{name}: the last run's snapshot differs from the first run's - "
                     "the machine was not frozen identically across the matrix")

    scount = sum(1 for line in lines if line.startswith("S"))
    xcount = len(lines) - scount
    print(f"cases: {scount} snapshots, {xcount} crashed-early, "
          f"{len(want)} entries x {len(SHAPES) * len(STEPS)} runs")

    (FRONT / "stepstate.log").write_text("\n".join(lines) + "\n")
    (FRONT / "step-ram-baseline.bin").write_bytes((STEP / "ram-baseline2.bin").read_bytes())
    (FRONT / "step-pf-baseline.bin").write_bytes((STEP / "pf-baseline2.bin").read_bytes())
    (FRONT / "step-io-baseline.bin").write_bytes((STEP / "io-baseline2.bin").read_bytes())
    (FRONT / "io-track.bin").write_bytes((STEP / "io-track.bin").read_bytes())
    (FRONT / "entries.txt").write_text("\n".join(entries) + "\n")
    print("replaced stepstate.log, step baselines, io-track.bin and entries.txt")


if __name__ == "__main__":
    main()
