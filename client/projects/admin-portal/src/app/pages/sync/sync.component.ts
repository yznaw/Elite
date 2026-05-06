import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { KpiComponent } from '../../shared/kpi/kpi.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { SyncSourceCardComponent } from './sync-source-card.component';
import { SyncFeedRowComponent } from './sync-feed-row.component';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { SYNC_LOGS, SYNC_SOURCES, UPCOMING_RUNS } from '../../data/mock';
import { ME, SyncLog } from '../../models';

interface QueuedRun { id: string; at: string; note: string; by: string; initials: string; }
type Filter = 'all' | 'success' | 'partial' | 'errors' | 'manual' | 'auto';

@Component({
  selector: 'ap-sync',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, KpiComponent, PillComponent, AvatarComponent, EmptyStateComponent, SyncSourceCardComponent, SyncFeedRowComponent],
  template: `
    <div class="page-fade">
      <div class="health-banner mb-24">
        <div class="row" style="justify-content:space-between;align-items:flex-start;position:relative;z-index:1;gap:24px;flex-wrap:wrap;">
          <div>
            <div class="row gap-sm mb-8">
              <span class="live-dot" [class.green]="overallHealth === 'healthy'" [class.amber]="overallHealth !== 'healthy'"></span>
              <span style="font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:rgba(255,255,255,0.7);">System Status</span>
            </div>
            <div style="font-family:var(--ff-disp);font-size:28px;font-weight:500;margin-bottom:6px;">
              {{ overallHealth === 'healthy' ? 'All systems operational' : 'Sync needs attention' }}
            </div>
            <div style="font-size:12px;color:rgba(255,255,255,0.65);">
              {{ recordsToday.toLocaleString() }} records synced in the last 24h · {{ totalUpdated }} catalog updates · {{ partialCount }} warning{{ partialCount === 1 ? '' : 's' }} this week
            </div>
          </div>
          <div class="row gap-sm" style="align-self:center;">
            <button class="btn" style="background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.2);"
                    [disabled]="runningId() !== null" (click)="runManual('csv')">
              @if (runningId() !== null) {
                <span class="spin-i"><ap-icon name="spinner" [size]="12"/></span> Syncing…
              } @else {
                <ap-icon name="sync" [size]="14"/> Run Now
              }
            </button>
            <button class="btn btn-gold" (click)="togglePause()">{{ paused() ? 'Resume Schedule' : 'Pause Schedule' }}</button>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:20px;align-items:stretch;" class="mb-24 sync-layout">
        @for (s of sources; track s.id) {
          <ap-sync-source-card [source]="s" [runningNow]="runningId() !== null" (run)="runManual(s.id)"/>
        }

        <div class="card" style="display:flex;flex-direction:column;">
          <div class="card-header">
            <div>
              <div class="card-title">Sync Schedule</div>
              <div class="card-sub">Automated · every 12h · {{ queued().length }} manual queued</div>
            </div>
            <button class="btn btn-sm" [class.btn-primary]="scheduleOpen()" [class.btn-gold]="!scheduleOpen()" (click)="toggleSchedule()">
              @if (scheduleOpen()) { Cancel }
              @else { <ap-icon name="plus" [size]="12"/> Schedule Manual }
            </button>
          </div>

          @if (scheduleOpen()) {
            <div style="padding:14px 20px;background:var(--gold-3);border-bottom:1px solid var(--border-2);">
              <div class="row gap-sm" style="align-items:flex-end;flex-wrap:wrap;">
                <div style="flex:1 1 160px;">
                  <label class="lbl">Run At</label>
                  <input class="inp" type="datetime-local" value="2026-04-29T14:00" (input)="onSchedAt($event)"/>
                </div>
                <div style="flex:2 1 200px;">
                  <label class="lbl">Note (optional)</label>
                  <input class="inp" placeholder="e.g. Pre-launch QA sync" [ngModel]="schedNote()" (ngModelChange)="schedNote.set($event)"/>
                </div>
                <button class="btn btn-primary" (click)="queueScheduled()">Queue Run</button>
              </div>
              <div class="muted small mt-8">Queued runs execute on the system clock and appear in the activity feed with your initials.</div>
            </div>
          }

          <div class="card-pad" style="flex:1;display:flex;flex-direction:column;gap:10px;overflow-y:auto;">
            @if (queued().length > 0) {
              <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:var(--gold);font-weight:600;">Manual Queue · {{ queued().length }}</div>
              @for (q of queued(); track q.id) {
                <div style="display:flex;gap:12px;align-items:center;padding:10px 12px;background:var(--gold-3);border-radius:8px;border:1px solid var(--gold-4);">
                  <ap-avatar [initials]="q.initials" [customSize]="28" [fontSize]="10"/>
                  <div class="grow" style="min-width:0;">
                    <div class="strong" style="font-size:12px;">{{ q.at }}</div>
                    <div class="muted small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ q.note }} · by {{ q.by }}</div>
                  </div>
                  <button class="icon-btn" title="Cancel" (click)="cancelScheduled(q.id)"><ap-icon name="x" [size]="14"/></button>
                </div>
              }
            }

            <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:var(--muted);font-weight:600;" [style.margin-top.px]="queued().length > 0 ? 6 : 0">Upcoming Auto-runs</div>
            @for (r of upcomingRuns; track r.ts; let i = $index; let last = $last) {
              <div style="display:flex;gap:14px;align-items:center;padding:8px 0;" [style.border-bottom]="last ? 'none' : '1px solid var(--border-2)'">
                <div style="width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"
                  [style.background]="i === 0 ? 'var(--gold-3)' : 'var(--bg)'"
                  [style.color]="i === 0 ? 'var(--gold)' : 'var(--muted)'">
                  <ap-icon name="clock" [size]="14"/>
                </div>
                <div class="grow" style="min-width:0;">
                  <div class="strong" style="font-size:12.5px;color:var(--ink);">{{ r.label }}</div>
                  <div class="muted small">CSV Sync · Schedule</div>
                </div>
                <div style="text-align:right;flex-shrink:0;">
                  @if (i === 0) { <ap-pill kind="gold">Next</ap-pill> }
                  <div [style.margin-top.px]="i === 0 ? 3 : 0" class="mono" style="font-size:10px;color:var(--muted);">{{ r.in }}</div>
                </div>
              </div>
            }
          </div>
        </div>
      </div>

      <div class="kpi-grid mb-24">
        <ap-kpi label="Records · 24h"   [value]="recordsToday.toLocaleString()" delta="+12.4%" [deltaUp]="true" icon="sync"/>
        <ap-kpi label="Avg Duration"    [value]="avgDuration + 's'"             delta="-0.4s vs avg" [deltaUp]="true" icon="chart"/>
        <ap-kpi label="Error Rate · 7d" [value]="errorRate + '%'"               [delta]="partialCount + ' partial'" [deltaUp]="partialCount === 0" icon="bell"/>
        <ap-kpi label="Uptime · 30d"    value="99.94%"                          delta="SLA met" [deltaUp]="true" icon="dash"/>
      </div>

      <div class="card">
        <div class="card-header" style="flex-wrap:wrap;gap:12px;">
          <div>
            <div class="card-title">Activity Feed</div>
            <div class="card-sub">{{ filtered().length }} of {{ logs().length }} runs · {{ counts().manual }} manual · {{ counts().auto }} scheduled</div>
          </div>
          <div class="row gap-sm" style="flex-wrap:wrap;">
            <button class="chip" [class.active]="filter() === 'all'" (click)="filter.set('all')">All <span class="chip-count">{{ counts().all }}</span></button>
            <button class="chip" [class.active]="filter() === 'manual'" (click)="filter.set('manual')">Manual <span class="chip-count">{{ counts().manual }}</span></button>
            <button class="chip" [class.active]="filter() === 'auto'" (click)="filter.set('auto')">Scheduled <span class="chip-count">{{ counts().auto }}</span></button>
            <span style="width:1px;height:18px;background:var(--border);align-self:center;"></span>
            <button class="chip" [class.active]="filter() === 'success'" (click)="filter.set('success')">Success <span class="chip-count">{{ counts().success }}</span></button>
            <button class="chip" [class.active]="filter() === 'partial'" (click)="filter.set('partial')"
                    [style.background]="filter() === 'partial' ? 'var(--warning)' : ''" [style.border-color]="filter() === 'partial' ? 'var(--warning)' : ''">
              Warnings <span class="chip-count">{{ counts().partial }}</span>
            </button>
            <button class="chip" [class.active]="filter() === 'errors'" (click)="filter.set('errors')"
                    [style.background]="filter() === 'errors' ? 'var(--danger)' : ''" [style.border-color]="filter() === 'errors' ? 'var(--danger)' : ''">
              Errors <span class="chip-count">{{ counts().errors }}</span>
            </button>
            <button class="btn btn-outline btn-sm" style="margin-left:8px;">Download</button>
          </div>
        </div>

        @if (filtered().length === 0) {
          <ap-empty-state icon="sync" title="No matching runs"
            sub="Try a different filter to see more activity, or trigger a manual sync from the source card above.">
            <button class="btn btn-outline btn-sm" (click)="filter.set('all')">Clear filter</button>
          </ap-empty-state>
        } @else {
          @for (group of grouped(); track group.date) {
            <div class="feed-day">
              <span>{{ dayLabel(group.date) }}</span>
              <span class="muted" style="margin-left:10px;font-weight:400;letter-spacing:0.06em;">· {{ group.logs.length }} runs</span>
            </div>
            @for (log of group.logs; track log.id) {
              <ap-sync-feed-row [log]="log" [expanded]="expandedId() === log.id" (toggle)="toggleExpand(log.id)"/>
            }
          }
        }
      </div>
    </div>
  `,
})
export class SyncComponent {
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly sources = SYNC_SOURCES;
  readonly upcomingRuns = UPCOMING_RUNS.slice(0, 3);
  readonly paused = signal(false);

