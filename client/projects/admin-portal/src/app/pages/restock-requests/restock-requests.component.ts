import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import { IconComponent } from '../../shared/icons/icon.component';
import { RestockRequestsService, RestockRequest, RestockSummary } from '../../services/restock-requests.service';
@Component({
  selector: 'ap-restock-requests', imports: [CommonModule, FormsModule, IconComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-fade">
      <div class="heading"><h1 class="card-title">{{ t('restock.title') }}</h1><a class="btn" [href]="exportUrl()"><ap-icon name="download" [size]="16"/> {{ t('restock.export') }}</a></div>
      <form class="card filters" (ngSubmit)="applyFilters()">
        <label>{{ t('restock.status') }}<select class="inp" name="status" [(ngModel)]="status"><option value="">{{ t('restock.all') }}</option>@for (s of statuses; track s) { <option [value]="s">{{ t('restock.' + s) }}</option> }</select></label>
        <label>{{ t('restock.product') }}<input class="inp" name="product" [(ngModel)]="product"></label>
        <label>{{ t('restock.from') }}<input class="inp" type="date" name="from" [(ngModel)]="from"></label>
        <label>{{ t('restock.to') }}<input class="inp" type="date" name="to" [(ngModel)]="to"></label>
        <button class="btn" type="submit">{{ t('restock.filter') }}</button>
      </form>
      @if (error()) { <p role="alert">{{ error() }}</p> }
      @if (loading()) { <p role="status">{{ t('restock.loading') }}</p> }
      <section class="card table-wrap"><h2>{{ t('restock.demand') }}</h2>
        <table><thead><tr><th>{{ t('restock.product') }}</th><th>{{ t('restock.color') }}</th><th>{{ t('restock.size') }}</th><th>{{ t('restock.waiting') }}</th><th>{{ t('restock.oldest') }}</th><th>{{ t('restock.stock') }}</th><th></th></tr></thead>
        <tbody>@for (s of summary(); track s.product_id + s.color_key + s.size) {
          <tr><td>{{ s.product_name }}</td><td>{{ s.color || '—' }}</td><td>{{ sizeLabel(s.size) }}</td><td>{{ s.waiting_count }}</td><td>{{ s.oldest_request | date:'mediumDate' }}</td><td>{{ s.current_stock }}</td><td><button type="button" class="btn" (click)="showDetail(s)">{{ t('restock.details') }}</button></td></tr>
        } @empty { <tr><td colspan="7">{{ t('restock.empty') }}</td></tr> }</tbody></table>
      </section>
      <section class="card table-wrap"><div class="heading"><h2>{{ t('restock.requests') }} · {{ total() }}</h2>@if (selected()) { <button class="btn" (click)="clearDetail()">{{ t('restock.all') }}</button> }</div>
        <table><thead><tr><th>{{ t('restock.product') }}</th><th>{{ t('restock.email') }}</th><th>{{ t('restock.locale') }}</th><th>{{ t('restock.requested') }}</th><th>{{ t('restock.status') }}</th><th>{{ t('restock.attempts') }}</th><th>{{ t('restock.error') }}</th><th></th></tr></thead>
        <tbody>@for (r of rows(); track r.id) { <tr><td>{{ r.product_name }}<small>{{ r.color }} · {{ sizeLabel(r.size) }}</small></td><td>{{ r.email }}</td><td>{{ r.locale }}</td><td>{{ r.requested_at | date:'short' }}</td><td>{{ t('restock.' + r.status) }}</td><td>{{ r.attempts }}</td><td>{{ r.last_error || '—' }}</td><td class="actions">
          @if (r.status !== 'cancelled' && r.status !== 'sending') { <button class="btn" [disabled]="busy() === r.id" (click)="act(r, 'resend')">{{ t('restock.resend') }}</button> }
          @if (r.status !== 'cancelled') { <button class="btn" [disabled]="busy() === r.id" (click)="act(r, 'cancel')">{{ t('restock.cancel') }}</button> }
        </td></tr> } @empty { <tr><td colspan="8">{{ t('restock.empty') }}</td></tr> }</tbody></table>
        <div class="actions"><button class="btn" [disabled]="offset() === 0 || loading()" (click)="page(-100)">{{ t('restock.previous') }}</button><button class="btn" [disabled]="offset() + 100 >= total() || loading()" (click)="page(100)">{{ t('restock.next') }}</button></div>
      </section>
    </div>`,
  styles: [`:host{display:block}.heading,.filters,.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.heading{justify-content:space-between}.filters{padding:20px;margin:20px 0;align-items:end}.filters label{display:grid;gap:8px;flex:1;min-width:140px}.table-wrap{overflow:auto;padding:20px;margin:20px 0}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:start;padding:12px;border-bottom:1px solid var(--border);vertical-align:top}td small{display:block;color:var(--muted)}h2{font-size:18px;margin-bottom:16px}.actions .btn{white-space:nowrap}`],
})
export class RestockRequestsComponent implements OnInit {
  private readonly api = inject(RestockRequestsService);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  readonly t = (key: string) => this.i18n.t(key);
  readonly statuses = ['pending','sending','notified','failed','cancelled'];
  status = 'pending'; product = ''; from = ''; to = '';
  readonly summary = signal<RestockSummary[]>([]); readonly rows = signal<RestockRequest[]>([]);
  readonly total = signal(0); readonly offset = signal(0); readonly selected = signal<RestockSummary | null>(null);
  readonly loading = signal(false); readonly error = signal(''); readonly busy = signal('');
  private applied = 'status=pending'; private loadId = 0;
  ngOnInit() { void this.load(); }
  sizeLabel(size: string) { return size === 'ONE_SIZE' ? this.t('restock.oneSize') : size; }
  private query(detail = true) {
    const q = new URLSearchParams(this.applied);
    const selected = detail ? this.selected() : null;
    if (selected) { q.set('productId', selected.product_id); q.set('color', selected.color_key); q.set('size', selected.size); }
    return q;
  }
  exportUrl() { return this.api.exportUrl(this.query().toString()); }
  applyFilters() {
    this.applied = new URLSearchParams(Object.entries({ status: this.status, product: this.product, from: this.from, to: this.to }).filter(([,v]) => !!v)).toString();
    this.selected.set(null); this.offset.set(0); void this.load();
  }
  showDetail(s: RestockSummary) { this.selected.set(s); this.offset.set(0); void this.load(); }
  clearDetail() { this.selected.set(null); this.offset.set(0); void this.load(); }
  page(delta: number) { this.offset.update(n => Math.max(0, n + delta)); void this.load(); }
  async load() {
    const id = ++this.loadId; this.loading.set(true); this.error.set('');
    try {
      const q = this.query(); q.set('offset', String(this.offset()));
      const [summary, result] = await Promise.all([this.api.summary(this.query(false).toString()), this.api.list(q.toString())]);
      if (id !== this.loadId) return;
      this.summary.set(summary); this.rows.set(result.rows); this.total.set(result.total);
    } catch { if (id === this.loadId) this.error.set(this.t('restock.loadError')); }
    finally { if (id === this.loadId) this.loading.set(false); }
  }
  async act(r: RestockRequest, action: 'resend' | 'cancel') {
    this.busy.set(r.id);
    try { await this.api.action(r.id, action); this.toast.success(this.t('restock.saved')); await this.load(); }
    catch { this.toast.error(this.t('restock.actionError')); }
    finally { this.busy.set(''); }
  }
}
