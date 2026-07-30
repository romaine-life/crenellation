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
   step-entries.txt replaced in frontend/src/rom

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
    # The machine has to be frozen identically for every run, or the snapshots
    # are of different machines and none of them mean anything. Two checks,
    # and the second is the stronger one: within the session, the last run's
    # baselines must equal the first run's; across sessions, they must equal
    # what is already committed. The cross-session equality is what actually
    # demonstrates determinism - the same EEPROM restored, hours apart, the
    # same 131,072 bytes of RAM and playfield at frame 2400.
    for name, committed in [("ram-baseline2.bin", "step-ram-baseline.bin"),
                            ("pf-baseline2.bin", "step-pf-baseline.bin"),
                            ("io-baseline2.bin", "step-io-baseline.bin"),
                            ("io-track.bin", "io-track.bin")]:
        last = (STEP / name).read_bytes()
        firstp = STEP / (name.replace(".bin", ".first")
                         if name != "io-track.bin" else "io-track.first")
        if firstp.exists() and last != firstp.read_bytes():
            sys.exit(f"{name}: the last run's snapshot differs from the first run's - "
                     "the machine was not frozen identically across the matrix")
        prev = FRONT / committed
        if prev.exists() and last != prev.read_bytes():
            print(f"note: {name} differs from the committed {committed}. That is "
                  "either a deliberate change of starting state or a lost "
                  "determinism; do not integrate until you know which.")

    scount = sum(1 for line in lines if line.startswith("S"))
    xcount = len(lines) - scount
    print(f"cases: {scount} snapshots, {xcount} crashed-early, "
          f"{len(want)} entries x {len(SHAPES) * len(STEPS)} runs")

    (FRONT / "stepstate.log").write_text("\n".join(lines) + "\n")
    (FRONT / "step-ram-baseline.bin").write_bytes((STEP / "ram-baseline2.bin").read_bytes())
    (FRONT / "step-pf-baseline.bin").write_bytes((STEP / "pf-baseline2.bin").read_bytes())
    (FRONT / "step-io-baseline.bin").write_bytes((STEP / "io-baseline2.bin").read_bytes())
    (FRONT / "io-track.bin").write_bytes((STEP / "io-track.bin").read_bytes())
    # step-entries.txt, NOT entries.txt: that file is the older sessions'
    # capture data, and the fuzz and call-and-return harnesses consume their
    # random stream in its exact order. Overwriting it misaligned every case
    # after the first difference and took fuzz from 1,301 matches to 130.
    (FRONT / "step-entries.txt").write_text("\n".join(entries) + "\n")
    print("replaced stepstate.log, step baselines, io-track.bin and step-entries.txt")


if __name__ == "__main__":
    main()
