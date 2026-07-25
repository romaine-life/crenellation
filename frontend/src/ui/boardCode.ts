// A compact, URL-safe encoding of a level-editor board, so a board can be shared/inspected
// via `/level-editor?board=<code>`. Round-trips the editor's in-memory layers (tiles, units,
// doodads, cover, and linear features — roads + rivers). Used both to LOAD a board on mount
// and to EXPORT the current one.
//
// Wire shape (keys kept short): { c:cols, r:rows, pf?:playerFaction, f?:fillTileId, t?:{cell:tileId},
//   u?:{cell:[unitId,dir,faction]}, d?:{cell:doodadId}, p?:{anchorCell:propId}, v?:{cell:density},
//   rd?:{cell:roadMaterial}, rv?:{cell:riverMaterial}, fn?:{cell:fenceMaterial}, rc?:[edgeKey],
//   rx?:[edgeKey] }. `f` fills every cell, then `t` overrides — so a "mostly one tile" board stays
// tiny. Features split per kind on the wire (rd=roads, rv=rivers, fn=fences) and merge into one
// `features` map on decode; `rc` (severed edges) and `rx` (forced outward exits) are shared edge
// lists. base64url of the JSON (no padding, +/ -> -_).

import type { GroundCoverDensity } from '../core/groundCover';
import type { FeatureKind, FeatureMaterial, RoadMaterial, RiverMaterial, FenceMaterial } from '../core/featureAutotile';

/** One painted feature cell: which linear feature it carries and its surface material. */
export interface FeatureCell {
  kind: FeatureKind;
  material: FeatureMaterial;
}

export interface EditorBoard {
  cols: number;
  rows: number;
  /** Palette faction the human player controls. Undefined/null means choose at play-load time. */
  playerFaction?: string | null;
  cells: Record<string, string>;
  units: Record<string, { unitId: string; direction: string; faction: string }>;
  doodads: Record<string, { doodadId: string }>;
  /** Multi-cell props (trees/houses), keyed by ANCHOR cell "x,y" -> {propId} (mirrors doodads). */
  props: Record<string, { propId: string }>;
  cover: Record<string, GroundCoverDensity>;
  features: Record<string, FeatureCell>;
  featureCuts: Record<string, true>;
  featureExits: Record<string, true>;
}

const enc = (s: string): string => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const dec = (s: string): string => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
const nonEmpty = (o: object): boolean => Object.keys(o).length > 0;

/** Pick the tile id covering the most cells, so it can be the cheap `f` fill base. */
function dominantTile(cells: Record<string, string>): string | undefined {
  const counts = new Map<string, number>();
  for (const id of Object.values(cells)) counts.set(id, (counts.get(id) ?? 0) + 1);
  let best: string | undefined, n = 0;
  for (const [id, c] of counts) if (c > n) { n = c; best = id; }
  return best;
}

export function encodeBoard(b: EditorBoard): string {
  const fill = dominantTile(b.cells);
  const t: Record<string, string> = {};
  for (const [k, id] of Object.entries(b.cells)) if (id !== fill) t[k] = id;
  const wire: Record<string, unknown> = { c: b.cols, r: b.rows };
  if (b.playerFaction) wire.pf = b.playerFaction;
  if (fill) wire.f = fill;
  if (nonEmpty(t)) wire.t = t;
  if (nonEmpty(b.units)) wire.u = Object.fromEntries(Object.entries(b.units).map(([k, v]) => [k, [v.unitId, v.direction, v.faction]]));
  if (nonEmpty(b.doodads)) wire.d = Object.fromEntries(Object.entries(b.doodads).map(([k, v]) => [k, v.doodadId]));
  // Props mirror doodads on the wire: anchor cell -> bare propId. Emitted only when nonEmpty so a
  // prop-free board encodes byte-identically to a pre-props board.
  if (b.props && nonEmpty(b.props)) wire.p = Object.fromEntries(Object.entries(b.props).map(([k, v]) => [k, v.propId]));
  if (nonEmpty(b.cover)) wire.v = b.cover;
  // Split features by kind so each map's values are bare materials (rd=roads, rv=rivers, fn=fences).
  const rd: Record<string, RoadMaterial> = {};
  const rv: Record<string, RiverMaterial> = {};
  const fn: Record<string, FenceMaterial> = {};
  for (const [k, f] of Object.entries(b.features)) {
    if (f.kind === 'river') rv[k] = f.material as RiverMaterial;
    else if (f.kind === 'fence') fn[k] = f.material as FenceMaterial;
    else rd[k] = f.material as RoadMaterial;
  }
  if (nonEmpty(rd)) wire.rd = rd;
  if (nonEmpty(rv)) wire.rv = rv;
  if (nonEmpty(fn)) wire.fn = fn;
  if (nonEmpty(b.featureCuts)) wire.rc = Object.keys(b.featureCuts);
  if (nonEmpty(b.featureExits)) wire.rx = Object.keys(b.featureExits);
  return enc(JSON.stringify(wire));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function decodeBoard(code: string): EditorBoard | null {
  try {
    const w = JSON.parse(dec(code)) as any;
    const cols = w.c | 0, rows = w.r | 0;
    if (cols < 1 || rows < 1 || cols > 64 || rows > 64) return null;
    const cells: Record<string, string> = {};
    if (w.f) for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) cells[`${x},${y}`] = w.f;
    if (w.t) Object.assign(cells, w.t);
    const units: EditorBoard['units'] = {};
    if (w.u) for (const [k, a] of Object.entries(w.u as Record<string, [string, string, string]>)) units[k] = { unitId: a[0], direction: a[1], faction: a[2] };
    const doodads: EditorBoard['doodads'] = {};
    if (w.d) for (const [k, id] of Object.entries(w.d as Record<string, string>)) doodads[k] = { doodadId: id };
    const props: EditorBoard['props'] = {};
    if (w.p) for (const [k, id] of Object.entries(w.p as Record<string, string>)) props[k] = { propId: id };
    const featureCuts: Record<string, true> = {};
    if (Array.isArray(w.rc)) for (const e of w.rc) featureCuts[e] = true;
    const featureExits: Record<string, true> = {};
    if (Array.isArray(w.rx)) for (const e of w.rx) featureExits[e] = true;
    // Merge the per-kind wire maps back into one features map (rd=roads, rv=rivers, fn=fences).
    const features: Record<string, FeatureCell> = {};
    if (w.rd) for (const [k, m] of Object.entries(w.rd as Record<string, RoadMaterial>)) features[k] = { kind: 'road', material: m };
    if (w.rv) for (const [k, m] of Object.entries(w.rv as Record<string, RiverMaterial>)) features[k] = { kind: 'river', material: m };
    if (w.fn) for (const [k, m] of Object.entries(w.fn as Record<string, FenceMaterial>)) features[k] = { kind: 'fence', material: m };
    return {
      cols, rows, playerFaction: typeof w.pf === 'string' ? w.pf : undefined, cells, units, doodads, props,
      cover: (w.v ?? {}) as Record<string, GroundCoverDensity>,
      features,
      featureCuts,
      featureExits,
    };
  } catch {
    return null;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Decode the `?board=` URL param at editor mount, if present and valid. */
export function readBoardParam(): EditorBoard | null {
  if (typeof window === 'undefined') return null;
  const code = new URLSearchParams(window.location.search).get('board');
  return code ? decodeBoard(code) : null;
}
