// Kept as a familiar alias — the generic path is apply-nine-slice.mjs and the bake
// (incl. the exterior carve) lives in nine-slice-kit.mjs. Builds row.png from the
// row atoms and config/nine-slice/row.json.
//
//   node scripts/generate-row.mjs   # or: node scripts/apply-nine-slice.mjs row
import { buildAsset, loadConfig } from './nine-slice-kit.mjs';

const res = buildAsset('row', loadConfig('row'));
console.log(`built ${res.written.join(' + ')} from atoms + config/nine-slice/row.json (exterior carved)`);
for (const w of res.warns) console.log(`warn: ${w}`);
