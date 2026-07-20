import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SortableTableComponent, CellTplDirective, TableColumn } from '../../shared/sortable-table/sortable-table.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { PillComponent, PillKind } from '../../shared/pill/pill.component';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import { PosReconciliationService, PosReconciliationRegister } from '../../services/pos-reconciliation.service';
import {
  PosReportsService,
  PosDailySalesReport,
  PosCashMovementsReport,
  PosCardExceptionRow,
  PosInventoryReport,
  PosRefundVoidReport,
  PosZReportRow,
} from '../../services/pos-reports.service';

type ReportTab = 'daily-sales' | 'cash-movements' | 'card-exceptions' | 'inventory' | 'refund-void' | 'z-history';

@Component({
  selector: 'ap-reports',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, SortableTableComponent, CellTplDirective, SpinnerComponent, PillComponent],
  template: `
    <div class="page-fade">
      <div class="card card-pad mb-16">
        <div class="row gap-sm" style="flex-wrap:wrap;align-items:flex-end;">
          <div>
            <label class="lbl">{{ t('reports.from') }}</label>
            <input class="inp" type="date" [ngModel]="from()" (ngModelChange)="setFrom($event)"/>
          </div>
          <div>
            <label class="lbl">{{ t('reports.to') }}</label>
            <input class="inp" type="date" [ngModel]="to()" (ngModelChange)="setTo($event)"/>
          </div>
          <div>
            <label class="lbl">{{ t('reports.register') }}</label>
            <select class="inp" [ngModel]="registerId()" (ngModelChange)="setRegisterId($event)">
              <option value="">{{ t('reports.allRegisters') }}</option>
              @for (r of registers(); track r.registerId) {
                <option [value]="r.registerId">{{ r.displayName }}</option>
              }
            </select>
          </div>
          <button class="btn btn-outline" (click)="setQuickRange('today')">{{ t('reports.range.today') }}</button>
          <button class="btn btn-outline" (click)="setQuickRange('7d')">{{ t('reports.range.7d') }}</button>
          <button class="btn btn-outline" (click)="setQuickRange('30d')">{{ t('reports.range.30d') }}</button>
        </div>
      </div>

      <div class="tabs mb-16">
        @for (tb of tabs; track tb.key) {
          <button class="tab" [class.active]="tab() === tb.key" (click)="selectTab(tb.key)">{{ t(tb.labelKey) }}</button>
        }
      </div>

      @if (loading()) {
        <div class="row gap-sm" style="padding:60px 0;justify-content:center;">
          <ap-spinner/> <span class="muted small">{{ t('common.loading') }}</span>
        </div>
      } @else {

      @if (tab() === 'daily-sales' && dailySales(); as r) {
        <div class="kpi-row mb-16">
          <div class="kpi-tile"><div class="muted small">{{ t('reports.dailySales.total') }}</div><div class="kpi-value">{{ formatMoney(r.totalCents) }}</div></div>
          <div class="kpi-tile"><div class="muted small">{{ t('reports.dailySales.transactions') }}</div><div class="kpi-value">{{ r.transactionCount }}</div></div>
        </div>
        <div class="row gap-sm mt-8">
          <button class="btn btn-outline btn-sm" (click)="exportDailySales(r)">{{ t('reports.exportCsv') }}</button>
        </div>

        <div class="card mt-16">
          <div class="card-header"><div class="card-title">{{ t('reports.dailySales.byDay') }}</div></div>
          <ap-sortable-table [columns]="dailyByDayColumns" [rows]="r.byDay">
            <ng-template apCellTpl="businessDate" let-row>{{ row.businessDate | date:'MMM d, y' }}</ng-template>
            <ng-template apCellTpl="totalCents" let-row>{{ formatMoney(row.totalCents) }}</ng-template>
          </ap-sortable-table>
        </div>

        <div class="grid-2 mt-16">
          <div class="card">
            <div class="card-header"><div class="card-title">{{ t('reports.dailySales.byPayment') }}</div></div>
            <ap-sortable-table [columns]="dailyByPaymentColumns" [rows]="r.byPaymentMethod">
              <ng-template apCellTpl="totalCents" let-row>{{ formatMoney(row.totalCents) }}</ng-template>
            </ap-sortable-table>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">{{ t('reports.dailySales.byCashier') }}</div></div>
            <ap-sortable-table [columns]="dailyByCashierColumns" [rows]="r.byCashier">
              <ng-template apCellTpl="totalCents" let-row>{{ formatMoney(row.totalCents) }}</ng-template>
            </ap-sortable-table>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">{{ t('reports.dailySales.byRegister') }}</div></div>
            <ap-sortable-table [columns]="dailyByRegisterColumns" [rows]="r.byRegister">
              <ng-template apCellTpl="totalCents" let-row>{{ formatMoney(row.totalCents) }}</ng-template>
            </ap-sortable-table>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">{{ t('reports.dailySales.byHour') }}</div></div>
            <ap-sortable-table [columns]="dailyByHourColumns" [rows]="r.byHour">
              <ng-template apCellTpl="hourOfDay" let-row>{{ row.hourOfDay }}:00</ng-template>
              <ng-template apCellTpl="totalCents" let-row>{{ formatMoney(row.totalCents) }}</ng-template>
            </ap-sortable-table>
          </div>
        </div>

        <div class="card mt-16">
          <div class="card-header"><div class="card-title">{{ t('reports.dailySales.byItem') }}</div></div>
          <ap-sortable-table [columns]="dailyByItemColumns" [rows]="r.byItem">
            <ng-template apCellTpl="totalCents" let-row>{{ formatMoney(row.totalCents) }}</ng-template>
          </ap-sortable-table>
        </div>
      }

      @if (tab() === 'cash-movements' && cashMovementsReport(); as r) {
        <div class="row gap-sm mb-8">
          <button class="btn btn-outline btn-sm" (click)="exportCashMovements(r)">{{ t('reports.exportCsv') }}</button>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">{{ t('reports.cashMovements.movements') }}</div></div>
          <ap-sortable-table [columns]="cashMovementColumns" [rows]="r.movements">
            <ng-template apCellTpl="createdAt" let-row>{{ row.createdAt | date:'MMM d, HH:mm' }}</ng-template>
            <ng-template apCellTpl="kind" let-row>{{ cashMovementKindLabel(row.kind) }}</ng-template>
            <ng-template apCellTpl="amountCents" let-row>{{ formatMoney(row.amountCents) }}</ng-template>
          </ap-sortable-table>
        </div>
        <div class="card mt-16">
          <div class="card-header"><div class="card-title">{{ t('reports.cashMovements.variance') }}</div></div>
          <ap-sortable-table [columns]="zVarianceColumns" [rows]="r.zReportVariances">
            <ng-template apCellTpl="createdAt" let-row>{{ row.createdAt | date:'MMM d, y' }}</ng-template>
            <ng-template apCellTpl="expectedCashCents" let-row>{{ formatMoney(row.expectedCashCents) }}</ng-template>
            <ng-template apCellTpl="physicalCashCents" let-row>{{ formatMoney(row.physicalCashCents) }}</ng-template>
            <ng-template apCellTpl="varianceCents" let-row><span [style.color]="varianceColor(row.varianceCents)">{{ formatMoney(row.varianceCents) }}</span></ng-template>
          </ap-sortable-table>
        </div>
      }

      @if (tab() === 'card-exceptions' && cardExceptions(); as rows) {
        <div class="row gap-sm mb-8">
          <button class="btn btn-outline btn-sm" (click)="exportCardExceptions(rows)">{{ t('reports.exportCsv') }}</button>
        </div>
        <div class="card">
          <ap-sortable-table [columns]="cardExceptionColumns" [rows]="rows">
            <ng-template apCellTpl="businessDate" let-row>{{ row.businessDate | date:'MMM d, y' }}</ng-template>
            <ng-template apCellTpl="posTotalCents" let-row>{{ formatMoney(row.posTotalCents) }}</ng-template>
            <ng-template apCellTpl="settlementTotalCents" let-row>{{ row.settlementTotalCents === null ? '—' : formatMoney(row.settlementTotalCents) }}</ng-template>
            <ng-template apCellTpl="varianceCents" let-row>{{ row.varianceCents === null ? '—' : formatMoney(row.varianceCents) }}</ng-template>
            <ng-template apCellTpl="status" let-row><ap-pill [kind]="statusPillKind(row.status)">{{ row.status }}</ap-pill></ng-template>
          </ap-sortable-table>
        </div>
      }

      @if (tab() === 'inventory' && inventoryReport(); as r) {
        <div class="row gap-sm mb-8">
          <button class="btn btn-outline btn-sm" (click)="exportInventory(r)">{{ t('reports.exportCsv') }}</button>
        </div>
        @if (r.driftAlerts.length) {
          <div class="card mb-16" style="border-color:var(--danger,#b3261e);">
            <div class="card-header"><div class="card-title" style="color:var(--danger,#b3261e);">{{ t('reports.inventory.driftAlerts') }}</div></div>
            <ap-sortable-table [columns]="driftColumns" [rows]="r.driftAlerts"/>
          </div>
        }
        <div class="card">
          <div class="card-header"><div class="card-title">{{ t('reports.inventory.byReason') }}</div></div>
          <ap-sortable-table [columns]="byReasonColumns" [rows]="r.byReason"/>
        </div>
        <div class="card mt-16">
          <div class="card-header"><div class="card-title">{{ t('reports.inventory.movements') }}</div></div>
          <ap-sortable-table [columns]="inventoryMovementColumns" [rows]="r.movements">
            <ng-template apCellTpl="occurredAt" let-row>{{ row.occurredAt | date:'MMM d, HH:mm' }}</ng-template>
          </ap-sortable-table>
        </div>
      }

      @if (tab() === 'refund-void' && refundVoidReport(); as r) {
        <div class="row gap-sm mb-8">
          <button class="btn btn-outline btn-sm" (click)="exportRefundVoid(r)">{{ t('reports.exportCsv') }}</button>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">{{ t('reports.refundVoid.voids') }}</div></div>
          <ap-sortable-table [columns]="voidColumns" [rows]="r.voids">
            <ng-template apCellTpl="createdAt" let-row>{{ row.createdAt | date:'MMM d, HH:mm' }}</ng-template>
            <ng-template apCellTpl="amountCents" let-row>{{ formatMoney(row.amountCents) }}</ng-template>
          </ap-sortable-table>
        </div>
        <div class="card mt-16">
          <div class="card-header"><div class="card-title">{{ t('reports.refundVoid.refunds') }}</div></div>
          <ap-sortable-table [columns]="refundColumns" [rows]="r.refunds">
            <ng-template apCellTpl="createdAt" let-row>{{ row.createdAt | date:'MMM d, HH:mm' }}</ng-template>
            <ng-template apCellTpl="amountCents" let-row>{{ formatMoney(row.amountCents) }}</ng-template>
          </ap-sortable-table>
        </div>
      }

      @if (tab() === 'z-history' && zHistory(); as rows) {
        <div class="row gap-sm mb-8">
          <button class="btn btn-outline btn-sm" (click)="exportZHistory(rows)">{{ t('reports.exportCsv') }}</button>
        </div>
        <div class="card">
          <ap-sortable-table [columns]="zHistoryColumns" [rows]="rows">
            <ng-template apCellTpl="createdAt" let-row>{{ row.createdAt | date:'MMM d, y HH:mm' }}</ng-template>
            <ng-template apCellTpl="netSalesCents" let-row>{{ formatMoney(row.netSalesCents) }}</ng-template>
            <ng-template apCellTpl="expectedCashCents" let-row>{{ formatMoney(row.expectedCashCents) }}</ng-template>
            <ng-template apCellTpl="physicalCashCents" let-row>{{ formatMoney(row.physicalCashCents) }}</ng-template>
            <ng-template apCellTpl="varianceCents" let-row><span [style.color]="varianceColor(row.varianceCents)">{{ formatMoney(row.varianceCents) }}</span></ng-template>
          </ap-sortable-table>
        </div>
      }

      }
    </div>
  `,
  styles: [`
    .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .kpi-tile { background: #fff; border: 1px solid var(--border, #e5e7eb); border-radius: 10px; padding: 14px 16px; }
    .kpi-value { font-size: 20px; font-weight: 700; margin-top: 4px; }
  `],
})
export class ReportsComponent implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly reportsApi = inject(PosReportsService);
  private readonly reconciliationApi = inject(PosReconciliationService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly tabs: { key: ReportTab; labelKey: string }[] = [
    { key: 'daily-sales', labelKey: 'reports.tab.dailySales' },
    { key: 'cash-movements', labelKey: 'reports.tab.cashMovements' },
    { key: 'card-exceptions', labelKey: 'reports.tab.cardExceptions' },
    { key: 'inventory', labelKey: 'reports.tab.inventory' },
    { key: 'refund-void', labelKey: 'reports.tab.refundVoid' },
    { key: 'z-history', labelKey: 'reports.tab.zHistory' },
  ];

  readonly tab = signal<ReportTab>('daily-sales');
  readonly loading = signal(false);
  readonly registers = signal<PosReconciliationRegister[]>([]);
  readonly from = signal(this.daysAgo(7));
  readonly to = signal(this.daysAgo(0));
  readonly registerId = signal('');

  readonly dailySales = signal<PosDailySalesReport | null>(null);
  readonly cashMovementsReport = signal<PosCashMovementsReport | null>(null);
  readonly cardExceptions = signal<PosCardExceptionRow[] | null>(null);
  readonly inventoryReport = signal<PosInventoryReport | null>(null);
  readonly refundVoidReport = signal<PosRefundVoidReport | null>(null);
  readonly zHistory = signal<PosZReportRow[] | null>(null);

  readonly dailyByDayColumns: TableColumn[] = [
    { key: 'businessDate', label: 'Date' },
    { key: 'totalCents', label: 'Total', align: 'right' },
    { key: 'transactionCount', label: 'Transactions', align: 'right' },
  ];
  readonly dailyByPaymentColumns: TableColumn[] = [
    { key: 'paymentMethod', label: 'Method' },
    { key: 'totalCents', label: 'Total', align: 'right' },
    { key: 'transactionCount', label: 'Count', align: 'right' },
  ];
  readonly dailyByCashierColumns: TableColumn[] = [
    { key: 'cashierName', label: 'Cashier' },
    { key: 'totalCents', label: 'Total', align: 'right' },
    { key: 'transactionCount', label: 'Count', align: 'right' },
  ];
  readonly dailyByRegisterColumns: TableColumn[] = [
    { key: 'registerName', label: 'Register' },
    { key: 'totalCents', label: 'Total', align: 'right' },
    { key: 'transactionCount', label: 'Count', align: 'right' },
  ];
  readonly dailyByHourColumns: TableColumn[] = [
    { key: 'hourOfDay', label: 'Hour' },
    { key: 'totalCents', label: 'Total', align: 'right' },
    { key: 'transactionCount', label: 'Count', align: 'right' },
  ];
  readonly dailyByItemColumns: TableColumn[] = [
    { key: 'productName', label: 'Product' },
    { key: 'variantTitle', label: 'Variant' },
    { key: 'sku', label: 'SKU' },
    { key: 'quantity', label: 'Qty', align: 'right' },
    { key: 'totalCents', label: 'Total', align: 'right' },
  ];
  readonly cashMovementColumns: TableColumn[] = [
    { key: 'createdAt', label: 'When' },
    { key: 'kind', label: 'Type' },
    { key: 'amountCents', label: 'Amount', align: 'right' },
    { key: 'reason', label: 'Reason' },
    { key: 'cashierName', label: 'Cashier' },
    { key: 'managerName', label: 'Manager' },
    { key: 'registerName', label: 'Register' },
  ];
  readonly zVarianceColumns: TableColumn[] = [
    { key: 'createdAt', label: 'Date' },
    { key: 'registerName', label: 'Register' },
    { key: 'expectedCashCents', label: 'Expected', align: 'right' },
    { key: 'physicalCashCents', label: 'Physical', align: 'right' },
    { key: 'varianceCents', label: 'Variance', align: 'right' },
  ];
  readonly cardExceptionColumns: TableColumn[] = [
    { key: 'businessDate', label: 'Date' },
    { key: 'registerName', label: 'Register' },
    { key: 'posTotalCents', label: 'POS Total', align: 'right' },
    { key: 'settlementTotalCents', label: 'Settlement', align: 'right' },
    { key: 'varianceCents', label: 'Variance', align: 'right' },
    { key: 'status', label: 'Status' },
  ];
  readonly byReasonColumns: TableColumn[] = [
    { key: 'reason', label: 'Reason' },
    { key: 'netDelta', label: 'Net Delta', align: 'right' },
    { key: 'movementCount', label: 'Movements', align: 'right' },
  ];
  readonly inventoryMovementColumns: TableColumn[] = [
    { key: 'occurredAt', label: 'When' },
    { key: 'productName', label: 'Product' },
    { key: 'sku', label: 'SKU' },
    { key: 'reason', label: 'Reason' },
    { key: 'delta', label: 'Delta', align: 'right' },
  ];
  readonly driftColumns: TableColumn[] = [
    { key: 'sku', label: 'SKU' },
    { key: 'currentStock', label: 'Current', align: 'right' },
    { key: 'baselineStock', label: 'Baseline', align: 'right' },
    { key: 'ledgerDeltaTotal', label: 'Ledger Delta', align: 'right' },
    { key: 'drift', label: 'Drift', align: 'right' },
  ];
  readonly voidColumns: TableColumn[] = [
    { key: 'createdAt', label: 'When' },
    { key: 'amountCents', label: 'Amount', align: 'right' },
    { key: 'reason', label: 'Reason' },
    { key: 'cashierName', label: 'Cashier' },
    { key: 'managerName', label: 'Manager' },
    { key: 'registerName', label: 'Register' },
  ];
  readonly refundColumns: TableColumn[] = [
    { key: 'createdAt', label: 'When' },
    { key: 'amountCents', label: 'Amount', align: 'right' },
    { key: 'method', label: 'Method' },
    { key: 'reason', label: 'Reason' },
    { key: 'cashierName', label: 'Cashier' },
    { key: 'managerName', label: 'Manager' },
    { key: 'registerName', label: 'Register' },
  ];
  readonly zHistoryColumns: TableColumn[] = [
    { key: 'createdAt', label: 'Closed' },
    { key: 'registerName', label: 'Register' },
    { key: 'netSalesCents', label: 'Net Sales', align: 'right' },
    { key: 'expectedCashCents', label: 'Expected', align: 'right' },
    { key: 'physicalCashCents', label: 'Physical', align: 'right' },
    { key: 'varianceCents', label: 'Variance', align: 'right' },
  ];

  async ngOnInit(): Promise<void> {
    try {
      this.registers.set(await this.reconciliationApi.listRegisters());
    } catch {
      // Global interceptor surfaces the error.
    }
    await this.loadActiveTab();
  }

  selectTab(key: ReportTab): void {
    this.tab.set(key);
    void this.loadActiveTab();
  }

  setFrom(value: string): void { this.from.set(value); void this.loadActiveTab(); }
  setTo(value: string): void { this.to.set(value); void this.loadActiveTab(); }
  setRegisterId(value: string): void { this.registerId.set(value); void this.loadActiveTab(); }

  setQuickRange(range: 'today' | '7d' | '30d'): void {
    const days = range === 'today' ? 0 : range === '7d' ? 7 : 30;
    this.from.set(this.daysAgo(days));
    this.to.set(this.daysAgo(0));
    void this.loadActiveTab();
  }

  private daysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  }

  private filter() {
    return { from: this.from(), to: this.to(), registerId: this.registerId() || undefined };
  }

  async loadActiveTab(): Promise<void> {
    this.loading.set(true);
    try {
      const filter = this.filter();
      switch (this.tab()) {
        case 'daily-sales':
          this.dailySales.set(await this.reportsApi.dailySales(filter));
          break;
        case 'cash-movements':
          this.cashMovementsReport.set(await this.reportsApi.cashMovements(filter));
          break;
        case 'card-exceptions':
          this.cardExceptions.set(await this.reportsApi.cardSettlementExceptions(filter));
          break;
        case 'inventory':
          this.inventoryReport.set(await this.reportsApi.inventoryMovements(filter));
          break;
        case 'refund-void':
          this.refundVoidReport.set(await this.reportsApi.refundVoidExceptions(filter));
          break;
        case 'z-history':
          this.zHistory.set(await this.reportsApi.zReportHistory(filter));
          break;
      }
    } catch (error) {
      this.toast.warning("Couldn't load report", this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  formatMoney(cents: number): string {
    const sign = cents < 0 ? '-' : '';
    return `${sign}QAR ${(Math.abs(cents) / 100).toFixed(2)}`;
  }

  /** CSV cells write the raw ISO timestamp otherwise (e.g.
   *  "2026-07-19T21:51:35.973Z") — this matches the on-screen tables'
   *  `date` pipe formatting so exported files read the same way. */
  formatDateTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return `${this.formatDate(iso)} ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  }

  formatDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  varianceColor(varianceCents: number): string {
    if (varianceCents === 0) return 'inherit';
    return varianceCents < 0 ? 'var(--danger, #b3261e)' : 'var(--green, #1c6b3f)';
  }

  statusPillKind(status: string): PillKind {
    switch (status) {
      case 'matched': case 'resolved': return 'green';
      case 'exception': return 'red';
      default: return 'grey';
    }
  }

  private static readonly CASH_MOVEMENT_LABELS: Record<string, string> = {
    paid_in: 'Paid In',
    paid_out: 'Paid Out',
    safe_drop: 'Safe Drop',
    float_adjust: 'Float Adjust',
    no_sale_drawer_open: 'No-Sale Drawer Open',
  };

  cashMovementKindLabel(kind: string): string {
    return ReportsComponent.CASH_MOVEMENT_LABELS[kind] || kind;
  }

  private downloadCsv(filename: string, header: string[], rows: (string | number)[][]): void {
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    // BOM-prefixed for Excel compatibility with non-ASCII (Arabic) content.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  exportDailySales(r: PosDailySalesReport): void {
    this.downloadCsv(`daily-sales-${this.from()}-${this.to()}.csv`,
      ['Date', 'Total', 'Transactions'],
      r.byDay.map((row) => [this.formatDate(row.businessDate), this.formatMoney(row.totalCents), row.transactionCount]));
  }

  exportCashMovements(r: PosCashMovementsReport): void {
    this.downloadCsv(`cash-movements-${this.from()}-${this.to()}.csv`,
      ['When', 'Type', 'Amount', 'Reason', 'Cashier', 'Manager', 'Register'],
      r.movements.map((m) => [this.formatDateTime(m.createdAt), this.cashMovementKindLabel(m.kind), this.formatMoney(m.amountCents), m.reason, m.cashierName, m.managerName || '', m.registerName]));
  }

  exportCardExceptions(rows: PosCardExceptionRow[]): void {
    this.downloadCsv(`card-settlement-exceptions-${this.from()}-${this.to()}.csv`,
      ['Date', 'Register', 'POS Total', 'Settlement', 'Variance', 'Status'],
      rows.map((r) => [this.formatDate(r.businessDate), r.registerName, this.formatMoney(r.posTotalCents), r.settlementTotalCents === null ? '' : this.formatMoney(r.settlementTotalCents), r.varianceCents === null ? '' : this.formatMoney(r.varianceCents), r.status]));
  }

  exportInventory(r: PosInventoryReport): void {
    this.downloadCsv(`inventory-movements-${this.from()}-${this.to()}.csv`,
      ['When', 'Product', 'SKU', 'Reason', 'Delta'],
      r.movements.map((m) => [this.formatDateTime(m.occurredAt), m.productName, m.sku || '', m.reason, m.delta]));
  }

  exportRefundVoid(r: PosRefundVoidReport): void {
    const rows: (string | number)[][] = [
      ...r.voids.map((v) => ['Void', this.formatDateTime(v.createdAt), this.formatMoney(v.amountCents), v.reason, v.cashierName, v.managerName, v.registerName]),
      ...r.refunds.map((rf) => ['Refund', this.formatDateTime(rf.createdAt), this.formatMoney(rf.amountCents), rf.reason, rf.cashierName, rf.managerName, rf.registerName]),
    ];
    this.downloadCsv(`refund-void-exceptions-${this.from()}-${this.to()}.csv`,
      ['Type', 'When', 'Amount', 'Reason', 'Cashier', 'Manager', 'Register'], rows);
  }

  exportZHistory(rows: PosZReportRow[]): void {
    this.downloadCsv(`z-report-history-${this.from()}-${this.to()}.csv`,
      ['Closed', 'Register', 'Net Sales', 'Expected Cash', 'Physical Cash', 'Variance'],
      rows.map((r) => [this.formatDateTime(r.createdAt), r.registerName, this.formatMoney(r.netSalesCents), this.formatMoney(r.expectedCashCents), this.formatMoney(r.physicalCashCents), this.formatMoney(r.varianceCents)]));
  }

  private errorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
      const candidate = error as { message?: string; error?: { message?: string } };
      return candidate.error?.message || candidate.message || 'The request could not be completed.';
    }
    return 'The request could not be completed.';
  }
}
