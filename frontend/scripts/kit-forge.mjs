// Kit forge — the orchestrated, audited generation pipeline. ONE asset per codex
// invocation, then audit before accepting. See docs/kit-forge.md for the full
// story and the rule below.
//
// THE RULE (learned the hard way — a whole "30/30 forged" kit shipped broken):
// codex cannot be trusted to have GENERATED the image. Its imagegen skill tells
// it to hand-draw "code-native" icons, so for a 64px hard-alpha request it writes
// a PIL/SVG script and the pixel gate can't tell. So we VERIFY THE METHOD first
// (an `image_generation_call` must be present in this run's codex ROLLOUT — NOT on
// the --json stdout stream, which no longer carries it) and only then the pixels.
// Provenance records the verified method — it is NOT "safe" just
// because it passed the gate; the gate certifies clean transparency, not a good
// drawing. The human eyeball is still the required backstop before onboarding.
//
//   node frontend/scripts/kit-forge.mjs <name...> | --group <id> | --all  [--n 8] [--tries 3]
//
// Each asset is forged in its OWN throwaway temp dir with --skip-git-repo-check,
// so N codex sessions run concurrently with zero git checkpoint/restore — that
// checkpointing (in the worktree) is what clobbered the parallel batch earlier.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, copyFileSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyGlyph } from './verify-kit-asset.mjs';

