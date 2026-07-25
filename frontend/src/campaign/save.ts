// Tier-aware save spine, shared by the Campaign Editor and the Level Editor.
//
// Replaces the old global `officialMode` flag: "which backend does a save hit?" is
// answered per-thing by its tier (`origin`/`off-` id), never a mode. One rule serves
// both editors so there is no second place editing campaigns at cross purposes. See
// ADR-0038 and docs/level-editor-save-and-officials-inline.md.

import type { Campaign } from '../core/level';
import { saveWorkspace, saveOfficialCampaigns, type Workspace } from '../net/campaignWorkspace';
import { useCampaigns } from './store';

// Strip the in-memory tier tags before any PUT, so persisted bodies stay identical to
// the canonical Workspace shape (ADR-0038).
function stripTiers(list: Campaign[]): Campaign[] {
  return list.map(({ origin: _origin, readOnly: _readOnly, ...rest }) => rest);
}

// The per-user save EXCLUDES officials (they share the store array): campaigns whose
// origin is not 'official', and levels whose id does not start with `off-`. This single
// filter is what keeps `off-` ids out of campaign_workspaces. (INV1)
export function userWorkspaceForSave(): Workspace {
  const state = useCampaigns.getState();
  return {
    campaigns: stripTiers(state.campaigns.filter((c) => c.origin !== 'official')),
    levels: Object.fromEntries(Object.entries(state.levels).filter(([id]) => !id.startsWith('off-'))),
  };
}

// The official publish serializes ONLY the official slice — campaigns whose origin is
// 'official', levels whose id starts with `off-`. Tier tags stripped, same as the user
// path. (INV2 — changed from "whole store", which was safe only when officialMode made
// the store officials-only.)
export function officialWorkspaceForSave(): Workspace {
  const state = useCampaigns.getState();
  return {
    campaigns: stripTiers(state.campaigns.filter((c) => c.origin === 'official')),
    levels: Object.fromEntries(Object.entries(state.levels).filter(([id]) => id.startsWith('off-'))),
  };
}

// The tier of an id, the basis for routing a save: `off-` ids belong to the official
// (publish) path, everything else to the per-user (save) path.
export function tierOf(id: string): 'official' | 'user' {
  return id.startsWith('off-') ? 'official' : 'user';
}

export function saveUserWorkspace(): Promise<{ ok: boolean }> {
  return saveWorkspace(userWorkspaceForSave());
}

export function publishOfficialWorkspace(): Promise<{ revision: number }> {
  return saveOfficialCampaigns(officialWorkspaceForSave());
}

// Map a thrown save error onto an action or message for the caller's status UI. 401 ⇒
// sign-in; 403 ⇒ the admin gate fired (proves the server fails closed); 503 ⇒ the DB is
// down; else a generic failure. (INV3)
export type SaveErrorResult = { action: 'sign-in' } | { message: string };

export function mapSaveError(e: unknown): SaveErrorResult {
  const status = (e as { status?: number }).status;
  if (status === 401) return { action: 'sign-in' };
  if (status === 403) return { message: 'Admin access required to publish official campaigns.' };
  if (status === 503) return { message: 'Server unavailable — try again in a moment.' };
  return { message: `Save failed: ${(e as Error).message}` };
}
