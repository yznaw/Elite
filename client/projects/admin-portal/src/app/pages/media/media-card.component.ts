import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../shared/icons/icon.component';
import { fmtBytes, MediaFile, Product } from '../../models';

interface Suggestion {
  product: Product;
  conf: 'high' | 'medium' | 'low';
  why: string;
}

@Component({
  selector: 'ap-media-card',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="media-card" [class.selected]="selected" (click)="clicked.emit()">
      <div class="media-thumb">
        @if (media.kind === 'image') {
          <img [src]="media.preview" [alt]="media.name" (error)="onImgError($event)"/>
        } @else {
          <div class="glb-thumb">
            <ap-icon name="cube" [size]="42"/>
            <div class="glb-thumb-label">3D Model</div>
          </div>
        }
        <span class="type-badge">{{ media.kind === 'glb' ? '.GLB' : extension(media.name) }}</span>
        @if (linkedProduct) {
          <span class="link-pill linked"><ap-icon name="check" [size]="9"/> Linked</span>
        } @else if (suggestion) {
          <span class="link-pill suggest" [attr.title]="suggestion.why">~ Match</span>
        } @else {
          <span class="link-pill unlinked">⚠ Unlinked</span>
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
})
export class MediaCardComponent {
  @Input({ required: true }) media!: MediaFile;
  @Input() products: Product[] = [];
  @Input() selected = false;
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
