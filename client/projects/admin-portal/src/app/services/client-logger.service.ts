import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client.service';

export type ClientLogSeverity = 'error' | 'warn';
export type ClientLogSource = 'pos-client' | 'admin-client';

export interface ClientLogEntry {
  source: ClientLogSource;
  severity: ClientLogSeverity;
  message: string;
  code?: string | null;
  stack?: string | null;
  route?: string | null;
  httpStatus?: number | null;
  requestId?: string | null;
  registerId?: string | null;
  shiftId?: string | null;
  occurredAt: string;
  online?: boolean;
  pendingSales?: number | null;
  context?: Record<string, unknown>;
}

const DB_NAME = 'elite-logs';
const DB_VERSION = 1;
const STORE = 'entries';

/** Batch/flush limits. The server caps the batch at 20 as well. */
const MAX_BATCH = 20;
const MAX_BUFFERED = 500;
const FLUSH_DEBOUNCE_MS = 5000;
const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;

const SENSITIVE_KEY = /(pin|password|passwd|secret|token|cookie|authorization|csrf|card|pan|cvv)/i;

/**
 * Ships client-side errors to the server so a fault on the register can be
 * investigated after it happened.
 *
 * The problem it solves: the till runs in a browser inside the shop. Before
 * this, an error on the cashier's screen lived only in a DevTools console that
 * closes with the tab — "the screen froze" left no evidence at all, and the
 * detailed QZ hardware logging in pos-hardware.service.ts was only useful if
 * someone happened to have DevTools open at that exact moment.
 *
 * Non-negotiable properties, because this runs next to money:
 *  - **Never throws.** Every public method swallows its own failures.
 *  - **Never blocks a sale.** Callers use `log(...)` without awaiting; the
 *    flush is debounced and detached.
 *  - **Survives being offline.** Entries buffer in IndexedDB first and flush
 *    when connectivity returns, which matters because errors that happen
 *    while offline are exactly the ones we cannot otherwise see.
 *  - **Own database (`elite-logs`), not the POS one.** `elite-pos` holds
 *    unsynced money; bumping its schema version for a logging feature would
 *    put a migration risk on financial data for no benefit.
 *  - **Bounded.** Oldest entries are dropped past MAX_BUFFERED so a
 *    crash-looping page cannot fill the disk or flood the API.
 *  - **Redacted at the source.** PINs, tokens and cookies never leave the
 *    browser. The server redacts again; neither layer trusts the other.
 */
@Injectable({ providedIn: 'root' })
export class ClientLoggerService {
  private readonly api = inject(ApiClient);
  private db: IDBDatabase | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  /**
   * Set while a flush request is in flight. The HTTP error interceptor and the
   * global ErrorHandler both consult this so a failure of the log endpoint can
   * never be reported through the log endpoint — without it, one endpoint
   * failure becomes an unbounded retry storm on a register.
   */
  private suspended = false;

  /** Ambient context attached to every entry, set by the POS shell. */
  private registerId: string | null = null;
  private shiftId: string | null = null;
  private pendingSales: number | null = null;

  setContext(context: { registerId?: string | null; shiftId?: string | null; pendingSales?: number | null }): void {
    if ('registerId' in context) this.registerId = context.registerId ?? null;
    if ('shiftId' in context) this.shiftId = context.shiftId ?? null;
    if ('pendingSales' in context) this.pendingSales = context.pendingSales ?? null;
  }

  /** True while a log flush is in flight — used by callers as a loop guard. */
  isSuspended(): boolean {
    return this.suspended;
  }

  /**
   * Records one entry. Fire-and-forget by design: callers must not await this,
   * and it resolves even when everything inside failed.
   */
  log(entry: Omit<ClientLogEntry, 'occurredAt'> & { occurredAt?: string }): void {
    void this.enqueue(entry).catch(() => undefined);
  }

  /** Convenience wrapper for an unknown thrown value. */
  logError(
    source: ClientLogSource,
    error: unknown,
    extra: Partial<ClientLogEntry> = {},
  ): void {
    const asError = error as { message?: string; stack?: string; status?: number; error?: { code?: string } } | null;
    this.log({
      source,
      severity: 'error',
      message: String(asError?.message || error || 'Unknown client error'),
      stack: asError?.stack ?? null,
      httpStatus: typeof asError?.status === 'number' ? asError.status : null,
      code: extra.code ?? asError?.error?.code ?? null,
      ...extra,
    });
  }

