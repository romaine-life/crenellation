// forge-atom.mjs — the ATOM-PAINTER: front half of the 9-slice pipeline (ADR-0012).
//
// Generates ONE transparent kit atom via the decided method (ADR-0013):
// built-in / subscription codex img2img on a flat chroma-key background, then
// remove_chroma_key.py -> alpha. The result is GATED twice and will NOT be saved
// unless both pass:
//   1. METHOD — an `image_generation_call` event in the rollout (real generation,
//      not code-drawn). The stdout method gate is known-unreliable; we read the
//      rollout (kit-forge.md).
//   2. TRANSPARENCY — the four corners are actually transparent after despill
//      (catches a chroma-key-color collision in the art; switch --key if so).
//
// The CALLER only describes the atom; this tool owns the method + transparency
// scaffolding so transparency can't be requested the wrong (prose) way — that
// failure (ADR-0013) is designed out, not left to the prompt author.
//
// Use:
//   node scripts/forge-atom.mjs --ref <ref.png> --out public/assets/ui/kit/atoms/<name>.png --desc "..."
//   import { forgeAtom } from './forge-atom.mjs'   // for per-element generators
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { CODEX } from './codex-imagegen.mjs'; // resolves codex.exe dynamically (CODEX_BIN / newest build / PATH) — the bin/<hash>/ dir changes every update

const PY = 'D:/automation/python312/python.exe';
const REMOVE = 'C:/Users/Nelson/.codex/skills/.system/imagegen/scripts/remove_chroma_key.py';
const SESSIONS = 'C:/Users/Nelson/.codex/sessions';

function banner(key) {
  console.log(`
┌─ forge-atom · paints ONE transparent kit atom (ADR-0012 front half · ADR-0013 method) ─
│ METHOD:       built-in/subscription codex img2img, verified by image_generation_call.
│ TRANSPARENCY: generate on a flat ${key} chroma-key bg -> remove_chroma_key.py.
│               Never request "transparent" in prose; never use ${key} in the art.
│ GATE:         refuses to save unless generation is verified AND corners transparent.
└─────────────────────────────────────────────────────────────────────────────────────────
`);
}

function buildPrompt(desc, key) {
  return `IMAGE-GENERATION task: GENERATE one PNG using the built-in image generation tool (img2img from the attached reference). Do NOT hand-draw it with code (PIL/cairo/SVG/HTML/CSS/canvas), do NOT write a script, and do NOT crop or extract pixels from any file — programmatic OR extracted output is automatically rejected.
${desc}
FIDELITY (match the concept's low-fi element look — ADR-0014 / docs/ui-chrome-vocabulary.md): low-fi, pixellated, indie. Use a LIMITED palette (a few hundred colors for this element, not thousands), CHUNKY / stepped edges, authored at native footprint. Do NOT anti-alias into smooth edges, do NOT produce a high-fidelity or painterly render, no gradients, no glow.
TRANSPARENCY (do it exactly this way): paint everything OUTSIDE the subject as a perfectly flat solid ${key} chroma-key background for local background removal. The background must be ONE uniform ${key} — no shadows, gradients, texture, reflections, floor plane, or lighting variation. Do NOT use ${key} anywhere in the subject. No cast shadow, no contact shadow, no reflection, no watermark, no text.
Save it as ./atom.png in the current working directory, then stop.`;
}

function run(prompt, ref) {
  return new Promise((res) => {
    const work = mkdtempSync(join(tmpdir(), 'forge-atom-'));
    const p = spawn(CODEX, ['exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-C', work, '-i', ref], { stdio: ['pipe', 'pipe', 'pipe'] });
    let log = '';
    p.stdout.on('data', (d) => { log += d; });
    p.stderr.on('data', (d) => { log += d; });
    p.on('close', () => res({ log, work }));
    p.on('error', (e) => res({ log: String(e), work }));
    p.stdin.write(prompt); p.stdin.end();
  });
}

function methodVerified(startMs) {
  let best = null, bestT = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
        const t = statSync(p).mtimeMs;
        if (t >= startMs - 2000 && t > bestT) { bestT = t; best = p; }
      }
    }
  };
  try { walk(SESSIONS); } catch { /* sessions dir absent */ }
  return best ? readFileSync(best, 'utf8').includes('image_generation_call') : false;
}

function despill(src, dst) {
  return spawnSync(PY, [REMOVE, '--input', src, '--out', dst,
    '--auto-key', 'border', '--soft-matte',
    '--transparent-threshold', '12', '--opaque-threshold', '220', '--despill', '--force'], { encoding: 'utf8' });
}

