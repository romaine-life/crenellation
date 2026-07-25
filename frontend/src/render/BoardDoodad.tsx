// Back-compat shim. The 1×1 doodad sprite is now the single-cell case of the general
// multi-cell structure renderer (render/BoardStructure.tsx). Re-exported here so existing
// `import { DoodadSprite } from '../render/BoardDoodad'` callers are unaffected.
export { DoodadSprite, type Doodad } from './BoardStructure';
