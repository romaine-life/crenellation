import type { ReactElement } from 'react';

// The accepted on/off control: a forged kit-frame button (button-neutral 9-slice) holding two
// words — the active state lights up (warm = on, cool = off), the other dims. Shared chrome —
// Settings (audio / interface sounds) and the level editor (Footprint) render this so the
// control reads identically. Styled by .settings-toggle / .settings-toggle-opt in style.css.
export function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={`settings-toggle ${checked ? 'is-on' : 'is-off'}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-toggle-opt" data-state="off">Off</span>
      <span className="settings-toggle-opt" data-state="on">On</span>
    </button>
  );
}
