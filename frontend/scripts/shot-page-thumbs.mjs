#!/usr/bin/env node
// Generate the Studio "Pages" catalog thumbnails — one downscaled hero shot per app screen.
//
// Each entry in pagesCatalog.ts is a card; without a thumbnail it falls back to the page's
// initial. This drives the installed Chrome (puppeteer-core, no bundled download) against a
// RUNNING dev server, captures each real route's above-the-fold viewport, and downscales it
// in-capture via a fractional deviceScaleFactor (no sharp dependency) to a small webp written
// under public/assets/ui/pages/. Re-run whenever a page's chrome changes.
//
// Usage:
//   node scripts/shot-page-thumbs.mjs [--base http://127.0.0.1:5186]
//
// The PAGES list below MUST mirror PAGE_ENTRIES in src/ui/pagesCatalog.ts (name + route).

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? (argv[i + 1] ?? true) : def; };
const base = String(flag('base', 'http://127.0.0.1:5186')).replace(/\/+$/, '');

// name = pagesCatalog id (→ <name>.webp); route = the real app route.
const PAGES = [
  { name: 'main-menu', route: '/' },
  { name: 'settings', route: '/settings' },
  { name: 'skirmish', route: '/play' },
  { name: 'campaign-editor', route: '/campaigns-next' },
  { name: 'level-editor', route: '/edit' },
  { name: 'lobbies', route: '/lobbies' },
];

// Capture at a full desktop layout (1280x800 CSS px) but render at half DPI, so the saved webp
// is a crisp 640x400 — small enough for a card, with the real desktop layout (not a mobile reflow).
const VW = 1280, VH = 800, SCALE = 0.5;
const OUT_DIR = resolve(process.cwd(), 'public/assets/ui/pages');

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = CHROMES.find(existsSync);
if (!executablePath) { console.error('No Chrome/Edge found. Checked:\n' + CHROMES.join('\n')); process.exit(1); }
mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '--disable-background-networking',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars'],
});
try {
  for (const { name, route } of PAGES) {
    const page = await browser.newPage();
    await page.setViewport({ width: VW, height: VH, deviceScaleFactor: SCALE });
    const url = `${base}${route}`;
    // Live routes hold open sockets (HMR, the menu's rain ambience) and never reach networkidle0 —
    // fall back to domcontentloaded so those pages still capture (mirrors shot.mjs).
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 8000 })
      .catch(() => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }));
    // Determinism: freeze animation/transition so each grab is identical run-to-run.
    await page.addStyleTag({ content: `*,*::before,*::after{animation:none!important;transition:none!important;animation-duration:0s!important;caret-color:transparent!important;scroll-behavior:auto!important}` });
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    // Heavy routes (skirmish, level/campaign editor) lazy-load their chunk + render a board after
    // mount — give the SPA a generous settle before the grab.
    await new Promise((r) => setTimeout(r, 1800));
    const out = resolve(OUT_DIR, `${name}.webp`);
    await page.screenshot({ path: out, type: 'webp', quality: 82 });
    const { size } = statSync(out);
    console.log(`${name.padEnd(16)} ${route.padEnd(16)} -> ${out} (${(size / 1024).toFixed(1)} KB)`);
    await page.close();
  }
} finally {
  await browser.close();
}
