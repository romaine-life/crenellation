// Guards the BGM shuffle invariants. Run as part of `npm run check`.
//
// planShuffleCycle(length, lastIndex) must:
//   1. return a full permutation of [0..length-1] (every track, no dupes/drops)
//   2. never start a new cycle with the track that just finished (no audible
//      back-to-back repeat across the cycle boundary)
//   3. actually randomize order
//   4. be roughly uniform in which track lands first
import assert from 'node:assert/strict';
import { planShuffleCycle } from '../src/bgm.js';

// 1. Permutation integrity across a range of library sizes.
for (const n of [1, 2, 3, 5, 20]) {
  const want = Array.from({ length: n }, (_, i) => i);
  for (let t = 0; t < 200; t += 1) {
    const order = planShuffleCycle(n, -1);
    assert.equal(order.length, n, `length for n=${n}`);
    assert.deepEqual([...order].sort((a, b) => a - b), want, `permutation for n=${n}`);
  }
}

// 2. No immediate repeat across a cycle boundary (only meaningful for n > 1).
for (const n of [2, 3, 5, 20]) {
  for (let last = 0; last < n; last += 1) {
    for (let t = 0; t < 500; t += 1) {
      assert.notEqual(planShuffleCycle(n, last)[0], last, `first!=last n=${n} last=${last}`);
    }
  }
}

// 3. It actually shuffles — the identity order should be vanishingly rare.
let identity = 0;
const trials = 1000;
for (let t = 0; t < trials; t += 1) {
  if (planShuffleCycle(20, -1).every((v, i) => v === i)) identity += 1;
}
assert.ok(identity < trials * 0.05, `shuffle rarely identity (got ${identity}/${trials})`);

// 4. First-slot distribution is roughly uniform.
const N = 40000;
const counts = new Array(20).fill(0);
for (let t = 0; t < N; t += 1) counts[planShuffleCycle(20, -1)[0]] += 1;
const expected = N / 20;
for (let i = 0; i < 20; i += 1) {
  assert.ok(Math.abs(counts[i] - expected) < expected * 0.25, `slot0 distribution idx ${i}`);
}

// 5. Stream simulation: chain many cycles, assert the flattened play order never
//    repeats a track back-to-back (within a cycle by construction, across the
//    boundary by the lastIndex guard).
let last = -1;
let prev = -1;
let played = 0;
for (let c = 0; c < 2000; c += 1) {
  for (const idx of planShuffleCycle(20, last)) {
    assert.notEqual(idx, prev, 'no back-to-back repeat in play stream');
    prev = idx;
    last = idx;
    played += 1;
  }
}

console.log(`BGM shuffle checks OK (permutation, no-repeat, randomized, uniform; ${played} tracks streamed).`);
