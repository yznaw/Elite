import { ChangeDetectionStrategy, Component, Input, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { InventoryService, MovementType, StockLocation, StockMovement } from '../../services/inventory.service';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';
import { downloadCsv, todayStamp } from '../../utils/download-csv';

const TYPES: MovementType[] = ['sale', 'return', 'added', 'removed', 'transfer', 'stocktake', 'catalog'];
const PAGE = 50;

/**
 * Who changed stock, where and why. Every staff role can add, move and
 * remove stock, so this is where the owner checks it: filter by person,
 * location, kind of change and dates.
 */
@Component({
  selector: 'ap-stock-history',
  imports: [DatePipe, FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card sh">
      <div class="sh-filters">
        <div class="sh-search">
          <ap-icon name="search" [size]="14"/>
          <input class="inp" dir="auto" [placeholder]="t('inv.searchPlaceholder')" [attr.aria-label]="t('inv.searchPlaceholder')"
                 [ngModel]="search()" (ngModelChange)="onSearch($event)"/>
        </div>
        <select class="inp" [ngModel]="locationId()" (ngModelChange)="locationId.set($event); reload()" [attr.aria-label]="t('inv.filter.location')">
          <option value="">{{ t('inv.filter.allLocations') }}</option>
          @for (loc of locations; track loc.id) { <option [value]="loc.id">{{ loc.name }}</option> }
        </select>
        <select class="inp" [ngModel]="userId()" (ngModelChange)="userId.set($event); reload()" [attr.aria-label]="t('inv.hist.person')">
          <option value="">{{ t('inv.hist.everyone') }}</option>
          @for (u of users(); track u.id) { <option [value]="u.id">{{ u.name }}</option> }
        </select>
        <label class="sh-date">
          <span class="sr-only">{{ t('inv.hist.from') }}</span>
          <input class="inp" type="date" [ngModel]="from()" (ngModelChange)="from.set($event); reload()" [attr.aria-label]="t('inv.hist.from')"/>
        </label>
        <label class="sh-date">
          <span class="sr-only">{{ t('inv.hist.to') }}</span>
          <input class="inp" type="date" [ngModel]="to()" (ngModelChange)="to.set($event); reload()" [attr.aria-label]="t('inv.hist.to')"/>
        </label>
        <button type="button" class="btn btn-outline btn-sm sh-export" (click)="exportHistory()" [disabled]="exporting() || !total()">
          <ap-icon name="download" [size]="12"/> {{ exporting() ? t('common.loading') : t('inv.export') }}
        </button>
      </div>
      <div class="sh-chips" role="group" [attr.aria-label]="t('inv.hist.type')">
        <button type="button" class="chip" [class.active]="type() === ''" (click)="setType('')">{{ t('inv.filter.all') }}</button>
        @for (ty of types; track ty) {
          <button type="button" class="chip" [class.active]="type() === ty" (click)="setType(ty)">{{ t('inv.hist.type.' + ty) }}</button>
        }
      </div>

      <div class="sh-table-wrap">
        <table class="tbl sh-table">
          <thead>
            <tr>
              <th>{{ t('inv.hist.when') }}</th>
              <th>{{ t('inv.col.item') }}</th>
              <th>{{ t('inv.entry.location') }}</th>
              <th class="num">{{ t('inv.hist.change') }}</th>
              <th>{{ t('inv.entry.reason') }}</th>
              <th>{{ t('inv.hist.person') }}</th>
            </tr>
          </thead>
          <tbody>
            @if (loading() && !items().length) {
              @for (i of [1, 2, 3, 4]; track i) {
                <tr aria-hidden="true"><td colspan="6"><div class="sh-skel"></div></td></tr>
              }
            }
            @for (m of items(); track m.id) {
              <tr>
                <td class="sh-when">{{ m.occurredAt | date: 'd MMM, HH:mm' }}</td>
                <td>
                  <div class="sh-name">{{ m.productName }}</div>
                  <div class="muted small">{{ variantLabel(m) }} <span dir="ltr">{{ m.sku }}</span></div>
                </td>
                <td>{{ m.locationName || '–' }}</td>
                <td class="num"><span class="sh-delta" [class.up]="m.delta > 0" [class.down]="m.delta < 0">{{ m.delta > 0 ? '+' + m.delta : m.delta }}</span></td>
                <td>
                  <div>{{ reasonLabel(m) }}</div>
                  @if (detail(m)) { <div class="muted small">{{ detail(m) }}</div> }
                </td>
                <td>{{ m.userName || t('inv.hist.system') }}</td>
              </tr>
            }
            @if (!loading() && !items().length) {
              <tr><td colspan="6"><div class="sh-empty">{{ t('inv.hist.empty') }}</div></td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (items().length < total()) {
        <div class="sh-more">
          <button type="button" class="btn btn-outline btn-sm" (click)="load(false)" [disabled]="loading()">
            {{ loading() ? t('common.loading') : t('inv.loadMore') }}
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .sh { overflow: hidden; }
    .sh-filters { display: flex; flex-wrap: wrap; gap: 10px; padding: 14px 16px 8px; }
    .sh-filters select.inp { width: auto; min-width: 150px; }
    .sh-search { position: relative; flex: 1 1 220px; }
    .sh-search ap-icon { position: absolute; inset-inline-start: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); }
    .sh-search .inp { padding-inline-start: 34px; }
    .sh-date .inp { width: 150px; }
    .sh-export { margin-inline-start: auto; white-space: nowrap; align-self: center; }
    .sh-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 14px; border-bottom: 1px solid var(--border); }
    .sh-table-wrap { overflow-x: auto; }
    .sh-table th { cursor: default; }
    .sh-table th.num, .sh-table td.num { text-align: end; }
    .sh-when { white-space: nowrap; color: var(--ink-2); font-variant-numeric: tabular-nums; }
    .sh-name { font-weight: 600; }
    .sh-delta { font-weight: 700; font-variant-numeric: tabular-nums; }
    .sh-delta.up { color: var(--success); }
    .sh-delta.down { color: var(--danger); }
    .sh-skel { height: 14px; border-radius: 4px; background: var(--border-2); }
    .sh-empty { padding: 32px 0; text-align: center; color: var(--muted); }
    .sh-more { display: flex; justify-content: center; padding: 14px; border-top: 1px solid var(--border-2); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  `],
})
export class StockHistoryComponent implements OnInit {
  private readonly api = inject(InventoryService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  @Input({ required: true }) locations: StockLocation[] = [];

  readonly t = (k: string): string => this.i18n.t(k);
  readonly types = TYPES;

  readonly search = signal('');
  readonly locationId = signal('');
  readonly userId = signal('');
  readonly type = signal<MovementType | ''>('');
  readonly from = signal('');
  readonly to = signal('');
  readonly items = signal<StockMovement[]>([]);
  readonly users = signal<{ id: string; name: string }[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly exporting = signal(false);
  private seq = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void { void this.load(true); }

  onSearch(value: string): void {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.reload(), 250);
  }
  setType(type: MovementType | ''): void { this.type.set(type); this.reload(); }
  reload(): void { void this.load(true); }

  async load(reset: boolean): Promise<void> {
    const seq = ++this.seq;
    this.loading.set(true);
    try {
      const page = await this.api.listMovements({
        search: this.search().trim(),
        locationId: this.locationId(),
        userId: this.userId(),
        type: this.type(),
        from: this.from(),
        to: this.to(),
        limit: PAGE,
        offset: reset ? 0 : this.items().length,
      });
      if (seq !== this.seq) return;
      this.items.set(reset ? page.items : [...this.items(), ...page.items]);
      this.total.set(page.total);
      if (page.users?.length) this.users.set(page.users);
    } catch (err) {
      if (seq === this.seq) this.toast.errorFrom(err, this.t('inv.hist.loadError'));
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  /** Everything matching the filters (capped at 5,000 rows). */
  async exportHistory(): Promise<void> {
    this.exporting.set(true);
    try {
      const all: StockMovement[] = [];
      for (let offset = 0; offset < 5000; offset += 200) {
        const page = await this.api.listMovements({
          search: this.search().trim(), locationId: this.locationId(), userId: this.userId(), type: this.type(),
          from: this.from(), to: this.to(), limit: 200, offset,
        });
        all.push(...page.items);
        if (all.length >= page.total || !page.items.length) break;
      }
      downloadCsv(`stock-history-${todayStamp()}.csv`, [
        ['When', 'Product', 'Color', 'Size', 'SKU', 'Location', 'Change', 'Reason', 'Detail', 'Person'],
        ...all.map((m) => [
          new Date(m.occurredAt).toLocaleString('en-GB'), m.productName, m.color ?? '', m.size ?? '', m.sku ?? '',
          m.locationName ?? '', m.delta, this.reasonLabel(m), this.detail(m), m.userName ?? this.t('inv.hist.system'),
        ]),
      ]);
    } catch (err) {
      this.toast.errorFrom(err, this.t('inv.exportFailed'));
    } finally {
      this.exporting.set(false);
    }
  }

  variantLabel(m: StockMovement): string {
    return [m.color, m.size].filter(Boolean).join(' · ');
  }

  reasonLabel(m: StockMovement): string {
    if (m.reason === 'manual_adjustment' && m.adjustmentReason) {
      const key = 'inv.reason.' + m.adjustmentReason;
      const label = this.t(key);
      if (label !== key) return label;
    }
    const key = 'inv.hist.reason.' + m.reason;
    const label = this.t(key);
    return label === key ? m.reason : label;
  }

  detail(m: StockMovement): string {
    if (m.reason === 'transfer') {
      return m.delta < 0 ? this.t('inv.hist.toLocation').replace('{name}', m.transferTo || '') : this.t('inv.hist.fromLocation').replace('{name}', m.transferFrom || '');
    }
    return [m.orderNumber, m.note].filter(Boolean).join(' · ');
  }
}
