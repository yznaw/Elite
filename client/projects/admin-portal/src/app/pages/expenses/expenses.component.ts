import { Component, OnInit, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { ExpenseDrawerComponent } from './expense-drawer.component';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import { AdminExpensesService } from '../../services/admin-expenses.service';
import { EXPENSE_CATEGORIES, Expense, ExpenseCategory, formatQAR } from '../../models';

type PillKind = 'green' | 'amber' | 'red' | 'blue' | 'grey' | 'gold';

// One colour per category, so the same expense type reads the same way here
// and in the Analytics breakdown.
const CATEGORY_COLORS: Record<ExpenseCategory, PillKind> = {
  rent:        'blue',
  salaries:    'green',
  utilities:   'gold',
  marketing:   'amber',
  logistics:   'blue',
  supplies:    'grey',
  software:    'blue',
  fees:        'red',
  maintenance: 'amber',
  other:       'grey',
};

@Component({
    selector: 'ap-expenses',
    imports: [CommonModule, FormsModule, IconComponent, PillComponent, EmptyStateComponent, ExpenseDrawerComponent],
    changeDetection: ChangeDetectionStrategy.Eager,
    template: `
    <div class="page-fade">

      <div class="page-header">
        <div>
          <div class="page-title">{{ t('expenses.title') }}</div>
          <div class="page-sub muted small">{{ t('nav.expenses.sub') }}</div>
        </div>
        <div class="row gap-sm">
          <button class="btn btn-outline btn-sm" type="button" (click)="exportCsv()" [disabled]="exporting()">
            <ap-icon name="csv" [size]="13"/>
            <span class="btn-lbl">{{ t('expenses.export') }}</span>
          </button>
          <button class="btn btn-gold" type="button" (click)="openNew()">
            <ap-icon name="plus" [size]="14"/>
            <span class="btn-lbl">{{ t('expenses.new') }}</span>
          </button>
        </div>
      </div>

      <!-- Range + totals -->
      <div class="card mb-20" style="padding:14px 16px;">
        <div class="filters">
          <div class="fld">
            <label class="lbl" for="exp-from">{{ t('expenses.filter.from') }}</label>
            <input id="exp-from" class="inp" type="date" [(ngModel)]="from" (ngModelChange)="reload()"/>
          </div>
          <div class="fld">
            <label class="lbl" for="exp-to">{{ t('expenses.filter.to') }}</label>
            <input id="exp-to" class="inp" type="date" [(ngModel)]="to" (ngModelChange)="reload()"/>
          </div>
          <div class="fld">
            <label class="lbl" for="exp-catf">{{ t('expenses.filter.category') }}</label>
            <select id="exp-catf" class="inp" [(ngModel)]="categoryFilter">
              <option value="">{{ t('expenses.filter.allCategories') }}</option>
              @for (c of categories; track c) {
                <option [value]="c">{{ t('expenses.category.' + c) }}</option>
              }
            </select>
          </div>
          <div class="fld grow">
            <label class="lbl" for="exp-q">{{ t('expenses.filter.search') }}</label>
            <input id="exp-q" class="inp" type="text" [(ngModel)]="searchQuery"
                   [placeholder]="t('expenses.filter.searchPlaceholder')"/>
          </div>
        </div>
      </div>

      <!-- Totals -->
      @if (!loading() && expenses().length > 0) {
        <div class="totals mb-20">
          <div class="total-card">
            <div class="total-lbl">{{ t('expenses.total') }}</div>
            <div class="total-val mono">{{ fmt(rangeTotal()) }}</div>
            <div class="total-sub muted">{{ filtered().length }} {{ t('expenses.entries') }}</div>
          </div>
          @for (c of topCategories(); track c.category) {
            <div class="total-card">
              <div class="total-lbl">{{ t('expenses.category.' + c.category) }}</div>
              <div class="total-val mono">{{ fmt(c.total) }}</div>
              <div class="total-sub muted">{{ c.pct }}% {{ t('expenses.ofTotal') }}</div>
            </div>
          }
        </div>
      }

      @if (loading()) {
        <div class="card" style="padding:40px;text-align:center;">
          <span class="muted small">{{ t('common.loading') }}</span>
        </div>
      } @else if (expenses().length === 0) {
        <div class="card">
          <ap-empty-state icon="expenses" [title]="t('expenses.empty.title')" [sub]="t('expenses.empty.sub')">
            <div class="row gap-sm" style="justify-content:center;flex-wrap:wrap;">
              <button class="btn btn-gold btn-sm" type="button" (click)="openNew()">
                <ap-icon name="plus" [size]="12"/>
                {{ t('expenses.new') }}
              </button>
              <button class="btn btn-outline btn-sm" type="button" (click)="importPos()" [disabled]="importing()">
                {{ t('expenses.importPos') }}
              </button>
            </div>
          </ap-empty-state>
        </div>
      } @else if (filtered().length === 0) {
        <div class="card">
          <ap-empty-state icon="search" [title]="t('expenses.noMatch.title')" [sub]="t('expenses.noMatch.sub')">
            <button class="btn btn-outline btn-sm" type="button" (click)="clearFilters()">
              {{ t('common.clearFilters') }}
            </button>
          </ap-empty-state>
        </div>
      } @else {
        <div class="card">
          <div class="table-wrap">
            <table class="exp-table">
              <thead>
                <tr>
                  <th>{{ t('expenses.col.date') }}</th>
                  <th>{{ t('expenses.col.category') }}</th>
                  <th>{{ t('expenses.col.vendor') }}</th>
                  <th>{{ t('expenses.col.payment') }}</th>
                  <th style="text-align:right;">{{ t('expenses.col.amount') }}</th>
                  <th style="width:32px;"></th>
                </tr>
              </thead>
              <tbody>
                @for (e of filtered(); track e.id + e.expenseDate) {
                  <tr (click)="openExpense(e)" [class.projected]="e.isProjected">
                    <td class="mono nowrap">
                      {{ formatDate(e.expenseDate) }}
                      @if (e.isProjected) {
                        <ap-pill kind="blue">{{ t('expenses.projected') }}</ap-pill>
                      }
                    </td>
                    <td><ap-pill [kind]="catColor(e.category)">{{ t('expenses.category.' + e.category) }}</ap-pill></td>
                    <td class="ellipsis">{{ e.vendor || '—' }}</td>
                    <td class="muted small nowrap">{{ t('expenses.payment.' + e.paymentMethod) }}</td>
                    <td style="text-align:right;" class="mono strong">{{ fmt(e.amount) }}</td>
                    <td>
                      @if (e.receiptUrl) {
                        <ap-icon name="docs" [size]="13"/>
                      }
                    </td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="4" class="strong">{{ t('expenses.total') }}</td>
                  <td style="text-align:right;" class="mono strong">{{ fmt(filteredTotal()) }}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="row gap-sm mt-16" style="justify-content:flex-end;">
          <button class="btn btn-outline btn-xs" type="button" (click)="importPos()" [disabled]="importing()">
            {{ importing() ? t('common.loading') : t('expenses.importPos') }}
          </button>
        </div>
      }
    </div>

    <ap-expense-drawer
      [open]="drawerOpen()"
      [expense]="selected()"
      (closeDrawer)="closeDrawer()"
      (saved)="onSaved()"
      (deleted)="onDeleted($event)"
    />
  `,
    styles: [`
    :host { display: block; }

    .page-header {
      display: flex; align-items: flex-start;
      justify-content: space-between; gap: 16px; margin-bottom: 24px;
    }
    .page-title { font-size: 22px; font-weight: 700; color: var(--ink); }
    .page-sub { margin-top: 2px; }

    .filters { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
    .filters .fld { display: flex; flex-direction: column; gap: 5px; min-width: 140px; }
    .filters .fld.grow { flex: 1; min-width: 200px; }
    .lbl { font-size: 11px; font-weight: 600; text-transform: uppercase;
           letter-spacing: .05em; color: var(--muted); }

    .totals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    @media (max-width: 860px) { .totals { grid-template-columns: repeat(2, 1fr); } }
    .total-card {
      background: var(--bg-2); border: 1px solid var(--border);
      border-radius: 10px; padding: 14px 16px;
    }
    .total-lbl {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: .05em; color: var(--muted); margin-bottom: 6px;
    }
    .total-val { font-size: 20px; font-weight: 800; line-height: 1; }
    .total-sub { font-size: 11px; margin-top: 4px; }

    .table-wrap { overflow-x: auto; }
    .exp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .exp-table th {
      text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border);
      font-size: 10px; text-transform: uppercase; letter-spacing: .05em;
      color: var(--muted); font-weight: 700; white-space: nowrap;
    }
    .exp-table td { padding: 11px 12px; border-bottom: 1px solid rgba(0,0,0,.04); vertical-align: middle; }
    .exp-table tbody tr { cursor: pointer; transition: background .12s; }
    .exp-table tbody tr:hover td { background: var(--bg-2); }
    .exp-table tbody tr.projected td { opacity: .72; }
    .exp-table tfoot td {
      padding: 12px; border-top: 1px solid var(--border);
      border-bottom: none; font-size: 13px;
    }

    .nowrap { white-space: nowrap; }
    .ellipsis { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mono { font-variant-numeric: tabular-nums; }
    .mt-16 { margin-top: 16px; }
  `]
})
export class ExpensesComponent implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly svc = inject(AdminExpensesService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly categories = EXPENSE_CATEGORIES;

  readonly loading = signal(true);
  readonly exporting = signal(false);
  readonly importing = signal(false);
  readonly expenses = signal<Expense[]>([]);
  readonly drawerOpen = signal(false);
  readonly selected = signal<Expense | null>(null);

  // Defaults to the last 3 months, which is long enough for a recurring bill
  // to show more than one occurrence.
  from = this.isoDaysAgo(90);
  to = this.isoDaysAgo(0);
  categoryFilter: ExpenseCategory | '' = '';
  searchQuery = '';

  readonly filtered = computed(() => {
    const q = this.searchQuery.toLowerCase().trim();
    const cat = this.categoryFilter;
    return this.expenses().filter((e) => {
      const matchCat = !cat || e.category === cat;
      const matchQ = !q
        || e.vendor.toLowerCase().includes(q)
        || e.note.toLowerCase().includes(q);
      return matchCat && matchQ;
    });
  });

  readonly rangeTotal = computed(() =>
    round2(this.expenses().reduce((sum, e) => sum + e.amount, 0)));

  readonly filteredTotal = computed(() =>
    round2(this.filtered().reduce((sum, e) => sum + e.amount, 0)));

  /** The three biggest categories in the window, for the summary strip. */
  readonly topCategories = computed(() => {
    const totals = new Map<ExpenseCategory, number>();
    for (const e of this.expenses()) {
      totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
    }
    const grand = this.rangeTotal();
    return [...totals.entries()]
      .map(([category, total]) => ({
        category,
        total: round2(total),
        pct: grand ? Math.round((total / grand) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
  });

  private isoDaysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  fmt(v: number): string {
    return formatQAR(v, 2);
  }

  catColor(c: ExpenseCategory): PillKind {
    return CATEGORY_COLORS[c];
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await this.svc.list({ from: this.from, to: this.to });
      this.expenses.set(res.expenses);
    } catch {
      this.toast.error(this.t('expenses.loadError'));
    } finally {
      this.loading.set(false);
    }
  }

  openNew(): void {
    this.selected.set(null);
    this.drawerOpen.set(true);
  }

  openExpense(e: Expense): void {
    this.selected.set(e);
    this.drawerOpen.set(true);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
    this.selected.set(null);
  }

  // A save can materialise a projected occurrence or shift a date out of the
  // current window, so refetch rather than patching the list in place.
  async onSaved(): Promise<void> {
    await this.reload();
  }

  onDeleted(id: string): void {
    this.expenses.update((list) => list.filter((e) => e.id !== id));
  }

  clearFilters(): void {
    this.categoryFilter = '';
    this.searchQuery = '';
  }

  async exportCsv(): Promise<void> {
    this.exporting.set(true);
    try {
      await this.svc.exportCsv({
        from: this.from,
        to: this.to,
        category: this.categoryFilter,
      });
    } catch {
      this.toast.error(this.t('expenses.exportError'));
    } finally {
      this.exporting.set(false);
    }
  }

  async importPos(): Promise<void> {
    this.importing.set(true);
    try {
      const res = await this.svc.importPosCashOuts({ from: this.from, to: this.to });
      this.toast.success(
        res.imported === 0
          ? this.t('expenses.importNone')
          : `${this.t('expenses.importDone')} (${res.imported})`,
      );
      if (res.imported > 0) await this.reload();
    } catch {
      this.toast.error(this.t('expenses.importError'));
    } finally {
      this.importing.set(false);
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
