let registration: ServiceWorkerRegistration | null = null;
let posUpdateSafe = !window.location.pathname.startsWith('/pos');
let reloadStarted = false;

function activateWaitingUpdate(): void {
  if (posUpdateSafe && registration?.waiting) {
    registration.waiting.postMessage({ type: 'ACTIVATE_POS_UPDATE' });
  }
}

/**
 * Registers the POS worker and lets a new build wait until checkout says it is
 * safe. The first install activates normally; only an update with an existing
 * controller is gated.
 */
export async function registerPosServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  registration = await navigator.serviceWorker.register('/pos-sw.js', { scope: '/' });

  activateWaitingUpdate();
  registration.addEventListener('updatefound', () => {
    const installing = registration?.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed') activateWaitingUpdate();
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloadStarted) return;
    reloadStarted = true;
    window.location.reload();
  });
}

/** Called by the POS whenever cart/queue/payment state changes. */
export function setPosServiceWorkerUpdateSafe(safe: boolean): void {
  posUpdateSafe = safe;
  activateWaitingUpdate();
}

export type PosUpdateResult = 'updating' | 'current' | 'busy' | 'reloading';

/**
 * Nothing calls `registration.update()` on its own, so the browser only looks
 * for a new worker on navigation. A till that stays open all day can therefore
 * sit several deploys behind with nothing on screen saying so. This is the
 * manual "am I on the newest build?" check.
 *
 * It respects the same safety gate as an automatic update: a build swap in the
 * middle of a payment would reload the page under the cashier's hands, so a
 * busy till reports `busy` instead and the caller says why.
 */
export async function checkForPosUpdate(): Promise<PosUpdateResult> {
  if (!('serviceWorker' in navigator) || !registration) {
    // No worker to consult (unsupported browser, or registration failed).
    // A plain reload is still the honest answer to "get me the newest build".
    window.location.reload();
    return 'reloading';
  }
  await registration.update();
  if (!registration.waiting) return 'current';
  if (!posUpdateSafe) return 'busy';
  // Activating makes the new worker take over, and the controllerchange
  // listener above reloads the page onto the new build.
  activateWaitingUpdate();
  return 'updating';
}

/**
 * The build the worker is serving, versus the build sitting on the server.
 * Equal strings mean this register is current. Shown in the POS so it can be
 * read out during support instead of guessing from chunk file names.
 */
export async function posBuildVersions(): Promise<{ running: string | null; deployed: string | null }> {
  const running = await new Promise<string | null>((resolve) => {
    const worker = navigator.serviceWorker?.controller;
    if (!worker) return resolve(null);
    const channel = new MessageChannel();
    // The worker may be gone or wedged; never leave the caller hanging on it.
    const timer = setTimeout(() => resolve(null), 2000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data?.version ?? null);
    };
    worker.postMessage({ type: 'GET_POS_VERSION' }, [channel.port2]);
  });

  let deployed: string | null = null;
  try {
    // no-store, or the worker's own cache would answer with the running build
    // and every register would look up to date.
    const response = await fetch('/pos-precache.json', { cache: 'no-store' });
    if (response.ok) deployed = (await response.json())?.version ?? null;
  } catch {
    // Offline. `running` alone is still worth showing.
  }
  return { running, deployed };
}
