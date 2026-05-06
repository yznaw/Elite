import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  title: string;
  sub?: string;
  kind: ToastKind;
  action?: ToastAction;
  /** ms to live; null = persistent (must be dismissed manually) */
  duration: number | null;
}

export interface ToastInput {
  title: string;
  sub?: string;
  kind?: ToastKind;
  action?: ToastAction;
  duration?: number | null;
}

const DEFAULT_DURATION: Record<ToastKind, number | null> = {
  success: 3500,
  info:    3500,
  warning: 5000,
  error:   null, // persistent — must be dismissed
};

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _items = signal<Toast[]>([]);
  readonly items = this._items.asReadonly();

  private readonly timers = new Map<number, number>();

  push(input: ToastInput): number {
    const kind = input.kind ?? 'info';
    const id = Date.now() + Math.random();
    const duration = input.duration === undefined ? DEFAULT_DURATION[kind] : input.duration;
    const toast: Toast = {
      id,
      title: input.title,
      sub: input.sub,
      kind,
      action: input.action,
      duration,
    };
    this._items.update((list) => [...list, toast]);
    if (duration !== null) {
      const handle = window.setTimeout(() => this.dismiss(id), duration);
      this.timers.set(id, handle);
    }
    return id;
  }

  /** Convenience helpers */
  success(title: string, sub?: string, action?: ToastAction): number {
    return this.push({ title, sub, kind: 'success', action });
  }
  error(title: string, sub?: string, action?: ToastAction): number {
    return this.push({ title, sub, kind: 'error', action });
  }
  info(title: string, sub?: string, action?: ToastAction): number {
    return this.push({ title, sub, kind: 'info', action });
  }
  warning(title: string, sub?: string, action?: ToastAction): number {
    return this.push({ title, sub, kind: 'warning', action });
  }

  dismiss(id: number): void {
    const handle = this.timers.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.timers.delete(id);
    }
    this._items.update((list) => list.filter((t) => t.id !== id));
  }

  clear(): void {
    this.timers.forEach((h) => clearTimeout(h));
    this.timers.clear();
    this._items.set([]);
  }
}
