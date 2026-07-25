// Migration guard (PR: rebuild main-menu profile/news/dock chrome as DOM components).
// The generated `main-menu-{profile,news,dock}-chrome-v1.png` bitmaps were replaced
// end-to-end by live DOM + inline-SVG components. They must not return to live code.
// Fails the build if a reference or asset reappears.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FORBIDDEN = /main-menu-(profile|news|dock)-chrome-v1/;
const failures = [];

// Scan the whole live source tree (+ index.html) so the guard holds regardless
// of which files exist — app.js, the original carrier, was retired.
function collectFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...collectFiles(p));
    else if (/\.(ts|tsx|js|jsx|css)$/.test(name)) out.push(p);
  }
  return out;
}

for (const file of [...collectFiles(join(root, 'src')), join(root, 'index.html')]) {
  const rel = file.slice(root.length + 1);
  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (FORBIDDEN.test(line)) failures.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
}

for (const png of [
  'public/assets/ui/main-menu-profile-chrome-v1.png',
  'public/assets/ui/main-menu-news-chrome-v1.png',
  'public/assets/ui/main-menu-dock-chrome-v1.png',
]) {
  if (existsSync(join(root, png))) failures.push(`retired asset still present: ${png}`);
}

if (failures.length) {
  console.error('Migration guard FAILED — retired main-menu chrome bitmaps reintroduced:');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('Migration guard OK: no retired *-chrome-v1 chrome bitmaps in live code.');
