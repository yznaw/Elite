import { isPlatformBrowser } from '@angular/common';
import { DOCUMENT, Injectable, PLATFORM_ID, REQUEST, computed, effect, inject, signal } from '@angular/core';

export type Locale = 'en' | 'ar';
export type Direction = 'ltr' | 'rtl';

const STORAGE_KEY = 'elite-web:locale';

/**
 * The same choice, somewhere a server render can read it.
 *
 * localStorage never reaches the server, so with it alone every server-rendered
 * page came out in English: an Arabic visitor saw English markup first and a
 * flip to Arabic after hydration, and the rendered `<html>` carried the wrong
 * lang and dir for crawlers and screen readers alike. The cookie is written
 * alongside localStorage on every change and read by the server on every
 * request.
 */
const COOKIE_NAME = 'elite_locale';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;
const COOKIE_RE = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=(en|ar)(?:;|$)`);

@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly doc = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly request = inject(REQUEST, { optional: true });

  private readonly _locale = signal<Locale>(this.load());
  readonly locale = this._locale.asReadonly();

  readonly dir = computed<Direction>(() => (this._locale() === 'ar' ? 'rtl' : 'ltr'));
  readonly isRtl = computed(() => this._locale() === 'ar');

  constructor() {
    effect(() => {
      const lang = this._locale();
      const dir = this.dir();
      // The injected DOCUMENT, not the `document` global: this runs during a
      // server render too, and it is what writes lang, dir and the rtl class
      // into the HTML the server sends.
      this.doc.documentElement.setAttribute('lang', lang);
      this.doc.documentElement.setAttribute('dir', dir);
      this.doc.body?.classList.toggle('rtl', dir === 'rtl');
      if (this.isBrowser) this.persist(lang);
    });
  }

  set(locale: Locale): void { this._locale.set(locale); }
  toggle(): void { this._locale.update((l) => (l === 'en' ? 'ar' : 'en')); }

  private load(): Locale {
    if (this.isBrowser) {
      // localStorage stays authoritative in the browser: it is what every
      // existing visitor already has. The cookie is the fallback for a
      // browser where storage is blocked.
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === 'en' || raw === 'ar') return raw;
      } catch {}
      return this.fromCookie(this.doc.cookie) ?? 'en';
    }
    return this.fromCookie(this.request?.headers.get('cookie') ?? '') ?? 'en';
  }

  private fromCookie(header: string): Locale | null {
    const match = header.match(COOKIE_RE);
    return match ? (match[1] as Locale) : null;
  }

  private persist(lang: Locale): void {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
    const secure = this.doc.location?.protocol === 'https:' ? '; Secure' : '';
    this.doc.cookie = `${COOKIE_NAME}=${lang}; Path=/; Max-Age=${COOKIE_MAX_AGE_S}; SameSite=Lax${secure}`;
  }
}