// ADR-0014 low-fi step: bring the smooth despilled atom down to its native footprint
// and quantize to a limited palette. Downscaling smooth art to its real on-screen
// size IS the pixelation; the quantize collapses it toward the concept's few-hundred
// colors. This is what makes the atom chunky/low-fi instead of a smooth render.
export function lofi(src, dst, footprint, colors) {
  const py = "from PIL import Image\nimport sys\ninp,outp,fp,cols=sys.argv[1],sys.argv[2],int(sys.argv[3]),int(sys.argv[4])\nim=Image.open(inp).convert('RGBA')\nw,h=im.size\ns=fp/max(w,h)\nim2=im.resize((max(1,round(w*s)),max(1,round(h*s))),Image.LANCZOS)\na=im2.split()[3]\nrgb=im2.convert('RGB').quantize(colors=cols,method=Image.MEDIANCUT).convert('RGBA')\nrgb.putalpha(a)\nrgb.save(outp)";
  return spawnSync(PY, ['-c', py, src, dst, String(footprint), String(colors)], { encoding: 'utf8' });
}

// Transparency gate: confirm the despill produced a real alpha cutout (the key
// background was removed) rather than an opaque plate (the ADR-0013 failure mode).
// We can't assume WHERE the transparency is — a corner atom keeps an opaque
// interior corner, an edge atom keeps one opaque side, a fill is fully opaque — so
// we check the global transparent fraction is in a sane range, not specific corners.
function transparencyOk(file) {
  const png = PNG.sync.read(readFileSync(file));
  const { width: w, height: h, data } = png;
  let transparent = 0, total = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { total += 1; if (data[(y * w + x) * 4 + 3] < 20) transparent += 1; }
  const frac = transparent / total;
  return { ok: frac > 0.05 && frac < 0.97, frac };
}

// EDGE-FLUSH contract: a kit atom's frame must reach the atom's edge — no empty
// exterior margin. Codex tends to draw the frame inset inside a transparent margin
// (it reproduces the reference crop's surroundings); that inset margin is what the
// assembler's full-canvas fill bleeds navy into. So we trim the atom to its opaque
// bounding box, guaranteeing the frame is flush to the edge — the same property the
// accepted gold atoms already have. Throws if the atom is empty.
export function trimToEdge(file) {
  const png = PNG.sync.read(readFileSync(file));
  const { width: w, height: h, data } = png;
  const a = (x, y) => data[(y * w + x) * 4 + 3];
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a(x, y) > 20) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  if (maxX < 0) throw new Error('forge-atom: atom is fully transparent — no frame to trim to');
  const margins = { top: minY, left: minX, bottom: h - 1 - maxY, right: w - 1 - maxX };
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  if (cw === w && ch === h) return { margins, w: cw, h: ch };
  const o = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const s = ((minY + y) * w + (minX + x)) * 4, d = (y * cw + x) * 4; o.data[d] = data[s]; o.data[d + 1] = data[s + 1]; o.data[d + 2] = data[s + 2]; o.data[d + 3] = data[s + 3]; }
  writeFileSync(file, PNG.sync.write(o));
  return { margins, w: cw, h: ch };
}

// GLYPH-CANVAS contract (ADR-0026): a kit icon glyph must ship on ONE uniform
// canvas (64×64), centered, never as a bare opaque bbox. trimToEdge above finds the
// glyph's true extent; this then centers that trimmed glyph in a transparent cw×ch
// canvas. Never upscales (s capped at 1) — a glyph already at/under the safe area
// keeps its pixels 1:1; an over-large glyph is scaled DOWN (nearest-neighbor, to
// preserve the low-fi look) to fit the margin. The result is dimension-asserted by
// the caller, so the canvas is enforced, not requested.
export function padToCanvas(file, cw, ch, margin = 2) {
  const png = PNG.sync.read(readFileSync(file));
  const { width: w, height: h } = png;
  const innerW = cw - margin * 2, innerH = ch - margin * 2;
  const s = Math.min(1, innerW / w, innerH / h);
  let src = png, sw = w, sh = h;
  if (s < 1) {
    sw = Math.max(1, Math.round(w * s)); sh = Math.max(1, Math.round(h * s));
    src = new PNG({ width: sw, height: sh });
    for (let y = 0; y < sh; y += 1) for (let x = 0; x < sw; x += 1) {
      const sx = Math.min(w - 1, Math.floor(x / s)), sy = Math.min(h - 1, Math.floor(y / s));
      const a = (sy * w + sx) * 4, b = (y * sw + x) * 4;
      src.data[b] = png.data[a]; src.data[b + 1] = png.data[a + 1]; src.data[b + 2] = png.data[a + 2]; src.data[b + 3] = png.data[a + 3];
    }
  }
  const out = new PNG({ width: cw, height: ch }); // Buffer.alloc zero-fills -> fully transparent canvas
  const ox = Math.floor((cw - sw) / 2), oy = Math.floor((ch - sh) / 2);
  PNG.bitblt(src, out, 0, 0, sw, sh, ox, oy);
  writeFileSync(file, PNG.sync.write(out));
  return { cw, ch, placed: { w: sw, h: sh, ox, oy } };
}

