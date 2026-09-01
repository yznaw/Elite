import { Component, EventEmitter, Input, Output, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../shared/icons/icon.component';
import { I18nService } from '../../services/i18n.service';
import { fmtBytes, MediaFile, Product } from '../../models';

interface Suggestion {
  product: Product;
  conf: 'high' | 'medium' | 'low';
  why: string;
}

@Component({
    selector: 'ap-media-card',
    imports: [CommonModule, IconComponent],
    changeDetection: ChangeDetectionStrategy.Eager,
    template: `
    <div class="media-card" [class.selected]="selected" (click)="clicked.emit()">
      @if (selectionMode) {
        <div class="sel-check" [class.checked]="selected">
          @if (selected) { <ap-icon name="check" [size]="12"/> }
        </div>
      }
      <div class="media-thumb">
        <img [src]="media.preview" [alt]="media.name" (error)="onImgError($event)"/>
        <span class="type-badge">{{ extension(media.name) }}</span>
        @if (linkedProduct) {
          <span class="link-pill linked"><ap-icon name="check" [size]="9"/> {{ t('media.thumb.linked') }}</span>
        } @else if (media.usedInContent) {
          <span class="link-pill content" title="Referenced by the homepage hero or story content">
            <ap-icon name="check" [size]="9"/> {{ t('media.thumb.usedInContent') }}
          </span>
        } @else if (suggestion) {
          <span class="link-pill suggest" [attr.title]="suggestion.why">{{ t('media.thumb.match') }}</span>
        } @else {
          <span class="link-pill unlinked">⚠ {{ t('media.thumb.unlinked') }}</span>
        }
      </div>
      <div class="media-info">
        <div class="media-name" [attr.title]="media.name">{{ media.name }}</div>
        <div class="media-meta">{{ size }}{{ media.w ? ' · ' + media.w + '×' + media.h : '' }}</div>
        @if (linkedProduct) {
          <div class="media-meta" style="margin-top:4px;color:var(--gold);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" [attr.title]="linkedProduct.name">
            → {{ linkedProduct.name }}
          </div>
        } @else if (suggestion) {
          <div class="media-meta" style="margin-top:4px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ~ {{ suggestion.product.name }}
          </div>
        }
      </div>
    </div>
  `,
    styles: [`
    .sel-check {
      position: absolute; top: 8px; left: 8px; z-index: 2;
      width: 22px; height: 22px; border-radius: 6px;
      background: rgba(255,255,255,0.92); border: 2px solid #d4d4d8;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 1px 3px rgba(0,0,0,.12);
    }
    .sel-check.checked { background: var(--gold, #c9a84c); border-color: var(--gold, #c9a84c); color: #fff; }
  `]
})
export class MediaCardComponent {
  private readonly i18n = inject(I18nService);
  readonly t = (k: string): string => this.i18n.t(k);

  @Input({ required: true }) media!: MediaFile;
  @Input() products: Product[] = [];
  @Input() selected = false;
  @Input() selectionMode = false;
  @Output() clicked = new EventEmitter<void>();

  get linkedProduct() { return this.products.find((p) => p.id === this.media.linkedTo); }
  get suggestion(): Suggestion | null {
    return this.linkedProduct ? null : this.suggestProduct(this.media);
  }
  get size(): string { return fmtBytes(this.media.size); }

  extension(name: string): string {
    const parts = name.split('.');
    return (parts[parts.length - 1] || '').toUpperCase();
  }

  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }

  private suggestProduct(media: MediaFile): Suggestion | null {
    const name = media.name.toUpperCase();
    const exact = this.products.find((product) => product.sku && name.includes(product.sku.toUpperCase()));
    if (exact) return { product: exact, conf: 'high', why: `Filename contains SKU ${exact.sku}` };

    const prefix = this.products.find((product) => {
      const skuPrefix = product.sku?.split('-').slice(0, 2).join('-').toUpperCase();
      return skuPrefix && name.includes(skuPrefix);
    });
    if (prefix) return { product: prefix, conf: 'medium', why: 'Filename contains SKU prefix' };

    return null;
  }
}
