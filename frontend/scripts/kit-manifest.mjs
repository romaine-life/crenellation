// Generates the kit health manifest the /design catalog's Kit branch reads.
// Runs the glyph gate over every kit glyph and records dims for the frames, so
// the catalog can show what exists AND whether it's verified — no separate page.
// Re-run after changing kit assets:  node frontend/scripts/kit-manifest.mjs
import { PNG } from 'pngjs';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const KIT = `${root}public/assets/ui/kit/`;
const URLBASE = '/assets/ui/kit/';
const listPng = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.png') && !f.includes('@2x')).sort() : []);

// mirrors verifyGlyph() in verify-kit-asset.mjs: magenta despill + edge bleed
// are the only FAILS. semiPct (anti-aliasing) is recorded for info only — it is
// NOT a defect; soft edges are expected and good. (Don't reintroduce a binary-
// alpha fail here — that's the bug we removed.)
function glyph(path) {
  const p = PNG.sync.read(readFileSync(path)); const { width: w, height: h, data: d } = p;
  let magenta = 0, semi = 0, edge = 0;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
    if (a > 60 && r > g + 30 && b > g + 30) magenta += 1;
    if (a > 0 && a < 255) semi += 1;
    if ((x < 1 || y < 1 || x >= w - 1 || y >= h - 1) && a > 40) edge += 1;
  }
  const semiPct = +(100 * semi / (w * h)).toFixed(1);
  const fails = [];
  if (magenta > Math.max(12, Math.round(w * h * 0.004))) fails.push(`magenta ${magenta}`);
  if (edge > 6) fails.push(`edge ${edge}`);
  return { w, h, magenta, semiPct, edge, pass: fails.length === 0, fails };
}
const dims = (path) => { const p = PNG.sync.read(readFileSync(path)); return { w: p.width, h: p.height }; };

const groups = [
  { id: 'settings', label: 'Settings icons', dir: 'icons' },
  { id: 'game', label: 'Game icons · skirmish HUD', dir: 'icons/game' },
  { id: 'shields', label: 'Faction shields · campaign editor', dir: 'icons/shields' },
].map((g) => ({
  id: g.id,
  label: g.label,
  items: listPng(`${KIT}${g.dir}`).map((f) => ({ name: f.replace('.png', ''), url: `${URLBASE}${g.dir}/${f}`, ...glyph(`${KIT}${g.dir}/${f}`) })),
}));

const frameNames = ['panel', 'row', 'button-neutral', 'button-primary', 'button-danger', 'mode-button', 'mode-button-active', 'field-input', 'field-select', 'icon-button', 'icon-button-active', 'toggle-track', 'toggle-knob', 'divider'];
const frames = frameNames.filter((n) => existsSync(`${KIT}${n}.png`)).map((n) => ({ name: n, url: `${URLBASE}${n}.png`, ...dims(`${KIT}${n}.png`) }));

const allGlyphs = groups.flatMap((g) => g.items);
const manifest = {
  generated: new Date().toISOString().slice(0, 10),
  gate: 'verify-kit-asset.mjs --glyph (transparency hygiene: magenta despill + edge bleed; anti-aliasing allowed)',
  summary: { pass: allGlyphs.filter((a) => a.pass).length, total: allGlyphs.length, frames: frames.length },
  groups,
  frames,
};

const out = `${root}src/ui/design/kitManifest.json`;
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`kit manifest -> ${out}\n  glyphs ${manifest.summary.pass}/${manifest.summary.total} pass · frames ${frames.length}`);
