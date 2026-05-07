import { Injectable, computed, effect, signal } from '@angular/core';

export type Locale = 'en' | 'ar';
export type Direction = 'ltr' | 'rtl';

const STORAGE_KEY = 'elite-web:locale';

@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly _locale = signal<Locale>(this.load());
  readonly locale = this._locale.asReadonly();

  readonly dir = computed<Direction>(() => (this._locale() === 'ar' ? 'rtl' : 'ltr'));
  readonly isRtl = computed(() => this._locale() === 'ar');

  constructor() {
    effect(() => {
      const lang = this._locale();
      const dir = this.dir();
      try {
        document.documentElement.setAttribute('lang', lang);
        document.documentElement.setAttribute('dir', dir);
        document.body.classList.toggle('rtl', dir === 'rtl');
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {}
    });
  }

  set(locale: Locale): void { this._locale.set(locale); }
  toggle(): void { this._locale.update((l) => (l === 'en' ? 'ar' : 'en')); }

  private load(): Locale {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (raw === 'en' || raw === 'ar') return raw;
    } catch {}
    return 'en';
  }
}
