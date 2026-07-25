// Builds src/ui/design/artworkManifest.json — the build-time catalog backing the
// Studio's "Artwork" category, the same way kit-manifest.mjs backs "Assets".
// Scans the web-served art under public/assets into labelled groups (world scenes,
// portrait backgrounds, unit portraits, portrait-editor sources, brand/key art,
// served concept art, and the inspiration set copied under assets/artwork). Re-run
// after adding art:  node scripts/artwork-manifest.mjs
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = fileURLToPath(new URL('..', import.meta.url));
const PUB = join(FRONTEND, 'public');
const OUT = join(FRONTEND, 'src/ui/design/artworkManifest.json');
const TODAY = new Date().toISOString().slice(0, 10);

const IMG = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg']);
const isImg = (f) => IMG.has(extname(f).toLowerCase());
const exists = (p) => existsSync(p);

const walk = (dir) => {
  if (!exists(dir)) return [];
  let out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (isImg(e.name)) out.push(p);
  }
  return out;
};
const subdirs = (dir) => (exists(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(dir, e.name)) : []);
const globIn = (dir, re) => (exists(dir) ? readdirSync(dir).filter((f) => isImg(f) && re.test(f)).map((f) => join(dir, f)) : []);

// Collapse png/webp/avif triplets to one representative (prefer png > jpg > svg).
const dedupe = (files) => {
  const seen = new Map();
  for (const f of files) {
    const base = f.replace(/\.(png|jpg|jpeg|webp|avif|svg)$/i, '');
    const rank = { '.png': 0, '.jpg': 1, '.jpeg': 1, '.svg': 2, '.webp': 3, '.avif': 4 }[extname(f).toLowerCase()] ?? 9;
    if (!seen.has(base) || rank < seen.get(base).rank) seen.set(base, { f, rank });
  }
  return [...seen.values()].map((v) => v.f).sort();
};

// PNG dimensions from the IHDR chunk; 0×0 for formats we don't parse.
const dims = (file) => {
  try {
    if (extname(file).toLowerCase() !== '.png') return { w: 0, h: 0 };
    const b = readFileSync(file);
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } catch { return { w: 0, h: 0 }; }
};

const url = (file) => '/' + relative(PUB, file).replace(/\\/g, '/');
const id = (file) => relative(PUB, file).replace(/\\/g, '/').replace(/^assets\//, '').replace(/\.\w+$/, '');
const titleize = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const setLabel = (setId) => titleize(setId.replace(/-set-\d+$/, ''));
const pieceOf = (file) => titleize(basename(file).replace(/\.\w+$/, ''));

// --- collect groups ---
const bgSets = subdirs(join(PUB, 'assets/backgrounds'));
const worldScenes = [
  ...bgSets.map((d) => join(d, 'world.png')).filter(exists).map((f) => ({ f, label: setLabel(basename(join(f, '..'))), sub: 'world scene' })),
  ...[join(PUB, 'assets/ui/main-menu/background-scene-v1.png')].filter(exists).map((f) => ({ f, label: 'Main menu scene', sub: 'main menu' })),
];
const portraitBgs = bgSets.flatMap((d) => walk(join(d, 'portraits')).map((f) => ({ f, label: pieceOf(f), sub: setLabel(basename(d)) })));
const unitPortraits = subdirs(join(PUB, 'assets/units')).flatMap((d) =>
  walk(join(d, 'portrait')).map((f) => ({ f, label: `${titleize(basename(d))} · ${pieceOf(f)}`, sub: 'team palette' })));
const portraitEditor = subdirs(join(PUB, 'assets/portrait-editor')).flatMap((d) =>
  walk(d).map((f) => ({ f, label: `${titleize(basename(d))} · ${pieceOf(f)}`, sub: 'portrait source' })));
const brandKeyArt = globIn(join(PUB, 'assets/ui'), /^main-menu-(brand|aspirational|button-art)/).map((f) => ({ f, label: titleize(basename(f).replace(/\.\w+$/, '').replace(/-v\d+$/, '')), sub: 'brand / key art' }));
const conceptArt = [
  ...globIn(join(PUB, 'assets/ui'), /-concept\.png$/),
  join(PUB, 'assets/art/skirmish-style-target.png'),
].filter(exists).map((f) => ({ f, label: titleize(basename(f).replace(/\.\w+$/, '')), sub: 'concept' }));
const inspiration = walk(join(PUB, 'assets/artwork/inspiration')).map((f) => ({ f, label: titleize(basename(f).replace(/\.\w+$/, '')), sub: 'ui-screen-concepts' }));
// NOTE: the portrait bake-off candidates (assets/portrait-candidates) are NOT an artwork
// group — they have their own top-level "Portraits" catalog category (built in code from
// the PORTRAIT_METHODS registry), so they get dedicated Unit + Treatment filters.

const rawGroups = [
  { id: 'world-scenes', label: 'World scenes', entries: worldScenes },
  { id: 'portrait-backgrounds', label: 'Portrait backgrounds', entries: portraitBgs },
  { id: 'unit-portraits', label: 'Unit portraits', entries: unitPortraits },
  { id: 'portrait-editor', label: 'Portrait-editor sources', entries: portraitEditor },
  { id: 'brand-key-art', label: 'Brand & key art', entries: brandKeyArt },
  { id: 'concept-art', label: 'Concept art', entries: conceptArt },
  { id: 'inspiration', label: 'Inspiration', entries: inspiration },
];

let total = 0;
const groups = rawGroups.map((g) => {
  const items = dedupe(g.entries.map((e) => e.f)).map((f) => {
    const e = g.entries.find((x) => x.f === f) ?? g.entries.find((x) => x.f.replace(/\.\w+$/, '') === f.replace(/\.\w+$/, ''));
    const { w, h } = dims(f);
    return { id: id(f), label: e?.label ?? pieceOf(f), url: url(f), w, h, sub: e?.sub ?? '' };
  });
  total += items.length;
  return { id: g.id, label: g.label, items };
}).filter((g) => g.items.length);

const manifest = { generated: TODAY, summary: { total, groups: groups.length }, groups };
writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');
console.log(`artwork manifest -> ${relative(FRONTEND, OUT)}`);
console.log(`  ${total} pieces across ${groups.length} groups:`);
for (const g of groups) console.log(`   ${String(g.items.length).padStart(3)}  ${g.label}`);
