import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Registered at bootstrap (not lazily inside the POS route) so the browser's
// install/download prompt can fire on any first page, not only after a user
// happens to visit /pos first — a service worker + web manifest are both
// required for installability, and the SW previously only registered from
// pos.component.ts's ngOnInit.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/pos-sw.js', { scope: '/' }).catch(() => undefined);
}

bootstrapApplication(AppComponent, appConfig).catch((err) =>
  console.error(err)
);
