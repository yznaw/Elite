import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { ToastService } from '../../services/toast.service';
import { ConfirmService } from '../../services/confirm.service';
import { PALETTE, PRODUCTS, STOREFRONT_DEFAULT } from '../../data/mock';
import { StorefrontBlock } from '../../models';

@Component({
  selector: 'ap-storefront',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="page-fade">
      <div style="display:grid;grid-template-columns:320px 1fr;gap:20px;align-items:flex-start;">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Available Blocks</div>
              <div class="card-sub">Drag to add to storefront</div>
            </div>
          </div>
          <div class="card-pad col">
            @for (p of palette; track p.type) {
              <div class="palette-blk" draggable="true" (dragstart)="onPaletteDragStart($event, p.type)">
                <span style="color:var(--gold);"><ap-icon name="drag" [size]="14"/></span>
                <div class="grow">
                  <div class="strong" style="font-size:12px;">{{ p.type }}</div>
                  <div class="muted small">{{ p.desc }}</div>
                </div>
              </div>
            }
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Live Page Order</div>
              <div class="card-sub">{{ visibleCount() }} visible · {{ blocks().length }} total</div>
            </div>
            <button class="btn btn-gold" (click)="preview()"><ap-icon name="eye" [size]="14"/> Preview Storefront</button>
          </div>
          <div class="card-pad col">
            @for (b of blocks(); track b.id) {
              <div class="blk"
                   draggable="true"
                   [class.dragging]="draggingId() === b.id"
                   [class.drop-target]="dropTargetId() === b.id"
                   (dragstart)="onDragStart(b.id)"
                   (dragover)="onDragOver($event, b.id)"
                   (drop)="onDrop($event, b.id)"
                   (dragend)="onDragEnd()">
                <span class="blk-handle"><ap-icon name="drag" [size]="14"/></span>
                <div class="blk-info">
                  <div class="blk-title">{{ b.type }}
                    <span class="muted small" style="margin-left:6px;font-weight:400;">· {{ b.title }}</span>
                  </div>
                  <div class="blk-meta">{{ b.config }}</div>
                </div>
                <div class="blk-controls">
                  <button class="toggle" [class.on]="b.visible" (click)="toggleVisible(b.id)" aria-label="Toggle visibility"></button>
                  <button class="icon-btn" (click)="setEditing(b.id)" title="Edit"><ap-icon name="edit" [size]="14"/></button>
                  <button class="icon-btn" (click)="remove(b.id)" title="Remove" style="color:var(--danger);">
                    <ap-icon name="trash" [size]="14"/>
                  </button>
                </div>
              </div>

              @if (editingId() === b.id) {
                <div style="padding:14px 18px;border:1px solid var(--gold-4);border-radius:10px;background:var(--gold-3);margin-left:24px;">
                  <label class="lbl">Section Title</label>
                  <input class="inp mb-16" [ngModel]="b.title" (ngModelChange)="updateBlock(b.id, { title: $event })"/>
                  <label class="lbl">Configuration</label>
                  <input class="inp mb-16" [ngModel]="b.config" (ngModelChange)="updateBlock(b.id, { config: $event })"/>
                  @if (b.type === 'Featured Products') {
                    <label class="lbl">Products in this section</label>
                    <select class="inp" multiple style="height:90px;">
                      @for (p of featuredProducts; track p.id) {
                        <option>{{ p.name }}</option>
                      }
                    </select>
                  }
                  <div class="row gap-sm mt-16">
                    <button class="btn btn-primary btn-sm" (click)="setEditing(null)">Done</button>
                    <button class="btn btn-ghost btn-sm" (click)="setEditing(null)">Cancel</button>
                  </div>
                </div>
              }
            }

            <div class="palette-blk"
                 [style.border-color]="dropTargetId() === '__end__' ? 'var(--gold)' : null"
                 [style.background]="dropTargetId() === '__end__' ? 'var(--gold-3)' : null"
                 (dragover)="onDragOver($event, '__end__')"
                 (drop)="onDrop($event, '__end__')">
              <span class="muted"><ap-icon name="plus" [size]="14"/></span>
              <span class="muted small">Drop a block here to add it at the bottom</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class StorefrontComponent {
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly palette = PALETTE;
  readonly featuredProducts = PRODUCTS.slice(0, 6);

  readonly blocks = signal<StorefrontBlock[]>(STOREFRONT_DEFAULT.map((b) => ({ ...b })));
  readonly draggingId = signal<string | null>(null);
  readonly dropTargetId = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);

  visibleCount = (): number => this.blocks().filter((b) => b.visible).length;

  setEditing(id: string | null): void {
    this.editingId.update((cur) => (cur === id ? null : id));
  }

  toggleVisible(id: string): void {
    let nextVisible = false;
    this.blocks.update((bs) =>
      bs.map((b) => {
        if (b.id !== id) return b;
        nextVisible = !b.visible;
        return { ...b, visible: nextVisible };
      }),
    );
    const block = this.blocks().find((b) => b.id === id);
    if (block) {
      this.toast.info(
        nextVisible ? 'Section shown' : 'Section hidden',
        `${block.type} · ${block.title}`,
      );
    }
  }

  async remove(id: string): Promise<void> {
    const block = this.blocks().find((b) => b.id === id);
    if (!block) return;
    const ok = await this.confirm.ask({
      title: 'Remove section?',
      message: `"${block.type} · ${block.title}" will be removed from the storefront. Shoppers will no longer see it on the next deploy.`,
      confirmLabel: 'Remove section',
      cancelLabel: 'Keep',
      variant: 'danger',
    });
    if (!ok) return;
    this.blocks.update((bs) => bs.filter((b) => b.id !== id));
    this.toast.success('Section removed', block.type, {
      label: 'Undo',
      run: () => this.blocks.update((bs) => [...bs, block]),
    });
  }

  updateBlock(id: string, patch: Partial<StorefrontBlock>): void {
    this.blocks.update((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  preview(): void {
    this.toast.info('Preview opens in a new tab', `${this.visibleCount()} visible sections will render.`);
  }

  onDragStart(id: string): void { this.draggingId.set(id); }

  onDragOver(e: DragEvent, id: string): void {
    e.preventDefault();
    this.dropTargetId.set(id);
  }

  onPaletteDragStart(e: DragEvent, type: string): void {
    e.dataTransfer?.setData('text/palette', type);
  }

  onDrop(e: DragEvent, id: string): void {
    e.preventDefault();
    const draggingId = this.draggingId();
    if (!draggingId) {
      const type = e.dataTransfer?.getData('text/palette');
      if (type) {
        const newBlk: StorefrontBlock = {
          id: 'b' + Date.now(),
          type,
          title: type,
          visible: true,
          config: 'New section · configure',
        };
        this.blocks.update((bs) => {
          const idx = bs.findIndex((b) => b.id === id);
          const next = [...bs];
          next.splice(idx === -1 ? bs.length : idx, 0, newBlk);
          return next;
        });
        this.toast.success('Section added', `${type} · click to configure`, {
          label: 'Configure',
          run: () => this.editingId.set(newBlk.id),
        });
      }
    } else if (draggingId !== id) {
      this.blocks.update((bs) => {
        const fromIdx = bs.findIndex((b) => b.id === draggingId);
        const toIdx = bs.findIndex((b) => b.id === id);
        if (fromIdx === -1 || toIdx === -1) return bs;
        const next = [...bs];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
    }
    this.draggingId.set(null);
    this.dropTargetId.set(null);
  }

  onDragEnd(): void {
    this.draggingId.set(null);
    this.dropTargetId.set(null);
  }
}
