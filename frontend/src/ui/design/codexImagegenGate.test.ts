// Durable CI guard (enforcement, not a buried memory): the codex image-gen method
// must be verified against the ROLLOUT, never `codex exec --json` stdout — which is
// abridged and never carries `image_generation_call`. The retired kit-forge gated on
// stdout and discarded every real generation (docs/kit-forge.md). This fails the
// build if any forge script reintroduces the stdout-based check.
import { describe, it, expect } from 'vitest';
// @ts-ignore — untyped .mjs scanner (cf. main.tsx importing bgm.js)
import { stdoutGateOffenders } from '../../../scripts/check-imagegen-gate.mjs';

describe('codex image-gen method gate reads the rollout, not stdout', () => {
  it('no forge script checks image_generation_call without reading the rollout', () => {
    const offenders = stdoutGateOffenders();
    expect(
      offenders,
      `gate via the rollout, not exec --json stdout (see docs/kit-forge.md): ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
