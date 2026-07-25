// Drift guard for the Track 5 sprite atlas. Re-runs the generator in-memory and
// fails if the committed manifest or sheet dimensions no longer match — so the
// checked-in art can never silently diverge from generate-sprites.mjs. Mirrors
// the spirit of check-bgm-shuffle.mjs / check-no-chrome-bitmaps.mjs.
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAtlas } from './generate-sprites.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'public/assets/sprites');
const failures = [];

const atlasPath = path.join(DIR, 'atlas.json');
if (!fs.existsSync(atlasPath)) {
  failures.push('public/assets/sprites/atlas.json missing — run: node scripts/generate-sprites.mjs');
} else {
  const committed = JSON.parse(fs.readFileSync(atlasPath, 'utf8'));
  const { manifest } = buildAtlas();
  if (JSON.stringify(committed) !== JSON.stringify(manifest)) {
    failures.push('atlas.json is stale vs the generator — run: node scripts/generate-sprites.mjs');
  }
  // Verify every referenced sheet exists with the expected dimensions (@2x = 2x).
  const dims = (rel) => {
    const p = path.join(ROOT, 'public', rel.replace(/^\//, ''));
    if (!fs.existsSync(p)) { failures.push(`missing sheet: ${rel}`); return null; }
    const png = PNG.sync.read(fs.readFileSync(p));
    return [png.width, png.height];
  };
  for (const layer of [manifest.tile, manifest.piece]) {
    const one = dims(layer.image);
    if (one && (one[0] !== layer.w || one[1] !== layer.h)) failures.push(`${layer.image} is ${one[0]}x${one[1]}, expected ${layer.w}x${layer.h}`);
    const two = dims(layer.image2x);
    if (two && (two[0] !== layer.w * 2 || two[1] !== layer.h * 2)) failures.push(`${layer.image2x} is ${two[0]}x${two[1]}, expected ${layer.w * 2}x${layer.h * 2}`);
  }
}

if (failures.length) {
  console.error('Sprite atlas guard FAILED:');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('Sprite atlas guard OK: committed atlas.json + sheets match the generator.');
