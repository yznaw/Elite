import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { ConfirmService } from '../../services/confirm.service';
import { I18nService } from '../../services/i18n.service';
import { fmtBytes, MediaFile, Product } from '../../models';

interface Suggestion {
  product: Product;
  conf: 'high' | 'medium' | 'low';
  why: string;
}

@Component({
  selector: 'ap-media-detail-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, PillComponent],
  template: `
    <div class="overlay" (click)="closed.emit()"></div>
    <div class="drawer">
      <div class="drawer-head">
        <div>
          <div class="card-title mono" style="font-size:15px;">{{ media.name }}</div>
          <div class="card-sub">{{ media.kind === 'glb' ? t('media.detail.headerType3d') : t('media.detail.headerTypeImage') }} · {{ size }}{{ media.w ? ' · ' + media.w + '×' + media.h : '' }}</div>
        </div>
        <button class="x-btn" (click)="closed.emit()"><ap-icon name="x" [size]="14"/></button>
      </div>

      <div class="drawer-body">
        <div style="aspect-ratio:1.4/1;background:var(--bg-2);border-radius:10px;overflow:hidden;margin-bottom:20px;">
          @if (media.kind === 'image') {
            <img [src]="media.preview" [alt]="media.name" style="width:100%;height:100%;object-fit:cover;" (error)="onImgError($event)"/>
          } @else {
            <div class="glb-thumb" style="aspect-ratio:1.4/1;">
              <ap-icon name="cube" [size]="64"/>
              <div class="glb-thumb-label">.GLB · {{ size }}</div>
            </div>
          }
        </div>

        <div class="mb-24">
          <label class="lbl">{{ t('media.detail.linkedProduct') }}</label>
          @if (linkedProduct) {
            <div class="ms-block" style="margin-bottom:10px;">
              <div class="row gap-sm">
                <div class="prod-img" style="width:48px;height:48px;border-radius:8px;flex-shrink:0;">
                  <img [src]="linkedProduct.image" alt="" style="width:100%;height:100%;object-fit:cover;"/>
                </div>
                <div class="grow" style="min-width:0;">
                  <div class="strong" style="font-size:13px;color:var(--green);">{{ linkedProduct.name }}</div>
                  <div class="muted small mono">{{ linkedProduct.sku }}</div>
                </div>
                <ap-pill kind="green"><ap-icon name="check" [size]="10"/> {{ t('media.thumb.linked') }}</ap-pill>
              </div>
            </div>
          } @else if (suggestion) {
            <div class="ms-block" style="border-left-color:var(--warning);margin-bottom:10px;background:rgba(245,158,11,0.04);">
              <div class="row gap-sm" style="margin-bottom:10px;">
                <div class="prod-img" style="width:40px;height:40px;border-radius:8px;flex-shrink:0;">
                  <img [src]="suggestion.product.image" alt="" style="width:100%;height:100%;object-fit:cover;"/>
                </div>
                <div class="grow" style="min-width:0;">
                  <div class="strong" style="font-size:13px;">{{ t('media.detail.suggestedMatch') }} {{ suggestion.product.name }}</div>
                  <div class="muted small">{{ suggestion.why }}</div>
                </div>
                <span class="alink-conf" [class.high]="suggestion.conf === 'high'" [class.med]="suggestion.conf === 'medium'" [class.low]="suggestion.conf === 'low'">{{ suggestion.conf }}</span>
              </div>
              <button class="btn btn-gold btn-sm" (click)="acceptSuggestion()">
                <ap-icon name="link" [size]="12"/> {{ t('media.detail.acceptMatch') }}
              </button>
            </div>
          } @else {
            <div class="muted small mb-16" style="padding:10px 12px;background:var(--bg);border-radius:8px;">
              {{ t('media.detail.noMatch') }}
            </div>
          }

          <select class="inp" [ngModel]="linkSel()" (ngModelChange)="linkSel.set($event)">
            <option value="">{{ t('media.detail.notLinked') }}</option>
            @for (p of products; track p.id) {
              <option [value]="p.id">{{ p.name }} · {{ p.sku }}</option>
            }
          </select>
          <div class="row gap-sm mt-8">
            <button class="btn btn-primary btn-sm" [disabled]="!dirty()" (click)="applyLink()">
              @if (linkSel()) { <ap-icon name="link" [size]="12"/> {{ t('media.detail.linkToProduct') }} }
              @else { <ap-icon name="unlink" [size]="12"/> {{ t('media.detail.unlink') }} }
            </button>
          </div>
        </div>

        <div class="mb-24">
          <label class="lbl">{{ t('media.detail.metadata') }}</label>
          <div class="panel">
            <div class="ms-row" style="padding:10px 14px;">
              <span class="muted small">{{ t('media.detail.fileId') }}</span>
              <span class="strong mono">{{ media.id }}</span>
            </div>
            <div class="ms-row" style="padding:10px 14px;">
              <span class="muted small">{{ t('media.detail.type') }}</span>
              <span class="strong">{{ media.kind === 'glb' ? t('media.detail.type3d') : t('media.detail.typeImage') }}</span>
            </div>
            <div class="ms-row" style="padding:10px 14px;">
              <span class="muted small">{{ t('media.detail.size') }}</span>
              <span class="strong">{{ size }}</span>
            </div>
            @if (media.w) {
              <div class="ms-row" style="padding:10px 14px;">
                <span class="muted small">{{ t('media.detail.dimensions') }}</span>
                <span class="strong">{{ media.w }} × {{ media.h }} px</span>
              </div>
            }
            <div class="ms-row" style="padding:10px 14px;">
              <span class="muted small">{{ t('media.detail.uploaded') }}</span>
              <span class="row gap-sm">
                <span class="strong mono" style="font-size:11px;">{{ media.uploaded }}</span>
                <span class="trigger" style="padding:2px 10px 2px 3px;font-size:10px;">
                  <span class="avatar" style="width:18px;height:18px;font-size:8px;">{{ media.initials }}</span>
                  {{ firstName(media.uploader) }}
                </span>
              </span>
            </div>
            <div class="ms-row" style="padding:10px 14px;">
              <span class="muted small">{{ t('media.detail.skuDetected') }}</span>
              <span class="strong mono" [style.color]="detectedSku ? 'var(--gold)' : 'var(--muted)'">
                {{ detectedSku || t('media.detail.skuNone') }}
              </span>
            </div>
          </div>
        </div>
      </div>

      @if (media.kind === 'image') {
        <div class="default-image-section">
          @if (isDefault()) {
            <div class="default-badge">
              <ap-icon name="check" [size]="12"/> {{ t('media.detail.defaultBadge') }}
            </div>
          } @else {
            <button class="btn btn-outline btn-sm" (click)="setDefault.emit(media)" [disabled]="settingDefault">
              <ap-icon name="media" [size]="12"/> {{ t('media.detail.setDefault') }}
            </button>
            <div class="muted small" style="margin-top:6px;">{{ t('media.detail.defaultHint') }}</div>
          }
        </div>
      }

      <div class="drawer-foot">
        <button class="btn btn-danger" (click)="onDelete()"><ap-icon name="trash" [size]="12"/> {{ t('common.delete') }}</button>
        <button class="btn btn-outline" (click)="closed.emit()">{{ t('common.close') }}</button>
      </div>
    </div>
  `,
  styles: [`
    .default-image-section {
      padding: 14px 20px;
      border-top: 1px solid var(--border-2);
    }
    .default-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 999px;
      background: rgba(2,70,56,.1);
      color: var(--green);
      font-size: 12px;
      font-weight: 700;
    }
  `],
})
export class MediaDetailDrawerComponent {
  @Input({ required: true }) set media(m: MediaFile) {
    this._media = m;
    this.linkSel.set(m.linkedTo || '');
  }
  get media(): MediaFile { return this._media; }
  private _media!: MediaFile;
  @Input() products: Product[] = [];
  @Input() defaultImageUrl: string | null = null;
  @Input() settingDefault = false;

