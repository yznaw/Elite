import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, signal } from '@angular/core';
import { inject } from '@angular/core';
import { IconComponent } from '../../shared/icons/icon.component';
import { StockLocation, StockRow } from '../../services/inventory.service';
import { I18nService } from '../../services/i18n.service';
import { StockEntryComponent } from './stock-entry.component';
import { StockFileComponent } from './stock-file.component';

export type AddMethod = 'scan' | 'file';

/**
 * Inventory → Add stock (2026-09-28). One page, three steps:
 *   1. where the stock is (big cards; afterwards a banner that stays on screen),
 *   2. how: scan/search items (the numbers are ADDED) or upload a sheet (the
 *      numbers REPLACE the count),
 *   3. the items, with StockEntryComponent or StockFileComponent.
 * The location is always chosen on purpose here, never remembered, because
 * stock added to the wrong location is the costly mistake.
 */
@Component({
  selector: 'ap-add-stock',
  imports: [IconComponent, StockEntryComponent, StockFileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="as">
      <!-- 1. Where -->
      @if (!location()) {
        <section class="card card-pad as-step">
          <div class="as-step-title"><span class="as-num">1</span>{{ t('inv.add.step1') }}</div>
          <p class="as-help">{{ t('inv.add.pickHint') }}</p>
          <div class="as-locs" role="radiogroup" [attr.aria-label]="t('inv.add.step1')">
            @for (loc of locations; track loc.id) {
              <button type="button" class="as-loc" role="radio" [attr.aria-checked]="false" (click)="pick(loc)">
                <span class="as-loc-icon"><ap-icon [name]="loc.type === 'warehouse' ? 'cube' : 'store'" [size]="20"/></span>
                <span class="as-loc-text">
                  <strong>{{ loc.name }}</strong>
                  <span class="muted small">{{ loc.type === 'warehouse' ? t('inv.file.warehouse') : t('inv.file.store') }}</span>
                  <span class="small as-units">{{ t('inv.file.units').replace('{n}', (units[loc.id] ?? 0).toLocaleString()) }}</span>
                </span>
              </button>
            }
          </div>
        </section>
      } @else {
        <div class="as-banner">
          <span class="as-banner-icon"><ap-icon [name]="location()!.type === 'warehouse' ? 'cube' : 'store'" [size]="20"/></span>
          <div class="as-banner-text">
            <span class="small">{{ t('inv.add.addingTo') }}</span>
            <strong>{{ location()!.name }}</strong>
            <span class="small as-banner-note">{{ t('inv.file.onlyThis').replace('{name}', location()!.name) }}</span>
          </div>
          <button type="button" class="btn btn-sm as-change" (click)="changeLocation()">{{ t('inv.file.change') }}</button>
        </div>

        <!-- 2. How -->
        <section class="card card-pad as-step">
          <div class="as-step-title"><span class="as-num">2</span>{{ t('inv.add.step2') }}</div>
          <div class="as-methods" role="radiogroup" [attr.aria-label]="t('inv.add.step2')">
            <button type="button" class="as-method" role="radio" [attr.aria-checked]="method() === 'scan'"
                    [class.active]="method() === 'scan'" (click)="method.set('scan')">
              <span class="as-method-icon"><ap-icon name="barcode" [size]="20"/></span>
              <span class="as-method-text">
                <strong>{{ t('inv.add.scanTitle') }}</strong>
                <span class="small">{{ t('inv.add.scanBody') }}</span>
                <span class="as-tag add">+ {{ t('inv.add.scanTag') }}</span>
              </span>
            </button>
            <button type="button" class="as-method" role="radio" [attr.aria-checked]="method() === 'file'"
                    [class.active]="method() === 'file'" (click)="method.set('file')">
              <span class="as-method-icon"><ap-icon name="csv" [size]="20"/></span>
              <span class="as-method-text">
                <strong>{{ t('inv.add.fileTitle') }}</strong>
                <span class="small">{{ t('inv.add.fileBody') }}</span>
                <span class="as-tag set">= {{ t('inv.add.fileTag') }}</span>
              </span>
            </button>
          </div>
        </section>

        <!-- 3. The items -->
        @if (method() === 'scan') {
          <div class="as-step-title as-outside"><span class="as-num">3</span>{{ t('inv.add.step3Scan') }}</div>
          <ap-stock-entry mode="receive" [locations]="locations" [fixedLocationId]="location()!.id"
                          [preset]="preset" (done)="saved.emit()"/>
        } @else if (method() === 'file') {
          <section class="card card-pad">
            <ap-stock-file [embedded]="true" [enabled]="true" [locations]="locations" [units]="units"
                           [fixedLocation]="location()" (saved)="saved.emit()" (viewHistory)="viewHistory.emit()"/>
          </section>
        }
      }
    </div>
  `,
  styles: [`
    .as { display: grid; gap: 16px; max-width: 920px; }
    .as-step { display: grid; gap: 12px; }
    .as-step-title { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; color: var(--ink); }
    .as-outside { margin: 4px 0 -4px; }
    .as-num { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--green); color: #fff; font-size: 12px; flex-shrink: 0; }
    .as-help { margin: -4px 0 0; font-size: 13px; color: var(--ink-2); }
    .as-locs { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
    .as-loc, .as-method {
      display: flex; align-items: flex-start; gap: 12px; padding: 16px; text-align: start;
      border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--ink);
      font: inherit; cursor: pointer; transition: border-color .15s, box-shadow .15s, transform .15s;
    }
    .as-loc:hover, .as-method:hover { border-color: var(--green); }
    .as-loc:active, .as-method:active { transform: translateY(1px); }
    .as-loc:focus-visible, .as-method:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
    .as-loc-icon, .as-method-icon { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: var(--bg); color: var(--green); flex-shrink: 0; }
    .as-loc-text, .as-method-text { display: grid; gap: 3px; }
    .as-loc-text strong, .as-method-text strong { font-size: 15px; }
    .as-units { color: var(--ink-2); font-variant-numeric: tabular-nums; }
    .as-methods { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .as-method-text .small { color: var(--ink-2); line-height: 1.45; }
    .as-method.active { border-color: var(--green); box-shadow: 0 0 0 1px var(--green); }
    .as-method.active .as-method-icon { background: var(--green); color: #fff; }
    .as-tag { justify-self: start; margin-top: 4px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .as-tag.add { background: var(--success-bg); color: var(--success); }
    .as-tag.set { background: var(--gold-3); color: var(--ink); }
    .as-banner { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 12px; background: var(--green); color: #fff; }
    .as-banner-icon { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: rgb(255 255 255 / .14); flex-shrink: 0; }
    .as-banner-text { display: grid; gap: 1px; flex: 1; min-width: 0; }
    .as-banner-text strong { font-size: 18px; }
    .as-banner-note { opacity: .85; }
    .as-change { background: transparent; color: #fff; border: 1px solid rgb(255 255 255 / .6); white-space: nowrap; }
    .as-change:hover { background: rgb(255 255 255 / .12); }
    @media (max-width: 767px) {
      .as-locs, .as-methods { grid-template-columns: 1fr; }
      .as-banner { flex-wrap: wrap; }
    }
  `],
})
export class AddStockComponent implements OnChanges {
  private readonly i18n = inject(I18nService);

  @Input({ required: true }) locations: StockLocation[] = [];
  @Input() units: Record<string, number> = {};
  /** A row's "Add" button in the stock table: that size, at that location. */
  @Input() preset: StockRow | null = null;
  @Input() presetLocationId: string | null = null;
  @Input() initialMethod: AddMethod | null = null;
  @Output() readonly saved = new EventEmitter<void>();
  @Output() readonly viewHistory = new EventEmitter<void>();

  readonly t = (k: string): string => this.i18n.t(k);
  readonly location = signal<StockLocation | null>(null);
  readonly method = signal<AddMethod | null>(null);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialMethod'] && this.initialMethod) this.method.set(this.initialMethod);
    if ((changes['presetLocationId'] || changes['locations']) && this.presetLocationId) {
      const loc = this.locations.find((l) => l.id === this.presetLocationId);
      if (loc) this.location.set(loc);
    }
    if (changes['preset'] && this.preset) this.method.set('scan');
  }

  pick(loc: StockLocation): void {
    this.location.set(loc);
  }

  changeLocation(): void {
    this.location.set(null);
  }
}
