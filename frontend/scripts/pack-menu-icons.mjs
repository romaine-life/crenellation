// pack-menu-icons.mjs — RE-PACK the forged carved-stone menu icons onto the
// canonical icon canvas (ADR-0026: one fixed 64x64 transparent canvas, ~40x40
// centered safe area) using PER-SHAPE-CLASS optical keylines (ADR-0027) so all five
// carry EQUAL OPTICAL MASS, not equal margins. Optical centering is frozen as the
// asset's own transparent padding, so downstream centers naively and gets it free.
//
// Mechanical compositor — NO regeneration (the forged art is good low-fi pixel art;
// only its scale + placement were wrong). Sources are the high-res *despilled*
// `-smooth` PNGs so the resize is a clean LANCZOS DOWNscale (ADR-0014: the downscale
// IS the pixelation), then MEDIANCUT-quantized to a limited palette and snapped onto
// the canvas on whole pixels.
//
//   node scripts/pack-menu-icons.mjs
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PY = 'D:/automation/python312/python.exe';
const DIR = 'public/assets/ui/main-menu/icons-carved';
const CANVAS = 64, LIVE = 40, COLORS = 48;

// Per-shape-class keylines (ADR-0027 §C), in px on the 64 canvas. This is the HERO
// band — the primary-menu set fills toward the canvas margin (not the ~40 kit safe
// area) because it's a bold, sparse-screen hero set; equal OPTICAL mass is preserved,
// only the baseline scale is raised. axis = which axis the target governs; nudgeY =
// the documented optical-centering offset (down = +), baked into padding.
const ICONS = [
  { slug: 'solo-skirmish',   cls: 'tall-pointed', axis: 'h',    target: 56, nudgeY: 1 }, // blade: pointed, into margin
  { slug: 'campaign-editor', cls: 'full',         axis: 'long', target: 52, nudgeY: 0 }, // route-map: full/square
  { slug: 'level-editor',    cls: 'upright',      axis: 'h',    target: 48, nudgeY: 0 }, // scroll: blocky, held back
  { slug: 'lobbies',         cls: 'wide',         axis: 'w',    target: 48, nudgeY: 0 }, // pawns: wide cluster, held back
  { slug: 'settings',        cls: 'round',        axis: 'long', target: 52, nudgeY: 0 }, // gear: round/full, equal optical mass
];

const PYSRC = `
from PIL import Image
import sys
src, axis, target, nudgeY, canvas, colors, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]), sys.argv[7]
im = Image.open(src).convert('RGBA')
bbox = im.getbbox()
if bbox is None:
    print('EMPTY'); sys.exit(3)
im = im.crop(bbox)
w, h = im.size
if axis == 'h':    s = target / h
elif axis == 'w':  s = target / w
else:              s = target / max(w, h)
nw, nh = max(1, round(w * s)), max(1, round(h * s))
im2 = im.resize((nw, nh), Image.LANCZOS)          # clean downscale of smooth art = the pixelation
a = im2.split()[3]
rgb = im2.convert('RGB').quantize(colors=colors, method=Image.MEDIANCUT).convert('RGBA')
rgb.putalpha(a)
cv = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
x = round((canvas - nw) / 2)
y = round((canvas - nh) / 2) + nudgeY            # optical nudge frozen as padding
cv.alpha_composite(rgb, (x, y))
ncols = len(cv.convert('RGB').getcolors(maxcolors=100000) or [None] * 99999)
cv.save(out)
print(f'{out.split("/")[-1]} {canvas}x{canvas} | content {nw}x{nh} @ ({x},{y}) | colors {ncols}')
`;

let failed = 0;
for (const ic of ICONS) {
  const src = join(DIR, `${ic.slug}-smooth.png`);
  const out = join(DIR, `${ic.slug}.png`);
  if (!existsSync(src)) { console.error(`MISSING smooth source: ${src}`); failed++; continue; }
  const r = spawnSync(PY, ['-c', PYSRC, src, ic.axis, String(ic.target), String(ic.nudgeY), String(CANVAS), String(COLORS), out.replace(/\\/g, '/')], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(`FAIL ${ic.slug}: ${r.stderr || r.error}`); failed++; continue; }
  process.stdout.write(`  [${ic.cls.padEnd(12)}] ${r.stdout.trim()}\n`);
}
console.log(failed ? `\n${failed} icon(s) failed.` : `\nAll ${ICONS.length} packed to ${CANVAS}x${CANVAS} (live ${LIVE}, ${COLORS}-color).`);
process.exit(failed ? 1 : 0);
