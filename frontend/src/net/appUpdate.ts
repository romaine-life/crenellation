// Proactive new-build detection. index.html is served no-cache and references a
// content-hashed entry chunk (e.g. /assets/index-<hash>.js); a deploy changes
// that hash. This tab knows the hash it booted with, so polling the live
// index.html (no-store) and comparing tells us a newer build is live — letting us
// offer a refresh BEFORE the user navigates into a now-missing chunk (the
// vite:preloadError self-heal in main.tsx is the recovery if they hit it first).
import { useEffect, useState } from 'react';

// Pull the content hash out of a Vite entry-chunk reference, given either a
// <script> src or the raw index.html. Exported for tests.
export function extractEntryHash(htmlOrUrl: string): string {
  const m = String(htmlOrUrl).match(/\/assets\/index-([A-Za-z0-9_-]+)\.js/);
  return m ? m[1] : '';
}

// The entry chunk this tab is currently running. Empty in dev (no hashed entry),
// which makes every check below a no-op there.
function bootedEntryHash(): string {
  const el = document.querySelector('script[type="module"][src*="/assets/index-"]') as HTMLScriptElement | null;
  return extractEntryHash(el?.src || '');
}

// True when the live index.html references a different entry chunk than the one
// this tab booted with — i.e. a newer build has been deployed.
export async function isNewBuildLive(booted = bootedEntryHash()): Promise<boolean> {
  if (!booted) return false;
  try {
    const res = await fetch(`/?_ts=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return false;
    const live = extractEntryHash(await res.text());
    return Boolean(live) && live !== booted;
  } catch {
    return false; // network blip — never prompt on a failed check
  }
}

// Becomes true once a newer build is detected. Checks when the tab regains
// focus and on a slow interval, then stops — there's nothing to recheck.
export function useNewBuildAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const booted = bootedEntryHash();
    if (!booted) return; // dev / unknown — never prompt
    let stopped = false;
    const check = () => {
      if (stopped) return;
      isNewBuildLive(booted).then((isNew) => {
        if (isNew && !stopped) { stopped = true; setAvailable(true); }
      });
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const interval = window.setInterval(check, 5 * 60_000);
    window.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);
  return available;
}
