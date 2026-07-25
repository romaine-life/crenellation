import { type ReactElement } from 'react';

// The element/category picker shared by every Studio tuner: a labelled dropdown of the tunable
// elements, with a trailing " •" on any option that currently carries an override.
export interface ElementOption {
  id: string;
  label: string;
  tuned?: boolean;
}

export function ElementSelect({ label = 'Element', value, options, onChange }: {
  label?: string;
  value: string;
  options: ElementOption[];
  onChange: (id: string) => void;
}): ReactElement {
  return (
    <label className="tileset-category-select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}{o.tuned ? ' •' : ''}</option>
        ))}
      </select>
    </label>
  );
}
