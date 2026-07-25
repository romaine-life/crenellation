// Shared codex image-generation helpers used by every codex-driven image forge in the
// repo (forge-surface-texture.mjs, kit-forge.mjs, …).
//
// THE KEY FACT (cost an agent a whole debugging detour — 2026-06-27):
// `codex exec --json` STDOUT is an ABRIDGED thread/turn/item stream — only
// `thread.started`, `turn.started`, `item.started/completed` (`command_execution` /
// `agent_message`), `turn.completed`. It does NOT carry response items, so the
// `image_generation_call` event is ABSENT from stdout. Greping stdout for it makes EVERY
// genuine generation look "code-drawn" (this is exactly the bug that produced "0/N forged").
// The event lives in the full session ROLLOUT log:
//   $CODEX_HOME/sessions/<Y>/<M>/<D>/rollout-<ts>-<thread_id>.jsonl
// Correlate via the `thread_id` that `thread.started` prints to stdout, then read that
// rollout. `image_generation_call` (+ `image_generation_end`) live there.
//
// SHIP from the session's own dir, never from codex's "copy latest image to workspace"
// step: the model output lands in $CODEX_HOME/generated_images/<thread_id>/ig_*.png, and
// codex's copy step picks "the latest image" — which under CONCURRENCY cross-grabs a
// SIBLING session's image (observed: two distinct requests yielding byte-identical output).
// sessionImage(threadId) reads the session's own dir, so it is race-proof.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex');
export const GEN_IMAGES = join(CODEX_HOME, 'generated_images');
const SESSIONS = join(CODEX_HOME, 'sessions');
const REMOVE_CHROMA = join(CODEX_HOME, 'skills', '.system', 'imagegen', 'scripts', 'remove_chroma_key.py');

// Resolve the codex binary without hardcoding a machine-specific, hash-named path: the
// bin/<hash>/ folder changes on every codex update and is unique per machine. Prefer an
// explicit CODEX_BIN override, else the newest installed build under the default
// OpenAI/Codex layout, else trust PATH.
export function resolveCodex() {
  if (process.env.CODEX_BIN && existsSync(process.env.CODEX_BIN)) return process.env.CODEX_BIN;
  const exe = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const local = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || process.env.HOME || '', 'AppData', 'Local');
  const binDir = join(local, 'OpenAI', 'Codex', 'bin');
  try {
    const builds = readdirSync(binDir).map((h) => join(binDir, h, exe)).filter(existsSync)
      .map((p) => ({ p, mtime: statSync(p).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
    if (builds.length) return builds[0].p;
  } catch { /* fall through to PATH */ }
  return exe;
}
export const CODEX = resolveCodex();

// Run one codex generation. `--json` so we get the thread_id; prompt fed via STDIN (the
// `-i` variadic would otherwise swallow a trailing prompt). `ref` (optional) is a style
// reference image passed via `-i` for img2img. Each call should use a fresh throwaway cwd.
export function runCodex(cwd, text, ref) {
  return new Promise((res) => {
    const args = ['exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-C', cwd];
    if (ref) args.push('-i', ref);
    const p = spawn(CODEX, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => res({ code, out }));
    p.on('error', (e) => res({ code: -1, out: String(e) }));
    p.stdin.write(text); p.stdin.end();
  });
}

// The thread_id codex prints on stdout via the `thread.started` event — our key into the
// rollout log and the generated_images/<thread_id>/ output dir.
export function threadIdOf(stdout) {
  for (const l of stdout.split('\n')) {
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.type === 'thread.started' && j.thread_id) return j.thread_id;
  }
  return null;
}

// Locate the rollout session log for a thread_id (filename ends with `-<thread_id>.jsonl`).
export function findRollout(threadId) {
  const stack = [SESSIONS];
  while (stack.length) {
    const dir = stack.pop();
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith(`-${threadId}.jsonl`)) return p;
    }
  }
  return null;
}

// METHOD GATE. Returns { ok, reason, roll, tid }. ok=true iff the run's ROLLOUT contains an
// image_generation_call event — proof codex used the real image model, not a code-drawer.
export function imageGenVerdict(stdout) {
  const tid = threadIdOf(stdout);
  if (!tid) return { ok: false, reason: 'no thread_id on stdout (cannot locate rollout)' };
  const roll = findRollout(tid);
  if (!roll) return { ok: false, reason: `no rollout file for thread ${tid}`, tid };
  const text = readFileSync(roll, 'utf8');
  for (const l of text.split('\n')) {
    let j; try { j = JSON.parse(l); } catch { continue; }
    const cands = [j.type, j.payload && j.payload.type, j.item && j.item.type, j.response && j.response.type];
    if (cands.includes('image_generation_call')) return { ok: true, reason: 'image_generation_call in rollout', roll, tid };
  }
  return { ok: false, reason: 'rollout present but no image_generation_call (code-drawn)', roll, tid };
}

// RACE-FREE shipping source: the newest ig_*.png in the session's OWN output dir. Returns
// the path or null. (Use this instead of codex's workspace copy — see header.)
export function sessionImage(threadId) {
  const dir = join(GEN_IMAGES, threadId);
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const igs = entries.filter((e) => e.isFile() && /^ig_.*\.png$/i.test(e.name))
    .map((e) => ({ p: join(dir, e.name), m: statSync(join(dir, e.name)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return igs.length ? igs[0].p : null;
}

// Chroma-key a flat-background generation to alpha (ADR-0013). gpt-image-2 cannot paint
// native transparency, so transparent glyphs are generated on a flat green background and
// keyed out locally with codex's own remove_chroma_key.py. `--auto-key corners` samples
// the actual corner color (the model's green is rarely exactly #00ff00), `--soft-matte`
// gives anti-aliased edges, `--despill` cleans green edge spill. Returns { ok, reason }.
export function removeChromaKey(input, out) {
  const r = spawnSync('python', [REMOVE_CHROMA, '--input', input, '--out', out,
    '--auto-key', 'corners', '--soft-matte', '--despill', '--force'], { encoding: 'utf8' });
  if (r.error) return { ok: false, reason: String(r.error.message) };
  if (r.status !== 0) return { ok: false, reason: (r.stderr || r.stdout || `python exit ${r.status}`).trim().split('\n').pop() };
  return { ok: true };
}
