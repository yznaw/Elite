import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService, Toast } from '../../services/toast.service';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'ap-toast',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="toast-stack" role="region" aria-label="Notifications">
      @for (t of toast.items(); track t.id) {
        <div class="toast" [class]="'toast ' + t.kind" role="status">
          <span class="toast-dot"></span>
          <div class="grow">
            <div class="toast-title">{{ t.title }}</div>
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
  `,
})
export class ToastComponent {
  readonly toast = inject(ToastService);

  runAction(t: Toast): void {
    t.action?.run();
    this.toast.dismiss(t.id);
  }
}
