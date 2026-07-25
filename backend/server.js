const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;
const frontendDir = process.env.FRONTEND_DIR || path.join(__dirname, '..', 'frontend', 'dist');
const staticFrontendDir = process.env.STATIC_FRONTEND_DIR || '';
const authBaseUrl = (process.env.AUTH_BASE_URL || 'https://auth.romaine.life').replace(/\/+$/, '');
const publicOrigin = (process.env.PUBLIC_ORIGIN || 'https://chess.romaine.life').replace(/\/+$/, '');
const lobbies = new Map();

// Background music. The browser streams tracks directly from BGM_BASE_URL (the
// public-read blob container). The backend assembles the /api/bgm playlist one
// of two ways:
//   - BGM_READ_URL set -> read a static index.json served there (test slots and
//     local dev point this at a same-origin fixture). Plain HTTPS, no creds.
//   - else, an Azure blob base -> LIST the container live (with each blob's
//     title/artist/album metadata) using the pod's workload identity. The
//     container is the single source of truth: drop or delete a track in the
//     container and the playlist follows it — there is no manifest to regenerate.
// Either way this is non-critical chrome: /api/bgm never 500s — it degrades to
// the last good list, then to an empty playlist.
const bgmBaseUrl = (process.env.BGM_BASE_URL || '').replace(/\/+$/, '');
const bgmIndexUrl = (process.env.BGM_READ_URL || '').replace(/\/+$/, '');
const bgmIsAzureBlob = (() => {
  if (!bgmBaseUrl) return false;
  try { return /(^|\.)blob\.core\.windows\.net$/i.test(new URL(bgmBaseUrl).hostname); }
  catch { return false; }
})();
const BGM_CACHE_TTL_MS = 5 * 60 * 1000;
let bgmCache = { tracks: null, expiry: 0 };
let bgmContainerClient = null; // lazily built Azure ContainerClient (list mode only)

app.use(express.json({ limit: '256kb' }));

// ---------------------------------------------------------------------------
// Durable store: Azure Database for PostgreSQL (replaces the pod-ephemeral file
// stores, which had no PVC and were wiped on every restart/rollout). Two
// connection modes, chosen by environment:
//   - DATABASE_URL set            -> password mode (CI Postgres service,
//                                    ephemeral test-slot Postgres, local dev).
//   - POSTGRES_HOST/DATABASE/USER -> Entra (AAD) workload-identity mode (prod):
//                                    a fresh AAD access token is presented as
//                                    the password on each new connection,
//                                    acquired via DefaultAzureCredential from
//                                    the projected ServiceAccount token. No app
//                                    password is ever stored.
// This lives inline on purpose: the supervisor reloads only server.js, so the
// DB layer must travel with it (pg + @azure/identity resolve from the baked
// node_modules via NODE_PATH).
// ---------------------------------------------------------------------------
const databaseUrl = process.env.DATABASE_URL || '';
const pgHost = process.env.POSTGRES_HOST || '';
const pgDatabase = process.env.POSTGRES_DATABASE || '';
const pgUser = process.env.POSTGRES_USER || '';
const AAD_DB_TOKEN_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';
// Fixed key so concurrent pods (a rolling update briefly runs two) serialize
// schema migration via a Postgres session advisory lock.
const MIGRATION_ADVISORY_LOCK_KEY = 4300193001;

const MIGRATIONS = [
  {
    version: 1,
    name: 'init document stores',
    sql: `
      CREATE TABLE IF NOT EXISTS levels (
        owner_email text        NOT NULL,
        id          text        NOT NULL,
        name        text,
        cols        integer,
        rows        integer,
        revision    integer     NOT NULL DEFAULT 0,
        body        jsonb       NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (owner_email, id)
      );
      CREATE TABLE IF NOT EXISTS campaign_workspaces (
        owner_email text        PRIMARY KEY,
        body        jsonb       NOT NULL,
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS design_portfolios (
        id                    text        PRIMARY KEY,
        data                  jsonb       NOT NULL,
        client_schema_version integer,
        metadata              jsonb       NOT NULL DEFAULT '{}'::jsonb,
        revision              integer     NOT NULL DEFAULT 0,
        created_at            timestamptz NOT NULL DEFAULT now(),
        updated_at            timestamptz NOT NULL DEFAULT now(),
        updated_by            text
      );
    `,
  },
  {
    version: 2,
    name: 'reserved: db asset store removed before adoption',
    sql: 'SELECT 1;',
  },
  {
    version: 3,
    name: 'legacy campaign documents and code-owned assets',
    sql: `
      DROP TABLE IF EXISTS design_assets;
      CREATE TABLE IF NOT EXISTS campaigns (
        owner_email text        NOT NULL,
        id          text        NOT NULL,
        body        jsonb       NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (owner_email, id)
      );
    `,
  },
  {
    version: 4,
    name: 'official campaigns global tier',
    // The global OFFICIAL campaign tier (ADR-0038): one upserted row per id (PK id
    // alone ⇒ global, mirroring design_portfolios), holding a complete Workspace
    // {campaigns,levels}. Public GET / admin-gated PUT. The committed official.json
    // is the durable fallback, so the game never depends on this row.
    sql: `
      CREATE TABLE IF NOT EXISTS official_campaigns (
        id                    text        PRIMARY KEY,
        data                  jsonb       NOT NULL,
        client_schema_version integer,
        revision              integer     NOT NULL DEFAULT 0,
        created_at            timestamptz NOT NULL DEFAULT now(),
        updated_at            timestamptz NOT NULL DEFAULT now(),
        updated_by            text
      );
    `,
  },
  {
    version: 5,
    name: 'per-user editable display name',
    // The editable account username (the name shown in the account menu / in-game).
    // The identity (email) is owned by upstream auth and is immutable; this is a
    // per-account override keyed by that email. A null/absent display_name means
    // "no override" — fall back to the upstream name, then the email.
    sql: `
      CREATE TABLE IF NOT EXISTS user_profiles (
        email        text        PRIMARY KEY,
        display_name text,
        updated_at   timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
];

let pool = null;
let dbReady = false;
let migrationPromise = null;

function buildPool() {
  if (databaseUrl) {
    return new Pool({
      connectionString: databaseUrl,
      max: 8,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  if (pgHost && pgDatabase && pgUser) {
    // Lazy require so password-mode environments don't need @azure/identity.
    const { DefaultAzureCredential } = require('@azure/identity');
    const credential = new DefaultAzureCredential();
    return new Pool({
      host: pgHost,
      port: 5432,
      database: pgDatabase,
      user: pgUser,
      // pg evaluates this per new connection; @azure/identity caches the token
      // and refreshes it before the ~1h expiry.
      password: async () => {
        const token = await credential.getToken(AAD_DB_TOKEN_SCOPE);
        if (!token || !token.token) throw new Error('failed to acquire AAD token for Postgres');
        return token.token;
      },
      // sslmode=require equivalent: encrypt in transit. The server is reachable
      // only through the Azure-internal firewall rule, never the public internet.
      ssl: { rejectUnauthorized: false },
      max: 8,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      // Recycle connections before the AAD token TTL so reconnects fetch a fresh
      // token.
      maxLifetimeSeconds: 50 * 60,
    });
  }
  return null;
}

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
    try {
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      const { rows } = await client.query('SELECT version FROM schema_migrations');
      const applied = new Set(rows.map((row) => row.version));
      for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) continue;
        await client.query('BEGIN');
        try {
          await client.query(migration.sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

// Idempotent, self-healing readiness: migrations run once; a failed attempt is
// retried on the next request rather than wedging persistence until a redeploy.
async function ensureDbReady() {
  if (!pool) throw new Error('database_not_configured');
  if (dbReady) return;
  if (!migrationPromise) {
    migrationPromise = runMigrations()
      .then(() => { dbReady = true; })
      .catch((error) => { migrationPromise = null; throw error; });
  }
  await migrationPromise;
}

function dbUnavailable(res, message, error, code) {
  console.error(`${message}:`, error);
  res.status(503).json({ error: code });
}

const LEVEL_ROLES = new Set(['player', 'enemy', 'terrain']);
const LEVEL_PIECES = new Set(['pawn', 'knight', 'bishop', 'rook', 'queen']);
const LEVEL_TERRAIN = new Set(['rock', 'random-rock']);
const MISC_ZONE_TYPES = new Set(['falling-rock']);
const PLAYER_SPAWN_MIN_CELLS = 3;
const PLAYER_1_SPAWN_ZONE_ID = 'player-1-spawn';
const PLAYER_2_SPAWN_ZONE_ID = 'player-2-spawn';
const DESIGN_PORTFOLIO_STORE_SCHEMA_VERSION = 1;
const DESIGN_PORTFOLIO_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const MIGRATED_RAW_ASSET_PATHS = new Set(['/app.js', '/style.css']);

function safeReturnPath(raw) {
  if (!raw || typeof raw !== 'string') return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

function requestOrigin(req) {
  if (process.env.PUBLIC_ORIGIN) return publicOrigin;

  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!host) return publicOrigin;
  return `${proto}://${host}`;
}

function callbackUrl(req) {
  const pathOnly = safeReturnPath(req.query.returnTo);
  return `${requestOrigin(req)}${pathOnly}`;
}

function gravatarUrl(email, size = 96) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const hash = crypto.createHash('md5').update(normalized).digest('hex');
  // d=retro — the 8-bit pixel-art fallback for users with no Gravatar set, which
  // matches the game's pixel aesthetic (was d=identicon, smooth geometric tiles).
  return `https://www.gravatar.com/avatar/${hash}?d=retro&s=${size}`;
}

