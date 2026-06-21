import {
  Component, EventEmitter, Output, inject, signal, ChangeDetectionStrategy, NgZone, ElementRef, ViewChild,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ApiClient } from '../../services/api-client.service';
import { StorageService } from '../../services/storage.service';
import { IconComponent } from '../../shared/icons/icon.component';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';

type Step = 'upload' | 'importing' | 'results' | 'stock-results' | 'history';

interface HistoryRecord {
  id: string;
  ts: string;
  filename: string;
  summary: Summary;
  log: LogEntry[];
  expanded?: boolean;
}

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
  imports: [CommonModule, DatePipe, IconComponent],
  template: `
    <div class="modal-overlay" (click)="onOverlayClick($event)">
      <div class="modal-panel" (click)="$event.stopPropagation()">

        <!-- Header -->
        <div class="modal-hd">
          <div class="modal-hd-left">
            <div class="modal-title">{{ t('bulkImport.title.products') }}</div>
          </div>
          <button class="x-btn" (click)="close()" [disabled]="step() === 'importing'">
            <ap-icon name="x" [size]="16"/>
          </button>
        </div>

        <!-- Tabs — always visible except during import -->
        @if (step() !== 'importing') {
          <div class="mode-tabs">
            <button class="mode-tab" [class.active]="step() === 'upload' && !stockMode()" (click)="switchMode(false)">
              <ap-icon name="upload" [size]="13"/> {{ t('bulkImport.tab.products') }}
            </button>
            <button class="mode-tab" [class.active]="step() === 'upload' && stockMode()" (click)="switchMode(true)">
              <ap-icon name="csv" [size]="13"/> {{ t('bulkImport.tab.stock') }}
            </button>
            <button class="mode-tab" [class.active]="step() === 'history'" (click)="step.set('history')" style="margin-inline-start:auto;">
              <ap-icon name="clock" [size]="13"/> {{ t('bulkImport.tab.history') }}
              @if (importHistory().length) { <span class="hist-badge">{{ importHistory().length }}</span> }
            </button>
          </div>
        }

        <!-- ── UPLOAD: Products ── -->
        @if (step() === 'upload' && !stockMode()) {
          <div class="modal-body">
            <div class="info-box">
              <div class="info-title">{{ t('bulkImport.howTitle') }}</div>
              <div class="how-grid">
                <div class="how-step"><span class="how-n">1</span> {{ t('bulkImport.step.p1') }}</div>
                <div class="how-step"><span class="how-n">2</span> {{ t('bulkImport.step.p2') }}</div>
                <div class="how-step"><span class="how-n">3</span> {{ t('bulkImport.step.p3') }}</div>
                <div class="how-step"><span class="how-n">4</span> {{ t('bulkImport.step.p4') }}</div>
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
                <div class="drop-label">{{ t('bulkImport.drop.label') }}</div>
                <div class="sub">{{ t('bulkImport.drop.sub.stock') }}</div>
              }
            </div>
            @if (uploadError()) { <div class="err-banner">{{ uploadError() }}</div> }
          </div>

          <div class="modal-ft">
            <label class="dry-run-toggle" title="Preview changes without writing to the database" style="margin-inline-end:auto;">
              <input type="checkbox" [checked]="dryRun()" (change)="dryRun.set(!dryRun())"/>
              <span>{{ t('bulkImport.dryRun') }}</span>
            </label>
            <button class="btn btn-outline btn-sm" [disabled]="repairingColors()" (click)="repairColors()"
                    title="Fix variants with missing color by inferring from their SKU">
              @if (repairingColors()) {
                <ap-icon name="spinner" [size]="13" class="spin"/> {{ t('bulkImport.btn.repairingColors') }}
              } @else {
                <ap-icon name="wand" [size]="13"/> {{ t('bulkImport.btn.repairColors') }}
              }
            </button>
            <a class="btn btn-outline btn-sm" [href]="templateUrl" download>
              <ap-icon name="download" [size]="13"/> {{ t('bulkImport.template') }}
            </a>
            <button class="btn btn-gold" [disabled]="!csvFile()" (click)="startImport()">
              <ap-icon name="upload" [size]="14"/> {{ dryRun() ? t('bulkImport.btn.previewImport') : t('bulkImport.btn.importProducts') }}
            </button>
          </div>
        }

        <!-- ── UPLOAD: Stock ── -->
        @if (step() === 'upload' && stockMode()) {
          <div class="modal-body">
            <div class="info-box">
              <div class="info-title">{{ t('bulkImport.howTitle') }}</div>
              <div class="how-grid">
                <div class="how-step"><span class="how-n">1</span> {{ t('bulkImport.step.s1') }}</div>
                <div class="how-step"><span class="how-n">2</span> {{ t('bulkImport.step.s2') }}</div>
                <div class="how-step"><span class="how-n">3</span> {{ t('bulkImport.step.s3') }}</div>
              </div>
            </div>

            <div class="drop-zone" [class.has-file]="csvFile()" [class.drag-over]="dragOver()"
                 (dragover)="onDragOver($event)" (dragleave)="dragOver.set(false)" (drop)="onDrop($event)"
                 (click)="si.click()">
              <input #si type="file" accept=".csv,text/csv" style="display:none" (change)="onFileChange($event)"/>
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
                <div class="drop-label">{{ t('bulkImport.drop.label') }}</div>
                <div class="sub">{{ t('bulkImport.drop.sub.stock') }}</div>
              }
            </div>
            @if (uploadError()) { <div class="err-banner">{{ uploadError() }}</div> }
          </div>

          <div class="modal-ft">
            <button class="btn btn-outline btn-sm" (click)="downloadStockTemplate()">
              <ap-icon name="download" [size]="13"/> {{ t('bulkImport.template') }}
            </button>
            <button class="btn btn-gold" [disabled]="!csvFile()" (click)="startStockImport()">
              <ap-icon name="upload" [size]="14"/> {{ t('bulkImport.btn.updateStock') }}
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
                <span class="prog-label">{{ t('bulkImport.processing.label') }}</span>
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
                    <span class="cur-variants">{{ currentVariantCount() }} {{ t('bulkImport.processing.colorVariants') }}</span>
                  }
                </div>
              </div>
            }
            <div class="log-wrap" #logWrap>
              <div class="log-header">{{ t('bulkImport.processing.liveLog') }}</div>
              @for (e of log(); track e.name) {
                <div class="log-row" [class]="'log-' + e.status">
                  <span class="log-icon">{{ statusIcon(e.status) }}</span>
                  <span class="log-name">{{ e.name }}</span>
                  <span class="log-meta">
                    @if ((e.variantsCreated || 0) + (e.variantsUpdated || 0) > 0) {
                      <span class="meta-variants">
                        @if (e.variantsCreated) { <span class="var-new">+{{ e.variantsCreated }}</span> }
                        @if (e.variantsUpdated) { <span class="var-upd">↺{{ e.variantsUpdated }}</span> }
                        variants
                      </span>
                    }
                    @if (e.imagesUploaded) { <span class="img-ok">{{ e.imagesUploaded }} img</span> }
                    @if (e.imagesFailed)   { <span class="img-fail">{{ e.imagesFailed }} {{ t('bulkImport.processing.imgFailed') }}</span> }
                  </span>
                  @if (e.error) { <span class="log-err" [title]="e.error">{{ e.error | slice:0:55 }}</span> }
                </div>
              }
            </div>
          </div>
        }

        <!-- ── RESULTS ── -->
        @if (step() === 'results') {
          @if (wasLastDryRun()) {
            <div class="dry-run-banner">
              <ap-icon name="warning" [size]="13"/>
              <strong>{{ t('bulkImport.dryRunBanner') }}</strong>
            </div>
          }
          @if (summary(); as s) {
            <div class="sum-bar">
              <div class="chip green">{{ s.created }} {{ wasLastDryRun() ? t('bulkImport.chip.toCreate') : t('bulkImport.chip.created') }}</div>
              <div class="chip blue">{{ s.updated }} {{ wasLastDryRun() ? t('bulkImport.chip.toUpdate') : t('bulkImport.chip.updated') }}</div>
              @if (s.failed) { <div class="chip red">{{ s.failed }} {{ t('bulkImport.chip.failed') }}</div> }
              <div class="sub" style="margin-inline-start:auto;">{{ s.total }} {{ t('bulkImport.chip.products') }}</div>
            </div>
          }
          <div class="modal-body" style="padding-top:0">
            <div class="res-wrap">
              <table class="res-table">
                <thead><tr><th>{{ t('bulkImport.table.productName') }}</th><th>{{ t('bulkImport.table.status') }}</th><th>{{ t('bulkImport.table.variants') }}</th><th>{{ t('bulkImport.table.images') }}</th></tr></thead>
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
            @if ((summary()?.failed ?? 0) > 0) {
              <button class="btn btn-outline btn-sm" (click)="retryFailed()">
                <ap-icon name="sync" [size]="13"/> {{ t('bulkImport.btn.retryFailed') }} ({{ summary()!.failed }})
              </button>
            }
            <button class="btn btn-outline btn-sm" (click)="downloadReport()">
              <ap-icon name="download" [size]="13"/> {{ t('bulkImport.btn.downloadReport') }}
            </button>
            <button class="btn btn-outline" (click)="reset()">{{ t('bulkImport.btn.importAnother') }}</button>
            @if (wasLastDryRun()) {
              <button class="btn btn-gold" (click)="commitDryRun()">
                <ap-icon name="check" [size]="14"/> {{ t('bulkImport.btn.commitImport') }}
              </button>
            } @else {
              <button class="btn btn-gold" (click)="done()">{{ t('common.done') }}</button>
            }
          </div>
        }

        <!-- ── STOCK RESULTS ── -->
        @if (step() === 'stock-results') {
          @if (stockResult(); as r) {
            <div class="sum-bar">
              <div class="chip green">{{ r.updated }} {{ t('bulkImport.chip.updated') }}</div>
              @if (r.notFound.length) { <div class="chip red">{{ r.notFound.length }} {{ t('bulkImport.chip.notFound') }}</div> }
              <div class="sub" style="margin-inline-start:auto;">{{ r.updated + r.notFound.length }} {{ t('bulkImport.chip.rowsProcessed') }}</div>
            </div>
          }
          <div class="modal-body" style="padding-top:0">
            @if (stockResult()?.notFound?.length) {
              <div class="err-banner">
                <strong>{{ t('bulkImport.stock.unmatchedSKUs') }}</strong> {{ stockResult()!.notFound.join(', ') }}
              </div>
            } @else if (stockResult()?.updated === 0) {
              <div class="empty-state">{{ t('bulkImport.stock.noMatch') }}</div>
            } @else {
              <div class="empty-state" style="color:var(--green,#16a34a);">{{ t('bulkImport.stock.allProcessed') }}</div>
            }
          </div>
          <div class="modal-ft">
            <button class="btn btn-outline" (click)="reset()">{{ t('bulkImport.btn.importAnother') }}</button>
            <button class="btn btn-gold" (click)="done()">{{ t('common.done') }}</button>
          </div>
        }

        <!-- ── HISTORY ── -->
        @if (step() === 'history') {
          <div class="modal-body" style="padding-top:8px;">
            @if (importHistory().length === 0) {
              <div class="empty-state">{{ t('bulkImport.history.empty') }}</div>
            } @else {
              @for (h of importHistory(); track h.id) {
                <div class="hist-row">
                  <div class="hist-hd" (click)="toggleHistory(h.id)">
                    <div class="hist-info">
                      <div class="hist-file">{{ h.filename }}</div>
                      <div class="sub">{{ h.ts | date:'MMM d, yyyy · HH:mm' }} · {{ h.summary.total }} {{ t('bulkImport.chip.products') }}</div>
                    </div>
                    <div class="hist-chips">
                      <span class="chip green sm">{{ h.summary.created }} {{ t('bulkImport.chip.created') }}</span>
                      <span class="chip blue sm">{{ h.summary.updated }} {{ t('bulkImport.chip.updated') }}</span>
                      @if (h.summary.failed) { <span class="chip red sm">{{ h.summary.failed }} {{ t('bulkImport.chip.failed') }}</span> }
                    </div>
                    <button class="icon-btn" type="button" title="Download report" (click)="$event.stopPropagation(); downloadHistoryReport(h)">
                      <ap-icon name="download" [size]="13"/>
                    </button>
                    <ap-icon [name]="h.expanded ? 'arrowUp' : 'arrowDn'" [size]="12" style="opacity:.35;flex-shrink:0;"/>
                  </div>
                  @if (h.expanded) {
                    <div class="hist-detail">
                      @for (e of h.log; track e.name) {
                        <div class="log-row" [class]="'log-' + e.status">
                          <span class="log-icon">{{ statusIcon(e.status) }}</span>
                          <span class="log-name">{{ e.name }}</span>
                          @if (e.error) { <span class="log-err">{{ e.error | slice:0:60 }}</span> }
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            }
          </div>
          <div class="modal-ft">
            @if (importHistory().length > 0) {
              <button class="btn btn-outline btn-sm" style="color:var(--danger);margin-inline-end:auto;" (click)="clearHistory()">
                <ap-icon name="trash" [size]="13"/> {{ t('bulkImport.history.clearHistory') }}
              </button>
            }
          </div>
        }

      </div>
    </div>
  `,
  styles: [`
    /* Layout */
    .modal-overlay{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px;}
    .modal-panel{background:var(--surface,#fff);border:1px solid var(--border,#e4e4e7);border-radius:16px;width:100%;max-width:660px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.15);}

    /* Header */
    .modal-hd{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 14px;border-bottom:1px solid var(--border,#e4e4e7);gap:12px;flex-shrink:0;}
    .modal-hd-left{min-width:0;}
    .modal-title{font-size:15px;font-weight:700;color:var(--ink,#111);}
    .x-btn{background:none;border:none;cursor:pointer;width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:var(--ink-2,#666);border-radius:6px;opacity:.5;transition:opacity .12s,background .12s;flex-shrink:0;}
    .x-btn:hover{opacity:1;background:rgba(0,0,0,.06);}
    .x-btn:disabled{cursor:not-allowed;opacity:.2;}
    .x-btn.sm{width:22px;height:22px;}

    /* Tabs */
    .mode-tabs{display:flex;border-bottom:1px solid var(--border,#e4e4e7);padding:0 20px;flex-shrink:0;gap:0;}
    .mode-tab{border:none;background:none;cursor:pointer;padding:10px 14px;font-size:12px;font-weight:600;color:var(--ink-2,#71717a);border-bottom:2px solid transparent;margin-bottom:-1px;display:flex;align-items:center;gap:5px;transition:color .13s,border-color .13s;white-space:nowrap;}
    .mode-tab:hover{color:var(--ink,#111);}
    .mode-tab.active{color:var(--ink,#111);border-bottom-color:#c9a84c;}
    .hist-badge{background:#c9a84c;color:#fff;font-size:9px;font-weight:800;border-radius:10px;padding:1px 5px;margin-inline-start:3px;}

    /* Body + footer */
    .sub{font-size:11px;color:var(--muted,#888);}
    .modal-body{padding:16px 20px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:12px;}
    .modal-ft{padding:12px 20px;border-top:1px solid var(--border,#e4e4e7);display:flex;align-items:center;gap:8px;justify-content:flex-end;flex-shrink:0;}
    .empty-state{text-align:center;padding:40px 20px;color:var(--muted,#888);font-size:13px;}

    /* Info box */
    .info-box{border:1px solid var(--border,#e4e4e7);border-radius:8px;padding:12px 14px;background:var(--bg,#fafafa);}
    .info-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;color:var(--muted,#888);}
    .how-grid{display:flex;flex-direction:column;gap:5px;}
    .how-step{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink,#111);}
    .how-n{width:18px;height:18px;border-radius:50%;background:#c9a84c;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
    .col-grid{display:flex;flex-wrap:wrap;gap:5px;}
    .col-pill{display:flex;align-items:center;gap:4px;background:rgba(0,0,0,.05);border-radius:5px;padding:3px 7px;font-size:11px;}
    .col-pill.req{background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.3);}
    .col-pill code{font-size:10px;font-family:monospace;}
    .req-dot{width:4px;height:4px;border-radius:50%;background:#c9a84c;flex-shrink:0;}

    /* Drop zone */
    .drop-zone{border:2px dashed var(--border,#d4d4d8);border-radius:10px;padding:28px 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;cursor:pointer;transition:border-color .14s,background .14s;text-align:center;color:var(--ink-2,#666);}
    .drop-zone:hover,.drop-zone.drag-over{border-color:#c9a84c;background:rgba(201,168,76,.04);}
    .drop-zone.has-file{border-style:solid;border-color:#c9a84c;background:rgba(201,168,76,.03);}
    .drop-label{font-size:13px;font-weight:600;color:var(--ink,#111);}
    .file-row{display:flex;align-items:center;gap:10px;justify-content:center;}
    .fname{font-size:13px;font-weight:600;color:var(--ink,#111);}
    .err-banner{background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.18);border-radius:7px;padding:9px 13px;color:#dc2626;font-size:12px;}

    /* Dry-run */
    .dry-run-toggle{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:600;color:var(--muted,#888);}
    .dry-run-toggle input{accent-color:#c9a84c;cursor:pointer;}
    .dry-run-banner{display:flex;align-items:center;gap:8px;background:rgba(245,158,11,.08);border-top:2px solid rgba(245,158,11,.35);padding:9px 20px;font-size:12px;color:#92400e;flex-shrink:0;}

    /* Progress */
    .imp-body{gap:12px;}
    .prog-header{display:flex;align-items:baseline;justify-content:space-between;}
    .prog-current{font-size:26px;font-weight:800;line-height:1;color:var(--ink,#111);}
    .prog-sep{font-size:18px;opacity:.3;margin:0 3px;}
    .prog-total{font-size:18px;opacity:.4;}
    .prog-label{font-size:11px;opacity:.5;margin-left:8px;}
    .prog-pct{font-size:13px;font-weight:700;opacity:.55;}
    .prog-track{height:5px;background:rgba(0,0,0,.07);border-radius:99px;overflow:hidden;flex-shrink:0;}
    .prog-fill{height:100%;background:#c9a84c;border-radius:99px;transition:width .3s ease;}
    .cur-item{display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(201,168,76,.07);border-radius:7px;border-inline-start:3px solid #c9a84c;}
    .spin{animation:spin .8s linear infinite;opacity:.6;flex-shrink:0;}
    @keyframes spin{to{transform:rotate(360deg);}}
    .cur-details{display:flex;flex-direction:column;gap:2px;overflow:hidden;}
    .cur-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .cur-variants{font-size:11px;opacity:.5;}

    /* Log */
    .log-wrap{flex:1;overflow-y:auto;border:1px solid var(--border,#e4e4e7);border-radius:8px;min-height:160px;max-height:260px;}
    .log-header{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.35;padding:7px 12px;border-bottom:1px solid var(--border,#e4e4e7);position:sticky;top:0;background:var(--surface,#fff);}
    .log-row{display:flex;align-items:center;gap:8px;padding:5px 12px;font-size:12px;border-bottom:1px solid rgba(0,0,0,.04);}
    .log-row:last-child{border-bottom:none;}
    .log-created{background:rgba(34,197,94,.04);}
    .log-updated{background:rgba(59,130,246,.04);}
    .log-error,.log-skipped{background:rgba(239,68,68,.04);}
    .log-icon{font-size:12px;flex-shrink:0;width:14px;text-align:center;}
    .log-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;}
    .log-meta{display:flex;align-items:center;gap:5px;flex-shrink:0;font-size:11px;}
    .meta-variants{display:flex;align-items:center;gap:3px;opacity:.65;}
    .var-new{color:#16a34a;font-weight:700;}
    .var-upd{color:#2563eb;font-weight:700;}
    .img-ok{color:#16a34a;}.img-fail{color:#dc2626;}
    .log-err{font-size:11px;color:#dc2626;opacity:.8;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

    /* Summary bar */
    .sum-bar{display:flex;align-items:center;gap:8px;padding:10px 20px;border-bottom:1px solid var(--border,#e4e4e7);flex-shrink:0;flex-wrap:wrap;}
    .chip{font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;}
    .chip.green{background:rgba(34,197,94,.12);color:#16a34a;}
    .chip.blue{background:rgba(59,130,246,.12);color:#2563eb;}
    .chip.red{background:rgba(239,68,68,.12);color:#dc2626;}
    .chip.sm{font-size:10px;padding:2px 7px;}

    /* Results table */
    .res-wrap{overflow-x:auto;}
    .res-table{width:100%;border-collapse:collapse;font-size:12px;}
    .res-table th{text-align:start;padding:7px 10px;border-bottom:1px solid var(--border,#e4e4e7);font-size:10px;text-transform:uppercase;letter-spacing:.04em;opacity:.4;}
    .res-table td{padding:6px 10px;border-bottom:1px solid rgba(0,0,0,.05);vertical-align:top;}
    .res-table tr.row-err td{background:rgba(239,68,68,.03);}
    .s-pill{font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;display:inline-block;}
    .pill-created{background:rgba(34,197,94,.12);color:#16a34a;}
    .pill-updated{background:rgba(59,130,246,.12);color:#2563eb;}
    .pill-skipped{background:rgba(0,0,0,.07);color:#71717a;}
    .pill-error{background:rgba(239,68,68,.12);color:#dc2626;}
    .row-err-txt{color:#dc2626;font-size:11px;margin-top:2px;}

    /* History */
    .hist-row{border:1px solid var(--border,#e4e4e7);border-radius:8px;overflow:hidden;flex-shrink:0;}
    .hist-hd{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;background:var(--bg,#fafafa);transition:background .12s;}
    .hist-hd:hover{background:var(--bg-2,#f0f0f0);}
    .hist-info{flex:1;min-width:0;}
    .hist-file{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink,#111);}
    .hist-chips{display:flex;gap:4px;flex-shrink:0;}
    .hist-detail{border-top:1px solid var(--border,#e4e4e7);max-height:160px;overflow-y:auto;}
    .icon-btn{background:none;border:1px solid var(--border,#e4e4e7);cursor:pointer;width:26px;height:26px;display:flex;align-items:center;justify-content:center;color:var(--ink-2,#666);border-radius:6px;flex-shrink:0;transition:background .12s,border-color .12s;}
    .icon-btn:hover{background:var(--bg,#f5f5f5);border-color:var(--gold,#c9a84c);color:var(--gold,#c9a84c);}
    .hist-row{border:1px solid var(--border,#e4e4e7);border-radius:8px;overflow:hidden;flex-shrink:0;}
    .hist-hd{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;background:var(--surface-2,#fafafa);}
    .hist-hd:hover{background:var(--bg-2,#f0f0f0);}
    .hist-info{flex:1;min-width:0;}
    .hist-file{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .hist-chips{display:flex;gap:4px;flex-shrink:0;}
    .chip.sm{font-size:10px;padding:2px 7px;}
    .hist-detail{border-top:1px solid var(--border,#e4e4e7);max-height:180px;overflow-y:auto;}
  `],
})
export class BulkImportDialogComponent {
  @Output() closed   = new EventEmitter<void>();
  @Output() imported = new EventEmitter<void>();
  @ViewChild('logWrap') logWrap?: ElementRef<HTMLDivElement>;

