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
// ratcheting it. The parameter half is not, and stays a ratchet.
//
// The ratchet is on what is LEFT rather than on what is done, and the reason
// is that the count of done ones stopped meaning what it said. 1,860 of the
// things being counted as parameters were not parameters: the lifter makes
// every register live across a routine into one, so `pieceWalker` took
// fourteen and read five, and the other nine were bookkeeping that had to
// survive an interrupt. romlab/dropunread.py moves those into the body as
// `getReg`, which is exactly the expression the dispatcher would have used to
// build the argument, so nothing about the run changes - compose, writes and
// draws all still report identity. But 1,009 of them HAD names, mostly from
// the caller direction, and every one of those names described a value the
// routine never reads. Counting them was counting wrong names.
//
// `argN` is counted as unnamed here for the same reason a register is: it
// says a value arrived in the fourth stack slot, which the reader can already
// see. That is a deliberate tightening of the definition and it moved the
// number the wrong way by 477 on the day it was made.
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
    // and one called `arg3` is the stack slot it arrived in. Both are the same
    // non-answer as `fn_` is for a routine.
    let params = 0, named = 0, slots = 0;
    for (const m of src.matchAll(/export function \w+\(([^)]*)\)/g)) {
      for (const p of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        params += 1;
        const n = p.split(':')[0].trim();
        if (/^arg\d+$/.test(n)) slots += 1;
        else if (!/^[ad]\d+_?\d*$/.test(n)) named += 1;
      }
    }

    const report = [
      `functions: ${fns.length}, semantic ${fns.length - byAddress.length}`
      + `, still an address ${byAddress.length}`,
      `parameters: ${params}, named ${named}`
      + ` (${slots} more are a stack slot with a number on it)`,
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

    // ...and the hole that assertion had, which was exactly the width of the
    // older form. An entry may also be a bare string, which is the name and
    // nothing else, and a bare string is not an object so it slipped past both
    // this check and `idents.py`'s. 71 of the 400 were bare strings; 17 of
    // those have their evidence in manual_names.json, which stores
    // [name, why] pairs, and the rest had none anywhere.
    //
    // A ratchet rather than an assertion, because the fix is reading the
    // disassembly one routine at a time and a suite that cannot be green until
    // that finishes is a suite nobody reads. It may only fall.
    const manual = JSON.parse(readFileSync(join(
      here, '..', '..', '..', 'romlab', 'manual_names.json'), 'utf8')) as
      Record<string, unknown>;
    const bare = Object.entries(curated)
      .filter(([k, v]) => typeof v === 'string' && !(k in manual))
      .map(([k]) => k);
    expect(bare.length).toBeLessThanOrEqual(base.unevidencedNames ?? 0);

    // Parameters are still a ratchet, and it is on the remainder: 2,401 of
    // 4,415 do not say what they are, and the bar is none of them. Ratcheting
    // the remainder rather than the total is what lets a pass that REMOVES a
    // parameter count as progress, which is the right answer when the thing
    // removed was never a parameter - and the guard against removing real ones
    // is not this number, it is compose, writes and draws, which cannot pass
    // if a value stopped reaching the routine that reads it.
    // The total is deliberately NOT ratcheted alongside it. It would catch a
    // pass that inflated the denominator, but nothing here reads a ratio, and
    // a map that grows by a routine is a legitimate reason for the total to
    // rise - a floor that goes red for a good reason is a floor nobody reads.
    expect(params - named).toBeLessThanOrEqual(base.unnamedParams ?? 0);
  });
});
