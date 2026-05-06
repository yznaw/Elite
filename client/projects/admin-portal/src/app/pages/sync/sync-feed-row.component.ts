import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { TriggerBadgeComponent } from '../../shared/trigger-badge/trigger-badge.component';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { syncPillKind } from '../../shared/pill/status-pill';
import { SyncLog } from '../../models';

@Component({
  selector: 'ap-sync-feed-row',
  standalone: true,
  imports: [CommonModule, IconComponent, PillComponent, TriggerBadgeComponent, AvatarComponent],
  template: `
    <div class="feed-row" [class.expanded]="expanded" [class.running]="isRunning" (click)="toggle.emit()">
      <div class="feed-icon" [class.success]="log.status === 'success'" [class.failed]="log.status === 'failed'" [class.partial]="log.status === 'partial'" [class.running]="isRunning">
        @if (isRunning) { <span class="spin-i"><ap-icon name="spinner" [size]="12"/></span> }
        @else if (log.status === 'success') { ✓ }
        @else if (log.status === 'failed') { ✕ }
        @else { ! }
      </div>
      <div class="feed-time">{{ time }}</div>
      <div>
        <div class="strong" style="font-size:13px;">{{ log.type }}</div>
        <div class="muted small">
          @if (isRunning) { Sync in progress… }
          @else {
            {{ log.processed.toLocaleString() }} processed
            @if (log.updated > 0) { <span> · <span style="color:var(--gold);">{{ log.updated }} updated</span></span> }
            @if (log.status === 'failed') { <span style="color:var(--danger);"> · 0 changes applied</span> }
          }
        </div>
      </div>
      <ap-trigger-badge [trigger]="log.triggeredBy"/>
      <div class="muted small mono" style="font-size:11px;min-width:50px;text-align:right;">
        {{ isRunning ? '— · — s' : (log.durationMs / 1000).toFixed(2) + 's' }}
      </div>
      <ap-pill [kind]="pillKind.kind">{{ pillKind.label }}</ap-pill>
    </div>

    @if (expanded && !isRunning) {
      <div class="feed-detail">
        <div class="feed-detail-grid">
          <div class="stat-cell"><div class="lbl">Run ID</div><div class="v mono" style="font-size:12px;">{{ log.id }}</div></div>
          <div class="stat-cell"><div class="lbl">Records Processed</div><div class="v">{{ log.processed.toLocaleString() }}</div></div>
          <div class="stat-cell"><div class="lbl">Records Updated</div><div class="v gold" style="font-family:var(--ff-disp);font-size:16px;">{{ log.updated }}</div></div>
          <div class="stat-cell"><div class="lbl">Throughput</div><div class="v">{{ throughput }} rec/s</div></div>
        </div>
        <div class="ms-row" style="padding:10px 0;border-top:1px solid var(--border-2);border-bottom:1px solid var(--border-2);margin:8px 0;">
          <span class="muted small">Triggered by</span>
          @if (log.triggeredBy.type === 'manual') {
            <span class="row gap-sm">
              <ap-avatar [initials]="log.triggeredBy.initials || ''" [customSize]="22" [fontSize]="9"/>
              <span class="strong">{{ log.triggeredBy.user }}</span>
              @if (log.triggeredBy.context) {
                <span class="muted small">· {{ log.triggeredBy.context }}</span>
              }
            </span>
          } @else {
            <span class="strong">Schedule (automatic)</span>
          }
        </div>
        @if (log.err) {
          <div class="err-block">
            <div class="strong" style="margin-bottom:4px;">{{ log.status === 'failed' ? 'Error' : 'Warning' }}</div>
            {{ log.err }}
          </div>
        } @else {
          <div class="muted small" style="padding:6px 0;">Run completed without warnings.</div>
        }
        <div class="row gap-sm" style="margin-top:10px;">
          <button class="btn btn-outline btn-sm">Download log</button>
          <button class="btn btn-ghost btn-sm">Replay this run</button>
        </div>
      </div>
    }
  `,
})
export class SyncFeedRowComponent {
  @Input({ required: true }) log!: SyncLog;
  @Input() expanded = false;
  @Output() toggle = new EventEmitter<void>();

  get isRunning(): boolean { return this.log.status === 'running'; }
  get time(): string { return this.log.ts.split(' ')[1]; }
  get pillKind() { return syncPillKind(this.log.status); }
  get throughput(): string {
    if (this.log.processed === 0 || this.log.durationMs === 0) return '0';
    return Math.round(this.log.processed / (this.log.durationMs / 1000)).toLocaleString();
  }
}
