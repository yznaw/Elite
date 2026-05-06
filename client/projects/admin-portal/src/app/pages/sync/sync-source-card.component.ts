import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { MiniSparkComponent } from '../../shared/sparkline/mini-spark.component';
import { SyncSource } from '../../models';

@Component({
  selector: 'ap-sync-source-card',
  standalone: true,
  imports: [CommonModule, IconComponent, PillComponent, MiniSparkComponent],
  template: `
    <div class="sync-card" [class.running]="isRunning" [class.failed]="isFailed">
      <div class="row" style="align-items:flex-start;justify-content:space-between;">
        <div class="row gap-sm" style="align-items:flex-start;">
          <div class="sync-card-icon"><ap-icon name="csv" [size]="18"/></div>
          <div>
            <div class="row gap-sm" style="margin-bottom:2px;">
              <div class="strong" style="font-size:15px;color:var(--green);">{{ source.name }}</div>
              <span class="live-dot" [class.green]="dotKind === 'green'" [class.red]="dotKind === 'red'" [class.amber]="dotKind === 'amber'"></span>
            </div>
            <div class="muted small">{{ source.desc }}</div>
          </div>
        </div>
        @if (isRunning) { <ap-pill kind="green">Live</ap-pill> }
        @else if (isFailed) { <ap-pill kind="red">Action Required</ap-pill> }
        @else if (source.status === 'success') { <ap-pill kind="green">Healthy</ap-pill> }
      </div>

      <div class="row" style="align-items:flex-end;justify-content:space-between;gap:14px;">
        <div>
          <div class="muted small" style="letter-spacing:0.12em;text-transform:uppercase;font-size:9px;margin-bottom:4px;">Success Rate · 7d</div>
          <div [style.color]="isFailed ? 'var(--danger)' : 'var(--green)'"
            style="font-family:var(--ff-disp);font-size:32px;font-weight:500;line-height:1;">
            {{ source.successRate.toFixed(1) }}<span style="font-size:18px;color:var(--muted);font-weight:400;">%</span>
          </div>
        </div>
        <div style="flex:1;max-width:140px;">
          <ap-mini-spark [data]="source.spark7d" [color]="sparkColor"/>
        </div>
      </div>

      <div>
        <div class="row" style="justify-content:space-between;margin-bottom:6px;">
          <div class="muted small" style="letter-spacing:0.12em;text-transform:uppercase;font-size:9px;">Last 7 Runs</div>
          <div class="muted small" style="font-size:10px;">oldest → newest</div>
        </div>
        <div class="run-strip">
          @for (r of source.last7runs; track $index) {
            <div class="run-square" [class.s-success]="r === 'success'" [class.s-partial]="r === 'partial'" [class.s-failed]="r === 'failed'" [class.s-pending]="r === 'pending'" [attr.title]="r"></div>
          }
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-cell">
          <div class="lbl">Last Run</div>
          <div class="v">{{ lastRunTime }}</div>
        </div>
        <div class="stat-cell">
          <div class="lbl">{{ isFailed ? 'Status' : 'Next Run' }}</div>
          <div class="v" [style.color]="isFailed ? 'var(--danger)' : isRunning ? 'var(--success)' : null">{{ source.nextRunIn }}</div>
        </div>
        <div class="stat-cell">
          <div class="lbl">Avg Duration</div>
          <div class="v">{{ (source.avgMs / 1000).toFixed(1) }}s</div>
        </div>
        <div class="stat-cell">
          <div class="lbl">Records · Updated</div>
          <div class="v">{{ source.recordsToday.toLocaleString() }} · <span class="gold" style="font-family:var(--ff-disp);font-size:14px;">{{ source.updatedToday }}</span></div>
        </div>
      </div>

      @if (isFailed && source.error) {
        <div class="err-block"><span class="strong">⚠ {{ source.error }}</span></div>
      }

      <div class="row gap-sm" style="margin-top:auto;">
        @if (isFailed) {
          <button class="btn btn-gold" style="flex:1;">Reconnect</button>
          <button class="btn btn-outline" style="flex:1;"><ap-icon name="sync" [size]="14"/> Retry</button>
        } @else {
          <button class="btn btn-primary" style="flex:1;" [disabled]="isRunning" (click)="run.emit()">
            @if (isRunning) {
              <span class="spin-i"><ap-icon name="spinner" [size]="12"/></span> Syncing…
            } @else {
              <ap-icon name="sync" [size]="14"/> Run Now
            }
          </button>
          <button class="btn btn-outline">Configure</button>
        }
      </div>
    </div>
  `,
})
export class SyncSourceCardComponent {
  @Input({ required: true }) source!: SyncSource;
  @Input() runningNow = false;
  @Output() run = new EventEmitter<void>();

  get isFailed(): boolean { return this.source.status === 'failed'; }
  get isRunning(): boolean { return this.source.status === 'running' || this.runningNow; }

  get sparkColor(): string {
    if (this.isFailed) return 'var(--danger)';
    if (this.isRunning) return 'var(--success)';
    return 'var(--gold)';
  }

  get dotKind(): 'green' | 'red' | 'amber' {
    if (this.isRunning) return 'green';
    if (this.isFailed) return 'red';
    if (this.source.status === 'partial') return 'amber';
    return 'green';
  }

  get lastRunTime(): string {
    return this.source.lastRun.split(' ')[1] || this.source.lastRun;
  }
}
