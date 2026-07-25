// Sound-effects service — authored recorded one-shots.
//
// The companion to the BGM player (bgm.js): same gesture-armed, settings-driven
// contract. Landing/terrain SFX are AUTHORED recordings (real foley the owner
// supplies), sliced into one-shot take variants under /assets/sfx/<key>/ and
// random-picked per landing so repeats never fatigue. An earlier experiment that
// SYNTHESISED these one-shots procedurally (oscillators + filtered noise) was
// removed — we play recordings, not code-generated foley. A terrain with no
// recorded set is simply silent on landing until its takes are added.
//
// Design goals (mirroring bgm.js):
//   - Autoplay-safe: an AudioContext starts suspended until a user gesture. We arm
//     on the first pointerdown/keydown/touchstart (exactly the BGM arm-events) AND
//     keep a safety-net resume() inside playTerrain, so the first move after a
//     gesture isn't swallowed. Sample sets are decoded on that first gesture.
//   - Settings-driven: the master gain tracks the same localStorage settings blob
//     the Settings screen writes (chess-tactics-settings-v1). masterAudio=false (or
//     effectsVolume=0) hard-mutes effects. We re-read on a custom settings-change
//     event and on cross-tab `storage`, so changing the slider takes effect live.
//   - SSR / build-safe: every window / AudioContext / fetch touch is typeof-guarded
//     and nothing runs at import time, so this module is import-safe under Vite SSR,
//     tests, and the Node-run tooling.
//   - Bounded: a polyphony cap drops (or steals) voices so a flurry of rapid moves
//     can never pile up an unbounded graph of nodes.

import type { TerrainType } from './core/types';

// ---- settings contract (shared with Settings.tsx) --------------------------
// The Settings screen persists a JSON blob under this key; we read the two fields
// that gate effects. Kept as literals here (not imported from the React UI) so the
// service has no dependency on the component tree and stays import-safe everywhere.
const SETTINGS_KEY = 'chess-tactics-settings-v1';

// The Settings screen dispatches this after it mutates masterAudio / effectsVolume
// (see integration in Settings.tsx) so a running service updates its master gain
// without a reload — the SFX analogue of BGM's mute-change event.
export const SFX_SETTINGS_CHANGE_EVENT = 'chess-tactics:settings-change';

const DEFAULT_MASTER_AUDIO = true;
const DEFAULT_EFFECTS_VOLUME = 80; // 0..100, matches Settings DEFAULT_SETTINGS

// Cap on simultaneously-sounding voices. Past this, the oldest voice is stolen so a
// burst of moves stays bounded instead of growing the audio graph without limit.
const MAX_VOICES = 12;

interface EffectsSettings {
  masterAudio: boolean;
  effectsVolume: number; // 0..100
}

// SSR-safe window handle: undefined off the main thread / during build.
function win(): (Window & typeof globalThis) | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

function readEffectsSettings(): EffectsSettings {
  const w = win();
  if (!w) return { masterAudio: DEFAULT_MASTER_AUDIO, effectsVolume: DEFAULT_EFFECTS_VOLUME };
  try {
    const raw = w.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { masterAudio: DEFAULT_MASTER_AUDIO, effectsVolume: DEFAULT_EFFECTS_VOLUME };
    const parsed = JSON.parse(raw) as { masterAudio?: unknown; effectsVolume?: unknown };
    const masterAudio = typeof parsed.masterAudio === 'boolean' ? parsed.masterAudio : DEFAULT_MASTER_AUDIO;
    const volume = typeof parsed.effectsVolume === 'number' && Number.isFinite(parsed.effectsVolume)
      ? Math.min(100, Math.max(0, parsed.effectsVolume))
      : DEFAULT_EFFECTS_VOLUME;
    return { masterAudio, effectsVolume: volume };
  } catch {
    // Absent / malformed settings → audible defaults (parity with BGM's readMuted).
    return { masterAudio: DEFAULT_MASTER_AUDIO, effectsVolume: DEFAULT_EFFECTS_VOLUME };
  }
}

