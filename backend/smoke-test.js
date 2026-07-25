const http = require('http');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const port = 31337;
const authPort = 31338;
const bgmPort = 31339;
const hotRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-tactics-hot-'));
const hotBackendDir = path.join(hotRoot, 'backend');
const hotStaticDir = path.join(hotRoot, 'static');
const mockAuth = http.createServer((req, res) => {
  if (req.url === '/api/auth/get-session') {
    if (!req.headers.cookie || !req.headers.cookie.includes('better-auth.session')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('null');
      return;
    }
    if (req.headers.cookie.includes('better-auth.session=rival')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        user: {
          email: 'rival@example.com',
          name: 'Lobby Rival',
          role: 'pending',
        },
      }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      user: {
        email: 'player@example.com',
        name: 'Tactics Player',
        role: 'pending',
      },
    }));
    return;
  }
  if (req.url === '/api/auth/sign-out' && req.method === 'POST') {
    if (req.headers.origin !== 'https://chess.romaine.life') {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'MISSING_OR_NULL_ORIGIN' }));
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/json',
      'set-cookie': 'better-auth.session=; Max-Age=0; Domain=romaine.life; Path=/',
    });
    res.end('{}');
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

// Stand in for the public BGM blob container: serves the index.json the backend
// reads for GET /api/bgm.
const mockBgm = http.createServer((req, res) => {
  if (req.url === '/index.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      schemaVersion: 1,
      tracks: [
        { title: 'Alpha', file: 'alpha.mp3' },
        { title: 'Bravo', file: 'bravo.mp3' },
      ],
    }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

// The persistence endpoints are Postgres-backed, so the smoke-test needs a
// database. Prefer an externally supplied DATABASE_URL; otherwise self-provision
// a throwaway local Postgres from system binaries (present on GitHub-hosted CI
// runners). Hosts without Postgres binaries (e.g. the musl session pod) can't
// run this test directly — set DATABASE_URL, or rely on the Glimmung test slot,
// which exercises the same endpoints end to end against a real Postgres.
let embeddedPg = null;

function findPgBinary(name) {
  const onPath = spawnSync('sh', ['-c', `command -v ${name} 2>/dev/null`], { encoding: 'utf8' });
  if (onPath.status === 0 && onPath.stdout.trim()) return onPath.stdout.trim();
  const located = spawnSync('sh', ['-c',
    `ls -d /usr/lib/postgresql/*/bin/${name} /usr/local/opt/postgresql*/bin/${name} /opt/homebrew/opt/postgresql*/bin/${name} 2>/dev/null | sort -V | tail -1`,
  ], { encoding: 'utf8' });
  return located.status === 0 && located.stdout.trim() ? located.stdout.trim() : null;
}

function startEmbeddedPostgres() {
  const initdb = findPgBinary('initdb');
  const pgCtl = findPgBinary('pg_ctl');
  const createdb = findPgBinary('createdb');
  if (!initdb || !pgCtl || !createdb) {
    throw new Error('smoke-test needs Postgres: set DATABASE_URL, or install Postgres so it can self-provision (initdb/pg_ctl/createdb not found).');
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-pg-'));
  const pgPort = 55432;
  const init = spawnSync(initdb, ['-D', dataDir, '-U', 'postgres', '--auth=trust', '-E', 'UTF8'], { encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr || init.stdout}`);
  const logFile = path.join(dataDir, 'pg.log');
  const start = spawnSync(pgCtl, ['-D', dataDir, '-w', '-l', logFile, '-o', `-p ${pgPort} -h 127.0.0.1 -k ${dataDir}`, 'start'], { encoding: 'utf8' });
  if (start.status !== 0) {
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    throw new Error(`pg_ctl start failed: ${start.stderr || start.stdout}\n${log}`);
  }
  embeddedPg = { dataDir, pgCtl };
  const created = spawnSync(createdb, ['-h', '127.0.0.1', '-p', String(pgPort), '-U', 'postgres', 'chess_tactics'], { encoding: 'utf8' });
  if (created.status !== 0) throw new Error(`createdb failed: ${created.stderr || created.stdout}`);
  process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${pgPort}/chess_tactics`;
}

function stopEmbeddedPostgres() {
  if (!embeddedPg) return;
  const { dataDir, pgCtl } = embeddedPg;
  embeddedPg = null;
  spawnSync(pgCtl, ['-D', dataDir, '-m', 'immediate', 'stop'], { encoding: 'utf8' });
  fs.rmSync(dataDir, { recursive: true, force: true });
}

process.on('exit', stopEmbeddedPostgres);

if (!process.env.DATABASE_URL) {
  startEmbeddedPostgres();
}

const child = spawn(process.execPath, ['supervisor.js'], {
  cwd: __dirname,
  env: {
    ...process.env,
    AUTH_BASE_URL: `http://127.0.0.1:${authPort}`,
    PORT: String(port),
    PUBLIC_ORIGIN: 'https://chess.romaine.life',
    BGM_BASE_URL: `http://127.0.0.1:${bgmPort}`,
    // Non-Azure base: exercise the static-index path (the mock serves index.json).
    // Prod sets no BGM_READ_URL and lists the Azure container live instead.
    BGM_READ_URL: `http://127.0.0.1:${bgmPort}`,
    HOT_BACKEND_DIR: hotBackendDir,
    STATIC_FRONTEND_DIR: hotStaticDir,
    // The mock auth returns player@example.com for any non-rival session; make that
    // the official-campaigns admin so the requireAdmin path is exercised (ADR-0038).
    ADMIN_EMAILS: 'player@example.com',
    // DATABASE_URL is set above (external or self-provisioned) and inherited
    // here via ...process.env.
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
});

function request(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(1000, () => {
      req.destroy(new Error(`Timed out requesting ${path}`));
    });
    req.end(body);
  });
}

function get(path, headers) {
  return request('GET', path, headers);
}

// Reset the Postgres-backed document tables so re-runs (and a freshly migrated
// CI database) start from a known-empty state. Tables exist by now because the
// server applies migrations before it begins listening (and /health gates on
// that), so waitForServer() has already returned by the time this runs.
async function resetDb() {
  await queryDb('TRUNCATE levels, campaign_workspaces, design_portfolios, campaigns, official_campaigns');
}

async function queryDb(sql, params = []) {
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with ${child.exitCode}\n${output}`);
    }
    try {
      const response = await get('/health');
      if (response.statusCode === 200 && response.body === 'ok') return;
    } catch (_error) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Server did not become healthy\n${output}`);
}

async function waitForHotBackend() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with ${child.exitCode}\n${output}`);
    }
    try {
      const response = await get('/__hot_backend');
      if (response.statusCode === 200 && response.body === 'hot-backend-ok') return;
    } catch (_error) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Hot backend did not become active\n${output}`);
}

