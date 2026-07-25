// Shared kit for baking /nine-slice-editor configs into committed assets.
//
// One place defines, per asset: which atoms it uses, its frame size, and which
// output PNGs (incl. palette-swapped variants like the cyan active state). The
// apply CLI (apply-nine-slice.mjs) and the per-asset generators both go through
// buildAsset(), so there is a SINGLE bake implementation and the editor's offsets
// can't diverge between tools.
//
// What bakes into the PNG vs not:
//   - bracket offset  -> shifts the warm gold pixels in the corner atom (baked)
//   - keyline offset  -> INERT (ignored). The border is continuous by construction
//                        (atoms + flipSides); a keyline nudge is not bakeable, so the
//                        editor doesn't expose it and the bake ignores it (warns if set).
//   - content         -> consumption-side (element padding / where text+icons
//                        start). NOT baked into the PNG; recorded in the config.
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildFrameFrom } from './assemble-frame.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const ATOMS = `${root}public/assets/ui/kit/atoms/`;
export const KIT = `${root}public/assets/ui/kit/`;
// Transparent-interior "line" variants (ornament only) live here, beside panel-line.png.
// They are the fix for the 9-slice fill problem (see bakeLine / ADR-0034).
export const LINE_DIR = `${root}public/assets/ui/explore/frames/`;
export const CONFIG_DIR = `${root}config/nine-slice/`;

// Single source of truth — the SAME registry the in-app editor and the catalog
// edit-link read (config/nine-slice/registry.json). Add a frame there and it
// becomes bakeable, editable, and catalog-linked with no code change here.
const REG = JSON.parse(readFileSync(`${root}config/nine-slice-registry.json`, 'utf8'));
const PALETTES = REG.palettes ?? {};
// Resolve each variant's palette name (e.g. "gold2cyan") to its actual swap map.
export const REGISTRY = Object.fromEntries(Object.entries(REG.assets).map(([id, a]) => [id, {
  ...a,
  variants: a.variants.map((v) => ({ ...v, swap: v.swap ? PALETTES[v.swap] : undefined })),
}]));

