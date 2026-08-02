const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Lookup key for an uploaded image: its bare filename.
 *
 * The same upload appears in several shapes across the app. Content stores
 * `/uploads/x.webp`, `resolveClientMediaUrl` rebases it to `<apiBase>/uploads/
 * x.webp`, and older admin builds saved an absolute `http://localhost:3000/api/
 * uploads/x.webp`. Keying a variant map by any one of those makes the other two
 * miss, so everything is reduced to the part that never changes.
 *
 * Returns '' for anything that is not an upload, which callers treat as "no
 * variants known".
 */
export function mediaVariantKey(url: string | null | undefined): string {
  const value = (url || '').trim();
  if (!value || !/\/uploads\//i.test(value)) return '';
  return value.split('?')[0].split('#')[0].split('/').pop() ?? '';
}

/**
 * Resolve uploaded media against the API that belongs to the current page.
 *
 * Older content can contain an absolute localhost URL saved by the admin app.
 * That works on the development computer, but on a phone "localhost" points
 * back to the phone. Rebase only local upload URLs; genuine remote URLs keep
 * their original host.
 */
export function resolveClientMediaUrl(
  url: string | null | undefined,
  apiBase: string,
): string {
  const value = (url || '').trim();
  if (!value || /^(data:|blob:|\/assets\/)/i.test(value)) return value;

  if (/^https?:/i.test(value)) {
    try {
      const parsed = new URL(value);
      if (
        LOOPBACK_HOSTS.has(parsed.hostname) &&
        /^\/(?:api\/)?uploads\//i.test(parsed.pathname)
      ) {
        const uploadPath = parsed.pathname.replace(/^\/api(?=\/uploads\/)/i, '');
        return `${apiBase}${uploadPath}${parsed.search}${parsed.hash}`;
      }
    } catch {
      return value;
    }
    return value;
  }

  if (!value.startsWith('/uploads/')) return value;
  return `${apiBase}${value}`;
}
