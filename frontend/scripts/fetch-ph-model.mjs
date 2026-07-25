// Fetch a Poly Haven CC0 model (gltf + its texture/bin includes) into <outDir>/<slug>/.
// These meshes are the *source* for doodad renders; they live outside git (large, CC0,
// re-fetchable) — the slug + this script + the render recipe are the recoverable record.
//   node fetch-ph-model.mjs <slug> <outDir> [resolution=1k]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const [slug, outRoot, res = '1k'] = process.argv.slice(2);
if (!slug || !outRoot) { console.error('usage: fetch-ph-model.mjs <slug> <outDir> [res]'); process.exit(1); }

const api = await (await fetch(`https://api.polyhaven.com/files/${slug}`)).json();
const gltf = api.gltf?.[res]?.gltf;
if (!gltf) { console.error(`no gltf/${res} for ${slug}`); process.exit(1); }

const outDir = join(outRoot, slug);
async function dl(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return buf.length;
}

const mainName = gltf.url.split('/').pop();
let total = await dl(gltf.url, join(outDir, mainName));
for (const [rel, info] of Object.entries(gltf.include ?? {})) total += await dl(info.url, join(outDir, rel));
console.log(`OK ${slug} -> ${join(outDir, mainName)} (${(total / 1024).toFixed(0)} KB)`);
