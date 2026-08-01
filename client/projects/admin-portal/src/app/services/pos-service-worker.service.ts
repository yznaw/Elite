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
