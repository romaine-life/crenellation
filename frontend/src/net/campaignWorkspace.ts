// Client for the campaign-editor workspace (all campaigns + their level docs as
// one document). File-backed on the server today; swappable to a DB later.

import type { Campaign, Level } from '../core/level';
import { HttpError } from './http';

export interface Workspace {
  campaigns: Campaign[];
  levels: Record<string, Level>;
}

export async function loadWorkspace(): Promise<Workspace> {
  const res = await fetch('/api/campaign-workspace', { credentials: 'include' });
  if (!res.ok) throw new HttpError('load', res.status);
  const data = (await res.json()) as Partial<Workspace>;
  return {
    campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
    levels: data.levels && typeof data.levels === 'object' ? data.levels : {},
  };
}

export async function saveWorkspace(ws: Workspace): Promise<{ ok: boolean }> {
  const res = await fetch('/api/campaign-workspace', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(ws),
  });
  if (!res.ok) throw new HttpError('save', res.status);
  return res.json() as Promise<{ ok: boolean }>;
}

// --- Official (global) tier ------------------------------------------------
// Officials are dual-homed: the live source is a global DB row (public GET), and a
// committed static file is the durable fallback (DB-down / pre-Step-2). This loader
// is the read-path that makes officials visible to EVERYONE, signed in or not, and
// it NEVER throws — officials must survive any backend failure.
const OFFICIAL_ID = 'default';
const OFFICIAL_FILE = '/assets/campaigns/official.json';

function asWorkspace(value: unknown): Workspace {
  const data = (value && typeof value === 'object' ? value : {}) as Partial<Workspace>;
  return {
    campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
    levels: data.levels && typeof data.levels === 'object' ? data.levels : {},
  };
}

async function loadOfficialFromFile(): Promise<Workspace> {
  try {
    const res = await fetch(OFFICIAL_FILE, { cache: 'no-cache' });
    if (!res.ok) return { campaigns: [], levels: {} };
    return asWorkspace(await res.json());
  } catch {
    return { campaigns: [], levels: {} };
  }
}

export async function loadOfficialCampaigns(): Promise<Workspace> {
  // Prefer the live DB row (public GET, design_portfolios envelope); fall back to the
  // committed static file on any error or a synthesized-empty miss.
  try {
    const res = await fetch(`/api/official-campaigns/${OFFICIAL_ID}`, { cache: 'no-cache' });
    if (!res.ok) return loadOfficialFromFile();
    const body = (await res.json()) as { portfolio?: { data?: unknown } };
    const ws = asWorkspace(body.portfolio?.data);
    // A never-published row synthesizes an empty doc — use the baked file instead.
    return ws.campaigns.length ? ws : loadOfficialFromFile();
  } catch {
    return loadOfficialFromFile();
  }
}

export async function saveOfficialCampaigns(ws: Workspace): Promise<{ revision: number }> {
  const res = await fetch(`/api/official-campaigns/${OFFICIAL_ID}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ data: ws }),
  });
  if (!res.ok) throw new HttpError('save-official', res.status);
  const body = (await res.json()) as { portfolio?: { revision?: number } };
  return { revision: body.portfolio?.revision ?? 0 };
}
