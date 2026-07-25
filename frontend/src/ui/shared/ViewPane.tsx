import { useRef, type CSSProperties, type PointerEvent, type ReactElement, type ReactNode, type WheelEvent } from 'react';

type ViewPaneKind = 'tile' | 'transition' | 'board' | 'unit';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function ViewPane({
  kind,
  ariaLabel,
  zoom,
  pan,
  minZoom,
  maxZoom,
  onZoomChange,
  onPanChange,
  onAssetClick,
  children,
}: {
  kind: ViewPaneKind;
  ariaLabel: string;
  zoom: number;
  pan: { x: number; y: number };
  minZoom: number;
  maxZoom: number;
  onZoomChange: (zoom: number) => void;
  onPanChange: (pan: { x: number; y: number }) => void;
  onAssetClick?: (assetId: string) => void;
  children: ReactNode;
}): ReactElement {
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; assetId?: string } | null>(null);
  const didDragRef = useRef(false);

  const startPan = (event: PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const tileElement = (event.target as HTMLElement).closest<HTMLElement>('[data-asset-id]');
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
      assetId: tileElement?.dataset.assetId,
    };
    didDragRef.current = false;
  };

  const movePan = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4) {
      didDragRef.current = true;
    }
    onPanChange({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  };

  const endPan = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!didDragRef.current && drag.assetId) {
      onAssetClick?.(drag.assetId);
    }
    window.setTimeout(() => {
      didDragRef.current = false;
    }, 0);
  };

  const zoomPane = (event: WheelEvent<HTMLElement>) => {
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    onZoomChange(clamp(Number((zoom + direction * 0.05).toFixed(2)), minZoom, maxZoom));
  };

  return (
    <section
      className={`tileset-view-stage is-${kind}`}
      aria-label={ariaLabel}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={zoomPane}
    >
      <div
        className="tileset-view-art-layer"
        style={{ '--view-zoom': zoom, '--view-pan-x': `${pan.x}px`, '--view-pan-y': `${pan.y}px` } as CSSProperties}
      >
        {children}
      </div>
    </section>
  );
}
