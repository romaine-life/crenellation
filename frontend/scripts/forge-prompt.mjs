// Minimal single-shot codex image generation with an arbitrary prompt, method-verified and
// shipped race-free via the shared helper. Used for one-off bake-off candidates.
//   node scripts/forge-prompt.mjs <outPath.png> "<prompt...>"
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { runCodex, imageGenVerdict, sessionImage } from './codex-imagegen.mjs';

const outPath = process.argv[2];
const prompt = process.argv.slice(3).join(' ');
if (!outPath || !prompt) { console.error('usage: forge-prompt <outPath.png> "<prompt>"'); process.exit(2); }

const work = mkdtempSync(join(tmpdir(), 'fp-'));
try {
  const { out } = await runCodex(work, prompt);
  const v = imageGenVerdict(out);
  if (!v.ok) { console.error('METHOD FAIL:', v.reason); process.exit(1); }
  const src = sessionImage(v.tid);
  if (!src) { console.error('no generated image found'); process.exit(1); }
  mkdirSync(dirname(outPath), { recursive: true });
  copyFileSync(src, outPath);
  console.log('ok ->', outPath, '(', src.split(/[\\/]/).pop(), ')');
} finally {
  rmSync(work, { recursive: true, force: true });
}
