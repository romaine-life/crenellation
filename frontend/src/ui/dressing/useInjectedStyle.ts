import { useCallback, useEffect, useRef, type RefObject } from 'react';

// Injects a live <style> into a same-origin preview iframe and keeps it in sync — the shared
// handshake behind every Studio dressing room (Main Menu / Settings / Campaign viewers).
//
// The SPA inside the iframe mounts its route asynchronously after the iframe `load` fires, so we
// re-inject on load AND on a short interval until it sticks. cssText is read through a ref so the
// load handler / interval stay stable (no re-subscribe per keystroke) while always painting the
// latest value. Same-origin contentDocument access can blip during reload — swallowed and retried.
//
// `onBeforeInject(doc, win)` runs each inject before the stylesheet is written — used by the
// Settings tuner to measure live computed geometry (padding/min-height) into a ref ONCE, before
// its own overrides change those values.
export function useInjectedStyle(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  styleId: string,
  cssText: string,
  opts?: { onBeforeInject?: (doc: Document, win: Window) => void },
): void {
  const cssRef = useRef(cssText);
  cssRef.current = cssText;
  const beforeRef = useRef(opts?.onBeforeInject);
  beforeRef.current = opts?.onBeforeInject;

  const inject = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.head) return; // transient during navigation
      const win = doc.defaultView;
      if (win && beforeRef.current) beforeRef.current(doc, win);
      let style = doc.getElementById(styleId) as HTMLStyleElement | null;
      if (!style) {
        style = doc.createElement('style');
        style.id = styleId;
        doc.head.appendChild(style);
      }
      style.textContent = cssRef.current;
    } catch {
      /* same-origin access can blip during reload — re-inject on the next tick/load */
    }
  }, [iframeRef, styleId]);

  // Re-inject live whenever the CSS changes.
  useEffect(() => {
    inject();
  }, [cssText, inject]);

  // Re-inject on iframe load and on a short interval until the SPA has mounted.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = (): void => inject();
    iframe.addEventListener('load', onLoad);
    let n = 0;
    const timer = window.setInterval(() => {
      inject();
      if (++n > 24) window.clearInterval(timer);
    }, 250);
    return () => {
      iframe.removeEventListener('load', onLoad);
      window.clearInterval(timer);
    };
  }, [iframeRef, inject]);
}
