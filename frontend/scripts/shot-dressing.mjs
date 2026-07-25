// One-off: seed the dressing-room localStorage config, then capture the live /settings iframe
// with surfaces applied — proof the injection fills each region. Args: <surface> [tilePx].
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const surface = process.argv[2] || 'hybrid-stone-blue';
const tilePx = Number(process.argv[3] || 1024);
const out = resolve(process.cwd(), process.argv[4] || 'tmp-shots/dressing-applied.png');
const url = 'http://127.0.0.1:5177/tileset-studio?mode=dressing&family=stone';

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = CHROMES.find(existsSync);
mkdirSync(dirname(out), { recursive: true });

// v3 shape: 5 regions, GLOBAL tilePx/offset (continuous via fixed), plus box disable + opacity.
const ST = 'hybrid-stone-blue';
const OAK = 'hybrid-wood-oak';
const scenarios = {
  // buttons + rows get their own surface inside the default (navy) boxes
  elements: { surfaces: { title: null, tabsBox: null, buttons: OAK, rowsBox: null, rows: OAK }, boxDisabled: { tabsBox: false, rowsBox: false }, boxOpacity: { tabsBox: 1, rowsBox: 1 } },
  // both boxes disabled → textured buttons/rows float on the page
  disable: { surfaces: { title: ST, tabsBox: null, buttons: ST, rowsBox: null, rows: OAK }, boxDisabled: { tabsBox: true, rowsBox: true }, boxOpacity: { tabsBox: 1, rowsBox: 1 } },
  // rows box stone at 50% transparency
  transp: { surfaces: { title: ST, tabsBox: ST, buttons: null, rowsBox: ST, rows: null }, boxDisabled: { tabsBox: false, rowsBox: false }, boxOpacity: { tabsBox: 1, rowsBox: 0.5 } },
  // boxes wood; buttons + rows set to "Transparent (see through)" → wood flows through them
  clear: { surfaces: { title: OAK, tabsBox: OAK, buttons: '__clear', rowsBox: OAK, rows: '__clear' }, boxDisabled: { tabsBox: false, rowsBox: false }, boxOpacity: { tabsBox: 1, rowsBox: 1 } },
};
const pick = scenarios[process.env.SCENARIO] || { surfaces: { title: surface, tabsBox: surface, buttons: surface, rowsBox: surface, rows: surface }, boxDisabled: { tabsBox: false, rowsBox: false }, boxOpacity: { tabsBox: 1, rowsBox: 1 } };
const cfg = { ...pick, tilePx, offsetX: 0, offsetY: 0 };

const browser = await puppeteer.launch({
  executablePath, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: Number(process.env.DSF || 1) });
  // Seed storage on the right origin, then navigate so the component reads it on mount.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  await page.evaluate((config) => {
    localStorage.setItem('chess-tactics:surface-dressing:v3', JSON.stringify(config));
  }, cfg);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
  // Wait until the injected style is present inside the iframe.
  await page.waitForFunction(() => {
    const f = document.querySelector('.surface-dressing-frame');
    const doc = f && f.contentDocument;
    const style = doc && doc.getElementById('surface-dressing');
    return style && style.textContent && style.textContent.includes('background');
  }, { timeout: 12000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  if (process.env.BREAK === '1') {
    // Re-apply a transform to the settings screen to reproduce the OLD broken continuity (each
    // element restarts the fixed surface from its own corner) for before/after comparison.
    await page.evaluate(() => {
      const d = document.querySelector('.surface-dressing-frame').contentDocument;
      const s = d.createElement('style');
      s.textContent = '[data-testid="settings"] .settings-screen{transform:translate(0px,0px) !important;}';
      d.head.appendChild(s);
    });
    await new Promise((r) => setTimeout(r, 300));
  }
  const el = process.env.FULL === '1' ? null : await page.$('.surface-dressing-main');
  if (el) await el.screenshot({ path: out });
  else await page.screenshot({ path: out });
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
