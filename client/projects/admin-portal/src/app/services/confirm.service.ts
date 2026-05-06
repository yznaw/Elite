import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual treatment for the icon and confirm button */
  variant?: 'danger' | 'warning' | 'info';
  /** When true, the confirm button shows a spinner; pair with a busy promise */
  busy?: boolean;
}

interface OpenRequest {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly _request = signal<OpenRequest | null>(null);
  readonly request = this._request.asReadonly();
  readonly busy = signal(false);

  /**
   * Open a confirmation dialog. Returns a Promise that resolves to
   * `true` if the user confirms, `false` if they cancel or dismiss.
   *
   * Example:
   *   if (await confirm.ask({ title: 'Delete file', message: 'This cannot be undone.', variant: 'danger' })) { … }
   */
  ask(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      this._request.set({
        options: { variant: 'info', confirmLabel: 'Confirm', cancelLabel: 'Cancel', ...options },
        resolve,
      });
    });
  }

  resolve(ok: boolean): void {
    const req = this._request();
    if (!req) return;
    this._request.set(null);
    this.busy.set(false);
    req.resolve(ok);
  }

  setBusy(b: boolean): void {
    this.busy.set(b);
  }
}
