// Bake regression guard: every committed kit PNG must equal a fresh bake from its
// committed config, so a hand-edited or drifted artifact (or a bake change that
// wasn't re-run) fails CI. The bake core (bakeAsset) is shared with the writer
// (buildAsset) and the dev-Save endpoint, so this also pins editor↔bake parity.
import { describe, it, expect } from 'vitest';
// @ts-ignore — nine-slice-kit is an untyped .mjs build script (cf. main.tsx/bgm.js)
import { bakeAsset, bakeLine, REGISTRY, LINE_DIR, loadConfig, diffCommitted } from '../../../scripts/nine-slice-kit.mjs';

describe('nine-slice bake parity (committed PNG === fresh bake from config)', () => {
  const ids = Object.keys(REGISTRY);

  it('has registered assets to check', () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  for (const id of ids) {
    it(`${id}: committed PNG(s) match a fresh bake`, () => {
      let cfg;
      try { cfg = loadConfig(id); } catch { cfg = { asset: id }; }
      const { variants } = bakeAsset(id, cfg);
      for (const v of variants) {
        const d = diffCommitted(v.out, v.png);
        expect(d.sameSize, `${v.out}: size ${JSON.stringify(d.fresh)} vs committed ${JSON.stringify(d.committed)}`).toBe(true);
        expect(d.samePixels, `${v.out}: pixels differ from the committed file — re-bake (apply-nine-slice / dev Save) or restore the artifact`).toBe(true);
      }
      // Transparent-interior "line" twin (ordinarily in explore/frames) must also match a fresh bake.
      const rec = REGISTRY[id];
      if (rec.line) {
        const d = diffCommitted(rec.line, bakeLine(id), LINE_DIR);
        expect(d.sameSize, `${rec.line}: size ${JSON.stringify(d.fresh)} vs committed ${JSON.stringify(d.committed)}`).toBe(true);
        expect(d.samePixels, `${rec.line}: line frame drifted — re-bake (scripts/bake-line-frames.mjs)`).toBe(true);
      }
    });
  }
});
