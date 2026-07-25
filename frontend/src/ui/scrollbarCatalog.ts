// Scrollbar-grip candidates — a carved wooden element, several ways. Two KINDS:
//  - 'sprite'  — the PNG IS the carved thumb shape (PixelLab, Forge): transparent, shaped.
//  - 'texture' — the PNG is oak MATERIAL that FILLS a plain thumb (Pixelated, Raw).
// Every entry previews AS a scrollbar in the catalog (a track + a skinned thumb), so they read
// as scrollbars rather than loose art. One is the preferred default. Add a grip = one entry here.

export interface ScrollbarAsset {
  name: string;
  label: string;
  approach: 'raw' | 'pixelated' | 'forge' | 'pixellab';
  material: string;
  file: string; // served path under public/
  kind: 'sprite' | 'texture';
  preferred?: boolean;
}

export const SCROLLBAR_ASSETS: ScrollbarAsset[] = [
  { name: 'oak-pixellab', label: 'Oak · PixelLab', approach: 'pixellab', material: 'wood-oak', file: '/assets/ui/scrollbars/oak-pixellab.png', kind: 'sprite', preferred: true },
  { name: 'oak-forge', label: 'Oak · Forge', approach: 'forge', material: 'wood-oak', file: '/assets/ui/scrollbars/oak-forge.png', kind: 'sprite' },
  { name: 'oak-pixelated', label: 'Oak · Pixelated', approach: 'pixelated', material: 'wood-oak', file: '/assets/ui/scrollbars/oak-pixelated.png', kind: 'texture' },
  { name: 'oak-raw', label: 'Oak · Raw', approach: 'raw', material: 'wood-oak', file: '/assets/ui/scrollbars/oak-raw.png', kind: 'texture' },
];