  private readonly api  = inject(ApiClient);
  private readonly zone = inject(NgZone);
  private readonly storage = inject(StorageService);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  readonly t = (k: string): string => this.i18n.t(k);

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
  readonly stockMode          = signal(false);
  readonly stockResult        = signal<{ updated: number; notFound: string[] } | null>(null);
  readonly dryRun             = signal(false);
  readonly wasLastDryRun      = signal(false);
  readonly lastFile           = signal<File | null>(null);
  readonly importHistory      = signal<HistoryRecord[]>(this.loadHistory());
  readonly repairingColors    = signal(false);

  readonly pct = () => this.total() ? Math.round((this.current() / this.total()) * 100) : 0;

  readonly templateUrl = this.api.url('/admin/bulk-import/template');

  readonly columns = [
    { n: 'New SKU',        req: true  },
    { n: 'English Name',   req: true  },
    { n: 'Size',           req: false },
    { n: 'Description',    req: false },
    { n: 'English Color',  req: false },
    { n: 'Arabic Name',    req: false },
    { n: 'Selling Price',  req: false },
    { n: 'Cost-QAR',       req: false },
    { n: 'Shipping cost',  req: false },
    { n: 'quantity',       req: false },
    { n: 'collections',    req: false },
    { n: 'Picture',        req: false },
  ];

