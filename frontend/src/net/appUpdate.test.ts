import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractEntryHash, isNewBuildLive } from './appUpdate';

const mockIndex = (hash: string, ok = true) =>
  vi.fn(async () => ({ ok, text: async () => `<script type="module" src="/assets/index-${hash}.js"></script>` }) as unknown as Response);

describe('extractEntryHash', () => {
  it('pulls the hash from a Vite entry-chunk script src', () => {
    expect(extractEntryHash('https://chess.romaine.life/assets/index-DExpuavm.js')).toBe('DExpuavm');
  });

  it('pulls the hash out of a full index.html that references the entry chunk', () => {
    const html = '<!doctype html><script type="module" crossorigin src="/assets/index-AbC123_-.js"></script>';
    expect(extractEntryHash(html)).toBe('AbC123_-');
  });

  it('returns empty for a dev entry (no hashed chunk) or unrelated input', () => {
    expect(extractEntryHash('/src/main.tsx')).toBe('');
    expect(extractEntryHash('')).toBe('');
    expect(extractEntryHash('<script src="/assets/other-xyz.js"></script>')).toBe('');
  });

  it('distinguishes two different builds', () => {
    const a = extractEntryHash('/assets/index-aaaaaaaa.js');
    const b = extractEntryHash('/assets/index-bbbbbbbb.js');
    expect(a).not.toBe(b);
    expect(a).toBeTruthy();
  });
});

describe('isNewBuildLive', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('is true when the live index references a different entry hash', async () => {
    vi.stubGlobal('fetch', mockIndex('bbbbbbbb'));
    expect(await isNewBuildLive('aaaaaaaa')).toBe(true);
  });

  it('is false when the live index matches the booted hash', async () => {
    vi.stubGlobal('fetch', mockIndex('aaaaaaaa'));
    expect(await isNewBuildLive('aaaaaaaa')).toBe(false);
  });

  it('is false when we cannot determine our own build (dev)', async () => {
    vi.stubGlobal('fetch', mockIndex('bbbbbbbb'));
    expect(await isNewBuildLive('')).toBe(false);
  });

  it('never prompts on a failed or non-OK fetch', async () => {
    vi.stubGlobal('fetch', mockIndex('bbbbbbbb', false));
    expect(await isNewBuildLive('aaaaaaaa')).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await isNewBuildLive('aaaaaaaa')).toBe(false);
  });
});
