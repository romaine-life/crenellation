import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Level } from '../core/level';
import { levelToEditorBoard } from '../core/levelBoard';
import { bakeBoardThumbnail, boardContentHash, boardBounds } from './bakeBoardThumbnail';

// One flat baked <img> per level row — the LIST surface (the SELECTED level still shows the
// live, interactive StudioEditableBoard). Both derive the board from levelToEditorBoard(level),
// so the thumbnail matches what the author painted (and the old road->stone mis-map is gone).
//
// Performance contract (the reason this exists — many previews on one screen):
//  - LAZY: the bake only runs when the row scrolls to/near the viewport (IntersectionObserver),
//    not on mount, so a 200-row list doesn't rasterise 200 boards up front.
//  - CACHED: the resulting object URL is memoised module-side by a CONTENT hash of the derived
//    board, so identical boards share one bake and a board re-bakes only when its pixels change.
//  - HiDPI without blur: bake at the displayed size AND a 2× variant; the <img> is integer-sized
//    and nearest-neighbour, so pixel art is never fractionally downscaled.
//  - STABLE LAYOUT: a fixed-size neutral placeholder holds the row's box before the bake lands,
//    so lazy-loading works and the list doesn't reflow.

// Module-level cache: contentHash -> the baked object URL (+ a refcount so a URL is only revoked
// once every mounted thumbnail using it has released it). Survives remounts within the session.
interface CacheEntry {
  url: string;
  refs: number;
}
const urlCache = new Map<string, CacheEntry>();
// In-flight bakes, so two rows with the same board don't bake twice in parallel.
const inflight = new Map<string, Promise<string>>();

// The bake key folds in the device pixel ratio bucket: a 1× and a 2× screen want different
// raster scales, but both should still dedupe per (board, scale).
function cacheKey(contentHash: string, scale: number): string {
  return `${contentHash}@${scale}x`;
}

async function getThumbnailUrl(board: ReturnType<typeof levelToEditorBoard>, contentHash: string, scale: number): Promise<string> {
  const key = cacheKey(contentHash, scale);
  const existing = urlCache.get(key);
  if (existing) {
    existing.refs += 1;
    return existing.url;
  }
  const pending = inflight.get(key);
  if (pending) {
    const url = await pending;
    const entry = urlCache.get(key);
    if (entry) entry.refs += 1;
    return url;
  }
  const promise = (async () => {
    const blob = await bakeBoardThumbnail(board, { scale });
    const url = URL.createObjectURL(blob);
    urlCache.set(key, { url, refs: 1 });
    inflight.delete(key);
    return url;
  })();
  inflight.set(key, promise);
  return promise;
}

function releaseThumbnailUrl(contentHash: string, scale: number): void {
  const key = cacheKey(contentHash, scale);
  const entry = urlCache.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    URL.revokeObjectURL(entry.url);
    urlCache.delete(key);
  }
}

// Integer raster scale for the screen's pixel density (1 on standard displays, 2 on HiDPI),
// capped at 2 — the 2× variant is the spec's HiDPI bake and more would only waste memory.
function rasterScale(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)));
}

export function LevelThumbnail({
  level,
  width,
  height,
  className,
  alt,
}: {
  level: Level;
  width: number;
  height: number;
  className?: string;
  alt?: string;
}): ReactElement {
  const board = useMemo(() => levelToEditorBoard(level), [level]);
  const contentHash = useMemo(() => boardContentHash(board), [board]);
  // The native bake aspect ratio, so the placeholder + <img> box hold the board's true shape.
  const aspect = useMemo(() => {
    const bounds = boardBounds(board);
    return bounds.width > 0 && bounds.height > 0 ? bounds.width / bounds.height : 1;
  }, [board]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  // Lazy gate: only flip `near` true once the row is at/near the viewport. Once seen, stay seen
  // (no need to un-bake when it scrolls away — the object URL is cheap and shared).
  useEffect(() => {
    if (near) return undefined;
    const node = containerRef.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true); // no observer (older env / tests): bake eagerly rather than never.
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      // 200px margin: start baking just before the row enters view so it's ready on arrival.
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);

  // Bake (lazily) once near AND release the prior URL on change/unmount. The scale is fixed per
  // mount; re-keying on contentHash re-bakes when the board changes.
  useEffect(() => {
    if (!near) return undefined;
    let cancelled = false;
    // Exactly one acquire per effect run earns exactly one release. The acquire resolves
    // asynchronously, so release is owned by the acquire's settle handler — that's the only point
    // where the cache entry is guaranteed to exist (cleanup can run BEFORE the bake resolves, when
    // the entry isn't in urlCache yet). Cleanup just flips `cancelled`; the settle handler then
    // releases the ref it took. This releases once and only once, so a shared cache entry's
    // refcount is never double-decremented (which would revoke a URL another row still displays)
    // and never leaked.
    const scale = rasterScale();
    let acquired = false;
    getThumbnailUrl(board, contentHash, scale)
      .then((nextUrl) => {
        acquired = true;
        if (cancelled) {
          releaseThumbnailUrl(contentHash, scale); // unmounted/changed before we could show it
          return;
        }
        setUrl(nextUrl);
      })
      .catch(() => {
        /* a failed bake never acquired a ref; leave the placeholder in place. */
      });
    return () => {
      cancelled = true;
      if (acquired) {
        // Bake already resolved and took a ref for this run: release it now.
        releaseThumbnailUrl(contentHash, scale);
      }
      // Else the settle handler will see `cancelled` and release the ref once it resolves.
      setUrl(null);
    };
  }, [near, board, contentHash]);

  // Integer display dimensions; the box keeps the row's footprint stable whether or not the bake
  // has resolved. The image is letterboxed to the board's native aspect via object-fit:contain.
  const boxStyle = { width: `${Math.round(width)}px`, height: `${Math.round(height)}px` } as const;

  return (
    <div
      ref={containerRef}
      className={`level-thumbnail ${url ? 'is-ready' : 'is-pending'} ${className ?? ''}`.trim()}
      style={boxStyle}
      data-aspect={aspect.toFixed(3)}
      aria-hidden={url ? undefined : true}
    >
      {url ? (
        <img
          src={url}
          width={Math.round(width)}
          height={Math.round(height)}
          loading="lazy"
          decoding="async"
          alt={alt ?? `${level.name} board`}
          style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated', display: 'block' }}
          draggable={false}
        />
      ) : (
        // Neutral, fixed-size placeholder: holds the layout (so lazy-loading + the observer work)
        // until the bake resolves. No spinner — a calm box reads better in a long list.
        <span className="level-thumbnail-placeholder" aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%' }} />
      )}
    </div>
  );
}
