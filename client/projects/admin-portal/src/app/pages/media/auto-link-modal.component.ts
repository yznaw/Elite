import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../shared/icons/icon.component';
import { suggestProduct, Suggestion } from '../../data/mock';
import { MediaFile } from '../../models';

interface Candidate { media: MediaFile; suggestion: Suggestion; }
export interface LinkPair { mediaId: string; productId: string; }

@Component({
  selector: 'ap-auto-link-modal',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="overlay" (click)="closed.emit()"></div>
    <div class="modal" style="width:min(820px,92vw);">
      <div class="modal-head">
        <div class="row gap-sm">
          <div class="kpi-icon" style="background:var(--gold-3);color:var(--gold);width:36px;height:36px;border-radius:10px;">
            <ap-icon name="wand" [size]="14"/>
          </div>
          <div>
            <div class="card-title">Auto-Link by SKU</div>
            <div class="card-sub">
              {{ scanning() ? 'Scanning unlinked files…' : (candidates().length + ' matches found across ' + unlinkedCount + ' unlinked files') }}
            </div>
          </div>
        </div>
        <button class="x-btn" (click)="closed.emit()"><ap-icon name="x" [size]="14"/></button>
      </div>
      <div class="modal-body" style="padding:0;">
        @if (scanning()) {
          <div class="center" style="padding:60px 20px;">
            <div class="spin-i" style="display:inline-block;color:var(--gold);width:32px;height:32px;margin-bottom:12px;">
              <ap-icon name="spinner" [size]="32"/>
            </div>
            <div class="strong" style="font-family:var(--ff-disp);font-size:18px;color:var(--green);">Scanning filenames for SKU patterns…</div>
            <div class="muted small mt-8">Looking for product SKU prefixes in {{ unlinkedCount }} files</div>
          </div>
        } @else if (candidates().length === 0) {
          <div class="center" style="padding:60px 20px;">
            <div class="strong" style="font-family:var(--ff-disp);font-size:20px;color:var(--muted);">No matches found</div>
            <div class="muted small mt-8">None of the unlinked files match a product SKU. Link them manually instead.</div>
          </div>
        } @else {
          <div class="row gap-sm" style="padding:14px 26px;border-bottom:1px solid var(--border-2);background:var(--bg);">
            <span class="muted small">Confidence:</span>
            <span class="alink-conf high">{{ confCounts().high }} high</span>
            <span class="alink-conf med">{{ confCounts().medium }} medium</span>
            <span class="alink-conf low">{{ confCounts().low }} low</span>
            <span class="grow"></span>
            <span class="muted small">{{ toApply().length }} of {{ candidates().length }} selected</span>
          </div>
          <div style="max-height:50vh;overflow-y:auto;">
            @for (c of candidates(); track c.media.id) {
              <div class="alink-row" [class.skipped]="skipped().has(c.media.id)">
                <div class="alink-thumb">
                  @if (c.media.kind === 'image') {
                    <img [src]="c.media.preview" alt="" (error)="onImgError($event)"/>
                  } @else {
                    <div class="glb-thumb" style="height:100%;"><span style="color:var(--gold);font-size:9px;letter-spacing:0.1em;">GLB</span></div>
                  }
                </div>
                <div style="min-width:0;">
                  <div class="strong mono" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ c.media.name }}</div>
                  <div class="muted small">{{ c.suggestion.why }}</div>
                </div>
                <span class="alink-arrow">→</span>
                <div style="min-width:0;">
                  <div class="strong" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ c.suggestion.product.name }}</div>
                  <div class="muted small mono">{{ c.suggestion.product.sku }}</div>
                </div>
                <div class="row gap-sm">
                  <span class="alink-conf" [class.high]="c.suggestion.conf === 'high'" [class.med]="c.suggestion.conf === 'medium'" [class.low]="c.suggestion.conf === 'low'">{{ c.suggestion.conf }}</span>
                  <button class="btn btn-ghost btn-sm" (click)="toggleSkip(c.media.id)">
                    {{ skipped().has(c.media.id) ? 'Include' : 'Skip' }}
                  </button>
                </div>
              </div>
            }
          </div>
        }
      </div>
      <div class="drawer-foot">
        <button class="btn btn-ghost" (click)="closed.emit()">Cancel</button>
        <button class="btn btn-gold" [disabled]="scanning() || toApply().length === 0" (click)="applyAll()">
          <ap-icon name="link" [size]="12"/>
          Link {{ toApply().length }} {{ toApply().length === 1 ? 'File' : 'Files' }}
        </button>
      </div>
    </div>
  `,
})
export class AutoLinkModalComponent implements OnInit, OnDestroy {
  @Input({ required: true }) media: MediaFile[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() apply = new EventEmitter<LinkPair[]>();

  readonly scanning = signal(true);
  readonly skipped = signal<Set<string>>(new Set());

  private timer: number | undefined;

  ngOnInit(): void {
    this.timer = window.setTimeout(() => this.scanning.set(false), 1100);
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  get unlinkedCount(): number { return this.media.filter((m) => !m.linkedTo).length; }

  readonly candidates = computed<Candidate[]>(() => {
    return this.media
      .filter((m) => !m.linkedTo)
      .map((m) => ({ media: m, suggestion: suggestProduct(m) }))
      .filter((c): c is Candidate => c.suggestion !== null);
  });

  readonly toApply = computed(() => this.candidates().filter((c) => !this.skipped().has(c.media.id)));

  readonly confCounts = computed(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    this.candidates().forEach((c) => {
      counts[c.suggestion.conf]++;
    });
    return counts;
  });

  toggleSkip(id: string): void {
    this.skipped.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  applyAll(): void {
    const pairs = this.toApply().map((c) => ({ mediaId: c.media.id, productId: c.suggestion.product.id }));
    this.apply.emit(pairs);
  }

  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }
}
