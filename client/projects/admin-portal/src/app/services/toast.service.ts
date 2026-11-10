import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  run: () => void;
  /** Keep the toast after the button is pressed (e.g. "Try now" while the
      condition may still hold; the owner clears it when it is really over). */
  keepOpen?: boolean;
}

export interface Toast {
  id: number;
  title: string;
  sub?: string;
  kind: ToastKind;
  action?: ToastAction;
  /** ms to live; null = persistent (must be dismissed manually) */
  duration: number | null;
  /** Identity for de-duplication: a repeat updates this toast instead of stacking. */
  key: string;
  /** How many times this message was raised while visible (shown as ×N). */
  count: number;
}

export interface ToastInput {
  title: string;
  sub?: string;
  kind?: ToastKind;
  action?: ToastAction;
  duration?: number | null;
  /** Same key = same message. Defaults to kind + title + sub. */
  key?: string;
}

/**
 * Every kind leaves on its own. A message that must stay (the connection
 * banner, a "receipt not printed, Retry" prompt) passes `duration: null`
 * explicitly, because it carries an action the user still has to take.
 */
const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 3500,
  info:    3500,
  warning: 6000,
  error:   8000,
};

/** More than this and the stack starts covering the page it is about. */
export const MAX_VISIBLE_TOASTS = 3;

/**
 * HTTP errors the global interceptor already told the user about. A component
 * catch block that toasts the same failure again produced the double messages
 * ("Server error" + "Couldn't load report"); errorFrom/warningFrom skip those.
 * A WeakSet so a surfaced error is forgotten with the error object itself.
 */
const shownErrors = new WeakSet<object>();

export function markToastShown(error: unknown): void {
  if (typeof error === 'object' && error !== null) shownErrors.add(error);
}

export function wasToastShown(error: unknown): boolean {
  return typeof error === 'object' && error !== null && shownErrors.has(error);
}

interface Timer {
  handle: number | null;
  remaining: number;
  startedAt: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _items = signal<Toast[]>([]);
  readonly items = this._items.asReadonly();

  private readonly timers = new Map<number, Timer>();
  private nextId = 1;

  push(input: ToastInput): number {
    const kind = input.kind ?? 'info';
    const duration = input.duration === undefined ? DEFAULT_DURATION[kind] : input.duration;
    const key = input.key ?? `${kind}|${input.title}|${input.sub ?? ''}`;

    const existing = this._items().find((t) => t.key === key);
    if (existing) {
      // The same message again: refresh it in place and count it, rather than
      // stacking an identical copy (one outage used to stack eight).
      this._items.update((list) => list.map((t) => (t.id === existing.id
        ? { ...t, kind, title: input.title, sub: input.sub, action: input.action, duration, count: t.count + 1 }
        : t)));
      this.schedule(existing.id, duration);
      return existing.id;
    }

    const toast: Toast = {
      id: this.nextId++,
      title: input.title,
      sub: input.sub,
      kind,
      action: input.action,
      duration,
      key,
      count: 1,
    };
    this._items.update((list) => [...list, toast]);
    this.enforceCap();
    this.schedule(toast.id, duration);
    return toast.id;
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

  /**
   * A page's own message for a failed request, shown only when the global
   * HTTP message has not already covered that same failure. Use in catch
   * blocks around API calls; non-HTTP failures always show.
   */
  errorFrom(error: unknown, title: string, sub?: string, action?: ToastAction): number | null {
    return wasToastShown(error) ? null : this.error(title, sub, action);
  }
  warningFrom(error: unknown, title: string, sub?: string, action?: ToastAction): number | null {
    return wasToastShown(error) ? null : this.warning(title, sub, action);
  }

  dismiss(id: number): void {
    this.clearTimer(id);
    this._items.update((list) => list.filter((t) => t.id !== id));
  }

  /** Clear a keyed message once its condition is over (e.g. back online). */
  dismissKey(key: string): void {
    const toast = this._items().find((t) => t.key === key);
    if (toast) this.dismiss(toast.id);
  }

  /** Hold a toast while it is being read (pointer over it or focus inside). */
  pause(id: number): void {
    const timer = this.timers.get(id);
    if (!timer || timer.handle === null) return;
    clearTimeout(timer.handle);
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
    timer.handle = null;
  }

  resume(id: number): void {
    const timer = this.timers.get(id);
    if (!timer || timer.handle !== null) return;
    timer.startedAt = Date.now();
    timer.handle = window.setTimeout(() => this.dismiss(id), timer.remaining);
  }

  clear(): void {
    this.timers.forEach((t) => { if (t.handle !== null) clearTimeout(t.handle); });
    this.timers.clear();
    this._items.set([]);
  }

  private schedule(id: number, duration: number | null): void {
    this.clearTimer(id);
    if (duration === null) return;
    this.timers.set(id, {
      handle: window.setTimeout(() => this.dismiss(id), duration),
      remaining: duration,
      startedAt: Date.now(),
    });
  }

  private clearTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer?.handle != null) clearTimeout(timer.handle);
    this.timers.delete(id);
  }

  /** Oldest self-dismissing toasts go first; persistent ones need an answer. */
  private enforceCap(): void {
    let list = this._items();
    while (list.length > MAX_VISIBLE_TOASTS) {
      const victim = list.find((t) => t.duration !== null) ?? list[0];
      this.clearTimer(victim.id);
      list = list.filter((t) => t.id !== victim.id);
    }
    this._items.set(list);
  }
}
