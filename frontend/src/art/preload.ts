// Warm the browser image cache for art that mounts late.
//
// Portraits (and their backdrops) only render once a unit is focused, so the
// browser doesn't fetch them until the first click — producing a visible "art
// becomes ready" hitch. Kicking off the fetch + decode ahead of time makes the
// first portrait paint instant. Decoding is best-effort; a missing asset must
// never throw or block.

const warmed = new Set<string>();

export function preloadImages(urls: Iterable<string>): void {
  for (const url of urls) {
    if (!url || warmed.has(url)) continue;
    warmed.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    // decode() resolves once the bitmap is ready; ignore failures (e.g. 404)
    // so a single missing portrait can't reject and spam the console.
    img.decode?.().catch(() => {});
  }
}