// Admins who may author the global OFFICIAL campaign tier (ADR-0038). Comma-separated
// allowlist, parsed once into a lowercased Set. FAIL-CLOSED: unset/empty ⇒ nobody can
// publish officials and the game runs on the committed official.json fallback. There
// is no admin role upstream; this is the honest gate, swappable to a role check later.
const adminEmails = new Set(
  String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
);
function isAdminEmail(email) {
  return Boolean(email) && adminEmails.has(String(email).toLowerCase());
}

function publicUser(session) {
  const user = session && session.user;
  if (!user || !user.email) return { signed_in: false };
  const gravatar = gravatarUrl(user.email);
  return {
    signed_in: true,
    email: user.email,
    name: user.name || user.email,
    image: user.image || null,
    gravatar_url: gravatar,
    avatar_url: user.image || gravatar,
    role: user.role || 'pending',
    // UI affordance only (gates inline editing + "Publish to all players" for official
    // campaigns); the real gate is server-side requireAdmin. The allowlist itself is
    // never sent to the client.
    is_admin: isAdminEmail(user.email),
  };
}

function publicLobbyUser(user) {
  if (!user || !user.email) return null;
  return {
    email: user.email,
    name: user.name || user.email,
    avatar_url: user.avatar_url || gravatarUrl(user.email),
  };
}

function publicLobby(lobby, viewerEmail) {
  return {
    id: lobby.id,
    name: lobby.name,
    phase: lobby.phase,
    created_at: lobby.createdAt,
    updated_at: lobby.updatedAt,
    host: publicLobbyUser(lobby.host),
    guest: publicLobbyUser(lobby.guest),
    seats: {
      filled: lobby.guest ? 2 : 1,
      total: 2,
    },
    viewer_role: viewerEmail === lobby.host.email ? 'host' : (lobby.guest && viewerEmail === lobby.guest.email ? 'guest' : 'observer'),
  };
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function designPortfolioId(raw) {
  const id = String(raw || '').trim();
  return DESIGN_PORTFOLIO_ID_PATTERN.test(id) ? id : null;
}

async function dbGetDesignPortfolio(id) {
  await ensureDbReady();
  const { rows } = await pool.query(
    'SELECT data, client_schema_version, metadata, revision, created_at, updated_at, updated_by FROM design_portfolios WHERE id = $1',
    [id],
  );
  return rows[0] || null;
}

async function dbUpsertDesignPortfolio(id, input) {
  await ensureDbReady();
  const { rows } = await pool.query(
    `INSERT INTO design_portfolios (id, data, client_schema_version, metadata, revision, updated_by)
       VALUES ($1, $2::jsonb, $3, $4::jsonb, 1, $5)
     ON CONFLICT (id) DO UPDATE SET
       data = EXCLUDED.data,
       client_schema_version = EXCLUDED.client_schema_version,
       metadata = EXCLUDED.metadata,
       revision = design_portfolios.revision + 1,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by
     RETURNING data, client_schema_version, metadata, revision, created_at, updated_at, updated_by`,
    [id, JSON.stringify(input.data), input.client_schema_version, JSON.stringify(input.metadata || {}), input.updated_by],
  );
  return rows[0];
}

function publicDesignPortfolioDocument(id, document) {
  return {
    id,
    data: isObjectRecord(document && document.data) ? document.data : {},
    client_schema_version: document && Object.hasOwn(document, 'client_schema_version') ? document.client_schema_version : null,
    metadata: isObjectRecord(document && document.metadata) ? document.metadata : {},
    revision: Number.isInteger(document && document.revision) ? document.revision : 0,
    created_at: document && document.created_at ? document.created_at : null,
    updated_at: document && document.updated_at ? document.updated_at : null,
    updated_by: document && document.updated_by ? document.updated_by : null,
  };
}

function clampText(value, fallback, maxLength) {
  const text = String(value || '').trim();
  return (text || fallback).slice(0, maxLength);
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function campaignSummary(campaign) {
  return {
    id: campaign.id,
    title: campaign.title,
    description: campaign.description,
    created_at: campaign.createdAt,
    updated_at: campaign.updatedAt,
    owner_email: campaign.owner.email,
    level_count: campaign.levels.length,
    levels: campaign.levels.map(publicLevel),
  };
}

function publicLevel(level) {
  const zones = ensureRequiredSpawnZones(Array.isArray(level.zones) ? level.zones : normalizeLevelZones(null, level.width, level.height, level.layout), level.width, level.height);
  const zoneAssignments = normalizeZoneAssignments(level.zoneAssignments, zones, level.layout);
  return {
    id: level.id,
    name: level.name,
    objective: level.objective,
    difficulty: level.difficulty,
    width: level.width,
    height: level.height,
    enemy_budget: level.enemyBudget,
    notes: level.notes,
    layout: level.layout.map(publicLevelCell),
    random_rocks_count: level.randomRocksCount ?? 0,
    zones: zones.map(publicZone),
    zone_assignments: publicZoneAssignments(zoneAssignments),
  };
}

function publicLevelCell(cell) {
  return {
    x: cell.x,
    y: cell.y,
    role: cell.role,
    type: cell.type,
  };
}

function publicZone(zone) {
  return {
    id: zone.id,
    name: zone.name,
    selections: zone.selections.map((selection) => ({ ...selection })),
  };
}

function publicZoneAssignments(assignments) {
  return {
    player_1_spawn_zone_id: assignments.player1SpawnZoneId,
    player_2_spawn_zone_id: assignments.player2SpawnZoneId,
    misc_zones: assignments.miscZones.map((zone) => ({ ...zone })),
  };
}

function timestampString(value, fallback = new Date().toISOString()) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) return value;
  return fallback;
}

function campaignFromRow(row) {
  if (!row || !isObjectRecord(row.body)) return null;
  const fallbackUpdatedAt = timestampString(row.updated_at);
  const campaign = row.body;
  return {
    ...campaign,
    id: typeof campaign.id === 'string' ? campaign.id : row.id,
    title: typeof campaign.title === 'string' ? campaign.title : 'Untitled Campaign',
    description: typeof campaign.description === 'string' ? campaign.description : '',
    createdAt: timestampString(campaign.createdAt, timestampString(row.created_at, fallbackUpdatedAt)),
    updatedAt: timestampString(campaign.updatedAt, fallbackUpdatedAt),
    owner: {
      ...(isObjectRecord(campaign.owner) ? campaign.owner : {}),
      email: row.owner_email,
    },
    levels: Array.isArray(campaign.levels) ? campaign.levels : [],
  };
}

async function dbListCampaigns(ownerEmail) {
  await ensureDbReady();
  const { rows } = await pool.query(
    'SELECT owner_email, id, body, created_at, updated_at FROM campaigns WHERE owner_email = $1 ORDER BY updated_at DESC',
    [ownerEmail],
  );
  return rows.map(campaignFromRow).filter(Boolean);
}

async function dbGetCampaign(ownerEmail, id) {
  await ensureDbReady();
  const { rows } = await pool.query(
    'SELECT owner_email, id, body, created_at, updated_at FROM campaigns WHERE owner_email = $1 AND id = $2',
    [ownerEmail, id],
  );
  return campaignFromRow(rows[0]);
}

async function dbPutCampaign(ownerEmail, campaign) {
  await ensureDbReady();
  const { rows } = await pool.query(
    `INSERT INTO campaigns (owner_email, id, body, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (owner_email, id) DO UPDATE SET
       body = EXCLUDED.body,
       updated_at = EXCLUDED.updated_at
     RETURNING owner_email, id, body, created_at, updated_at`,
    [ownerEmail, campaign.id, JSON.stringify(campaign), campaign.createdAt, campaign.updatedAt],
  );
  return campaignFromRow(rows[0]);
}