const hex = (r, g, b) => `${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
const isWarm = (r, g, b, a) => a > 40 && r > b + 15; // gold ramp is warm; keyline/navy are cool
const loadAtom = (n) => PNG.sync.read(readFileSync(`${ATOMS}${n}.png`));

// New image holding only the kept pixels, shifted by (dx,dy).
function layer(src, dx, dy, keep) {
  const { width: w, height: h } = src; const o = new PNG({ width: w, height: h }); o.data.fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const r = src.data[i], g = src.data[i + 1], b = src.data[i + 2], a = src.data[i + 3];
    if (!keep(r, g, b, a)) continue;
    const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const j = (ny * w + nx) * 4; o.data[j] = r; o.data[j + 1] = g; o.data[j + 2] = b; o.data[j + 3] = a;
  }
  return o;
}
function over(base, top) {
  const o = new PNG({ width: base.width, height: base.height }); base.data.copy(o.data);
  for (let i = 0; i < top.data.length; i += 4) if (top.data[i + 3] > 0) { o.data[i] = top.data[i]; o.data[i + 1] = top.data[i + 1]; o.data[i + 2] = top.data[i + 2]; o.data[i + 3] = top.data[i + 3]; }
  return o;
}
// Tune a corner: the warm gold bracket is shifted by `bracket`; the cool keyline
// base is NOT moved. keyline is inert by design — the border is continuous by
// construction (atoms + flipSides), and moving only the corner keyline (while the
// edges stay fixed) would diverge from the editor preview. The editor matches this
// (it renders the corner/edges at keyline 0). gold's vacated cells go transparent
// so the fill shows through.
function tuneCorner(corner, cfg) {
  const base = layer(corner, 0, 0, (r, g, b, a) => a > 40 && !isWarm(r, g, b, a));
  const gold = layer(corner, cfg.bracket.dx, cfg.bracket.dy, isWarm);
  return over(base, gold);
}
// Carve navy bleed outside the rail back to transparent: flood from the canvas
// edges across dark navy, stopping at the brighter rail (which encloses the
// interior, so interior navy is untouched). Ported from generate-row.
const RAIL_MIN = 45; // max-channel >= this is rail; below is navy/fill (carveable)
function carveExterior(png) {
  const { width: w, height: h, data } = png;
  const i4 = (x, y) => (y * w + x) * 4;
  const isNavy = (x, y) => { const i = i4(x, y); return data[i + 3] > 20 && Math.max(data[i], data[i + 1], data[i + 2]) < RAIL_MIN; };
  const seen = new Uint8Array(w * h); const stack = [];
  const push = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const p = y * w + x; if (seen[p]) return; seen[p] = 1; stack.push(x, y); };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const y = stack.pop(); const x = stack.pop();
    if (!isNavy(x, y)) continue;
    data[i4(x, y) + 3] = 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return png;
}

export function swapPalette(src, map) {
  const o = new PNG({ width: src.width, height: src.height }); src.data.copy(o.data);
  for (let i = 0; i < o.data.length; i += 4) {
    if (o.data[i + 3] === 0) continue;
    const t = map[hex(o.data[i], o.data[i + 1], o.data[i + 2])];
    if (t) { o.data[i] = parseInt(t.slice(0, 2), 16); o.data[i + 1] = parseInt(t.slice(2, 4), 16); o.data[i + 2] = parseInt(t.slice(4, 6), 16); }
  }
  return o;
}

export const SAVE_LOG = `${CONFIG_DIR}save-log.jsonl`;

// Append-only audit trail of every bake, so a save is detectable on the filesystem
// (not just in the browser). Each line: when, where it came from, the asset, the
// exact config written, and the output files. Read SAVE_LOG to see what changed.
export function logSave(source, asset, cfg, written) {
  const entry = { ts: new Date().toISOString(), source, asset, config: cfg, written };
  try { mkdirSync(CONFIG_DIR, { recursive: true }); appendFileSync(SAVE_LOG, `${JSON.stringify(entry)}\n`); } catch { /* logging must never break a bake */ }
  return entry;
}

export function normalizeConfig(c) {
  return {
    asset: c.asset,
    keyline: { dx: c.keyline?.dx ?? 0, dy: c.keyline?.dy ?? 0 },
    bracket: { dx: c.bracket?.dx ?? 0, dy: c.bracket?.dy ?? 0 },
    // 0 = no content inset. MUST stay in sync with NineSliceEditor's DEFAULT_CONTENT
    // (src/ui/NineSliceEditor.tsx) so an unsaved asset previews what it would bake.
    content: c.content ?? 0,
    // `fill` = uniform inset (px) from the footprint to the FILL boundary: where a surface
    // painted behind this frame should stop. The frame's ornament can bleed OUTSIDE this box
    // (corners extend out to feel alive), so the fill boundary is distinct from the footprint.
    // Consumption-side like `content` (not baked into the PNG); 0 = fill to the footprint edge.
    fill: c.fill ?? 0,
  };
}
export function loadConfig(assetId) {
  return normalizeConfig(JSON.parse(readFileSync(`${CONFIG_DIR}${assetId}.json`, 'utf8')));
}

// Bake an asset to in-memory PNGs WITHOUT writing — the pure core shared by
// buildAsset (which writes) and the bake parity test (which compares the result
// against the committed PNGs), so the writer and the test can never disagree about
// what a config bakes to. Returns { variants:[{out, png, inspect, inspectPng}], warns, note }.
export function bakeAsset(assetId, cfgRaw) {
  const rec = REGISTRY[assetId];
  if (!rec) throw new Error(`nine-slice-kit: unknown asset "${assetId}" (known: ${Object.keys(REGISTRY).join(', ')})`);
  const cfg = normalizeConfig({ ...cfgRaw, asset: assetId });
  const corner = tuneCorner(loadAtom(rec.atoms.corner), cfg);
  const edge = loadAtom(rec.atoms.edge), fill = loadAtom(rec.atoms.fill);
  const { w, h } = rec.frame;
  const warns = [];
  if (cfg.keyline.dx || cfg.keyline.dy) warns.push('keyline offset is IGNORED — the border is fixed/continuous by construction; set keyline to 0,0');
  const variants = rec.variants.map((v) => {
    // A variant's palette swap recolors the WHOLE frame (corner + edge + fill), so an
    // active/selected state can change the body + borders, not just the corner accent.
    const c = v.swap ? swapPalette(corner, v.swap) : corner;
    const e = v.swap ? swapPalette(edge, v.swap) : edge;
    const fl = v.swap ? swapPalette(fill, v.swap) : fill;
    const frame = buildFrameFrom(c, e, fl, w, h, !!rec.flipSides);
    if (rec.carve) carveExterior(frame);
    return { out: v.out, png: frame, inspect: v.inspect ?? null, inspectPng: v.inspect ? c : null };
  });
  const note = cfg.content ? `content ${cfg.content}px → ${rec.consume ? rec.consume.cssVar + ' (CSS)' : 'consumption-side'}` : null;
  return { variants, warns, note };
}

// Bake one asset from its config and WRITE the variant PNGs (and any inspection
// atom). Returns { written, warns, note } for the caller to report.
export function buildAsset(assetId, cfgRaw) {
  const { variants, warns, note } = bakeAsset(assetId, cfgRaw);
  const written = [];
  for (const v of variants) {
    writeFileSync(`${KIT}${v.out}`, PNG.sync.write(v.png));
    written.push(v.out);
    if (v.inspectPng) writeFileSync(`${ATOMS}${v.inspect}.png`, PNG.sync.write(v.inspectPng));
  }
  // Frames flagged with a `line` output also get their transparent-interior twin baked, so the
  // line variant can never drift from the filled frame (same atoms, same corner tune).
  const rec = REGISTRY[assetId];
  if (rec && rec.line) {
    writeFileSync(`${LINE_DIR}${rec.line}`, PNG.sync.write(bakeLine(assetId)));
    written.push(`explore/frames/${rec.line}`);
  }
  return { written, warns, note };
}

// Bake an ornament-only (transparent-interior) variant of an asset's frame: the SAME
// tuned corner + edge atoms, but a fully transparent fill, and every remaining dark
// (navy) pixel masked back to transparent so only the bright rail/ornament survives.
// A surface painted behind the element then shows straight through the 9-slice instead
// of the baked navy fill. This is the GENERAL fix for the "navy ring" 9-slice fill
// problem (cf. the hand-made panel-line.png): dropping border-image `fill` alone is not
// enough because the 8 edge slices still carry the fill colour inward.
export function bakeLine(assetId) {
  const rec = REGISTRY[assetId];
  if (!rec) throw new Error(`nine-slice-kit: unknown asset "${assetId}" (known: ${Object.keys(REGISTRY).join(', ')})`);
  let cfg; try { cfg = loadConfig(assetId); } catch { cfg = normalizeConfig({ asset: assetId }); }
  const corner = tuneCorner(loadAtom(rec.atoms.corner), cfg);
  const edge = loadAtom(rec.atoms.edge);
  const fillAtom = loadAtom(rec.atoms.fill);
  // Assemble from the corner + edge atoms with a TRANSPARENT fill. The navy interior lives
  // ENTIRELY in the fill atom, so this alone is the full ornament over a see-through center —
  // nothing to mask, nothing to carve. (Two cleanup passes were tried and rejected: a dark-pixel
  // MASK ate dark ornament down to a keyline; carveExterior ate a dark rail's outer bevel,
  // pulling the frame off the element edge so surface spilled outside it. A line frame must be
  // an ornament that reaches the element EDGE — corner brackets do; a continuous inset rail does
  // not, so a surfaced row uses the bracket frame, not its own rail. See ADR-0034 §D.)
  const clearFill = new PNG({ width: fillAtom.width, height: fillAtom.height }); clearFill.data.fill(0);
  const { w, h } = rec.frame;
  return buildFrameFrom(corner, edge, clearFill, w, h, !!rec.flipSides);
}

// Compare a freshly baked variant PNG to its committed file on disk, returning a
// plain serializable result so a (type-checked) test can assert bake parity without
// importing pngjs/fs/Buffer itself. Used by the nine-slice bake regression test.
export function diffCommitted(out, freshPng, dir = KIT) {
  const committed = PNG.sync.read(readFileSync(`${dir}${out}`));
  const sameSize = committed.width === freshPng.width && committed.height === freshPng.height;
  return {
    out,
    sameSize,
    samePixels: sameSize && Buffer.compare(committed.data, freshPng.data) === 0,
    committed: { w: committed.width, h: committed.height },
    fresh: { w: freshPng.width, h: freshPng.height },
  };
}

// Write the generated stylesheet that carries each asset's `content` into CSS as a
// custom property the consuming rule reads (e.g. .settings-tab padding). This is how
// `content` reaches the live element — same source of truth as the PNGs (the config).
// Aggregates ALL assets so the file is complete; called after any bake.
export function writeGeneratedCss() {
  const lines = [];
  for (const [id, rec] of Object.entries(REGISTRY)) {
    if (!rec.consume) continue;
    let cfg; try { cfg = loadConfig(id); } catch { continue; }
    lines.push(`  ${rec.consume.cssVar}: ${cfg.content}px; /* ${id} · ${rec.consume.selector} */`);
  }
  const css = `/* GENERATED by nine-slice-kit (apply-nine-slice / dev Save) — do not edit by hand.\n   Source of truth: config/nine-slice/<asset>.json */\n:root {\n${lines.join('\n')}\n}\n`;
  const dir = `${root}src/generated/`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}nine-slice.css`, css);
  return 'src/generated/nine-slice.css';
}
