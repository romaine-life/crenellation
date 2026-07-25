// Gated Codex img2img RESTYLE of a real prop capture — the deemed-good way to get a STYLIZED
// (pixel-art) board prop from a photoreal mesh while keeping its true geometry + isometric
// projection. NEVER call codex.exe raw: codex will "code-draw" (write a PIL/SVG script) when it
// can't satisfy the prompt (e.g. native transparency), and a pixel-only audit won't catch it.
//
// This goes through codex-imagegen.mjs, whose imageGenVerdict() reads the session ROLLOUT and
// REJECTS any run lacking an `image_generation_call` event (= code-drawn). It generates on a flat
// green background (gpt-image can't paint transparency) and chroma-keys to alpha afterwards.
//
//   node scripts/forge-prop-restyle.mjs <capture.png> <out.png> [attempts]
//
// <capture.png> is a Blender render of the real mesh at the board's iso angle (e.g. from
// docs/art/doodad-concepts/render_prop_mesh.py). After this, crop-to-content + downscale to board
// size and measure the foot anchor (PIL: alpha bbox), then set the PropDef.sprite in core/props.ts.
import { runCodex, imageGenVerdict, sessionImage, removeChromaKey } from './codex-imagegen.mjs';
import { mkdtempSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REF = process.argv[2];
const OUT = process.argv[3];
const ATTEMPTS = Number(process.argv[4] || 3);
if (!REF || !existsSync(REF) || !OUT) { console.error('usage: forge-prop-restyle <capture.png> <out.png> [attempts]'); process.exit(2); }

const PROMPT = `Re-skin the attached reference image (input_image) as clean, crisp game PIXEL-ART. \
The reference is a real 3D render at a fixed isometric (2:1 dimetric) camera. PRESERVE EXACTLY its \
geometry, silhouette, proportions, and isometric projection — same camera, same footprint, same \
height. Only change the art treatment to stylized pixel-art (bold readable forms, cohesive warm \
palette, light from upper-left). Do NOT redesign the subject or change the angle. \
Render it on a FLAT SOLID GREEN (#00FF00) background filling the whole canvas — do NOT attempt \
transparency, do NOT write a script to draw it; use the image generation model. Same canvas size \
as the reference, subject centered with its base near the bottom.`;

let verdict = null, tid = null;
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  const cwd = mkdtempSync(join(tmpdir(), `proprestyle-${attempt}-`));
  copyFileSync(REF, join(cwd, 'input_image.png'));
  const { code, out } = await runCodex(cwd, PROMPT, join(cwd, 'input_image.png'));
  verdict = imageGenVerdict(out);
  console.log(`attempt ${attempt}: exit=${code} gate.ok=${verdict.ok} reason=${verdict.reason}`);
  if (verdict.ok) { tid = verdict.tid; break; }
}
if (!verdict || !verdict.ok) { console.error('GATE FAILED: codex code-drew on every attempt — not shipping'); process.exit(1); }
const raw = sessionImage(tid);
if (!raw) { console.error('no ig_*.png in session dir'); process.exit(1); }
const r = removeChromaKey(raw, OUT);
console.log(r.ok ? `OK -> ${OUT}` : `chroma-key FAILED: ${r.reason}`);
process.exit(r.ok ? 0 : 1);
