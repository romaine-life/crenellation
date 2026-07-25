import type { ReactNode } from 'react';
import { boardLabCellPosition } from './boardProjection';
import { TileGrid } from './TileGrid';
import { TileTopLayer } from './TileTopLayer';
import type { SocketBoardCell, SocketBoardResult } from '../core/tileBoardGenerator';
import type { TileSocketAsset } from '../core/tileSockets';
import { featureFrameSrc } from '../art/tileset';

// Re-export the projection so existing importers (SkirmishBoard, TilePreview, the
// thumbnail bake) keep working; the math itself now lives in one place: boardProjection.
export { boardLabCellPosition, boardLabMetrics } from './boardProjection';

export interface BoardLabBoardOverlayContext<TAsset extends TileSocketAsset> {
  cell: SocketBoardCell<TAsset>;
  left: number;
  top: number;
}

export interface BoardLabBoardProps<TAsset extends TileSocketAsset> {
  board: SocketBoardResult<TAsset>;
  assetFrameSrc: (asset: TAsset) => string;
  showFootprint?: boolean;
  boardZoom?: number;
  boardPan?: { x: number; y: number };
  className?: string;
  ariaLabel?: string;
  renderCellOverlay?: (context: BoardLabBoardOverlayContext<TAsset>) => ReactNode;
  children?: ReactNode;
}

// Adapter: a generated socket board -> the shared TileGrid render core.
export function BoardLabBoard<TAsset extends TileSocketAsset>({
  board,
  assetFrameSrc,
  showFootprint = false,
  boardZoom = 1,
  boardPan = { x: 0, y: 0 },
  className = '',
  ariaLabel = 'Generated board',
  renderCellOverlay,
  children,
}: BoardLabBoardProps<TAsset>) {
  const sourceCells = board.cells;
  const byKey = new Map<string, SocketBoardCell<TAsset>>(
    sourceCells.map((cell): [string, SocketBoardCell<TAsset>] => [`${cell.x}-${cell.y}`, cell]),
  );
  const cells = sourceCells.map((cell) => {
    // ADR-0039: a tile is a SIDE layer with the TOP composited over it — two stacked layers
    // in the cell's one z-band (the top via the shared <TileTopLayer>, which also owns the
    // animated-water case). The TOP comes from `asset`; the SIDE comes from `sideAsset` when set
    // (the frayed edge / future river-waterfall), else from `asset` itself. Each layer is the
    // baked tile's `-top`/`-side` half; top ∪ side == the original cube, so a plain cell is
    // unchanged and an edge cell keeps its own top with a frayed side. A linear-feature
    // overlay (road) composites OVER the top, on the walkable surface.
    const topSrc = cell.asset ? assetFrameSrc(cell.asset) : undefined;
    const sideSrc = cell.sideAsset ? assetFrameSrc(cell.sideAsset) : topSrc;
    return {
      key: `${cell.x}-${cell.y}`,
      x: cell.x,
      y: cell.y,
      className: cell.missing ? 'is-missing' : '',
      data: {
        'data-asset-id': cell.asset?.id,
        'data-side-id': cell.sideAsset?.id,
        'data-missing': cell.missing?.label,
        'data-board-x': cell.x,
        'data-board-y': cell.y,
      },
      children: topSrc ? (
        <>
          <img className="tile-layer-side" src={(sideSrc ?? topSrc).replace(/\.png$/, '-side.png')} alt="" draggable={false} />
          <TileTopLayer baseSrc={topSrc} animFrames={cell.asset?.topAnimFrames} x={cell.x} y={cell.y} />
          {cell.feature ? (
            <img
              className="tileset-feature-overlay"
              src={featureFrameSrc(cell.feature.kind, cell.feature.material, cell.feature.mask)}
              alt=""
              draggable={false}
            />
          ) : null}
        </>
      ) : (
        <span>{cell.missing?.mask?.toString(2).padStart(4, '0') ?? 'Missing'}</span>
      ),
    };
  });

  return (
    <TileGrid
      cells={cells}
      className={className}
      ariaLabel={ariaLabel}
      showFootprint={showFootprint}
      boardZoom={boardZoom}
      boardPan={boardPan}
      renderCellOverlay={
        renderCellOverlay
          ? (cell, position) => {
              const original = byKey.get(cell.key);
              return original ? renderCellOverlay({ cell: original, left: position.left, top: position.top }) : null;
            }
          : undefined
      }
    >
      {children}
    </TileGrid>
  );
}
