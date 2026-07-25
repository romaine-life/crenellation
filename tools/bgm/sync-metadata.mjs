#!/usr/bin/env node
// Mirror each BGM track's ID3 tag onto its blob as metadata (title/artist/album).
//
// The blob container is the single source of truth for the soundtrack: you add or
// remove tracks in the container directly (Azure portal / Storage Explorer), and
// the backend lists it live to build /api/bgm. Titles are read from each blob's
// `title`/`artist`/`album` metadata. This tool seeds that metadata from the mp3's
// own ID3 tag so you don't have to type it — and it's the editable source of
// truth thereafter (hand-edit it in the portal anytime; this won't clobber it).
//
// It is OPTIONAL convenience, not part of any serving path: run it once after a
// batch of uploads, or never (then titles fall back to the blob filename until
// you set metadata by hand). Idempotent and non-clobbering by default.
//
// Auth: DefaultAzureCredential — `az login` locally, or the workflow's OIDC
// federation in CI. Needs Storage Blob Data Contributor on the account
// (tofu: azurerm_role_assignment.bgm_metadata_writer).
//
// Usage:
//   node tools/bgm/sync-metadata.mjs [--base <containerUrl>] [--force] [--dry-run]
//     --base      public container base URL
//                 (default https://chesstacticsmedia.blob.core.windows.net/bgm)
//     --account   storage account name   (overrides the account from --base)
//     --container container name          (overrides the container from --base)
//     --force     overwrite title metadata even when already set
//     --dry-run   report what would change without writing
import process from 'node:process';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { fetchId3 } from '../../frontend/scripts/id3.mjs';

function parseArgs(argv) {
  const args = { flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--force' || a === '--dry-run') args.flags.add(a.slice(2));
    else if (a.startsWith('--')) { args[a.slice(2)] = argv[i + 1]; i += 1; }
  }
  return args;
}

// Same readable fallback the backend uses (backend/server.js: bgmTitleFromName).
function titleFromName(file) {
  const base = String(file).replace(/\.mp3$/i, '').replace(/^\d+\s*[-._\s]\s*/, '');
  const words = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1)) || String(file);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = (args.base || 'https://chesstacticsmedia.blob.core.windows.net/bgm').replace(/\/+$/, '');
  const u = new URL(base);
  const accountUrl = args.account ? `https://${args.account}.blob.core.windows.net` : `${u.protocol}//${u.host}`;
  const containerName = args.container || u.pathname.replace(/^\/+/, '');
  const force = args.flags.has('force');
  const dryRun = args.flags.has('dry-run');

  const service = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
  const container = service.getContainerClient(containerName);

  let set = 0; let skipped = 0; let failed = 0; let total = 0;
  for await (const blob of container.listBlobsFlat({ includeMetadata: true })) {
    if (!/\.mp3$/i.test(blob.name)) continue;
    total += 1;
    const existing = blob.metadata || {};
    if (existing.title && existing.title.trim() && !force) {
      skipped += 1;
      continue;
    }
    const publicUrl = `${base}/${encodeURIComponent(blob.name)}`;
    const tags = await fetchId3(publicUrl);
    const next = { ...existing };
    next.title = tags.title || titleFromName(blob.name);
    if (tags.artist) next.artist = tags.artist; else delete next.artist;
    if (tags.album) next.album = tags.album; else delete next.album;

    const summary = `${blob.name} -> title="${next.title}"${next.artist ? ` artist="${next.artist}"` : ''}${next.album ? ` album="${next.album}"` : ''}`;
    if (dryRun) { console.log(`would set ${summary}`); set += 1; continue; }
    try {
      await container.getBlockBlobClient(blob.name).setMetadata(next);
      console.log(`set ${summary}`);
      set += 1;
    } catch (err) {
      // Azure metadata values must be ASCII; a non-ASCII title fails here and the
      // track simply falls back to its filename until set by hand in the portal.
      console.warn(`FAILED ${blob.name}: ${err.message}`);
      failed += 1;
    }
  }
  console.log(`\n${dryRun ? 'dry-run: ' : ''}${set} set, ${skipped} kept (already titled), ${failed} failed, ${total} tracks total.`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
