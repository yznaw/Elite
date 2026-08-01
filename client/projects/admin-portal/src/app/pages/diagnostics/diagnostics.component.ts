import { Component, OnInit, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import {
  AppErrorRow,
  AppErrorSummary,
  AuditEventRow,
  DiagnosticsService,
} from '../../services/diagnostics.service';

type Tab = 'errors' | 'audit';

/**
 * Diagnostics: grouped application errors and the audit trail.
 *
 * Two gaps closed here. First, errors from the register's browser, the server
 * and CSP now have somewhere an owner can actually look — previously a fault in
 * the shop had to be reproduced over the phone. Second, `audit_events` has been
 * written since migration 001 and had **no UI at all**, so the audit trail that
 * exists to protect the owner required psql to read.
 */
@Component({
    selector: 'ap-diagnostics',
    imports: [CommonModule, DatePipe, FormsModule, IconComponent, PillComponent, SpinnerComponent],
    template: `
    <div class="page-fade">
      <div class="row gap-sm mb-16" style="flex-wrap:wrap;align-items:center;">
        <button class="btn" [class.btn-gold]="tab() === 'errors'" [class.btn-outline]="tab() !== 'errors'"
                (click)="setTab('errors')">{{ t('diagnostics.tab.errors') }}</button>
        <button class="btn" [class.btn-gold]="tab() === 'audit'" [class.btn-outline]="tab() !== 'audit'"
                (click)="setTab('audit')">{{ t('diagnostics.tab.audit') }}</button>
      </div>

      @if (tab() === 'errors') {
        <div class="kpi-row mb-16">
          <div class="card card-pad">
            <div class="muted small">{{ t('diagnostics.kpi.open') }}</div>
            <div class="kpi-value">{{ summary()?.openCount ?? 0 }}</div>
          </div>
          <div class="card card-pad">
            <div class="muted small">{{ t('diagnostics.kpi.errors') }}</div>
            <div class="kpi-value">{{ summary()?.openErrorCount ?? 0 }}</div>
          </div>
          <div class="card card-pad">
            <div class="muted small">{{ t('diagnostics.kpi.last24h') }}</div>
            <div class="kpi-value">{{ summary()?.openLast24h ?? 0 }}</div>
          </div>
          <div class="card card-pad">
            <div class="muted small">{{ t('diagnostics.kpi.occurrences') }}</div>
            <div class="kpi-value">{{ summary()?.openOccurrences ?? 0 }}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">{{ t('diagnostics.errors.title') }}</div>
              <div class="card-sub">{{ t('diagnostics.errors.sub') }}</div>
            </div>
            <div class="row gap-sm" style="flex-wrap:wrap;">
              <input class="inp" style="width:220px;" [ngModel]="search()" (ngModelChange)="search.set($event)"
                     (keyup.enter)="loadErrors()" [placeholder]="t('diagnostics.search.placeholder')"/>
              <select class="inp" style="width:150px;" [ngModel]="sourceFilter()" (ngModelChange)="sourceFilter.set($event); loadErrors()">
                <option value="">{{ t('diagnostics.filter.allSources') }}</option>
                <option value="server">{{ t('diagnostics.source.server') }}</option>
                <option value="pos-client">{{ t('diagnostics.source.pos') }}</option>
                <option value="admin-client">{{ t('diagnostics.source.admin') }}</option>
                <option value="csp">{{ t('diagnostics.source.csp') }}</option>
              </select>
              <select class="inp" style="width:150px;" [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event); loadErrors()">
                <option value="open">{{ t('diagnostics.filter.open') }}</option>
                <option value="resolved">{{ t('diagnostics.filter.resolved') }}</option>
                <option value="all">{{ t('diagnostics.filter.all') }}</option>
              </select>
              <button class="btn btn-outline" (click)="loadErrors()">
                <ap-icon name="sync" [size]="14"/> {{ t('common.refresh') }}
              </button>
            </div>
          </div>

          @if (loadingErrors()) {
            <div class="row gap-sm" style="padding:24px;justify-content:center;">
              <ap-spinner/> <span class="muted small">{{ t('common.loading') }}</span>
            </div>
          } @else if (!errors().length) {
            <div class="muted small" style="text-align:center;padding:32px;">{{ t('diagnostics.errors.empty') }}</div>
          } @else {
            @for (row of errors(); track row.errorId) {
              <div class="diag-row">
                <div class="diag-main">
                  <div class="row gap-sm" style="align-items:center;flex-wrap:wrap;">
                    <ap-pill [kind]="row.severity === 'error' ? 'red' : 'amber'">{{ row.severity }}</ap-pill>
                    <span class="muted small mono">{{ row.source }}</span>
                    @if (row.code) { <span class="mono small">{{ row.code }}</span> }
                    @if (row.seenCount > 1) {
                      <span class="diag-count">×{{ row.seenCount }}</span>
                    }
                  </div>
                  <div class="strong diag-message">{{ row.message }}</div>
                  <div class="muted small">
                    @if (row.route) { <span class="mono">{{ row.route }}</span> }
                    @if (row.httpStatus) { <span> · {{ row.httpStatus }}</span> }
                    @if (row.requestId) { <span> · {{ t('diagnostics.ref') }} {{ row.requestId }}</span> }
                  </div>
                  <div class="muted small">
                    {{ t('diagnostics.lastSeen') }} {{ row.lastSeenAt | date:'MMM d, y HH:mm' }}
                    · {{ t('diagnostics.firstSeen') }} {{ row.firstSeenAt | date:'MMM d, y HH:mm' }}
                    @if (row.userName) { <span> · {{ row.userName }}</span> }
                  </div>
                  @if (expandedId() === row.errorId && row.stack) {
                    <pre class="diag-stack">{{ row.stack }}</pre>
                  }
                  @if (expandedId() === row.errorId && row.context) {
                    <pre class="diag-stack">{{ row.context | json }}</pre>
                  }
                </div>
                <div class="diag-actions">
                  @if (row.stack || row.context) {
                    <button class="btn btn-outline btn-sm" (click)="toggleExpanded(row.errorId)">
                      {{ expandedId() === row.errorId ? t('diagnostics.hideDetail') : t('diagnostics.showDetail') }}
                    </button>
                  }
                  @if (!row.resolvedAt) {
                    <button class="btn btn-outline btn-sm" [disabled]="resolving() === row.errorId" (click)="resolve(row)">
                      {{ t('diagnostics.resolve') }}
                    </button>
                  } @else {
                    <span class="muted small">
                      {{ t('diagnostics.resolvedBy') }} {{ row.resolvedByName || '—' }}
                    </span>
                  }
                </div>
              </div>
            }
          }
        </div>
      } @else {
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">{{ t('diagnostics.audit.title') }}</div>
              <div class="card-sub">{{ t('diagnostics.audit.sub') }}</div>
            </div>
            <div class="row gap-sm" style="flex-wrap:wrap;">
              <input class="inp" style="width:200px;" [ngModel]="auditRequestId()" (ngModelChange)="auditRequestId.set($event)"
                     (keyup.enter)="loadAudit()" [placeholder]="t('diagnostics.audit.refPlaceholder')"/>
              <select class="inp" style="width:200px;" [ngModel]="auditAction()" (ngModelChange)="auditAction.set($event); loadAudit()">
                <option value="">{{ t('diagnostics.audit.allActions') }}</option>
                @for (action of auditActions(); track action) {
                  <option [value]="action">{{ action }}</option>
                }
              </select>
              <input class="inp" style="width:150px;" type="date" [ngModel]="auditFrom()" (ngModelChange)="auditFrom.set($event); loadAudit()"/>
              <input class="inp" style="width:150px;" type="date" [ngModel]="auditTo()" (ngModelChange)="auditTo.set($event); loadAudit()"/>
            </div>
          </div>

          @if (loadingAudit()) {
            <div class="row gap-sm" style="padding:24px;justify-content:center;">
              <ap-spinner/> <span class="muted small">{{ t('common.loading') }}</span>
            </div>
          } @else if (!auditEvents().length) {
            <div class="muted small" style="text-align:center;padding:32px;">{{ t('diagnostics.audit.empty') }}</div>
          } @else {
            @for (event of auditEvents(); track event.auditId) {
              <div class="diag-row">
                <div class="diag-main">
                  <div class="row gap-sm" style="align-items:center;flex-wrap:wrap;">
                    <span class="mono strong">{{ event.action }}</span>
                    <span class="muted small">{{ event.entityType }}</span>
                  </div>
                  <div class="muted small">
                    {{ event.occurredAt | date:'MMM d, y HH:mm:ss' }}
                    @if (event.actorName) { <span> · {{ event.actorName }} ({{ event.actorRole }})</span> }
                    @if (event.ipAddress) { <span> · {{ event.ipAddress }}</span> }
                    @if (event.requestId) { <span> · {{ t('diagnostics.ref') }} {{ event.requestId }}</span> }
                  </div>
                  @if (expandedId() === event.auditId) {
                    <pre class="diag-stack">{{ { before: event.beforeState, after: event.afterState } | json }}</pre>
                  }
                </div>
                <div class="diag-actions">
                  <button class="btn btn-outline btn-sm" (click)="toggleExpanded(event.auditId)">
                    {{ expandedId() === event.auditId ? t('diagnostics.hideDetail') : t('diagnostics.showDetail') }}
                  </button>
                </div>
              </div>
            }
          }
        </div>
      }
    </div>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [`
    .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .kpi-value { font-size: 26px; font-weight: 600; margin-top: 4px; }
    .diag-row {
      padding: 14px 20px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: start;
      border-bottom: 1px solid var(--border, #e5e7eb);
    }
    .diag-row:last-child { border-bottom: none; }
    .diag-main { min-width: 0; display: grid; gap: 4px; }
    .diag-message { overflow-wrap: anywhere; }
    .diag-actions { display: grid; gap: 6px; justify-items: end; }
    .diag-count {
      font-size: 11px; padding: 1px 7px; border-radius: 999px;
      background: var(--surface-2, #f3f4f6); color: var(--text-muted, #6b7280);
    }
    .diag-stack {
      margin-top: 6px; padding: 10px; border-radius: 8px;
      background: var(--surface-2, #f3f4f6);
      font-size: 11px; line-height: 1.5;
      max-height: 320px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere;
    }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    @media (max-width: 900px) {
      .kpi-row { grid-template-columns: repeat(2, 1fr); }
      .diag-row { grid-template-columns: 1fr; }
      .diag-actions { justify-items: start; }
    }
  `]
})
export class DiagnosticsComponent implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly api = inject(DiagnosticsService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly tab = signal<Tab>('errors');
  readonly expandedId = signal<string | null>(null);

  readonly summary = signal<AppErrorSummary | null>(null);
  readonly errors = signal<AppErrorRow[]>([]);
  readonly loadingErrors = signal(true);
  readonly resolving = signal<string | null>(null);
  readonly search = signal('');
  readonly sourceFilter = signal('');
  readonly statusFilter = signal<'open' | 'resolved' | 'all'>('open');

  readonly auditEvents = signal<AuditEventRow[]>([]);
  readonly auditActions = signal<string[]>([]);
  readonly loadingAudit = signal(true);
  readonly auditAction = signal('');
  readonly auditRequestId = signal('');
  readonly auditFrom = signal('');
  readonly auditTo = signal('');

  readonly hasOpenErrors = computed(() => (this.summary()?.openCount ?? 0) > 0);

  async ngOnInit(): Promise<void> {
    await this.loadErrors();
  }

  setTab(tab: Tab): void {
    this.tab.set(tab);
    this.expandedId.set(null);
    if (tab === 'audit' && !this.auditEvents().length) void this.loadAudit();
  }

  toggleExpanded(id: string): void {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  async loadErrors(): Promise<void> {
    this.loadingErrors.set(true);
    try {
      const result = await this.api.errors({
        status: this.statusFilter(),
        source: this.sourceFilter() as never,
        search: this.search().trim() || undefined,
        limit: 100,
      });
      this.summary.set(result.summary);
      this.errors.set(result.errors);
    } catch {
      // The HTTP interceptor already toasts the failure; swallowing here keeps
      // the page from showing two errors for one cause.
    } finally {
      this.loadingErrors.set(false);
    }
  }

  async loadAudit(): Promise<void> {
    this.loadingAudit.set(true);
    try {
      const result = await this.api.auditEvents({
        action: this.auditAction() || undefined,
        requestId: this.auditRequestId().trim() || undefined,
        from: this.auditFrom() || undefined,
        to: this.auditTo() || undefined,
        limit: 100,
      });
      this.auditActions.set(result.actions);
      this.auditEvents.set(result.events);
    } catch {
      /* interceptor already reported it */
    } finally {
      this.loadingAudit.set(false);
    }
  }

  async resolve(row: AppErrorRow): Promise<void> {
    this.resolving.set(row.errorId);
    try {
      await this.api.resolve(row.errorId);
      this.toast.success(this.t('diagnostics.resolved.toast'));
      await this.loadErrors();
    } catch {
      /* interceptor already reported it */
    } finally {
      this.resolving.set(null);
    }
  }
}