  readonly logs = signal<SyncLog[]>(SYNC_LOGS);
  readonly filter = signal<Filter>('all');
  readonly expandedId = signal<string | null>(null);
  readonly runningId = signal<string | null>(null);
  readonly scheduleOpen = signal(false);
  readonly schedAt = signal('2026-04-29 14:00');
  readonly schedNote = signal('');
  readonly queued = signal<QueuedRun[]>([]);

  readonly recordsToday = SYNC_SOURCES.reduce((s, x) => s + x.recordsToday, 0);
  readonly totalUpdated = SYNC_SOURCES.reduce((s, x) => s + x.updatedToday, 0);
  readonly avgDuration = (SYNC_SOURCES.reduce((s, x) => s + x.avgMs, 0) / SYNC_SOURCES.length / 1000).toFixed(1);

  readonly counts = computed(() => {
    const ls = this.logs();
    return {
      all: ls.length,
      success: ls.filter((l) => l.status === 'success').length,
      partial: ls.filter((l) => l.status === 'partial').length,
      errors: ls.filter((l) => l.status !== 'success' && l.status !== 'running').length,
      manual: ls.filter((l) => l.triggeredBy.type === 'manual').length,
      auto: ls.filter((l) => l.triggeredBy.type === 'auto').length,
    };
  });