async function dbDeleteCampaign(ownerEmail, id) {
  await ensureDbReady();
  const result = await pool.query(
    'DELETE FROM campaigns WHERE owner_email = $1 AND id = $2',
    [ownerEmail, id],
  );
  return result.rowCount > 0;
}

function defaultLevelLayout(width, height) {
  return [
    { x: Math.floor(width / 2), y: height - 1, role: 'player', type: 'pawn' },
    { x: Math.floor(width / 2), y: 0, role: 'enemy', type: 'pawn' },
    { x: Math.max(0, Math.floor(width / 2) - 1), y: Math.max(0, Math.floor(height / 2) - 1), role: 'terrain', type: 'rock' },
  ];
}

function normalizeCoordinate(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number);
  if (rounded < 0 || rounded >= max) return null;
  return rounded;
}

function normalizeLevelCell(raw, width, height) {
  if (!raw || typeof raw !== 'object') return null;
  const role = String(raw.role || '').trim().toLowerCase();
  const type = String(raw.type || '').trim().toLowerCase();
  const x = normalizeCoordinate(raw.x, width);
  const y = normalizeCoordinate(raw.y, height);
  if (x === null || y === null || !LEVEL_ROLES.has(role)) return null;
  if (role === 'terrain') {
    if (!LEVEL_TERRAIN.has(type)) return null;
  } else if (!LEVEL_PIECES.has(type)) {
    return null;
  }
  return { x, y, role, type };
}

function normalizeLevelLayout(rawLayout, width, height) {
  const cells = Array.isArray(rawLayout) ? rawLayout : defaultLevelLayout(width, height);
  const byCoord = new Map();
  cells.forEach((raw) => {
    const cell = normalizeLevelCell(raw, width, height);
    if (cell) byCoord.set(`${cell.x},${cell.y}`, cell);
  });
  return Array.from(byCoord.values()).sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

function normalizeZoneSelection(raw, width, height, index) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '').trim().toLowerCase();
  const id = clampText(raw.id, `selection-${index + 1}`, 64);
  if (type === 'cell') {
    const x = normalizeCoordinate(raw.x, width);
    const y = normalizeCoordinate(raw.y, height);
    if (x === null || y === null) return null;
    return { id, type, x, y };
  }
  if (type === 'rect') {
    const x1 = normalizeCoordinate(raw.x1, width);
    const y1 = normalizeCoordinate(raw.y1, height);
    const x2 = normalizeCoordinate(raw.x2, width);
    const y2 = normalizeCoordinate(raw.y2, height);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
    return { id, type, x1, y1, x2, y2 };
  }
  return null;
}

function defaultSpawnZones(width, height) {
  return [
    {
      id: PLAYER_1_SPAWN_ZONE_ID,
      name: 'Player 1 Spawn',
      selections: [{ id: 'selection-1', type: 'rect', x1: 0, y1: height - 1, x2: width - 1, y2: height - 1 }],
    },
    {
      id: PLAYER_2_SPAWN_ZONE_ID,
      name: 'Player 2 Spawn',
      selections: [{ id: 'selection-1', type: 'rect', x1: 0, y1: 0, x2: width - 1, y2: 0 }],
    },
  ];
}

function ensureRequiredSpawnZones(zones, width, height) {
  const next = Array.isArray(zones) ? zones.map((zone) => ({ ...zone, selections: [...zone.selections] })) : [];
  const ids = new Set(next.map((zone) => zone.id));
  defaultSpawnZones(width, height).forEach((zone) => {
    if (!ids.has(zone.id)) next.unshift(zone);
  });
  return next;
}

function randomRockZoneFromLayout(layout, id = 'falling-rock-zone') {
  const randomRocks = layout.filter((cell) => cell.role === 'terrain' && cell.type === 'random-rock');
  if (!randomRocks.length) return null;
  return {
    id,
    name: 'Falling Rock Zone',
    selections: randomRocks.map((cell, index) => ({
      id: `selection-${index + 1}`,
      type: 'cell',
      x: cell.x,
      y: cell.y,
    })),
  };
}

function normalizeLevelZones(rawZones, width, height, layout) {
  const zones = Array.isArray(rawZones) ? rawZones : [];
  const normalized = zones.map((raw, index) => {
    if (!raw || typeof raw !== 'object') return null;
    const id = clampText(raw.id, `zone-${index + 1}`, 64);
    const selections = Array.isArray(raw.selections) ? raw.selections : [];
    return {
      id,
      name: clampText(raw.name, `Zone ${index + 1}`, 40),
      selections: selections
        .map((selection, selectionIndex) => normalizeZoneSelection(selection, width, height, selectionIndex))
        .filter(Boolean)
        .slice(0, 500),
    };
  }).filter(Boolean).slice(0, 50);

  if (!Array.isArray(rawZones)) {
    const defaultZones = defaultSpawnZones(width, height);
    normalized.unshift(...defaultZones);
    const migrated = randomRockZoneFromLayout(layout);
    if (migrated) normalized.push(migrated);
  }

  return normalized;
}

function normalizeZoneId(value, zoneIds) {
  const id = String(value || '').trim();
  return id && zoneIds.has(id) ? id : null;
}

function normalizeZoneAssignments(raw, zones, layout) {
  const zoneIds = new Set(zones.map((zone) => zone.id));
  const source = raw && typeof raw === 'object' ? raw : {};
  const player1SpawnZoneId = zoneIds.has(PLAYER_1_SPAWN_ZONE_ID) ? PLAYER_1_SPAWN_ZONE_ID : null;
  const player2SpawnZoneId = zoneIds.has(PLAYER_2_SPAWN_ZONE_ID) ? PLAYER_2_SPAWN_ZONE_ID : null;
  const rawMisc = Array.isArray(source.misc_zones) ? source.misc_zones : (Array.isArray(source.miscZones) ? source.miscZones : []);
  const miscZones = rawMisc.map((rawZone, index) => {
    if (!rawZone || typeof rawZone !== 'object') return null;
    const type = String(rawZone.type || '').trim().toLowerCase();
    const zoneId = normalizeZoneId(rawZone.zone_id ?? rawZone.zoneId, zoneIds);
    if (!MISC_ZONE_TYPES.has(type) || !zoneId) return null;
    return {
      id: clampText(rawZone.id, `misc-zone-${index + 1}`, 64),
      type,
      zone_id: zoneId,
    };
  }).filter(Boolean).slice(0, 50);

  const migrated = randomRockZoneFromLayout(layout);
  if (!raw && migrated && zoneIds.has(migrated.id)) {
    miscZones.push({ id: 'misc-zone-1', type: 'falling-rock', zone_id: migrated.id });
  }

  return { player1SpawnZoneId, player2SpawnZoneId, miscZones };
}

