import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const [key, inlineValue] = arg.slice(2).split('=');
  const value = inlineValue ?? process.argv[index + 1];
  if (inlineValue === undefined) index += 1;
  args.set(key, value);
}

const url = args.get('url') ?? 'http://localhost:3000/';
const out = resolve(args.get('out') ?? '../.pwshot/local-page.png');
const width = Number(args.get('width') ?? 1280);
const height = Number(args.get('height') ?? 720);
const budget = Number(args.get('budget') ?? 8000); // --timeout cap (ms); normal pages still capture at load

const candidates = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const browser = candidates.find((candidate) => existsSync(candidate));
if (!browser) {
  console.error('No Chrome/Edge executable found. Set CHROME_PATH to a Chromium-family browser.');
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
const profile = resolve('../.pwshot/chrome-profile');
const chromeArgs = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  `--window-size=${width},${height}`,
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
  // --timeout (cap the wait, then capture) instead of --virtual-time-budget.
  // virtual-time advances a fake clock and waits for network IDLE, which hangs
  // forever on pages that never go idle — e.g. the main menu's rain ambience
  // keeps a socket open. --timeout captures after load, or after `budget` ms for
  // never-idle pages, so every surface is screenshottable. The two are mutually
  // exclusive (combining them crashes the renderer).
  `--timeout=${budget}`,
  `--screenshot=${out}`,
  url,
];

// Hard wall-clock cap so a wedged Chrome can never hang the caller.
const result = spawnSync(browser, chromeArgs, { encoding: 'utf8', timeout: budget + 8000, killSignal: 'SIGKILL' });
if (result.status !== 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

if (!existsSync(out) || statSync(out).size === 0) {
  console.error(`Browser exited successfully but did not write a screenshot: ${out}`);
  process.exit(1);
}

console.log(JSON.stringify({ out, url, width, height, browser }, null, 2));
