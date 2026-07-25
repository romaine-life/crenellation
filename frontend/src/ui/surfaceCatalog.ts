// Accepted background-surface textures — seamless, tileable pixel-art tiles used to fill
// panel/frame interiors. Read-only catalog items: you view them tiled as a surface, you
// don't edit them. Mirrors public/assets/ui/surfaces/accepted-surfaces.json (tile-px 1024,
// repeat). Adding a surface = one entry here, like the other *Catalog data modules.

export interface SurfaceAsset {
  name: string;
  label: string;
  approach: 'hybrid' | 'pixel-model' | 'baseline' | 'pixellab';
  material: string;
  file: string; // served path under public/
  tilePx: number; // intended on-screen tile size for repeat-tiling
}

export const SURFACE_TILE_PX = 1024;

export const SURFACE_ASSETS: SurfaceAsset[] = [
  { name: 'hybrid-stone-blue', label: 'Hybrid · Stone Blue', approach: 'hybrid', material: 'stone-blue', file: '/assets/ui/surfaces/hybrid-stone-blue.png', tilePx: SURFACE_TILE_PX },
  { name: 'hybrid-wood-oak', label: 'Hybrid · Oak', approach: 'hybrid', material: 'wood-oak', file: '/assets/ui/surfaces/hybrid-wood-oak.png', tilePx: SURFACE_TILE_PX },
  { name: 'pixel-model-stone-blue', label: 'Pixel-model · Stone Blue', approach: 'pixel-model', material: 'stone-blue', file: '/assets/ui/surfaces/pixel-model-stone-blue.png', tilePx: SURFACE_TILE_PX },
  { name: 'baseline-stone-blue', label: 'Baseline · Stone Blue', approach: 'baseline', material: 'stone-blue', file: '/assets/ui/surfaces/baseline-stone-blue.png', tilePx: SURFACE_TILE_PX },
  { name: 'baseline-wood-oak', label: 'Baseline · Oak', approach: 'baseline', material: 'wood-oak', file: '/assets/ui/surfaces/baseline-wood-oak.png', tilePx: SURFACE_TILE_PX },
  { name: 'pixellab-stone-blue', label: 'PixelLab · Stone Blue', approach: 'pixellab', material: 'stone-blue', file: '/assets/ui/surfaces/pixellab-stone-blue.png', tilePx: SURFACE_TILE_PX },
];
