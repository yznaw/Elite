import {
  Component, EventEmitter, Input, OnChanges, Output, SimpleChanges,
  computed, inject, signal, ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SaveBarComponent } from '../../shared/save-bar/save-bar.component';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { ApiClient } from '../../services/api-client.service';
import { AdminExpensesService } from '../../services/admin-expenses.service';
import {
  EXPENSE_CATEGORIES, EXPENSE_PAYMENT_METHODS, Expense,
  ExpenseCategory, ExpensePaymentMethod, ExpenseRecurrence,
} from '../../models';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface ExpenseForm {
  expenseDate: string;
  category: ExpenseCategory;
  amount: number | null;
  vendor: string;
  paymentMethod: ExpensePaymentMethod;
  note: string;
  recurrence: ExpenseRecurrence;
  receiptMediaId: string | null;
  receiptUrl: string | null;
}

const EMPTY: ExpenseForm = {
  expenseDate: '',
  category: 'other',
  amount: null,
  vendor: '',
  paymentMethod: 'cash',
  note: '',
  recurrence: 'none',
  receiptMediaId: null,
  receiptUrl: null,
};

@Component({
    selector: 'ap-expense-drawer',
    imports: [CommonModule, FormsModule, IconComponent, PillComponent, SaveBarComponent],
    changeDetection: ChangeDetectionStrategy.Eager,
    template: `
    @if (open) {
      <div class="exp-backdrop" (click)="close()" aria-hidden="true"></div>
      <aside class="drawer" role="dialog" aria-modal="true">

        <div class="drawer-head">
          <div class="row gap-sm" style="flex:1;min-width:0;align-items:center;">
            <div class="card-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              {{ isNew() ? t('expenses.new') : t('expenses.edit') }}
            </div>
            @if (expense?.recurrence && expense?.recurrence !== 'none') {
              <ap-pill kind="blue">{{ t('expenses.recurrence.' + expense!.recurrence) }}</ap-pill>
            }
            @if (expense?.source === 'pos_cash_out') {
              <ap-pill kind="grey">{{ t('expenses.source.pos') }}</ap-pill>
            }
          </div>
          <button class="icon-btn" type="button" (click)="close()" [attr.aria-label]="t('common.close')">
            <ap-icon name="x" [size]="14"/>
          </button>
        </div>

        <ap-save-bar
          [dirty]="isDirty()"
          [saving]="saveState() === 'saving'"
          [justSaved]="saveState() === 'saved'"
          [shake]="shake()"
          (saved)="save()"
          (discarded)="discard()"
        />

        <div class="drawer-body">

          @if (isProjected()) {
            <div class="notice">
              <ap-icon name="info" [size]="14"/>
              <span>{{ t('expenses.projectedNotice') }}</span>
            </div>
          }

          <div class="fld">
            <label class="lbl" for="exp-amount">{{ t('expenses.field.amount') }}</label>
            <input id="exp-amount" class="inp mono" type="number" min="0" step="0.01"
                   [ngModel]="form().amount"
                   (ngModelChange)="patch({ amount: $event === '' || $event === null ? null : +$event })"
                   placeholder="0.00"/>
            @if (amountError()) {
              <div class="err">{{ t('expenses.error.amount') }}</div>
            }
          </div>

          <div class="fld-row">
            <div class="fld">
              <label class="lbl" for="exp-date">{{ t('expenses.field.date') }}</label>
              <input id="exp-date" class="inp" type="date"
                     [ngModel]="form().expenseDate"
                     (ngModelChange)="patch({ expenseDate: $event })"/>
            </div>
            <div class="fld">
              <label class="lbl" for="exp-cat">{{ t('expenses.field.category') }}</label>
              <select id="exp-cat" class="inp"
                      [ngModel]="form().category"
                      (ngModelChange)="patch({ category: $event })">
                @for (c of categories; track c) {
                  <option [value]="c">{{ t('expenses.category.' + c) }}</option>
                }
              </select>
            </div>
          </div>

          <!-- Fires only for the one category where double-counting is a real
               risk: inbound freight is already inside a variant's total cost,
               so logging it here too would subtract it from profit twice. -->
          @if (form().category === 'logistics') {
            <div class="notice notice-warn">
              <ap-icon name="warning" [size]="14"/>
              <span>{{ t('expenses.logisticsWarning') }}</span>
            </div>
          }

          <div class="fld-row">
            <div class="fld">
              <label class="lbl" for="exp-vendor">{{ t('expenses.field.vendor') }}</label>
              <input id="exp-vendor" class="inp" type="text"
                     [ngModel]="form().vendor"
                     (ngModelChange)="patch({ vendor: $event })"
                     [placeholder]="t('expenses.field.vendorPlaceholder')"/>
            </div>
            <div class="fld">
              <label class="lbl" for="exp-pay">{{ t('expenses.field.paymentMethod') }}</label>
              <select id="exp-pay" class="inp"
                      [ngModel]="form().paymentMethod"
                      (ngModelChange)="patch({ paymentMethod: $event })">
                @for (m of paymentMethods; track m) {
                  <option [value]="m">{{ t('expenses.payment.' + m) }}</option>
                }
              </select>
            </div>
          </div>

          <div class="fld">
            <label class="lbl" for="exp-rec">{{ t('expenses.field.recurrence') }}</label>
            <select id="exp-rec" class="inp"
                    [ngModel]="form().recurrence"
                    (ngModelChange)="patch({ recurrence: $event })">
              <option value="none">{{ t('expenses.recurrence.none') }}</option>
              <option value="monthly">{{ t('expenses.recurrence.monthly') }}</option>
              <option value="yearly">{{ t('expenses.recurrence.yearly') }}</option>
            </select>
            <div class="hint muted small">{{ t('expenses.field.recurrenceHint') }}</div>
          </div>

          <div class="fld">
            <label class="lbl" for="exp-note">{{ t('expenses.field.note') }}</label>
            <textarea id="exp-note" class="inp" rows="3"
                      [ngModel]="form().note"
                      (ngModelChange)="patch({ note: $event })"
                      [placeholder]="t('expenses.field.notePlaceholder')"></textarea>
          </div>

          <div class="fld">
            <label class="lbl">{{ t('expenses.field.receipt') }}</label>
            @if (form().receiptUrl) {
              <div class="receipt">
                <a [href]="mediaUrl(form().receiptUrl!)" target="_blank" rel="noopener" class="row gap-sm">
                  <ap-icon name="docs" [size]="14"/>
                  <span>{{ t('expenses.receiptView') }}</span>
                </a>
                <button class="btn btn-outline btn-xs" type="button" (click)="clearReceipt()">
                  {{ t('common.remove') }}
                </button>
              </div>
            } @else {
              <label class="upload-btn">
                <ap-icon name="upload" [size]="14"/>
                <span>{{ uploading() ? t('expenses.receiptUploading') : t('expenses.receiptUpload') }}</span>
                <input type="file" accept="image/*,application/pdf" hidden
                       (change)="onReceiptPicked($event)"/>
              </label>
            }
          </div>

          @if (!isNew() && !isProjected()) {
            <div class="danger-zone">
              <button class="btn btn-outline btn-sm danger" type="button" (click)="remove()">
                <ap-icon name="trash" [size]="12"/>
                <span>{{ t('expenses.delete') }}</span>
              </button>
            </div>
          }
        </div>
      </aside>
    }
  `,
    styles: [`
    :host { display: block; }
    .exp-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,.35);
      z-index: 40; animation: fade .15s ease;
    }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

    .drawer-body { padding: 20px 18px; display: flex; flex-direction: column; gap: 18px; }

    .fld { display: flex; flex-direction: column; gap: 6px; }
    .fld-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 520px) { .fld-row { grid-template-columns: 1fr; } }

    .lbl { font-size: 12px; font-weight: 600; color: var(--ink-2); }
    .hint { margin-top: 2px; }
    .err { font-size: 11.5px; color: #dc2626; font-weight: 600; }
    .mono { font-variant-numeric: tabular-nums; }

    .notice {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 10px 12px; border-radius: 8px;
      background: rgba(91,141,239,.09); border: 1px solid rgba(91,141,239,.28);
      font-size: 12.5px; color: var(--ink-2); line-height: 1.45;
    }

    .notice-warn {
      background: rgba(217,119,6,.09);
      border-color: rgba(217,119,6,.32);
    }

    .receipt { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .receipt a { color: var(--green); text-decoration: none; font-size: 13px; }
    .receipt a:hover { text-decoration: underline; }

    .upload-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 9px 14px; border: 1px dashed var(--border);
      border-radius: 8px; cursor: pointer; font-size: 13px;
      color: var(--ink-2); background: var(--bg-2); width: fit-content;
      transition: border-color .15s, color .15s;
    }
    .upload-btn:hover { border-color: var(--green); color: var(--ink); }

    .danger-zone { border-top: 1px solid var(--border); padding-top: 16px; }
    .btn.danger { color: #dc2626; border-color: rgba(220,38,38,.35); }
    .btn.danger:hover { background: rgba(220,38,38,.06); }

    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; background: transparent;
      border: 1px solid var(--border); border-radius: 6px;
      color: var(--ink-2); cursor: pointer; flex-shrink: 0;
    }
    .icon-btn:hover { background: var(--bg-2); color: var(--ink); }
  `]
})
export class ExpenseDrawerComponent implements OnChanges {
  @Input() open = false;
  @Input() expense: Expense | null = null;

