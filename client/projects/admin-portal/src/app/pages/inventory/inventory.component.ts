import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IconComponent } from '../../shared/icons/icon.component';
import {
  AdjustmentReason, InventoryService, StockLocation, StockRow, TransferSummary,
} from '../../services/inventory.service';
import { AuthService } from '../../services/auth.service';
import { ConfirmService } from '../../services/confirm.service';
import { StoreConfigService } from '../../services/store-config.service';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';
import { StockEntryComponent } from './stock-entry.component';
import { StockHistoryComponent } from './stock-history.component';
import { StockFileComponent } from './stock-file.component';
import { AddMethod, AddStockComponent } from './add-stock.component';
import { downloadCsv, todayStamp } from '../../utils/download-csv';

type Tab = 'stock' | 'receive' | 'transfer' | 'history';
type StateFilter = '' | 'low' | 'out';

const REMOVE_REASONS: AdjustmentReason[] = ['damaged', 'lost', 'returned_to_supplier', 'sample', 'correction'];
const PAGE = 50;

/**
 * Inventory: stock per location (stores + warehouse), adding stock and moving
 * it between locations. Owner/admin/manager; cashiers never reach this page.
 * Before per-location stock is switched on, the page explains it and lets an
 * owner/admin turn it on.
 */
@Component({
  selector: 'ap-inventory',
  imports: [DatePipe, FormsModule, IconComponent, StockEntryComponent, StockHistoryComponent, StockFileComponent, AddStockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-fade inv">
      @if (loading()) {
        <div class="card card-pad inv-skel" aria-hidden="true"><div></div><div></div><div></div></div>
      } @else if (loadError()) {
        <div class="card card-pad inv-error" role="alert">
          <span>{{ t('inv.loadError') }}</span>
          <button type="button" class="btn btn-outline btn-sm" (click)="init()">{{ t('common.retry') }}</button>
        </div>
      } @else if (!enabled()) {
        <!-- Not switched on yet -->
        <div class="card card-pad inv-activate">
          <div class="inv-activate-icon"><ap-icon name="cube" [size]="22"/></div>
          <h2 class="card-title">{{ t('inv.off.title') }}</h2>
          <p class="muted">{{ t('inv.off.body') }}</p>
          <ul class="inv-activate-list">
            @for (loc of locations(); track loc.id) {
              <li><ap-icon name="store" [size]="13"/> {{ loc.name }}</li>
            }
          </ul>
          @if (canActivate()) {
            <button type="button" class="btn btn-primary" (click)="activate()" [disabled]="activating()">
              {{ activating() ? t('common.saving') : t('inv.off.activate') }}
            </button>
            <p class="muted small">{{ t('inv.off.hint') }}</p>
          } @else {
            <p class="inv-note">{{ t('inv.off.askOwner') }}</p>
          }
        </div>
        <!-- Stock files work on the single shared number until the switch is on. -->
        <ap-stock-file [enabled]="false" [locations]="locations()" [units]="units()"/>
      } @else {
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" [class.active]="tab() === 'stock'" [attr.aria-selected]="tab() === 'stock'" (click)="setTab('stock')">{{ t('inv.tab.stock') }}</button>
          <button class="tab" role="tab" [class.active]="tab() === 'receive'" [attr.aria-selected]="tab() === 'receive'" (click)="setTab('receive')">{{ t('inv.tab.receive') }}</button>
          <button class="tab" role="tab" [class.active]="tab() === 'transfer'" [attr.aria-selected]="tab() === 'transfer'" (click)="setTab('transfer')">{{ t('inv.tab.transfer') }}</button>
          <button class="tab" role="tab" [class.active]="tab() === 'history'" [attr.aria-selected]="tab() === 'history'" (click)="setTab('history')">{{ t('inv.tab.history') }}</button>
        </div>

        @if (tab() === 'stock') {
          <div class="card inv-card">
            <div class="inv-filters">
              <div class="inv-search">
                <ap-icon name="search" [size]="14"/>
                <input class="inp" [placeholder]="t('inv.searchPlaceholder')" dir="auto"
                       [ngModel]="search()" (ngModelChange)="onSearch($event)" [attr.aria-label]="t('inv.searchPlaceholder')"/>
              </div>
              <select class="inp inv-loc" [ngModel]="filterLocation()" (ngModelChange)="setFilterLocation($event)" [attr.aria-label]="t('inv.filter.location')">
                <option value="">{{ t('inv.filter.allLocations') }}</option>
                @for (loc of locations(); track loc.id) { <option [value]="loc.id">{{ loc.name }}</option> }
              </select>
              <div class="inv-chips" role="group" [attr.aria-label]="t('inv.filter.state')">
                <button type="button" class="chip" [class.active]="state() === ''" (click)="setState('')">{{ t('inv.filter.all') }}</button>
                <button type="button" class="chip" [class.active]="state() === 'low'" (click)="setState('low')">{{ t('inv.filter.low') }}</button>
                <button type="button" class="chip" [class.active]="state() === 'out'" (click)="setState('out')">{{ t('inv.filter.out') }}</button>
              </div>
              <span class="muted small inv-count">{{ t('inv.count').replace('{n}', '' + totalRows()) }}</span>
              <button type="button" class="btn btn-outline btn-sm" (click)="exportStock()" [disabled]="exporting() || !totalRows()">
                <ap-icon name="download" [size]="12"/> {{ exporting() ? t('common.loading') : t('inv.export') }}
              </button>
            </div>

            <div class="inv-table-wrap">
              <table class="tbl inv-table">
                <thead>
                  <tr>
                    <th class="inv-sticky">{{ t('inv.col.item') }}</th>
                    @for (loc of locations(); track loc.id) {
                      <th class="num" [class.inv-focus]="filterLocation() === loc.id">{{ loc.name }}</th>
                    }
                    <th class="num" [attr.title]="t('inv.col.heldHelp')">{{ t('inv.col.held') }}</th>
                    <th class="num">{{ t('inv.col.sellable') }}</th>
                    <th><span class="sr-only">{{ t('inv.col.actions') }}</span></th>
                  </tr>
                </thead>
                <tbody>
                  @if (tableLoading() && !rows().length) {
                    @for (i of [1, 2, 3, 4, 5]; track i) {
                      <tr class="inv-skel-row" aria-hidden="true"><td [attr.colspan]="locations().length + 4"><div></div></td></tr>
                    }
                  }
                  @for (row of rows(); track row.variantId; let i = $index) {
                    <tr [class.inv-group-start]="i === 0 || rows()[i - 1].productId !== row.productId">
                      <td class="inv-sticky">
                        @if (i === 0 || rows()[i - 1].productId !== row.productId) {
                          <div class="inv-name">{{ row.productName }}</div>
                        }
                        <div class="inv-variant">{{ variantLabel(row) }} <span class="muted" dir="ltr">{{ row.sku }}</span></div>
                      </td>
                      @for (loc of locations(); track loc.id) {
                        <td class="num" [class.inv-focus]="filterLocation() === loc.id">
                          <span class="inv-qty" [class.zero]="!qty(row, loc.id)" [class.low]="isLow(qty(row, loc.id))">{{ qty(row, loc.id) || '–' }}</span>
                        </td>
                      }
                      <td class="num">
                        @if (row.held) { <span class="inv-held" [attr.title]="t('inv.col.heldHelp')">{{ row.held }}</span> } @else { <span class="inv-qty zero">–</span> }
                      </td>
                      <td class="num"><strong>{{ row.total }}</strong></td>
                      <td class="inv-actions">
                        <button type="button" class="btn btn-ghost btn-sm" (click)="startReceive(row)">
                          <ap-icon name="plus" [size]="12"/> {{ t('inv.action.add') }}
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="startTransfer(row)">
                          <ap-icon name="sync" [size]="12"/> {{ t('inv.action.move') }}
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="openRemove(row)">
                          {{ t('inv.action.remove') }}
                        </button>
                      </td>
                    </tr>
                  }
                  @if (!tableLoading() && !rows().length) {
                    <tr><td [attr.colspan]="locations().length + 4">
                      <div class="inv-empty">{{ search() || state() ? t('inv.emptyFiltered') : t('inv.empty') }}</div>
                    </td></tr>
                  }
                </tbody>
              </table>
            </div>
            @if (rows().length < totalRows()) {
              <div class="inv-more">
                <button type="button" class="btn btn-outline btn-sm" (click)="loadMore()" [disabled]="tableLoading()">
                  {{ tableLoading() ? t('common.loading') : t('inv.loadMore') }}
                </button>
              </div>
            }
          </div>
        }

        @if (tab() === 'receive') {
          <ap-add-stock [locations]="locations()" [units]="units()" [preset]="preset()" [presetLocationId]="presetLocation()"
                        [initialMethod]="initialMethod()" (saved)="onStockAdded()" (viewHistory)="setTab('history')"/>
        }

        @if (tab() === 'history') {
          <ap-stock-history [locations]="locations()"/>
        }

        @if (tab() === 'transfer') {
          <ap-stock-entry mode="transfer" [locations]="locations()" [preset]="preset()" [presetLocationId]="presetLocation()" (done)="onEntryDone()"/>

          <div class="card card-pad inv-history">
            <div class="card-title">{{ t('inv.history.title') }}</div>
            @if (!transfers().length) {
              <div class="muted small">{{ t('inv.history.empty') }}</div>
            }
            @for (tr of transfers(); track tr.transferId) {
              <details class="inv-transfer">
                <summary>
                  <span class="inv-route">{{ tr.from }} → {{ tr.to }}</span>
                  <span class="muted small">{{ t('inv.history.units').replace('{n}', '' + tr.unitCount) }}</span>
                  <span class="muted small">{{ tr.createdAt | date: 'd MMM, HH:mm' }}{{ tr.createdByName ? ' · ' + tr.createdByName : '' }}</span>
                </summary>
                <ul>
                  @for (line of tr.lines; track line.sku) {
                    <li>{{ line.productName }} · {{ lineLabel(line) }} <span class="muted" dir="ltr">{{ line.sku }}</span> <strong>× {{ line.quantity }}</strong></li>
                  }
                </ul>
                @if (tr.note) { <div class="muted small">{{ tr.note }}</div> }
              </details>
            }
          </div>
        }
      }
    </div>

    <!-- Remove stock (damaged, lost, ...) -->
    @if (removing(); as row) {
      <div class="overlay" (click)="closeRemove()"></div>
      <div class="inv-dialog" role="dialog" aria-modal="true" [attr.aria-label]="t('inv.remove.title')" (keydown.escape)="closeRemove()">
        <div class="card-title">{{ t('inv.remove.title') }}</div>
        <div class="muted small">{{ row.productName }} · {{ variantLabel(row) }}</div>
        <label class="lbl" for="rm-loc">{{ t('inv.entry.location') }}</label>
        <select id="rm-loc" class="inp" [ngModel]="removeLocation()" (ngModelChange)="removeLocation.set($event)">
          @for (loc of locations(); track loc.id) {
            <option [value]="loc.id">{{ loc.name }} ({{ qty(row, loc.id) }})</option>
          }
        </select>
        <label class="lbl" for="rm-qty">{{ t('inv.entry.quantity') }}</label>
        <input id="rm-qty" class="inp" type="number" min="1" [max]="qty(row, removeLocation())" inputmode="numeric"
               [ngModel]="removeQty()" (ngModelChange)="removeQty.set(+$event)"
               [class.inp-error]="removeQty() > qty(row, removeLocation())"/>
        @if (removeQty() > qty(row, removeLocation())) {
          <div class="inp-msg-error">{{ t('inv.remove.tooMany').replace('{n}', '' + qty(row, removeLocation())) }}</div>
        }
        <label class="lbl" for="rm-reason">{{ t('inv.entry.reason') }}</label>
        <select id="rm-reason" class="inp" [ngModel]="removeReason()" (ngModelChange)="removeReason.set($event)">
          @for (r of removeReasons; track r) { <option [value]="r">{{ t('inv.reason.' + r) }}</option> }
        </select>
        <label class="lbl" for="rm-note">{{ t('inv.entry.note') }}</label>
        <input id="rm-note" class="inp" maxlength="300" [ngModel]="removeNote()" (ngModelChange)="removeNote.set($event)"/>
        <div class="inv-dialog-actions">
          <button type="button" class="btn btn-outline" (click)="closeRemove()">{{ t('common.cancel') }}</button>
          <button type="button" class="btn btn-danger" (click)="confirmRemove()" [disabled]="!canRemove()">
            {{ removingBusy() ? t('common.saving') : t('inv.remove.confirm').replace('{n}', '' + removeQty()) }}
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    .inv { display: grid; gap: 16px; }
    .inv-skel { display: grid; gap: 12px; }
    .inv-skel div { height: 18px; border-radius: 6px; background: var(--border-2); }
    .inv-skel div:first-child { width: 40%; height: 26px; }
    .inv-error { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .inv-activate { max-width: 620px; display: grid; gap: 12px; justify-items: start; }
    .inv-activate-icon { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: var(--gold-3); color: var(--green); }
    .inv-activate p { margin: 0; max-width: 60ch; line-height: 1.6; }
    .inv-activate-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
    .inv-activate-list li { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; font-size: 12px; }
    .inv-note { padding: 10px 12px; border-radius: 10px; background: var(--info-bg); font-size: 13px; margin: 0; }
    .inv-card { overflow: hidden; }
    .inv-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .inv-search { position: relative; flex: 1 1 260px; }
    .inv-search ap-icon { position: absolute; inset-inline-start: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); }
    .inv-search .inp { padding-inline-start: 34px; }
    .inv-loc { width: auto; min-width: 170px; }
    .inv-chips { display: flex; gap: 6px; }
    .inv-count { margin-inline-start: auto; }
    .inv-table-wrap { overflow-x: auto; }
    .inv-table th.num, .inv-table td.num { text-align: end; width: 1%; white-space: nowrap; }
    .inv-table th { cursor: default; }
    .inv-table td { padding-top: 10px; padding-bottom: 10px; }
    .inv-sticky { position: sticky; inset-inline-start: 0; background: var(--surface); z-index: 1; min-width: 240px; }
    .inv-table th.inv-sticky { background: var(--bg); }
    .inv-group-start td { border-top: 1px solid var(--border); }
    .inv-name { font-weight: 600; color: var(--ink); margin-bottom: 2px; }
    .inv-variant { font-size: 12px; color: var(--ink-2); }
    .inv-variant .muted { font-size: 11px; margin-inline-start: 6px; }
    .inv-qty { font-variant-numeric: tabular-nums; font-weight: 600; }
    .inv-qty.zero { color: var(--muted-2); font-weight: 400; }
    .inv-qty.low { color: #b45309; }
    .inv-focus { background: var(--gold-3); }
    .inv-held { display: inline-block; min-width: 22px; padding: 2px 8px; border-radius: 999px; background: var(--info-bg); color: var(--info); font-size: 11px; font-weight: 600; text-align: center; }
    .inv-actions { white-space: nowrap; text-align: end; }
    .inv-actions .btn { opacity: .55; transition: opacity .15s; }
    tr:hover .inv-actions .btn, .inv-actions .btn:focus-visible { opacity: 1; }
    .inv-empty { padding: 32px 0; text-align: center; color: var(--muted); }
    .inv-more { display: flex; justify-content: center; padding: 14px; border-top: 1px solid var(--border-2); }
    .inv-skel-row div { height: 14px; border-radius: 4px; background: var(--border-2); }
    .inv-history { display: grid; gap: 8px; }
    .inv-transfer { border: 1px solid var(--border-2); border-radius: 10px; padding: 10px 14px; }
    .inv-transfer summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; cursor: pointer; list-style: none; }
    .inv-transfer summary::-webkit-details-marker { display: none; }
    .inv-route { font-weight: 600; }
    .inv-transfer ul { margin: 10px 0 4px; padding-inline-start: 18px; font-size: 13px; display: grid; gap: 4px; }
    .inv-dialog {
      position: fixed; z-index: 1001; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: min(420px, calc(100vw - 32px));
      background: var(--surface); border-radius: 14px; box-shadow: var(--shadow-lg);
      padding: 20px; display: grid; gap: 8px;
    }
    .inv-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
    .inv-dialog-actions .btn { white-space: nowrap; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    @media (max-width: 640px) {
      .inv-count { margin-inline-start: 0; }
      .inv-actions .btn { opacity: 1; }
    }
  `],
})
export class InventoryComponent implements OnInit {
  private readonly api = inject(InventoryService);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmService);
  private readonly storeConfig = inject(StoreConfigService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly t = (k: string): string => this.i18n.t(k);
  readonly removeReasons = REMOVE_REASONS;

  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly enabled = signal(false);
  readonly locations = signal<StockLocation[]>([]);
  readonly units = signal<Record<string, number>>({});
  readonly activating = signal(false);
  readonly canActivate = computed(() => this.auth.hasRole('owner', 'admin'));

  readonly tab = signal<Tab>('stock');
  readonly search = signal('');
  readonly filterLocation = signal('');
  readonly state = signal<StateFilter>('');
  readonly rows = signal<StockRow[]>([]);
  readonly totalRows = signal(0);
  readonly tableLoading = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private loadSeq = 0;

  readonly exporting = signal(false);

  /** Every row matching the current filters, one column per location. */
  async exportStock(): Promise<void> {
    this.exporting.set(true);
    try {
      const all: StockRow[] = [];
      for (let offset = 0; ; offset += 200) {
        const page = await this.api.listStock({
          search: this.search().trim(), locationId: this.filterLocation() || undefined, state: this.state(),
          lowThreshold: this.storeConfig.lowStockThreshold(), limit: 200, offset,
        });
        all.push(...page.items);
        if (all.length >= page.total || !page.items.length) break;
      }
      const locations = this.locations();
      downloadCsv(`stock-by-location-${todayStamp()}.csv`, [
        ['Product', 'Color', 'Size', 'SKU', 'Barcode', ...locations.map((l) => l.name), 'Held online', 'Available to sell'],
        ...all.map((row) => [
          row.productName, row.color ?? '', row.size ?? '', row.sku, row.barcode ?? '',
          ...locations.map((l) => row.byLocation[l.id] ?? 0), row.held, row.total,
        ]),
      ]);
    } catch (err) {
      this.toast.errorFrom(err, this.t('inv.exportFailed'));
    } finally {
      this.exporting.set(false);
    }
  }

  readonly preset = signal<StockRow | null>(null);
  readonly presetLocation = signal<string | null>(null);
  readonly initialMethod = signal<AddMethod | null>(null);
  readonly transfers = signal<TransferSummary[]>([]);

  readonly removing = signal<StockRow | null>(null);
  readonly removeLocation = signal('');
  readonly removeQty = signal(1);
  readonly removeReason = signal<AdjustmentReason>('damaged');
  readonly removeNote = signal('');
  readonly removingBusy = signal(false);
  readonly canRemove = computed(() => {
    const row = this.removing();
    return !!row && !this.removingBusy() && this.removeQty() >= 1 && this.removeQty() <= this.qty(row, this.removeLocation());
  });

  ngOnInit(): void {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab === 'receive' || tab === 'transfer' || tab === 'history') this.tab.set(tab);
    // Old links to the separate "Update from file" tab open Add stock → Upload a sheet.
    if (tab === 'file') { this.tab.set('receive'); this.initialMethod.set('file'); }
    if (this.route.snapshot.queryParamMap.get('method') === 'file') this.initialMethod.set('file');
    void this.init();
  }

  async init(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(false);
    try {
      const status = await this.api.perLocationStatus();
      this.enabled.set(status?.enabled === true);
      this.locations.set(Array.isArray(status?.locations) ? status.locations : []);
      this.units.set(status?.units && typeof status.units === 'object' ? status.units : {});
      if (status.enabled) {
        void this.loadRows(true);
        if (this.tab() === 'transfer') void this.loadTransfers();
      }
    } catch {
      this.loadError.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async activate(): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.t('inv.off.confirmTitle'),
      message: this.t('inv.off.confirmBody'),
      confirmLabel: this.t('inv.off.activate'),
    });
    if (!ok) return;
    this.activating.set(true);
    try {
      const res = await this.api.activatePerLocation();
      this.toast.success(this.t('inv.off.activated'), this.t('inv.off.activatedSub').replace('{n}', String(res.seeded)));
      await this.init();
    } catch (err) {
      this.toast.errorFrom(err, this.t('inv.off.activateFailed'));
    } finally {
      this.activating.set(false);
    }
  }

  /** After stock was added: fresh unit counts for the location cards. */
  async onStockAdded(): Promise<void> {
    this.preset.set(null);
    try {
      const status = await this.api.perLocationStatus();
      this.units.set(status?.units && typeof status.units === 'object' ? status.units : {});
    } catch { /* the counts refresh on the next visit */ }
  }

  setTab(tab: Tab): void {
    this.tab.set(tab);
    this.preset.set(null);
    void this.router.navigate([], { queryParams: { tab: tab === 'stock' ? null : tab }, queryParamsHandling: 'merge', replaceUrl: true });
    if (tab === 'transfer') void this.loadTransfers();
    if (tab === 'stock') void this.loadRows(true);
  }

  // ── Stock table ─────────────────────────────────────────────────────────

  onSearch(value: string): void {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.loadRows(true), 250);
  }
  setFilterLocation(id: string): void { this.filterLocation.set(id); void this.loadRows(true); }
  setState(state: StateFilter): void { this.state.set(state); void this.loadRows(true); }
  loadMore(): void { void this.loadRows(false); }

  private async loadRows(reset: boolean): Promise<void> {
    const seq = ++this.loadSeq;
    this.tableLoading.set(true);
    try {
      const page = await this.api.listStock({
        search: this.search().trim(),
        locationId: this.filterLocation() || undefined,
        state: this.state(),
        lowThreshold: this.storeConfig.lowStockThreshold(),
        limit: PAGE,
        offset: reset ? 0 : this.rows().length,
      });
      if (seq !== this.loadSeq) return;
      this.rows.set(reset ? page.items : [...this.rows(), ...page.items]);
      this.totalRows.set(page.total);
    } catch (err) {
      if (seq === this.loadSeq) this.toast.errorFrom(err, this.t('inv.loadError'));
    } finally {
      if (seq === this.loadSeq) this.tableLoading.set(false);
    }
  }

  qty(row: StockRow, locationId: string): number { return row.byLocation[locationId] ?? 0; }
  lineLabel(line: { color: string | null; size: string | null }): string {
    return [line.color, line.size].filter(Boolean).join(' · ');
  }
  isLow(qty: number): boolean { return qty > 0 && qty <= this.storeConfig.lowStockThreshold(); }
  variantLabel(row: StockRow): string {
    return [row.color, row.size].filter(Boolean).join(' · ') || this.t('inv.noVariantLabel');
  }

  // ── Row actions ─────────────────────────────────────────────────────────

  startReceive(row: StockRow): void {
    this.setTab('receive');
    this.presetLocation.set(this.filterLocation() || null);
    this.preset.set({ ...row });
  }

  startTransfer(row: StockRow): void {
    this.setTab('transfer');
    // Default source: the filtered location if any, otherwise wherever it has the most.
    const best = Object.entries(row.byLocation).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;
    this.presetLocation.set(this.filterLocation() || best);
    this.preset.set({ ...row });
  }

  openRemove(row: StockRow): void {
    const best = this.filterLocation() && this.qty(row, this.filterLocation()) > 0
      ? this.filterLocation()
      : Object.entries(row.byLocation).sort(([, a], [, b]) => b - a)[0]?.[0] ?? this.locations()[0]?.id ?? '';
    this.removeLocation.set(best);
    this.removeQty.set(1);
    this.removeReason.set('damaged');
    this.removeNote.set('');
    this.removing.set(row);
  }
  closeRemove(): void { if (!this.removingBusy()) this.removing.set(null); }

  async confirmRemove(): Promise<void> {
    const row = this.removing();
    if (!row || !this.canRemove()) return;
    this.removingBusy.set(true);
    try {
      await this.api.adjust({
        variantId: row.variantId,
        delta: -this.removeQty(),
        reason: this.removeReason(),
        note: this.removeNote().trim() || undefined,
        locationId: this.removeLocation(),
      });
      this.toast.success(this.t('inv.remove.done'), `${row.productName} · ${this.variantLabel(row)}`);
      this.removing.set(null);
      await this.loadRows(true);
    } catch (err) {
      this.toast.errorFrom(err, this.t('inv.remove.failed'));
    } finally {
      this.removingBusy.set(false);
    }
  }

  onEntryDone(): void {
    this.preset.set(null);
    if (this.tab() === 'transfer') void this.loadTransfers();
  }

  private async loadTransfers(): Promise<void> {
    try {
      this.transfers.set(await this.api.listTransfers());
    } catch { /* history is secondary; the form still works */ }
  }
}
