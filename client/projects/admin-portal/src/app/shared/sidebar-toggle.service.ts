import { Injectable, signal } from '@angular/core';

/**
 * Tracks whether the mobile sidebar drawer is open. Topbar's hamburger
 * toggles it; Sidebar reads it to decide whether to render the drawer
 * variant; an overlay click closes it.
 */
@Injectable({ providedIn: 'root' })
export class SidebarToggleService {
  private readonly _open = signal(false);
  readonly open = this._open.asReadonly();

  toggle(): void { this._open.update((v) => !v); }
  openDrawer(): void { this._open.set(true); }
  close(): void { this._open.set(false); }
}
