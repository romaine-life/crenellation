import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

// Make a full-route preview iframe a true-to-window MINIATURE.
//
// The Studio's page viewers iframe a real app route into a side panel. But app screens lay out
// against the viewport — centred bodies under a viewport-relative cap (e.g. .settings-shell:
// max-inline-size: clamp(900px, 88vw, 1240px); justify-self: center) and vw-based gaps. `vw`
// inside an iframe resolves against the IFRAME's own viewport, so a panel-sized iframe re-centres
// and re-proportions everything at the wrong width — the preview drifts from what ships.
//
// Fix: size the iframe to the LIVE window (its vw basis then matches the real page) and
// transform: scale() it down to fit the host panel. Layout resolves identically, then shrinks
// uniformly. Pair the returned values with the .surface-dressing-main.is-window-scaled CSS, which
// absolutely-centres the iframe so its full-size layout box never stretches the panel's grid track
// (the panel's overflow:hidden clips the scaled-down result). Scaling the iframe ELEMENT from the
// parent document does NOT establish a containing block inside the child document, so in-iframe
// background-attachment: fixed (the surface dressing room's continuity trick) is unaffected.
export interface WindowScaledPreview {
  hostRef: RefObject<HTMLElement | null>; // attach to the .surface-dressing-main panel
  frameStyle: CSSProperties; // spread onto the iframe
}

export function useWindowScaledPreview(): WindowScaledPreview {
  const hostRef = useRef<HTMLElement | null>(null);
  // The live window size (the iframe's vw basis) + the contain-scale that fits it into the panel.
  const [fit, setFit] = useState<{ w: number; h: number; scale: number }>({ w: 0, h: 0, scale: 1 });

  // useLayoutEffect so the size lands before paint; ResizeObserver tracks the panel, the resize
  // listener tracks the window (the vw basis itself), so the miniature stays true at any size.
  useLayoutEffect(() => {
    const measure = (): void => {
      const host = hostRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (!rect.width || !rect.height || !vw || !vh) return;
      setFit({ w: vw, h: vh, scale: Math.min(rect.width / vw, rect.height / vh) });
    };
    measure();
    const host = hostRef.current;
    const ro = typeof ResizeObserver !== 'undefined' && host ? new ResizeObserver(measure) : null;
    if (host && ro) ro.observe(host);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return {
    hostRef,
    frameStyle: { width: `${fit.w}px`, height: `${fit.h}px`, transform: `translate(-50%, -50%) scale(${fit.scale})` },
  };
}
