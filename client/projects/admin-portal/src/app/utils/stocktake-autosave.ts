/**
 * Autosave for stocktake counts.
 *
 * Before this, a count typed into a row only lived in the browser until that
 * row's Save button was pressed; the export showed an empty Counted column and
 * a refresh lost the numbers (team feedback, 2026-09-24). Now a count is saved
 * when it is committed (Enter or leaving the field), each row reports whether
 * it is saved, and callers can ask whether anything is still unsaved.
 *
 * Kept free of Angular so every save, failure and race is unit-tested under
 * plain Node (client/test/stocktake-autosave.test.ts).
 */

export type RowSaveState = 'unsaved' | 'invalid' | 'saving' | 'saved' | 'error';
export type CommitResult = 'saved' | 'queued' | 'invalid' | 'error' | 'empty';

/** Whole, non-negative number of pieces; anything else is not a count. */
export function parseCount(raw: string | undefined | null): number | null {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

export interface CountAutosaveOptions {
  /** Persist one count. Rejects on failure. */
  save: (variantId: string, quantity: number) => Promise<void>;
  /** Called whenever a row's draft or state changes (drives the UI). */
  onChange?: () => void;
  /** How long a row shows "Saved" before settling back to its count. */
  savedDisplayMs?: number;
  setTimer?: (run: () => void, ms: number) => unknown;
}

export class CountAutosave {
  private readonly drafts = new Map<string, string>();
  private readonly states = new Map<string, RowSaveState>();
  /** Quantity currently being sent, per row: at most one request per row. */
  private readonly inFlight = new Map<string, number>();
  /** The newest value committed while a save was in flight; last one wins. */
  private readonly queued = new Map<string, number>();
  private readonly running = new Map<string, Promise<CommitResult>>();
  private readonly savedDisplayMs: number;
  private readonly setTimer: (run: () => void, ms: number) => unknown;
  private readonly options: CountAutosaveOptions;

  // No parameter properties: this file also runs under Node's type stripping.
  constructor(options: CountAutosaveOptions) {
    this.options = options;
    this.savedDisplayMs = options.savedDisplayMs ?? 2000;
    this.setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  }

  draft(variantId: string): string | undefined {
    return this.drafts.get(variantId);
  }

  state(variantId: string): RowSaveState | undefined {
    return this.states.get(variantId);
  }

  /** The row was typed into. Nothing is sent until the value is committed. */
  setDraft(variantId: string, raw: string | number | null | undefined): void {
    const text = raw === null || raw === undefined ? '' : String(raw);
    if (text.trim() === '') {
      this.drafts.delete(variantId);
      if (!this.inFlight.has(variantId)) this.states.delete(variantId);
    } else {
      this.drafts.set(variantId, text);
      if (!this.inFlight.has(variantId)) this.states.set(variantId, 'unsaved');
    }
    this.changed();
  }

  /** Save the row's draft (Enter, leaving the field, Save, Retry). */
  commit(variantId: string): Promise<CommitResult> {
    const raw = this.drafts.get(variantId);
    if (raw === undefined || raw.trim() === '') return Promise.resolve('empty');
    const quantity = parseCount(raw);
    if (quantity === null) {
      this.states.set(variantId, 'invalid');
      this.changed();
      return Promise.resolve('invalid');
    }
    if (this.inFlight.has(variantId)) {
      if (this.inFlight.get(variantId) !== quantity) this.queued.set(variantId, quantity);
      else this.queued.delete(variantId);
      return Promise.resolve('queued');
    }
    return this.run(variantId, quantity);
  }

  /** Save every row that still has a draft, one at a time. */
  async saveAll(): Promise<{ saved: number; failed: number; invalid: number }> {
    let saved = 0;
    let failed = 0;
    let invalid = 0;
    for (const variantId of [...this.drafts.keys()]) {
      const result = await this.commit(variantId);
      if (result === 'queued') {
        const settled = await this.running.get(variantId);
        if (settled === 'saved') saved++; else if (settled === 'error') failed++;
      } else if (result === 'saved') saved++;
      else if (result === 'error') failed++;
      else if (result === 'invalid') invalid++;
    }
    await Promise.all(this.running.values());
    return { saved, failed, invalid };
  }

  /** Rows whose count is not safely stored yet (typed, invalid, failed or in flight). */
  pendingCount(): number {
    const ids = new Set<string>([...this.drafts.keys(), ...this.inFlight.keys()]);
    return ids.size;
  }

  hasPending(): boolean {
    return this.pendingCount() > 0;
  }

  /** Wait for in-flight saves (used before export/import). */
  async settle(): Promise<void> {
    await Promise.all(this.running.values());
  }

  /** Forget every draft and state (after switching location or stocktake). */
  reset(): void {
    this.drafts.clear();
    this.states.clear();
    this.queued.clear();
    this.changed();
  }

  private run(variantId: string, quantity: number): Promise<CommitResult> {
    const task = this.send(variantId, quantity);
    this.running.set(variantId, task);
    return task;
  }

  private async send(variantId: string, quantity: number): Promise<CommitResult> {
    this.inFlight.set(variantId, quantity);
    this.states.set(variantId, 'saving');
    this.changed();
    let result: CommitResult;
    try {
      await this.options.save(variantId, quantity);
      // Only clear the box if nothing newer was typed while this was saving.
      if (parseCount(this.drafts.get(variantId)) === quantity) this.drafts.delete(variantId);
      this.states.set(variantId, 'saved');
      this.setTimer(() => {
        if (this.states.get(variantId) === 'saved') {
          this.states.delete(variantId);
          this.changed();
        }
      }, this.savedDisplayMs);
      result = 'saved';
    } catch {
      // The typed value stays in the box so it can be retried, not retyped.
      this.states.set(variantId, 'error');
      result = 'error';
    } finally {
      this.inFlight.delete(variantId);
    }

    const next = this.queued.get(variantId);
    this.queued.delete(variantId);
    if (next !== undefined) {
      this.changed();
      return this.run(variantId, next);
    }
    if (this.running.get(variantId)) this.running.delete(variantId);
    // A value typed during the save that was never committed is still unsaved.
    if (result === 'saved' && this.drafts.has(variantId)) this.states.set(variantId, 'unsaved');
    this.changed();
    return result;
  }

  private changed(): void {
    this.options.onChange?.();
  }
}
