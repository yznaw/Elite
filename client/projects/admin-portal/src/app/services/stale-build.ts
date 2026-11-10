import { NavigationError } from '@angular/router';

const RELOAD_KEY = 'elite-admin:stale-build-reload';
const NOTICE_KEY = 'elite-admin:updated-notice';
const RELOAD_COOLDOWN_MS = 10_000;

/**
 * A deploy deletes the previous build's hashed page chunks. A tab opened
 * before it still asks for the old names, gets a 404, and the router cancels
 * the navigation silently: links "do nothing" until the page is reloaded.
 * Load the page the operator asked for with a full reload, once, so it comes
 * from the new build. A repeat failure for the same URL within the cooldown
 * falls through to the normal error path (and the client error log).
 */
export function reloadOnStaleBuild(event: NavigationError): void {
  const message = String((event.error as Error | undefined)?.message ?? event.error);
  if (!/dynamically imported module|Importing a module script failed/i.test(message)) return;
  try {
    const last = JSON.parse(sessionStorage.getItem(RELOAD_KEY) || 'null') as { url: string; at: number } | null;
    if (last?.url === event.url && Date.now() - last.at < RELOAD_COOLDOWN_MS) return;
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ url: event.url, at: Date.now() }));
    sessionStorage.setItem(NOTICE_KEY, '1');
  } catch {
    // Without storage there is no loop guard, so do not reload.
    return;
  }
  location.assign(event.url);
}

/** True once after a stale-build reload, so the shell can say why it reloaded. */
export function consumeUpdatedNotice(): boolean {
  try {
    if (sessionStorage.getItem(NOTICE_KEY) !== '1') return false;
    sessionStorage.removeItem(NOTICE_KEY);
    return true;
  } catch {
    return false;
  }
}