// The effective master gain: 0 when master audio is off, else effectsVolume scaled
// to 0..1. One place computes the multiplier so "muted" is unambiguous everywhere.
function masterGainFor(settings: EffectsSettings): number {
  if (!settings.masterAudio) return 0;
  return settings.effectsVolume / 100;
}

// Cached parse of the settings blob so the per-landing mute gate doesn't re-read +
// JSON.parse localStorage on every footstep (landings fire in staggered bursts).
// Kept fresh by applyMasterGain(), which the settings-change + cross-tab `storage`
// listeners call — the only paths by which these settings change.
let cachedEffects: EffectsSettings | null = null;

function effectsSettings(): EffectsSettings {
  if (!cachedEffects) cachedEffects = readEffectsSettings();
  return cachedEffects;
}

// ---- lazy singleton AudioContext -------------------------------------------
// Built only on demand (after a gesture, or as a safety net inside playTerrain) and
// reused thereafter — one context, one master bus, for the whole session.

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | undefined {
  const w = win();
  if (!w) return undefined;
  // Preserve the globalThis half of the window type (which carries AudioContext)
  // while adding the prefixed Safari fallback that the lib types omit.
  const g = w as typeof w & { webkitAudioContext?: AudioContextCtor };
  return g.AudioContext ?? g.webkitAudioContext;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let armed = false; // gesture listeners attached
let resolved = false; // ctx creation attempted (success or unavailable)
let unavailable = false; // Web Audio not present — give up quietly

// Active voices, oldest first, for the polyphony cap / voice stealing.
interface Voice {
  node: GainNode;
  stopAt: number; // ctx.currentTime when cleanup is scheduled
  timer: ReturnType<typeof setTimeout> | null;
}
const voices: Voice[] = [];

// Create (or return) the shared context + master bus. Returns null if Web Audio is
// unavailable or construction throws — callers must treat null as "do nothing".
function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  if (unavailable) return null;
  resolved = true;
  const Ctor = audioContextCtor();
  if (!Ctor) { unavailable = true; return null; }
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = masterGainFor(effectsSettings());
    master.connect(ctx.destination);
    return ctx;
  } catch {
    // e.g. too many contexts, or a locked-down environment — fail silent.
    unavailable = true;
    ctx = null;
    master = null;
    return null;
  }
}

// Push the current settings into the live master gain (cheap; safe to call often).
function applyMasterGain(): void {
  // Refresh the cache first (above the ctx guard) so the per-landing mute gate sees
  // the new value even if no AudioContext exists yet.
  cachedEffects = readEffectsSettings();
  if (!ctx || !master) return;
  const target = masterGainFor(cachedEffects);
  // Tiny ramp instead of a hard set so a slider drag doesn't click.
  try {
    master.gain.setTargetAtTime(target, ctx.currentTime, 0.01);
  } catch {
    master.gain.value = target;
  }
}

/**
 * Re-read localStorage and update the master gain. Call after the Settings screen
 * changes masterAudio / effectsVolume (it also fires SFX_SETTINGS_CHANGE_EVENT,
 * which this module listens for, so an explicit call is usually unnecessary).
 */
export function refreshSfxSettings(): void {
  applyMasterGain();
}

// ---- gesture arming (autoplay policy) --------------------------------------
// An AudioContext is created suspended; it can only resume after a user gesture.
// Mirror the BGM player exactly: listen on the first pointerdown/keydown/touchstart,
// create+resume the context, then disarm.

const ARM_EVENTS: ReadonlyArray<string> = ['pointerdown', 'keydown', 'touchstart'];

function onGesture(): void {
  const context = ensureContext();
  if (context && context.state === 'suspended') {
    void context.resume().catch(() => { /* resumed later by the safety net */ });
  }
  // First gesture is also the earliest point an AudioContext exists, so kick off
  // decoding the authored sample sets now — they're ready by the time a landing fires.
  preloadSamples();
  disarmGesture();
}

