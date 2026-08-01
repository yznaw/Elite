import { Component, OnInit, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import {
  InventoryService,
  StocktakeDetail,
  StocktakeStatus,
  StocktakeSummary,
} from '../../services/inventory.service';

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
    imports: [CommonModule, DatePipe, FormsModule, IconComponent, PillComponent, SpinnerComponent],
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
          <div class="muted small mt-8">{{ t('stocktake.mode.hint') }}</div>
          <button class="btn btn-gold mt-16" [disabled]="starting() || !newReference().trim()" (click)="start()">
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
            <button class="btn btn-gold" [disabled]="posting() || countedCount() === 0" (click)="post()">
              @if (posting()) { <ap-spinner [size]="12"/> }
              {{ t('stocktake.post') }}
            </button>
            <button class="btn btn-outline" [disabled]="posting()" (click)="cancel()">{{ t('stocktake.cancel') }}</button>
            <button class="btn btn-outline" (click)="reload()">
              <ap-icon name="sync" [size]="14"/> {{ t('common.refresh') }}
            </button>
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
                  @if (line.countedQuantity !== null) {
                    <span class="small">{{ t('stocktake.count') }} {{ line.countedQuantity }}</span>
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
                         [placeholder]="t('stocktake.enterCount')"/>
                  <button class="btn btn-outline btn-sm"
                          [disabled]="saving() === line.variantId || draft()[line.variantId] === undefined || draft()[line.variantId] === ''"
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
    @media (max-width: 900px) {
      .count-row { grid-template-columns: 1fr; }
    }
  `]
})
export class StocktakeComponent implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly api = inject(InventoryService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly active = signal<StocktakeDetail | null>(null);
  readonly history = signal<StocktakeSummary[]>([]);
  readonly loading = signal(false);
  readonly starting = signal(false);
  readonly posting = signal(false);
  readonly saving = signal<string | null>(null);

  readonly newReference = signal('');
  readonly newBlind = signal(true);
  readonly filter = signal('');
  readonly draft = signal<Record<string, string>>({});

  readonly countedCount = computed(() => this.active()?.lines.filter((l) => l.countedQuantity !== null).length ?? 0);

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
    await this.reload();
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
      this.active.set(open ? await this.api.getStocktake(open.stocktakeId) : null);
    } catch {
      // The interceptor already reported it.
    } finally {
      this.loading.set(false);
    }
  }

  async start(): Promise<void> {
    this.starting.set(true);
    try {
      await this.api.startStocktake({ reference: this.newReference().trim(), blind: this.newBlind() });
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
      await this.api.saveCount(stocktake.stocktakeId, variantId, quantity);
      this.draft.set({ ...this.draft(), [variantId]: '' });
      this.active.set(await this.api.getStocktake(stocktake.stocktakeId));
    } catch {
      /* reported by the interceptor */
    } finally {
      this.saving.set(null);
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