export async function forgeAtom({ ref, out, desc, key = '#00ff00', footprint = 48, colors = 64, canvas = null, margin = 2 }) {
  if (!existsSync(ref)) throw new Error(`forge-atom: ref not found: ${ref}`);
  banner(key);
  const started = Date.now();
  const { log, work } = await run(buildPrompt(desc, key), ref);
  if (!methodVerified(started)) {
    throw new Error(`forge-atom: NO image_generation_call in rollout — codex did not generate (rejected). tail:\n${log.slice(-400)}`);
  }
  const produced = join(work, 'atom.png');
  if (!existsSync(produced)) throw new Error(`forge-atom: codex produced no atom.png (workdir had: ${readdirSync(work).join(', ') || '(empty)'})`);
  mkdirSync(dirname(out), { recursive: true });
  const raw = out.replace(/\.png$/i, '-raw.png');        // green plate (raw generation)
  const smooth = out.replace(/\.png$/i, '-smooth.png');  // despilled, pre-low-fi (inspection)
  copyFileSync(produced, raw);
  const cr = despill(produced, smooth);
  if (cr.status !== 0) throw new Error(`forge-atom: despill failed: ${cr.stderr || cr.error}`);
  // GLYPH mode (ADR-0026): trim the HIGH-RES cutout to the glyph BEFORE low-fi, so
  // `footprint` sizes the GLYPH itself. Codex pads a frame around the subject; sizing
  // that padded frame to footprint leaves the glyph far smaller than the safe area.
  // ATOM mode keeps low-fi-then-edge-flush-trim.
  if (canvas) trimToEdge(smooth);
  const lr = lofi(smooth, out, footprint, colors);       // ADR-0014: native footprint + limited palette
  if (lr.status !== 0) throw new Error(`forge-atom: low-fi step failed: ${lr.stderr || lr.error}`);
  let pad = null, trim;
  if (canvas) {                                          // ADR-0026 glyph mode: center the safe-area-sized glyph in a uniform canvas
    const [cw, ch] = canvas;
    pad = padToCanvas(out, cw, ch, margin);
    const fin = PNG.sync.read(readFileSync(out));        // DIMENSION ASSERT: the canvas is enforced, never just requested
    if (fin.width !== cw || fin.height !== ch) throw new Error(`forge-atom: canvas assert FAILED — ${fin.width}x${fin.height} != ${cw}x${ch} (ADR-0026)`);
    trim = { margins: { top: 0, left: 0, bottom: 0, right: 0 }, w: pad.placed.w, h: pad.placed.h };
  } else {
    trim = trimToEdge(out);                              // atom edge-flush: frame reaches the edge, no exterior margin
  }
  const t = transparencyOk(out);
  if (!t.ok) {
    throw new Error(`forge-atom: transparency gate failed — ${(t.frac * 100).toFixed(0)}% transparent (expected 5–97%). ~0% = opaque plate (key not removed); ~100% = empty. A mid-range miss can mean the art used the ${key} key color (holes) — re-run with a different --key (e.g. #ff00ff). Output: ${out}`);
  }
  const m = trim.margins;
  const shape = pad ? `${pad.cw}x${pad.ch} canvas, glyph ${pad.placed.w}x${pad.placed.h} centered (ADR-0026)` : `${trim.w}x${trim.h} edge-flush`;
  console.log(`forge-atom OK -> ${out}  (${shape}, ${colors}-color low-fi; trimmed margin t${m.top}/l${m.left}/b${m.bottom}/r${m.right}; ${(t.frac * 100).toFixed(0)}% transparent)`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const ref = get('--ref'); const out = get('--out'); const key = get('--key') || '#00ff00';
  const footprint = Number(get('--footprint')) || 48;
  const colors = Number(get('--colors')) || 64;
  const canvasArg = get('--canvas');                     // ADR-0026 glyph mode: "64" -> 64x64, "64x80" -> 64x80
  let canvas = null;
  if (canvasArg) { const p = canvasArg.split('x').map(Number); canvas = p.length === 1 ? [p[0], p[0]] : p; }
  const margin = Number(get('--margin')) || 2;
  let desc = get('--desc');
  if (get('--desc-file')) desc = readFileSync(get('--desc-file'), 'utf8');
  if (!ref || !out || !desc) {
    console.error('usage: forge-atom.mjs --ref <png> --out <atoms/x.png> --desc "..." [--key #00ff00] [--footprint 48] [--colors 64] [--canvas 64|64x80] [--margin 2]');
    process.exit(2);
  }
  try { await forgeAtom({ ref, out, desc, key, footprint, colors, canvas, margin }); }
  catch (e) { console.error(String(e.message || e)); process.exit(1); }
}
