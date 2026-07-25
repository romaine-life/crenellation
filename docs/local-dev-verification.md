# Local Dev Server Verification

This project uses Vite for local frontend development. Vite can take a few seconds to respond after merges, HMR invalidation, large asset changes, or TypeScript/transform errors. A short HTTP timeout is not a valid app verification strategy.

## Required Rule

Do not use 2-second browser or HTTP checks to decide whether the local app is working.

Use at least 30 seconds for local app health checks and screenshot setup. If the request times out, diagnose the server instead of reporting "timed out" as the answer.

## Standard Health Check

From `frontend/`:

```powershell
npm run visual:health -- --url http://localhost:3000/ --timeout 30000
```

Expected success looks like:

```json
{
  "ok": true,
  "status": 200,
  "elapsedMs": 2130,
  "contentLength": 2153,
  "url": "http://localhost:3000/",
  "viteError": false
}
```

## If It Fails

Diagnose in this order:

1. Check which process owns port `3000`.

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,State,OwningProcess
```

2. Check the Vite logs.

```powershell
Get-Content frontend/.codex-vite-3000.log -Tail 120
Get-Content frontend/.codex-vite-3000.err.log -Tail 120
```

3. Look for compile errors, unresolved merge markers, missing imports, or stale HMR state.

4. Only after the health check returns `200` without Vite errors should visual screenshot verification be trusted.

## Screenshot Verification

After `visual:health` succeeds:

```powershell
npm run visual:screenshot -- --url http://localhost:3000/tileset-studio --out ../.pwshot/tileset-studio.png --width 1600 --height 900 --budget 5000
```

If screenshot capture fails, inspect the browser/screenshot error separately. Do not collapse screenshot failure, Vite compile failure, and server health failure into the same phrase.

## Agent Guidance

When reporting a local verification failure, say which category it is:

- server not listening
- wrong or stale process on port `3000`
- Vite compile/runtime error
- request exceeded the 30-second budget
- screenshot tool failed after a healthy server response

Never report only "it timed out."
