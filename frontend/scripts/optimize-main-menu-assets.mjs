#!/usr/bin/env node
// Deterministic optimizer for the main-menu first-visit image payload.
//
// Reads the target list from src/ui/design/optimized-images.json (the single
// source of truth shared with the runtime) and emits an AVIF and a WebP
// derivative next to each PNG source. The PNG sources stay checked in and
// authoritative; these derivatives are the runtime-preferred formats, with the
// PNG kept as the universal fallback (see catalogData.imageSetFor, style.css,
// and MainMenu.tsx <picture>).
//
// sharp is a dev-only tool and is intentionally NOT a committed dependency
// (it ships large native binaries we don't want in CI installs). Run:
//   npm --prefix frontend install --no-save sharp
//   npm --prefix frontend run optimize:assets
// The encode params live in the JSON, so derivatives are reproducible.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = join(here, '..');
const publicDir = join(frontendDir, 'public');
const manifestPath = join(frontendDir, 'src', 'ui', 'design', 'optimized-images.json');

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('sharp is not installed. Run: npm --prefix frontend install --no-save sharp');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const targets = manifest.targets || [];
if (!targets.length) {
  console.error('No targets in optimized-images.json');
  process.exit(1);
}

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const sizeOf = (p) => {
  try { return statSync(p).size; } catch { return 0; }
};

let totalPng = 0;
let totalAvif = 0;
let totalWebp = 0;
const rows = [];

for (const target of targets) {
  const urlPath = target.path;
  const pngFile = join(publicDir, urlPath.replace(/^\//, ''));
  if (!urlPath.endsWith('.png')) {
    console.error(`Target is not a .png: ${urlPath}`);
    process.exit(1);
  }
  const pngBytes = sizeOf(pngFile);
  if (!pngBytes) {
    console.error(`Missing source PNG: ${pngFile}`);
    process.exit(1);
  }

  const base = pngFile.slice(0, -'.png'.length);
  const avifFile = `${base}.avif`;
  const webpFile = `${base}.webp`;

  const avifOpts = { quality: 55, effort: 6, ...(target.avif || {}) };
  const webpOpts = { quality: 82, effort: 6, ...(target.webp || {}) };

  // alphaQuality keeps button/title alpha edges crisp; chromaSubsampling 4:4:4
  // avoids color bleed on the painted UI art.
  await sharp(pngFile)
    .avif({ quality: avifOpts.quality, effort: avifOpts.effort, chromaSubsampling: '4:4:4' })
    .toFile(avifFile);
  await sharp(pngFile)
    .webp({ quality: webpOpts.quality, effort: webpOpts.effort, alphaQuality: 100 })
    .toFile(webpFile);

  const avifBytes = sizeOf(avifFile);
  const webpBytes = sizeOf(webpFile);
  totalPng += pngBytes;
  totalAvif += avifBytes;
  totalWebp += webpBytes;

  rows.push({
    path: urlPath,
    png: pngBytes,
    avif: avifBytes,
    webp: webpBytes,
  });
  console.log(
    `${urlPath}\n  png ${kib(pngBytes)}  ->  avif ${kib(avifBytes)} (-${(100 - (avifBytes / pngBytes) * 100).toFixed(0)}%)  webp ${kib(webpBytes)} (-${(100 - (webpBytes / pngBytes) * 100).toFixed(0)}%)`,
  );
}

console.log('\n=== totals ===');
console.log(`PNG  : ${kib(totalPng)}`);
console.log(`AVIF : ${kib(totalAvif)}  (-${(100 - (totalAvif / totalPng) * 100).toFixed(0)}% vs PNG)`);
console.log(`WebP : ${kib(totalWebp)}  (-${(100 - (totalWebp / totalPng) * 100).toFixed(0)}% vs PNG)`);
console.log('\nDerivatives written next to PNG sources. Commit them alongside the originals.');
