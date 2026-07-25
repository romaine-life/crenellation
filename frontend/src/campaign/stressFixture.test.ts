import { describe, it, expect } from 'vitest';
import { readStressCount } from './stressFixture';

// Pure parser only — the actual store injection touches the live Zustand store + DOM and is
// exercised in the running app, not here. This pins the URL-flag GATING: with no `?stress=`
// param the harness must be inert (returns 0) so it can never affect normal use.

describe('readStressCount — the dev-only URL gate', () => {
  it('returns 0 (inert) when the flag is absent', () => {
    expect(readStressCount('')).toBe(0);
    expect(readStressCount('?foo=1&bar=2')).toBe(0);
  });

  it('uses a sane default for a bare ?stress flag', () => {
    expect(readStressCount('?stress')).toBe(150);
    expect(readStressCount('?stress=')).toBe(150);
  });

  it('honours an explicit count', () => {
    expect(readStressCount('?stress=42')).toBe(42);
    expect(readStressCount('?stress=1')).toBe(1);
  });

  it('clamps an oversized count so a fat number cannot lock the tab', () => {
    expect(readStressCount('?stress=99999')).toBe(500);
  });

  it('treats non-positive / garbage values as inert', () => {
    expect(readStressCount('?stress=0')).toBe(0);
    expect(readStressCount('?stress=-5')).toBe(0);
    expect(readStressCount('?stress=abc')).toBe(0);
  });
});
