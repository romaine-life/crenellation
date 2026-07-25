// Durable CI guard — enforcement, not a buried memory.
//
// The codex image-gen METHOD must be verified against the ROLLOUT
// (`~/.codex/sessions/.../rollout-*-<thread_id>.jsonl`), never `codex exec --json`
// STDOUT — which is an abridged thread/turn/item stream that NEVER carries the
// `image_generation_call` event. The retired kit-forge gated on stdout, so it
// marked every real generation "code-drawn" and discarded it (the recurring
// time-sink every agent rediscovered — see docs/kit-forge.md).
//
// Rule enforced here: any forge script that checks `image_generation_call` MUST
// also read the rollout/sessions log. If it references the event but never the
// rollout, it's gating on stdout — the broken pattern — and this fails the build.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SCRIPTS = fileURLToPath(new URL('.', import.meta.url));
const SELF = 'check-imagegen-gate.mjs';

export function stdoutGateOffenders() {
  const offenders = [];
  for (const f of readdirSync(SCRIPTS)) {
    if (!f.endsWith('.mjs') || f === SELF) continue;
    const src = readFileSync(join(SCRIPTS, f), 'utf8');
    // Mentions the event but never the place it actually lives → stdout gate.
    if (src.includes('image_generation_call') && !/rollout|sessions/i.test(src)) offenders.push(f);
  }
  return offenders;
}

// CLI mode (npm run check / direct node). Skipped when imported (e.g. by the test).
const invokedDirectly = !!process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith(`/${SELF}`);
if (invokedDirectly) {
  const bad = stdoutGateOffenders();
  if (bad.length) {
    console.error(`\n✗ codex image-gen method gate must read the ROLLOUT, not \`codex exec --json\` stdout.\n  These scripts check image_generation_call but never read the rollout/sessions log:\n${bad.map((b) => `    - frontend/scripts/${b}`).join('\n')}\n  stdout is abridged and NEVER carries image_generation_call — see docs/kit-forge.md.\n`);
    process.exit(1);
  }
  console.log('✓ no stdout-based codex image-gen gate found');
}