function zoneCells(zone, width, height) {
  const cells = new Set();
  (zone && Array.isArray(zone.selections) ? zone.selections : []).forEach((selection) => {
    if (selection.type === 'cell') {
      if (normalizeCoordinate(selection.x, width) !== null && normalizeCoordinate(selection.y, height) !== null) {
        cells.add(`${selection.x},${selection.y}`);
      }
    } else if (selection.type === 'rect') {
      const x1 = normalizeCoordinate(selection.x1, width);
      const y1 = normalizeCoordinate(selection.y1, height);
      const x2 = normalizeCoordinate(selection.x2, width);
      const y2 = normalizeCoordinate(selection.y2, height);
      if (x1 === null || y1 === null || x2 === null || y2 === null) return;
      const startX = Math.min(x1, x2);
      const endX = Math.max(x1, x2);
      const startY = Math.min(y1, y2);
      const endY = Math.max(y1, y2);
      for (let y = startY; y <= endY; y += 1) {
        for (let x = startX; x <= endX; x += 1) {
          cells.add(`${x},${y}`);
        }
      }
    }
  });
  return cells;
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validateLevelZones(level) {
  const zoneById = new Map(level.zones.map((zone) => [zone.id, zone]));
  [
    ['player_1_spawn_zone_id', PLAYER_1_SPAWN_ZONE_ID],
    ['player_2_spawn_zone_id', PLAYER_2_SPAWN_ZONE_ID],
  ].forEach(([field, zoneId]) => {
    if (!zoneById.has(zoneId)) {
      throw validationError(`${field}_required`);
    }
    const count = zoneCells(zoneById.get(zoneId), level.width, level.height).size;
    if (count < PLAYER_SPAWN_MIN_CELLS) {
      throw validationError(`${field}_needs_${PLAYER_SPAWN_MIN_CELLS}_cells`);
    }
  });
}

function buildLevel(raw, index) {
  const width = clampNumber(raw && raw.width, 8, 4, 16);
  const height = clampNumber(raw && raw.height, 12, 4, 20);
  const layout = normalizeLevelLayout(raw && raw.layout, width, height);
  const zones = normalizeLevelZones(raw && raw.zones, width, height, layout);
  const level = {
    id: crypto.randomUUID(),
    name: clampText(raw && raw.name, `Level ${index + 1}`, 48),
    objective: clampText(raw && raw.objective, 'Defeat all enemies', 96),
    difficulty: clampText(raw && raw.difficulty, 'normal', 20),
    width,
    height,
    enemyBudget: clampNumber(raw && (raw.enemy_budget ?? raw.enemyBudget), 3, 1, 24),
    notes: clampText(raw && raw.notes, '', 400),
    layout,
    randomRocksCount: clampNumber(raw && (raw.random_rocks_count ?? raw.randomRocksCount), 0, 0, 100),
    zones,
    zoneAssignments: normalizeZoneAssignments(raw && (raw.zone_assignments ?? raw.zoneAssignments), zones, layout),
  };
  validateLevelZones(level);
  return level;
}

function applyLevelPatch(level, raw) {
  if (!raw || typeof raw !== 'object') return;
  const next = {
    ...level,
    layout: [...level.layout],
    zones: Array.isArray(level.zones) ? level.zones.map((zone) => ({ ...zone, selections: [...zone.selections] })) : normalizeLevelZones(null, level.width, level.height, level.layout),
    zoneAssignments: null,
  };
  next.zoneAssignments = normalizeZoneAssignments(level.zoneAssignments, next.zones, next.layout);
  if (Object.hasOwn(raw, 'name')) next.name = clampText(raw.name, next.name, 48);
  if (Object.hasOwn(raw, 'objective')) next.objective = clampText(raw.objective, next.objective, 96);
  if (Object.hasOwn(raw, 'difficulty')) next.difficulty = clampText(raw.difficulty, next.difficulty, 20);
  if (Object.hasOwn(raw, 'width')) next.width = clampNumber(raw.width, next.width, 4, 16);
  if (Object.hasOwn(raw, 'height')) next.height = clampNumber(raw.height, next.height, 4, 20);
  if (Object.hasOwn(raw, 'enemy_budget') || Object.hasOwn(raw, 'enemyBudget')) {
    next.enemyBudget = clampNumber(raw.enemy_budget ?? raw.enemyBudget, next.enemyBudget, 1, 24);
  }
  if (Object.hasOwn(raw, 'notes')) next.notes = clampText(raw.notes, next.notes, 400);
  if (Object.hasOwn(raw, 'width') || Object.hasOwn(raw, 'height')) {
    next.layout = normalizeLevelLayout(next.layout, next.width, next.height);
    next.zones = normalizeLevelZones(next.zones, next.width, next.height, next.layout);
    next.zoneAssignments = normalizeZoneAssignments(next.zoneAssignments, next.zones, next.layout);
  }
  if (Object.hasOwn(raw, 'layout')) {
    next.layout = normalizeLevelLayout(raw.layout, next.width, next.height);
  }
  if (Object.hasOwn(raw, 'random_rocks_count') || Object.hasOwn(raw, 'randomRocksCount')) {
    next.randomRocksCount = clampNumber(raw.random_rocks_count ?? raw.randomRocksCount, next.randomRocksCount, 0, 100);
  }
  if (Object.hasOwn(raw, 'zones')) {
    next.zones = normalizeLevelZones(raw.zones, next.width, next.height, next.layout);
    next.zoneAssignments = normalizeZoneAssignments(next.zoneAssignments, next.zones, next.layout);
  }
  if (Object.hasOwn(raw, 'zone_assignments') || Object.hasOwn(raw, 'zoneAssignments')) {
    next.zoneAssignments = normalizeZoneAssignments(raw.zone_assignments ?? raw.zoneAssignments, next.zones, next.layout);
  }
  validateLevelZones(next);
  Object.assign(level, next);
}

async function readSession(req) {
  const host = req.get('host') || '';
  if (host.includes('.tank.dev.romaine.life')) {
    const cookie = req.get('cookie') || '';
    if (cookie.includes('better-auth.session=mock-dev-session')) {
      return {
        user: {
          email: 'player@example.com',
          name: 'Tactics Player',
          role: 'pending',
        }
      };
    }
  }
  const cookie = req.get('cookie');
  if (!cookie) return null;
  const upstream = await fetch(`${authBaseUrl}/api/auth/get-session`, {
    headers: {
      accept: 'application/json',
      cookie,
    },
  });
  if (!upstream.ok) {
    const error = new Error('auth_unavailable');
    error.statusCode = 502;
    throw error;
  }
  return upstream.json();
}

async function requireUser(req, res) {
  let session;
  try {
    session = await readSession(req);
  } catch (error) {
    console.error('auth session check failed:', error);
    res.status(error.statusCode || 502).json({ error: 'auth_unavailable' });
    return null;
  }
  const user = publicUser(session);
  if (!user.signed_in) {
    res.status(401).json({ error: 'sign_in_required' });
    return null;
  }
  return user;
}

// Gate for authoring the global OFFICIAL campaign tier (ADR-0038). requireUser first
// (reusing its 401/502 behavior), then allowlist membership. Fail-closed when
// ADMIN_EMAILS is unset. Deliberately NOT requireDesignPortfolioWriter, which falls
// through to any-signed-in-user in prod.
async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (!isAdminEmail(user.email)) {
    res.status(403).json({ error: 'admin_required' });
    return null;
  }
  return user;
}

async function requireDesignPortfolioWriter(req, res) {
  const host = req.get('host') || '';
  if (host.includes('.tank.dev.romaine.life')) {
    return {
      email: 'test-slot@chess-tactics.local',
      name: 'Test Slot',
      role: 'designer',
    };
  }
  return requireUser(req, res);
}

function activeLobbies() {
  return Array.from(lobbies.values())
    .filter((lobby) => lobby.phase !== 'closed')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function userActiveLobby(email) {
  return activeLobbies().find((lobby) => lobby.host.email === email || (lobby.guest && lobby.guest.email === email)) || null;
}

function lobbyNameFor(user) {
  const base = (user.name || user.email || 'Player').split('@')[0].trim();
  return `${base}'s lobby`;
}

function forwardSetCookie(upstream, res) {
  const cookies = typeof upstream.headers.getSetCookie === 'function'
    ? upstream.headers.getSetCookie()
    : [upstream.headers.get('set-cookie')].filter(Boolean);
  cookies.forEach((cookie) => res.append('set-cookie', cookie));
}

function frontendIndexFile() {
  if (staticFrontendDir) {
    const overrideIndex = path.join(staticFrontendDir, 'index.html');
    if (fs.existsSync(overrideIndex)) return overrideIndex;
  }
  return path.join(frontendDir, 'index.html');
}

app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

// Readable fallback title from a slugged blob name, used only when a track has no
// `title` metadata yet (e.g. just dropped in the container, not synced). e.g.
// "03-heavens-devils.mp3" -> "Heavens Devils".
function bgmTitleFromName(file) {
  const base = String(file).replace(/\.mp3$/i, '').replace(/^\d+\s*[-._\s]\s*/, '');
  const words = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1)) || String(file);
}

// List the BGM container's .mp3 blobs with metadata (prod / Azure mode).
// DefaultAzureCredential uses the pod's federated workload-identity token — the
// same mechanism the Postgres pool uses — authorized by the Storage Blob Data
// Reader role on the media account (tofu/storage.tf). Lazily required so non-Azure
// environments (the index path) never load the SDK.
async function listBgmTracksFromContainer() {
  if (!bgmContainerClient) {
    const { BlobServiceClient } = require('@azure/storage-blob');
    const { DefaultAzureCredential } = require('@azure/identity');
    const u = new URL(bgmBaseUrl);
    const service = new BlobServiceClient(`${u.protocol}//${u.host}`, new DefaultAzureCredential());
    bgmContainerClient = service.getContainerClient(u.pathname.replace(/^\/+/, ''));
  }
  const tracks = [];
  for await (const blob of bgmContainerClient.listBlobsFlat({ includeMetadata: true })) {
    if (!/\.mp3$/i.test(blob.name)) continue;
    const md = blob.metadata || {};
    const title = (md.title || '').trim();
    const artist = (md.artist || '').trim();
    const album = (md.album || '').trim();
    tracks.push({
      title: title || bgmTitleFromName(blob.name),
      ...(artist ? { artist } : {}),
      ...(album ? { album } : {}),
      url: `${bgmBaseUrl}/${encodeURIComponent(blob.name)}`,
    });
  }
  // Stable order so the cached payload is deterministic; the player reshuffles.
  tracks.sort((a, b) => a.url.localeCompare(b.url));
  return tracks;
}