  @Output() closeDrawer = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Expense>();
  @Output() deleted = new EventEmitter<string>();

  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly api = inject(ApiClient);
  private readonly svc = inject(AdminExpensesService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly categories = EXPENSE_CATEGORIES;
  readonly paymentMethods = EXPENSE_PAYMENT_METHODS;

  readonly form = signal<ExpenseForm>({ ...EMPTY });
  readonly original = signal<ExpenseForm>({ ...EMPTY });
  readonly saveState = signal<SaveState>('idle');
  readonly shake = signal(false);
  readonly uploading = signal(false);
  readonly amountError = signal(false);

  readonly isNew = computed(() => !this.expense?.id);
  readonly isProjected = computed(() => this.expense?.isProjected === true);
  readonly isDirty = computed(() =>
    JSON.stringify(this.form()) !== JSON.stringify(this.original()));

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['expense'] && !changes['open']) return;
    if (!this.open) return;

    const e = this.expense;
    const next: ExpenseForm = e
      ? {
          expenseDate: e.expenseDate?.slice(0, 10) || this.today(),
          category: e.category,
          amount: e.amount,
          vendor: e.vendor,
          paymentMethod: e.paymentMethod,
          note: e.note,
          recurrence: e.recurrence,
          receiptMediaId: e.receiptMediaId,
          receiptUrl: e.receiptUrl,
        }
      : { ...EMPTY, expenseDate: this.today() };

