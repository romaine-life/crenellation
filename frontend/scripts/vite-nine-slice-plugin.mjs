// Dev-only bridge so the /nine-slice-editor "Save" button can write the on-disk
// config and regenerate the asset — no copy-paste, no CLI, no round trip.
//
// `apply: 'serve'` means this middleware exists ONLY while `vite` is serving (dev
// mode). It is never part of a production build, so the write endpoint can't ship.
// The editor pairs this with import.meta.env.DEV to only show the button in dev.
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildAsset, normalizeConfig, writeGeneratedCss, loadConfig, logSave, CONFIG_DIR, REGISTRY } from './nine-slice-kit.mjs';

export function nineSliceDevSave() {
  return {
    name: 'nine-slice-dev-save',
    apply: 'serve',
    configureServer(server) {
      // Serve the on-disk config so the editor can hydrate from the real saved
      // state (not localStorage/defaults) — otherwise a fresh editor shows defaults
      // and Save overwrites the committed config with them.
      server.middlewares.use('/__nine-slice/config', (req, res, next) => {
        if (req.method !== 'GET') return next();
        const send = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
        const asset = new URL(req.originalUrl || req.url, 'http://x').searchParams.get('asset');
        if (!REGISTRY[asset]) return send(400, { ok: false, error: `unknown asset "${asset}"` });
        try { send(200, { ok: true, config: loadConfig(asset) }); }
        catch { send(200, { ok: true, config: null }); } // no config file yet → editor keeps defaults
      });
      server.middlewares.use('/__nine-slice/save', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
        req.on('end', () => {
          const send = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
          try {
            const raw = JSON.parse(body || '{}');
            if (!REGISTRY[raw.asset]) return send(400, { ok: false, error: `unknown asset "${raw.asset}" (known: ${Object.keys(REGISTRY).join(', ')})` });
            const cfg = normalizeConfig(raw);
            mkdirSync(CONFIG_DIR, { recursive: true });
            writeFileSync(`${CONFIG_DIR}${raw.asset}.json`, `${JSON.stringify({ asset: raw.asset, ...cfg }, null, 2)}\n`);
            const out = buildAsset(raw.asset, cfg);
            const css = writeGeneratedCss();
            const entry = logSave('dev-save', raw.asset, cfg, [...out.written, css]);
            console.log(`[nine-slice] ${entry.ts} dev-save ${raw.asset}: ${JSON.stringify(cfg.bracket)} kl${JSON.stringify(cfg.keyline)} content=${cfg.content} -> ${out.written.join(', ')}`);
            send(200, { ok: true, asset: raw.asset, config: `config/nine-slice/${raw.asset}.json`, written: out.written, css, warns: out.warns, note: out.note });
          } catch (e) {
            send(500, { ok: false, error: String(e?.message || e) });
          }
        });
      });
    },
  };
}