  readonly partialCount = SYNC_LOGS.filter((l) => l.status === 'partial').length;

  get errorRate(): string {
    const errors = this.logs().filter((l) => l.status === 'failed').length;
    return ((errors / Math.max(this.logs().length, 1)) * 100).toFixed(1);
  }

  get overallHealth(): 'healthy' | 'degraded' {
    return SYNC_SOURCES.every((s) => s.status !== 'failed') ? 'healthy' : 'degraded';
  }

  readonly filtered = computed(() => {
    const f = this.filter();
    const ls = this.logs();
    return ls.filter((l) => {
      if (f === 'all') return true;
      if (f === 'errors') return l.status !== 'success' && l.status !== 'running';
      if (f === 'success') return l.status === 'success';
      if (f === 'partial') return l.status === 'partial';
      if (f === 'manual') return l.triggeredBy.type === 'manual';
      if (f === 'auto') return l.triggeredBy.type === 'auto';
      return true;
    });
  });

  readonly grouped = computed(() => {
    const map: Record<string, SyncLog[]> = {};
    this.filtered().forEach((l) => {
      const date = l.ts.split(' ')[0];
      (map[date] = map[date] || []).push(l);
    });
    return Object.keys(map)
      .sort((a, b) => b.localeCompare(a))
      .map((date) => ({ date, logs: map[date] }));
  });

