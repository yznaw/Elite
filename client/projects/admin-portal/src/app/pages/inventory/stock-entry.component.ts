import {
  ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges,
  ViewChild, computed, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { InventoryService, ReceiveReason, StockLocation, StockRow } from '../../services/inventory.service';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';

export type EntryMode = 'receive' | 'transfer';

interface EntryLine {
  row: StockRow;
  quantity: number;
}

const RECEIVE_REASONS: ReceiveReason[] = ['received', 'found', 'returned', 'correction'];

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* best effort */ }
}

/** Short confirmation tick when a scan adds an item. */
let beepCtx: AudioContext | null = null;
function beep(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    beepCtx ??= new Ctx();
    const osc = beepCtx.createOscillator();
    const gain = beepCtx.createGain();
    osc.frequency.value = 1320;
    gain.gain.setValueAtTime(0.12, beepCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, beepCtx.currentTime + 0.09);
    osc.connect(gain).connect(beepCtx.destination);
    osc.start();
    osc.stop(beepCtx.currentTime + 0.1);
  } catch { /* sound is a nicety */ }
}

/**
 * Add stock to a location, or move stock between two locations. One search
 * field takes both typing and a barcode scanner: an exact barcode or SKU adds
 * the item straight away (scanning it again adds one more); anything else
 * shows matches to pick from.
 */