  @Output() closed = new EventEmitter<void>();
  @Output() update = new EventEmitter<MediaFile>();
  @Output() delete = new EventEmitter<string>();
  @Output() setDefault = new EventEmitter<MediaFile>();

  get isDefault(): () => boolean {
    return () => !!this.defaultImageUrl && !!this._media.preview && this.defaultImageUrl === this._media.preview;
  }

  private readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  readonly t = (k: string): string => this.i18n.t(k);

  readonly linkSel = signal<string>('');

  get linkedProduct() { return this.products.find((p) => p.id === this._media.linkedTo); }
  get suggestion(): Suggestion | null { return this.linkedProduct ? null : this.suggestProduct(this._media); }
  get size(): string { return fmtBytes(this._media.size); }
  get detectedSku(): string | null { return this.extractSkuFromName(this._media.name); }
  get dirty(): () => boolean { return () => this.linkSel() !== (this._media.linkedTo || ''); }

  acceptSuggestion(): void {
    const s = this.suggestion;
    if (!s) return;
    this.update.emit({ ...this._media, linkedTo: s.product.id });
  }

  applyLink(): void {
    const sel = this.linkSel();
    this.update.emit({ ...this._media, linkedTo: sel || null });
  }

  async onDelete(): Promise<void> {
    const ok = await this.confirm.ask({
      title: this.t('media.detail.delete.title'),
      message: `"${this._media.name}" ${this.t('media.detail.delete.message')}`,
      confirmLabel: this.t('media.detail.delete.confirm'),
      cancelLabel: this.t('media.detail.delete.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    this.delete.emit(this._media.id);
    this.closed.emit();
  }

  firstName(name: string): string { return name.split(' ')[0] || name; }
  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }

  private extractSkuFromName(name: string): string | null {
    const upper = name.toUpperCase();
    return this.products.find((product) => product.sku && upper.includes(product.sku.toUpperCase()))?.sku || null;
  }

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
