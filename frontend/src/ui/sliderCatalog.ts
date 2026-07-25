// Slide-bar (slider) candidates. Unlike scrollbars/surfaces, a slider is a CSS-skinned
// native <input type="range">, not a sprite — so each entry carries its PALETTE (track
// fill/channel + a beveled handle) and the catalog renders a REAL slider with it. The
// grid card shows a static skinned bar; the Viewer exercises a LIVE, draggable slider
// (ADR-0029: read-only = not editable, never lifeless). One slider = one entry here.
//
// Today there is one: the ADR-0025 bronze/stone palette (live on the Settings page). The
// true stone/wood MATERIAL texture is being forged on claude/nervous-robinson and will be
// added here as further entries when it lands.

export interface SliderAsset {
  name: string;
  label: string;
  approach: 'css' | 'forge' | 'pixellab';
  material: string;
  description: string;
  // Live-skin palette:
  fill: string; // filled (value) portion of the track — warm bronze
  channel: string; // empty portion — dark stone
  edge: string; // track border
  handle: string; // handle body
  handleLight: string; // bevel light (top-left)
  handleDark: string; // bevel dark (bottom-right)
  preferred?: boolean;
}

export const SLIDER_ASSETS: SliderAsset[] = [
  {
    name: 'bronze-stone',
    label: 'Bronze · Stone',
    approach: 'css',
    material: 'bronze / stone',
    description:
      'ADR-0025 natural palette: a dark stone channel that fills warm bronze up to a beveled bronze handle — the kit gold/bronze ramp, no forced UI-blue. Flat CSS interim; the forged stone/wood material (claude/nervous-robinson) will re-skin it.',
    fill: '#c79b55',
    channel: '#26231e',
    edge: '#5a5248',
    handle: '#b88a45',
    handleLight: '#f0dba8',
    handleDark: '#5b4124',
    preferred: true,
  },
];
