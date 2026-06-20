import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SpinnerComponent } from '../spinner/spinner.component';
import { IconComponent } from '../icons/icon.component';
import { I18nService } from '../../services/i18n.service';

/**
 * Unified "Unsaved changes" save bar — rendered across drawers and full pages.
 * Usage:
 *   <ap-save-bar [dirty]="dirty()" [saving]="saving()" (saved)="save()" (discarded)="discard()"/>
 *
 * The host element adds the `save-bar-top` class automatically, so global
 * styles.scss rules (.save-bar-top, .save-bar-top.dirty, .save-bar-top.shake)
 * apply without any extra wrapper.
 */
@Component({
  selector: 'ap-save-bar',
  standalone: true,
  imports: [CommonModule, SpinnerComponent, IconComponent],
  host: {
    '[class.save-bar-top]': 'true',
    '[class.dirty]': 'dirty',
    '[class.shake]': 'shake',
  },
  template: `
    <div class="row gap-sm" style="min-width:0;flex:1;">
      <span class="sb-label">{{ label || t('common.unsavedChanges') }}</span>
    </div>
    <div class="row gap-sm" style="flex-shrink:0;">
      <button class="btn btn-ghost btn-sm" type="button" (click)="discarded.emit()" [disabled]="saving">
        {{ discardLabel || t('common.discard') }}
      </button>
      <button class="btn btn-primary btn-sm" type="button" (click)="saved.emit()" [disabled]="saving">
        @if (saving) {
          <ap-spinner [size]="12"/> {{ t('common.saving') }}
        } @else if (justSaved) {
          <ap-icon name="check" [size]="12"/> {{ t('common.saved') }}
        } @else {
          {{ saveLabel || t('common.saveChanges') }}
        }
      </button>
    </div>
  `,
  styles: [`
    :host { display: flex; justify-content: space-between; align-items: center; padding: 0 24px; }
    .sb-label { font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.9); }
  `],
})
export class SaveBarComponent {
  private readonly i18n = inject(I18nService);
  readonly t = (k: string) => this.i18n.t(k);

  @Input() dirty = false;
  @Input() saving = false;
  @Input() justSaved = false;
  @Input() shake = false;
  @Input() label?: string;
  @Input() saveLabel?: string;
  @Input() discardLabel?: string;

  @Output() saved = new EventEmitter<void>();
  @Output() discarded = new EventEmitter<void>();
}
