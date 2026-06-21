import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../shared/icons/icon.component';
import { I18nService } from '../../services/i18n.service';
import { MediaFile, Product } from '../../models';

interface Suggestion {
  product: Product;
  conf: 'high' | 'medium' | 'low';
  why: string;
}

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
            <div class="card-title">{{ t('media.autoLink.title') }}</div>
            <div class="card-sub">
              {{ scanning() ? t('media.autoLink.scanning') : (candidates().length + ' ' + t('media.autoLink.matchesFound') + ' ' + unlinkedCount + ' ' + t('media.autoLink.unlinkedFiles')) }}
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
            <div class="strong" style="font-family:var(--ff-disp);font-size:18px;color:var(--green);">{{ t('media.autoLink.scanningHeadline') }}</div>
            <div class="muted small mt-8">{{ t('media.autoLink.scanningSub').replace('{n}', unlinkedCount.toString()) }}</div>
          </div>
        } @else if (candidates().length === 0) {
          <div class="center" style="padding:60px 20px;">
            <div class="strong" style="font-family:var(--ff-disp);font-size:20px;color:var(--muted);">{{ t('media.autoLink.noMatches') }}</div>
            <div class="muted small mt-8">{{ t('media.autoLink.noMatchesSub') }}</div>
          </div>
        } @else {
          <div class="row gap-sm" style="padding:14px 26px;border-bottom:1px solid var(--border-2);background:var(--bg);">
            <span class="muted small">{{ t('media.autoLink.confidence') }}</span>
            <span class="alink-conf high">{{ confCounts().high }} {{ t('media.autoLink.high') }}</span>
            <span class="alink-conf med">{{ confCounts().medium }} {{ t('media.autoLink.medium') }}</span>
            <span class="alink-conf low">{{ confCounts().low }} {{ t('media.autoLink.low') }}</span>
            <span class="grow"></span>
            <span class="muted small">{{ toApply().length }} {{ t('common.of') }} {{ candidates().length }} {{ t('media.autoLink.selectedSuffix') }}</span>
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
                    {{ skipped().has(c.media.id) ? t('media.autoLink.include') : t('media.autoLink.skip') }}
                  </button>
                </div>
              </div>
            }
          </div>
        }
      </div>
      <div class="drawer-foot">
        <button class="btn btn-ghost" (click)="closed.emit()">{{ t('common.cancel') }}</button>
        <button class="btn btn-gold" [disabled]="scanning() || toApply().length === 0" (click)="applyAll()">
          <ap-icon name="link" [size]="12"/>
          {{ t('media.autoLink.linkN') }} {{ toApply().length }} {{ toApply().length === 1 ? t('media.autoLink.fileSingular') : t('media.autoLink.filePlural') }}
        </button>
      </div>
    </div>
  `,
})
export class AutoLinkModalComponent implements OnInit, OnDestroy {
  private readonly i18n = inject(I18nService);
  readonly t = (k: string): string => this.i18n.t(k);

  @Input({ required: true }) media: MediaFile[] = [];
  @Input() products: Product[] = [];
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
      .map((m) => ({ media: m, suggestion: this.suggestProduct(m) }))
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

  private suggestProduct(media: MediaFile): Suggestion | null {
    const name = media.name.toUpperCase();
    const exact = this.products.find((product) => product.sku && name.includes(product.sku.toUpperCase()));
    if (exact) return { product: exact, conf: 'high', why: `${this.t('media.autoLink.skuReason')} ${exact.sku}` };

    const prefix = this.products.find((product) => {
      const skuPrefix = product.sku?.split('-').slice(0, 2).join('-').toUpperCase();
      return skuPrefix && name.includes(skuPrefix);
    });
    if (prefix) return { product: prefix, conf: 'medium', why: this.t('media.autoLink.skuPrefixReason') };

    return null;
  }
}
