import type { ReactElement } from 'react';
import { Stepper } from './Stepper';
import { BOARD_COLS, BOARD_ROWS } from '../../core/level';

// Shared board-size control: two kit Steppers (Width × Height) clamped to the engine's
// board bounds (core/level.ts BOARD_COLS/BOARD_ROWS). Rendered identically in the
// front-of-house Level Editor and the Studio Lab so size editing lives in ONE place — each
// screen supplies its own onResize (the Level Editor preserves & prunes painted cells; the
// Lab regenerates). Layout reuses the .le-ctrlrow label+control row and the shared <Stepper>
// so it reads the same everywhere (ADR-0011/0014/0033). The numeric clamp lives here so both
// callers stay in legal range without re-implementing it.
export function BoardSizePanel({
  cols,
  rows,
  onResize,
  colLimits = BOARD_COLS,
  rowLimits = BOARD_ROWS,
}: {
  cols: number;
  rows: number;
  onResize: (cols: number, rows: number) => void;
  colLimits?: { min: number; max: number };
  rowLimits?: { min: number; max: number };
}): ReactElement {
  const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
  const setCols = (next: number): void => onResize(clamp(next, colLimits.min, colLimits.max), rows);
  const setRows = (next: number): void => onResize(cols, clamp(next, rowLimits.min, rowLimits.max));
  return (
    <div className="board-size-panel">
      <div className="le-ctrlrow">
        <span className="le-ctrllabel">Width</span>
        <Stepper
          value={cols}
          suffix=""
          decreaseLabel="Narrower board"
          increaseLabel="Wider board"
          onDecrease={() => setCols(cols - 1)}
          onIncrease={() => setCols(cols + 1)}
        />
      </div>
      <div className="le-ctrlrow">
        <span className="le-ctrllabel">Height</span>
        <Stepper
          value={rows}
          suffix=""
          decreaseLabel="Shorter board"
          increaseLabel="Taller board"
          onDecrease={() => setRows(rows - 1)}
          onIncrease={() => setRows(rows + 1)}
        />
      </div>
    </div>
  );
}
