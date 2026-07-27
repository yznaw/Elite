const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

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
