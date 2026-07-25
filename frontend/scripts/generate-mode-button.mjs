// Kept as a familiar alias — the generic path is apply-nine-slice.mjs and the bake
// lives in nine-slice-kit.mjs (one implementation for every asset). This builds
// mode-button.png + mode-button-active.png from the atoms and the committed config
// at config/nine-slice/mode-button.json (the gold->cyan active swap is in the kit).
//
//   node scripts/generate-mode-button.mjs   # or: node scripts/apply-nine-slice.mjs mode-button
import { buildAsset, loadConfig } from './nine-slice-kit.mjs';

const res = buildAsset('mode-button', loadConfig('mode-button'));
console.log(`built ${res.written.join(' + ')} from atoms + config/nine-slice/mode-button.json`);
if (res.note) console.log(`note: ${res.note}`);
for (const w of res.warns) console.log(`warn: ${w}`);
