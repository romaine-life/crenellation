import { type ReactElement, type ReactNode } from 'react';

// Shared dressing-room control primitives. Every Studio tuner (Main Menu, Settings, Campaign)
// reuses these so the panels look and behave identically.

// A numeric slider row with − / + steppers (1px pixel nudges by default) and a ↺ reset. The
// steppers and reset clamp to [min, max]; pass `nudge` for a non-1 increment (e.g. a 0.05× dial).
export function SliderRow({ label, value, set, min, max, step = 1, nudge = 1, dflt }: {
  label: ReactNode;
  value: number;
  set: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  nudge?: number;
  dflt: number;
}): ReactElement {
  const clamp = (v: number): number => Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  return (
    <label className="tileset-catalog-zoom">
      <span>{label}</span>
      <div className="pages-ctl-row">
        <button type="button" className="pages-step" aria-label="Decrease" onClick={(e) => { e.preventDefault(); set(clamp(value - nudge)); }}>−</button>
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
        <button type="button" className="pages-step" aria-label="Increase" onClick={(e) => { e.preventDefault(); set(clamp(value + nudge)); }}>+</button>
        <button type="button" className="pages-mini-reset" title="Reset to default" aria-label="Reset to default" onClick={(e) => { e.preventDefault(); set(dflt); }}>↺</button>
      </div>
    </label>
  );
}

// A permanently-rendered ↺ that sits beside a non-slider control (in a .pages-ctl-row) and resets
// just that one to its default. (Sliders carry their own ↺ via SliderRow.)
export function ctlReset(onReset: () => void): ReactElement {
  return (
    <button type="button" className="pages-mini-reset" title="Reset to default" aria-label="Reset to default" onClick={(e) => { e.preventDefault(); onReset(); }}>↺</button>
  );
}
