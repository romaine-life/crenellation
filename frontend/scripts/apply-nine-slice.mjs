// apply-nine-slice — bake /nine-slice-editor configs into committed kit assets.
//
// The whole point: paste the editor's exported JSON into config/nine-slice/<asset>.json,
// then run this. One command, any registered asset. No per-asset code edits.
//
//   node scripts/apply-nine-slice.mjs                # apply every committed config
//   node scripts/apply-nine-slice.mjs mode-button    # apply one asset's committed config
//   node scripts/apply-nine-slice.mjs path/to.json   # apply a config file directly
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { buildAsset, loadConfig, normalizeConfig, writeGeneratedCss, logSave, CONFIG_DIR, REGISTRY } from './nine-slice-kit.mjs';

console.log(`
┌─ apply-nine-slice · bake editor offsets into committed assets (single bake impl: nine-slice-kit) ─
│ Source of truth = config/nine-slice/<asset>.json (the editor's exported JSON, in git).
│ bracket/keyline bake into the corner atom -> assembled PNG. content -> generated CSS var.
└────────────────────────────────────────────────────────────────────────────────────────────────
`);

const arg = process.argv[2];
let configs;
if (!arg) {
  configs = readdirSync(CONFIG_DIR).filter((f) => f.endsWith('.json')).map((f) => loadConfig(f.replace(/\.json$/, '')));
} else if (existsSync(arg) && arg.endsWith('.json')) {
  configs = [normalizeConfig(JSON.parse(readFileSync(arg, 'utf8')))];
} else if (REGISTRY[arg]) {
  configs = [loadConfig(arg)];
} else {
  console.error(`unknown target "${arg}" — pass nothing (all), an asset id (${Object.keys(REGISTRY).join('/')}), or a .json path`);
  process.exit(2);
}

if (!configs.length) { console.log('no configs found in', CONFIG_DIR); process.exit(0); }
for (const cfg of configs) {
  const res = buildAsset(cfg.asset, cfg);
  logSave('cli', cfg.asset, normalizeConfig(cfg), res.written);
  console.log(`✓ ${cfg.asset}  →  ${res.written.join(', ')}`);
  if (res.note) console.log(`  note: ${res.note}`);
  for (const w of res.warns) console.log(`  warn: ${w}`);
}
console.log(`✓ css   →  ${writeGeneratedCss()}`);
