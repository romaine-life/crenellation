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
// The function half of the bar is MET, as of 2026-08-02: 1,187 of 1,187 carry
// a name that says what they do, and this asserts exactly that rather than
// ratcheting it. The parameter half is not - 3,069 of 6,279 - and stays a
// ratchet that may only rise.
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

    // Reached, so enforced rather than ratcheted. `addressNamed` is 0 in
    // baseline.json and this asserts exactly that: every one of the 1,187
    // functions carries a name that says what it does. A ratchet was right
    // while the number was falling; now that it is at the bar, `<=` would
    // quietly accept a regeneration that lost a name, and losing one is
    // exactly what a regeneration does when a curated name stops applying.
    expect(byAddress).toEqual([]);

    // The other half of the bar, from DELIVERY.md: every name backed by
    // recorded evidence rather than being merely plausible. idents.py refuses
    // a curated entry that is an object with no `why`, but nothing outside
    // romlab checked it, and the generator is not run by the suite. A wrong
    // name is worse than an address - 0x9080 was confidently called
    // `creditCompare` and drains a ring buffer with nothing to do with
    // credits - and the only defence is being able to read afterwards why a
    // name was chosen.
    const curated = JSON.parse(readFileSync(
      join(here, '..', '..', '..', 'romlab', 'names.curated.json'), 'utf8')) as
      Record<string, string | { name?: string; why?: string }>;
    const unevidenced = Object.entries(curated)
      .filter(([, v]) => typeof v === 'object' && v !== null && !v.why)
      .map(([k]) => k);
    expect(unevidenced).toEqual([]);

    // Parameters are still a ratchet: 3,069 of 6,279, and the bar is all of
    // them.
    expect(named).toBeGreaterThanOrEqual(base.namedParams ?? 0);
  });
});