async function main() {
  await new Promise((resolve) => mockAuth.listen(authPort, '127.0.0.1', resolve));
  await new Promise((resolve) => mockBgm.listen(bgmPort, '127.0.0.1', resolve));
  await waitForServer();
  if (!fs.existsSync(path.join(hotBackendDir, 'server.js'))) {
    throw new Error('Supervisor did not initialize the hot backend entrypoint');
  }
  await resetDb();

  const root = await get('/');
  if (root.statusCode !== 200 || !root.body.includes('Chess Tactics')) {
    throw new Error(`Unexpected root response: ${root.statusCode}`);
  }
  // The shell is the React SPA mount (#root). Account state + optional sign-in render
  // client-side in the app-shell title bar (HeaderAccountCluster) — there is no static
  // account chrome (the old static topbar was retired). The invariant is unchanged: the
  // shell serves the app to anonymous users and never gates guest play behind a sign-in.
  if (!root.body.includes('id="root"') || root.body.includes('Sign in to play')) {
    throw new Error('Root shell should load the app for guests without a blocking sign-in gate');
  }
  const fallback = await get('/squad/unknown');
  if (fallback.statusCode !== 200 || !fallback.body.includes('Chess Tactics')) {
    throw new Error(`Unexpected fallback response: ${fallback.statusCode}`);
  }
  const missingAsset = await get('/assets/missing.png');
  if (missingAsset.statusCode !== 404) {
    throw new Error(`Missing asset-like routes should return 404: ${missingAsset.statusCode}`);
  }
  for (const migratedAssetPath of ['/app.js', '/style.css']) {
    const response = await get(migratedAssetPath);
    if (response.statusCode !== 404) {
      throw new Error(`Migrated raw asset path should be gone for ${migratedAssetPath}: ${response.statusCode}`);
    }
  }
  for (const migratedScreenPath of ['/?screen=main-assets', '/?screen=main-concept&hotspots=1']) {
    const response = await get(migratedScreenPath);
    if (response.statusCode !== 404) {
      throw new Error(`Migrated query-screen route should be gone for ${migratedScreenPath}: ${response.statusCode}`);
    }
  }

  const reviewUrls = [
    '/main-menu',
    '/main-menu/skeleton',
    '/design/main-menu',
    '/design/main-menu/render',
    '/design/main-menu/render/hotspots',
    '/campaigns',
    '/campaigns/skeleton',
    '/design/campaigns/render',
    '/design/campaigns/render/hotspots',
    '/level-editor',
    '/level-editor/skeleton',
    '/design/level-editor/render',
    '/design/level-editor/render/hotspots',
    '/skirmish',
    '/skirmish/skeleton',
    '/design/skirmish/render',
    '/design/skirmish/render/hotspots',
  ];
  for (const reviewUrl of reviewUrls) {
    const response = await get(reviewUrl);
    if (response.statusCode !== 200 || !response.body.includes('Chess Tactics')) {
      throw new Error(`Unexpected review URL response for ${reviewUrl}: ${response.statusCode}`);
    }
  }

  const artAssets = [
    '/assets/ui/main-menu-aspirational.png',
    '/assets/ui/campaign-editor-concept.png',
    '/assets/ui/level-editor-concept.png',
    '/assets/ui/skirmish-concept.png',
    '/assets/ui/main-menu-button-art-five-mode.png',
    '/assets/ui/main-menu-button-art-three-state.png',
    '/assets/ui/main-menu-brand-title-only-v1.png',
    '/assets/ui/main-menu-brand-chrome-v1.png',
  ];
  for (const assetPath of artAssets) {
    const response = await get(assetPath);
    if (response.statusCode !== 200 || !String(response.headers['content-type'] || '').includes('image/png')) {
      throw new Error(`Unexpected art asset response for ${assetPath}: ${response.statusCode} ${response.headers['content-type'] || ''}`);
    }
  }

  // Migration guard: the profile/news/dock chrome bitmaps were retired in favor
  // of live DOM components and must no longer be served.
  const retiredChrome = [
    '/assets/ui/main-menu-profile-chrome-v1.png',
    '/assets/ui/main-menu-news-chrome-v1.png',
    '/assets/ui/main-menu-dock-chrome-v1.png',
  ];
  for (const assetPath of retiredChrome) {
    const response = await get(assetPath);
    if (response.statusCode !== 404) {
      throw new Error(`Retired chrome bitmap still served (expected 404) for ${assetPath}: ${response.statusCode}`);
    }
  }

  const anonymous = await get('/api/auth/me');
  if (anonymous.statusCode !== 200 || JSON.parse(anonymous.body).signed_in !== false) {
    throw new Error(`Unexpected anonymous auth response: ${anonymous.statusCode} ${anonymous.body}`);
  }

  const signedIn = await get('/api/auth/me', { cookie: 'better-auth.session=abc' });
  const signedInBody = JSON.parse(signedIn.body);
  if (signedIn.statusCode !== 200 || signedInBody.email !== 'player@example.com' || signedInBody.role !== 'pending') {
    throw new Error(`Unexpected signed-in auth response: ${signedIn.statusCode} ${signedIn.body}`);
  }
  const playerHash = crypto.createHash('md5').update('player@example.com').digest('hex');
  if (!String(signedInBody.gravatar_url).includes(`/avatar/${playerHash}`) || signedInBody.avatar_url !== signedInBody.gravatar_url) {
    throw new Error(`Signed-in user did not include Gravatar avatar data: ${signedIn.body}`);
  }

  // BGM playlist: the backend reads the (mocked) blob index.json and resolves
  // each track to an absolute URL under BGM_BASE_URL.
  const bgm = await get('/api/bgm');
  const bgmBody = JSON.parse(bgm.body);
  if (
    bgm.statusCode !== 200 ||
    !Array.isArray(bgmBody.tracks) ||
    bgmBody.tracks.length !== 2 ||
    bgmBody.tracks[0].title !== 'Alpha' ||
    bgmBody.tracks[0].url !== `http://127.0.0.1:${bgmPort}/alpha.mp3`
  ) {
    throw new Error(`Unexpected /api/bgm response: ${bgm.statusCode} ${bgm.body}`);
  }

  const anonymousLobbies = await get('/api/lobbies');
  if (anonymousLobbies.statusCode !== 401) {
    throw new Error(`Anonymous lobby list should require sign-in: ${anonymousLobbies.statusCode}`);
  }

  const anonymousCampaigns = await get('/api/campaigns');
  if (anonymousCampaigns.statusCode !== 401) {
    throw new Error(`Anonymous campaign list should require sign-in: ${anonymousCampaigns.statusCode}`);
  }

  const retiredDesignAssetApi = await get('/api/design-assets');
  if (retiredDesignAssetApi.statusCode !== 404) {
    throw new Error(`Retired design asset API should 404: ${retiredDesignAssetApi.statusCode} ${retiredDesignAssetApi.body}`);
  }
  const retiredDesignAssetImageApi = await get('/api/design-assets/button-icon.main-menu.sword/image');
  if (retiredDesignAssetImageApi.statusCode !== 404) {
    throw new Error(`Retired design asset image API should 404: ${retiredDesignAssetImageApi.statusCode} ${retiredDesignAssetImageApi.body}`);
  }

  const emptyPortfolio = await get('/api/design-portfolios/main-menu-acceptance');
  const emptyPortfolioBody = JSON.parse(emptyPortfolio.body);
  if (emptyPortfolio.statusCode !== 200 || emptyPortfolioBody.portfolio.revision !== 0 || Object.keys(emptyPortfolioBody.portfolio.data).length !== 0) {
    throw new Error(`Unexpected empty design portfolio response: ${emptyPortfolio.statusCode} ${emptyPortfolio.body}`);
  }

  const anonymousPortfolioWrite = await request(
    'PUT',
    '/api/design-portfolios/main-menu-acceptance',
    { 'content-type': 'application/json' },
    JSON.stringify({ data: { review_statuses: { 'profile-chrome': 'accepted' } } }),
  );
  if (anonymousPortfolioWrite.statusCode !== 401) {
    throw new Error(`Production-style anonymous design portfolio write should require sign-in: ${anonymousPortfolioWrite.statusCode} ${anonymousPortfolioWrite.body}`);
  }

  const invalidPortfolioId = await get('/api/design-portfolios/Bad%20ID');
  if (invalidPortfolioId.statusCode !== 400) {
    throw new Error(`Invalid design portfolio id should fail: ${invalidPortfolioId.statusCode} ${invalidPortfolioId.body}`);
  }

  const signedPortfolioWrite = await request(
    'PUT',
    '/api/design-portfolios/main-menu-acceptance',
    { cookie: 'better-auth.session=abc', 'content-type': 'application/json' },
    JSON.stringify({
      client_schema_version: 7,
      metadata: { source: 'smoke-test', future_unknown_field: { ok: true } },
      data: {
        kind: 'main-menu-acceptance-ledger',
        future_document_shape: { nested: ['allowed'] },
        review_statuses: {
          'profile-chrome': 'accepted',
          'dock-chrome': 'rejected',
        },
      },
    }),
  );
  const signedPortfolioWriteBody = JSON.parse(signedPortfolioWrite.body);
  if (
    signedPortfolioWrite.statusCode !== 200 ||
    signedPortfolioWriteBody.portfolio.revision !== 1 ||
    signedPortfolioWriteBody.portfolio.data.future_document_shape.nested[0] !== 'allowed' ||
    signedPortfolioWriteBody.portfolio.updated_by !== 'player@example.com'
  ) {
    throw new Error(`Unexpected signed design portfolio write: ${signedPortfolioWrite.statusCode} ${signedPortfolioWrite.body}`);
  }

  const savedPortfolio = await get('/api/design-portfolios/main-menu-acceptance');
  const savedPortfolioBody = JSON.parse(savedPortfolio.body);
  if (
    savedPortfolio.statusCode !== 200 ||
    savedPortfolioBody.portfolio.revision !== 1 ||
    savedPortfolioBody.portfolio.data.review_statuses['profile-chrome'] !== 'accepted'
  ) {
    throw new Error(`Design portfolio did not persist: ${savedPortfolio.statusCode} ${savedPortfolio.body}`);
  }

  const testSlotPortfolioWrite = await request(
    'PUT',
    '/api/design-portfolios/main-menu-acceptance',
    { host: 'chess-tactics-1.tank.dev.romaine.life', 'content-type': 'application/json' },
    JSON.stringify({ data: { review_statuses: { 'news-chrome': 'accepted' } } }),
  );
  const testSlotPortfolioWriteBody = JSON.parse(testSlotPortfolioWrite.body);
  if (
    testSlotPortfolioWrite.statusCode !== 200 ||
    testSlotPortfolioWriteBody.portfolio.revision !== 2 ||
    testSlotPortfolioWriteBody.portfolio.updated_by !== 'test-slot@chess-tactics.local'
  ) {
    throw new Error(`Test-slot design portfolio write should not require sign-in: ${testSlotPortfolioWrite.statusCode} ${testSlotPortfolioWrite.body}`);
  }

  // --- Official (global) campaign tier (/api/official-campaigns): public GET,
  //     admin-gated PUT, off-prefixed digit-free ids (ADR-0038) ----------------
  const officialWorkspace = {
    campaigns: [{
      formatVersion: 1, id: 'off-c-test', name: 'Test Official', difficulty: 'normal', chapters: 1,
      levels: [{ levelId: 'off-l-test', ordinal: 0, objective: 'capture-all' }],
    }],
    levels: {
      'off-l-test': {
        formatVersion: 1, id: 'off-l-test', name: 'Test Level', notes: '',
        board: { cols: 8, rows: 8, heightLevels: 1 }, objective: 'capture-all', difficulty: 'normal',
        economy: { startingFunds: 1000, incomePerTurn: 100 }, theme: 'grassland',
        layers: { terrain: [], decals: [], zones: [], units: [] },
      },
    },
  };

  const emptyOfficial = await get('/api/official-campaigns/default');
  const emptyOfficialBody = JSON.parse(emptyOfficial.body);
  if (emptyOfficial.statusCode !== 200 || emptyOfficialBody.portfolio.revision !== 0 || Object.keys(emptyOfficialBody.portfolio.data).length !== 0) {
    throw new Error(`Unexpected empty official campaigns response: ${emptyOfficial.statusCode} ${emptyOfficial.body}`);
  }

  const anonymousOfficialWrite = await request(
    'PUT', '/api/official-campaigns/default',
    { 'content-type': 'application/json' },
    JSON.stringify({ data: officialWorkspace }),
  );
  if (anonymousOfficialWrite.statusCode !== 401) {
    throw new Error(`Anonymous official write should require sign-in: ${anonymousOfficialWrite.statusCode} ${anonymousOfficialWrite.body}`);
  }

  const nonAdminOfficialWrite = await request(
    'PUT', '/api/official-campaigns/default',
    { cookie: 'better-auth.session=rival', 'content-type': 'application/json' },
    JSON.stringify({ data: officialWorkspace }),
  );
  if (nonAdminOfficialWrite.statusCode !== 403) {
    throw new Error(`Non-admin official write should be forbidden: ${nonAdminOfficialWrite.statusCode} ${nonAdminOfficialWrite.body}`);
  }

  const invalidOfficialId = await get('/api/official-campaigns/Bad%20ID');
  if (invalidOfficialId.statusCode !== 400) {
    throw new Error(`Invalid official campaign id should fail: ${invalidOfficialId.statusCode} ${invalidOfficialId.body}`);
  }

  const adminOfficialWrite = await request(
    'PUT', '/api/official-campaigns/default',
    { cookie: 'better-auth.session=abc', 'content-type': 'application/json' },
    JSON.stringify({ data: officialWorkspace }),
  );
  const adminOfficialWriteBody = JSON.parse(adminOfficialWrite.body);
  if (
    adminOfficialWrite.statusCode !== 200 ||
    adminOfficialWriteBody.portfolio.revision !== 1 ||
    adminOfficialWriteBody.portfolio.updated_by !== 'player@example.com' ||
    adminOfficialWriteBody.portfolio.data.campaigns[0].id !== 'off-c-test'
  ) {
    throw new Error(`Unexpected admin official write: ${adminOfficialWrite.statusCode} ${adminOfficialWrite.body}`);
  }

  // Public GET now returns the published officials — visible WITHOUT a session.
  const publishedOfficial = await get('/api/official-campaigns/default');
  const publishedOfficialBody = JSON.parse(publishedOfficial.body);
  if (
    publishedOfficial.statusCode !== 200 ||
    publishedOfficialBody.portfolio.revision !== 1 ||
    publishedOfficialBody.portfolio.data.campaigns[0].id !== 'off-c-test'
  ) {
    throw new Error(`Official campaigns did not persist for public read: ${publishedOfficial.statusCode} ${publishedOfficial.body}`);
  }

  // Non-off-prefixed ids are rejected (would collide the per-user id counter).
  const nonOffIdWrite = await request(
    'PUT', '/api/official-campaigns/default',
    { cookie: 'better-auth.session=abc', 'content-type': 'application/json' },
    JSON.stringify({ data: { campaigns: [{ formatVersion: 1, id: 'c1', name: 'Bad', difficulty: 'normal', chapters: 1, levels: [] }], levels: {} } }),
  );
  if (nonOffIdWrite.statusCode !== 400 || JSON.parse(nonOffIdWrite.body).error !== 'invalid_official_ids') {
    throw new Error(`Non-off-prefixed official ids should be rejected: ${nonOffIdWrite.statusCode} ${nonOffIdWrite.body}`);
  }

  // Digits inside an off- id are also rejected (must stay digit-free).
  const digitOffIdWrite = await request(
    'PUT', '/api/official-campaigns/default',
    { cookie: 'better-auth.session=abc', 'content-type': 'application/json' },
    JSON.stringify({ data: { campaigns: [{ formatVersion: 1, id: 'off-c-test1', name: 'Bad', difficulty: 'normal', chapters: 1, levels: [] }], levels: {} } }),
  );
  if (digitOffIdWrite.statusCode !== 400 || JSON.parse(digitOffIdWrite.body).error !== 'invalid_official_ids') {
    throw new Error(`Official ids with digits should be rejected: ${digitOffIdWrite.statusCode} ${digitOffIdWrite.body}`);
  }

  // --- New-format level persistence (/api/levels): per-user, DB-backed -------
  const levelBody = { name: 'Smoke Level', board: { cols: 8, rows: 12 }, layers: { terrain: [], units: [] } };

  const anonymousLevels = await get('/api/levels');
  if (anonymousLevels.statusCode !== 401) {
    throw new Error(`Anonymous level list should require sign-in: ${anonymousLevels.statusCode}`);
  }

  const invalidLevelId = await get('/api/levels/Bad%20Id', { cookie: 'better-auth.session=abc' });
  if (invalidLevelId.statusCode !== 400) {
    throw new Error(`Invalid level id should fail: ${invalidLevelId.statusCode} ${invalidLevelId.body}`);
  }

  const invalidLevelBody = await request(
    'PUT', '/api/levels/smoke-1',
    { cookie: 'better-auth.session=abc', 'content-type': 'application/json' },
    JSON.stringify({ level: { nope: true } }),
  );
  if (invalidLevelBody.statusCode !== 400) {
    throw new Error(`Invalid level body should fail: ${invalidLevelBody.statusCode} ${invalidLevelBody.body}`);
  }

  const savedLevel = await request(
    'PUT', '/api/levels/smoke-1',
    { cookie: 'better-auth.session=abc', 'content-type': 'application/json' },
    JSON.stringify({ level: levelBody }),
  );
  const savedLevelBody = JSON.parse(savedLevel.body);
  if (savedLevel.statusCode !== 200 || savedLevelBody.revision !== 1 || savedLevelBody.id !== 'smoke-1') {
    throw new Error(`Unexpected level save: ${savedLevel.statusCode} ${savedLevel.body}`);
  }

  const playerLevels = await get('/api/levels', { cookie: 'better-auth.session=abc' });
  const playerLevelsBody = JSON.parse(playerLevels.body);
  if (
    playerLevels.statusCode !== 200 ||
    playerLevelsBody.levels.length !== 1 ||
    playerLevelsBody.levels[0].id !== 'smoke-1' ||
    playerLevelsBody.levels[0].name !== 'Smoke Level' ||
    playerLevelsBody.levels[0].cols !== 8 ||
    playerLevelsBody.levels[0].rows !== 12
  ) {
    throw new Error(`Unexpected player level list: ${playerLevels.statusCode} ${playerLevels.body}`);
  }

  const loadedLevel = await get('/api/levels/smoke-1', { cookie: 'better-auth.session=abc' });
  const loadedLevelBody = JSON.parse(loadedLevel.body);
  if (loadedLevel.statusCode !== 200 || loadedLevelBody.level.name !== 'Smoke Level' || loadedLevelBody.level.id !== 'smoke-1' || loadedLevelBody.revision !== 1) {
    throw new Error(`Unexpected level load: ${loadedLevel.statusCode} ${loadedLevel.body}`);
  }

  const reSavedLevel = await request(
    'PUT', '/api/levels/smoke-1',
    { cookie: 'better-auth.session=abc', 'content-type': 'application/json' },
    JSON.stringify({ level: { ...levelBody, name: 'Smoke Level v2' } }),
  );
  const reSavedLevelBody = JSON.parse(reSavedLevel.body);
  if (reSavedLevel.statusCode !== 200 || reSavedLevelBody.revision !== 2) {
    throw new Error(`Level re-save should bump revision: ${reSavedLevel.statusCode} ${reSavedLevel.body}`);
  }

  // Per-user scoping: the rival sees none of the player's levels.
  const rivalLevels = await get('/api/levels', { cookie: 'better-auth.session=rival' });
  const rivalLevelsBody = JSON.parse(rivalLevels.body);
  if (rivalLevels.statusCode !== 200 || rivalLevelsBody.levels.length !== 0) {
    throw new Error(`Levels should be scoped to owner: ${rivalLevels.statusCode} ${rivalLevels.body}`);
  }
  const rivalLevelRead = await get('/api/levels/smoke-1', { cookie: 'better-auth.session=rival' });
  if (rivalLevelRead.statusCode !== 404) {
    throw new Error(`Rival should not read the player's level: ${rivalLevelRead.statusCode} ${rivalLevelRead.body}`);
  }
  // The rival can reuse the same id in their own namespace without colliding.
  const rivalSave = await request(
    'PUT', '/api/levels/smoke-1',
    { cookie: 'better-auth.session=rival', 'content-type': 'application/json' },
    JSON.stringify({ level: { ...levelBody, name: 'Rival Level' } }),
  );
  const rivalSaveBody = JSON.parse(rivalSave.body);
  if (rivalSave.statusCode !== 200 || rivalSaveBody.revision !== 1) {
    throw new Error(`Rival's same-id level should be independent (revision 1): ${rivalSave.statusCode} ${rivalSave.body}`);
  }
  const playerLevelStillV2 = await get('/api/levels/smoke-1', { cookie: 'better-auth.session=abc' });
  const playerLevelStillV2Body = JSON.parse(playerLevelStillV2.body);
  if (playerLevelStillV2.statusCode !== 200 || playerLevelStillV2Body.revision !== 2 || playerLevelStillV2Body.level.name !== 'Smoke Level v2') {
    throw new Error(`Rival's write must not affect the player's level: ${playerLevelStillV2.statusCode} ${playerLevelStillV2.body}`);
  }

  // --- Campaign workspace (/api/campaign-workspace): per-user, DB-backed -----
  const anonymousWorkspace = await get('/api/campaign-workspace');
  if (anonymousWorkspace.statusCode !== 401) {
    throw new Error(`Anonymous workspace should require sign-in: ${anonymousWorkspace.statusCode}`);
  }

  const emptyWorkspace = await get('/api/campaign-workspace', { cookie: 'better-auth.session=abc' });
  const emptyWorkspaceBody = JSON.parse(emptyWorkspace.body);
  if (emptyWorkspace.statusCode !== 200 || emptyWorkspaceBody.campaigns.length !== 0 || Object.keys(emptyWorkspaceBody.levels).length !== 0) {
    throw new Error(`Empty workspace should be empty: ${emptyWorkspace.statusCode} ${emptyWorkspace.body}`);
  }

  const invalidWorkspace = await request(
    'PUT', '/api/campaign-workspace',
    { cookie: 'better-auth.session=abc', 'content-type': 'application/json' },
    JSON.stringify({ campaigns: 'nope' }),
  );
  if (invalidWorkspace.statusCode !== 400) {
    throw new Error(`Invalid workspace should fail: ${invalidWorkspace.statusCode} ${invalidWorkspace.body}`);
  }

  const workspaceLevel = {
    formatVersion: 1,
    id: 'smoke-1',
    name: 'Smoke Level',
    notes: '',
    board: { cols: 8, rows: 12, heightLevels: 1 },
    objective: 'capture-all',
    difficulty: 'normal',
    economy: { startingFunds: 1200, incomePerTurn: 150 },
    theme: 'grassland',
    layers: {
      terrain: [{ x: 0, y: 0, terrain: 'grass', elevation: 0 }],
      decals: [],
      zones: [],
      units: [{ x: 0, y: 0, type: 'king', side: 'player' }],
    },
  };
  const workspaceDoc = {
    campaigns: [{
      formatVersion: 1,
      id: 'c1',
      name: 'Smoke Campaign',
      difficulty: 'normal',
      chapters: 1,
      levels: [{ levelId: 'smoke-1', ordinal: 0, objective: 'capture-all', stars: 0 }],
    }],
    levels: { 'smoke-1': workspaceLevel },
  };
  const savedWorkspace = await request(
    'PUT', '/api/campaign-workspace',
    { cookie: 'better-auth.session=abc', 'content-type': 'application/json' },
    JSON.stringify(workspaceDoc),
  );
  const savedWorkspaceBody = JSON.parse(savedWorkspace.body);
  if (savedWorkspace.statusCode !== 200 || savedWorkspaceBody.ok !== true || savedWorkspaceBody.campaigns !== 1) {
    throw new Error(`Unexpected workspace save: ${savedWorkspace.statusCode} ${savedWorkspace.body}`);
  }

  const loadedWorkspace = await get('/api/campaign-workspace', { cookie: 'better-auth.session=abc' });
  const loadedWorkspaceBody = JSON.parse(loadedWorkspace.body);
  if (
    loadedWorkspace.statusCode !== 200 ||
    loadedWorkspaceBody.campaigns.length !== 1 ||
    loadedWorkspaceBody.campaigns[0].name !== 'Smoke Campaign' ||
    !loadedWorkspaceBody.levels['smoke-1']
  ) {
    throw new Error(`Workspace did not persist: ${loadedWorkspace.statusCode} ${loadedWorkspace.body}`);
  }

  // Per-user scoping: the rival has their own (empty) workspace.
  const rivalWorkspace = await get('/api/campaign-workspace', { cookie: 'better-auth.session=rival' });
  const rivalWorkspaceBody = JSON.parse(rivalWorkspace.body);
  if (rivalWorkspace.statusCode !== 200 || rivalWorkspaceBody.campaigns.length !== 0) {
    throw new Error(`Workspace should be scoped to owner: ${rivalWorkspace.statusCode} ${rivalWorkspace.body}`);
  }

  const createdCampaign = await request(
    'POST',
    '/api/campaigns',
    { cookie: 'better-auth.session=abc', 'content-type': 'application/json' },
    JSON.stringify({
      title: 'Forked Opening',
      description: 'First draft campaign',
      level: {
        name: 'Rook Alley',
        objective: 'Hold the back rank',
        width: 10,
        height: 14,
        enemy_budget: 5,
        notes: 'Start with a forced rook lane.',
      },
    }),
  );
  const createdCampaignBody = JSON.parse(createdCampaign.body);
  if (createdCampaign.statusCode !== 201 || createdCampaignBody.campaign.level_count !== 1 || createdCampaignBody.campaign.levels[0].width !== 10 || createdCampaignBody.campaign.levels[0].layout.length < 2) {
    throw new Error(`Unexpected campaign create response: ${createdCampaign.statusCode} ${createdCampaign.body}`);
  }
  const createdLevel = createdCampaignBody.campaign.levels[0];
  if (
    !createdLevel.zones.some((zone) => zone.id === 'player-1-spawn' && zone.selections.some((selection) => selection.type === 'rect' && selection.y1 === 13 && selection.y2 === 13)) ||
    !createdLevel.zones.some((zone) => zone.id === 'player-2-spawn' && zone.selections.some((selection) => selection.type === 'rect' && selection.y1 === 0 && selection.y2 === 0)) ||
    createdLevel.zone_assignments.player_1_spawn_zone_id !== 'player-1-spawn' ||
    createdLevel.zone_assignments.player_2_spawn_zone_id !== 'player-2-spawn'
  ) {
    throw new Error(`Created level did not include default player spawn zones: ${createdCampaign.body}`);
  }

  const campaignId = createdCampaignBody.campaign.id;
  const storedCampaign = await queryDb(
    'SELECT owner_email, body FROM campaigns WHERE owner_email = $1 AND id = $2',
    ['player@example.com', campaignId],
  );
  if (
    storedCampaign.rowCount !== 1 ||
    storedCampaign.rows[0].owner_email !== 'player@example.com' ||
    storedCampaign.rows[0].body.title !== 'Forked Opening' ||
    storedCampaign.rows[0].body.levels[0].width !== 10
  ) {
    throw new Error(`Created campaign should persist to Postgres: ${JSON.stringify(storedCampaign.rows)}`);
  }

  const rivalCampaigns = await get('/api/campaigns', { cookie: 'better-auth.session=rival' });
  const rivalCampaignsBody = JSON.parse(rivalCampaigns.body);
  if (rivalCampaigns.statusCode !== 200 || rivalCampaignsBody.campaigns.length !== 0) {
    throw new Error(`Campaigns should be scoped to owner: ${rivalCampaigns.statusCode} ${rivalCampaigns.body}`);
  }

  const forbiddenCampaign = await get(`/api/campaigns/${campaignId}`, { cookie: 'better-auth.session=rival' });
  if (forbiddenCampaign.statusCode !== 404) {
    throw new Error(`Rival should not read player campaign: ${forbiddenCampaign.statusCode} ${forbiddenCampaign.body}`);
  }

  const renamedCampaign = await request(
    'PATCH',
    `/api/campaigns/${campaignId}`,
    { cookie: 'better-auth.session=abc', 'content-type': 'application/json' },
    JSON.stringify({ title: 'Knight Forks', description: 'Renamed draft' }),
  );
  const renamedCampaignBody = JSON.parse(renamedCampaign.body);
  if (renamedCampaign.statusCode !== 200 || renamedCampaignBody.campaign.title !== 'Knight Forks') {
    throw new Error(`Unexpected campaign update response: ${renamedCampaign.statusCode} ${renamedCampaign.body}`);
  }
  const renamedCampaignRows = await queryDb(
    'SELECT body FROM campaigns WHERE owner_email = $1 AND id = $2',
    ['player@example.com', campaignId],
  );
  if (renamedCampaignRows.rows[0].body.title !== 'Knight Forks') {
    throw new Error(`Renamed campaign should persist to Postgres: ${JSON.stringify(renamedCampaignRows.rows)}`);
  }

  const addedLevel = await request(
    'POST',
    `/api/campaigns/${campaignId}/levels`,
    { cookie: 'better-auth.session=abc', 'content-type': 'application/json' },
    JSON.stringify({ name: 'Bishop Net', difficulty: 'hard', enemy_budget: 8 }),
  );
  const addedLevelBody = JSON.parse(addedLevel.body);
  if (addedLevel.statusCode !== 201 || addedLevelBody.campaign.level_count !== 2 || addedLevelBody.level.name !== 'Bishop Net') {
    throw new Error(`Unexpected add level response: ${addedLevel.statusCode} ${addedLevel.body}`);
  }

  const rejectedSmallSpawn = await request(
    'PATCH',
    `/api/campaigns/${campaignId}/levels/${addedLevelBody.level.id}`,
    { cookie: 'better-auth.session=abc', 'content-type': 'application/json' },
    JSON.stringify({
      zones: [
        { id: 'player-1-spawn', name: 'Player 1 Spawn', selections: [{ id: 'selection-1', type: 'cell', x: 0, y: 7 }] },
        { id: 'player-2-spawn', name: 'Player 2 Spawn', selections: [{ id: 'selection-1', type: 'rect', x1: 0, y1: 0, x2: 7, y2: 0 }] },
      ],
      zone_assignments: {
        misc_zones: [],
      },
    }),
  );
  if (rejectedSmallSpawn.statusCode !== 400 || !rejectedSmallSpawn.body.includes('player_1_spawn_zone_id_needs_3_cells')) {
    throw new Error(`Small mandatory spawn zone should be rejected: ${rejectedSmallSpawn.statusCode} ${rejectedSmallSpawn.body}`);
  }

  const patchedLevel = await request(
    'PATCH',
    `/api/campaigns/${campaignId}/levels/${addedLevelBody.level.id}`,
    { cookie: 'better-auth.session=abc', 'content-type': 'application/json' },
    JSON.stringify({
      height: 18,
      notes: 'Late pressure test.',
      layout: [
        { x: 1, y: 2, role: 'enemy', type: 'knight' },
        { x: 2, y: 2, role: 'terrain', type: 'rock' },
        { x: 99, y: 2, role: 'enemy', type: 'rook' },
        { x: 3, y: 3, role: 'enemy', type: 'dragon' },
      ],
      zones: [
        {
          id: 'player-1-spawn',
          name: 'Player 1 Spawn',
          selections: [
            { id: 'selection-1', type: 'cell', x: 0, y: 0 },
            { id: 'selection-2', type: 'rect', x1: 1, y1: 1, x2: 3, y2: 3 },
            { id: 'bad-selection', type: 'cell', x: 99, y: 0 },
          ],
        },
        {
          id: 'player-2-spawn',
          name: 'Player 2 Spawn',
          selections: [
            { id: 'selection-1', type: 'rect', x1: 0, y1: 17, x2: 3, y2: 17 },
          ],
        },
        {
          id: 'falling-rock-a',
          name: 'Falling Rock A',
          selections: [
            { id: 'selection-1', type: 'rect', x1: 4, y1: 4, x2: 5, y2: 5 },
          ],
        },
        {
          id: 'falling-rock-b',
          name: 'Falling Rock B',
          selections: [
            { id: 'selection-1', type: 'cell', x: 6, y: 6 },
          ],
        },
      ],
      zone_assignments: {
        misc_zones: [
          { id: 'misc-zone-1', type: 'falling-rock', zone_id: 'falling-rock-a' },
          { id: 'misc-zone-2', type: 'falling-rock', zone_id: 'falling-rock-b' },
          { id: 'bad-misc-zone', type: 'lava', zone_id: 'falling-rock-a' },
        ],
      },
    }),
  );
  const patchedLevelBody = JSON.parse(patchedLevel.body);
  if (patchedLevel.statusCode !== 200 || patchedLevelBody.level.height !== 18 || patchedLevelBody.level.notes !== 'Late pressure test.' || patchedLevelBody.level.layout.length !== 2) {
    throw new Error(`Unexpected level update response: ${patchedLevel.statusCode} ${patchedLevel.body}`);
  }
  if (!patchedLevelBody.level.layout.some((cell) => cell.x === 1 && cell.y === 2 && cell.role === 'enemy' && cell.type === 'knight')) {
    throw new Error(`Patched level layout did not persist enemy knight: ${patchedLevel.body}`);
  }
  if (
    patchedLevelBody.level.zones.length !== 4 ||
    patchedLevelBody.level.zones[0].selections.length !== 2 ||
    patchedLevelBody.level.zone_assignments.player_1_spawn_zone_id !== 'player-1-spawn' ||
    patchedLevelBody.level.zone_assignments.player_2_spawn_zone_id !== 'player-2-spawn' ||
    patchedLevelBody.level.zone_assignments.misc_zones.length !== 2 ||
    patchedLevelBody.level.zone_assignments.misc_zones[0].type !== 'falling-rock'
  ) {
    throw new Error(`Patched level zones did not normalize as expected: ${patchedLevel.body}`);
  }

  const deletedLevel = await request(
    'DELETE',
    `/api/campaigns/${campaignId}/levels/${addedLevelBody.level.id}`,
    { cookie: 'better-auth.session=abc' },
  );
  const deletedLevelBody = JSON.parse(deletedLevel.body);
  if (deletedLevel.statusCode !== 200 || deletedLevelBody.campaign.level_count !== 1) {
    throw new Error(`Unexpected level delete response: ${deletedLevel.statusCode} ${deletedLevel.body}`);
  }

  const lastLevelId = deletedLevelBody.campaign.levels[0].id;
  const rejectedLastLevelDelete = await request(
    'DELETE',
    `/api/campaigns/${campaignId}/levels/${lastLevelId}`,
    { cookie: 'better-auth.session=abc' },
  );
  if (rejectedLastLevelDelete.statusCode !== 409) {
    throw new Error(`Deleting the last level should fail: ${rejectedLastLevelDelete.statusCode} ${rejectedLastLevelDelete.body}`);
  }

  const deletedCampaign = await request(
    'DELETE',
    `/api/campaigns/${campaignId}`,
    { cookie: 'better-auth.session=abc' },
  );
  if (deletedCampaign.statusCode !== 204) {
    throw new Error(`Unexpected campaign delete response: ${deletedCampaign.statusCode} ${deletedCampaign.body}`);
  }
  const deletedCampaignRead = await get(`/api/campaigns/${campaignId}`, { cookie: 'better-auth.session=abc' });
  if (deletedCampaignRead.statusCode !== 404) {
    throw new Error(`Deleted campaign should not be readable: ${deletedCampaignRead.statusCode} ${deletedCampaignRead.body}`);
  }
  const deletedCampaignRows = await queryDb(
    'SELECT id FROM campaigns WHERE owner_email = $1 AND id = $2',
    ['player@example.com', campaignId],
  );
  if (deletedCampaignRows.rowCount !== 0) {
    throw new Error(`Deleted campaign should be removed from Postgres: ${JSON.stringify(deletedCampaignRows.rows)}`);
  }

  const hosted = await request('POST', '/api/lobbies', { cookie: 'better-auth.session=abc', 'content-type': 'application/json' }, '{}');
  const hostedBody = JSON.parse(hosted.body);
  if (hosted.statusCode !== 201 || hostedBody.lobby.phase !== 'waiting' || hostedBody.lobby.viewer_role !== 'host') {
    throw new Error(`Unexpected host lobby response: ${hosted.statusCode} ${hosted.body}`);
  }
  if (!hostedBody.lobby.host.avatar_url.includes(`/avatar/${playerHash}`)) {
    throw new Error(`Lobby host is missing Gravatar URL: ${hosted.body}`);
  }

  const listed = await get('/api/lobbies', { cookie: 'better-auth.session=rival' });
  const listedBody = JSON.parse(listed.body);
  if (listed.statusCode !== 200 || listedBody.lobbies.length !== 1 || listedBody.lobbies[0].viewer_role !== 'observer') {
    throw new Error(`Unexpected lobby list response: ${listed.statusCode} ${listed.body}`);
  }

  const lobbyId = hostedBody.lobby.id;
  const joined = await request('POST', `/api/lobbies/${lobbyId}/join`, { cookie: 'better-auth.session=rival', 'content-type': 'application/json' }, '{}');
  const joinedBody = JSON.parse(joined.body);
  if (joined.statusCode !== 200 || joinedBody.lobby.phase !== 'ready' || joinedBody.lobby.viewer_role !== 'guest') {
    throw new Error(`Unexpected join lobby response: ${joined.statusCode} ${joined.body}`);
  }

  const rivalStart = await request('POST', `/api/lobbies/${lobbyId}/start`, { cookie: 'better-auth.session=rival', 'content-type': 'application/json' }, '{}');
  if (rivalStart.statusCode !== 403) {
    throw new Error(`Guest should not be able to start lobby: ${rivalStart.statusCode} ${rivalStart.body}`);
  }

  const started = await request('POST', `/api/lobbies/${lobbyId}/start`, { cookie: 'better-auth.session=abc', 'content-type': 'application/json' }, '{}');
  const startedBody = JSON.parse(started.body);
  if (started.statusCode !== 200 || startedBody.lobby.phase !== 'started') {
    throw new Error(`Unexpected start lobby response: ${started.statusCode} ${started.body}`);
  }

  const redirect = await get('/api/auth/sign-in?returnTo=%2Fplay');
  if (redirect.statusCode !== 302 || !String(redirect.headers.location).startsWith(`http://127.0.0.1:${authPort}/sign-in/microsoft?`)) {
    throw new Error(`Unexpected sign-in redirect: ${redirect.statusCode} ${redirect.headers.location}`);
  }

  const signOut = await request('POST', '/api/auth/sign-out', { cookie: 'better-auth.session=abc' });
  if (signOut.statusCode !== 204 || !signOut.headers['set-cookie']) {
    throw new Error(`Unexpected sign-out response: ${signOut.statusCode}`);
  }

  fs.mkdirSync(hotStaticDir, { recursive: true });
  fs.writeFileSync(path.join(hotStaticDir, 'hot.txt'), 'hot-static-ok');
  const hotStatic = await get('/hot.txt');
  if (hotStatic.statusCode !== 200 || hotStatic.body !== 'hot-static-ok') {
    throw new Error(`Unexpected hot static response: ${hotStatic.statusCode} ${hotStatic.body}`);
  }

  const hotServerFile = path.join(hotBackendDir, 'server.js');
  const hotServerSource = fs.readFileSync(hotServerFile, 'utf8');
  fs.writeFileSync(
    hotServerFile,
    hotServerSource.replace(
      "app.get('/health', (_req, res) => {",
      "app.get('/__hot_backend', (_req, res) => res.status(200).send('hot-backend-ok'));\n\napp.get('/health', (_req, res) => {",
    ),
  );
  child.kill('SIGHUP');
  await waitForHotBackend();
  const hotBackend = await get('/__hot_backend');
  if (hotBackend.statusCode !== 200 || hotBackend.body !== 'hot-backend-ok') {
    throw new Error(`Unexpected hot backend response: ${hotBackend.statusCode} ${hotBackend.body}`);
  }
}

main()
  .finally(() => {
    child.kill();
    mockAuth.close();
    mockBgm.close();
    fs.rmSync(hotRoot, { recursive: true, force: true });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