  toggleExpand(id: string): void {
    this.expandedId.update((cur) => (cur === id ? null : id));
  }

  toggleSchedule(): void {
    this.scheduleOpen.update((o) => !o);
  }

  onSchedAt(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.schedAt.set(v.replace('T', ' '));
  }

  queueScheduled(): void {
    if (!this.schedAt()) return;
    const id = 'Q-' + Math.floor(Math.random() * 900 + 100);
    this.queued.update((q) => [
      ...q,
      { id, at: this.schedAt(), note: this.schedNote() || 'Manual run', by: ME.name, initials: ME.initials },
    ]);
    this.toast.success('Manual run scheduled', `${this.schedAt()} · queued by ${ME.name}`);
    this.schedNote.set('');
    this.scheduleOpen.set(false);
  }

  async cancelScheduled(id: string): Promise<void> {
    const item = this.queued().find((q) => q.id === id);
    if (!item) return;
    const ok = await this.confirm.ask({
      title: 'Cancel queued sync?',
      message: `The manual run scheduled for ${item.at} will be removed from the queue.`,
      confirmLabel: 'Cancel run',
      cancelLabel: 'Keep queued',
      variant: 'warning',
    });
    if (!ok) return;
    this.queued.update((q) => q.filter((x) => x.id !== id));
    this.toast.info('Queued run cancelled', `${item.at} · ${item.note}`);
  }

  async togglePause(): Promise<void> {
    if (this.paused()) {
      this.paused.set(false);
      this.toast.success('Schedule resumed', 'Automatic syncs will run on schedule again.');
      return;
    }
    const ok = await this.confirm.ask({
      title: 'Pause sync schedule?',
      message: 'Automatic syncs will stop running. Inventory and price will go stale until you resume the schedule or run a manual sync.',
      confirmLabel: 'Pause schedule',
      cancelLabel: 'Keep running',
      variant: 'warning',
    });
    if (!ok) return;
    this.paused.set(true);
    this.toast.warning('Schedule paused', 'Automatic syncs are off. Resume to continue.', {
      label: 'Resume',
      run: () => {
        this.paused.set(false);
        this.toast.success('Schedule resumed', 'Automatic syncs will run on schedule again.');
      },
    });
  }

  private fmtNow(): string {
    const n = new Date();
    const pad = (v: number): string => String(v).padStart(2, '0');
    return `2026-04-29 ${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
  }

  runManual(sourceId: string): void {
    const src = SYNC_SOURCES.find((s) => s.id === sourceId) || SYNC_SOURCES[0];
    const id = 'L-' + Math.floor(Math.random() * 900 + 200);
    const ts = this.fmtNow();
    const newLog: SyncLog = {
      id, ts,
      type: 'CSV Sync',
      sourceId,
      processed: 0, updated: 0,
      status: 'running',
      durationMs: 0,
      err: '',
      triggeredBy: { type: 'manual', user: ME.name, initials: ME.initials, context: 'Manual sync · Run Now' },
    };
    this.logs.update((ls) => [newLog, ...ls]);
    this.runningId.set(id);
    this.toast.info('Sync started', `${src.name} · triggered by ${ME.name}`);
    setTimeout(() => {
      const finalProcessed = Math.floor(Math.random() * 30 + 1220);
      const finalUpdated = Math.floor(Math.random() * 30 + 5);
      const finalDuration = Math.floor(Math.random() * 1500 + 3500);
      this.logs.update((ls) =>
        ls.map((l) =>
          l.id === id
            ? { ...l, status: 'success', processed: finalProcessed, updated: finalUpdated, durationMs: finalDuration }
            : l,
        ),
      );
      this.runningId.set(null);
      this.toast.success('Sync complete', `${finalProcessed.toLocaleString()} processed · ${finalUpdated} updated`, {
        label: 'View run',
        run: () => this.expandedId.set(id),
      });
    }, 3500);
  }

  dayLabel(d: string): string {
    if (d === '2026-04-29') return 'Today · April 29';
    if (d === '2026-04-28') return 'Yesterday · April 28';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
}
