"""Portrait candidate bake-off — produce one pixel-art treatment of a unit's
PORTRAIT master, so the Studio can show every method side by side (navy only,
held out of the game) and the user picks one.

Mirrors the board-unit "bake-off" libraries (units-pixel/{codexsheet,codexfilter,
filter2,filter3}) but for the eye-level portrait master. Every candidate is a
768x768 master normalized to the SMOOTH master's alpha bbox, so the ONE shared
portrait crop (frontend/src/art/portraitCrops.json) frames every method
identically — an honest comparison, no per-method zoom drift.

Source : frontend/public/assets/portrait-editor/<piece>/navy-blue.png  (768, smooth)
Output : frontend/public/assets/portrait-candidates/<method>/<piece>/navy-blue.png

Methods:
  filter2 / filter3   pixelate + palette-quantize the smooth master (no codex)
  codex-stone         codex img2img -> board navy-stone pixel style
  codex-concept       codex img2img -> ornate concept-art portrait style (cream+gold)
  codexfilter         filter pass over the codex-stone output

Usage: python build-portrait-candidate.py <piece> <method>
"""
import sys, os, glob, subprocess, re, time, shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve()
while ROOT.parent != ROOT and not (ROOT / "frontend").exists():
    ROOT = ROOT.parent

PIECES = ["pawn", "knight", "bishop", "rook", "queen", "king"]
CANVAS = 768  # master canvas; matches /assets/portrait-editor masters

ASSETS = ROOT / "frontend" / "public" / "assets"
SMOOTH = lambda piece: ASSETS / "portrait-editor" / piece / "navy-blue.png"
BOARD_STONE = lambda piece: ASSETS / "units" / piece / "navy-blue" / "south.png"
CONCEPT_ANCHOR = ROOT / "docs" / "art" / "unit-concepts" / "portraits" / "concept-portrait-anchor.png"
OUT = lambda method, piece: ASSETS / "portrait-candidates" / method / piece / "navy-blue.png"

# Filter tuning (logical downscale resolution + quantized palette size). Calibrated
# to read like the board filter2/filter3 (~24 / ~17 colors), scaled for the 768 master.
FILTER_PARAMS = {"filter2": (150, 24), "filter3": (100, 16)}


def load_rgba(path):
    return Image.open(path).convert("RGBA")


def pixel_filter(im, logical, ncolors):
    """Pixelate (nearest downscale->upscale) + quantize the opaque pixels; keep alpha."""
    rgb = im.convert("RGB")
    small = rgb.resize((logical, logical), Image.NEAREST)
    small = small.quantize(colors=ncolors, method=Image.MEDIANCUT, dither=Image.NONE).convert("RGB")
    pix = small.resize((CANVAS, CANVAS), Image.NEAREST)
    out = pix.convert("RGBA")
    # Re-apply a hard-edged version of the original alpha (pixelated to match).
    a = im.split()[3].resize((logical, logical), Image.NEAREST).point(lambda v: 255 if v >= 128 else 0)
    out.putalpha(a.resize((CANVAS, CANVAS), Image.NEAREST))
    return out