const FRONTEND = fileURLToPath(new URL('..', import.meta.url));
const REPO = resolve(FRONTEND, '..');
const KIT = join(FRONTEND, 'public/assets/ui/kit');
const PROV = join(FRONTEND, 'src/ui/design/kitProvenance.json');
// Resolve the codex binary without hardcoding a machine-specific, hash-named path:
// the bin/<hash>/ folder changes on every codex update and is unique per machine.
// Prefer an explicit CODEX_BIN override, else the newest installed build under the
// default OpenAI/Codex layout, else trust PATH. (Merged from origin/main.)
function resolveCodex() {
  if (process.env.CODEX_BIN && existsSync(process.env.CODEX_BIN)) return process.env.CODEX_BIN;
  const exe = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const local = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || process.env.HOME || '', 'AppData', 'Local');
  const binDir = join(local, 'OpenAI', 'Codex', 'bin');
  try {
    const builds = readdirSync(binDir)
      .map((hash) => join(binDir, hash, exe))
      .filter(existsSync)
      .map((p) => ({ p, mtime: statSync(p).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (builds.length) return builds[0].p;
  } catch { /* not the default install layout — fall through to PATH */ }
  return exe; // trust PATH
}
const CODEX = resolveCodex();
const SESSIONS = 'C:/Users/Nelson/.codex/sessions';
const TODAY = new Date().toISOString().slice(0, 10);

const GEN = 'docs/art/ui-screen-concepts/generated';
const SCN = 'docs/art/ui-screen-concepts';
const ref = {
  general: `${GEN}/settings-general-concept-v1.png`, audio: `${GEN}/settings-audio-concept-v1.png`,
  gameplay: `${GEN}/settings-gameplay-concept-v1.png`, creator: `${GEN}/settings-creator-tools-concept-v1.png`,
  skirmish: `${SCN}/04-skirmish.png`, campaign: `${SCN}/02-campaign-editor.png`,
};

// One spec per asset: the single subject codex must paint, its style ref + size.
const SPECS = [
  // settings icons (64x64)
  ['settings', 'gear', ref.general, 'a gray settings gear'],
  ['settings', 'speaker', ref.audio, 'a blue speaker emitting sound waves'],
  ['settings', 'knight', ref.gameplay, 'a cream-and-gray chess knight piece'],
  ['settings', 'wrench', ref.general, 'a gray wrench'],
  ['settings', 'monitor', ref.general, 'a blue display screen / monitor'],
  ['settings', 'save', ref.general, 'a blue floppy disk'],
  ['settings', 'reset', ref.general, 'a red circular refresh / reset arrow (red is the correct color for this one)'],
  ['settings', 'info', ref.general, 'a blue lowercase letter i inside a circle'],
  ['settings', 'music', ref.audio, 'a blue music note'],
  ['settings', 'effects', ref.audio, 'a blue equalizer of vertical waveform bars'],
  ['settings', 'interface-sounds', ref.audio, 'a blue UI-sound mark: a small speaker or panel with sound bars'],
  ['settings', 'brand-shield', ref.general, 'a heraldic crest badge: a bright blue chess rook (castle tower) centered on a dark navy field, enclosed by an ornate beveled gold border — the brand emblem from the header'],
  ['settings', 'design-index', ref.creator, 'a blue creator-tools design / grid mark'],
  ['settings', 'tileset-studio', ref.creator, 'a green grass terrain tile'],
  ['settings', 'unit-studio', ref.creator, 'a gray chess knight / unit bust'],
  ['settings', 'tileset-review', ref.creator, 'a green clipboard with a checklist'],
  // chess-piece icons (64x64) — the flat piece set for the Party squad picker and
  // lobby rows. kit/icons/knight.png already shipped; these complete the set in the
  // same cream-and-gray Staunton style off the same gameplay style ref.
  ['settings', 'pawn', ref.gameplay, 'a cream-and-gray chess pawn piece'],
  ['settings', 'bishop', ref.gameplay, 'a cream-and-gray chess bishop piece'],
  // 'castle', not 'rook': provenance + the forge name-filter key by bare name, and the
  // shields/rook heraldic emblem already owns 'rook'. So the flat rook PIECE ships as
  // castle.png (a real synonym) to avoid clobbering the shield on a `kit-forge rook`.
  ['settings', 'castle', ref.gameplay, 'a cream-and-gray chess rook (castle tower) piece'],
  ['settings', 'queen', ref.gameplay, 'a cream-and-gray chess queen piece, with a crown of rounded points'],
  ['settings', 'king', ref.gameplay, 'a cream-and-gray chess king piece, topped by a cross'],
  ['settings', 'players', ref.gameplay, 'two cream-and-gray chess pawns standing side by side, a multiplayer / players mark'],
  // game icons (64x64)
  ['game', 'move', ref.skirmish, 'boots or directional movement arrows'],
  ['game', 'attack', ref.skirmish, 'a sword'],
  ['game', 'capture', ref.skirmish, 'two crossed swords'],
  ['game', 'defend', ref.skirmish, 'a shield'],
  ['game', 'wait', ref.skirmish, 'an hourglass'],
  ['game', 'objective', ref.skirmish, 'a flag'],
  ['game', 'end-turn', ref.skirmish, 'a circular arrow'],
  ['game', 'power', ref.skirmish, 'a lightning bolt'],
  // faction shields (64x80)
  ['shields', 'crown', ref.campaign, 'a crown emblem on a heraldic shield (dark field, gold border)'],
  ['shields', 'rook', ref.campaign, 'a castle tower (rook) emblem on a heraldic shield (dark field, gold border)'],
  ['shields', 'crescent', ref.campaign, 'a crescent moon emblem on a heraldic shield (dark field, gold border)'],
  ['shields', 'snow', ref.campaign, 'a snowflake emblem on a heraldic shield (dark field, gold border)'],
  ['shields', 'flame', ref.campaign, 'a flame emblem on a heraldic shield (dark field, gold border)'],
  ['shields', 'lion', ref.campaign, 'a lion emblem on a heraldic shield (dark field, gold border)'],
  // campaign-editor UI control icons (64x64)
  ['settings', 'star', ref.general, 'a single gold five-pointed star, flat low-fi'],
  ['settings', 'chevron-up', ref.general, 'a single upward chevron / caret (the ^ symbol), pale steel blue, flat low-fi'],
  ['settings', 'chevron-down', ref.general, 'a single downward chevron / caret (an inverted ^), pale steel blue, flat low-fi'],
  ['settings', 'delete', ref.general, 'a red X delete mark: two crossed diagonal strokes, flat low-fi'],
  ['settings', 'lock', ref.general, 'a closed gold padlock, flat low-fi'],
  // sign-out: a world-object icon, not a stock "exit" arrow — a stripped cloister
  // door that outlives its institution (ADR-0035; anchored to the Dissolution of
  // the Monasteries). Wood + stone material per ADR-0025 (like lyre/bell).
  ['settings', 'sign-out', ref.campaign, 'a weathered medieval wooden plank door standing slightly ajar in a worn gray stone archway, with a dark gap where it opens outward and a worn stone threshold slab at its foot; warm brown timber and cool gray stone, flat low-fi pixel style, no people'],
].map(([group, name, r, desc]) => {
  const dir = group === 'settings' ? 'icons' : `icons/${group}`;
  const [w, h] = group === 'shields' ? [64, 80] : [64, 64];
  return { group, name, desc, w, h, outDir: join(KIT, dir), refAbs: resolve(REPO, r) };
});

function prompt(spec, prior) {
  return `IMAGE-GENERATION task: create ONE PNG by GENERATING it with the built-in image generation tool. Do NOT hand-draw it with code (PIL/Pillow, cairo, matplotlib, SVG, HTML/CSS, canvas), do NOT write a script, and do NOT crop or extract from any file — programmatic output is automatically rejected and you will be asked again.
Using the attached concept art as the exact style/palette reference, generate a single clean standalone icon of: ${spec.desc}. Size ${spec.w}x${spec.h}, centered, on a FULLY TRANSPARENT background. Save it as ./${spec.name}.png in the current working directory.
CRISP HARD-ALPHA IS THE #1 REQUIREMENT: every pixel must be either fully opaque OR fully transparent (alpha exactly 0 or 255). Hard 1px edges, fully-opaque interior, fully-transparent exterior. Do NOT anti-alias the edges. Do NOT key out or erase a filled background — paint directly onto transparency. NO semi-transparent halo or fringe. Use only the colors the subject calls for; NO stray magenta / purple / pink keying fringe anywhere.${prior ? `\nIMPORTANT: your previous attempt FAILED the pixel audit with: ${prior}. Fix exactly that this time.` : ''}
Write only ./${spec.name}.png, then stop.`;
}

function runCodex(refAbs, cwd, text) {
  return new Promise((res) => {
    // --json streams every codex event as JSONL so we can VERIFY THE METHOD,
    // not just inspect the resulting pixels. This is non-negotiable: codex
    // cannot be trusted to have generated an image — its imagegen skill tells
    // it to hand-draw "code-native" icons, so for hard-alpha/64px requests it
    // writes a PIL/SVG script and our pixel gate can't tell the difference.
    const p = spawn(CODEX, ['exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-C', cwd, '-i', refAbs], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => res({ code, out }));
    p.on('error', (e) => res({ code: -1, out: String(e) }));
    p.stdin.write(text); p.stdin.end();
  });
}

// DEFINITIVE method check. A genuine generation records an `image_generation_call`
// in the codex ROLLOUT; a programmatic drawing (PIL/Pillow/cairo/SVG/canvas) does
// not. Current codex does NOT surface that marker on the `--json` STDOUT stream —
// it only lands in the rollout file — so the old stdout grep returned false for
// EVERY run and rejected real generations. We instead read the rollout: the stdout
// `thread.started` event carries this run's `thread_id`, which is embedded in the
// rollout filename, so we read THIS run's exact rollout (concurrency-safe under the
// forge pool — not "newest file since start"). No marker -> codex coded it -> reject.
function threadIdOf(codexJsonl) {
  for (const line of codexJsonl.split('\n')) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (((j.payload && j.payload.type) || j.type) === 'thread.started') {
      return j.thread_id || (j.payload && j.payload.thread_id) || null;
    }
  }
  return null;
}
function rolloutFor(threadId) {
  if (!threadId) return null;
  let found = null;
  const walk = (dir) => {
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl') && e.name.includes(threadId)) found = p;
    }
  };
  walk(SESSIONS);
  return found;
}
function usedImageGenerator(codexJsonl) {
  const rollout = rolloutFor(threadIdOf(codexJsonl));
  if (!rollout) return false;
  try { return readFileSync(rollout, 'utf8').includes('image_generation_call'); } catch { return false; }
}

