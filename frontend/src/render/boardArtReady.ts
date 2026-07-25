// Coordinated board-art reveal.
//
// The skirmish board renders dozens of independent tile <img>s (a -top + -side layer
// per cell, plus feature overlays, ground-cover sheets, and unit sprites). Each is
// discovered only after the board mounts and fetched on its own, so without
// coordination they pop in ONE AT A TIME as their PNGs arrive — the "popcorn" load.
//
// This module fixes that the same way the cold-load menu does (ui/shell/coldReveal):
// reveal REAL pixels, gated on actual decode, with a single generous failsafe so a
// stuck asset can never strand the screen.
//
//   1. useBoardArtReveal() warms + decodes the board's whole art set in parallel and
//      returns `ready` only once every image has settled (decoded OR failed). The board
//      stays hidden until then, then fades in as ONE unit (.is-board-loading in CSS).
//   2. A tiny module-scope store (pending/subscribe) lets the cross-route veil in
//      App.tsx hold its dissolve until the board's pixels are on screen — so entering
//      the skirmish from the menu is one calm reveal of a complete board, never a veil
//      lifting onto an empty frame that then fills in. A module store (not React
//      context) because the veil lives in a separate subtree, outside the routed screen.

import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Module-scope readiness store (consumed by the route veil via useSyncExternalStore).
// ---------------------------------------------------------------------------

let pending = false;
// Bumps on every arm so a superseded load (an old failsafe, an unmounted board) can
// never clear the readiness of a newer one: release only acts when its token is current.
let token = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of listeners) cb();
}

function setPending(next: boolean): void {
  if (pending === next) return;
  pending = next;
  emit();
}

export function subscribeBoardArt(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function isBoardArtPending(): boolean {
  return pending;
}

/** Mark the board's art as loading. Returns a token to pass back to {@link releaseBoardArt}. */
export function armBoardArt(): number {
  token += 1;
  setPending(true);
  return token;
}

/** Clear the loading state — but only if this token is still the current arm. */
export function releaseBoardArt(t: number): void {
  if (t === token) setPending(false);
}

// The veil enters its cover phase BEFORE the board mounts, so a board route must mark
// itself pending up front or the veil would reveal an empty frame. This self-clearing
// failsafe guarantees the veil can never strand if the board never mounts (nav aborted);
// the board's own reveal hook re-arms and clears on the real decode.
const NAV_FAILSAFE_MS = 6000;

export function armBoardArtForNav(): void {
  const t = armBoardArt();
  window.setTimeout(() => releaseBoardArt(t), NAV_FAILSAFE_MS);
}

// ---------------------------------------------------------------------------
// The board reveal hook.
// ---------------------------------------------------------------------------

// Generous on purpose: on any normal link every tile decodes well under this, so the
// reveal is driven by ACTUAL readiness. The failsafe only force-reveals a genuinely
// stuck/dead asset so the board can never hang invisible.
const DECODE_FAILSAFE_MS = 4000;

// Resolve once the bitmap is ready. Never rejects — a missing/undecodable asset (404)
// must not stall the whole board's reveal, so an error resolves too.
function decodeImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
    // decode() resolves faster/more reliably for already-cached images; fall through to
    // onload/onerror when it's unsupported or rejects.
    img.decode?.().then(() => resolve()).catch(() => {});
  });
}

/**
 * Hold the board hidden until its whole art set has decoded, then reveal it as one unit.
 *
 * `signature` is the board's STABLE identity (the sorted tile/feature/cover URL set) — it
 * is unchanged by piece movement, so the reveal arms once per board/seed/level and never
 * re-hides mid-game. `urls` is the full set to warm (tiles AND units) and is read live, so
 * the first reveal also covers unit sprites without the unit set re-arming on captures.
 */
export function useBoardArtReveal(urls: readonly string[], signature: string): boolean {
  const [ready, setReady] = useState(false);
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const tokenRef = useRef(0);

  useEffect(() => {
    setReady(false);

    // Nothing to load yet — the board hasn't been solved (the store builds the game in a
    // mount effect, so the very first render can have an empty board). Keep it hidden and
    // do NOT touch the shared gate: leave any nav-arm in place (it has its own failsafe) so
    // the veil keeps holding until the real board arrives and re-runs this effect. Treating
    // "no art" as ready here would reveal an empty board AND drop the veil early.
    const list = urlsRef.current;
    if (list.length === 0) return;

    let settled = false;
    const t = armBoardArt();
    tokenRef.current = t;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      setReady(true);
      releaseBoardArt(t);
    };

    void Promise.allSettled(list.map(decodeImage)).then(finish);
    const failsafe = window.setTimeout(finish, DECODE_FAILSAFE_MS);
    // Clear the failsafe on a board SWAP, but do NOT release the gate here: the store swaps
    // the board once at startup (newSkirmish picks a fresh seed), so the signature changes
    // from board A to board B. Releasing in cleanup would blip `pending` false between them
    // and let the veil slip up onto a still-loading board. arm() bumps the token, so a late
    // decode from the old board can't clear the new one (releaseBoardArt is token-checked).
    return () => window.clearTimeout(failsafe);
    // `urls` is intentionally read via ref: it changes every move (piece positions) but
    // the reveal must re-arm only when the board's identity (signature) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Release the gate only on TRUE unmount (leaving the board), so the veil's dissolve back
  // out to the menu is never stranded waiting on a board that's gone.
  useEffect(() => () => releaseBoardArt(tokenRef.current), []);

  return ready;
}
