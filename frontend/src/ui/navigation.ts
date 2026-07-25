export const APP_NAVIGATION_EVENT = 'chess-tactics:navigate';

export function normalizeRoutePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

export function getAppNavigationUrl(href: string, baseHref: string = window.location.href): URL | null {
  let url: URL;
  let base: URL;
  try {
    url = new URL(href, baseHref);
    base = new URL(baseHref);
  } catch {
    return null;
  }

  if (url.origin !== base.origin) return null;
  if (url.pathname.startsWith('/api/')) return null;
  return url;
}

export function shouldInterceptAppLinkClick(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target.toLowerCase() !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;

  const rawHref = anchor.getAttribute('href');
  if (!rawHref || rawHref.startsWith('#')) return false;

  return getAppNavigationUrl(anchor.href) !== null;
}

export function navigateApp(href: string, options: { replace?: boolean; scroll?: boolean } = {}): boolean {
  const url = getAppNavigationUrl(href);
  if (!url) return false;

  const nextHref = `${url.pathname}${url.search}${url.hash}`;
  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextHref !== currentHref) {
    const method = options.replace ? 'replaceState' : 'pushState';
    window.history[method]({}, '', nextHref);
  }

  window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, {
    detail: {
      href: nextHref,
      path: normalizeRoutePath(url.pathname),
    },
  }));

  if (options.scroll !== false && !url.hash) {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    } catch {
      window.scrollTo(0, 0);
    }
  }

  return true;
}
