import { Component, OnInit, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PillComponent } from '../../shared/pill/pill.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import {
  PosReconciliation,
  PosReconciliationRegister,
  PosReconciliationService,
  PosReconciliationStatus,
} from '../../services/pos-reconciliation.service';

@Component({
    selector: 'ap-pos-reconciliation',
    imports: [CommonModule, DatePipe, FormsModule, PillComponent, SpinnerComponent],
    template: `
    <div class="page-fade">
      <div class="card card-pad mb-24" style="max-width:720px;">
        <div class="card-title mb-16">{{ t('reconciliation.entry.title') }}</div>
        <div class="card-sub mb-16">{{ t('reconciliation.entry.sub') }}</div>

        <div class="grid-3">
          <div>
            <label class="lbl">{{ t('reconciliation.register') }}</label>
            <select class="inp" [ngModel]="selectedRegisterId()" (ngModelChange)="selectedRegisterId.set($event)">
              @for (r of registers(); track r.registerId) {
                <option [value]="r.registerId">{{ r.displayName }}</option>
              }
            </select>
          </div>
          <div>
            <label class="lbl">{{ t('reconciliation.businessDate') }}</label>
            <input class="inp" type="date" [ngModel]="businessDate()" (ngModelChange)="businessDate.set($event)"/>
          </div>
          <div>
            <label class="lbl">{{ t('reconciliation.settlementTotal') }}</label>
            <div class="row" style="align-items:center;gap:6px;">
              <span class="muted small">QAR</span>
              <input class="inp" inputmode="decimal" [ngModel]="settlementInput()" (ngModelChange)="settlementInput.set($event)"/>
            </div>
          </div>
        </div>

        @if (livePosTotalCents(); as posTotal) {
          <div class="muted small mt-16">{{ t('reconciliation.posTotalHint') }} {{ formatMoney(posTotal) }}</div>
        }

        <div class="row gap-sm mt-16" style="flex-wrap:wrap;">
          <button class="btn btn-outline" [disabled]="refreshing() || !selectedRegisterId()" (click)="refreshLiveTotal()">
            @if (refreshing()) { <ap-spinner [size]="12"/> }
            {{ t('reconciliation.checkPosTotal') }}
          </button>
          <button class="btn btn-gold" [disabled]="submitting() || !canSubmit()" (click)="submit()">
            @if (submitting()) { <ap-spinner [size]="12"/> {{ t('common.saving') }} }
            @else { {{ t('reconciliation.submit') }} }
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">{{ t('reconciliation.history.title') }}</div>
            <div class="card-sub">{{ t('reconciliation.history.sub') }}</div>
          </div>
          <select class="inp" style="width:160px;" [ngModel]="statusFilter()" (ngModelChange)="setStatusFilter($event)">
            <option value="">{{ t('reconciliation.filter.all') }}</option>
            <option value="pending">{{ t('reconciliation.status.pending') }}</option>
            <option value="matched">{{ t('reconciliation.status.matched') }}</option>
            <option value="exception">{{ t('reconciliation.status.exception') }}</option>
            <option value="resolved">{{ t('reconciliation.status.resolved') }}</option>
          </select>
        </div>

        @if (loadingHistory()) {
          <div class="row gap-sm" style="padding:24px;justify-content:center;">
            <ap-spinner/> <span class="muted small">{{ t('common.loading') }}</span>
          </div>
        } @else if (!history().length) {
          <div class="muted small" style="text-align:center;padding:32px;">{{ t('reconciliation.history.empty') }}</div>
        } @else {
          <div class="recon-table">
            @for (row of history(); track row.reconciliationId) {
              <div class="recon-row">
                <div class="recon-cell recon-date">
                  <div class="strong">{{ row.businessDate | date:'MMM d, y' }}</div>
                  <div class="muted small">{{ row.registerName }}</div>
                </div>
                <div class="recon-cell">
                  <div class="muted small">{{ t('reconciliation.col.posTotal') }}</div>
                  <div>{{ formatMoney(row.posTotalCents) }}</div>
                </div>
                <div class="recon-cell">
                  <div class="muted small">{{ t('reconciliation.col.settlementTotal') }}</div>
                  <div>{{ row.settlementTotalCents === null ? '—' : formatMoney(row.settlementTotalCents) }}</div>
                </div>
                <div class="recon-cell">
                  <div class="muted small">{{ t('reconciliation.col.variance') }}</div>
                  <div [style.color]="varianceColor(row.varianceCents)">
                    {{ row.varianceCents === null ? '—' : formatMoney(row.varianceCents) }}
                  </div>
                </div>
                <div class="recon-cell">
                  <ap-pill [kind]="statusPillKind(row.status)">{{ t('reconciliation.status.' + row.status) }}</ap-pill>
                </div>
                <div class="recon-cell recon-actions">
                  @if (row.status === 'exception') {
                    @if (resolvingId() === row.reconciliationId) {
                      <input class="inp" style="width:100%;" [ngModel]="resolveNote()" (ngModelChange)="resolveNote.set($event)"
                             [placeholder]="t('reconciliation.resolve.notePlaceholder')"/>
                      <div class="row gap-sm mt-8">
                        <button class="btn btn-gold btn-sm" [disabled]="!resolveNote().trim()" (click)="confirmResolve(row)">{{ t('reconciliation.resolve.confirm') }}</button>
                        <button class="btn btn-outline btn-sm" (click)="cancelResolve()">{{ t('common.cancel') }}</button>
                      </div>
                    } @else {
                      <button class="btn btn-outline btn-sm" (click)="startResolve(row)">{{ t('reconciliation.resolve.action') }}</button>
                    }
                  }
                  @if (row.status === 'resolved' && row.notes) {
                    <div class="muted small" [title]="row.notes">{{ row.notes }}</div>
                  }
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [`
    .recon-table { display: grid; }
    .recon-row {
      padding: 14px 20px;
      display: grid;
      grid-template-columns: 1.3fr 1fr 1fr 1fr auto 1.4fr;
      gap: 14px;
      align-items: center;
      border-bottom: 1px solid var(--border, #e5e7eb);
    }
    .recon-row:last-child { border-bottom: none; }
    .recon-cell { min-width: 0; }
    .recon-actions { display: grid; gap: 4px; }
    @media (max-width: 900px) {
      .recon-row { grid-template-columns: 1fr 1fr; }
    }
  `]
})
export class PosReconciliationComponent implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly api = inject(PosReconciliationService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly registers = signal<PosReconciliationRegister[]>([]);
  readonly selectedRegisterId = signal('');
  readonly businessDate = signal(new Date().toISOString().slice(0, 10));
  readonly settlementInput = signal('');
  readonly livePosTotalCents = signal<number | null>(null);

  readonly refreshing = signal(false);
  readonly submitting = signal(false);

  readonly history = signal<PosReconciliation[]>([]);
  readonly loadingHistory = signal(true);
  readonly statusFilter = signal<PosReconciliationStatus | ''>('');

  readonly resolvingId = signal<string | null>(null);
  readonly resolveNote = signal('');

  readonly canSubmit = computed(() => {
    const cents = this.moneyInputToCents(this.settlementInput());
    return Boolean(this.selectedRegisterId()) && Boolean(this.businessDate()) && cents !== null && cents >= 0;
  });

  async ngOnInit(): Promise<void> {
    try {
      const registers = await this.api.listRegisters();
      this.registers.set(registers);
      if (registers.length && !this.selectedRegisterId()) this.selectedRegisterId.set(registers[0].registerId);
    } catch {
      // Global interceptor surfaces the error.
    }
    await this.loadHistory();
  }

  async loadHistory(): Promise<void> {
    this.loadingHistory.set(true);
    try {
      this.history.set(await this.api.list(this.statusFilter() ? { status: this.statusFilter() as PosReconciliationStatus } : {}));
    } catch {
      // Global interceptor surfaces the error.
    } finally {
      this.loadingHistory.set(false);
    }
  }

  setStatusFilter(value: PosReconciliationStatus | ''): void {
    this.statusFilter.set(value);
    this.loadHistory();
  }

  async refreshLiveTotal(): Promise<void> {
    if (!this.selectedRegisterId() || !this.businessDate()) return;
    this.refreshing.set(true);
    try {
      const result = await this.api.refresh(this.selectedRegisterId(), this.businessDate());
      this.livePosTotalCents.set(result.posTotalCents);
    } catch (error) {
      this.toast.warning("Couldn't check POS total", this.errorMessage(error));
    } finally {
      this.refreshing.set(false);
    }
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    const settlementCents = this.moneyInputToCents(this.settlementInput());
    if (settlementCents === null) return;
    this.submitting.set(true);
    try {
      const result = await this.api.submitSettlement(this.selectedRegisterId(), this.businessDate(), settlementCents);
      this.livePosTotalCents.set(result.posTotalCents);
      this.settlementInput.set('');
      this.toast.success(
        result.status === 'matched' ? this.t('reconciliation.toast.matched') : this.t('reconciliation.toast.exception'),
      );
      await this.loadHistory();
    } catch (error) {
      this.toast.error("Couldn't submit settlement", this.errorMessage(error));
    } finally {
      this.submitting.set(false);
    }
  }

  startResolve(row: PosReconciliation): void {
    this.resolvingId.set(row.reconciliationId);
    this.resolveNote.set('');
  }

  cancelResolve(): void {
    this.resolvingId.set(null);
    this.resolveNote.set('');
  }

  async confirmResolve(row: PosReconciliation): Promise<void> {
    if (!this.resolveNote().trim()) return;
    try {
      await this.api.resolve(row.reconciliationId, this.resolveNote().trim());
      this.toast.success(this.t('reconciliation.toast.resolved'));
      this.cancelResolve();
      await this.loadHistory();
    } catch (error) {
      this.toast.error("Couldn't resolve exception", this.errorMessage(error));
    }
  }

  statusPillKind(status: PosReconciliationStatus): 'green' | 'gold' | 'red' | 'grey' {
    switch (status) {
      case 'matched': return 'green';
      case 'resolved': return 'green';
      case 'exception': return 'red';
      default: return 'grey';
    }
  }

  varianceColor(varianceCents: number | null): string {
    if (varianceCents === null || varianceCents === 0) return 'inherit';
    return varianceCents < 0 ? 'var(--danger, #b3261e)' : 'var(--green, #1c6b3f)';
  }

  formatMoney(cents: number): string {
    const sign = cents < 0 ? '-' : '';
    return `${sign}QAR ${(Math.abs(cents) / 100).toFixed(2)}`;
  }

  private moneyInputToCents(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num < 0) return null;
    return Math.round(num * 100);
  }

  private errorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
      const candidate = error as { message?: string; error?: { message?: string } };
      return candidate.error?.message || candidate.message || 'The request could not be completed.';
    }
    return 'The request could not be completed.';
  }
}