  private async enqueue(entry: Omit<ClientLogEntry, 'occurredAt'> & { occurredAt?: string }): Promise<void> {
    const record: ClientLogEntry = {
      source: entry.source,
      severity: entry.severity ?? 'error',
      message: this.truncate(entry.message, MAX_MESSAGE) || 'Unknown client error',
      code: entry.code ?? null,
      stack: this.truncate(entry.stack, MAX_STACK),
      route: entry.route ?? (typeof location !== 'undefined' ? location.pathname : null),
      httpStatus: entry.httpStatus ?? null,
      requestId: entry.requestId ?? null,
      registerId: entry.registerId ?? this.registerId,
      shiftId: entry.shiftId ?? this.shiftId,
      occurredAt: entry.occurredAt ?? new Date().toISOString(),
      online: entry.online ?? (typeof navigator !== 'undefined' ? navigator.onLine : undefined),
      pendingSales: entry.pendingSales ?? this.pendingSales,
      context: this.scrub(entry.context ?? {}) as Record<string, unknown>,
    };

    const db = await this.open();
    if (!db) return;
    await this.tx(db, 'readwrite', (store) => store.add(record));
    await this.trim(db);
    this.scheduleFlush();
  }

  /**
   * Debounced so a burst (a render loop throwing on every change detection
   * cycle) produces one request rather than hundreds.
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush().catch(() => undefined);
    }, FLUSH_DEBOUNCE_MS);
  }

  /** Sends buffered entries. Safe to call at any time; no-ops when it can't. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    this.flushing = true;
    try {
      const db = await this.open();
      if (!db) return;
      const batch = await this.readBatch(db);
      if (!batch.length) return;

      this.suspended = true;
      try {
        await this.send(batch.map((item) => item.value));
        // Only delete after the server accepted them: a failed flush must
        // leave the buffer intact so nothing is lost, which is the whole
        // point of buffering in the first place.
        await this.tx(db, 'readwrite', (store) => {
          for (const item of batch) store.delete(item.key);
        });
      } finally {
        this.suspended = false;
      }
    } catch {
      // Swallowed on purpose. A log that cannot be delivered stays buffered
      // and is retried on the next enqueue, visibility change, or flush call.
      // It must never surface a toast: a cashier does not care that logging
      // failed, and a "logging failed" error would itself be logged.
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Deliberately `fetch`, not HttpClient.
   *
   * An HttpClient call would pass through `httpErrorInterceptor`, which shows a
   * toast on every failure — so a log endpoint that is down would spam the
   * cashier's screen with errors about logging, and each of those would be a
   * candidate for logging in turn. It would also inherit the GET retry policy.
   * A bare fetch keeps this path completely inert on failure. The CSRF header
   * is therefore mirrored manually, exactly as `csrfInterceptor` does.
   */
  private async send(entries: ClientLogEntry[]): Promise<void> {
    const csrf = document.cookie.match(/(?:^|; )elite\.csrf=([^;]*)/);
    const response = await fetch(this.api.url('/client-logs'), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf[1]) } : {}),
      },
      body: JSON.stringify({ entries }),
    });
    if (!response.ok) throw new Error(`client-logs responded ${response.status}`);
  }

  private open(): Promise<IDBDatabase | null> {
    if (this.db) return Promise.resolve(this.db);
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE)) {
            request.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          }
        };
        request.onsuccess = () => {
          this.db = request.result;
          resolve(this.db);
        };
        // Private mode, disabled storage, or a corrupt profile: logging simply
        // goes away rather than breaking the app around it.
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private tx(db: IDBDatabase, mode: IDBTransactionMode, work: (store: IDBObjectStore) => void): Promise<void> {
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(STORE, mode);
        work(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private readBatch(db: IDBDatabase): Promise<Array<{ key: IDBValidKey; value: ClientLogEntry }>> {
    return new Promise((resolve) => {
      const batch: Array<{ key: IDBValidKey; value: ClientLogEntry }> = [];
      try {
        const cursorRequest = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor || batch.length >= MAX_BATCH) return resolve(batch);
          batch.push({ key: cursor.primaryKey, value: cursor.value as ClientLogEntry });
          cursor.continue();
        };
        cursorRequest.onerror = () => resolve(batch);
      } catch {
        resolve(batch);
      }
    });
  }

  /** Drops the oldest entries once the buffer exceeds its cap. */
  private trim(db: IDBDatabase): Promise<void> {
    return new Promise((resolve) => {
      try {
        const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
        const countRequest = store.count();
        countRequest.onsuccess = () => {
          let excess = countRequest.result - MAX_BUFFERED;
          if (excess <= 0) return resolve();
          const cursorRequest = store.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor || excess <= 0) return resolve();
            cursor.delete();
            excess -= 1;
            cursor.continue();
          };
          cursorRequest.onerror = () => resolve();
        };
        countRequest.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private truncate(value: string | null | undefined, max: number): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  private scrub(value: unknown, depth = 0): unknown {
    if (depth > 4) return '[depth-limit]';
    if (value === null || typeof value !== 'object') {
      return typeof value === 'string' ? this.truncate(value, 500) : value;
    }
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => this.scrub(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : this.scrub(raw, depth + 1);
    }
    return out;
  }
}
