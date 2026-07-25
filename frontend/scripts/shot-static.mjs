#!/usr/bin/env node
// Screenshot a STATIC page from this checkout's public/ dir, self-contained — spins up a
// throwaway static file server over ./public on an ephemeral port and drives the installed
// Chrome via puppeteer-core. Use this for local comparison/mockup HTML in public/: it avoids
// the app dev server entirely, so there's no SPA history-fallback (which serves index.html
// for unknown paths) and no Vite HMR socket (which makes `networkidle0` hang forever). It
// also means the page reflects THIS worktree's files, not whatever checkout the dev server
// happens to be rooted in.
//
//   node scripts/shot-static.mjs <pathUnderPublic> --select <css> [--out <path>] [--size WxH] [--scale N]
//   node scripts/shot-static.mjs surface-explore.html --select '#stone-group' --out tmp-shots/stone.png
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const argv = process.argv.slice(2);
const pagePath = argv[0];
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const select = flag('select');
const out = resolve(process.cwd(), flag('out', 'tmp-shots/shot.png'));
const [w, h] = String(flag('size', '1400x900')).split('x').map(Number);
const scale = Number(flag('scale', 2));
if (!pagePath || pagePath.startsWith('--')) { console.error('usage: shot-static <pathUnderPublic> --select <css> [--out p] [--size WxH] [--scale N]'); process.exit(2); }

const PUBLIC = join(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const data = await readFile(join(PUBLIC, rel));
    res.writeHead(200, { 'content-type': MIME[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = CHROMES.find(existsSync);
if (!executablePath) { console.error('No Chrome/Edge found.'); process.exit(1); }
mkdirSync(dirname(out), { recursive: true });

const browser = await puppeteer.launch({
  executablePath, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: scale });
  await page.goto(`http://127.0.0.1:${port}/${pagePath}`, { waitUntil: 'load', timeout: 20000 });
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  const target = select ? await page.$(select) : page;
  if (select && !target) { console.error(`selector not found: ${select}`); process.exit(1); }
  await target.screenshot({ path: out });
  console.log(`shot -> ${out}`);
} finally {
  await browser.close();
  server.close();
}