@Component({
  selector: 'ap-stock-entry',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="se">
      <!-- Where -->
      <div class="card card-pad se-where">
        @if (mode === 'receive') {
          <div class="lbl">{{ t('inv.entry.location') }}</div>
          <div class="se-seg" role="radiogroup" [attr.aria-label]="t('inv.entry.location')">
            @for (loc of locations; track loc.id) {
              <button type="button" class="se-seg-btn" role="radio" [attr.aria-checked]="locationId() === loc.id"
                      [class.active]="locationId() === loc.id" (click)="setLocation(loc.id)">
                {{ loc.name }}
              </button>
            }
          </div>
          <div class="lbl mt-12">{{ t('inv.entry.reason') }}</div>
          <div class="se-reasons">
            @for (r of reasons; track r) {
              <button type="button" class="chip" [class.active]="reason() === r" (click)="reason.set(r)">{{ t('inv.reason.' + r) }}</button>
            }
          </div>
        } @else {
          <div class="se-route">
            <div>
              <label class="lbl" for="se-from">{{ t('inv.entry.from') }}</label>
              <select id="se-from" class="inp" [ngModel]="fromId()" (ngModelChange)="setFrom($event)">
                @for (loc of locations; track loc.id) { <option [value]="loc.id">{{ loc.name }}</option> }
              </select>
            </div>
            <button type="button" class="btn btn-outline se-swap" (click)="swap()" [attr.aria-label]="t('inv.entry.swap')" [attr.title]="t('inv.entry.swap')">
              <ap-icon name="sync" [size]="14"/>
            </button>
            <div>
              <label class="lbl" for="se-to">{{ t('inv.entry.to') }}</label>
              <select id="se-to" class="inp" [ngModel]="toId()" (ngModelChange)="setTo($event)">
                @for (loc of locations; track loc.id) { <option [value]="loc.id">{{ loc.name }}</option> }
              </select>
            </div>
          </div>
          @if (fromId() === toId()) {
            <div class="inp-msg-error">{{ t('inv.entry.sameLocation') }}</div>
          }
        }
      </div>

      <!-- What -->
      <div class="card card-pad se-what">
        <label class="lbl" for="se-search">{{ t('inv.entry.addItems') }}</label>
        <div class="se-search">
          <ap-icon name="barcode" [size]="16"/>
          <input #searchInput id="se-search" class="inp" autocomplete="off" dir="auto"
                 [placeholder]="t('inv.entry.searchPlaceholder')"
                 [ngModel]="query()" (ngModelChange)="onQuery($event)"
                 (keydown.enter)="$event.preventDefault(); onEnter()"
                 (keydown.escape)="results.set([])"/>
          @if (searching()) { <span class="se-searching muted small">{{ t('common.loading') }}</span> }
        </div>
        @if (searchError()) { <div class="inp-msg-error">{{ searchError() }}</div> }
        @if (results().length) {
          <ul class="se-results" role="listbox" [attr.aria-label]="t('inv.entry.results')">
            @for (row of results(); track row.variantId) {
              <li>
                <button type="button" class="se-result" (click)="addRow(row, false)">
                  <span class="se-result-name">{{ row.productName }}</span>
                  <span class="muted small">{{ variantLabel(row) }} · <span dir="ltr">{{ row.sku }}</span></span>
                  <span class="se-result-qty muted small">{{ mode === 'transfer' ? atLabel(row, fromId()) : atLabel(row, locationId()) }}</span>
                </button>
              </li>
            }
          </ul>
        }

        @if (lines().length) {
          <table class="tbl se-lines">
            <thead>
              <tr>
                <th>{{ t('inv.col.item') }}</th>
                <th class="num">{{ mode === 'transfer' ? t('inv.entry.availableAtSource') : t('inv.entry.nowAtLocation') }}</th>
                <th class="num">{{ t('inv.entry.quantity') }}</th>
                <th><span class="sr-only">{{ t('common.remove') }}</span></th>
              </tr>
            </thead>
            <tbody>
              @for (line of lines(); track line.row.variantId) {
                <tr [class.se-over]="overSource(line)">
                  <td>
                    <div class="se-line-name">{{ line.row.productName }}</div>
                    <div class="muted small">{{ variantLabel(line.row) }} · <span dir="ltr">{{ line.row.sku }}</span></div>
                    @if (overSource(line)) {
                      <div class="inp-msg-error">{{ t('inv.entry.overSource').replace('{n}', '' + qtyAt(line.row, fromId())) }}</div>
                    }
                  </td>
                  <td class="num">{{ qtyAt(line.row, mode === 'transfer' ? fromId() : locationId()) }}</td>
                  <td class="num">
                    <div class="se-stepper">
                      <button type="button" (click)="bump(line, -1)" [disabled]="line.quantity <= 1" [attr.aria-label]="t('inv.entry.less')">−</button>
                      <input type="number" min="1" inputmode="numeric" [ngModel]="line.quantity" (ngModelChange)="setQty(line, $event)"
                             [attr.aria-label]="t('inv.entry.quantity')"/>
                      <button type="button" (click)="bump(line, 1)" [attr.aria-label]="t('inv.entry.more')">+</button>
                    </div>
                  </td>
                  <td class="se-x-cell">
                    <button type="button" class="se-x" (click)="remove(line)" [attr.aria-label]="t('common.remove')">
                      <ap-icon name="x" [size]="11"/>
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <div class="se-empty">
            <ap-icon name="barcode" [size]="20"/>
            <div>{{ t('inv.entry.empty') }}</div>
          </div>
        }

        <label class="lbl mt-16" for="se-note">{{ t('inv.entry.note') }}</label>
        <input id="se-note" class="inp" maxlength="300" [ngModel]="note()" (ngModelChange)="note.set($event)"
               [placeholder]="mode === 'receive' ? t('inv.entry.notePlaceholderReceive') : t('inv.entry.notePlaceholderTransfer')"/>
      </div>

      <!-- Commit -->
      <div class="se-foot">
        <div class="se-summary">{{ summary() }}</div>
        <button type="button" class="btn btn-primary" (click)="submit()" [disabled]="!canSubmit()">
          {{ submitting() ? t('common.saving') : (mode === 'receive' ? t('inv.entry.submitReceive') : t('inv.entry.submitTransfer')) }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .se { display: grid; gap: 16px; }
    .se-where, .se-what { display: grid; gap: 6px; }
    .mt-12 { margin-top: 12px; }
    .mt-16 { margin-top: 16px; }
    .se-seg { display: flex; flex-wrap: wrap; gap: 8px; }
    .se-seg-btn {
      min-height: 44px; padding: 0 18px;
      border: 1px solid var(--border); border-radius: 10px;
      background: var(--surface); color: var(--ink);
      font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
      transition: border-color .15s, background .15s;
    }
    .se-seg-btn:hover { border-color: var(--gold-4); }
    .se-seg-btn.active { background: var(--green); border-color: var(--green); color: #fff; }
    .se-seg-btn:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
    .se-reasons { display: flex; flex-wrap: wrap; gap: 8px; }
    .se-route { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: end; }
    .se-swap { height: 40px; width: 44px; justify-content: center; padding: 0; }
    .se-search { position: relative; display: flex; align-items: center; }
    .se-search ap-icon { position: absolute; inset-inline-start: 12px; color: var(--muted); pointer-events: none; }
    .se-search .inp { padding-inline-start: 38px; height: 46px; font-size: 14px; }
    .se-searching { position: absolute; inset-inline-end: 12px; }
    .se-results {
      list-style: none; margin: 4px 0 0; padding: 4px;
      border: 1px solid var(--border); border-radius: 10px; background: var(--surface);
      box-shadow: var(--shadow); max-height: 320px; overflow-y: auto;
    }
    .se-result {
      width: 100%; display: grid; grid-template-columns: 1fr auto; column-gap: 12px;
      padding: 10px 12px; border: 0; border-radius: 8px; background: none;
      font: inherit; text-align: start; cursor: pointer;
    }
    .se-result:hover, .se-result:focus-visible { background: var(--bg); outline: none; }
    .se-result-name { font-weight: 600; font-size: 13px; color: var(--ink); }
    .se-result-qty { grid-row: 1 / span 2; grid-column: 2; align-self: center; white-space: nowrap; }
    .se-lines { margin-top: 12px; }
    .se-lines th.num, .se-lines td.num { text-align: end; width: 1%; white-space: nowrap; }
    .se-line-name { font-weight: 600; }
    .se-over td { background: var(--danger-bg); }
    .se-stepper { display: inline-flex; align-items: center; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .se-stepper button { width: 34px; height: 34px; border: 0; background: var(--bg); font-size: 16px; cursor: pointer; color: var(--ink); }
    .se-stepper button:disabled { opacity: .4; cursor: default; }
    .se-stepper input { width: 52px; height: 34px; border: 0; text-align: center; font: inherit; font-weight: 600; -moz-appearance: textfield; }
    .se-stepper input::-webkit-outer-spin-button, .se-stepper input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .se-x-cell { width: 1%; }
    .se-x { width: 30px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 50%; background: none; color: var(--muted); cursor: pointer; }
    .se-x:hover { background: var(--danger-bg); color: var(--danger); }
    .se-empty {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      margin-top: 12px; padding: 28px 16px;
      border: 1px dashed var(--border); border-radius: 10px;
      color: var(--muted); font-size: 13px; text-align: center;
    }
    .se-foot {
      position: sticky; bottom: 0;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 14px 18px; border-radius: 12px;
      background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow);
    }
    .se-summary { font-size: 13px; font-weight: 600; color: var(--ink); }
    .se-foot .btn { white-space: nowrap; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    @media (max-width: 640px) {
      .se-route { grid-template-columns: 1fr; }
      .se-swap { justify-self: center; }
      .se-foot { flex-direction: column; align-items: stretch; }
    }
  `],
})
export class StockEntryComponent implements OnChanges {
  private readonly api = inject(InventoryService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  @Input({ required: true }) mode: EntryMode = 'receive';
  @Input({ required: true }) locations: StockLocation[] = [];
  /** A row picked from the stock table ("Add" / "Move"). */
  @Input() preset: StockRow | null = null;
  /** Preferred source/target location from the stock table's filter. */
  @Input() presetLocationId: string | null = null;
  @Output() readonly done = new EventEmitter<void>();

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  readonly t = (k: string): string => this.i18n.t(k);
  readonly reasons = RECEIVE_REASONS;

  readonly locationId = signal('');
  readonly fromId = signal('');
  readonly toId = signal('');
  readonly reason = signal<ReceiveReason>('received');
  readonly note = signal('');
  readonly query = signal('');
  readonly results = signal<StockRow[]>([]);
  readonly searching = signal(false);
  readonly searchError = signal('');
  readonly lines = signal<EntryLine[]>([]);
  readonly submitting = signal(false);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;

  readonly units = computed(() => this.lines().reduce((sum, l) => sum + l.quantity, 0));
  readonly summary = computed(() => {
    if (!this.lines().length) return this.t('inv.entry.nothingYet');
    const name = (id: string) => this.locations.find((l) => l.id === id)?.name ?? '';
    const base = this.t('inv.entry.summaryUnits').replace('{units}', String(this.units())).replace('{items}', String(this.lines().length));
    return this.mode === 'receive'
      ? `${base} → ${name(this.locationId())}`
      : `${base}: ${name(this.fromId())} → ${name(this.toId())}`;
  });
  readonly canSubmit = computed(() => {
    if (this.submitting() || !this.lines().length) return false;
    if (this.mode === 'receive') return !!this.locationId();
    return !!this.fromId() && !!this.toId() && this.fromId() !== this.toId() && !this.lines().some((l) => this.overSource(l));
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['locations'] || changes['mode']) this.initLocations();
    if (changes['presetLocationId'] && this.presetLocationId) {
      if (this.mode === 'receive') this.locationId.set(this.presetLocationId);
      else this.fromId.set(this.presetLocationId);
      this.fixTarget();
    }
    if (changes['preset'] && this.preset) this.addRow(this.preset, false);
  }

  private initLocations(): void {
    const ids = this.locations.map((l) => l.id);
    if (!ids.length) return;
    const pick = (key: string, fallback: string) => {
      const stored = storageGet(key);
      return stored && ids.includes(stored) ? stored : fallback;
    };
    const warehouse = this.locations.find((l) => l.type === 'warehouse')?.id ?? ids[0];
    const firstStore = this.locations.find((l) => l.type === 'store')?.id ?? ids[0];
    if (!ids.includes(this.locationId())) this.locationId.set(pick('elite.inv.receiveLocation', warehouse));
    if (!ids.includes(this.fromId())) this.fromId.set(pick('elite.inv.transferFrom', warehouse));
    if (!ids.includes(this.toId())) this.toId.set(pick('elite.inv.transferTo', firstStore));
    this.fixTarget();
  }

  /** Never leave a transfer pointing at its own source. */
  private fixTarget(): void {
    if (this.fromId() && this.fromId() === this.toId()) {
      const other = this.locations.find((l) => l.id !== this.fromId());
      if (other) this.toId.set(other.id);
    }
  }

  setLocation(id: string): void { this.locationId.set(id); storageSet('elite.inv.receiveLocation', id); }
  setFrom(id: string): void { this.fromId.set(id); storageSet('elite.inv.transferFrom', id); this.fixTarget(); }
  setTo(id: string): void { this.toId.set(id); storageSet('elite.inv.transferTo', id); }
  swap(): void {
    const from = this.fromId();
    this.setFrom(this.toId());
    this.setTo(from);
  }

  variantLabel(row: StockRow): string {
    return [row.color, row.size].filter(Boolean).join(' · ') || this.t('inv.noVariantLabel');
  }
  qtyAt(row: StockRow, locationId: string): number { return row.byLocation[locationId] ?? 0; }
  atLabel(row: StockRow, locationId: string): string {
    const name = this.locations.find((l) => l.id === locationId)?.name ?? '';
    return `${name}: ${this.qtyAt(row, locationId)}`;
  }
  overSource(line: EntryLine): boolean {
    return this.mode === 'transfer' && line.quantity > this.qtyAt(line.row, this.fromId());
  }

  onQuery(value: string): void {
    this.query.set(value);
    this.searchError.set('');
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const q = value.trim();
    if (q.length < 2) { this.results.set([]); return; }
    this.searchTimer = setTimeout(() => void this.search(q, false), 250);
  }

  /** Enter (or a scanner's trailing Enter): exact barcode/SKU adds at once. */
  async onEnter(): Promise<void> {
    const q = this.query().trim();
    if (!q) return;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    await this.search(q, true);
  }

  private async search(q: string, fromEnter: boolean): Promise<void> {
    const seq = ++this.searchSeq;
    this.searching.set(true);
    try {
      const page = await this.api.listStock({ search: q, limit: 8 });
      if (seq !== this.searchSeq) return;
      const needle = q.toLowerCase();
      const exact = page.items.find((row) => (row.barcode || '').toLowerCase() === needle || row.sku.toLowerCase() === needle);
      if (fromEnter && (exact || page.items.length === 1)) {
        this.addRow(exact ?? page.items[0], true);
        return;
      }
      this.results.set(page.items);
      if (!page.items.length) this.searchError.set(this.t('inv.entry.noMatch').replace('{q}', q));
    } catch {
      if (seq === this.searchSeq) this.searchError.set(this.t('inv.entry.searchFailed'));
    } finally {
      if (seq === this.searchSeq) this.searching.set(false);
    }
  }

  addRow(row: StockRow, scanned: boolean): void {
    this.lines.update((list) => {
      const existing = list.find((l) => l.row.variantId === row.variantId);
      if (existing) return list.map((l) => (l === existing ? { ...l, row, quantity: l.quantity + 1 } : l));
      return [...list, { row, quantity: 1 }];
    });
    if (scanned) beep();
    this.query.set('');
    this.results.set([]);
    this.searchError.set('');
    queueMicrotask(() => this.searchInput?.nativeElement.focus());
  }

  bump(line: EntryLine, by: number): void { this.setQty(line, line.quantity + by); }
  setQty(line: EntryLine, value: unknown): void {
    const qty = Math.max(1, Math.min(100000, Math.floor(Number(value) || 1)));
    this.lines.update((list) => list.map((l) => (l.row.variantId === line.row.variantId ? { ...l, quantity: qty } : l)));
  }
  remove(line: EntryLine): void {
    this.lines.update((list) => list.filter((l) => l.row.variantId !== line.row.variantId));
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.submitting.set(true);
    const lines = this.lines().map((l) => ({ variantId: l.row.variantId, quantity: l.quantity }));
    const note = this.note().trim() || undefined;
    const summary = this.summary();
    try {
      if (this.mode === 'receive') {
        await this.api.receive({ locationId: this.locationId(), reason: this.reason(), note, lines });
        this.toast.success(this.t('inv.entry.receivedToast'), summary);
      } else {
        await this.api.transfer({ fromLocationId: this.fromId(), toLocationId: this.toId(), note, lines });
        this.toast.success(this.t('inv.entry.movedToast'), summary);
      }
      this.lines.set([]);
      this.note.set('');
      this.done.emit();
      queueMicrotask(() => this.searchInput?.nativeElement.focus());
    } catch (err) {
      this.toast.errorFrom(err, this.mode === 'receive' ? this.t('inv.entry.receiveFailed') : this.t('inv.entry.moveFailed'));
    } finally {
      this.submitting.set(false);
    }
  }
}
