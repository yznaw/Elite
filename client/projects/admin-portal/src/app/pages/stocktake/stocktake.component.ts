import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
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
import { buildAllLocationsSheet, buildLocationSheet, csvRows, parseStocktakeCountCsv } from '../../utils/stocktake-csv';
import { CountAutosave, RowSaveState, parseCount } from '../../utils/stocktake-autosave';

/**
 * Stocktake: count the shelf, post the difference (docs/25 Phase 8).
 *
 * Before this, the only way to correct a stock number was to type over it in
 * the catalogue — which Phase 1 turned into a logged `catalog_edit` with no
 * reason attached. "Someone changed it" is not an explanation. A stocktake
 * produces the same correction with the count, the discrepancy and the person
 * behind it all recorded.
 *
 * A new stocktake shows the expected quantity by default, as the shop asked.
 * Blind mode (the counter cannot see what the system expects) is still offered:
 * a count taken while looking at the expected figure tends to agree with it.
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
                <option [value]="false">{{ t('stocktake.mode.open') }}</option>
                <option [value]="true">{{ t('stocktake.mode.blind') }}</option>
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
            <button class="btn btn-outline" (click)="exportCsv('location')" [disabled]="!stocktake.lines.length"
                    [title]="t('stocktake.csv.export.location.hint')">
              <ap-icon name="download" [size]="14"/>
              {{ stocktake.locations.length ? t('stocktake.csv.export.location') : t('stocktake.csv.export') }}
            </button>
            @if (stocktake.locations.length > 1) {
              <button class="btn btn-outline" (click)="exportCsv('all')" [disabled]="!stocktake.lines.length"
                      [title]="t('stocktake.csv.export.all.hint')">
                <ap-icon name="download" [size]="14"/> {{ t('stocktake.csv.export.all') }}
              </button>
            }
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
              <!-- Re-created when a switch is cancelled, so the picker shows the
                   location still being counted, not the one that was refused. -->
              @for (rev of [pickerRev()]; track rev) {
                <ap-location-selector
                  [label]="t('stocktake.location.active')"
                  [options]="activeLocationOptions()"
                  [value]="selectedLocationId()"
                  (valueChange)="selectLocation($event)"/>
              }
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

          @if (pendingCount() > 0) {
            <!-- Nothing typed can quietly go missing: this stays until every
                 typed count is stored (or cleared). -->
            <div class="unsaved-bar" role="status">
              <span><b>{{ pendingCount() }}</b> {{ pendingCount() === 1 ? t('stocktake.autosave.pending.one') : t('stocktake.autosave.pending') }}</span>
              <button class="btn btn-gold btn-sm" [disabled]="savingAll()" (click)="saveAll()">
                @if (savingAll()) { <ap-spinner [size]="12"/> }
                {{ t('stocktake.autosave.saveAll') }}
              </button>
            </div>
          }

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
                  <!-- Enter saves and moves to the next row; leaving the field
                       saves too. The row says whether it is stored. -->
                  <input class="inp count-field" type="text" inputmode="numeric" autocomplete="off"
                         [attr.data-variant]="line.variantId"
                         [attr.aria-label]="t('stocktake.count.aria').replace('{item}', line.productName + ' ' + (line.variant || line.sku))"
                         [attr.aria-invalid]="rowState(line.variantId) === 'invalid' || rowState(line.variantId) === 'error'"
                         [ngModel]="draft(line.variantId) ?? ''"
                         (ngModelChange)="setDraft(line.variantId, $event)"
                         (keydown.enter)="commitAndNext(line.variantId, $event)"
                         (change)="commit(line.variantId)"
                         [disabled]="!canEditSelectedLocation()"
                         [placeholder]="t('stocktake.enterCount')"/>
                  <span class="row-state" [class]="'row-state row-state--' + (rowState(line.variantId) ?? 'idle')" aria-live="polite">
                    @switch (rowState(line.variantId)) {
                      @case ('unsaved') { {{ t('stocktake.autosave.unsaved') }} }
                      @case ('invalid') { {{ t('stocktake.autosave.invalid') }} }
                      @case ('saving') { <ap-spinner [size]="11"/> {{ t('stocktake.autosave.saving') }} }
                      @case ('saved') { ✓ {{ t('stocktake.autosave.saved') }} }
                      @case ('error') { {{ t('stocktake.autosave.error') }} }
                    }
                  </span>
                  @if (rowState(line.variantId) === 'error' || rowState(line.variantId) === 'unsaved') {
                    <button class="btn btn-outline btn-sm" [disabled]="!canEditSelectedLocation()" (click)="commit(line.variantId)">
                      {{ rowState(line.variantId) === 'error' ? t('stocktake.autosave.retry') : (locationCount(line) === null ? t('stocktake.save') : t('stocktake.recount.action')) }}
                    </button>
                  }
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
    .row-state { min-width: 92px; font-size: 12px; display: inline-flex; gap: 5px; align-items: center; }
    .row-state--unsaved { color: #8a5a00; }
    .row-state--invalid, .row-state--error { color: #b3261e; font-weight: 600; }
    .row-state--saving { color: var(--muted); }
    .row-state--saved { color: #0f7b3f; }
    .unsaved-bar {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 20px; background: #fff7e6; border-bottom: 1px solid #f1d9a8; font-size: 13px;
    }
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
export class StocktakeComponent implements OnInit, OnDestroy {
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
  readonly scanning = signal(false);
  readonly importing = signal(false);
  readonly fillingZeros = signal(false);

  readonly newReference = signal('');
  // The shop counts against the expected figure by default (their request,
  // 2026-09-23); Blind stays one pick away in the same dropdown.
  readonly newBlind = signal(false);
  readonly filter = signal('');
  readonly scanCode = signal('');
  /** Bumped on every autosave change so the template and computeds refresh. */
  private readonly autosaveTick = signal(0);
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  readonly savingAll = signal(false);
  /** Every count typed on this screen goes through here (see stocktake-autosave.ts). */
  private readonly autosave = new CountAutosave({
    save: (variantId, quantity) => this.persistCount(variantId, quantity),
    onChange: () => this.autosaveTick.update((n) => n + 1),
  });
  readonly pendingCount = computed(() => { this.autosaveTick(); return this.autosave.pendingCount(); });

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

  readonly pickerRev = signal(0);

  async selectLocation(locationId: string): Promise<void> {
    if (locationId === this.selectedLocationId()) return;
    if (!(await this.ensureSaved())) {
      this.pickerRev.update((n) => n + 1);
      return;
    }
    this.selectedLocationId.set(locationId);
    this.autosave.reset();
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

  draft(variantId: string): string | undefined {
    this.autosaveTick();
    return this.autosave.draft(variantId);
  }

  rowState(variantId: string): RowSaveState | undefined {
    this.autosaveTick();
    return this.autosave.state(variantId);
  }

  setDraft(variantId: string, value: string | number | null): void {
    this.autosave.setDraft(variantId, value);
  }

  commit(variantId: string): void {
    if (!this.canEditSelectedLocation()) return;
    void this.autosave.commit(variantId);
  }

  /** Enter saves the row and moves to the next count box (fast counting). */
  commitAndNext(variantId: string, event: Event): void {
    event.preventDefault();
    this.commit(variantId);
    const fields = [...document.querySelectorAll<HTMLInputElement>('input.count-field')];
    const index = fields.findIndex((field) => field.dataset['variant'] === variantId);
    fields[index + 1]?.focus();
  }

  async saveAll(): Promise<boolean> {
    this.savingAll.set(true);
    try {
      const result = await this.autosave.saveAll();
      if (result.failed || result.invalid) {
        this.toast.warning(this.t('stocktake.autosave.notAllSaved'),
          this.t('stocktake.autosave.notAllSaved.sub').replace('{count}', String(result.failed + result.invalid)));
      }
      return !this.autosave.hasPending();
    } finally {
      this.savingAll.set(false);
    }
  }

  /**
   * Before anything that reads or replaces saved counts (export, import,
   * switching location, leaving): offer to save what is typed. Resolves true
   * when it is safe to continue.
   */
  async ensureSaved(): Promise<boolean> {
    await this.autosave.settle();
    const pending = this.autosave.pendingCount();
    if (!pending) return true;
    const saveFirst = await this.confirm.ask({
      title: this.t('stocktake.autosave.guard.title'),
      message: this.t(pending === 1 ? 'stocktake.autosave.guard.message.one' : 'stocktake.autosave.guard.message').replace('{count}', String(pending)),
      confirmLabel: this.t('stocktake.autosave.guard.save'),
      cancelLabel: this.t('common.cancel'),
      variant: 'warning',
    });
    return saveFirst ? this.saveAll() : false;
  }

  /** Route guard hook (app.routes.ts): typed counts are never left behind silently. */
  canLeave(): boolean | Promise<boolean> {
    return this.autosave.hasPending() ? this.ensureSaved() : true;
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.autosave.hasPending()) event.preventDefault();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  /** One count to the server, reflected on screen at once, list refreshed once per burst. */
  private async persistCount(variantId: string, quantity: number): Promise<void> {
    const stocktake = this.active();
    if (!stocktake) throw new Error('No open stocktake.');
    const locationId = this.selectedLocationId() || undefined;
    await this.api.saveCount(stocktake.stocktakeId, variantId, quantity, locationId);
    // Update the row now: a second scan before the refresh must build on this count.
    this.active.update((current) => current && current.stocktakeId === stocktake.stocktakeId ? {
      ...current,
      lines: current.lines.map((line) => line.variantId !== variantId ? line : locationId
        ? { ...line, locationCounts: { ...line.locationCounts, [locationId]: quantity } }
        : line.countedQuantity === null ? { ...line, countedQuantity: quantity } : { ...line, recountQuantity: quantity }),
    } : current);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refreshActive(), 400);
  }

  private async refreshActive(): Promise<void> {
    const stocktake = this.active();
    if (!stocktake) return;
    try {
      this.active.set(await this.api.getStocktake(stocktake.stocktakeId));
    } catch {
      // Reported by the interceptor; the locally applied counts stay visible.
    }
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

  async completeLocation(): Promise<void> {
    if (!(await this.ensureSaved())) return;
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
    if (!(await this.ensureSaved())) return;
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

    // Builds on whatever is typed or already saved for this row, then goes
    // through the same autosave as typing, so rapid scans never collide.
    const current = parseCount(this.autosave.draft(line.variantId)) ?? this.locationCount(line) ?? 0;
    this.autosave.setDraft(line.variantId, current + 1);
    this.scanCode.set('');
    this.scanning.set(true);
    try {
      await this.autosave.commit(line.variantId);
    } finally {
      this.scanning.set(false);
    }
  }

  /**
   * "location": the selected location's sheet, with its SAVED counts (and
   * Expected when not blind); it imports back unchanged. "all": every
   * location side by side with a total, for review only.
   */
  async exportCsv(kind: 'location' | 'all'): Promise<void> {
    if (!(await this.ensureSaved())) return;
    const stocktake = this.active();
    if (!stocktake) return;
    const showExpected = !(stocktake.blind && stocktake.status === 'counting');
    const location = kind === 'location' ? this.selectedLocation() : null;
    const rows = kind === 'all'
      ? buildAllLocationsSheet(stocktake.lines, stocktake.locations, showExpected)
      : buildLocationSheet(stocktake.lines, location, showExpected);
    const url = URL.createObjectURL(new Blob([csvRows(rows)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    const scope = kind === 'all' ? '-all-locations' : location ? `-${location.name}` : '';
    const safeName = `${stocktake.reference}${scope}`.replace(/[^a-z0-9\u0600-\u06ff._-]+/gi, '-');
    link.download = `stocktake-${safeName}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async importCounts(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.importing() || !this.canEditSelectedLocation()) return;
    if (!(await this.ensureSaved())) return;
    const stocktake = this.active();
    if (!stocktake) return;

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
      let unchanged = 0;
      let skipped = parsed.skipped;
      for (const count of parsed.counts) {
        const line = byKey.get(count.barcode.toLowerCase()) ?? byKey.get(count.sku.toLowerCase());
        if (!line) {
          skipped++;
          continue;
        }
        // Re-importing an exported sheet must not rewrite counts that did not
        // change (or record them as a recount).
        if (this.locationCount(line) === count.quantity) {
          unchanged++;
          continue;
        }
        await this.api.saveCount(stocktake.stocktakeId, line.variantId, count.quantity, this.selectedLocationId() || undefined);
        updated++;
      }
      if (updated === 0 && unchanged === 0) throw new Error(this.t('stocktake.csv.import.noMatch'));
      this.active.set(await this.api.getStocktake(stocktake.stocktakeId));
      this.toast.success(this.t('stocktake.csv.import.done'), this.t('stocktake.csv.import.summary')
        .replace('{updated}', String(updated)).replace('{unchanged}', String(unchanged)).replace('{skipped}', String(skipped)));
    } catch (error) {
      this.toast.warningFrom(error, this.t('stocktake.csv.import.failed'), error instanceof Error ? error.message : this.t('stocktake.csv.import.failed.sub'));
    } finally {
      this.importing.set(false);
    }
  }

  async post(): Promise<void> {
    if (!(await this.ensureSaved())) return;
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
