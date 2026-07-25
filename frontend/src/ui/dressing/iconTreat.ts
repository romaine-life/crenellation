// Icon-contrast treatments auditioned LIVE on the carved tab icons (.settings-tab-icon img) — the
// stone-on-stone glyphs measure ~1.0–1.25:1 (WCAG non-text floor is 3:1), so these raise separation
// WITHOUT a glow (ADR-0006/0027) and WITHOUT a fabricated CSS surface (ADR-0032). 'limestone' and
// 'bevel' are pure CSS over the shipped PNGs; 'bronze' is a LOOK preview only (shipping warm-metal
// icons means RE-FORGING the PNGs, ADR-0011/0025, not a sepia filter) — hence the star. Shared by
// the Main Menu and Settings tuners (same .settings-tab component).
export type IconTreat = 'off' | 'limestone' | 'bronze' | 'bevel';

export const ICON_TREATS: { id: IconTreat; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'limestone', label: 'Pale stone' },
  { id: 'bronze', label: 'Bronze*' },
  { id: 'bevel', label: 'Bevel' },
];

export function iconTreatFilter(treat: IconTreat, lighten: number): string {
  if (treat === 'limestone')
    return `brightness(${lighten}) saturate(0.55) contrast(1.05) drop-shadow(0 1px 0 rgba(0,0,0,0.5)) drop-shadow(0 -1px 0 rgba(255,255,255,0.25))`;
  if (treat === 'bronze')
    return `brightness(1.35) sepia(0.85) saturate(2.4) hue-rotate(-18deg) drop-shadow(0 1px 0 rgba(0,0,0,0.55)) drop-shadow(0 -1px 0 rgba(255,231,180,0.35))`;
  if (treat === 'bevel')
    return `drop-shadow(0 -1px 0 #0a121e) drop-shadow(-1px 0 0 #0a121e) drop-shadow(0 1px 0 rgba(210,228,246,0.7)) drop-shadow(1px 0 0 rgba(210,228,246,0.45))`;
  return '';
}
