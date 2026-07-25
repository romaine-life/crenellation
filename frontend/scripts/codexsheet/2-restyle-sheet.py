"""Codex Sheet pipeline · step 2 — cohesive Codex restyle.

One Codex img2img pass redraws the whole 2x4 structure grid (step 1) in the target
pixel-art style, anchored to the concept art (assets/art/skirmish-style-target.png).
Drawing all 8 directions in ONE pass is what keeps them consistent.

Needs the Codex CLI with the built-in image_generation tool. Point CODEX_BIN at the
executable, else the default Windows install location is globbed. The prompt MUST be
sent as UTF-8 (encoding='utf-8') — em dashes break Codex's stdin otherwise.

Usage:  python frontend/scripts/codexsheet/2-restyle-sheet.py <piece>
Output: docs/art/unit-concepts/codex-sheets/<piece>-sheet.png  (magenta keyed to alpha)
        docs/art/unit-concepts/codex-sheets/<piece>-sheet-raw.png  (raw, on magenta)
"""
import sys, os, glob, subprocess, re, time, shutil
from pathlib import Path

ROOT = Path(__file__).resolve()
while ROOT.parent != ROOT and not (ROOT / "frontend").exists():
    ROOT = ROOT.parent
piece = sys.argv[1]
WORK = ROOT / "docs" / "art" / "unit-concepts" / "codex-sheets"; WORK.mkdir(parents=True, exist_ok=True)

CODEX = os.environ.get("CODEX_BIN")
if not CODEX:
    found = sorted(glob.glob(os.path.expanduser(r"~/AppData/Local/OpenAI/Codex/bin/*/codex.exe")), key=os.path.getmtime)
    CODEX = found[-1] if found else None
if not CODEX or not os.path.exists(CODEX):
    sys.exit("Codex CLI not found — set CODEX_BIN to the codex executable.")
GEN = os.path.expanduser("~/.codex/generated_images")
RCK = os.path.expanduser("~/.codex/skills/.system/imagegen/scripts/remove_chroma_key.py")
grid = WORK / f"{piece}-blender-grid.png"
style = ROOT / "frontend" / "public" / "assets" / "art" / "skirmish-style-target.png"
dest = WORK / f"{piece}-sheet.png"

prompt = f"""You are given two images.

IMAGE 1 is a 2x4 grid (4 columns, 2 rows) on a flat magenta background, with magenta gutters
between cells. Each cell is the SAME chess {piece} from a different camera rotation — one
turntable of 8 directions at a fixed isometric 3/4 angle. Row-major order:
south, south-east, east, north-east / north, north-west, west, south-west.

IMAGE 2 is a game screenshot. Use ONLY the 2D PIXEL-ART STYLE of the chess unit sprites in it
(clean limited palette, crisp pixel clusters, dark readable outline, navy-blue team pieces).
Ignore image 2's UI, board and background.

Produce ONE output image: the SAME 2x4 grid layout (4 cols, 2 rows, flat #ff00ff magenta
background and magenta gutters). In each cell, redraw THAT cell's {piece} in the pixel-art
style of image 2, keeping the EXACT same pose, facing and camera angle as the corresponding
cell of image 1. It must read as ONE consistent {piece} rotating through 8 directions:
identical body design, proportions, palette, detail and outline weight across all 8 cells -
only the viewing angle changes. Do not redesign it, do not add/remove structural features
between cells, do not change the grid layout. ~16-24 colors, navy-blue, no shadow, no text.

Render on flat #ff00ff magenta (for keying). Do not use magenta inside the piece. Produce
exactly one image with the image_generation tool; do not write or move files."""

print(f"[restyle] codex pass for {piece}...", flush=True)
p = subprocess.run([CODEX, "exec", "--json", "-s", "workspace-write", "--skip-git-repo-check",
                    "-C", str(WORK), "-i", str(grid), "-i", str(style)],
                   input=prompt, capture_output=True, text=True, encoding="utf-8", timeout=600)
m = re.search(r'"thread_id":"([0-9a-f-]+)"', p.stdout + p.stderr)
if not m:
    sys.exit("NO_THREAD\n" + (p.stdout + p.stderr)[-700:])
tdir = os.path.join(GEN, m.group(1))
imgs = []
for _ in range(30):
    imgs = sorted(glob.glob(os.path.join(tdir, "ig_*.png")), key=os.path.getmtime)
    if imgs:
        break
    time.sleep(2)
if not imgs:
    sys.exit(f"NO_IMAGE in {tdir}")
raw = imgs[-1]
shutil.copy(raw, WORK / f"{piece}-sheet-raw.png")
subprocess.run([sys.executable, RCK, "--input", raw, "--out", str(dest), "--auto-key", "border",
                "--soft-matte", "--transparent-threshold", "12", "--opaque-threshold", "220", "--despill"], check=True)
print("SHEET_OK", piece, "->", dest)