function disarmGesture(): void {
  const w = win();
  if (!w || !armed) return;
  armed = false;
  for (const evt of ARM_EVENTS) w.removeEventListener(evt, onGesture);
}

let settingsListenersAttached = false;

function attachSettingsListeners(): void {
  const w = win();
  if (!w || settingsListenersAttached) return;
  settingsListenersAttached = true;
  // Live in-tab update from the Settings screen.
  w.addEventListener(SFX_SETTINGS_CHANGE_EVENT, applyMasterGain);
  // Cross-tab: another tab wrote the settings blob.
  w.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === SETTINGS_KEY) applyMasterGain();
  });
}

/**
 * Attach one-time gesture listeners that arm the AudioContext, plus the settings
 * listeners that keep the master gain live. Call once from app init (next to
 * initBgm()). Idempotent and SSR-safe.
 */
export function primeSfx(): void {
  const w = win();
  if (!w) return;
  attachSettingsListeners();
  if (armed) return;
  armed = true;
  for (const evt of ARM_EVENTS) w.addEventListener(evt, onGesture, { passive: true });
}

// ---- playback --------------------------------------------------------------
// Drop the oldest voice (free its node + timer) to make room under the cap.
function stealOldestVoice(): void {
  const oldest = voices.shift();
  if (!oldest) return;
  if (oldest.timer !== null) clearTimeout(oldest.timer);
  try { oldest.node.disconnect(); } catch { /* already gone */ }
}

function retireVoice(voice: Voice): void {
  const idx = voices.indexOf(voice);
  if (idx !== -1) voices.splice(idx, 1);
  if (voice.timer !== null) clearTimeout(voice.timer);
  try { voice.node.disconnect(); } catch { /* already gone */ }
}

// Clamp a per-call gain multiplier to a sane, finite, non-negative value (default 1).
function normGain(g?: number): number {
  return typeof g === 'number' && Number.isFinite(g) ? Math.max(0, g) : 1;
}

// Acquire a per-voice GainNode wired to the master bus, enforcing the polyphony cap
// first (steal oldest), so every authored-sample voice honours MAX_VOICES and the
// master gain identically. Returns null if no context.
function acquireVoice(callGain: number): GainNode | null {
  if (!ctx || !master) return null;
  while (voices.length >= MAX_VOICES) stealOldestVoice();
  const g = ctx.createGain();
  g.gain.value = callGain;
  g.connect(master);
  return g;
}

// Track a live voice and schedule its cleanup a beat after it ends (so release tails
// finish and the finished source/oscillator nodes can be GC'd).
function registerVoice(node: GainNode, duration: number): void {
  if (!ctx) return;
  const voice: Voice = { node, stopAt: ctx.currentTime + duration, timer: null };
  voices.push(voice);
  const cleanupMs = Math.ceil((duration + 0.05) * 1000);
  voice.timer = setTimeout(() => retireVoice(voice), cleanupMs);
}

// ---- authored sample sets --------------------------------------------------
// Terrains are voiced by recorded foley: a set of one-shot take variants under
// /assets/sfx/<key>/ (sliced from the raw recordings; see tools/sfx/slice-sfx.sh).
// When a set is decoded we play a RANDOM take per landing so repeated moves never
// fatigue. Until a set is decoded (or if it fails to load) that terrain is briefly
// silent; a terrain with no entry at all (only the impassable cliff/rock) is always
// silent — there is no synthesised fallback.
//
// 'arrival' is not a terrain — it's the "unit lands on the board" thump, layered on
// top of the per-terrain spawn sound (see store.ts deploy roll-call) via playArrival.

const SAMPLE_BASE = '/assets/sfx';

