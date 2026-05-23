import {
  Component, EventEmitter, Output, inject, signal, ChangeDetectionStrategy, NgZone, ElementRef, ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiClient } from '../../services/api-client.service';
import { IconComponent } from '../../shared/icons/icon.component';

type Step = 'upload' | 'importing' | 'results';

interface LogEntry {
  name: string;
  status: 'created' | 'updated' | 'skipped' | 'error';
  variantsCreated?: number;
  variantsUpdated?: number;
  imagesUploaded?: number;
  imagesFailed?: number;
  error?: string;
}

interface Summary { total: number; created: number; updated: number; failed: number; }

@Component({
  selector: 'ap-bulk-import-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="modal-overlay" (click)="onOverlayClick($event)">
      <div class="modal-panel" (click)="$event.stopPropagation()">

        <!-- Header -->
        <div class="modal-hd">
          <div>
            <div class="modal-title">Bulk Import Products</div>
            <div class="sub">Upload your product_list CSV — rows with the same name are grouped as color variants</div>
          </div>
          <button class="x-btn" (click)="close()" [disabled]="step() === 'importing'">
            <ap-icon name="x" [size]="18"/>
          </button>
        </div>

        <!-- ── UPLOAD ── -->
        @if (step() === 'upload') {
          <div class="modal-body">
            <div class="info-box">
              <div class="info-title">How it works</div>
              <div class="how-grid">
                <div class="how-step"><span class="how-n">1</span> Rows with the same <code>English Name</code> → grouped into one product</div>
                <div class="how-step"><span class="how-n">2</span> Each color row → a <strong>variant</strong> (SKU + color)</div>
                <div class="how-step"><span class="how-n">3</span> Images downloaded from Drive folders automatically</div>
              </div>
              <div class="col-grid" style="margin-top:10px;">
                @for (c of columns; track c.n) {
                  <div class="col-pill" [class.req]="c.req">
                    <code>{{ c.n }}</code>
                    @if (c.req) { <span class="req-dot"></span> }
                  </div>
                }
              </div>
            </div>

            <div class="drop-zone" [class.has-file]="csvFile()" [class.drag-over]="dragOver()"
                 (dragover)="onDragOver($event)" (dragleave)="dragOver.set(false)" (drop)="onDrop($event)"
                 (click)="fi.click()">
              <input #fi type="file" accept=".csv,text/csv" style="display:none" (change)="onFileChange($event)"/>
              @if (csvFile()) {
                <div class="file-row">
                  <ap-icon name="csv" [size]="26"/>
                  <div>
                    <div class="fname">{{ csvFile()!.name }}</div>
                    <div class="sub">{{ fmtBytes(csvFile()!.size) }}</div>
                  </div>
                  <button class="x-btn sm" (click)="removeFile($event)"><ap-icon name="x" [size]="13"/></button>
                </div>
              } @else {
                <ap-icon name="upload" [size]="30"/>
                <div class="drop-label">Drop CSV here or click to browse</div>
                <div class="sub">Max 10 MB · .csv only</div>
              }
            </div>

            @if (uploadError()) {
              <div class="err-banner">{{ uploadError() }}</div>
            }
          </div>

          <div class="modal-ft">
            <a class="btn btn-outline btn-sm" [href]="templateUrl" download>
              <ap-icon name="arrowDn" [size]="13"/> Template
            </a>
            <button class="btn btn-gold" [disabled]="!csvFile()" (click)="startImport()">
              <ap-icon name="upload" [size]="14"/> Import Products
            </button>
          </div>
        }

        <!-- ── IMPORTING ── -->
        @if (step() === 'importing') {
          <div class="modal-body imp-body">

            <div class="prog-header">
              <div class="prog-counts">
                <span class="prog-current">{{ current() }}</span>
                <span class="prog-sep">/</span>
                <span class="prog-total">{{ total() }}</span>
                <span class="prog-label">products processed</span>
              </div>
              <div class="prog-pct">{{ pct() }}%</div>
            </div>

            <div class="prog-track">
              <div class="prog-fill" [style.width.%]="pct()"></div>
            </div>

            @if (currentName()) {
              <div class="cur-item">
                <ap-icon name="spinner" [size]="13" class="spin"/>
                <div class="cur-details">
                  <span class="cur-name">{{ currentName() }}</span>
                  @if (currentVariantCount()) {
                    <span class="cur-variants">{{ currentVariantCount() }} color variants</span>
                  }
                </div>
              </div>
            }

            <div class="log-wrap" #logWrap>
              <div class="log-header">Live log</div>
              @for (e of log(); track e.name) {
                <div class="log-row" [class]="'log-' + e.status">
                  <span class="log-icon">{{ statusIcon(e.status) }}</span>
                  <span class="log-name">{{ e.name }}</span>
                  <span class="log-meta">
                    @if ((e.variantsCreated || 0) + (e.variantsUpdated || 0) > 0) {
                      <span class="meta-variants">
                        @if (e.variantsCreated) { <span class="var-new">+{{ e.variantsCreated }}</span> }
                        @if (e.variantsUpdated) { <span class="var-upd">↺{{ e.variantsUpdated }}</span> }
                        colors
                      </span>
                    }
                    @if (e.imagesUploaded) { <span class="img-ok">{{ e.imagesUploaded }} img</span> }
                    @if (e.imagesFailed)   { <span class="img-fail">{{ e.imagesFailed }} img failed</span> }
                  </span>
                  @if (e.error) { <span class="log-err" [title]="e.error">{{ e.error | slice:0:55 }}</span> }
                </div>
              }
            </div>

          </div>
        }

        <!-- ── RESULTS ── -->
        @if (step() === 'results') {
          @if (summary(); as s) {
            <div class="sum-bar">
              <div class="chip green">{{ s.created }} created</div>
              <div class="chip blue">{{ s.updated }} updated</div>
              @if (s.failed) { <div class="chip red">{{ s.failed }} failed</div> }
              <div class="sub ml-auto">{{ s.total }} products</div>
            </div>
          }
          <div class="modal-body" style="padding-top:0">
            <div class="res-wrap">
              <table class="res-table">
                <thead><tr><th>Product Name</th><th>Status</th><th>Variants</th><th>Images</th></tr></thead>
                <tbody>
                  @for (e of log(); track e.name) {
                    <tr [class.row-err]="e.status==='error'||e.status==='skipped'">
                      <td>{{ e.name || '—' }}</td>
                      <td>
                        <span class="s-pill" [class]="'pill-'+e.status">{{ statusLabel(e.status) }}</span>
                        @if (e.error) { <div class="row-err-txt">{{ e.error }}</div> }
                      </td>
                      <td class="sub">
                        @if (e.variantsCreated) { +{{ e.variantsCreated }} }
                        @if (e.variantsUpdated) { ↺{{ e.variantsUpdated }} }
                      </td>
                      <td class="sub">
                        @if (e.imagesUploaded) { {{ e.imagesUploaded }} }
                        @if (e.imagesFailed)   { · {{ e.imagesFailed }} failed }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
          <div class="modal-ft">
            <button class="btn btn-outline" (click)="reset()">Import Another</button>
            <button class="btn btn-outline" (click)="downloadReport()">
              <ap-icon name="arrowDn" [size]="13"/> Download Report
            </button>
            <button class="btn btn-gold" (click)="done()">Done</button>
          </div>
        }

      </div>
    </div>
  `,
  styles: [`
    .modal-overlay{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:24px;}
    .modal-panel{background:var(--surface,#fff);border:1px solid var(--border,#e4e4e7);border-radius:14px;width:100%;max-width:700px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.18);}
    .modal-hd{display:flex;align-items:flex-start;justify-content:space-between;padding:20px 24px 16px;border-bottom:1px solid var(--border,#e4e4e7);gap:12px;flex-shrink:0;}
    .modal-title{font-size:16px;font-weight:700;margin-bottom:2px;}
    .sub{font-size:12px;opacity:.55;}
    .modal-body{padding:20px 24px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:14px;}
    .modal-ft{padding:14px 24px;border-top:1px solid var(--border,#e4e4e7);display:flex;align-items:center;gap:10px;justify-content:flex-end;flex-shrink:0;}

    .x-btn{background:none;border:none;cursor:pointer;padding:4px;opacity:.45;display:flex;align-items:center;color:inherit;border-radius:6px;}
    .x-btn:hover{opacity:1;background:rgba(0,0,0,.06);}
    .x-btn:disabled{cursor:not-allowed;opacity:.2;}
    .x-btn.sm{padding:2px;}

    /* Info box */
    .info-box{border:1px solid var(--border,#e4e4e7);border-radius:8px;padding:14px 16px;background:var(--surface-2,#fafafa);}
    .info-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;opacity:.45;}
    .how-grid{display:flex;flex-direction:column;gap:6px;}
    .how-step{display:flex;align-items:center;gap:8px;font-size:12px;}
    .how-n{width:18px;height:18px;border-radius:50%;background:#c9a84c;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
    .col-grid{display:flex;flex-wrap:wrap;gap:6px;}
    .col-pill{display:flex;align-items:center;gap:4px;background:rgba(0,0,0,.05);border-radius:5px;padding:3px 8px;font-size:12px;}
    .col-pill.req{background:rgba(201,168,76,.12);border:1px solid rgba(201,168,76,.3);}
    .col-pill code{font-size:11px;}
    .req-dot{width:5px;height:5px;border-radius:50%;background:#c9a84c;flex-shrink:0;}

    /* Drop zone */
    .drop-zone{border:2px dashed var(--border,#d4d4d8);border-radius:10px;padding:32px 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;transition:border-color .15s,background .15s;text-align:center;}
    .drop-zone:hover,.drop-zone.drag-over{border-color:#c9a84c;background:rgba(201,168,76,.04);}
    .drop-zone.has-file{border-style:solid;border-color:#c9a84c;}
    .drop-label{font-size:14px;font-weight:600;}
    .file-row{display:flex;align-items:center;gap:12px;width:100%;justify-content:center;}
    .fname{font-size:14px;font-weight:600;}
    .err-banner{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:7px;padding:10px 14px;color:#dc2626;font-size:13px;}

    /* Progress */
    .imp-body{gap:12px;}
    .prog-header{display:flex;align-items:baseline;justify-content:space-between;}
    .prog-current{font-size:28px;font-weight:800;line-height:1;}
    .prog-sep{font-size:20px;opacity:.3;margin:0 3px;}
    .prog-total{font-size:20px;opacity:.4;}
    .prog-label{font-size:12px;opacity:.5;margin-left:8px;}
    .prog-pct{font-size:14px;font-weight:700;opacity:.6;}
    .prog-track{height:6px;background:rgba(0,0,0,.08);border-radius:99px;overflow:hidden;flex-shrink:0;}
    .prog-fill{height:100%;background:#c9a84c;border-radius:99px;transition:width .3s ease;}

    /* Current item */
    .cur-item{display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(201,168,76,.07);border-radius:7px;border-left:3px solid #c9a84c;}
    .spin{animation:spin .8s linear infinite;opacity:.6;flex-shrink:0;}
    @keyframes spin{to{transform:rotate(360deg);}}
    .cur-details{display:flex;flex-direction:column;gap:2px;overflow:hidden;}
    .cur-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .cur-variants{font-size:11px;opacity:.5;}

    /* Log */
    .log-wrap{flex:1;overflow-y:auto;border:1px solid var(--border,#e4e4e7);border-radius:8px;min-height:180px;max-height:280px;}
    .log-header{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.35;padding:8px 12px;border-bottom:1px solid var(--border,#e4e4e7);position:sticky;top:0;background:var(--surface,#fff);}
    .log-row{display:flex;align-items:center;gap:8px;padding:6px 12px;font-size:12px;border-bottom:1px solid rgba(0,0,0,.04);}
    .log-row:last-child{border-bottom:none;}
    .log-created{background:rgba(34,197,94,.04);}
    .log-updated{background:rgba(59,130,246,.04);}
    .log-error,.log-skipped{background:rgba(239,68,68,.04);}
    .log-icon{font-size:13px;flex-shrink:0;width:16px;text-align:center;}
    .log-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;}
    .log-meta{display:flex;align-items:center;gap:6px;flex-shrink:0;font-size:11px;}
    .meta-variants{display:flex;align-items:center;gap:3px;opacity:.7;}
    .var-new{color:#16a34a;font-weight:700;}
    .var-upd{color:#2563eb;font-weight:700;}
    .img-ok{color:#16a34a;}.img-fail{color:#dc2626;}
    .log-err{font-size:11px;color:#dc2626;opacity:.8;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

    /* Summary bar */
    .sum-bar{display:flex;align-items:center;gap:8px;padding:12px 24px;border-bottom:1px solid var(--border,#e4e4e7);flex-shrink:0;}
    .chip{font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px;}
    .chip.green{background:rgba(34,197,94,.12);color:#16a34a;}
    .chip.blue{background:rgba(59,130,246,.12);color:#2563eb;}
    .chip.red{background:rgba(239,68,68,.12);color:#dc2626;}
    .ml-auto{margin-left:auto;}

    /* Results table */
    .res-wrap{overflow-x:auto;}
    .res-table{width:100%;border-collapse:collapse;font-size:13px;}
    .res-table th{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border,#e4e4e7);font-size:10px;text-transform:uppercase;letter-spacing:.04em;opacity:.4;}
    .res-table td{padding:7px 10px;border-bottom:1px solid rgba(0,0,0,.05);vertical-align:top;}
    .res-table tr.row-err td{background:rgba(239,68,68,.03);}
    .s-pill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;display:inline-block;}
    .pill-created{background:rgba(34,197,94,.12);color:#16a34a;}
    .pill-updated{background:rgba(59,130,246,.12);color:#2563eb;}
    .pill-skipped{background:rgba(0,0,0,.07);color:#71717a;}
    .pill-error{background:rgba(239,68,68,.12);color:#dc2626;}
    .row-err-txt{color:#dc2626;font-size:11px;margin-top:2px;}
  `],
})
export class BulkImportDialogComponent {
  @Output() closed   = new EventEmitter<void>();
  @Output() imported = new EventEmitter<void>();
  @ViewChild('logWrap') logWrap?: ElementRef<HTMLDivElement>;

  private readonly api  = inject(ApiClient);
  private readonly zone = inject(NgZone);

  readonly step               = signal<Step>('upload');
  readonly csvFile            = signal<File | null>(null);
  readonly dragOver           = signal(false);
  readonly uploadError        = signal('');
  readonly current            = signal(0);
  readonly total              = signal(0);
  readonly currentName        = signal('');
  readonly currentVariantCount = signal(0);
  readonly log                = signal<LogEntry[]>([]);
  readonly summary            = signal<Summary | null>(null);

  readonly pct = () => this.total() ? Math.round((this.current() / this.total()) * 100) : 0;

  readonly templateUrl = this.api.url('/admin/bulk-import/template');

  readonly columns = [
    { n: 'SKU',           req: true  },
    { n: 'English Name',  req: true  },
    { n: 'Description',   req: false },
    { n: 'English Color', req: false },
    { n: 'Arabic Name',   req: false },
    { n: 'Price',         req: false },
    { n: 'Picture',       req: false },
  ];

  onOverlayClick(_e: MouseEvent) { if (this.step() !== 'importing') this.close(); }
  close()  { this.closed.emit(); }
  done()   { this.imported.emit(); this.closed.emit(); }

  reset() {
    this.csvFile.set(null); this.uploadError.set('');
    this.log.set([]); this.summary.set(null);
    this.current.set(0); this.total.set(0);
    this.currentName.set(''); this.currentVariantCount.set(0);
    this.step.set('upload');
  }

  onFileChange(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) this.setFile(f);
    (e.target as HTMLInputElement).value = '';
  }
  onDragOver(e: DragEvent) { e.preventDefault(); this.dragOver.set(true); }
  onDrop(e: DragEvent) {
    e.preventDefault(); this.dragOver.set(false);
    const f = e.dataTransfer?.files?.[0]; if (f) this.setFile(f);
  }
  removeFile(e: Event) { e.stopPropagation(); this.csvFile.set(null); this.uploadError.set(''); }

  private setFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv' && file.type !== 'text/plain') {
      this.uploadError.set('Please select a valid .csv file.'); return;
    }
    this.uploadError.set(''); this.csvFile.set(file);
  }

  async startImport() {
    const file = this.csvFile(); if (!file) return;
    this.step.set('importing');
    this.log.set([]); this.current.set(0); this.total.set(0);
    this.currentName.set(''); this.currentVariantCount.set(0);

    const form = new FormData();
    form.append('csv', file, file.name);

    try {
      const resp = await fetch(this.api.url('/admin/bulk-import'), {
        method: 'POST', body: form, credentials: 'include',
      });

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ message: 'Import failed.' }));
        this.zone.run(() => { this.uploadError.set(err.message || 'Import failed.'); this.step.set('upload'); });
        return;
      }

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim(); if (!trimmed) continue;
          try {
            const evt = JSON.parse(trimmed);
            this.zone.run(() => this.handleEvent(evt));
          } catch { /* malformed line */ }
        }
      }
    } catch (err: any) {
      this.zone.run(() => { this.uploadError.set(err.message || 'Network error.'); this.step.set('upload'); });
    }
  }

  private handleEvent(evt: any) {
    switch (evt.type) {
      case 'start':
        this.total.set(evt.total);
        break;

      case 'processing':
        this.current.set(evt.current);
        this.currentName.set(evt.name);
        this.currentVariantCount.set(evt.variantCount || 0);
        break;

      case 'item':
        this.current.set(evt.current);
        this.currentName.set('');
        this.currentVariantCount.set(0);
        this.log.update(l => [...l, {
          name: evt.name,
          status: evt.status,
          variantsCreated: evt.variantsCreated,
          variantsUpdated: evt.variantsUpdated,
          imagesUploaded: evt.imagesUploaded,
          imagesFailed: evt.imagesFailed,
          error: evt.error,
        }]);
        setTimeout(() => {
          const el = this.logWrap?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        }, 0);
        break;

      case 'done':
        this.summary.set(evt.summary);
        this.currentName.set(''); this.currentVariantCount.set(0);
        this.step.set('results');
        break;
    }
  }

  statusIcon(s: string): string {
    switch (s) {
      case 'created': return '✓';
      case 'updated': return '↺';
      case 'skipped': return '—';
      case 'error':   return '✕';
      default: return '·';
    }
  }

  statusLabel(s: string): string {
    switch (s) {
      case 'created': return '+ Created';
      case 'updated': return '↺ Updated';
      case 'skipped': return '— Skipped';
      case 'error':   return '✕ Error';
      default: return s;
    }
  }

  fmtBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
    return `${(b/1048576).toFixed(1)} MB`;
  }

  downloadReport(): void {
    const s = this.summary();
    const rows = this.log();
    if (!rows.length) return;

    const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
    const lines: string[] = [
      `# Elite Bulk Import Report — ${new Date().toLocaleString()}`,
      `# Total: ${s?.total ?? rows.length} | Created: ${s?.created ?? 0} | Updated: ${s?.updated ?? 0} | Failed: ${s?.failed ?? 0}`,
      '',
      'Product Name,Status,Variants Created,Variants Updated,Images Uploaded,Images Failed,Error Details',
    ];

    for (const e of rows) {
      const cols = [
        `"${(e.name || '').replace(/"/g, '""')}"`,
        e.status,
        e.variantsCreated ?? 0,
        e.variantsUpdated ?? 0,
        e.imagesUploaded ?? 0,
        e.imagesFailed ?? 0,
        `"${(e.error || '').replace(/"/g, '""')}"`,
      ];
      lines.push(cols.join(','));
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `import-report-${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
