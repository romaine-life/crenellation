// Forge STORY-FEATURE murals (codex imagegen) for the continuity system, Phase 2.
// A "feature" is a multi-tile set-piece (a dino fossil, buried ruins) embedded in the cliff
// cross-section. Like a mural it is generated WIDE and sliced into ordered windows
// (build-mural-edges.py), but it spans only a few tiles and the solver lays it head→tail
// along a straight board edge — swapping in a TERMINATOR cap when it would clip at the
// corner / board end (so we never show a sliced-through neck, only a clean broken end).
//
//   node frontend/scripts/forge-feature.mjs [fossil ruins] | --all
//
// Output: <fam-agnostic> explore/<feature>-body.png (wide, sliced into pieces) and
//         explore/<feature>-cap.png (square, the clean terminator).
import { mkdtempSync, rmSync, copyFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEX, runCodex, imageGenVerdict, sessionImage } from './codex-imagegen.mjs';

const FRONTEND = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(FRONTEND, 'public/assets/tiles/explore');
const EVID = join(FRONTEND, 'tmp-forge-evidence');

// Each feature: a WIDE body (the whole set-piece left→right) + a CAP (clean terminator).
const SPECS = {
  fossil: {
    body: {
      wide: true,
      subject: 'a large dinosaur SKELETON FOSSIL embedded in a layered earth cliff cross-section: a horned reptilian SKULL at the far LEFT, then a long curving SPINE with a RIBCAGE arching across the middle, narrowing to a pointed TAIL at the far RIGHT. The pale fossilised bone is exposed against warm-brown soil strata with scattered pebbles. The bones read clearly left-to-right as one continuous skeleton spanning the whole width',
      palette: 'pale bone (#d9cda8, #b9a878 shadow), warm soil browns (#7a5a36, #5c4226), cool dark base #2c2014',
    },
    cap: {
      subject: 'a CLEAN VERTICAL CUT through warm-brown layered soil strata, with the round CROSS-SECTION of a single broken-off fossil bone exposed at the cut face (as if the skeleton was sliced cleanly here and ends) — a tidy, intentional terminus, not a torn edge',
      palette: 'pale bone (#d9cda8) ring, warm soil browns (#7a5a36, #5c4226), cool dark base #2c2014',
    },
  },
  ruins: {
    body: {
      wide: true,
      subject: 'ancient BURIED RUINS in a layered earth cliff cross-section: a toppled fluted stone COLUMN and a cracked ceramic URN half-buried at the LEFT, a fragment of tiled MOSAIC and carved stone BLOCKS across the middle, tapering to buried rubble and a single carved capstone at the RIGHT. Mossy weathered grey stone set against warm soil strata, reading as one continuous dig site left-to-right',
      palette: 'weathered stone greys (#6a6f76, #868c92, #4a4f55), moss green #4a6b30, terracotta urn #a8643c, warm soil #5c4226',
    },
    cap: {
      subject: 'a CLEAN VERTICAL CUT through layered soil strata, with the cross-section of a single buried carved STONE BLOCK exposed at the cut face (the dig ends cleanly here) — tidy and intentional, not a torn edge',
      palette: 'weathered stone greys (#6a6f76, #868c92), moss green #4a6b30, warm soil #5c4226',
    },
  },
};

function prompt(part, prior) {
  const aspect = part.wide
    ? 'a WIDE LANDSCAPE pixel-art image (aspect roughly 3:2, much wider than tall)'
    : 'a SQUARE pixel-art image';
  return `IMAGE-GENERATION task: create ONE PNG by GENERATING it with the built-in image_gen tool (the imagegen skill). Do NOT hand-draw it with code (PIL/Pillow, cairo, matplotlib, SVG, HTML/CSS, canvas), do NOT write a script, and do NOT crop or extract from any file — programmatic output is automatically rejected and you will be asked again.${prior ? `\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED: ${prior}\n` : ''}

Generate ${aspect} of ${part.subject}. It is the flat vertical FACE of a cut-away bank, seen straight-on (NO isometric skew, NO perspective, NO 3D — that is added later). It fills the whole canvas top to bottom as one continuous cliff face${part.wide ? ', the set-piece spanning the entire width' : ''}.

STYLE — most important: detailed PIXEL ART like a high-quality modern 16-bit game environment (Octopath Traveler, Eastward, FFT cliff faces). A limited but rich harmonious palette; fine yet clearly VISIBLE pixels; tasteful dithering. It MUST read as crafted pixel art — NOT a photograph, NOT smooth/painterly, NOT a 3D render. No blur, no soft gradients, no anti-aliasing.

LIGHTING: light from the UPPER-LEFT; the top lip is lightest, value steps darker toward the bottom; carve dark crevices for ambient occlusion.

PALETTE (build the limited palette from these): ${part.palette}.

Fill the entire canvas edge to edge — fully opaque, no border, frame, vignette, sky, or text.

Save it as ./out.png in the current working directory, then stop.`;
}

async function forgePart(feature, partName, part, maxTries) {
  let prior = '';
  for (let attempt = 1; attempt <= maxTries; attempt += 1) {
    const work = mkdtempSync(join(tmpdir(), `feat-${feature}-${partName}-`));
    try {
      const { out: jsonl } = await runCodex(work, prompt(part, prior));
      mkdirSync(EVID, { recursive: true });
      writeFileSync(join(EVID, `feat-${feature}-${partName}-try${attempt}.jsonl`), jsonl);
      const verdict = imageGenVerdict(jsonl);
      if (!verdict.ok) {
        console.log(`  ${feature}/${partName} try ${attempt}: METHOD ✗ — ${verdict.reason}`);
        prior = 'the rollout shows you did NOT emit an image_generation_call — you hand-drew the PNG in code. You MUST use the built-in image_gen tool.';
        continue;
      }
      const shipped = sessionImage(verdict.tid);
      if (!shipped) { prior = 'image not found; generate again into the default folder.'; continue; }
      mkdirSync(OUT, { recursive: true });
      const file = `${feature}-${partName}.png`;
      copyFileSync(shipped, join(OUT, file));
      console.log(`  ${feature}/${partName} try ${attempt}: ✓ -> explore/${file}`);
      return true;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  return false;
}

const argv = process.argv.slice(2);
const names = argv.includes('--all') || argv.filter((a) => !a.startsWith('--')).length === 0
  ? Object.keys(SPECS)
  : argv.filter((a) => SPECS[a]);
console.log(`forge-feature: ${names.join(', ')}\n  codex: ${CODEX}\n`);
const jobs = names.flatMap((f) => [['body', SPECS[f].body], ['cap', SPECS[f].cap]].map(([pn, p]) => ({ f, pn, p })));
let i = 0; const results = [];
const worker = async () => { while (i < jobs.length) { const j = jobs[i]; i += 1; results.push(await forgePart(j.f, j.pn, j.p, 2)); } };
await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
console.log(`\n==== ${results.filter(Boolean).length}/${results.length} feature parts forged ====`);
