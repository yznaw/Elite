import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { ClientLoggerService } from './app/services/client-logger.service';
import { registerWindowErrorHandlers } from './app/services/global-error-handler';
import { registerPosServiceWorker } from './app/services/pos-service-worker.service';

// Registered at bootstrap (not lazily inside the POS route) so the browser's
// install/download prompt can fire on any first page, not only after a user
// happens to visit /pos first — a service worker + web manifest are both
// required for installability, and the SW previously only registered from
// pos.component.ts's ngOnInit.
if ('serviceWorker' in navigator) {
  void registerPosServiceWorker().catch(() => undefined);
}

bootstrapApplication(AppComponent, appConfig)
  .then((appRef) => {
    // Window-level handlers catch what Angular's ErrorHandler never sees:
    // errors thrown outside the zone and unhandled promise rejections. Also
    // flushes the buffered log on tab-hide and on reconnect (docs/24, Phase D).
    registerWindowErrorHandlers(appRef.injector.get(ClientLoggerService));
  })
  .catch((err) => console.error(err));
