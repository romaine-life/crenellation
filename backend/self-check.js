// The image's self-test (`--self-test`, which pipeline-templates' web image check runs on a
// read-only container): the image holds a complete frontend build (its page and every script
// and stylesheet of its own that the page loads), and every entry point the deployment starts
// parses. Its result is the exit code.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const failures = [];
const dist = process.env.FRONTEND_DIR || path.join(__dirname, '..', 'frontend', 'dist');
try {
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="(\/[^"]+)"/g)].map((m) => m[1]);
  const styles = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="(\/[^"]+)"/g)].map((m) => m[1]);
  if (!scripts.some((p) => p.endsWith('.js'))) failures.push('the page loads no built script');
  for (const asset of [...scripts, ...styles]) {
    const file = path.join(dist, asset);
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) failures.push(`${asset} is missing or empty`);
  }
} catch (error) {
  failures.push(`frontend build: ${error.message}`);
}
for (const entry of ['server.js', 'supervisor.js']) {
  const result = spawnSync(process.execPath, ['--check', path.join(__dirname, entry)], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${entry} doesn't parse: ${(result.stderr || '').trim().split('\n')[0]}`);
}

if (failures.length) {
  console.error(`crenellation self-test failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('crenellation self-test passed');
}
