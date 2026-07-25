#!/usr/bin/env node
// Deterministic UI screenshot tool — works on ANY live route, no per-target scaffolding.
//
// Why: the in-editor preview capture hangs on this machine, and naive full-page grabs are
// too many pixels. This drives the installed Chrome via puppeteer-core (no bundled browser
// download), navigates to a real route, freezes animation for determinism, and — given a
// CSS selector — clips the capture to that element's exact bounds. The result is a small,
// focused, repeatable PNG. Read it to view.
//
// Usage:
//   node scripts/shot.mjs <url> [--select <css>] [--out <path>] [--size <WxH>] [--ready <jsExpr>] [--full]
//
// Examples:
//   node scripts/shot.mjs http://127.0.0.1:5199/skirmish --select '[data-testid=skirmish-board]'
//   node scripts/shot.mjs http://127.0.0.1:5199/unit-studio --select '.studio-stage' --out tmp-shots/unit.png
//   node scripts/shot.mjs http://127.0.0.1:5199/doodad-proof/focus.html   (whole small fixture page)

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const argv = process.argv.slice(2);
const url = argv[0];
const flag = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? (argv[i + 1] ?? true) : def; };
const has = (name) => argv.includes(`--${name}`);

const select = flag('select');
const out = resolve(process.cwd(), flag('out', 'tmp-shots/shot.png'));
const [w, h] = String(flag('size', '1280x800')).split('x').map(Number);
const scale = Math.max(1, Number(flag('scale', 1)) || 1); // deviceScaleFactor — bump for small elements
const readyExpr = flag('ready');
const fullPage = has('full');

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = CHROMES.find(existsSync);
if (!url || url.startsWith('--')) { console.error('usage: shot <url> [--select css] [--out path] [--size WxH] [--scale n] [--ready jsExpr] [--full]'); process.exit(2); }
if (!executablePath) { console.error('No Chrome/Edge found. Checked:\n' + CHROMES.join('\n')); process.exit(1); }
mkdirSync(dirname(out), { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '--disable-background-networking',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: scale });
  // Prefer a fully-idle network, but live routes with persistent connections
  // (e.g. the main menu's rain ambience) never reach networkidle0 — fall back to
  // domcontentloaded so those pages still capture. The --ready gate below ensures
  // content is actually present before the grab.
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 8000 })
    .catch(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }));

  // Determinism: kill animations/transitions so a live screen captures identically every run.
  await page.addStyleTag({ content: `*,*::before,*::after{animation:none!important;transition:none!important;animation-duration:0s!important;caret-color:transparent!important;scroll-behavior:auto!important}` });

  // Readiness: explicit gate if given, else a quick best-effort wait on window.__ready (fixtures set it).
  await page.waitForFunction(readyExpr || 'window.__ready===true', { timeout: readyExpr ? 15000 : 1200 }).catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await new Promise((r) => setTimeout(r, 200));

  if (select) {
    const el = await page.$(select);
    if (!el) { console.error(`selector not found: ${select}`); process.exit(3); }
    await el.screenshot({ path: out });
  } else {
    await page.screenshot({ path: out, fullPage });
  }
  const { size } = statSync(out);
  console.log(`wrote ${out} (${(size / 1024).toFixed(1)} KB)`);
} finally {
  await browser.close();
}
