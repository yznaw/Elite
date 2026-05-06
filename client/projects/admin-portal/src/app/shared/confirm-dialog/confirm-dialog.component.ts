import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmService } from '../../services/confirm.service';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'ap-confirm-dialog',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    @if (svc.request(); as r) {
      <div class="overlay" (click)="cancel()"></div>
      <div class="modal" style="width:min(440px,92vw);" role="dialog" aria-modal="true" [attr.aria-labelledby]="'confirm-title'">
        <div class="modal-head">
          <div class="row gap-sm" style="align-items:flex-start;">
            <div class="confirm-icon" [class.danger]="r.options.variant === 'danger'" [class.warning]="r.options.variant === 'warning'" [class.info]="!r.options.variant || r.options.variant === 'info'">
              @switch (r.options.variant) {
                @case ('danger') { <ap-icon name="trash" [size]="22"/> }
                @case ('warning') { <ap-icon name="bell" [size]="22"/> }
                @default { <ap-icon name="check" [size]="22"/> }
              }
            </div>
            <div>
              <div id="confirm-title" class="card-title">{{ r.options.title }}</div>
              <div class="card-sub">Confirm action</div>
            </div>
          </div>
          <button class="x-btn" (click)="cancel()" aria-label="Close"><ap-icon name="x" [size]="14"/></button>
        </div>
        <div class="modal-body">
          <p style="line-height:1.65;color:var(--ink-2);">{{ r.options.message }}</p>
        </div>
        <div class="drawer-foot">
          <button class="btn btn-ghost" (click)="cancel()" [disabled]="svc.busy()">
            {{ r.options.cancelLabel }}
          </button>
          <button
            class="btn"
            [class.btn-danger]="r.options.variant === 'danger'"
            [class.btn-primary]="r.options.variant !== 'danger'"
            [disabled]="svc.busy()"
            (click)="confirm()"
            [style.background]="r.options.variant === 'danger' ? 'var(--danger)' : null"
            [style.color]="r.options.variant === 'danger' ? '#fff' : null"
            [style.border-color]="r.options.variant === 'danger' ? 'var(--danger)' : null"
          >
            @if (svc.busy()) {
              <span class="spinner"><ap-icon name="spinner" [size]="12"/></span> Working…
            } @else {
              {{ r.options.confirmLabel }}
            }
          </button>
        </div>
      </div>
    }
  `,
})
export class ConfirmDialogComponent {
  readonly svc = inject(ConfirmService);

  confirm(): void { this.svc.resolve(true); }
  cancel(): void { this.svc.resolve(false); }

  @HostListener('window:keydown.escape')
  onEscape(): void {
    if (this.svc.request() && !this.svc.busy()) this.cancel();
  }
}
