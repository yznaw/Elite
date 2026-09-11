import { Component, OnInit, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import {
  InventoryService,
  StocktakeDetail,
  StocktakeLocation,
  StocktakeStatus,
  StocktakeSummary,
} from '../../services/inventory.service';
import { LocationSelectorComponent, LocationOption } from '../../shared/location-selector/location-selector.component';
import { csvRows, parseStocktakeCountCsv } from '../../utils/stocktake-csv';

/**
 * Stocktake: count the shelf, post the difference (docs/25 Phase 8).
 *
 * Before this, the only way to correct a stock number was to type over it in
 * the catalogue — which Phase 1 turned into a logged `catalog_edit` with no
 * reason attached. "Someone changed it" is not an explanation. A stocktake
 * produces the same correction with the count, the discrepancy and the person
 * behind it all recorded.
 *
 * Counting is blind by default: the counter cannot see what the system expects.
 * A count taken while looking at the expected figure tends to agree with it,
 * which makes the exercise worthless.
 */
@Component({
    selector: 'ap-stocktake',
    imports: [CommonModule, DatePipe, FormsModule, IconComponent, PillComponent, SpinnerComponent, LocationSelectorComponent],
    template: `
    <div class="page-fade">
      @if (!active(); as _) {
        <div class="card card-pad mb-24" style="max-width:640px;">
          <div class="card-title mb-8">{{ t('stocktake.start.title') }}</div>
          <div class="card-sub mb-16">{{ t('stocktake.start.sub') }}</div>
          <div class="grid-2">
            <div>
              <label class="lbl">{{ t('stocktake.reference') }}</label>
              <input class="inp" [ngModel]="newReference()" (ngModelChange)="newReference.set($event)"
                     [placeholder]="t('stocktake.reference.placeholder')"/>
            </div>
            <div>
              <label class="lbl">{{ t('stocktake.mode') }}</label>
              <select class="inp" [ngModel]="newBlind()" (ngModelChange)="newBlind.set($event === 'true' || $event === true)">
                <option [value]="true">{{ t('stocktake.mode.blind') }}</option>
                <option [value]="false">{{ t('stocktake.mode.open') }}</option>
              </select>
            </div>
          </div>
          <div class="mt-16">
            <label class="lbl">{{ t('stocktake.locations') }}</label>
            <div class="location-checks">
              @for (location of availableLocations(); track location.locationId) {
                <label class="location-check">
                  <input type="checkbox" [checked]="selectedStartLocations().includes(location.locationId)"
                         (change)="toggleStartLocation(location.locationId, $any($event.target).checked)"/>
                  <span>{{ location.name }}</span>
                  <small class="muted">{{ t('stocktake.location.' + location.type) }}</small>
                </label>
              }
            </div>
            <div class="muted small mt-8">{{ t('stocktake.locations.hint') }}</div>
          </div>
          <div class="muted small mt-8">{{ t('stocktake.mode.hint') }}</div>
          <button class="btn btn-gold mt-16" [disabled]="starting() || !newReference().trim() || !selectedStartLocations().length" (click)="start()">
            @if (starting()) { <ap-spinner [size]="12"/> }
            {{ t('stocktake.start.action') }}
          </button>
        </div>
      }

      @if (active(); as stocktake) {
        <div class="card card-pad mb-24">
          <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
            <div>
              <div class="card-title">{{ stocktake.reference }}</div>
              <div class="card-sub">
                {{ t('stocktake.started') }} {{ stocktake.startedAt | date:'MMM d, y HH:mm' }}
                @if (stocktake.startedByName) { <span> · {{ stocktake.startedByName }}</span> }
              </div>
            </div>
            <div class="row gap-sm" style="align-items:center;">
              <ap-pill [kind]="stocktake.blind ? 'blue' : 'grey'">
                {{ stocktake.blind ? t('stocktake.mode.blind') : t('stocktake.mode.open') }}
              </ap-pill>
              <span class="muted small">{{ countedCount() }} / {{ stocktake.lines.length }} {{ t('stocktake.counted') }}</span>
            </div>
          </div>

          <div class="row gap-sm mt-16" style="flex-wrap:wrap;">
            @if (stocktake.locations.length && stocktake.status === 'counting') {
              <button class="btn btn-gold" [disabled]="posting() || !selectedLocationCompleteReady()" (click)="completeLocation()"
                      [title]="selectedLocationCompleteReady() ? '' : t('stocktake.location.complete.hint')">
                {{ t('stocktake.location.complete') }}
              </button>
            }
            <button class="btn btn-gold" [disabled]="posting() || stocktake.status !== 'review' || countedCount() === 0" (click)="post()"
                    [title]="stocktake.status === 'review' ? '' : t('stocktake.post.hint')">
              @if (posting()) { <ap-spinner [size]="12"/> }
              {{ t('stocktake.post') }}
            </button>
            <button class="btn btn-outline" [disabled]="posting()" (click)="cancel()">{{ t('stocktake.cancel') }}</button>
            <button class="btn btn-outline" (click)="reload()">
              <ap-icon name="sync" [size]="14"/> {{ t('common.refresh') }}
            </button>
            <button class="btn btn-outline" (click)="exportCsv()" [disabled]="!stocktake.lines.length">
              <ap-icon name="download" [size]="14"/> {{ t('stocktake.csv.export') }}
            </button>
            <label class="btn btn-outline" [class.disabled]="importing() || !canEditSelectedLocation()"
                   [title]="canEditSelectedLocation() ? '' : t('stocktake.csv.import.hint')">
              <ap-icon name="upload" [size]="14"/> {{ t('stocktake.csv.import') }}
              <input type="file" accept=".csv,text/csv" hidden [disabled]="importing() || !canEditSelectedLocation()" (change)="importCounts($event)"/>
            </label>
          </div>
          @if (stocktake.status === 'counting') {
            <p class="action-hint mt-8">
              {{ remainingCount() > 0 ? t('stocktake.location.complete.hint') : t('stocktake.post.hint') }}
            </p>
          }

          @if (stocktake.locations.length) {
            <div class="location-toolbar mt-16">
              <ap-location-selector
                [label]="t('stocktake.location.active')"
                [options]="activeLocationOptions()"
                [value]="selectedLocationId()"
                (valueChange)="selectLocation($event)"/>
              <span class="muted small">
                {{ completedLocationCount() }} / {{ stocktake.locations.length }} {{ t('stocktake.locations.completed') }}
              </span>
              @if (selectedLocation()?.status === 'completed' && stocktake.status !== 'posted') {
                <button class="btn btn-outline btn-sm" (click)="reopenLocation()">{{ t('stocktake.location.reopen') }}</button>
              }
            </div>
            <div class="count-progress mt-12" role="status">
              <div>
                <strong>{{ selectedLocation()?.name }}</strong>
                <span>{{ countedCount() }} / {{ stocktake.lines.length }} {{ t('stocktake.counted') }}</span>
              </div>
              @if (remainingCount() > 0 && canEditSelectedLocation()) {
                <span class="muted small">{{ remainingCount() }} {{ t('stocktake.remaining') }}</span>
                <button class="btn btn-outline btn-sm" [disabled]="fillingZeros()" (click)="fillMissingWithZero()">
                  @if (fillingZeros()) { <ap-spinner [size]="12"/> }
                  {{ t('stocktake.fillZero') }}
                </button>
              } @else if (remainingCount() === 0) {
                <span class="ready-text">✓ {{ t('stocktake.location.ready') }}</span>
              }
            </div>
          }

          <div class="row gap-sm mt-16" style="align-items:center;flex-wrap:wrap;">
            <input class="inp" style="max-width:300px;" [ngModel]="scanCode()"
                   (ngModelChange)="scanCode.set($event)" (keydown.enter)="scanBarcode()"
                   [disabled]="!canEditSelectedLocation()" placeholder="Scan barcode or enter SKU" autocomplete="off"/>
            <button class="btn btn-outline" [disabled]="!canEditSelectedLocation() || !scanCode().trim() || scanning()" (click)="scanBarcode()">
              {{ scanning() ? 'Saving…' : 'Scan +1' }}
            </button>
            <span class="muted small">Each scan increases the physical count by one.</span>
          </div>

          @if (disagreements().length) {
            <div class="mt-16" style="padding:12px;border:1px solid var(--pos-orange, #c2703a);">
              <b>{{ t('stocktake.disagreement.title') }}</b>
              <div class="muted small">{{ t('stocktake.disagreement.body') }}</div>
              <div class="mono small mt-8">{{ disagreementSkus() }}</div>
            </div>
          }
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">{{ t('stocktake.lines.title') }}</div>
            <input class="inp" style="width:220px;" [ngModel]="filter()" (ngModelChange)="filter.set($event)"
                   [placeholder]="t('stocktake.filter.placeholder')"/>
          </div>

          @if (loading()) {
            <div class="row gap-sm" style="padding:24px;justify-content:center;">
              <ap-spinner/> <span class="muted small">{{ t('common.loading') }}</span>
            </div>
          } @else {
            @for (line of visibleLines(); track line.variantId) {
              <div class="count-row">
                <div class="count-main">
                  <strong>{{ line.productName }}</strong>
                  <span class="muted small">{{ line.variant || line.sku }} · {{ line.sku }}</span>
                </div>
                <div class="count-figures">
                  @if (line.expectedQuantity !== null) {
                    <span class="muted small">{{ t('stocktake.expected') }} {{ line.expectedQuantity }}</span>
                  }
                  @if (locationCount(line) !== null) {
                    <span class="small">{{ t('stocktake.count') }} {{ locationCount(line) }}</span>
                  }
                  @if (line.recountQuantity !== null) {
                    <span class="small" [class.disagree]="line.recountQuantity !== line.countedQuantity">
                      {{ t('stocktake.recount') }} {{ line.recountQuantity }}
                    </span>
                  }
                  @if (line.discrepancy !== null && line.discrepancy !== 0) {
                    <b [style.color]="line.discrepancy < 0 ? '#b3261e' : '#0f7b3f'">
                      {{ line.discrepancy > 0 ? '+' : '' }}{{ line.discrepancy }}
                    </b>
                  }
                </div>
                <div class="count-input">
                  <input class="inp" type="number" min="0" inputmode="numeric"
                         [ngModel]="draft()[line.variantId] ?? ''"
                         (ngModelChange)="setDraft(line.variantId, $event)"
                         [disabled]="!canEditSelectedLocation()"
                         [placeholder]="t('stocktake.enterCount')"/>
                  <button class="btn btn-outline btn-sm"
                          [disabled]="!canEditSelectedLocation() || saving() === line.variantId || draft()[line.variantId] === undefined || draft()[line.variantId] === ''"
                          (click)="saveCount(line.variantId)">
                    {{ line.countedQuantity === null ? t('stocktake.save') : t('stocktake.recount.action') }}
                  </button>
                </div>
              </div>
            } @empty {
              <div class="muted small" style="text-align:center;padding:32px;">{{ t('stocktake.lines.empty') }}</div>
            }
          }
        </div>
      }

      <div class="card mt-24">
        <div class="card-header">
          <div class="card-title">{{ t('stocktake.history.title') }}</div>
        </div>
        @if (!history().length) {
          <div class="muted small" style="text-align:center;padding:24px;">{{ t('stocktake.history.empty') }}</div>
        } @else {
          @for (row of history(); track row.stocktakeId) {
            <div class="history-row">
              <div>
                <strong>{{ row.reference }}</strong>
                <span class="muted small"> · {{ row.startedAt | date:'MMM d, y' }}</span>
              </div>
              <ap-pill [kind]="statusKind(row.status)">{{ t('stocktake.status.' + row.status) }}</ap-pill>
              <span class="muted small">{{ row.countedCount }} / {{ row.lineCount }}</span>
            </div>
          }
        }
      </div>
    </div>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [`
    .count-row {
      display: grid;
      grid-template-columns: 1.6fr 1.4fr auto;
      gap: 16px;
      align-items: center;
      padding: 12px 20px;
      border-bottom: 1px solid var(--border, #e5e7eb);
    }
    .count-row:last-child { border-bottom: none; }
    .count-main { display: grid; gap: 2px; min-width: 0; }
    .count-figures { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .count-input { display: flex; gap: 8px; align-items: center; }
    .count-input .inp { width: 110px; }
    .disagree { color: #b3261e; font-weight: 600; }
    .history-row {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 12px;
      align-items: center;
      padding: 10px 20px;
      border-bottom: 1px solid var(--border, #e5e7eb);
    }
    .history-row:last-child { border-bottom: none; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .location-checks { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
    .location-check { display:flex; gap:7px; align-items:center; border:1px solid var(--border,#e5e7eb); border-radius:8px; padding:9px 11px; }
    .location-toolbar { display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end; }
    .count-progress {
      display:flex; align-items:center; flex-wrap:wrap; gap:12px;
      padding:12px 14px; border:1px solid var(--border,#e5e7eb); border-radius:10px;
      background:var(--bg,#f8f8f6);
    }
    .count-progress > div { display:flex; gap:8px; align-items:baseline; margin-inline-end:auto; }
    .ready-text { color:#0f7b3f; font-size:13px; font-weight:600; }
    .action-hint { margin-bottom:0; color:var(--muted); font-size:12px; }
    @media (max-width: 900px) {
      .count-row { grid-template-columns: 1fr; }
    }
  `]
})
export class StocktakeComponent implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly api = inject(InventoryService);
  private readonly confirm = inject(ConfirmService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly active = signal<StocktakeDetail | null>(null);
  readonly history = signal<StocktakeSummary[]>([]);
  readonly availableLocations = signal<StocktakeLocation[]>([]);
  readonly selectedStartLocations = signal<string[]>([]);
  readonly selectedLocationId = signal('');
  readonly loading = signal(false);
  readonly starting = signal(false);
  readonly posting = signal(false);
  readonly saving = signal<string | null>(null);
  readonly scanning = signal(false);
  readonly importing = signal(false);
  readonly fillingZeros = signal(false);

  readonly newReference = signal('');
  readonly newBlind = signal(true);
  readonly filter = signal('');
  readonly scanCode = signal('');
  readonly draft = signal<Record<string, string>>({});

  readonly countedCount = computed(() => {
    const stocktake = this.active();
    if (!stocktake) return 0;
    const locationId = this.selectedLocationId();
    return stocktake.locations.length && locationId
      ? stocktake.lines.filter((line) => line.locationCounts[locationId] !== undefined).length
      : stocktake.lines.filter((line) => line.countedQuantity !== null).length;
  });
  readonly activeLocationOptions = computed<LocationOption[]>(() =>
    (this.active()?.locations ?? []).map((location) => ({
      id: location.locationId,
      label: `${location.name} · ${location.countedCount ?? 0}/${this.active()?.lines.length ?? 0}${location.status === 'completed' ? ' ✓' : ''}`,
      kind: location.type,
    })),
  );
  readonly selectedLocation = computed(() =>
    this.active()?.locations.find((location) => location.locationId === this.selectedLocationId()) ?? null,
  );
  readonly completedLocationCount = computed(() =>
    this.active()?.locations.filter((location) => location.status === 'completed').length ?? 0,
  );
  readonly selectedLocationCompleteReady = computed(() =>
    !!this.selectedLocation() && this.selectedLocation()?.status === 'counting'
      && this.countedCount() === (this.active()?.lines.length ?? -1),
  );
  readonly remainingCount = computed(() => Math.max(0, (this.active()?.lines.length ?? 0) - this.countedCount()));

  /** Lines where a recount contradicts the first count. Posting is blocked
   *  until they are resolved: two counts that disagree are a question, not a
   *  result. */
  readonly disagreements = computed(() =>
    (this.active()?.lines ?? []).filter((l) => l.recountQuantity !== null && l.recountQuantity !== l.countedQuantity),
  );
  readonly disagreementSkus = computed(() => this.disagreements().map((l) => l.sku).join(', '));

  readonly visibleLines = computed(() => {
    const term = this.filter().trim().toLowerCase();
    const lines = this.active()?.lines ?? [];
    if (!term) return lines;
    return lines.filter((l) =>
      l.sku.toLowerCase().includes(term)
      || l.productName.toLowerCase().includes(term)
      || l.variant.toLowerCase().includes(term));
  });

  async ngOnInit(): Promise<void> {
    try {
      const locations = await this.api.listStocktakeLocations();
      this.availableLocations.set(locations);
      this.selectedStartLocations.set(locations.map((location) => location.locationId));
    } catch {
      // The interceptor already reported it.
    }
    await this.reload();
  }

  toggleStartLocation(locationId: string, selected: boolean): void {
    const next = new Set(this.selectedStartLocations());
    if (selected) next.add(locationId); else next.delete(locationId);
    this.selectedStartLocations.set([...next]);
  }

  selectLocation(locationId: string): void {
    this.selectedLocationId.set(locationId);
    this.draft.set({});
  }

  canEditSelectedLocation(): boolean {
    const stocktake = this.active();
    if (!stocktake) return false;
    if (!stocktake.locations.length) return stocktake.status === 'counting' || stocktake.status === 'review';
    return stocktake.status === 'counting' && this.selectedLocation()?.status === 'counting';
  }

  locationCount(line: StocktakeDetail['lines'][number]): number | null {
    const locationId = this.selectedLocationId();
    if (locationId && line.locationCounts[locationId] !== undefined) return line.locationCounts[locationId];
    return line.countedQuantity;
  }

  statusKind(status: StocktakeStatus): 'green' | 'amber' | 'grey' | 'blue' {
    if (status === 'posted') return 'green';
    if (status === 'counting') return 'amber';
    if (status === 'review') return 'blue';
    return 'grey';
  }

  setDraft(variantId: string, value: string): void {
    this.draft.set({ ...this.draft(), [variantId]: value });
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const list = await this.api.listStocktakes();
      this.history.set(list);
      const open = list.find((row) => row.status === 'counting' || row.status === 'review');
      const detail = open ? await this.api.getStocktake(open.stocktakeId) : null;
      this.active.set(detail);
      if (detail?.locations.length && !detail.locations.some((location) => location.locationId === this.selectedLocationId())) {
        this.selectedLocationId.set(detail.locations.find((location) => location.status === 'counting')?.locationId ?? detail.locations[0].locationId);
      }
    } catch {
      // The interceptor already reported it.
    } finally {
      this.loading.set(false);
    }
  }

  async start(): Promise<void> {
    this.starting.set(true);
    try {
      await this.api.startStocktake({
        reference: this.newReference().trim(),
        blind: this.newBlind(),
        locationIds: this.selectedStartLocations(),
      });
      this.newReference.set('');
      await this.reload();
      this.toast.success(this.t('stocktake.started.toast'));
    } catch {
      /* reported by the interceptor */
    } finally {
      this.starting.set(false);
    }
  }

  async saveCount(variantId: string): Promise<void> {
    const raw = this.draft()[variantId];
    const quantity = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(quantity) || quantity < 0) {
      this.toast.warning(this.t('stocktake.invalidCount'));
      return;
    }
    const stocktake = this.active();
    if (!stocktake) return;

    this.saving.set(variantId);
    try {
      await this.api.saveCount(stocktake.stocktakeId, variantId, quantity, this.selectedLocationId() || undefined);
      this.draft.set({ ...this.draft(), [variantId]: '' });
      this.active.set(await this.api.getStocktake(stocktake.stocktakeId));
    } catch {
      /* reported by the interceptor */
    } finally {
      this.saving.set(null);
    }
  }

  async completeLocation(): Promise<void> {
    const stocktake = this.active();
    const location = this.selectedLocation();
    if (!stocktake || !location) return;
    this.posting.set(true);
    try {
      const result = await this.api.completeLocation(stocktake.stocktakeId, location.locationId);
      this.active.set(await this.api.getStocktake(stocktake.stocktakeId));
      this.toast.success(
        this.t('stocktake.location.completed.toast'),
        result.allLocationsCompleted ? this.t('stocktake.locations.ready') : undefined,
      );
      const next = this.active()?.locations.find((item) => item.status === 'counting');
      if (next) this.selectLocation(next.locationId);
    } catch {
      /* reported by the interceptor */
    } finally {
      this.posting.set(false);
    }
  }

  async fillMissingWithZero(): Promise<void> {
    const stocktake = this.active();
    const location = this.selectedLocation();
    if (!stocktake || !location || !this.canEditSelectedLocation() || this.remainingCount() === 0) return;
    const confirmed = await this.confirm.ask({
      title: this.t('stocktake.fillZero.confirm.title'),
      message: this.t('stocktake.fillZero.confirm.message')
        .replace('{count}', String(this.remainingCount()))
        .replace('{location}', location.name),
      confirmLabel: this.t('stocktake.fillZero'),
      cancelLabel: this.t('common.cancel'),
      variant: 'warning',
    });
    if (!confirmed) return;

    this.fillingZeros.set(true);
    try {
      const result = await this.api.fillMissingCountsWithZero(stocktake.stocktakeId, location.locationId);
      this.active.set(await this.api.getStocktake(stocktake.stocktakeId));
      this.toast.success(this.t('stocktake.fillZero.toast'), `${result.updatedCount}`);
    } catch {
      /* reported by the interceptor */
    } finally {
      this.fillingZeros.set(false);
    }
  }

  async reopenLocation(): Promise<void> {
    const stocktake = this.active();
    const location = this.selectedLocation();
    if (!stocktake || !location) return;
    this.posting.set(true);
    try {
      await this.api.reopenLocation(stocktake.stocktakeId, location.locationId);
      this.active.set(await this.api.getStocktake(stocktake.stocktakeId));
    } catch {
      /* reported by the interceptor */
    } finally {
      this.posting.set(false);
    }
  }

  async scanBarcode(): Promise<void> {
    const code = this.scanCode().trim().toLowerCase();
    if (!code || this.scanning()) return;
    const stocktake = this.active();
    if (!stocktake) return;
    const line = stocktake.lines.find((item) =>
      item.barcode.toLowerCase() === code || item.sku.toLowerCase() === code,
    );
    if (!line) {
      this.toast.warning('Barcode not found', `No stocktake line matches ${this.scanCode().trim()}.`);
      return;
    }

    const current = Number.parseInt(this.draft()[line.variantId] ?? String(this.locationCount(line) ?? 0), 10) || 0;
    this.draft.set({ ...this.draft(), [line.variantId]: String(current + 1) });
    this.scanning.set(true);
    try {
      await this.api.saveCount(stocktake.stocktakeId, line.variantId, current + 1, this.selectedLocationId() || undefined);
      this.draft.set({ ...this.draft(), [line.variantId]: '' });
      this.active.set(await this.api.getStocktake(stocktake.stocktakeId));
      this.scanCode.set('');
    } catch {
      /* reported by the interceptor */
    } finally {
      this.scanning.set(false);
    }
  }

  exportCsv(): void {
    const stocktake = this.active();
    if (!stocktake) return;
    const location = this.selectedLocation();
    const rows = location
      ? [
          ['Location ID', 'Location', 'SKU', 'Barcode', 'Product', 'Color', 'Size', 'Counted'],
          ...stocktake.lines.map((line) => [
            location.locationId,
            location.name,
            line.sku,
            line.barcode,
            line.productName,
            line.color,
            line.size,
            line.locationCounts[location.locationId] ?? '',
          ]),
        ]
      : [
          ['SKU', 'Barcode', 'Product', 'Color', 'Size', 'Counted'],
          ...stocktake.lines.map((line) => [line.sku, line.barcode, line.productName, line.color, line.size, line.countedQuantity ?? '']),
        ];
    const csv = csvRows(rows);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    const safeName = `${stocktake.reference}${location ? `-${location.name}` : ''}`.replace(/[^a-z0-9\u0600-\u06ff._-]+/gi, '-');
    link.download = `stocktake-${safeName}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async importCounts(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const stocktake = this.active();
    if (!file || !stocktake || this.importing() || !this.canEditSelectedLocation()) return;

    this.importing.set(true);
    try {
      const location = this.selectedLocation();
      const parsed = parseStocktakeCountCsv(await file.text(), {
        locationId: location?.locationId,
        locationName: location?.name,
      });

      const byKey = new Map<string, StocktakeDetail['lines'][number]>();
      for (const line of stocktake.lines) {
        if (line.sku) byKey.set(line.sku.toLowerCase(), line);
        if (line.barcode) byKey.set(line.barcode.toLowerCase(), line);
      }
      let updated = 0;
      let skipped = parsed.skipped;
      for (const count of parsed.counts) {
        const line = byKey.get(count.barcode.toLowerCase()) ?? byKey.get(count.sku.toLowerCase());
        if (!line) {
          skipped++;
          continue;
        }
        await this.api.saveCount(stocktake.stocktakeId, line.variantId, count.quantity, this.selectedLocationId() || undefined);
        updated++;
      }
      if (updated === 0) throw new Error('No valid product counts matched this stocktake.');
      this.active.set(await this.api.getStocktake(stocktake.stocktakeId));
      this.toast.success('Counts imported', `${updated} updated${skipped ? ` · ${skipped} skipped` : ''}`);
    } catch (error) {
      this.toast.warning('Could not import counts', error instanceof Error ? error.message : 'Use a CSV exported from this stocktake.');
    } finally {
      this.importing.set(false);
    }
  }

  async post(): Promise<void> {
    const stocktake = this.active();
    if (!stocktake) return;
    // Only ever sent after the operator has been shown which lines disagree.
    const accept = this.disagreements().length > 0;
    this.posting.set(true);
    try {
      const result = await this.api.post(stocktake.stocktakeId, accept);
      this.toast.success(
        this.t('stocktake.posted.toast'),
        `${result.adjustedLines} / ${result.countedLines}`,
      );
      await this.reload();
    } catch {
      /* reported by the interceptor */
    } finally {
      this.posting.set(false);
    }
  }

  async cancel(): Promise<void> {
    const stocktake = this.active();
    if (!stocktake) return;
    this.posting.set(true);
    try {
      await this.api.cancel(stocktake.stocktakeId);
      await this.reload();
    } catch {
      /* reported by the interceptor */
    } finally {
      this.posting.set(false);
    }
  }
}
