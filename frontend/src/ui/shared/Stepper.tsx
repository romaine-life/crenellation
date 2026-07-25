import type { ReactElement } from 'react';

// The +/- stepper: a numeric readout flanked by two forged kit-frame keys (ADR-0011/0014),
// with CSS-drawn minus/plus glyphs. Shared chrome — Settings (UI scale) and the level editor
// (board zoom) both render this so the control reads identically. Styled by .settings-stepper /
// .settings-chrome-button / .stepper-glyph in style.css.
export function Stepper({
  value,
  suffix,
  decreaseLabel,
  increaseLabel,
  onDecrease,
  onIncrease,
}: {
  value: number;
  suffix: string;
  decreaseLabel: string;
  increaseLabel: string;
  onDecrease: () => void;
  onIncrease: () => void;
}): ReactElement {
  return (
    <div className="settings-stepper">
      <button type="button" className="settings-chrome-button settings-chrome-button-neutral" aria-label={decreaseLabel} onClick={onDecrease}>
        <span><span className="stepper-glyph stepper-minus" aria-hidden="true" /></span>
      </button>
      <output>{value}{suffix}</output>
      <button type="button" className="settings-chrome-button settings-chrome-button-neutral" aria-label={increaseLabel} onClick={onIncrease}>
        <span><span className="stepper-glyph stepper-plus" aria-hidden="true" /></span>
      </button>
    </div>
  );
}
