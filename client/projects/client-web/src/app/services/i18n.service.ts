import { Injectable, inject } from '@angular/core';
import { LocaleService } from './locale.service';
import { STRINGS } from '../i18n/strings';

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly locale = inject(LocaleService);

  /** Reactive translator — re-evaluates whenever the locale signal changes. */
  readonly t = (key: string): string => {
    const dict = STRINGS[this.locale.locale()];
    return (dict && dict[key]) ?? key;
  };
}
