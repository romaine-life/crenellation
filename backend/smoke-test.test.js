const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

async function occupy(port, t) {
  const server = http.createServer((_req, res) => res.end('unrelated fixture'));
  await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve();
      else reject(error);
    });
    server.listen(port, '127.0.0.1', resolve);
  });
  if (server.listening) {
    t.after(() => new Promise((resolve) => server.close(resolve)));
  }
}

function smoke(t) {
  const child = spawn(process.execPath, ['smoke-test.js'], {
    cwd: __dirname,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
  });
  return closed.then(({ code, signal }) => {
    assert.equal(code, 0, `Smoke test failed (${signal || code}):\n${output}`);
  });
}

test('concurrent smoke fixtures work with their former ports occupied', { timeout: 60000 }, async (t) => {
  for (const port of [31337, 31338, 31339]) await occupy(port, t);
  await Promise.all([smoke(t), smoke(t)]);
});
