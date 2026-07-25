#!/usr/bin/env node
// Vendor the ambience rain client into this repo.
//
// Chess Tactics' main menu shows cross-client-synchronized rain by subscribing
// to ambience's rain-pinned `/chess` world. Rather than load ambience's runtime
// from its server at runtime (brittle: unversioned, cache-drifts, and a stale
// client mis-renders), we VENDOR a pinned snapshot of the client into
// frontend/public/ambience/ and bundle it. At runtime the menu loads its own
// copy; only the SSE stream talks to ambience.
//
// The capability handshake (the world advertises servedEffects; this client
// asserts it supports them) is the backstop if the vendored client and the
// world ever drift.
//
// Usage:
//   node scripts/vendor-ambience.mjs            # from https://ambience.romaine.life
//   AMBIENCE_BASE=https://ambience.dev.romaine.life node scripts/vendor-ambience.mjs
//
// Run this once after ambience ships a new client version, then commit the
// updated frontend/public/ambience/ (including manifest.json). The fetched
// ambience-rain.wasm is the rain-scoped artifact (-tags rainonly), much smaller
// than the full all-effects bundle.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.AMBIENCE_BASE || 'https://ambience.romaine.life').replace(/\/+$/, '');

// The rain client bundle: shared runtime JS + the rain-scoped WASM. sim.js and
// client.js are ambience's canonical consumer runtime; ambience-rain.wasm is the
// effect-scoped artifact this single-effect consumer needs.
const FILES = ['sim.js', 'client.js', 'wasm_runtime.js', 'wasm_exec.js', 'ambience-rain.wasm'];

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'public', 'ambience');

async function main() {
  await mkdir(outDir, { recursive: true });
  const manifest = { base: BASE, files: {} };
  for (const name of FILES) {
    const url = `${BASE}/${name}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`vendor-ambience: ${url} -> HTTP ${res.status}. ` +
        'Is the ambience version with the rain client deployed at this base?');
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    await writeFile(resolve(outDir, name), bytes);
    manifest.files[name] = bytes.length;
    console.log(`vendored ${name} (${bytes.length} bytes)`);
  }
  await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nWrote ${FILES.length} files + manifest.json to public/ambience/ from ${BASE}`);
  console.log('Commit the result to pin this version.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
