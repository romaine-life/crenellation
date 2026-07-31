// Is the decompilation readable yet?
//
// Every other claim in this repo is a number that cannot get worse: writes
// identical, screens identical but for one deliberate change, every byte of
// the image carrying a verdict. Naming had none, so a session could rename
// forty routines or lose forty and nothing would say which.
//
// `fn_0ccb2` says where a routine came from and nothing about what it does.
// The bar, from DELIVERY.md: no `fn_[0-9a-f]+` identifier survives, and every
// name is backed by recorded evidence rather than being plausible. This
// measures the first half - the second lives in names.curated.json and
// manual_names.json, where a name is a data change with its reason beside it.
//
// A ratchet, not a target: the counts here are what was measured, and they
// may only move the right way. Lower `addressNamed`, raise `namedParams`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(join(here, 'baseline.json'), 'utf8')) as
  Record<string, number>;

describe('names', () => {
  it('are getting better, never worse', () => {
    const src = readFileSync(join(here, 'decompiled.ts'), 'utf8');
    const fns = [...src.matchAll(/export function (\w+)\(/g)].map((m) => m[1]);
    const byAddress = fns.filter((n) => /^fn_[0-9a-f]+$/.test(n));

    // A parameter still called `d0_` or `a2_` is the register it arrived in,
    // which is the same non-answer as `fn_` is for a routine.
    let params = 0, named = 0;
    for (const m of src.matchAll(/export function \w+\(([^)]*)\)/g)) {
      for (const p of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        params += 1;
        if (!/^[ad]\d+_?\d*$/.test(p.split(':')[0].trim())) named += 1;
      }
    }

    const report = [
      `functions: ${fns.length}, semantic ${fns.length - byAddress.length}`
      + `, still an address ${byAddress.length}`,
      `parameters: ${params}, named ${named}`,
      // The point of the file, stated where it will be read: what is left.
      `remaining to the bar: ${byAddress.length} routines and`
      + ` ${params - named} parameters`,
    ].join('\n');
    writeFileSync(join(here, 'names.txt'), report + '\n');

    // Ratchets. Both fail on a regression, and both are meant to be edited
    // down (or up) whenever a session moves them - that edit is the record
    // that the work happened.
    expect(byAddress.length).toBeLessThanOrEqual(base.addressNamed ?? 1e9);
    expect(named).toBeGreaterThanOrEqual(base.namedParams ?? 0);
  });
});
