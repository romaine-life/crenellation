// Forge WIDE continuous cliff MURALS (codex imagegen) for the continuity system.
// Unlike forge-side-texture (one square slab per tile), a mural is ONE wide cliff
// cross-section meant to be SLICED into N ordered windows (build-mural-edges.py); the
// solver then hands consecutive board-edge cells consecutive windows, so the cliff
// FLOWS across tiles instead of each tile re-starting at a random variant.
//
//   node frontend/scripts/forge-mural.mjs <family> [--n 3] [--tries 2]
//
// Output: frontend/public/assets/tiles/explore/<fam>-mural-<idx>.png  (idx = candidate)
import { mkdtempSync, rmSync, copyFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEX, runCodex, imageGenVerdict, sessionImage } from './codex-imagegen.mjs';

const FRONTEND = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(FRONTEND, 'public/assets/tiles/explore');
const EVID = join(FRONTEND, 'tmp-forge-evidence');

const SPECS = {
  grass: {
    body: 'a grassy earth cliff cross-section: a continuous band of lush green turf along the very top overhanging the edge and casting a soft shadow, then warm-brown soil with several GENTLY UNDULATING horizontal strata getting darker toward the bottom, small pebbles scattered through the soil, and pale thin tree roots dangling down at irregular intervals',
    palette: 'turf greens (#4f7a2e, #6f9e42 highlights), warm soil browns (#7a5a36, #5c4226), cool dark base #2c2014; roots one step lighter than the soil',
    vertical: 'dangling roots, hairline cracks, thin damp drip streaks, occasional exposed stone nodules',
  },
  dirt: {
    body: 'a dry dirt embankment cross-section: many gently undulating horizontal sediment strata in ochre-to-umber browns, embedded pebbles denser toward the bottom, buried rounded stones near the base',
    palette: 'ochre #9a7340, umber #6e4f2c, cool shadow brown #3a2a1a',
    vertical: 'faint vertical erosion channels, hairline cracks, trickling sand',
  },
  stone: {
    body: 'a weathered mossy bedrock cliff cross-section: large irregular stone blocks separated by deep dark cracks, protruding rocks, patches of green moss on upper edges and inside crevices, faint lichen speckle',
    palette: 'cool stone greys (#3a4045, #4a5258, #5b636a), moss green #4a6b30, shadow brown in cracks, cream highlight #8a9298',
    vertical: 'branching fissures, damp vertical drip streaks, moss runners',
  },
  sand: {
    body: 'a sandstone cliff cross-section: horizontal wind-eroded shelves stacked vertically, each catching a thin warm highlight on its top lip with a soft shadow beneath, gentle overhangs, smooth low-contrast sandy grain getting a touch darker toward the bottom',
    palette: 'pale gold #cdb074, tan #a8854f, warm shadow #6e5230; soft, warm, low-contrast',
    vertical: 'gentle overhang lips, a little loose sand trickling, faint scour lines',
  },
  pebble: {
    body: 'a riverstone cobble bank cross-section: tightly packed rounded pebbles of varied sizes getting smaller toward the bottom, each lit from upper-left with dark gaps between them, and a little moss and soil filling the lowest crevices',
    palette: 'mixed cool and warm greys (#4a4f55, #6a6f76, #868c92) with two warm accent stones, deep dark gap shadows',
    vertical: 'trickling gaps between cobbles, moss runners in the crevices',
  },
};

function prompt(spec, prior) {
  return `IMAGE-GENERATION task: create ONE PNG by GENERATING it with the built-in image_gen tool (the imagegen skill). Do NOT hand-draw it with code (PIL/Pillow, cairo, matplotlib, SVG, HTML/CSS, canvas), do NOT write a script, and do NOT crop or extract from any file — programmatic output is automatically rejected and you will be asked again.${prior ? `\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED: ${prior}\n` : ''}

Generate a WIDE LANDSCAPE pixel-art CLIFF MURAL (aspect roughly 3:2, much wider than it is tall) of ${spec.body}. It is the vertical face of a long cut-away bank, seen straight-on (NO isometric skew, NO perspective, NO 3D — that is added later). It is ONE single continuous cliff that spans the ENTIRE width edge to edge as an unbroken bank.

CONTINUITY — critical: this mural will be SLICED into vertical strips and each strip painted onto a different tile, so the result must read as ONE continuous cliff. Keep features flowing ACROSS the width: ${spec.vertical}. Vary them along the width so no vertical strip looks identical to its neighbour, but make the strata, turf line, and overall value continuous left-to-right with NO hard vertical seams, panels, or repeating motif. The LEFT and RIGHT edges should be able to butt together seamlessly (horizontally tileable).

STYLE — most important: detailed PIXEL ART like a high-quality modern 16-bit game environment (Octopath Traveler, Eastward, FFT cliff faces). A limited but rich harmonious palette; fine yet clearly VISIBLE pixels; tasteful dithering. It MUST read as crafted pixel art — NOT a photograph, NOT smooth/painterly, NOT a 3D render. No blur, no soft gradients, no anti-aliasing, no glossy highlights.

LIGHTING: light from the UPPER-LEFT. The top lip is the lightest band; value steps DARKER toward the bottom. Carve dark crevices/cracks for ambient occlusion; pop a few small protrusions with a 1px top highlight and a small shadow cast down-right.

PALETTE (build the limited palette from these): ${spec.palette}.

Fill the entire canvas edge to edge with the cliff material — fully opaque, no border, frame, vignette, ground line, sky, or text. Just the continuous cliff face.

Save it as ./mural.png in the current working directory, then stop.`;
}

async function forgeOne(family, spec, idx, maxTries) {
  let prior = '';
  for (let attempt = 1; attempt <= maxTries; attempt += 1) {
    const work = mkdtempSync(join(tmpdir(), `mural-${family}-${idx}-`));
    try {
      const { out: jsonl } = await runCodex(work, prompt(spec, prior));
      mkdirSync(EVID, { recursive: true });
      writeFileSync(join(EVID, `mural-${family}-${idx}-try${attempt}.jsonl`), jsonl);
      const verdict = imageGenVerdict(jsonl);
      if (!verdict.ok) {
        console.log(`  ${family}#${idx} try ${attempt}: METHOD ✗ — ${verdict.reason}`);
        prior = 'the rollout shows you did NOT emit an image_generation_call — you hand-drew the PNG in code. You MUST use the built-in image_gen tool to GENERATE it as a real bitmap.';
        continue;
      }
      const shipped = sessionImage(verdict.tid);
      if (!shipped) { prior = 'image not found; generate again into the default folder.'; continue; }
      mkdirSync(OUT, { recursive: true });
      const file = `${family}-mural-${idx}.png`;
      copyFileSync(shipped, join(OUT, file));
      console.log(`  ${family}#${idx} try ${attempt}: ✓ -> explore/${file}`);
      return { idx, pass: true };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  return { idx, pass: false };
}

const argv = process.argv.slice(2);
const flag = (n, def) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : def; };
const family = argv.find((a) => !a.startsWith('--') && SPECS[a]) || 'grass';
const n = Math.max(1, parseInt(flag('--n', '3'), 10));
const maxTries = Math.max(1, parseInt(flag('--tries', '2'), 10));
const spec = SPECS[family];
console.log(`forge-mural: ${n} candidate(s) of ${family}\n  codex: ${CODEX}\n`);
const results = await Promise.all(Array.from({ length: n }, (_, i) => forgeOne(family, spec, i, maxTries)));
const ok = results.filter((r) => r.pass).length;
console.log(`\n==== ${ok}/${results.length} murals forged ====`);