def normalize_to_ref(cand, ref_bbox):
    """Place `cand` on a CANVAS so its opaque bbox matches `ref_bbox` (uniform scale to
    ref height, align top + horizontal centre) — so the shared crop lands identically."""
    cb = cand.split()[3].getbbox()
    if not cb:
        return cand
    content = cand.crop(cb)
    rx0, ry0, rx1, ry1 = ref_bbox
    ref_w, ref_h = rx1 - rx0, ry1 - ry0
    scale = ref_h / content.height
    new_w = max(1, round(content.width * scale))
    content = content.resize((new_w, ref_h), Image.LANCZOS)
    out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    ref_cx = (rx0 + rx1) // 2
    out.alpha_composite(content, (ref_cx - new_w // 2, ry0))
    return out


def resolve_codex():
    if os.environ.get("CODEX_BIN") and os.path.exists(os.environ["CODEX_BIN"]):
        return os.environ["CODEX_BIN"]
    found = sorted(glob.glob(os.path.expanduser(r"~/AppData/Local/OpenAI/Codex/bin/*/codex.exe")), key=os.path.getmtime)
    return found[-1] if found else None


def codex_restyle(piece, style):
    """style: 'stone' | 'concept'. Returns a chroma-keyed RGBA of the restyled piece."""
    codex = resolve_codex()
    if not codex or not os.path.exists(codex):
        sys.exit("Codex CLI not found")
    gen = os.path.expanduser("~/.codex/generated_images")
    rck = os.path.expanduser("~/.codex/skills/.system/imagegen/scripts/remove_chroma_key.py")
    work = ROOT / "frontend" / "scripts" / "portraits" / ".codex-cwd"
    work.mkdir(parents=True, exist_ok=True)
    structure = SMOOTH(piece)
    anchor = BOARD_STONE(piece) if style == "stone" else CONCEPT_ANCHOR

    if style == "stone":
        style_desc = (
            "a carved navy-blue STONE body with a clean limited palette (~16-24 colors), crisp blocky "
            "pixel clusters, hand-placed dithering and a dark readable outline. PRESERVE the original "
            "warm and metallic accents from image 1 exactly where they are: a gold crown, tiara, trim "
            "or finials stay GOLD, red/crimson velvet stays red, jewels keep their colour - only the "
            "plain body is navy stone. Do NOT turn the gold or coloured accents into stone; add no new colors."
        )
    else:
        style_desc = (
            "an ornate pixel-art PORTRAIT: clean limited palette (~24-32 colors), crisp pixel clusters, "
            "an ivory/cream carved body with soft shading, gold trim accents, deep navy accents, a dark "
            "readable outline - decorative and characterful, matching image 2's portrait art style."
        )

    prompt = f"""You are given two images.

IMAGE 1 is a full-body 3D render of a chess {piece} (head to base) on a transparent/white
background, at a 3/4 facing. Use it for the EXACT shape, pose, proportions, scale, framing and
position of the {piece}.

IMAGE 2 is a style reference. Use ONLY its 2D pixel-art ART STYLE, not its content.

Produce ONE output image: the SAME {piece} from image 1 - identical composition, scale, pose,
facing and position within the frame (full body, head to base, same size and placement) - redrawn
as 2D PIXEL ART in this style: {style_desc} Do NOT re-crop, re-pose, re-center, zoom, or resize
the {piece}; keep it registered exactly to image 1. No text, no UI, no shadow. Render on a flat
#ff00ff magenta background (for keying); do not use magenta inside the piece. Produce exactly one
image with the image_generation tool; do not write or move files."""

    p = subprocess.run([codex, "exec", "--json", "-s", "workspace-write", "--skip-git-repo-check",
                        "-C", str(work), "-i", str(structure), "-i", str(anchor)],
                       input=prompt, capture_output=True, text=True, encoding="utf-8", timeout=900)
    m = re.search(r'"thread_id":"([0-9a-f-]+)"', p.stdout + p.stderr)
    if not m:
        sys.exit("NO_THREAD\n" + (p.stdout + p.stderr)[-1200:])
    tdir = os.path.join(gen, m.group(1))
    imgs = []
    for _ in range(40):
        imgs = sorted(glob.glob(os.path.join(tdir, "ig_*.png")), key=os.path.getmtime)
        if imgs:
            break
        time.sleep(2)
    if not imgs:
        sys.exit(f"NO_IMAGE in {tdir}")
    # Codex may still be writing the PNG when it first appears. A size plateau isn't
    # enough (it can pause mid-write), so verify the file fully DECODES before keying —
    # a truncated PNG raises, and remove_chroma_key would otherwise choke on it.
    raw = imgs[-1]
    for _ in range(40):
        try:
            with Image.open(raw) as _im:
                _im.load()
            break
        except Exception:
            time.sleep(0.4)
    keyed = work / f"{piece}-{style}-keyed.png"
    subprocess.run([sys.executable, rck, "--input", raw, "--out", str(keyed), "--auto-key", "border",
                    "--soft-matte", "--transparent-threshold", "12", "--opaque-threshold", "220", "--despill"], check=True)
    return load_rgba(keyed)


def build(piece, method):
    smooth = load_rgba(SMOOTH(piece))
    ref_bbox = smooth.split()[3].getbbox()
    if method in FILTER_PARAMS:
        logical, ncolors = FILTER_PARAMS[method]
        cand = pixel_filter(smooth, logical, ncolors)  # bbox preserved -> framing already matches
    elif method == "codex-stone":
        cand = normalize_to_ref(codex_restyle(piece, "stone"), ref_bbox)
    elif method == "codex-concept":
        cand = normalize_to_ref(codex_restyle(piece, "concept"), ref_bbox)
    elif method == "codexfilter":
        src = OUT("codex-stone", piece)
        if not src.exists():
            sys.exit("codexfilter needs codex-stone built first")
        logical, ncolors = FILTER_PARAMS["filter2"]
        cand = pixel_filter(load_rgba(src), logical, ncolors)
    else:
        sys.exit(f"unknown method {method}")
    out = OUT(method, piece)
    out.parent.mkdir(parents=True, exist_ok=True)
    cand.save(out)
    print(f"OK {piece} {method} -> {out}  bbox={cand.split()[3].getbbox()} ref={ref_bbox}")


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