  onOverlayClick(_e: MouseEvent) { if (this.step() !== 'importing') this.close(); }
  close()  { this.closed.emit(); }
  done()   { this.imported.emit(); this.closed.emit(); }

  reset() {
    this.csvFile.set(null); this.uploadError.set('');
    this.log.set([]); this.summary.set(null);
    this.current.set(0); this.total.set(0);
    this.currentName.set(''); this.currentVariantCount.set(0);
    this.stockResult.set(null);
    this.wasLastDryRun.set(false);
    this.lastFile.set(null);
    this.step.set('upload');
  }

  switchMode(toStock: boolean): void {
    this.stockMode.set(toStock);
    this.step.set('upload');
    this.csvFile.set(null);
    this.uploadError.set('');
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
    this.lastFile.set(file);
    this.wasLastDryRun.set(this.dryRun());
    this.step.set('importing');
    this.log.set([]); this.current.set(0); this.total.set(0);
    this.currentName.set(''); this.currentVariantCount.set(0);

    const form = new FormData();
    form.append('csv', file, file.name);

    const url = this.dryRun()
      ? this.api.url('/admin/bulk-import?dryRun=true')
      : this.api.url('/admin/bulk-import');

    try {
      const resp = await fetch(url, {
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
      this.zone.run(() => { this.uploadError.set(err.message || this.t('bulkImport.error.networkError')); this.step.set('upload'); });
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
        if (!this.wasLastDryRun()) {
          this.saveHistory(evt.summary);
        }
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
      case 'created': return this.t('bulkImport.status.created');
      case 'updated': return this.t('bulkImport.status.updated');
      case 'skipped': return this.t('bulkImport.status.skipped');
      case 'error':   return this.t('bulkImport.status.error');
      default: return s;
    }
  }

  fmtBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
    return `${(b/1048576).toFixed(1)} MB`;
  }

  downloadStockTemplate(): void {
    const csv = '﻿SKU,Stock\n"EXAMPLE-SKU-001",50\n"EXAMPLE-SKU-002",25\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'stock-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async repairColors(): Promise<void> {
    if (this.repairingColors()) return;
    this.repairingColors.set(true);
    try {
      const resp = await fetch(this.api.url('/admin/bulk-import/repair-colors'), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        this.zone.run(() => this.toast.error('Color repair failed', json.message || 'Server error'));
        return;
      }
      const { repaired, skipped } = json.data ?? json;
      this.zone.run(() => {
        this.uploadError.set('');
        if (repaired > 0) {
          this.toast.success(
            `${repaired} variants color-repaired`,
            skipped > 0 ? `${skipped} SKUs had no recognisable color pattern` : undefined,
          );
        } else {
          this.toast.info('No variants to repair', 'All variants already have a color set.');
        }
      });
    } catch (err: any) {
      this.zone.run(() => this.toast.error('Color repair failed', err.message || 'Network error'));
    } finally {
      this.repairingColors.set(false);
    }
  }

  async startStockImport(): Promise<void> {
    const file = this.csvFile();
    if (!file) return;
    this.step.set('importing');
    this.uploadError.set('');

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) {
        this.zone.run(() => { this.uploadError.set(this.t('bulkImport.error.csvEmpty')); this.step.set('upload'); });
        return;
      }
      const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
      const skuIdx = header.indexOf('sku');
      const stockIdx = header.indexOf('stock');
      if (skuIdx < 0 || stockIdx < 0) {
        this.zone.run(() => { this.uploadError.set(this.t('bulkImport.error.missingColumns')); this.step.set('upload'); });
        return;
      }
      const updates = lines.slice(1).map(line => {
        const cols = line.split(',');
        return {
          sku: (cols[skuIdx] ?? '').replace(/"/g, '').trim(),
          stock: Math.max(0, parseInt((cols[stockIdx] ?? '0').replace(/"/g, '').trim(), 10) || 0),
        };
      }).filter(u => u.sku);

      this.zone.run(() => { this.total.set(updates.length); this.current.set(updates.length); });

      const resp = await fetch(this.api.url('/admin/products/bulk-stock'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ updates }),
      });

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        this.zone.run(() => { this.uploadError.set(json.message || this.t('bulkImport.error.stockFailed')); this.step.set('upload'); });
        return;
      }

      const data = json.data ?? json;
      this.zone.run(() => {
        this.stockResult.set({ updated: data.updated ?? 0, notFound: data.notFound ?? [] });
        this.step.set('stock-results');
      });
    } catch (err: any) {
      this.zone.run(() => { this.uploadError.set(err.message || this.t('bulkImport.error.networkError')); this.step.set('upload'); });
    }
  }

  retryFailed(): void {
    const failedRows = this.log().filter(e => e.status === 'error' || e.status === 'skipped');
    if (!failedRows.length) return;
    const header = 'English Name,SKU,Status\n';
    const rows = failedRows.map(e => `"${e.name.replace(/"/g, '""')}","",""`).join('\n');
    const blob = new Blob(['﻿' + header + rows], { type: 'text/csv;charset=utf-8;' });
    const fakeFile = new File([blob], `retry-${Date.now()}.csv`, { type: 'text/csv' });
    this.csvFile.set(fakeFile);
    this.step.set('upload');
    this.log.set([]); this.summary.set(null);
    this.current.set(0); this.total.set(0);
  }

  commitDryRun(): void {
    this.dryRun.set(false);
    this.wasLastDryRun.set(false);
    void this.startImport();
  }

  private saveHistory(summary: Summary): void {
    const file = this.lastFile();
    const rec: HistoryRecord = {
      id: Date.now().toString(36),
      ts: new Date().toISOString(),
      filename: file?.name ?? 'import.csv',
      summary,
      log: this.log(),
    };
    const hist = [rec, ...this.importHistory()].slice(0, 20);
    this.importHistory.set(hist);
    this.storage.set('import-history', JSON.stringify(hist));
  }

  private loadHistory(): HistoryRecord[] {
    try {
      const raw = this.storage.get('import-history');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  toggleHistory(id: string): void {
    this.importHistory.update(hist =>
      hist.map(h => h.id === id ? { ...h, expanded: !h.expanded } : h),
    );
  }

  clearHistory(): void {
    this.importHistory.set([]);
    this.storage.remove('import-history');
  }

  downloadHistoryReport(h: HistoryRecord): void {
    const ts = h.ts.slice(0, 16).replace('T', '_').replace(':', '-');
    const lines: string[] = [
      `# Import Report — ${h.filename} — ${h.ts}`,
      `# Total: ${h.summary.total} | Created: ${h.summary.created} | Updated: ${h.summary.updated} | Failed: ${h.summary.failed}`,
      '',
      'Product Name,Status,Error Details',
      ...h.log.map(e => `"${(e.name||'').replace(/"/g,'""')}","${e.status}","${(e.error||'').replace(/"/g,'""')}"`),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `import-${ts}.csv`; a.click();
    URL.revokeObjectURL(url);
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
