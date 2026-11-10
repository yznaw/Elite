import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';
import {
  Expense, ExpenseCategory, ExpenseListResult, ExpensePaymentMethod,
  ExpenseRecurrence, ExpenseSummary,
} from '../models';

export interface ExpensePayload {
  expenseDate?: string;
  category?: ExpenseCategory;
  amount?: number;
  vendor?: string;
  paymentMethod?: ExpensePaymentMethod;
  note?: string;
  receiptMediaId?: string | null;
  recurrence?: ExpenseRecurrence;
  recurrenceParentId?: string | null;
}

export interface ExpenseQuery {
  from?: string;
  to?: string;
  category?: ExpenseCategory | '';
  search?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminExpensesService {
  private readonly api = inject(ApiClient);

  private qs(query: ExpenseQuery): string {
    const params = new URLSearchParams();
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.category) params.set('category', query.category);
    if (query.search) params.set('search', query.search);
    const s = params.toString();
    return s ? `?${s}` : '';
  }

  list(query: ExpenseQuery = {}): Promise<ExpenseListResult> {
    return firstValueFrom(this.api.get<ExpenseListResult>(`/admin/expenses${this.qs(query)}`));
  }

  summary(query: ExpenseQuery = {}): Promise<ExpenseSummary> {
    return firstValueFrom(this.api.get<ExpenseSummary>(`/admin/expenses/summary${this.qs(query)}`));
  }

  create(payload: ExpensePayload): Promise<Expense> {
    return firstValueFrom(this.api.post<Expense>('/admin/expenses', payload));
  }

  update(id: string, payload: ExpensePayload): Promise<Expense> {
    return firstValueFrom(this.api.patch<Expense>(`/admin/expenses/${id}`, payload));
  }

  delete(id: string): Promise<{ id: string }> {
    return firstValueFrom(this.api.delete<{ id: string }>(`/admin/expenses/${id}`));
  }

  importPosCashOuts(range: { from?: string; to?: string } = {}): Promise<{ imported: number }> {
    return firstValueFrom(this.api.post<{ imported: number }>('/admin/expenses/import-pos-cash-outs', range));
  }

  /**
   * The CSV lives behind the admin session, so it cannot be a plain anchor
   * href. Fetch it with credentials, then hand the browser a blob to save.
   */
  async exportCsv(query: ExpenseQuery = {}): Promise<void> {
    const res = await fetch(this.api.url(`/admin/expenses/export.csv${this.qs(query)}`), {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses-${query.from ?? 'all'}-to-${query.to ?? 'now'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
