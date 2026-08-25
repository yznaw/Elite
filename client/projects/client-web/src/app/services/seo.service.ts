import { DOCUMENT, EffectRef, Injectable, effect, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { I18nService } from './i18n.service';
import { LocaleService } from './locale.service';

/**
 * What a page wants search engines and link previews to show.
 *
 * `title` is the page-specific part only — the site name is appended here so
 * every tab reads the same way. Leave a field out and the service falls back
 * to a house default rather than emitting an empty tag.
 */
export interface SeoInput {
  title: string;
  description?: string;
  /** Absolute, or an app path such as `/uploads/x.webp` — absolutised here. */
  image?: string;
  /** Path only, no query string. Defaults to the current URL minus its query. */
  canonicalPath?: string;
  type?: 'website' | 'product' | 'article';
  /** One JSON-LD object, or several. Replaces whatever the last page emitted. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[] | null;
}

const FALLBACK_IMAGE = '/assets/brand/elite-logo-green.png';
const JSON_LD_ID = 'seo-jsonld';
const MAX_DESCRIPTION = 160;

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly doc = inject(DOCUMENT);
  private readonly meta = inject(Meta);
  private readonly titleSvc = inject(Title);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private readonly locale = inject(LocaleService);

  /**
   * Keep the head in sync with a page's own signals.
   *
   * Must be called from an injection context (a field initializer or the
   * constructor) so the effect dies with the component — otherwise every
   * navigation would leave another effect writing to the same head. Returning
   * `null` from the factory means "not ready yet", which leaves the previous
   * page's tags in place instead of flashing an empty title while data loads.
   *
   * The locale signal is read on every run, so switching to Arabic rewrites
   * the tags without the page having to ask.
   */
  watch(factory: () => SeoInput | null): EffectRef {
    return effect(() => {
      const input = factory();
      if (input) this.apply(input);
    });
  }

  apply(input: SeoInput): void {
    const siteName = this.i18n.t('seo.siteName');
    const lang = this.locale.locale();
    const title = input.title.trim()
      ? `${input.title.trim()} | ${siteName}`
      : `${siteName} | ${this.i18n.t('seo.tagline')}`;
    const description = this.clamp(
      input.description?.trim() || this.i18n.t('seo.defaultDescription'),
    );
    const url = this.absolute(input.canonicalPath ?? this.currentPath());
    const image = this.absolute(input.image?.trim() || FALLBACK_IMAGE);

    this.titleSvc.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });

    this.setCanonical(url);

    this.meta.updateTag({ property: 'og:type', content: input.type ?? 'website' });
    this.meta.updateTag({ property: 'og:site_name', content: siteName });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ property: 'og:image', content: image });
    this.meta.updateTag({ property: 'og:locale', content: lang === 'ar' ? 'ar_QA' : 'en_QA' });

    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    this.meta.updateTag({ name: 'twitter:image', content: image });

    this.setJsonLd(input.jsonLd ?? null);
  }

  /**
   * Absolute origin of the storefront. Every og: and canonical value has to be
   * absolute — a relative og:image is silently dropped by every crawler.
   */
  origin(): string {
    return this.doc.defaultView?.location.origin ?? '';
  }

  private currentPath(): string {
    return this.router.url.split('?')[0].split('#')[0] || '/';
  }

  /** Absolutise an app path or pass an already-absolute URL through. */
  absolute(value: string): string {
    if (!value) return '';
    if (/^https?:/i.test(value)) return value;
    const origin = this.origin();
    return value.startsWith('/') ? `${origin}${value}` : `${origin}/${value}`;
  }

  /**
   * Strip markup and collapse whitespace. Product copy is rich text, and raw
   * tags in a meta description or a JSON-LD field are shown verbatim by
   * consumers rather than rendered.
   */
  plainText(value: string): string {
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private clamp(value: string): string {
    const flat = this.plainText(value);
    if (flat.length <= MAX_DESCRIPTION) return flat;
    // Cut on a word boundary so the snippet does not end mid-word.
    const cut = flat.slice(0, MAX_DESCRIPTION);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
  }

  /**
   * One canonical per page, rewritten in place. The product page carries a
   * `?color=` query that produces a distinct URL for the same item, so
   * pointing every variant at the query-less path is what stops the catalogue
   * from competing with itself in the index.
   */
  private setCanonical(url: string): void {
    const head = this.doc.head;
    let link = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.doc.createElement('link');
      link.setAttribute('rel', 'canonical');
      head.appendChild(link);
    }
    link.setAttribute('href', url);
  }

  private setJsonLd(data: Record<string, unknown> | Record<string, unknown>[] | null): void {
    const head = this.doc.head;
    const existing = head.querySelector(`script[data-seo="${JSON_LD_ID}"]`);
    if (!data || (Array.isArray(data) && data.length === 0)) {
      existing?.remove();
      return;
    }
    const script = existing ?? this.doc.createElement('script');
    script.setAttribute('type', 'application/ld+json');
    script.setAttribute('data-seo', JSON_LD_ID);
    script.textContent = JSON.stringify(data);
    if (!existing) head.appendChild(script);
  }
}
