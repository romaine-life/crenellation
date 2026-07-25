// The doodad shelf: decorative props a unit can stand *inside*. Each doodad ships as a
// back/front sprite pair (rendered from Blender, split at the contact plane) so the unit
// sorts between them — back tucks behind, front falls over the shins. Mirrors unitCatalog.

export interface DoodadAsset {
  id: string;
  label: string;
  status: string;
  /** Home terrain(s) this doodad belongs on — terrain/family ids ('grass' | 'stone' | 'water'),
   *  the same vocabulary tiles carry. The board brush HARD-gates on this: a doodad only places on
   *  a tile whose family is in this list (a grass tuft refuses stone/water). Empty ⇒ places nowhere. */
  terrains: string[];
  /** ground-contact-anchored sprite halves (96x180, anchor at pixel 48,69). */
  back: string;
  front: string;
}

const sprite = (id: string, half: 'back' | 'front') => `/assets/doodads/${id}/${half}.png`;

// Grass tuft retired: ambient grass is now the general ground-cover tile feature
// (core/groundCover + GroundCoverLayer), not a placed doodad. The glossary keeps the
// grass-tuft sprites only as a static figure illustrating the back/front split.
export const DOODAD_ASSETS: DoodadAsset[] = [
  { id: 'boulder', label: 'Boulder', status: 'render', terrains: ['stone'], back: sprite('boulder', 'back'), front: sprite('boulder', 'front') },
  { id: 'stump', label: 'Tree stump', status: 'render', terrains: ['dirt'], back: sprite('stump', 'back'), front: sprite('stump', 'front') },
  { id: 'fern', label: 'Fern', status: 'render', terrains: ['water'], back: sprite('fern', 'back'), front: sprite('fern', 'front') },
  { id: 'flower', label: 'Flower', status: 'render', terrains: ['grass'], back: sprite('flower', 'back'), front: sprite('flower', 'front') },
];

export const doodadAsset = (id: string): DoodadAsset => DOODAD_ASSETS.find((d) => d.id === id) ?? DOODAD_ASSETS[0];