// Background-music playlist. The frontend consumes this app-owned contract; the
// blob storage account stays under the backend (borrow primitives, not
// boundaries). Cached briefly so we don't re-list / re-fetch on every page load.
// BGM is non-critical chrome: this endpoint never 500s — it degrades to the
// last good list, then to an empty playlist.
app.get('/api/bgm', async (_req, res) => {
  if (!bgmBaseUrl) {
    res.status(200).json({ tracks: [] });
    return;
  }
  const now = Date.now();
  if (bgmCache.tracks && bgmCache.expiry > now) {
    res.status(200).json({ tracks: bgmCache.tracks });
    return;
  }
  try {
    let tracks;
    if (bgmIndexUrl) {
      const response = await fetch(`${bgmIndexUrl}/index.json`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`index ${response.status}`);
      const index = await response.json();
      const list = Array.isArray(index && index.tracks) ? index.tracks : [];
      tracks = list
        .filter((track) => track && typeof track.file === 'string' && track.file)
        .map((track) => ({
          title: typeof track.title === 'string' && track.title ? track.title : track.file,
          ...(typeof track.artist === 'string' && track.artist ? { artist: track.artist } : {}),
          ...(typeof track.album === 'string' && track.album ? { album: track.album } : {}),
          url: `${bgmBaseUrl}/${encodeURIComponent(track.file)}`,
        }));
    } else if (bgmIsAzureBlob) {
      tracks = await listBgmTracksFromContainer();
    } else {
      tracks = [];
    }
    bgmCache = { tracks, expiry: now + BGM_CACHE_TTL_MS };
    res.status(200).json({ tracks });
  } catch (error) {
    if (bgmCache.tracks) {
      res.status(200).json({ tracks: bgmCache.tracks });
      return;
    }
    console.warn(`/api/bgm: could not load playlist (${bgmIndexUrl ? 'index' : 'list'}): ${error.message}`);
    res.status(200).json({ tracks: [] });
  }
});

// --- Editable account username ---------------------------------------------
// The display name shown for a signed-in user is editable: the email is the
// immutable upstream identity, but the name is a per-account override stored here.
const DISPLAY_NAME_MAX = 40;

async function dbGetDisplayName(email) {
  await ensureDbReady();
  const { rows } = await pool.query(
    'SELECT display_name FROM user_profiles WHERE email = $1',
    [email],
  );
  return rows[0] ? rows[0].display_name : null;
}

async function dbPutDisplayName(email, displayName) {
  await ensureDbReady();
  await pool.query(
    `INSERT INTO user_profiles (email, display_name)
       VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       updated_at = now()`,
    [email, displayName],
  );
}

// Overlay the user's chosen name onto the public user shape. A DB hiccup must never
// break the identity read, so a failed/disabled lookup just yields the upstream name.
async function withDisplayName(user) {
  if (!user || !user.signed_in || !pool) return user;
  try {
    const displayName = await dbGetDisplayName(user.email);
    if (displayName) return { ...user, name: displayName };
  } catch (error) {
    console.warn('display-name lookup failed; using upstream name:', error.message);
  }
  return user;
}

app.get('/api/auth/me', async (req, res) => {
  try {
    const session = await readSession(req);
    res.status(200).json(await withDisplayName(publicUser(session)));
  } catch (error) {
    console.error('auth session check failed:', error);
    res.status(502).json({ signed_in: false, error: 'auth_unavailable' });
  }
});

// Set or clear the signed-in user's display name. Body: { name }. An empty/whitespace
// name clears the override, falling back to the upstream name then the email. The email
// is the identity and is never editable here.
app.patch('/api/auth/me', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const raw = req.body && typeof req.body.name === 'string' ? req.body.name : '';
  const name = clampText(raw, '', DISPLAY_NAME_MAX);
  try {
    await dbPutDisplayName(user.email, name || null);
    res.status(200).json(name ? { ...user, name } : user);
  } catch (error) {
    dbUnavailable(res, 'display name write failed', error, 'profile_unavailable');
  }
});

app.get('/api/lobbies', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.status(200).json({
    lobbies: activeLobbies().map((lobby) => publicLobby(lobby, user.email)),
    current: userActiveLobby(user.email) ? publicLobby(userActiveLobby(user.email), user.email) : null,
  });
});

app.post('/api/lobbies', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const existing = userActiveLobby(user.email);
  if (existing) {
    res.status(200).json({ lobby: publicLobby(existing, user.email) });
    return;
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const lobby = {
    id,
    name: lobbyNameFor(user),
    phase: 'waiting',
    createdAt: now,
    updatedAt: now,
    host: user,
    guest: null,
  };
  lobbies.set(id, lobby);
  res.status(201).json({ lobby: publicLobby(lobby, user.email) });
});

app.get('/api/lobbies/:id', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const lobby = lobbies.get(req.params.id);
  if (!lobby || lobby.phase === 'closed') {
    res.status(404).json({ error: 'lobby_not_found' });
    return;
  }
  res.status(200).json({ lobby: publicLobby(lobby, user.email) });
});

app.post('/api/lobbies/:id/join', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const lobby = lobbies.get(req.params.id);
  if (!lobby || lobby.phase === 'closed') {
    res.status(404).json({ error: 'lobby_not_found' });
    return;
  }
  if (lobby.host.email === user.email) {
    res.status(409).json({ error: 'host_cannot_join_own_lobby' });
    return;
  }
  const existing = userActiveLobby(user.email);
  if (existing && existing.id !== lobby.id) {
    res.status(409).json({ error: 'already_in_lobby', lobby: publicLobby(existing, user.email) });
    return;
  }
  if (lobby.phase !== 'waiting' || lobby.guest) {
    res.status(409).json({ error: 'lobby_unavailable' });
    return;
  }
  lobby.guest = user;
  lobby.phase = 'ready';
  lobby.updatedAt = new Date().toISOString();
  res.status(200).json({ lobby: publicLobby(lobby, user.email) });
});

app.post('/api/lobbies/:id/start', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const lobby = lobbies.get(req.params.id);
  if (!lobby || lobby.phase === 'closed') {
    res.status(404).json({ error: 'lobby_not_found' });
    return;
  }
  if (lobby.host.email !== user.email) {
    res.status(403).json({ error: 'host_only' });
    return;
  }
  if (!lobby.guest) {
    res.status(409).json({ error: 'missing_opponent' });
    return;
  }
  lobby.phase = 'started';
  lobby.updatedAt = new Date().toISOString();
  res.status(200).json({ lobby: publicLobby(lobby, user.email) });
});

app.post('/api/lobbies/:id/leave', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const lobby = lobbies.get(req.params.id);
  if (!lobby || lobby.phase === 'closed') {
    res.status(404).json({ error: 'lobby_not_found' });
    return;
  }
  if (lobby.host.email === user.email) {
    lobby.phase = 'closed';
    lobby.updatedAt = new Date().toISOString();
    lobbies.delete(lobby.id);
    res.status(204).end();
    return;
  }
  if (lobby.guest && lobby.guest.email === user.email) {
    lobby.guest = null;
    lobby.phase = 'waiting';
    lobby.updatedAt = new Date().toISOString();
    res.status(200).json({ lobby: publicLobby(lobby, user.email) });
    return;
  }
  res.status(403).json({ error: 'not_in_lobby' });
});

app.get('/api/campaigns', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const campaigns = await dbListCampaigns(user.email);
    res.status(200).json({ campaigns: campaigns.map(campaignSummary) });
  } catch (error) {
    dbUnavailable(res, 'campaign list failed', error, 'campaign_store_unavailable');
  }
});

app.post('/api/campaigns', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const now = new Date().toISOString();
  const raw = req.body && typeof req.body === 'object' ? req.body : {};
  let level;
  try {
    level = buildLevel(raw.level, 0);
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || 'invalid_level' });
    return;
  }
  const campaign = {
    id: crypto.randomUUID(),
    title: clampText(raw.title, 'Untitled Campaign', 64),
    description: clampText(raw.description, '', 220),
    createdAt: now,
    updatedAt: now,
    owner: user,
    levels: [level],
  };
  try {
    const saved = await dbPutCampaign(user.email, campaign);
    res.status(201).json({ campaign: campaignSummary(saved) });
  } catch (error) {
    dbUnavailable(res, 'campaign create failed', error, 'campaign_store_unavailable');
  }
});

app.get('/api/campaigns/:id', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const campaign = await dbGetCampaign(user.email, req.params.id);
    if (!campaign) {
      res.status(404).json({ error: 'campaign_not_found' });
      return;
    }
    res.status(200).json({ campaign: campaignSummary(campaign) });
  } catch (error) {
    dbUnavailable(res, 'campaign read failed', error, 'campaign_store_unavailable');
  }
});

