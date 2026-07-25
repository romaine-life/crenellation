// Portrait bake-off — the candidate pixel-art treatments of each unit's portrait
// master, shown side by side in the Studio (Viewer › Portrait) so the user can pick
// one. Mirrors the board-unit bake-off (see PIXEL_LIBRARIES in unitCatalog.ts):
// navy-only, held OUT of the shipped game; the live HUD keeps rendering `smooth`
// until a winner is promoted. Assets are produced by
// frontend/scripts/portraits/build-portrait-candidate.py.
import type { Piece, Palette } from './PortraitEditor';

export type PortraitMethod = 'smooth' | 'codex-stone' | 'codex-concept' | 'filter2' | 'filter3' | 'codexfilter';

// The six pieces, for the Portraits catalog's Unit filter (single source of truth).
export const PORTRAIT_PIECES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const satisfies readonly Piece[];

// codex-stone is the PRODUCTION treatment (shipped to the HUD/roster, all 4 team palettes);
// the rest are speculative candidates (navy only). Production listed first.
export const PRODUCTION_PORTRAIT_METHOD: PortraitMethod = 'codex-stone';
export const PORTRAIT_METHODS: { key: PortraitMethod; label: string; sub: string; production?: boolean }[] = [
  { key: 'codex-stone', label: 'Codex · stone', sub: 'production · shipped', production: true },
  { key: 'smooth', label: 'Smooth', sub: 'original 3D render' },
  { key: 'codex-concept', label: 'Codex · concept', sub: 'concept-art bust' },
  { key: 'filter2', label: 'Filter ×2', sub: 'pixelate + quantize' },
  { key: 'filter3', label: 'Filter ×3', sub: 'pixelate + quantize' },
  { key: 'codexfilter', label: 'Codex→Filter', sub: 'restyle then filter' },
];

// The full-body master URL for a method. `smooth` is the existing portrait-editor
// master (all palettes); every candidate method is navy-only, so the palette is
// ignored for them — they always resolve to the navy-blue candidate master, which
// the shared crop frames identically to the smooth master.
export function portraitMasterSrc(piece: Piece, palette: Palette, method: PortraitMethod = 'smooth'): string {
  if (method === 'smooth') return `/assets/portrait-editor/${piece}/${palette}.png`;
  // codex-stone is promoted to production — it exists in every team palette; the remaining
  // (speculative) candidates are navy-only, so they ignore the palette.
  if (method === 'codex-stone') return `/assets/portrait-candidates/codex-stone/${piece}/${palette}.png`;
  return `/assets/portrait-candidates/${method}/${piece}/navy-blue.png`;
}
