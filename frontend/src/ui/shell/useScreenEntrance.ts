import { useEffect, useState } from 'react';

// Screen entrance transition (ADR-0046). The single built-in primitive for fading a screen's
// chrome in when you navigate to it. Spread the returned className onto the screen's CHROME
// ROOT only (e.g. .settings-shell) — never the screen's outer element, which also hosts the
// persistent ambience backdrop: the homepage rain must stay continuous across art-background
// screens, so it lives OUTSIDE the faded chrome and never re-fades (ADR-0046 B/G).
//
// Behaviour: on a NAVIGATION-driven mount the chrome paints at opacity 0, then fades to 1 over
// the entrance tier (slow + decelerate, ADR-0043) and is inert (pointer-events:none) until the
// fade settles (ADR-0046 D — no starting a new transition mid-transition). A pure opacity fade
// is reduced-motion-safe, so it is NOT gated on prefers-reduced-motion (ADR-0043).
//
// It deliberately does NOT play on the initial cold page load — the main menu's cold-load
// reveal owns that first appearance, and a second fade would double up. App flips the flag on
// the first navigation.

let appHasNavigated = false;

// Call once per navigation (from App's nav handler), BEFORE the destination screen mounts.
export function markScreenNavigation(): void {
  appHasNavigated = true;
}

// MUST match --ds-duration-fade in style.css: the inert-during-motion window == the fade length.
const SCREEN_FADE_MS = 350;

export function useScreenEntrance(): string {
  // Freeze "did we arrive here via navigation?" at mount. Cold-loaded screens never fade.
  const [navMount] = useState(() => appHasNavigated);
  // started: released from the initial opacity:0 frame into the 0->1 transition.
  const [started, setStarted] = useState(false);
  // locked: chrome is inert while the fade plays.
  const [locked, setLocked] = useState(navMount);

  useEffect(() => {
    if (!navMount) return undefined;
    // One frame at opacity 0 (so the transition has a start value), then release to opacity 1.
    const raf = requestAnimationFrame(() => setStarted(true));
    const timer = window.setTimeout(() => setLocked(false), SCREEN_FADE_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [navMount]);

  if (!navMount) return '';
  return `screen-enter${started ? '' : ' screen-enter-start'}${locked ? ' screen-enter-lock' : ''}`;
}