app.patch('/api/campaigns/:id', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const campaign = await dbGetCampaign(user.email, req.params.id);
    if (!campaign) {
      res.status(404).json({ error: 'campaign_not_found' });
      return;
    }
    const raw = req.body && typeof req.body === 'object' ? req.body : {};
    if (Object.hasOwn(raw, 'title')) campaign.title = clampText(raw.title, campaign.title, 64);
    if (Object.hasOwn(raw, 'description')) campaign.description = clampText(raw.description, campaign.description, 220);
    campaign.updatedAt = new Date().toISOString();
    const saved = await dbPutCampaign(user.email, campaign);
    res.status(200).json({ campaign: campaignSummary(saved) });
  } catch (error) {
    dbUnavailable(res, 'campaign update failed', error, 'campaign_store_unavailable');
  }
});

app.delete('/api/campaigns/:id', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const deleted = await dbDeleteCampaign(user.email, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'campaign_not_found' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    dbUnavailable(res, 'campaign delete failed', error, 'campaign_store_unavailable');
  }
});

app.post('/api/campaigns/:id/levels', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const campaign = await dbGetCampaign(user.email, req.params.id);
    if (!campaign) {
      res.status(404).json({ error: 'campaign_not_found' });
      return;
    }
    let level;
    try {
      level = buildLevel(req.body, campaign.levels.length);
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: error.message || 'invalid_level' });
      return;
    }
    campaign.levels.push(level);
    campaign.updatedAt = new Date().toISOString();
    const saved = await dbPutCampaign(user.email, campaign);
    res.status(201).json({ campaign: campaignSummary(saved), level: publicLevel(level) });
  } catch (error) {
    dbUnavailable(res, 'campaign level create failed', error, 'campaign_store_unavailable');
  }
});

app.patch('/api/campaigns/:id/levels/:levelId', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const campaign = await dbGetCampaign(user.email, req.params.id);
    if (!campaign) {
      res.status(404).json({ error: 'campaign_not_found' });
      return;
    }
    const level = campaign.levels.find((item) => item.id === req.params.levelId);
    if (!level) {
      res.status(404).json({ error: 'level_not_found' });
      return;
    }
    try {
      applyLevelPatch(level, req.body);
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: error.message || 'invalid_level' });
      return;
    }
    campaign.updatedAt = new Date().toISOString();
    const saved = await dbPutCampaign(user.email, campaign);
    res.status(200).json({ campaign: campaignSummary(saved), level: publicLevel(level) });
  } catch (error) {
    dbUnavailable(res, 'campaign level update failed', error, 'campaign_store_unavailable');
  }
});

app.delete('/api/campaigns/:id/levels/:levelId', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const campaign = await dbGetCampaign(user.email, req.params.id);
    if (!campaign) {
      res.status(404).json({ error: 'campaign_not_found' });
      return;
    }
    if (campaign.levels.length <= 1) {
      res.status(409).json({ error: 'campaign_needs_level' });
      return;
    }
    const index = campaign.levels.findIndex((level) => level.id === req.params.levelId);
    if (index === -1) {
      res.status(404).json({ error: 'level_not_found' });
      return;
    }
    campaign.levels.splice(index, 1);
    campaign.updatedAt = new Date().toISOString();
    const saved = await dbPutCampaign(user.email, campaign);
    res.status(200).json({ campaign: campaignSummary(saved) });
  } catch (error) {
    dbUnavailable(res, 'campaign level delete failed', error, 'campaign_store_unavailable');
  }
});

app.get('/api/design-portfolios/:id', async (req, res) => {
  const id = designPortfolioId(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'invalid_design_portfolio_id' });
    return;
  }
  try {
    const document = await dbGetDesignPortfolio(id);
    res.status(200).json({
      portfolio: publicDesignPortfolioDocument(id, document),
      store_schema_version: DESIGN_PORTFOLIO_STORE_SCHEMA_VERSION,
    });
  } catch (error) {
    dbUnavailable(res, 'design portfolio read failed', error, 'design_portfolio_store_unavailable');
  }
});

app.put('/api/design-portfolios/:id', async (req, res) => {
  const user = await requireDesignPortfolioWriter(req, res);
  if (!user) return;
  const id = designPortfolioId(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'invalid_design_portfolio_id' });
    return;
  }
  const raw = req.body && typeof req.body === 'object' ? req.body : {};
  if (!isObjectRecord(raw.data)) {
    res.status(400).json({ error: 'design_portfolio_data_object_required' });
    return;
  }

  try {
    const document = await dbUpsertDesignPortfolio(id, {
      data: raw.data,
      client_schema_version: Object.hasOwn(raw, 'client_schema_version') ? raw.client_schema_version : null,
      metadata: isObjectRecord(raw.metadata) ? raw.metadata : {},
      updated_by: user.email,
    });
    res.status(200).json({
      portfolio: publicDesignPortfolioDocument(id, document),
      store_schema_version: DESIGN_PORTFOLIO_STORE_SCHEMA_VERSION,
    });
  } catch (error) {
    dbUnavailable(res, 'design portfolio write failed', error, 'design_portfolio_store_unavailable');
  }
});

app.get('/api/auth/sign-in', (req, res) => {
  const host = req.get('host') || '';
  if (host.includes('.tank.dev.romaine.life')) {
    res.setHeader('Set-Cookie', 'better-auth.session=mock-dev-session; Path=/; HttpOnly');
    const returnTo = req.query.returnTo || '/';
    res.redirect(302, returnTo);
    return;
  }
  const next = encodeURIComponent(callbackUrl(req));
  res.redirect(302, `${authBaseUrl}/sign-in/microsoft?callbackURL=${next}`);
});

app.post('/api/auth/sign-out', async (req, res) => {
  const cookie = req.get('cookie');
  if (cookie) {
    try {
      const upstream = await fetch(`${authBaseUrl}/api/auth/sign-out`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          cookie,
          origin: requestOrigin(req),
        },
        body: '{}',
      });
      forwardSetCookie(upstream, res);
      if (!upstream.ok) {
        res.status(502).json({ error: 'sign_out_failed' });
        return;
      }
    } catch (error) {
      console.error('auth sign-out failed:', error);
      res.status(502).json({ error: 'auth_unavailable' });
      return;
    }
  }
  res.status(204).end();
});

// --- New-format level persistence (Phase 4) --------------------------------
// Durable, per-user document store for the new Level JSON schema, backed by the
// Postgres `levels` table (relational metadata columns + a jsonb body). Scoped
// to the signed-in owner: each user has their own level id namespace.
const LEVEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
function levelStoreId(raw) {
  const id = String(raw || '').trim();
  return LEVEL_ID_PATTERN.test(id) ? id : '';
}
function isLevelBody(body) {
  return Boolean(
    body && typeof body === 'object' && body.board && typeof body.board.cols === 'number'
    && typeof body.board.rows === 'number' && body.layers && typeof body.layers === 'object',
  );
}

const WORKSPACE_OBJECTIVES = new Set(['capture-all', 'capture-king', 'survive', 'reach']);
const WORKSPACE_TERRAIN = new Set(['grass', 'water', 'stone', 'road', 'bridge', 'cliff', 'rock', 'sand', 'dirt', 'pebble']);
const WORKSPACE_ZONE_TYPES = new Set(['player-spawn', 'enemy-spawn', 'enemy-threat', 'objective', 'falling-rock']);
const WORKSPACE_PIECES = new Set(['pawn', 'knight', 'bishop', 'rook', 'queen', 'king', 'rock', 'random-rock']);
const WORKSPACE_SIDES = new Set(['player', 'enemy', 'neutral']);
const WORKSPACE_BOARD_COLS = { min: 4, max: 16 };
const WORKSPACE_BOARD_ROWS = { min: 4, max: 20 };

function isFiniteInteger(value) {
  return Number.isInteger(value) && Number.isFinite(value);
}

function validateWorkspaceCoord(cell, cols, rows) {
  return cell && isFiniteInteger(cell.x) && isFiniteInteger(cell.y)
    && cell.x >= 0 && cell.x < cols && cell.y >= 0 && cell.y < rows;
}

