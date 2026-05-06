import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { ConfirmService } from '../../services/confirm.service';
import { extractSkuFromName, PRODUCTS, suggestProduct } from '../../data/mock';
import { fmtBytes, MediaFile } from '../../models';

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
          <div class="card-sub">{{ media.kind === 'glb' ? '3D Model' : 'Image' }} · {{ size }}{{ media.w ? ' · ' + media.w + '×' + media.h : '' }}</div>
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
          <label class="lbl">Linked Product</label>
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
                <ap-pill kind="green"><ap-icon name="check" [size]="10"/> Linked</ap-pill>
              </div>
            </div>
          } @else if (suggestion) {
            <div class="ms-block" style="border-left-color:var(--warning);margin-bottom:10px;background:rgba(245,158,11,0.04);">
              <div class="row gap-sm" style="margin-bottom:10px;">
                <div class="prod-img" style="width:40px;height:40px;border-radius:8px;flex-shrink:0;">
                  <img [src]="suggestion.product.image" alt="" style="width:100%;height:100%;object-fit:cover;"/>
                </div>
                <div class="grow" style="min-width:0;">
                  <div class="strong" style="font-size:13px;">Suggested match: {{ suggestion.product.name }}</div>
                  <div class="muted small">{{ suggestion.why }}</div>
                </div>
                <span class="alink-conf" [class.high]="suggestion.conf === 'high'" [class.med]="suggestion.conf === 'medium'" [class.low]="suggestion.conf === 'low'">{{ suggestion.conf }}</span>
              </div>
              <button class="btn btn-gold btn-sm" (click)="acceptSuggestion()">
                <ap-icon name="link" [size]="12"/> Accept Match
              </button>
            </div>
          } @else {
            <div class="muted small mb-16" style="padding:10px 12px;background:var(--bg);border-radius:8px;">
              No automatic match found. Choose a product below.
            </div>
          }

          <select class="inp" [ngModel]="linkSel()" (ngModelChange)="linkSel.set($event)">
            <option value="">— Not linked —</option>
            @for (p of products; track p.id) {
              <option [value]="p.id">{{ p.name }} · {{ p.sku }}</option>
            }
          </select>
          <div class="row gap-sm mt-8">
            <button class="btn btn-primary btn-sm" [disabled]="!dirty()" (click)="applyLink()">
              @if (linkSel()) { <ap-icon name="link" [size]="12"/> Link to product }
              @else { <ap-icon name="unlink" [size]="12"/> Unlink }
            </button>
          </div>
        </div>

        <div class="mb-24">
          <label class="lbl">Metadata</label>
          <div class="panel">
            <div class="ms-row" style="padding:10px 14px;">
              <span class="muted small">File ID</span>
              <span class="strong mono">{{ media.id }}</span>
            </div>
            <div class="ms-row" style="padding:10px 14px;">
              <span class="muted small">Type</span>
              <span class="strong">{{ media.kind === 'glb' ? '3D Model (.glb)' : 'Image' }}</span>
            </div>
            <div class="ms-row" style="padding:10px 14px;">
              <span class="muted small">Size</span>
              <span class="strong">{{ size }}</span>
            </div>
            @if (media.w) {
              <div class="ms-row" style="padding:10px 14px;">
                <span class="muted small">Dimensions</span>
                <span class="strong">{{ media.w }} × {{ media.h }} px</span>
              </div>
            }
            <div class="ms-row" style="padding:10px 14px;">
              <span class="muted small">Uploaded</span>
              <span class="row gap-sm">
                <span class="strong mono" style="font-size:11px;">{{ media.uploaded }}</span>
                <span class="trigger" style="padding:2px 10px 2px 3px;font-size:10px;">
                  <span class="avatar" style="width:18px;height:18px;font-size:8px;">{{ media.initials }}</span>
                  {{ firstName(media.uploader) }}
                </span>
              </span>
            </div>
            <div class="ms-row" style="padding:10px 14px;">
              <span class="muted small">SKU detected</span>
              <span class="strong mono" [style.color]="detectedSku ? 'var(--gold)' : 'var(--muted)'">
                {{ detectedSku || 'none' }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="drawer-foot">
        <button class="btn btn-danger" (click)="onDelete()"><ap-icon name="trash" [size]="12"/> Delete</button>
        <button class="btn btn-outline" (click)="closed.emit()">Close</button>
      </div>
    </div>
  `,
})
export class MediaDetailDrawerComponent {
  @Input({ required: true }) set media(m: MediaFile) {
    this._media = m;
    this.linkSel.set(m.linkedTo || '');
  }
  get media(): MediaFile { return this._media; }
  private _media!: MediaFile;

  @Output() closed = new EventEmitter<void>();
  @Output() update = new EventEmitter<MediaFile>();
  @Output() delete = new EventEmitter<string>();

  private readonly confirm = inject(ConfirmService);

  readonly products = PRODUCTS;
  readonly linkSel = signal<string>('');

  get linkedProduct() { return PRODUCTS.find((p) => p.id === this._media.linkedTo); }
  get suggestion() { return this.linkedProduct ? null : suggestProduct(this._media); }
  get size(): string { return fmtBytes(this._media.size); }
  get detectedSku(): string | null { return extractSkuFromName(this._media.name); }
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
      title: 'Delete this file?',
      message: `"${this._media.name}" will be removed from the library. This cannot be undone — any product currently using this file will lose its link.`,
      confirmLabel: 'Delete file',
      cancelLabel: 'Keep',
      variant: 'danger',
    });
    if (!ok) return;
    this.delete.emit(this._media.id);
    this.closed.emit();
  }

  firstName(name: string): string { return name.split(' ')[0] || name; }
  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }
}
