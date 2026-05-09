import { Injectable, computed, inject } from '@angular/core';
import { LocaleService } from './locale.service';
import { STRINGS } from '../i18n/strings';

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly locale = inject(LocaleService);

  /**
   * Reactive translator — subscribes to the current locale signal.
   * Use as `i18n.t('nav.dashboard')` in components, or
   * `{{ t('nav.dashboard') }}` after exposing the bound `t` arrow on the class.
   */
  readonly t = (key: string): string => {
    const dict = STRINGS[this.locale.locale()];
    return (dict && dict[key]) ?? key;
  };

  /** Reactive convenience: returns the same arrow but updates with locale. */
  readonly translator = computed(() => {
    const dict = STRINGS[this.locale.locale()];
    return (key: string): string => (dict && dict[key]) ?? key;
  });
}