function validateWorkspaceLevel(level, key) {
  if (!level || typeof level !== 'object') return `levels.${key} must be an object`;
  if (level.formatVersion !== 1) return `levels.${key}.formatVersion must be 1`;
  if (typeof level.id !== 'string' || !level.id) return `levels.${key}.id is required`;
  if (level.id !== key) return `levels.${key}.id must match its workspace key`;
  if (typeof level.name !== 'string') return `levels.${key}.name is required`;
  if (level.notes !== undefined && typeof level.notes !== 'string') return `levels.${key}.notes must be a string`;
  if (!WORKSPACE_OBJECTIVES.has(level.objective)) return `levels.${key}.objective is invalid`;
  const board = level.board;
  if (!board || !isFiniteInteger(board.cols) || !isFiniteInteger(board.rows)) return `levels.${key}.board is invalid`;
  if (board.cols < WORKSPACE_BOARD_COLS.min || board.cols > WORKSPACE_BOARD_COLS.max) return `levels.${key}.board.cols is out of range`;
  if (board.rows < WORKSPACE_BOARD_ROWS.min || board.rows > WORKSPACE_BOARD_ROWS.max) return `levels.${key}.board.rows is out of range`;
  if (board.heightLevels !== undefined && (!isFiniteInteger(board.heightLevels) || board.heightLevels < 1)) return `levels.${key}.board.heightLevels is invalid`;
  const layers = level.layers;
  if (!layers || typeof layers !== 'object') return `levels.${key}.layers is required`;
  for (const layerName of ['terrain', 'decals', 'zones', 'units']) {
    if (!Array.isArray(layers[layerName])) return `levels.${key}.layers.${layerName} must be an array`;
  }
  for (const tile of layers.terrain) {
    if (!validateWorkspaceCoord(tile, board.cols, board.rows) || !WORKSPACE_TERRAIN.has(tile.terrain)) return `levels.${key}.layers.terrain contains an invalid tile`;
    if (tile.elevation !== undefined && !isFiniteInteger(tile.elevation)) return `levels.${key}.layers.terrain contains an invalid elevation`;
  }
  for (const unit of layers.units) {
    if (!validateWorkspaceCoord(unit, board.cols, board.rows) || !WORKSPACE_PIECES.has(unit.type) || !WORKSPACE_SIDES.has(unit.side)) return `levels.${key}.layers.units contains an invalid unit`;
  }
  for (const zone of layers.zones) {
    if (!zone || typeof zone.id !== 'string' || !WORKSPACE_ZONE_TYPES.has(zone.type) || !Array.isArray(zone.tiles)) return `levels.${key}.layers.zones contains an invalid zone`;
    for (const tile of zone.tiles) {
      if (!Array.isArray(tile) || tile.length !== 2 || !isFiniteInteger(tile[0]) || !isFiniteInteger(tile[1]) || tile[0] < 0 || tile[0] >= board.cols || tile[1] < 0 || tile[1] >= board.rows) {
        return `levels.${key}.layers.zones contains an out-of-bounds tile`;
      }
    }
  }
  return null;
}

function validateWorkspaceBody(raw) {
  if (!Array.isArray(raw.campaigns) || !raw.levels || typeof raw.levels !== 'object' || Array.isArray(raw.levels)) {
    return 'invalid_workspace';
  }
  const levelEntries = Object.entries(raw.levels);
  if (levelEntries.length > 200) return 'workspace_too_large';
  for (const [key, level] of levelEntries) {
    const levelError = validateWorkspaceLevel(level, key);
    if (levelError) return levelError;
  }
  if (raw.campaigns.length > 100) return 'workspace_too_large';
  const campaignIds = new Set();
  for (const campaign of raw.campaigns) {
    if (!campaign || typeof campaign !== 'object') return 'campaigns must contain objects';
    if (campaign.formatVersion !== 1) return `campaigns.${campaign.id || '?'} formatVersion must be 1`;
    if (typeof campaign.id !== 'string' || !campaign.id) return 'campaign id is required';
    if (campaignIds.has(campaign.id)) return `duplicate campaign id ${campaign.id}`;
    campaignIds.add(campaign.id);
    if (typeof campaign.name !== 'string') return `campaigns.${campaign.id}.name is required`;
    if (!Array.isArray(campaign.levels)) return `campaigns.${campaign.id}.levels must be an array`;
    for (const ref of campaign.levels) {
      if (!ref || typeof ref !== 'object' || typeof ref.levelId !== 'string' || !raw.levels[ref.levelId]) return `campaigns.${campaign.id}.levels contains a missing level reference`;
      if (!isFiniteInteger(ref.ordinal) || ref.ordinal < 0) return `campaigns.${campaign.id}.levels contains an invalid ordinal`;
      if (ref.objective !== undefined && !WORKSPACE_OBJECTIVES.has(ref.objective)) return `campaigns.${campaign.id}.levels contains an invalid objective`;
      if (ref.stars !== undefined && (!isFiniteInteger(ref.stars) || ref.stars < 0 || ref.stars > 3)) return `campaigns.${campaign.id}.levels contains invalid stars`;
    }
  }
  return null;
}

async function dbListLevels(ownerEmail) {
  await ensureDbReady();
  const { rows } = await pool.query(
    'SELECT id, name, cols, rows, updated_at FROM levels WHERE owner_email = $1 ORDER BY updated_at DESC',
    [ownerEmail],
  );
  return rows;
}

async function dbGetLevel(ownerEmail, id) {
  await ensureDbReady();
  const { rows } = await pool.query(
    'SELECT body, revision, updated_at FROM levels WHERE owner_email = $1 AND id = $2',
    [ownerEmail, id],
  );
  return rows[0] || null;
}

async function dbUpsertLevel(ownerEmail, id, body) {
  await ensureDbReady();
  const board = body.board || {};
  const { rows } = await pool.query(
    `INSERT INTO levels (owner_email, id, name, cols, rows, revision, body)
       VALUES ($1, $2, $3, $4, $5, 1, $6::jsonb)
     ON CONFLICT (owner_email, id) DO UPDATE SET
       name = EXCLUDED.name,
       cols = EXCLUDED.cols,
       rows = EXCLUDED.rows,
       revision = levels.revision + 1,
       body = EXCLUDED.body,
       updated_at = now()
     RETURNING revision, updated_at`,
    [ownerEmail, id, body.name ?? null, board.cols ?? null, board.rows ?? null, JSON.stringify(body)],
  );
  return rows[0];
}

app.get('/api/levels', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    res.status(200).json({ levels: await dbListLevels(user.email) });
  } catch (error) {
    dbUnavailable(res, 'level list failed', error, 'level_store_unavailable');
  }
});

app.get('/api/levels/:id', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const id = levelStoreId(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_level_id' }); return; }
  try {
    const doc = await dbGetLevel(user.email, id);
    if (!doc) { res.status(404).json({ error: 'level_not_found' }); return; }
    res.status(200).json({ level: doc.body, revision: doc.revision, updated_at: doc.updated_at });
  } catch (error) {
    dbUnavailable(res, 'level read failed', error, 'level_store_unavailable');
  }
});

app.put('/api/levels/:id', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const id = levelStoreId(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_level_id' }); return; }
  const raw = req.body && typeof req.body === 'object' ? req.body : {};
  if (!isLevelBody(raw.level)) { res.status(400).json({ error: 'invalid_level_body' }); return; }
  try {
    const result = await dbUpsertLevel(user.email, id, { ...raw.level, id });
    res.status(200).json({ ok: true, id, revision: result.revision, updated_at: result.updated_at });
  } catch (error) {
    dbUnavailable(res, 'level write failed', error, 'level_store_unavailable');
  }
});

// Campaign-editor workspace persistence (Phase 4 cont.): the whole campaign +
// level set as one per-user document in the Postgres `campaign_workspaces`
// table (one row per signed-in owner).
async function dbGetWorkspace(ownerEmail) {
  await ensureDbReady();
  const { rows } = await pool.query(
    'SELECT body, updated_at FROM campaign_workspaces WHERE owner_email = $1',
    [ownerEmail],
  );
  return rows[0] || null;
}

async function dbPutWorkspace(ownerEmail, body) {
  await ensureDbReady();
  const { rows } = await pool.query(
    `INSERT INTO campaign_workspaces (owner_email, body)
       VALUES ($1, $2::jsonb)
     ON CONFLICT (owner_email) DO UPDATE SET
       body = EXCLUDED.body,
       updated_at = now()
     RETURNING updated_at`,
    [ownerEmail, JSON.stringify(body)],
  );
  return rows[0].updated_at;
}

app.get('/api/campaign-workspace', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const row = await dbGetWorkspace(user.email);
    const body = row && row.body ? row.body : { campaigns: [], levels: {} };
    res.status(200).json({
      campaigns: Array.isArray(body.campaigns) ? body.campaigns : [],
      levels: body.levels && typeof body.levels === 'object' ? body.levels : {},
      updated_at: row ? row.updated_at : null,
    });
  } catch (error) {
    dbUnavailable(res, 'campaign workspace read failed', error, 'workspace_unavailable');
  }
});

app.put('/api/campaign-workspace', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const raw = req.body && typeof req.body === 'object' ? req.body : {};
  const validationError = validateWorkspaceBody(raw);
  if (validationError) {
    res.status(400).json({ error: 'invalid_workspace', details: validationError });
    return;
  }
  try {
    const updatedAt = await dbPutWorkspace(user.email, { campaigns: raw.campaigns, levels: raw.levels });
    res.status(200).json({ ok: true, campaigns: raw.campaigns.length, updated_at: updatedAt });
  } catch (error) {
    dbUnavailable(res, 'campaign workspace write failed', error, 'workspace_unavailable');
  }
});

