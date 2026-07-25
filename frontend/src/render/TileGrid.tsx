import type { CSSProperties, PointerEventHandler, ReactNode } from 'react';
import { boardLabCellPosition, boardLabMetrics } from './boardProjection';

// The one tile-board render core. Owns the board container, the isometric
// centering, and the positioned-cell loop. Every board surface — the game's
// BoardLabBoard, previews, candidate review, and the Studio editor — renders
// through this, supplying its own per-cell content/classes. There is exactly
// one place that turns (x, y) into a positioned `.tileset-generated-board-tile`.

export interface TileGridCell {
  /** Stable React key. */
  key: string;
  x: number;
  y: number;
  /** Extra classes on the tile element (e.g. is-missing / is-empty / is-selected). */
  className?: string;
  /** data-* attributes for tooling/tests. */
  data?: Record<string, string | number | undefined>;
  /** Tile content: the <img>, a missing-tile label, plus any per-cell editor chrome. */
  children?: ReactNode;
}

export interface TileGridProps {
  cells: readonly TileGridCell[];
  className?: string;
  ariaLabel?: string;
  showFootprint?: boolean;
  boardZoom?: number;
  boardPan?: { x: number; y: number };
  onPointerUp?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
  /** A flat overlay layer drawn above every tile (highlights, hit targets). */
  renderCellOverlay?: (cell: TileGridCell, position: { left: number; top: number }) => ReactNode;
  children?: ReactNode;
}

function dataAttributes(data?: Record<string, string | number | undefined>): Record<string, string | number> {
  if (!data) return {};
  const out: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(data)) if (value !== undefined) out[name] = value;
  return out;
}

export function TileGrid({
  cells,
  className = '',
  ariaLabel = 'Tile board',
  showFootprint = false,
  boardZoom = 1,
  boardPan = { x: 0, y: 0 },
  onPointerUp,
  onPointerLeave,
  renderCellOverlay,
  children,
}: TileGridProps) {
  const metrics = boardLabMetrics(cells);

  return (
    <div
      className={`tileset-generated-board ${showFootprint ? 'has-footprint' : ''} ${className}`.trim()}
      style={
        {
          '--board-zoom': boardZoom,
          '--board-pan-x': `${boardPan.x}px`,
          '--board-pan-y': `${boardPan.y}px`,
          '--board-origin-left': `${metrics.originLeft}px`,
          '--board-origin-top': `${metrics.originTop}px`,
        } as CSSProperties
      }
      aria-label={ariaLabel}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      {cells.map((cell) => {
        const { left, top, zIndex } = boardLabCellPosition(cell);
        return (
          <div
            key={cell.key}
            className={`tileset-generated-board-tile ${cell.className ?? ''}`.trim()}
            style={{ left, top, zIndex }}
            {...dataAttributes(cell.data)}
          >
            {cell.children}
          </div>
        );
      })}
      {renderCellOverlay
        ? cells.map((cell) => {
            const { left, top, zIndex } = boardLabCellPosition(cell);
            return (
              <div
                key={`overlay-${cell.key}`}
                className="tileset-generated-board-overlay-cell"
                style={{ left, top, zIndex: zIndex + 10000 }}
              >
                {renderCellOverlay(cell, { left, top })}
              </div>
            );
          })
        : null}
      {children}
    </div>
  );
}