    this.form.set(next);
    this.original.set({ ...next });
    this.saveState.set('idle');
    this.amountError.set(false);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  mediaUrl(path: string): string {
    return this.api.mediaUrl(path);
  }

  patch(part: Partial<ExpenseForm>): void {
    this.form.update((f) => ({ ...f, ...part }));
    if (part.amount !== undefined) this.amountError.set(false);
  }

  clearReceipt(): void {
    this.patch({ receiptMediaId: null, receiptUrl: null });
  }

  async onReceiptPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.uploading.set(true);
    try {
      const body = new FormData();
      // The endpoint takes a multi-file field, so a single receipt still goes
      // up as `files` and can come back wrapped in an array.
      body.append('files', file);
      body.append('role', 'receipt');
      // Multipart bypasses ApiClient's JSON helpers, so post directly with
      // the session cookie.
      const res = await fetch(this.api.url('/admin/media'), {
        method: 'POST',
        credentials: 'include',
        body,
      });
      if (!res.ok) throw new Error(String(res.status));
      const payload = await res.json();
      const data = payload?.data ?? payload;
      const asset = Array.isArray(data) ? data[0] : data;
      if (!asset?.id) throw new Error('no asset returned');
      this.patch({ receiptMediaId: asset.id, receiptUrl: asset.url ?? null });
    } catch {
      this.toast.error(this.t('expenses.receiptError'));
    } finally {
      this.uploading.set(false);
      input.value = '';
    }
  }

  private triggerShake(): void {
    this.shake.set(true);
    setTimeout(() => this.shake.set(false), 500);
  }

  async save(): Promise<void> {
    const f = this.form();

    if (!f.amount || f.amount <= 0) {
      this.amountError.set(true);
      this.triggerShake();
      return;
    }

    this.saveState.set('saving');
    try {
      const payload = {
        expenseDate: f.expenseDate,
        category: f.category,
        amount: f.amount,
        vendor: f.vendor,
        paymentMethod: f.paymentMethod,
        note: f.note,
        recurrence: f.recurrence,
        receiptMediaId: f.receiptMediaId,
        // Editing a projected occurrence materialises it as its own row that
        // points back at the recurring template, so only that month changes.
        ...(this.isProjected() && this.expense
          ? { recurrenceParentId: this.expense.id, recurrence: 'none' as ExpenseRecurrence }
          : {}),
      };

      const creating = this.isNew() || this.isProjected();
      const result = creating
        ? await this.svc.create(payload)
        : await this.svc.update(this.expense!.id, payload);

      this.saveState.set('saved');
      this.original.set({ ...f });
      this.toast.success(this.t('expenses.toast.saved'));
      this.saved.emit(result);

      // A create leaves the drawer holding the values it just saved, so
      // pressing Save again would file the same expense twice. Close instead;
      // the row is already in the list behind.
      if (creating) {
        this.close();
        return;
      }

      setTimeout(() => {
        if (this.saveState() === 'saved') this.saveState.set('idle');
      }, 2000);
    } catch {
      this.saveState.set('error');
      this.toast.error(this.t('expenses.toast.saveError'));
    }
  }

  discard(): void {
    this.form.set({ ...this.original() });
    this.saveState.set('idle');
    this.amountError.set(false);
  }

  async remove(): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: this.t('expenses.deleteConfirm.title'),
      message: this.t('expenses.deleteConfirm.message'),
      confirmLabel: this.t('expenses.deleteConfirm.confirm'),
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await this.svc.delete(this.expense!.id);
      this.toast.success(this.t('expenses.toast.deleted'));
      this.original.set({ ...this.form() });
      this.deleted.emit(this.expense!.id);
      this.closeDrawer.emit();
    } catch {
      this.toast.error(this.t('expenses.toast.deleteError'));
    }
  }

  close(): void {
    this.saveState.set('idle');
    this.closeDrawer.emit();
  }
}
