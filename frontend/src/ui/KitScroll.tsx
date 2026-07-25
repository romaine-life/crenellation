import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react';

// A DRAWN scrollbar (ADR-0030). The native scrollbar is hidden; we render an always-present rail
// (a real DOM element — the browser can't hide it) plus a grip thumb that appears only when there's
// scrollable content and tracks the scroll position. Because it's DOM, the rail never vanishes on an
// empty pane AND it screenshots like any other element (native ::-webkit skins don't render in
// headless captures). Content still scrolls natively (wheel/keys); we only draw + drive the bar.
export function KitScroll({ children, className, style }: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; top: number; h: number } | null>(null);
  const [m, setM] = useState<{ scrollable: boolean; h: number; top: number }>({ scrollable: false, h: 0, top: 0 });

  const recompute = (): void => {
    const el = content.current;
    if (!el) return;
    const track = el.clientHeight;
    const scrollable = el.scrollHeight > el.clientHeight + 1;
    const h = scrollable ? Math.max(24, Math.round(track * (el.clientHeight / el.scrollHeight))) : 0;
    const maxScroll = el.scrollHeight - el.clientHeight;
    const top = scrollable && maxScroll > 0 ? Math.round((el.scrollTop / maxScroll) * (track - h)) : 0;
    setM({ scrollable, h, top });
  };

  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    const mo = new MutationObserver(recompute);
    mo.observe(el, { childList: true, subtree: true, attributes: true });
    return () => { ro.disconnect(); mo.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onThumbDown = (e: ReactMouseEvent): void => {
    e.preventDefault();
    const el = content.current;
    if (!el) return;
    drag.current = { y: e.clientY, top: el.scrollTop, h: m.h };
    const move = (ev: MouseEvent): void => {
      const d = drag.current;
      const c = content.current;
      if (!d || !c) return;
      const maxThumb = c.clientHeight - d.h;
      const maxScroll = c.scrollHeight - c.clientHeight;
      if (maxThumb <= 0) return;
      c.scrollTop = d.top + (ev.clientY - d.y) * (maxScroll / maxThumb);
    };
    const up = (): void => {
      drag.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className={`kit-scroll-wrap ${className ?? ''}`.trim()} style={style}>
      <div className="kit-scroll-content" ref={content} onScroll={recompute}>
        {children}
      </div>
      <div className="kit-scroll-rail" aria-hidden="true">
        {m.scrollable ? (
          <div
            className="kit-scroll-thumb"
            style={{ height: `${m.h}px`, transform: `translateY(${m.top}px)` }}
            onMouseDown={onThumbDown}
          />
        ) : null}
      </div>
    </div>
  );
}