// Per-set level trim. The recordings are peak-normalised (hot, ~-1.5 dBFS), so they
// play attenuated; tune per set to balance the terrains against each other by ear.
const SAMPLE_GAINS: Record<string, number> = { grass: 0.5, water: 0.5, sand: 0.6, stone: 0.5, arrival: 0.6 };

const SAMPLE_KEYS = ['grass', 'water', 'sand', 'stone', 'arrival'] as const;
type SampleKey = (typeof SAMPLE_KEYS)[number];

// Which terrains are voiced by an authored set. Every landable terrain is mapped; the
// bare hard-ground terrains (road/bridge/dirt/pebble) reuse the stone footsteps. Only
// the impassable cliff/rock have no entry (pieces never land on them).
const TERRAIN_SAMPLE: Partial<Record<TerrainType, SampleKey>> = {
  grass: 'grass',
  water: 'water',
  sand: 'sand',
  stone: 'stone',
  road: 'stone',
  bridge: 'stone',
  dirt: 'stone',
  pebble: 'stone',
};

interface SampleSet {
  key: SampleKey;
  gain: number;
  variants: string[];
  buffers: (AudioBuffer | null)[];
  state: 'idle' | 'loading' | 'loaded' | 'error';
}

const sampleSets: Partial<Record<SampleKey, SampleSet>> = {};

// Fetch a set's manifest + decode every take into an AudioBuffer. Idempotent: a set
// already loading/loaded is left alone. Safe to call before any gesture — decoding
// works on a suspended context; only *playback* needs the resume.
async function loadSampleSet(key: SampleKey): Promise<void> {
  const w = win();
  const context = ensureContext();
  if (!w || !context || typeof w.fetch !== 'function') return;
  let set = sampleSets[key];
  if (set && (set.state === 'loading' || set.state === 'loaded')) return;
  set = sampleSets[key] = set ?? { key, gain: SAMPLE_GAINS[key] ?? 1, variants: [], buffers: [], state: 'idle' };
  set.state = 'loading';
  try {
    const res = await w.fetch(`${SAMPLE_BASE}/${key}/manifest.json`);
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const man = (await res.json()) as { variants?: unknown };
    const variants = Array.isArray(man.variants)
      ? man.variants.filter((v): v is string => typeof v === 'string')
      : [];
    set.variants = variants;
    set.buffers = new Array(variants.length).fill(null);
    await Promise.all(
      variants.map(async (name, i) => {
        try {
          const r = await w.fetch(`${SAMPLE_BASE}/${key}/${name}`);
          if (!r.ok) return;
          const ab = await r.arrayBuffer();
          set!.buffers[i] = await context.decodeAudioData(ab);
        } catch {
          /* a single bad/missing take is skipped; others still play */
        }
      }),
    );
    set.state = set.buffers.some(Boolean) ? 'loaded' : 'error';
  } catch {
    set.state = 'error';
  }
}

// Kick off decoding for every authored set. Called on the first gesture (when a
// context first exists) so sets are ready before the first landing.
function preloadSamples(): void {
  for (const k of SAMPLE_KEYS) void loadSampleSet(k);
}

// Play a random decoded take from a set through the shared voice/master path.
// Returns false (so the caller knows nothing played) when the set isn't decoded yet
// or has no usable takes.
function playSampleSet(key: SampleKey, callGain: number): boolean {
  const set = sampleSets[key];
  if (!set || set.state !== 'loaded' || !ctx || !master) return false;
  const ready = set.buffers.filter((b): b is AudioBuffer => b !== null);
  if (!ready.length) return false;
  const buf = ready[Math.floor(Math.random() * ready.length)];
  const voiceGain = acquireVoice(callGain * set.gain);
  if (!voiceGain) return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(voiceGain);
  src.start(ctx.currentTime);
  registerVoice(voiceGain, buf.duration);
  return true;
}

/**
 * Play the landing one-shot for a terrain: a random take from its authored sample set.
 *
 * No-ops when effects are muted (master gain 0), Web Audio is unavailable, the context
 * can't run, or the terrain has no recorded set. A polyphony cap (MAX_VOICES) steals the
 * oldest voice so rapid moves stay bounded.
 *
 * @param opts.gain optional per-call multiplier (0..1+) layered onto the voice.
 */
