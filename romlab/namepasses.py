"""Run the four naming passes to a JOINT fixed point.

Each of them runs to its own fixed point internally, and that is not the same
thing. They feed each other:

  - `curatedparams.py` applies a name somebody read out of the disassembly,
    which is a seed the other four have no way of producing.
  - `moreroles.py` names a parameter from what its own routine does with it,
    which makes it a named callee parameter for `paramnames.py`.
  - `paramnames.py` names a local from the callee it is handed to, which makes
    it a named local at a call site for `callernames.py`.
  - `callernames.py` and `stackargnames.py` name a parameter from what the
    callers call it, which makes it a named callee parameter again.

Run once each, in that order, the naming passes gave 2,126 unnamed. Run to a joint
fixed point they give 2,085, and the second round alone found 26 more that the
first round's own output had made findable. This is the same lesson
`idents.py` records for its wrapper and jump-stub rules: folding a rule INTO
the fixed point rather than running it after took jump stubs from 31 to 57,
and the value is not the count so much as that the result no longer depends on
the order the passes happen to run in.

`dropunread.py` is deliberately NOT in the loop. It removes parameters rather
than naming them, it converges in one pass by construction, and it must run
before any of these - a naming pass that ran first would spend its evidence on
things about to stop being parameters, which is exactly what happened the
first time round.

    python3 namepasses.py
"""
import re
import subprocess
import sys
import pathlib

HERE = pathlib.Path(__file__).parent
PASSES = ["curatedparams.py", "moreroles.py", "paramnames.py",
          "callernames.py", "stackargnames.py"]
NUM = re.compile(r"\d+")


def main():
    for round_ in range(1, 10):
        moved = 0
        lines = []
        for name in PASSES:
            out = subprocess.run([sys.executable, str(HERE / name)],
                                 capture_output=True, text=True, check=True)
            line = out.stdout.strip()
            lines.append(line)
            # Every pass reports its counts as the numbers in its one line of
            # output; "(converged in 3 rounds)" is a count of rounds, not of
            # renames, so only the part before a bracket is read.
            moved += sum(int(n) for n in NUM.findall(line.split("(")[0]))
        print(f"round {round_}: {moved} renamed")
        for line in lines:
            print(f"  {line}")
        if not moved:
            print("joint fixed point reached")
            return
    print("did not converge in nine rounds - something feeds itself")


if __name__ == "__main__":
    main()
