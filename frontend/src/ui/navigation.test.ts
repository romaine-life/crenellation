import { describe, expect, it } from 'vitest';
import { getAppNavigationUrl, normalizeRoutePath } from './navigation';

const BASE = 'https://chess-tactics.test/settings?tab=audio';

describe('app navigation helpers', () => {
  it('normalizes route paths for matching', () => {
    expect(normalizeRoutePath('/')).toBe('/');
    expect(normalizeRoutePath('/play/')).toBe('/play');
    expect(normalizeRoutePath('/design/catalog//')).toBe('/design/catalog');
  });

  it('accepts same-origin app routes', () => {
    const url = getAppNavigationUrl('/play', BASE);
    expect(url?.pathname).toBe('/play');
  });

  it('leaves auth/api and external targets to the browser', () => {
    expect(getAppNavigationUrl('/api/auth/sign-in', BASE)).toBeNull();
    expect(getAppNavigationUrl('https://example.test/play', BASE)).toBeNull();
    expect(getAppNavigationUrl('mailto:player@example.test', BASE)).toBeNull();
  });
});