export function playTerrain(terrain: TerrainType, opts?: { gain?: number }): void {
  // Safety net: if a gesture armed listeners but the context was never created (or
  // is still suspended), create + resume it here so the first move isn't swallowed.
  const context = ensureContext();
  if (!context || !master) return;
  if (context.state === 'suspended') {
    void context.resume().catch(() => { /* may need a real gesture first */ });
  }

  // Hard-muted: master audio off or effects volume 0 → don't build any nodes.
  if (masterGainFor(effectsSettings()) <= 0) return;

  const callGain = normGain(opts?.gain);

  // Authored recordings are the only landing voices. A terrain with a decoded sample
  // set plays a random take; one with no mapping (only the impassable cliff/rock) is
  // silent. If the set isn't decoded yet, kick off its load — the first landing may be
  // silent, then later ones play.
  const sampleKey = TERRAIN_SAMPLE[terrain];
  if (!sampleKey) return;
  if (!playSampleSet(sampleKey, callGain)) void loadSampleSet(sampleKey);
}

/**
 * Play the "unit lands on the board" arrival thump (authored landing.mp3), layered
 * on top of the per-terrain spawn sound at the deploy roll-call. No-op (silently
 * kicking off a load) until the sample is decoded. @param opts.gain per-call trim.
 */
export function playArrival(opts?: { gain?: number }): void {
  const context = ensureContext();
  if (!context || !master) return;
  if (context.state === 'suspended') {
    void context.resume().catch(() => { /* may need a real gesture first */ });
  }
  if (masterGainFor(effectsSettings()) <= 0) return;
  if (!playSampleSet('arrival', normGain(opts?.gain))) void loadSampleSet('arrival');
}

/** Audition alias for playTerrain (the Studio SFX catalog / Settings test). */
export function previewTerrain(terrain: TerrainType): void {
  playTerrain(terrain);
}

/** Demo-page alias for the arrival one-shot (Studio audition). */
export function previewArrival(): void {
  playArrival();
}

/**
 * Audition a sample set directly by key — a random take at the given call gain (default
 * full). Used by the Studio's assignment panel so you can hear what a sound would be like
 * (and at what level) before assigning it. No-op (kicking off a load) until decoded.
 */
export function previewSample(key: SampleKey, gain = 1): void {
  const context = ensureContext();
  if (!context || !master) return;
  if (context.state === 'suspended') {
    void context.resume().catch(() => { /* may need a real gesture first */ });
  }
  if (masterGainFor(effectsSettings()) <= 0) return;
  if (!playSampleSet(key, normGain(gain))) void loadSampleSet(key);
}

// ---- catalog / audition accessors ------------------------------------------
// Surface the authored-sample wiring to the Studio so it can tell which terrains are
// voiced by recordings and render the real take waveforms.

export const AUTHORED_SAMPLE_KEYS = SAMPLE_KEYS;
export type { SampleKey };

/** The authored sample key voicing a terrain, or null when it has no recorded set. */
export function authoredSampleKeyFor(terrain: TerrainType): SampleKey | null {
  return TERRAIN_SAMPLE[terrain] ?? null;
}

/** Ensure a set is decoded and return its usable take buffers (for waveform render). */
export async function loadAuthoredSamples(key: SampleKey): Promise<AudioBuffer[]> {
  await loadSampleSet(key);
  const set = sampleSets[key];
  return set ? set.buffers.filter((b): b is AudioBuffer => b !== null) : [];
}

// Test / debug hook: current live-voice count (parity with bgm's _state).
export function _activeVoiceCount(): number {
  return voices.length;
}

// Silence the linter about intentionally-unused tracking flags that aid debugging
// of the lazy-init state machine without being read in the happy path.
void resolved;
