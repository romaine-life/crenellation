// Bake the ornament-only (transparent-interior) "line" variants of the kit 9-slice frames, so
// a surface painted behind an element shows through instead of the baked navy fill — the fix
// for the 9-slice fill problem (ADR-0028). Registry-driven: any asset with a `line` filename in
// config/nine-slice-registry.json gets its twin baked here, beside panel-line.png. (apply-nine-
// slice.mjs also writes these as part of a full bake; this is the focused, frames-only entry.)
//
//   node scripts/bake-line-frames.mjs
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { bakeLine, REGISTRY, LINE_DIR } from './nine-slice-kit.mjs';

mkdirSync(LINE_DIR, { recursive: true });

// `panel` and `mode-button` bake to byte-identical frames, so panel-line.png covers BOTH the
// settings boxes and the tab buttons — only `panel` carries the `line` flag, not `mode-button`.
const flagged = Object.entries(REGISTRY).filter(([, rec]) => rec.line);
if (!flagged.length) console.log('no frames flagged with a `line` output in the registry');
for (const [asset, rec] of flagged) {
  writeFileSync(`${LINE_DIR}${rec.line}`, PNG.sync.write(bakeLine(asset)));
  console.log(`wrote explore/frames/${rec.line} (from ${asset})`);
}
