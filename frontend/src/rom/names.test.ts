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
// THE FUNCTION HALF WAS CLAIMED TOO EARLY ONCE, and this file exists to make
// that impossible a second time. `expect(byAddress).toEqual([])` is met - no
// routine is called `fn_0ccb2` - and that was reported as "1,187 of 1,187
// carry a name that says what they do", which is not what it measures.
// `idents.py` breaks a collision by APPENDING, so `mainGameStateMachineFrom3`
// is unique, passes, and tells the reader only which routine it is a second
// entry into. Three numbers are reported here now instead of one. The sharpest
// of them, OPAQUE - a routine where nothing it or its host or its target
// points at says what it is for - went 168 to 0 by reading, and is asserted
// rather than ratcheted now that it is there. What is left is parameters.
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

    // What `byAddress` does NOT measure, and the reason both numbers below
    // exist. `expect(byAddress).toEqual([])` says no routine is called
    // `fn_0ccb2`. It does not say the name is useful. `idents.py` breaks a
    // collision by APPENDING - `mainGameStateMachineFrom3`, `samplePlayback
    // WrapperFrom2` - so a name can be unique, pass the assertion, and still
    // tell the reader only which routine it is a second entry into. 544 of
    // 1,187 are that shape, and reporting "1,187 of 1,187 carry a name that
    // says what they do" hid it for a day. Same failure as counting `argN` as
    // named, and as the old `writes` floor that reported its recording cap.
    const stem = (n: string) => n.replace(/(From\d+|Stub|Wrapper)*\d*$/, '');
    const bySt = new Map<string, number>();
    for (const n of fns) bySt.set(stem(n), (bySt.get(stem(n)) ?? 0) + 1);
    const suffixOnly = fns.filter((n) => (bySt.get(stem(n)) ?? 0) > 1).length;

    // And the other half of it: a name DERIVED by rule - a wrapper after its
    // callee, a stub after its target, an entry point after the routine it
    // continues - is evidence of a sort, but it is not a stated purpose. Only
    // a routine in names.curated.json or manual_names.json has one of those.
    const romlab = join(here, '..', '..', '..', 'romlab');
    const curated = JSON.parse(readFileSync(
      join(romlab, 'names.curated.json'), 'utf8')) as
      Record<string, string | { name?: string; why?: string }>;
    const manualN = JSON.parse(readFileSync(
      join(romlab, 'manual_names.json'), 'utf8')) as Record<string, unknown>;
    const stated = new Set([...Object.keys(curated), ...Object.keys(manualN)]
      .map((k) => parseInt(k, 16)));
    const addrs = [...src.matchAll(/\{ at: (0x[0-9a-f]+), fn: \w+ as /g)]
      .map((m) => parseInt(m[1], 16));
    const unstatedAddrs = addrs.filter((a) => !stated.has(a));
    const unstated = unstatedAddrs.length;

    // ...and the sharper number, which is the one worth reading against. Of
    // the routines with nothing written about them, most can still be
    // understood in ONE HOP: an inner entry whose host routine has a stated
    // purpose, or a wrapper whose single target has one. Recording "it jumps
    // to X" for those would only restate the rule that named them, and would
    // move the count without telling a reader anything - which is the same
    // trap as counting `argN` as named. What is genuinely opaque is a routine
    // whose host or target has no purpose either. 168 of the 455.
    const facts = JSON.parse(readFileSync(
      join(romlab, 'out', 'facts.json'), 'utf8')) as
      { funcs: [number, number][]; calls?: Record<string, number[]> };
    const calls = new Map(Object.entries(facts.calls ?? {})
      .map(([k, v]) => [parseInt(k, 16), v]));
    const hostOf = (a: number) =>
      facts.funcs.find(([lo, hi]) => lo < a && a < hi)?.[0];
    const nameAt = new Map([...src.matchAll(
      /\{ at: (0x[0-9a-f]+), fn: (\w+) as /g)]
      .map((m) => [parseInt(m[1], 16), m[2]] as [number, string]));
    // The single thing a routine hands control to, taken from its own emitted
    // body rather than from facts.json's `calls`. A six-byte stub JUMPS, and a
    // jump is not a call, so `calls` is empty for every one of them - which
    // marked `startSoundCueStub` opaque while the routine it jumps to had just
    // been read and written down. Reading the body catches both forms.
    const bodyOf = new Map<string, string>();
    for (const m of src.matchAll(
      /^export function (\w+)\([^)]*\): void \{([\s\S]*?)^\}$/gm)) {
      bodyOf.set(m[1], m[2]);
    }
    const goesTo = (a: number) => {
      const body = bodyOf.get(nameAt.get(a) ?? '') ?? '';
      const to = new Set([...body.matchAll(
        /(?:callRom|callDecompiled|jumpRom)\((0x[0-9a-f]+)/g)]
        .map((m) => parseInt(m[1], 16)));
      const viaFacts = calls.get(a) ?? [];
      for (const c of viaFacts) to.add(c);
      return [...to];
    };
    const opaque = unstatedAddrs.filter((a) => {
      if (/From\d+$/.test(nameAt.get(a) ?? '')) {
        const h = hostOf(a);
        return h === undefined || !stated.has(h);
      }
      const to = goesTo(a);
      return to.length !== 1 || !stated.has(to[0]);
    }).length;

    const report = [
      `functions: ${fns.length}, semantic ${fns.length - byAddress.length}`
      + `, still an address ${byAddress.length}`,
      `named only by a suffix on another routine's name: ${suffixOnly}`,
      `no stated purpose - the name was derived by rule: ${unstated}`
      + ` of ${addrs.length}, of which ${opaque} are opaque`
      + ` (nothing their host or target points at has a purpose either)`,
      `parameters: ${params}, named ${named}`
      + ` (${slots} more are a stack slot with a number on it)`,
      // The point of the file, stated where it will be read: what is left.
      `remaining to the bar: ${byAddress.length} routines still an address,`
      + ` ${opaque} opaque routines, ${params - named} parameters`,
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
    // It started as a ratchet, because the fix was reading the disassembly one
    // routine at a time and a suite that cannot be green until that finishes is
    // a suite nobody reads. All 54 have been read, so it is an assertion now,
    // for the same reason `byAddress` is: at the bar a `<=` would quietly
    // accept the next name that arrives without its evidence.
    const bare = Object.entries(curated)
      .filter(([k, v]) => typeof v === 'string' && !(k in manualN))
      .map(([k]) => k);
    expect(bare).toEqual([]);

    // REACHED, so asserted rather than ratcheted, for the same reason
    // `byAddress` and `opaque` are: all 4,419 parameters say what they are,
    // and at the bar a `<=` would quietly accept a regeneration that lost a
    // name - which is exactly what a regeneration does when a curated name
    // stops applying. It was a ratchet from 2,401 down to 0.
    //
    // The ratchet was on the REMAINDER rather than on the total, and that is
    // what let a pass which REMOVES a parameter count as progress - the right
    // answer when the thing removed was never a parameter. 1,860 of them were
    // not: the lifter makes every register live across a routine into one, and
    // romlab/dropunread.py moves those into the body as `getReg`, which is
    // exactly the expression the dispatcher would have built the argument
    // with. The guard against removing a REAL one is not this number, it is
    // compose, writes and draws, which cannot pass if a value stopped reaching
    // the routine that reads it.
    //
    // The total is deliberately not asserted alongside it. A map that grows by
    // a routine is a legitimate reason for it to rise, and nothing here reads
    // a ratio.
    expect(params - named).toBe(0);

    // Ratchets, both of them, and both may only fall. A routine reached only
    // by a jump table or a tail jump has no caller to be named after and no
    // purpose anyone has read, so these move by reading - which is why they
    // are floors rather than assertions.
    expect(unstated).toBeLessThanOrEqual(base.unstatedPurpose ?? 0);
    expect(suffixOnly).toBeLessThanOrEqual(base.suffixOnlyNames ?? 0);

    // REACHED, so asserted rather than ratcheted, for the same reason
    // `byAddress` is: at the bar a `<=` would quietly accept the next routine
    // that arrives with nothing said about it or about anything it reaches.
    // Every routine in the image now has a purpose written down somewhere it
    // or its host or its target can be followed to.
    expect(opaque).toBe(0);
  });
});
