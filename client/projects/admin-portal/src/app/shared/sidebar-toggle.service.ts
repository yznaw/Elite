import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SidebarToggleService {
  private readonly _open      = signal(false);
  private readonly _collapsed = signal(false);

  readonly open      = this._open.asReadonly();
  readonly collapsed = this._collapsed.asReadonly();

  toggle(): void      { this._open.update((v) => !v); }
  openDrawer(): void  { this._open.set(true); }
  close(): void       { this._open.set(false); }

  toggleCollapse(): void { this._collapsed.update((v) => !v); }
}
