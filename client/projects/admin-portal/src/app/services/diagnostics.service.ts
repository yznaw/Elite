import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';

export type AppErrorSource = 'server' | 'pos-client' | 'admin-client' | 'csp';
export type AppErrorSeverity = 'error' | 'warn';

export interface AppErrorRow {
  errorId: string;
  fingerprint: string;
  source: AppErrorSource;
  severity: AppErrorSeverity;
  code: string | null;
  message: string;
  stack: string | null;
  route: string | null;
  httpStatus: number | null;
  requestId: string | null;
  registerId: string | null;
  shiftId: string | null;
  context: Record<string, unknown> | null;
  seenCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  userName: string | null;
  resolvedByName: string | null;
}

export interface AppErrorSummary {
  openCount: number;
  openErrorCount: number;
  openLast24h: number;
  openOccurrences: number;
}

export interface AuditEventRow {
  auditId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  occurredAt: string;
  requestId: string | null;
  ipAddress: string | null;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  beforeState: unknown;
  afterState: unknown;
}

export interface ErrorFilter {
  status?: 'open' | 'resolved' | 'all';
  source?: AppErrorSource | '';
  severity?: AppErrorSeverity | '';
  search?: string;
  limit?: number;
}

export interface AuditFilter {
  action?: string;
  entityType?: string;
  requestId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

function toQuery(filter: ErrorFilter | AuditFilter): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

@Injectable({ providedIn: 'root' })
export class DiagnosticsService {
  private readonly api = inject(ApiClient);

  errors(filter: ErrorFilter = {}): Promise<{ summary: AppErrorSummary; errors: AppErrorRow[] }> {
    return firstValueFrom(
      this.api.get<{ summary: AppErrorSummary; errors: AppErrorRow[] }>(`/admin/diagnostics/errors${toQuery(filter)}`),
    );
  }

  resolve(errorId: string): Promise<{ errorId: string; resolved: boolean }> {
    return firstValueFrom(
      this.api.post<{ errorId: string; resolved: boolean }>(`/admin/diagnostics/errors/${errorId}/resolve`, {}),
    );
  }

  auditEvents(filter: AuditFilter = {}): Promise<{ actions: string[]; events: AuditEventRow[] }> {
    return firstValueFrom(
      this.api.get<{ actions: string[]; events: AuditEventRow[] }>(`/admin/diagnostics/audit-events${toQuery(filter)}`),
    );
  }
}
