import { Component, Input, inject, ChangeDetectionStrategy } from '@angular/core';
import { I18nService } from '../../services/i18n.service';

/**
 * The explanatory line under a disabled control the current user can't use
 * (docs/32-permission-enforcement-ux-design.md §3.2 — "disable, don't
 * hide" for in-page controls on a page the user is otherwise allowed to
 * view). Pair with `[disabled]="!can()"` on the control itself:
 *
 *   <button [disabled]="!canEdit()">...</button>
 *   <ap-perm-hint *ngIf="!canEdit()" scope="owner"/>
 *
 * `scope` picks which role tier the hint names — add more scopes here
 * rather than writing a one-off string each time a new owner/admin-only
 * control needs this.
 */
@Component({
  selector: 'ap-perm-hint',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="muted small perm-hint">{{ t('perm.' + scope + 'Only.hint') }}</div>`,
})
export class PermHintComponent {
  private readonly i18n = inject(I18nService);
  readonly t = (k: string): string => this.i18n.t(k);

  /** Which role tier is allowed — matches the `perm.<scope>Only.*` i18n key family. */
  @Input() scope: 'owner' | 'admin' = 'owner';
}