// --- Official (global) campaign tier (ADR-0038) ----------------------------
// Global game content readable by everyone (public GET) and authored by admins
// (requireAdmin PUT). One upserted row per id holding a complete Workspace. The
// client falls back to the committed official.json on any failure, so the game and
// /play never depend on this — mirrors the design_portfolios global pattern.
const OFFICIAL_CAMPAIGNS_STORE_SCHEMA_VERSION = 1;
const OFFICIAL_CAMPAIGN_ROW_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
function officialCampaignsRowId(raw) {
  const id = String(raw || '').trim();
  return OFFICIAL_CAMPAIGN_ROW_ID_PATTERN.test(id) ? id : null;
}

// Every campaign/level id in an official Workspace must be an `off-` prefixed,
// lowercase, DIGIT-FREE slug — exactly what the client minter produces
// (`off-<c|l>-<slug>`, slug ∈ [a-z-]). Digit-free so officials can't collide the
// per-user `c/l<n>` id counter; lowercase-only so the id matches isOfficialId and the
// loader's assumptions (rejects off-FOO, off-a_b, off-l-1).
const OFFICIAL_WORKSPACE_ID_PATTERN = /^off-[a-z]+(-[a-z]+)*$/;
function validateOfficialWorkspaceIds(data) {
  const validId = (id) => typeof id === 'string' && OFFICIAL_WORKSPACE_ID_PATTERN.test(id);
  for (const key of Object.keys((data && data.levels) || {})) {
    if (!validId(key)) return `level id "${key}" must be an off- prefixed, lowercase, digit-free slug`;
  }
  for (const campaign of (data && data.campaigns) || []) {
    if (!validId(campaign && campaign.id)) return `campaign id "${campaign && campaign.id}" must be an off- prefixed, lowercase, digit-free slug`;
  }
  return null;
}

async function dbGetOfficialCampaigns(id) {
  await ensureDbReady();
  const { rows } = await pool.query(
    'SELECT data, client_schema_version, revision, created_at, updated_at, updated_by FROM official_campaigns WHERE id = $1',
    [id],
  );
  return rows[0] || null;
}

async function dbUpsertOfficialCampaigns(id, input) {
  await ensureDbReady();
  const { rows } = await pool.query(
    `INSERT INTO official_campaigns (id, data, client_schema_version, revision, updated_by)
       VALUES ($1, $2::jsonb, $3, 1, $4)
     ON CONFLICT (id) DO UPDATE SET
       data = EXCLUDED.data,
       client_schema_version = EXCLUDED.client_schema_version,
       revision = official_campaigns.revision + 1,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by
     RETURNING data, client_schema_version, revision, created_at, updated_at, updated_by`,
    [id, JSON.stringify(input.data), input.client_schema_version, input.updated_by],
  );
  return rows[0];
}

function publicOfficialCampaignsDocument(id, document) {
  return {
    id,
    data: isObjectRecord(document && document.data) ? document.data : {},
    client_schema_version: document && Object.hasOwn(document, 'client_schema_version') ? document.client_schema_version : null,
    revision: Number.isInteger(document && document.revision) ? document.revision : 0,
    created_at: document && document.created_at ? document.created_at : null,
    updated_at: document && document.updated_at ? document.updated_at : null,
    updated_by: document && document.updated_by ? document.updated_by : null,
  };
}

app.get('/api/official-campaigns/:id', async (req, res) => {
  const id = officialCampaignsRowId(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'invalid_official_campaign_id' });
    return;
  }
  try {
    const document = await dbGetOfficialCampaigns(id);
    res.status(200).json({
      portfolio: publicOfficialCampaignsDocument(id, document),
      store_schema_version: OFFICIAL_CAMPAIGNS_STORE_SCHEMA_VERSION,
    });
  } catch (error) {
    dbUnavailable(res, 'official campaigns read failed', error, 'official_campaign_store_unavailable');
  }
});

app.put('/api/official-campaigns/:id', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const id = officialCampaignsRowId(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'invalid_official_campaign_id' });
    return;
  }
  const raw = req.body && typeof req.body === 'object' ? req.body : {};
  if (!isObjectRecord(raw.data)) {
    res.status(400).json({ error: 'official_campaign_data_object_required' });
    return;
  }
  const validationError = validateWorkspaceBody(raw.data);
  if (validationError) {
    res.status(400).json({ error: 'invalid_workspace', details: validationError });
    return;
  }
  const idError = validateOfficialWorkspaceIds(raw.data);
  if (idError) {
    res.status(400).json({ error: 'invalid_official_ids', details: idError });
    return;
  }
  try {
    const document = await dbUpsertOfficialCampaigns(id, {
      data: { campaigns: raw.data.campaigns, levels: raw.data.levels },
      client_schema_version: Object.hasOwn(raw, 'client_schema_version') ? raw.client_schema_version : null,
      updated_by: user.email,
    });
    res.status(200).json({
      portfolio: publicOfficialCampaignsDocument(id, document),
      store_schema_version: OFFICIAL_CAMPAIGNS_STORE_SCHEMA_VERSION,
    });
  } catch (error) {
    dbUnavailable(res, 'official campaigns write failed', error, 'official_campaign_store_unavailable');
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.use((req, res, next) => {
  if (Object.hasOwn(req.query || {}, 'screen')) {
    res.status(404).send('not found');
    return;
  }
  next();
});
// Cache policy for statically-served files. Three tiers:
//   - HTML (the app shell / SPA fallback): no-cache, so a new deploy is always
//     picked up on the next navigation.
//   - Vite content-hashed bundles: emitted as flat files directly under
//     assets/ with a content hash in the name (e.g. assets/index-Cy4ekEXV.js).
//     The name changes whenever the bytes change, so these are immutable for a
//     year. Public assets always live in nested subdirs (assets/ui, assets/
//     fonts, ...), never flat under assets/, so they never match this rule.
//   - Everything else (public images/fonts/audio/json): a modest 1h TTL that
//     trims repeat-visit payload but stays short enough that a hot static
//     override (STATIC_FRONTEND_DIR) is reflected to clients quickly.
const VITE_HASHED_ASSET = /^assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;
function makeStaticCacheHeaders(rootDir) {
  return (res, filePath) => {
    const rel = path.relative(rootDir, filePath).split(path.sep).join('/');
    if (path.extname(filePath).toLowerCase() === '.html') {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    if (VITE_HASHED_ASSET.test(rel)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  };
}

if (staticFrontendDir) {
  app.use(express.static(staticFrontendDir, { setHeaders: makeStaticCacheHeaders(staticFrontendDir) }));
}
app.use((req, res, next) => {
  if (MIGRATED_RAW_ASSET_PATHS.has(req.path)) {
    res.status(404).send('not found');
    return;
  }
  next();
});
app.use(express.static(frontendDir, { setHeaders: makeStaticCacheHeaders(frontendDir) }));

// SPA fallback: serve index.html for client routes. Only 404 for genuine
// static-asset extensions (a missing .png/.js/etc.) — NOT for app routes whose
// last path segment merely contains dots, e.g.
// /design/catalog/main-menu-buttons/button-9slice.main-menu.
const STATIC_ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico',
  '.css', '.js', '.mjs', '.map', '.json', '.wasm', '.txt', '.xml',
  '.woff', '.woff2', '.ttf', '.eot', '.webmanifest',
  '.mp3', '.wav', '.ogg', '.mp4', '.webm',
]);
app.use((req, res) => {
  if (STATIC_ASSET_EXTENSIONS.has(path.extname(req.path).toLowerCase())) {
    res.status(404).send('not found');
    return;
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(frontendIndexFile(), { dotfiles: 'allow' });
});

function startServer() {
  app.listen(port, () => {
    console.log(`chess-tactics listening on :${port}`);
  });
}

// Configure the durable store, then start serving. The game (static + /play)
// must stay up even if the database is unreachable, so a DB/migration failure is
// logged and surfaced as 503 on the persistence endpoints — it never blocks
// startup, and ensureDbReady() retries on the next request.
pool = buildPool();
if (pool) {
  pool.on('error', (error) => console.error('postgres pool error:', error));
  ensureDbReady()
    .then(() => console.log(`postgres ready (mode=${databaseUrl ? 'connection-string' : 'workload-identity'}); schema migrations applied`))
    .catch((error) => console.error('postgres init failed; persistence endpoints will return 503 until it recovers:', error))
    .finally(startServer);
} else {
  console.warn('no database configured (set DATABASE_URL, or POSTGRES_HOST/POSTGRES_DATABASE/POSTGRES_USER); persistence endpoints will return 503');
  startServer();
}
