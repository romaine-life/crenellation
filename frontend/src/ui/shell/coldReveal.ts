// Cold-load reveal director.
//
// On a FRESH load of the main menu (route "/"), the menu's layers must appear in a
// fixed order — background, then title bar, then buttons — each as soon as it is
// ready, with a later layer NEVER preceding an earlier one. Rain stays terminal and
// ungated: it keeps its own fade and can never stall the menu.
//
// "Ready" means the layer's art has ACTUALLY loaded (its onload/decode fired), not a
// timer and not fetch-start — so the fade reveals real pixels and nothing downstream
// can paint before an earlier layer's pixels are on screen. A single generous failsafe
// only force-completes a genuinely stuck load.
//
// This is a tiny module-scope store (read via useSyncExternalStore) rather than React
// context because the participants live in SEPARATE subtrees: the title bar is rendered
// in App OUTSIDE the routed screen, while the background + buttons live inside MainMenu.
// A module store reaches both and is drivable from imperative image-load callbacks.
//
// It sequences ONLY on a cold menu load: armForColdHome() is called once from main.tsx
// before React renders. On any non-menu route — and on every later soft navigation —
// the store stays in its default fully-revealed state, so nothing ever hides or blinks.

export type RevealLayer = 'bg' | 'title' | 'buttons' | 'rain';

const LADDER: RevealLayer[] = ['bg', 'title', 'buttons', 'rain'];
const LAST = LADDER.length - 1;

// Single failsafe so a hung/slow asset can't strand the menu forever. Generous on
// purpose: on a normal-to-fast link every layer's real load fires well under this, so
// the reveal is driven by ACTUAL readiness (each layer fades in when its pixels are
// truly on screen, in order). The failsafe only force-completes a genuinely stuck load.
const FAILSAFE_MS = 8000;

const BACKGROUND_URL = '/assets/ui/main-menu/background-scene-v1.avif';

// stageIndex = the highest ladder layer currently allowed to be visible. Default is
// LAST (everything revealed) so any route that never arms shows instantly.
let stageIndex = LAST;
let didArm = false;
let failsafe = 0;
const ready = new Set<RevealLayer>();
const listeners = new Set<() => void>();

interface RevealSnapshot {
  stageIndex: number;
  has: (layer: RevealLayer) => boolean;
}

function makeSnapshot(): RevealSnapshot {
  const idx = stageIndex;
  return { stageIndex: idx, has: (layer) => idx >= LADDER.indexOf(layer) };
}

// Cached so useSyncExternalStore sees a stable reference between changes (a new object
// is emitted only when stageIndex actually advances).
let snapshot: RevealSnapshot = makeSnapshot();

function emit(): void {
  snapshot = makeSnapshot();
  for (const cb of listeners) cb();
}

// Walk the ladder forward from the current stage, opening each next layer that has
// already reported ready. A layer that reported ready early sits withheld until its
// predecessor opens, then this can jump multiple stages in one pass — so a fast
// title+buttons that finished while the background was still loading all reveal
// together the instant the background lands ("as ready", order-enforced).
function advance(): void {
  let moved = false;
  let next = stageIndex + 1;
  while (next <= LAST && ready.has(LADDER[next])) {
    stageIndex = next;
    moved = true;
    next += 1;
  }
  if (stageIndex >= LAST && failsafe) {
    window.clearTimeout(failsafe);
    failsafe = 0;
  }
  if (moved) emit();
}

export function markReady(layer: RevealLayer): void {
  if (ready.has(layer)) return;
  ready.add(layer);
  advance();
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getSnapshot(): RevealSnapshot {
  return snapshot;
}

// True for any path that resolves to <MainMenu> — the renderRoute default. The menu
// has a couple of legacy aliases; everything else is a real route.
export function isMainMenuPath(path: string): boolean {
  const p = path.replace(/\/+$/, '') || '/';
  return p === '/' || p === '/menu-next' || p === '/main-menu';
}

// Arm the ordered reveal — call ONCE from main.tsx before React renders. No-op (leaves
// the store fully revealed) on any non-menu route, so the menu only sequences on a true
// cold load and nothing ever re-hides on later navigations.
export function armForColdHome(): void {
  if (didArm) return;
  didArm = true;
  if (typeof window === 'undefined') return;
  if (!isMainMenuPath(window.location.pathname)) return;

  // Hide everything, then reveal in order as each layer's art actually loads.
  stageIndex = -1;
  ready.clear();
  // Rain is terminal + ungated: mark it ready up front so reaching it just completes
  // the ladder. The rain canvas reveals on its OWN fade and is never gated by this store.
  ready.add('rain');
  emit();

  // Background readiness is gated on the image ACTUALLY loading (not a timer, not
  // fetch-start) so the scene's fade reveals the real photo and nothing downstream can
  // paint before the background pixels are on screen. This probe shares the preloaded,
  // high-priority request from main.tsx (same URL -> one fetch).
  const img = new Image();
  img.decoding = 'async';
  try {
    (img as unknown as { fetchPriority?: string }).fetchPriority = 'high';
  } catch {
    /* fetchPriority unsupported — the preload link in main.tsx still prioritizes it */
  }
  img.onload = () => markReady('bg');
  img.onerror = () => markReady('bg'); // missing/undecodable background: proceed, don't stall
  img.src = BACKGROUND_URL;

  // Title + buttons readiness is reported by MainMenu when their art loads (its decode
  // helper resolves on success OR failure), so no per-layer timers are needed and
  // ordering is enforced structurally. One generous failsafe force-completes the whole
  // ladder if some asset is genuinely stuck, so the menu can never hang on a dead fetch.
  failsafe = window.setTimeout(() => {
    for (const layer of LADDER) markReady(layer);
  }, FAILSAFE_MS);
}
