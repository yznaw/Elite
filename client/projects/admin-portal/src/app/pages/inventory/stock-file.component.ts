import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { IconComponent } from '../../shared/icons/icon.component';
import { InventoryService, StockFileResult, StockFileReview, StockFileRow, StockLocation } from '../../services/inventory.service';
import { ConfirmService } from '../../services/confirm.service';
import { ToastService } from '../../services/toast.service';
import { I18nService } from '../../services/i18n.service';

/**
 * Inventory → Update from file. Three steps on one card: pick the location
 * that was counted (big cards, then a banner that stays on screen), download
 * the sheet of every size for it, upload it back and review before saving.
 * The sheet names its location; the server refuses it for another one.
 * With stock per location off there is no step 1 and the numbers are the
 * single shared figure.
 */
@Component({
  selector: 'ap-stock-file',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sf" [class.card]="!embedded" [class.card-pad]="!embedded">
      @if (!embedded) {
        <div class="sf-head">
          <div class="sf-head-icon"><ap-icon name="csv" [size]="18"/></div>
          <div>
            <h2 class="card-title">{{ t('inv.file.title') }}</h2>
            <p class="muted small">{{ t('inv.file.sub') }}</p>
          </div>
        </div>
      }

      @if (enabled && !location()) {
        <!-- Step 1: which location -->
        <section class="sf-step">
          <div class="sf-step-title"><span class="sf-num">1</span>{{ t('inv.file.step1') }}</div>
          <div class="sf-locs" role="radiogroup" [attr.aria-label]="t('inv.file.step1')">
            @for (loc of locations; track loc.id) {
              <button type="button" class="sf-loc" role="radio" [attr.aria-checked]="false" (click)="pick(loc)">
                <span class="sf-loc-icon"><ap-icon [name]="loc.type === 'warehouse' ? 'cube' : 'store'" [size]="20"/></span>
                <span class="sf-loc-text">
                  <strong>{{ loc.name }}</strong>
                  <span class="muted small">{{ loc.type === 'warehouse' ? t('inv.file.warehouse') : t('inv.file.store') }}</span>
                  <span class="small sf-units">{{ t('inv.file.units').replace('{n}', (units[loc.id] ?? 0).toLocaleString()) }}</span>
                </span>
              </button>
            }
          </div>
        </section>
      } @else {
        <!-- The location stays on screen for every later step (the Add stock page shows its own). -->
        @if (!embedded) {
        <div class="sf-banner" [class.all]="!location()">
          <ap-icon [name]="!location() ? 'sync' : location()!.type === 'warehouse' ? 'cube' : 'store'" [size]="18"/>
          <div class="sf-banner-text">
            @if (location(); as loc) {
              <span class="small">{{ t('inv.file.updatingAt') }}</span>
              <strong>{{ loc.name }}</strong>
              <span class="small sf-banner-note">{{ t('inv.file.onlyThis').replace('{name}', loc.name) }}</span>
            } @else {
              <strong>{{ t('inv.file.updatingAll') }}</strong>
            }
          </div>
          @if (location() && step() !== 'done') {
            <button type="button" class="btn btn-ghost btn-sm" (click)="reset(true)" [disabled]="busy()">{{ t('inv.file.change') }}</button>
          }
        </div>
        }

        @if (step() === 'done') {
          <div class="sf-done" role="status">
            <ap-icon name="check" [size]="20"/>
            <div>
              <strong>{{ location() ? t('inv.file.done').replace('{name}', location()!.name) : t('inv.file.doneAll') }}</strong>
              <div class="muted small">{{ t('inv.file.doneSub').replace('{changed}', '' + (result()?.changed ?? 0)).replace('{same}', '' + ((result()?.updated ?? 0) - (result()?.changed ?? 0))) }}</div>
            </div>
            <div class="sf-actions">
              <button type="button" class="btn btn-outline btn-sm" (click)="viewHistory.emit()">{{ t('inv.file.viewHistory') }}</button>
              <button type="button" class="btn btn-primary btn-sm" (click)="reset(false)">{{ t('inv.file.another') }}</button>
            </div>
          </div>
        } @else {
          <!-- Step 2: the sheet -->
          <section class="sf-step">
            <div class="sf-step-title"><span class="sf-num">{{ firstStep }}</span>{{ t('inv.file.step2') }}</div>
            <div class="sf-actions">
              <button type="button" class="btn btn-primary" (click)="downloadSheet()" [disabled]="downloading()">
                <ap-icon name="download" [size]="14"/>
                {{ location() ? t('inv.file.downloadFor').replace('{name}', location()!.name) : t('inv.file.downloadAll') }}
              </button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="downloadEmpty()">{{ t('inv.file.emptyTemplate') }}</button>
            </div>
            <p class="sf-hint">{{ t('inv.file.fillHint') }}</p>
          </section>

          <!-- Step 3: upload and review -->
          <section class="sf-step">
            <div class="sf-step-title"><span class="sf-num">{{ firstStep + 1 }}</span>{{ t('inv.file.step3') }}</div>
            @if (!review()) {
              <label class="sf-drop" [class.over]="dragOver()" [class.has-file]="!!file()"
                     (dragover)="$event.preventDefault(); dragOver.set(true)" (dragleave)="dragOver.set(false)"
                     (drop)="onDrop($event)">
                <input type="file" accept=".csv,text/csv" class="sf-file-input" (change)="onPick($event)"/>
                @if (file(); as f) {
                  <ap-icon name="csv" [size]="22"/>
                  <strong dir="ltr">{{ f.name }}</strong>
                } @else {
                  <ap-icon name="upload" [size]="22"/>
                  <strong>{{ t('inv.file.drop') }}</strong>
                  <span class="muted small">{{ t('inv.file.csvOnly') }}</span>
                }
              </label>
              @if (error()) { <div class="sf-error" role="alert"><ap-icon name="warning" [size]="14"/> {{ error() }}</div> }
              <div class="sf-actions">
                <button type="button" class="btn btn-primary" (click)="check()" [disabled]="!file() || busy()">
                  {{ busy() ? t('inv.file.checking') : t('inv.file.check') }}
                </button>
                @if (file()) {
                  <button type="button" class="btn btn-ghost btn-sm" (click)="file.set(null); error.set('')" [disabled]="busy()">{{ t('inv.file.remove') }}</button>
                }
              </div>
            } @else {
              @if (review(); as r) {
                <div class="sf-counts">
                  <span class="chip sf-c-changed">{{ t('inv.file.changed').replace('{n}', '' + r.summary.changed) }}</span>
                  <span class="chip">{{ t('inv.file.unchanged').replace('{n}', '' + r.summary.unchanged) }}</span>
                  <span class="chip">{{ t('inv.file.skipped').replace('{n}', '' + r.summary.skipped) }}</span>
                  @if (r.summary.failed) {
                    <span class="chip sf-c-failed">{{ t('inv.file.problems').replace('{n}', '' + r.summary.failed) }}</span>
                  }
                </div>
                <div class="sf-table-wrap">
                  <table class="tbl sf-table">
                    <thead>
                      <tr>
                        <th>{{ t('inv.file.col.item') }}</th>
                        <th class="num">{{ t('inv.file.col.now') }}</th>
                        <th class="num">{{ t('inv.file.col.new') }}</th>
                        <th class="num">{{ t('inv.file.col.change') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of orderedRows(); track row.line) {
                        <tr [class.sf-bad]="row.errors.length">
                          <td>
                            <div class="sf-name">{{ row.productName || row.sku || '–' }}</div>
                            <div class="muted small">{{ label(row) }} <span dir="ltr">{{ row.sku }}</span></div>
                            @for (e of row.errors; track e) { <div class="sf-row-error">{{ e }}</div> }
                            @if (row.changedSinceDownload; as moved) {
                              <div class="sf-row-warn">{{ t('inv.file.sinceDownload').replace('{was}', '' + moved.was).replace('{now}', '' + moved.now) }}</div>
                            }
                          </td>
                          <td class="num">{{ row.currentStock ?? '–' }}</td>
                          <td class="num"><strong>{{ row.stock ?? '–' }}</strong></td>
                          <td class="num">
                            @if (row.change) {
                              <span class="sf-delta" [class.up]="row.change > 0" [class.down]="row.change < 0">{{ row.change > 0 ? '+' + row.change : row.change }}</span>
                            } @else { <span class="muted">0</span> }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                @if (!r.canCommit) { <div class="sf-error" role="alert"><ap-icon name="warning" [size]="14"/> {{ t('inv.file.fixFirst') }}</div> }
                @if (error()) { <div class="sf-error" role="alert"><ap-icon name="warning" [size]="14"/> {{ error() }}</div> }
                <div class="sf-actions">
                  <button type="button" class="btn btn-primary" (click)="save()" [disabled]="!r.canCommit || busy()">
                    {{ busy() ? t('common.saving') : saveLabel() }}
                  </button>
                  <button type="button" class="btn btn-ghost btn-sm" (click)="reset(false)" [disabled]="busy()">{{ t('inv.file.otherFile') }}</button>
                </div>
              }
            }
          </section>
        }
      }
    </div>
  `,
  styles: [`
    .sf { display: grid; gap: 18px; max-width: 880px; }
    .sf-head { display: flex; gap: 12px; align-items: flex-start; }
    .sf-head-icon { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--gold-3); color: var(--ink); flex-shrink: 0; }
    .sf-head p { margin: 2px 0 0; }
    .sf-step { display: grid; gap: 10px; }
    .sf-step-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; }
    .sf-num { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--green); color: #fff; font-size: 12px; }
    .sf-locs { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
    .sf-loc {
      display: flex; align-items: center; gap: 12px; padding: 16px; text-align: start;
      border: 1px solid var(--border); border-radius: 12px; background: var(--surface); font: inherit; cursor: pointer;
      transition: border-color .15s, transform .15s;
    }
    .sf-loc:hover { border-color: var(--green); }
    .sf-loc:active { transform: translateY(1px); }
    .sf-loc:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
    .sf-loc-icon { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: var(--bg); color: var(--green); flex-shrink: 0; }
    .sf-loc-text { display: grid; gap: 2px; }
    .sf-loc-text strong { font-size: 15px; }
    .sf-units { color: var(--ink-2); font-variant-numeric: tabular-nums; }
    .sf-banner {
      display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px;
      background: var(--green); color: #fff;
    }
    .sf-banner.all { background: var(--gold-3); color: var(--ink); }
    .sf-banner-text { display: grid; gap: 1px; flex: 1; min-width: 0; }
    .sf-banner-text strong { font-size: 17px; }
    .sf-banner-note { opacity: .85; }
    .sf-banner .btn { color: inherit; border-color: currentColor; white-space: nowrap; }
    .sf-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .sf-actions .btn { white-space: nowrap; }
    .sf-hint { margin: 0; font-size: 13px; color: var(--ink-2); max-width: 65ch; }
    .sf-drop {
      position: relative; display: grid; justify-items: center; gap: 6px; padding: 28px 16px; text-align: center;
      border: 2px dashed var(--border); border-radius: 12px; background: var(--bg); cursor: pointer; color: var(--ink-2);
    }
    .sf-drop.over, .sf-drop:hover { border-color: var(--green); }
    .sf-drop.has-file { border-style: solid; border-color: var(--green); color: var(--ink); }
    .sf-file-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    .sf-error { display: flex; gap: 6px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; background: var(--danger-bg, #fdecec); color: var(--danger); font-size: 13px; }
    .sf-counts { display: flex; flex-wrap: wrap; gap: 6px; }
    .sf-c-changed { border-color: var(--green); color: var(--green); }
    .sf-c-failed { border-color: var(--danger); color: var(--danger); }
    .sf-table-wrap { max-height: 420px; overflow: auto; border: 1px solid var(--border-2); border-radius: 10px; }
    .sf-table th { position: sticky; top: 0; background: var(--surface); cursor: default; }
    .sf-table th.num, .sf-table td.num { text-align: end; font-variant-numeric: tabular-nums; }
    .sf-name { font-weight: 600; }
    .sf-bad td { background: var(--danger-bg, #fdecec); }
    .sf-row-error { color: var(--danger); font-size: 12px; margin-top: 2px; }
    .sf-row-warn { color: #b45309; font-size: 12px; margin-top: 2px; }
    .sf-delta { font-weight: 700; }
    .sf-delta.up { color: var(--success); }
    .sf-delta.down { color: var(--danger); }
    .sf-done { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 14px; border-radius: 12px; background: var(--success-bg); color: var(--ink); }
    .sf-done > ap-icon { color: var(--success); }
    .sf-done > div:nth-child(2) { flex: 1; min-width: 200px; }
    @media (max-width: 767px) {
      .sf-banner { flex-wrap: wrap; }
      .sf-locs { grid-template-columns: 1fr; }
    }
  `],
})
export class StockFileComponent {
  private readonly api = inject(InventoryService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);

  /** Stock per location is on: a location must be chosen first. */
  @Input() enabled = false;
  @Input() locations: StockLocation[] = [];
  @Input() units: Record<string, number> = {};
  /** Inside the Add stock page: that page picks the location and shows it. */
  @Input() embedded = false;
  /** The location chosen by the Add stock page. */
  @Input() set fixedLocation(value: StockLocation | null) {
    if (value?.id === this.location()?.id) return;
    this.location.set(value);
    this.reset(false);
  }
  @Output() readonly saved = new EventEmitter<StockFileResult>();
  @Output() readonly viewHistory = new EventEmitter<void>();

  readonly t = (k: string): string => this.i18n.t(k);
  readonly location = signal<StockLocation | null>(null);
  readonly file = signal<File | null>(null);
  readonly review = signal<StockFileReview | null>(null);
  readonly result = signal<StockFileResult | null>(null);
  readonly step = signal<'work' | 'done'>('work');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly downloading = signal(false);
  readonly dragOver = signal(false);

  /** Problems first, then the sizes that change, then the rest. */
  readonly orderedRows = computed(() => {
    const rows = this.review()?.rows ?? [];
    const rank = (r: StockFileRow) => (r.errors.length ? 0 : r.change ? 1 : 2);
    return [...rows].sort((a, b) => rank(a) - rank(b) || a.line - b.line);
  });
  /** Number of the "Download the sheet" step. */
  get firstStep(): number { return this.embedded ? 3 : this.enabled ? 2 : 1; }
  readonly saveLabel = computed(() => {
    const loc = this.location();
    return loc ? this.t('inv.file.save').replace('{name}', loc.name) : this.t('inv.file.saveAll');
  });

  pick(loc: StockLocation): void {
    this.location.set(loc);
    this.error.set('');
  }

  /** Back to an empty upload; `changeLocation` also clears the location. */
  reset(changeLocation: boolean): void {
    if (changeLocation) this.location.set(null);
    this.file.set(null);
    this.review.set(null);
    this.result.set(null);
    this.error.set('');
    this.step.set('work');
  }

  label(row: StockFileRow): string {
    return [row.color, row.size].filter(Boolean).join(' · ');
  }

  async downloadSheet(): Promise<void> {
    this.downloading.set(true);
    try {
      const { blob, filename } = await this.api.downloadStockFileTemplate(this.location()?.id);
      this.saveBlob(blob, filename);
    } catch (err) {
      this.toast.errorFrom(err, this.t('inv.file.downloadFailed'), this.message(err));
    } finally {
      this.downloading.set(false);
    }
  }

  downloadEmpty(): void {
    this.saveBlob(new Blob(['﻿SKU,Stock\r\n'], { type: 'text/csv;charset=utf-8;' }), 'stock-template.csv');
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.setFile(input.files?.[0] ?? null);
    input.value = '';
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    this.setFile(event.dataTransfer?.files?.[0] ?? null);
  }

  async check(): Promise<void> {
    const file = this.file();
    if (!file || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.review.set(await this.api.previewStockFile(file, this.location()?.id));
    } catch (err) {
      // Shown in place (a wrong location, an empty sheet), not as a toast.
      this.error.set(this.message(err) || this.t('inv.file.checkFailed'));
    } finally {
      this.busy.set(false);
    }
  }

  async save(): Promise<void> {
    const review = this.review();
    if (!review?.canCommit || this.busy()) return;
    const loc = this.location();
    const ok = await this.confirm.ask({
      title: loc ? this.t('inv.file.confirmTitle').replace('{name}', loc.name) : this.t('inv.file.confirmTitleAll'),
      message: this.t('inv.file.confirmBody').replace('{n}', String(review.rows.length)),
      confirmLabel: this.saveLabel(),
    });
    if (!ok) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.api.commitStockFile(review.jobId);
      this.result.set(result);
      this.step.set('done');
      this.saved.emit(result);
    } catch (err) {
      this.error.set(this.message(err) || this.t('inv.file.saveFailed'));
    } finally {
      this.busy.set(false);
    }
  }

  private setFile(file: File | null): void {
    if (!file) return;
    this.file.set(file);
    this.error.set('');
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private message(err: unknown): string {
    if (err instanceof HttpErrorResponse) return err.error?.message || '';
    return err instanceof Error ? err.message : '';
  }
}
