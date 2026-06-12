import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'ap-pagination',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (totalPages > 1 || showSizeSelector) {
      <div class="pg-bar">
        @if (showSizeSelector) {
          <div class="pg-size">
            <span class="pg-label">Per page</span>
            <select class="inp pg-select" [ngModel]="pageSize" (ngModelChange)="onSizeChange($event)">
              <option [value]="25">25</option>
              <option [value]="50">50</option>
              <option [value]="100">100</option>
            </select>
          </div>
        }

        <span class="pg-info muted small">{{ label }}</span>

        <div class="pg-controls">
          <button class="btn btn-sm btn-outline pg-btn pg-jump"
                  [disabled]="page === 0"
                  (click)="pageChange.emit(0)"
                  aria-label="First page">
            «
          </button>
          <button class="btn btn-sm btn-outline pg-btn"
                  [disabled]="page === 0"
                  (click)="pageChange.emit(page - 1)"
                  aria-label="Previous page">
            ← <span class="pg-btn-label">Prev</span>
          </button>
          <span class="pg-current muted small">{{ page + 1 }} / {{ totalPages }}</span>
          <button class="btn btn-sm btn-outline pg-btn"
                  [disabled]="page >= totalPages - 1"
                  (click)="pageChange.emit(page + 1)"
                  aria-label="Next page">
            <span class="pg-btn-label">Next</span> →
          </button>
          <button class="btn btn-sm btn-outline pg-btn pg-jump"
                  [disabled]="page >= totalPages - 1"
                  (click)="pageChange.emit(totalPages - 1)"
                  aria-label="Last page">
            »
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    .pg-bar {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      padding: 12px 0 4px;
    }
    .pg-size {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .pg-label { font-size: 12px; color: var(--muted); }
    .pg-select { width: auto; padding: 5px 10px; font-size: 12px; }
    .pg-info { flex: 1; min-width: 100px; }
    .pg-controls {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-inline-start: auto;
    }
    .pg-current { min-width: 56px; text-align: center; }
    .pg-btn { min-width: 36px; }
    .pg-jump { min-width: 28px; padding-inline: 6px; font-size: 13px; }

    @media (max-width: 600px) {
      .pg-bar { gap: 10px; justify-content: space-between; }
      .pg-size { display: none; }
      .pg-info { font-size: 11px; order: 2; width: 100%; text-align: center; }
      .pg-controls { margin: 0; order: 1; width: 100%; justify-content: space-between; }
      .pg-btn-label { display: none; }
      /* First « and Last » are redundant on phone — hide them */
      .pg-jump { display: none; }
    }
  `],
})
export class PaginationComponent {
  @Input() page = 0;
  @Input() pageSize = 25;
  @Input() total = 0;
  @Input() totalPages = 1;
  @Input() showSizeSelector = true;

  @Output() pageChange = new EventEmitter<number>();
  @Output() pageSizeChange = new EventEmitter<number>();

  get label(): string {
    if (this.total === 0) return 'No items';
    if (this.totalPages <= 1) return `${this.total} item${this.total !== 1 ? 's' : ''}`;
    const start = this.page * this.pageSize + 1;
    const end = Math.min((this.page + 1) * this.pageSize, this.total);
    return `${start}–${end} of ${this.total}`;
  }

  onSizeChange(size: number): void {
    this.pageSizeChange.emit(Number(size));
  }
}
