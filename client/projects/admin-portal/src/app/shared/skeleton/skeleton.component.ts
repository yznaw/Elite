import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Reusable shimmer/skeleton placeholder.
 *
 * Usage:
 *   <ap-skeleton width="200px" height="20px"/>                    — single line
 *   <ap-skeleton variant="card"/>                                 — card placeholder
 *   <ap-skeleton variant="table-row" [repeat]="5"/>               — 5 table rows
 *   <ap-skeleton variant="kpi"/>                                  — KPI card
 */
@Component({
  selector: 'ap-skeleton',
  standalone: true,
  imports: [CommonModule],
  template: `
    @switch (variant) {
      @case ('card') {
        @for (_ of repeats; track $index) {
          <div class="sk-card">
            <div class="sk-shimmer sk-card-img"></div>
            <div class="sk-card-body">
              <div class="sk-shimmer" style="width:70%;height:14px;border-radius:6px;margin-bottom:8px;"></div>
              <div class="sk-shimmer" style="width:40%;height:10px;border-radius:6px;margin-bottom:12px;"></div>
              <div class="sk-row">
                <div class="sk-shimmer" style="width:60px;height:12px;border-radius:6px;"></div>
                <div class="sk-shimmer" style="width:50px;height:12px;border-radius:6px;"></div>
              </div>
            </div>
          </div>
        }
      }
      @case ('table-row') {
        @for (_ of repeats; track $index) {
          <div class="sk-table-row">
            <div class="sk-shimmer" style="width:80px;height:12px;border-radius:6px;"></div>
            <div class="sk-shimmer" style="width:120px;height:12px;border-radius:6px;"></div>
            <div class="sk-shimmer" style="width:100px;height:12px;border-radius:6px;"></div>
            <div class="sk-shimmer" style="width:60px;height:12px;border-radius:6px;"></div>
            <div class="sk-shimmer" style="width:70px;height:24px;border-radius:12px;"></div>
          </div>
        }
      }
      @case ('kpi') {
        @for (_ of repeats; track $index) {
          <div class="sk-kpi">
            <div class="sk-shimmer" style="width:60%;height:10px;border-radius:6px;margin-bottom:10px;"></div>
            <div class="sk-shimmer" style="width:45%;height:24px;border-radius:6px;margin-bottom:8px;"></div>
            <div class="sk-shimmer" style="width:100%;height:28px;border-radius:6px;"></div>
          </div>
        }
      }
      @case ('chart') {
        <div class="sk-chart">
          <div style="margin-bottom:16px;">
            <div class="sk-shimmer" style="width:180px;height:14px;border-radius:6px;margin-bottom:6px;"></div>
            <div class="sk-shimmer" style="width:120px;height:10px;border-radius:6px;"></div>
          </div>
          <div class="sk-shimmer" style="width:100%;height:180px;border-radius:8px;"></div>
        </div>
      }
      @case ('order-card') {
        @for (_ of repeats; track $index) {
          <div class="sk-order-card">
            <div class="sk-order-row1">
              <div class="sk-shimmer" style="width:110px;height:12px;border-radius:6px;"></div>
              <div class="sk-shimmer" style="width:70px;height:10px;border-radius:6px;"></div>
            </div>
            <div class="sk-shimmer" style="width:60%;height:14px;border-radius:6px;margin:8px 0;"></div>
            <div class="sk-order-row3">
              <div class="sk-shimmer" style="width:50px;height:10px;border-radius:6px;"></div>
              <div class="sk-shimmer" style="width:80px;height:12px;border-radius:6px;"></div>
              <div class="sk-shimmer" style="width:56px;height:20px;border-radius:10px;"></div>
              <div class="sk-shimmer" style="width:56px;height:20px;border-radius:10px;"></div>
            </div>
          </div>
        }
      }
      @default {
        @for (_ of repeats; track $index) {
          <div class="sk-shimmer sk-inline"
               [style.width]="width"
               [style.height]="height"
               [style.border-radius]="radius">
          </div>
        }
      }
    }
  `,
  styles: [`
    :host { display: contents; }

    .sk-shimmer {
      background: linear-gradient(
        90deg,
        var(--border-2, #eef0f4) 25%,
        var(--bg, #f5f6f9) 50%,
        var(--border-2, #eef0f4) 75%
      );
      background-size: 200% 100%;
      animation: skShimmer 1.5s ease infinite;
    }
    @keyframes skShimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .sk-inline {
      display: block;
      border-radius: 6px;
    }

    /* Card variant */
    .sk-card {
      background: var(--surface, #fff);
      border: 1px solid var(--border, #e5e7ec);
      border-radius: 14px;
      overflow: hidden;
    }
    .sk-card-img { width: 100%; aspect-ratio: 4/3; }
    .sk-card-body { padding: 14px 16px; }
    .sk-row { display: flex; justify-content: space-between; }

    /* Table row variant */
    .sk-table-row {
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 14px 22px;
      border-bottom: 1px solid var(--border-2, #eef0f4);
    }
    .sk-table-row:last-child { border-bottom: none; }

    /* KPI variant */
    .sk-kpi {
      background: var(--surface, #fff);
      border: 1px solid var(--border, #e5e7ec);
      border-radius: 14px;
      padding: 20px;
    }

    /* Chart variant */
    .sk-chart {
      background: var(--surface, #fff);
      border: 1px solid var(--border, #e5e7ec);
      border-radius: 14px;
      padding: 22px;
    }

    /* Order card variant — matches Phase 3 mobile order cards */
    .sk-order-card {
      background: var(--surface, #fff);
      border: 1px solid var(--border, #e5e7ec);
      border-inline-start: 4px solid var(--border, #e5e7ec);
      border-radius: 12px;
      padding: 14px 16px;
    }
    .sk-order-row1 { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .sk-order-row3 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

    /* Table-row: on mobile become a card-like stack */
    @media (max-width: 768px) {
      .sk-table-row {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        padding: 14px 16px;
        border: 1px solid var(--border, #e5e7ec);
        border-radius: 10px;
        margin-bottom: 8px;
      }
      .sk-table-row:last-child { border-bottom: 1px solid var(--border, #e5e7ec); }
    }

    /* Reduced-motion: freeze shimmer */
    @media (prefers-reduced-motion: reduce) {
      .sk-shimmer { animation: none; background: var(--border-2, #eef0f4); }
    }
  `],
})
export class SkeletonComponent {
  @Input() variant: 'line' | 'card' | 'table-row' | 'kpi' | 'chart' | 'order-card' = 'line';
  @Input() repeat = 1;
  @Input() width = '100%';
  @Input() height = '14px';
  @Input() radius = '6px';

  get repeats(): number[] { return Array(this.repeat); }
}