async function forgeOne(spec, maxTries) {
  let prior = '';
  for (let attempt = 1; attempt <= maxTries; attempt += 1) {
    const work = mkdtempSync(join(tmpdir(), `forge-${spec.name}-`));
    try {
      const { code, out: codexJsonl } = await runCodex(spec.refAbs, work, prompt(spec, prior));
      // Persist codex's full event stream so the method check is AUDITABLE (not a
      // black box): afterward we can prove it GENERATED the image from the style
      // ref (image_generation_call) rather than hand-drawing it in PIL/SVG/canvas.
      const evidDir = join(FRONTEND, 'tmp-forge-evidence');
      mkdirSync(evidDir, { recursive: true });
      const evidPath = join(evidDir, `${spec.name}-try${attempt}.jsonl`);
      writeFileSync(evidPath, codexJsonl);
      const eventTypes = [...new Set(codexJsonl.split('\n').map((l) => { try { const j = JSON.parse(l); return (j.payload && j.payload.type) || j.type; } catch { return null; } }).filter(Boolean))];
      console.log(`        try ${attempt} METHOD: ${usedImageGenerator(codexJsonl) ? 'image_generation_call ✓ (GENERATED)' : 'no image-gen — CODE-DRAWN ✗'} | events: ${eventTypes.join(', ')}`);
      console.log(`        evidence: ${evidPath}`);
      const outPng = join(work, `${spec.name}.png`);
      if (!existsSync(outPng)) { prior = code === 0 ? 'codex wrote no PNG file' : `codex exited ${code} with no file`; continue; }
      // GATE 1 (method, definitive): prove codex actually generated the image.
      if (!usedImageGenerator(codexJsonl)) {
        prior = 'you produced the PNG WITHOUT the image generation tool — you drew it programmatically (PIL/Pillow/cairo/SVG/canvas). That is auto-rejected. You MUST create the image with the built-in image generation tool.';
        continue;
      }
      try {
        // GATE 2 (pixels): magenta / hard-alpha / edge bleed.
        verifyGlyph(outPng, { label: spec.name });
        copyFileSync(outPng, join(spec.outDir, `${spec.name}.png`));
        return { name: spec.name, group: spec.group, pass: true, tries: attempt };
      } catch (e) {
        prior = String(e.message).split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim();
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  return { name: spec.name, group: spec.group, pass: false, tries: maxTries, reason: prior };
}

async function pool(specs, n, maxTries) {
  const results = []; let i = 0;
  const worker = async () => {
    while (i < specs.length) {
      const s = specs[i]; i += 1;
      console.log(`[${i}/${specs.length}] forging ${s.name} …`);
      const r = await forgeOne(s, maxTries);
      console.log(`        ${r.pass ? 'PASS' : 'FAIL'} ${s.name} (try ${r.tries})${r.reason ? ` — ${r.reason}` : ''}`);
      results.push(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, specs.length) }, worker));
  return results;
}

function recordProvenance(results) {
  let prov = { process: 'kit-forge single-shot + gate', lastRun: TODAY, assets: {} };
  try { prov = { ...prov, ...JSON.parse(readFileSync(PROV, 'utf8')) }; } catch { /* first run */ }
  prov.lastRun = TODAY;
  for (const r of results) {
    if (r.pass) prov.assets[r.name] = { group: r.group, forged: TODAY, tries: r.tries, method: 'image-generator (verified)', gate: 'pass' };
  }
  mkdirSync(join(FRONTEND, 'src/ui/design'), { recursive: true });
  writeFileSync(PROV, `${JSON.stringify(prov, null, 2)}\n`);
}

// ---- CLI ----
const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const n = Math.max(1, parseInt(flag('--n', '8'), 10));
const maxTries = Math.max(1, parseInt(flag('--tries', '3'), 10));
const groupSel = flag('--group', null);
const names = argv.filter((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--n' && argv[argv.indexOf(a) - 1] !== '--tries' && argv[argv.indexOf(a) - 1] !== '--group');

let queue;
if (argv.includes('--all')) queue = SPECS;
else if (groupSel) queue = SPECS.filter((s) => s.group === groupSel);
else if (names.length) queue = SPECS.filter((s) => names.includes(s.name));
else { console.error('select assets: <name...> | --group <settings|game|shields> | --all'); process.exit(2); }

console.log(`forge: ${queue.length} asset(s), concurrency ${n}, up to ${maxTries} tries each\n`);
const results = await pool(queue, n, maxTries);
recordProvenance(results);
const ok = results.filter((r) => r.pass).length;
console.log(`\n==== ${ok}/${results.length} forged + gated. provenance -> ${PROV} ====`);
if (ok < results.length) { console.log('FAILED:', results.filter((r) => !r.pass).map((r) => r.name).join(', ')); process.exit(1); }
