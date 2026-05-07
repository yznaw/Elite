import {
  Component, ContentChildren, Directive, Input, QueryList,
  TemplateRef, computed, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../services/i18n.service';

export interface TableColumn<T = any> {
  key: string;
  label: string;
  /** Optional i18n key — if set, the header label is rendered via `t(labelKey)`. */
  labelKey?: string;
  sort?: (row: T) => string | number;
  noSort?: boolean;
  align?: 'left' | 'right' | 'center';
}

type Row = Record<string, any>;

@Directive({
  selector: '[apCellTpl]',
  standalone: true,
})
export class CellTplDirective {
  @Input({ required: true, alias: 'apCellTpl' }) key!: string;
  constructor(public tpl: TemplateRef<{ $implicit: any }>) {}
}

@Component({
  selector: 'ap-sortable-table',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tbl-scroll">
    <table class="tbl">
      <thead>
        <tr>
          @for (c of columns; track c.key) {
            <th
              [class.sorted]="sortBy() === c.key"
              (click)="onHeaderClick(c)"
              [style.text-align]="c.align || 'left'"
              [style.cursor]="c.noSort ? 'default' : 'pointer'"
            >
              {{ c.labelKey ? t(c.labelKey) : c.label }}
              @if (!c.noSort) {
                <span class="sort-i">{{ sortBy() === c.key ? (dir() === 'asc' ? '▲' : '▼') : '↕' }}</span>
              }
            </th>
          }
        </tr>
      </thead>
      <tbody>
        @for (r of sorted(); track trackId(r)) {
          <tr [class.clickable]="!!rowClick" (click)="onRowClick(r)">
            @for (c of columns; track c.key) {
              <td [style.text-align]="c.align || 'left'">
                @if (templates[c.key]) {
                  <ng-container *ngTemplateOutlet="templates[c.key]; context: { $implicit: r }"/>
                } @else {
                  {{ getValue(r, c.key) }}
                }
              </td>
            }
          </tr>
        }
      </tbody>
    </table>
    </div>
  `,
})
export class SortableTableComponent {
  private readonly i18n = inject(I18nService);
  readonly t = (k: string): string => this.i18n.t(k);

  @Input({ required: true }) columns: TableColumn<any>[] = [];
  @Input({ required: true }) set rows(v: Row[]) { this._rows.set(v); }
  @Input() defaultSort?: string;
  @Input() rowClick?: (r: any) => void;
  @Input() trackBy: (r: Row) => string | number = (r) => (r['id'] as string | number) ?? JSON.stringify(r);

  @ContentChildren(CellTplDirective) set tplList(list: QueryList<CellTplDirective>) {
    this.templates = {};
    list.forEach((d) => {
      this.templates[d.key] = d.tpl;
    });
  }

  templates: Record<string, TemplateRef<{ $implicit: any }>> = {};

  private _rows = signal<Row[]>([]);
  readonly sortBy = signal<string>('');
  readonly dir = signal<'asc' | 'desc'>('desc');

  readonly sorted = computed<Row[]>(() => {
    const rows = this._rows();
    const key = this.sortBy() || this.defaultSort || (this.columns[0]?.key ?? '');
    const col = this.columns.find((c) => c.key === key);
    if (!col || col.noSort) return rows;
    const direction = this.dir() === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sort ? col.sort(a) : (a[key] as string | number);
      const bv = col.sort ? col.sort(b) : (b[key] as string | number);
      if (av === bv) return 0;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction;
      return String(av).localeCompare(String(bv)) * direction;
    });
  });

  ngOnInit(): void {
    if (this.defaultSort) this.sortBy.set(this.defaultSort);
    else if (this.columns[0]) this.sortBy.set(this.columns[0].key);
  }

  onHeaderClick(c: TableColumn<any>): void {
    if (c.noSort) return;
    if (this.sortBy() === c.key) {
      this.dir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortBy.set(c.key);
      this.dir.set('desc');
    }
  }

  onRowClick(r: Row): void {
    if (this.rowClick) this.rowClick(r);
  }

  getValue(row: Row, key: string): unknown {
    return row[key];
  }

  trackId(r: Row): string | number {
    return this.trackBy(r);
  }
}
