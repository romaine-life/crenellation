const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const [key, inlineValue] = arg.slice(2).split('=');
  const value = inlineValue ?? process.argv[index + 1];
  if (inlineValue === undefined) index += 1;
  args.set(key, value);
}

const url = args.get('url') ?? 'http://localhost:3000/';
const timeoutMs = Number(args.get('timeout') ?? 30000);

if (!Number.isFinite(timeoutMs) || timeoutMs < 30000) {
  console.error(
    `Refusing app verification with timeout=${args.get('timeout') ?? timeoutMs}. Use at least 30000ms for Vite/HMR/browser health checks.`,
  );
  process.exit(2);
}

const started = performance.now();
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      'cache-control': 'no-cache',
    },
  });
  const body = await response.text();
  const elapsedMs = Math.round(performance.now() - started);
  const viteError =
    body.includes('[vite]') ||
    body.includes('Internal server error') ||
    body.includes('Transform failed') ||
    body.includes('PARSE_ERROR') ||
    body.includes('Encountered diff marker');

  const result = {
    ok: response.ok && !viteError,
    status: response.status,
    elapsedMs,
    contentLength: body.length,
    url,
    viteError,
  };

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    console.error(
      viteError
        ? 'Local server responded, but the page appears to contain a Vite/runtime error. Check the Vite console/log before visual review.'
        : `Local server returned HTTP ${response.status}.`,
    );
    process.exit(1);
  }
} catch (error) {
  const elapsedMs = Math.round(performance.now() - started);
  const reason = error?.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : error?.message ?? String(error);
  console.error(JSON.stringify({ ok: false, url, elapsedMs, reason }, null, 2));
  console.error('Do not report only "timed out"; inspect the port owner and Vite logs before continuing.');
  process.exit(1);
} finally {
  clearTimeout(timer);
}
