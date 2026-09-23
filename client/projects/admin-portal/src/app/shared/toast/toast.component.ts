import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService, Toast } from '../../services/toast.service';
import { IconComponent } from '../icons/icon.component';

@Component({
    selector: 'ap-toast',
    imports: [CommonModule, IconComponent],
    changeDetection: ChangeDetectionStrategy.Eager,
    template: `
    <div class="toast-stack" role="region" aria-label="Notifications">
      @for (t of toast.items(); track t.id) {
        <!-- Errors interrupt (alert); everything else waits its turn (status).
             Hover or focus holds the toast so a long message can be read. -->
        <div class="toast" [class]="'toast ' + t.kind" [attr.role]="t.kind === 'error' ? 'alert' : 'status'"
             (mouseenter)="toast.pause(t.id)" (mouseleave)="toast.resume(t.id)"
             (focusin)="toast.pause(t.id)" (focusout)="toast.resume(t.id)">
          <span class="toast-dot"></span>
          <div class="grow">
            <div class="toast-title">
              {{ t.title }}
              @if (t.count > 1) { <span class="toast-count" [attr.aria-label]="t.count + ' times'">×{{ t.count }}</span> }
            </div>
            @if (t.sub) { <div class="toast-sub">{{ t.sub }}</div> }
            @if (t.action) {
              <button class="toast-action" (click)="runAction(t)">{{ t.action.label }}</button>
            }
          </div>
          <button class="toast-close" (click)="toast.dismiss(t.id)" aria-label="Dismiss">
            <ap-icon name="x" [size]="12"/>
          </button>
        </div>
      }
    </div>
  `
})
export class ToastComponent {
  readonly toast = inject(ToastService);

  runAction(t: Toast): void {
    t.action?.run();
    if (!t.action?.keepOpen) this.toast.dismiss(t.id);
  }
}
