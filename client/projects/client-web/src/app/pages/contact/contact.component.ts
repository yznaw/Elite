import { Component, DestroyRef, OnInit, PLATFORM_ID, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../services/i18n.service';
import { LocaleService } from '../../services/locale.service';
import { HomeContentService } from '../../services/home-content.service';
import { ContactBranch, ContactStockist, SocialLink } from '../../models/home-content.model';
import { SeoService } from '../../services/seo.service';
import { API_BASE } from '../../core/api-base';

/** Whole hour to a schema.org / display friendly `HH:MM`. */
function hhmm(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

interface ContactForm {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

@Component({
    selector: 'cw-contact',
    imports: [CommonModule, FormsModule],
    templateUrl: './contact.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrl: './contact.component.scss'
})
export class ContactComponent implements OnInit {
  private readonly i18n        = inject(I18nService);
  readonly locale              = inject(LocaleService);
  private readonly homeContent = inject(HomeContentService);
  private readonly http        = inject(HttpClient);
  private readonly seo         = inject(SeoService);
  private readonly sanitizer   = inject(DomSanitizer);
  private readonly destroyRef  = inject(DestroyRef);

  /**
   * Ticks once a minute so the "Open now" badge updates on its own.
   *
   * OnPush only re-renders on an input change, a DOM event, or a signal read
   * during the last render changing -- a plain `new Date()` inside
   * `isOpenNow()` computed the right answer exactly once, at whatever moment
   * the page happened to render, and then sat there wrong past the next
   * hour boundary until the visitor did something. Reading this signal from
   * `dohaNow()` is what makes the badge a live value instead of a snapshot.
   */
  private readonly nowTick = signal(Date.now());
  private readonly apiBase     = inject(API_BASE);
  private readonly isBrowser   = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly seoTags = this.seo.watch(() => ({
    title: this.i18n.t('seo.contact.title'),
    description: this.i18n.t('seo.contact.description'),
    canonicalPath: '/contact',
    jsonLd: this.branchJsonLd(),
  }));

  /**
   * One `Store` node per shop.
   *
   * This page already showed an address, opening hours and a phone number, but
   * carried no structured data at all, so none of it was eligible for the Maps
   * pack and nothing could cite it for "where is Elite" or "when does it open".
   * Both shops already have Google listings; `sameAs` points at them so this
   * markup is read as the same business rather than a third, competing one.
   *
   * Re-runs on locale change, which is why the names and addresses are picked
   * per locale rather than emitted once.
   */
  private branchJsonLd(): Record<string, unknown>[] {
    const ar = this.locale.locale() === 'ar';
    const origin = this.seo.origin();
    const c = this.contactContent();

    // Stockists are deliberately absent. A counter inside Printemps is not
    // Elite's premises, and describing it as a `Store` of Elite's, or reusing
    // the host's map link in `sameAs`, would tell search engines the two
    // businesses are one.
    return (c.branches ?? []).filter((b) => b.nameEn || b.nameAr).map((b) => ({
      '@context': 'https://schema.org',
      '@type': 'Store',
      '@id': `${origin}/contact#${b.id}`,
      // The plain trade name, matching the Google Business listing exactly.
      // Google's naming rules forbid a location suffix on a listing, so adding
      // one here could only ever disagree with it. Address and @id separate
      // the two shops.
      name: this.i18n.t('seo.siteName'),
      image: `${origin}/assets/brand/og-default.jpg`,
      url: `${origin}/contact`,
      ...(b.phone ? { telephone: b.phone.replace(/\s+/g, '') } : {}),
      ...(c.email ? { email: c.email } : {}),
      parentOrganization: {
        '@type': 'Organization',
        name: this.i18n.t('seo.siteName'),
        url: origin,
      },
      address: {
        '@type': 'PostalAddress',
        streetAddress: (ar ? b.addressAr : b.addressEn).replace(/\n+/g, ', '),
        addressLocality: `${ar ? b.nameAr : b.nameEn}, ${ar ? 'الدوحة' : 'Doha'}`,
        addressCountry: 'QA',
      },
      openingHoursSpecification: [
        {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'],
          opens: hhmm(b.weekdayOpen),
          closes: hhmm(b.weekdayClose),
        },
        {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: ['Friday', 'Saturday'],
          opens: hhmm(b.weekendOpen),
          closes: hhmm(b.weekendClose),
        },
      ],
      ...(b.lat != null && b.lng != null
        ? { geo: { '@type': 'GeoCoordinates', latitude: b.lat, longitude: b.lng } }
        : {}),
      ...(b.mapUrl ? { hasMap: b.mapUrl, sameAs: [b.mapUrl] } : {}),
      currenciesAccepted: 'QAR',
    }));
  }

  /** Doha keeps a fixed UTC+3 offset, so this needs no DST handling. */
  private dohaNow(): Date {
    const n = new Date(this.nowTick());
    return new Date(n.getTime() + n.getTimezoneOffset() * 60000 + 3 * 3600000);
  }

  /** Whether `branch` is serving customers at this moment, in Doha. */
  isOpenNow(b: ContactBranch): boolean {
    const d = this.dohaNow();
    const weekend = d.getDay() === 5 || d.getDay() === 6;
    const open = weekend ? b.weekendOpen : b.weekdayOpen;
    const close = weekend ? b.weekendClose : b.weekdayClose;
    const mins = d.getHours() * 60 + d.getMinutes();
    return mins >= open * 60 && mins < close * 60;
  }

  /** True on Friday and Saturday, so the matching hours row can be emphasised. */
  isWeekendInDoha(): boolean {
    const day = this.dohaNow().getDay();
    return day === 5 || day === 6;
  }

  readonly fmtHour = hhmm;

  branchName(b: ContactBranch): string {
    return this.locale.locale() === 'ar' ? b.nameAr : b.nameEn;
  }

  /** Address lines, split so each renders on its own row. */
  branchAddressLines(b: ContactBranch): string[] {
    const raw = this.locale.locale() === 'ar' ? b.addressAr : b.addressEn;
    return raw.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  /**
   * Trust a branch's map embed for use as an `iframe src`.
   *
   * Angular blocks a bound resource URL by default, and rightly so. The server
   * has already rejected anything that is not an https google.com/maps/embed
   * URL (`safeMapEmbed`), and the host check is repeated here so a compromised
   * or stale API response cannot frame a third-party page either. Results are
   * cached because a new SafeResourceUrl on every change detection run would
   * reload the iframe continuously.
   */
  private readonly embedCache = new Map<string, SafeResourceUrl | null>();

  mapEmbed(url: string): SafeResourceUrl | null {
    if (!url) return null;
    if (this.embedCache.has(url)) return this.embedCache.get(url)!;

    let safe: SafeResourceUrl | null = null;
    try {
      const u = new URL(url);
      if (u.protocol === 'https:'
        && (u.hostname === 'www.google.com' || u.hostname === 'google.com')
        && u.pathname.startsWith('/maps/embed')) {
        safe = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      }
    } catch {
      safe = null;
    }
    this.embedCache.set(url, safe);
    return safe;
  }

  stockistName(s: ContactStockist): string {
    return this.locale.locale() === 'ar' ? s.nameAr : s.nameEn;
  }
  stockistLocation(s: ContactStockist): string {
    return this.locale.locale() === 'ar' ? s.locationAr : s.locationEn;
  }
  stockistHours(s: ContactStockist): string {
    return this.locale.locale() === 'ar' ? s.hoursNoteAr : s.hoursNoteEn;
  }

  readonly subheadText = computed(() => {
    const c = this.contactContent();
    return (this.locale.locale() === 'ar' ? c.subheadAr : c.subhead) || c.subhead;
  });

  readonly t = (key: string): string => this.i18n.t(key);
  readonly contactContent = computed(() => this.homeContent.contentData().contact);
  readonly activeSocialLinks = computed(() =>
    this.contactContent().socialLinks?.filter((s) => s.enabled) ?? []
  );

  readonly subjects = [
    'contact.subject.bespoke',
    'contact.subject.product',
    'contact.subject.sizing',
    'contact.subject.order',
    'contact.subject.press',
  ];

  readonly form      = signal<ContactForm>({ name: '', email: '', phone: '', subject: '', message: '' });
  readonly submitted = signal(false);
  readonly submitting = signal(false);
  readonly error = signal('');

  ngOnInit(): void {
    void this.homeContent.refresh(true);

    // 30s is frequent enough that the badge never reads stale for more than
    // half a minute, and light enough (one signal write, no HTTP) to leave
    // running for as long as a visitor stays on the page.
    //
    // Browser only. A server render waits for pending timers before it
    // serialises, and an interval never finishes, so this would hang the
    // render indefinitely. The server's own Date.now() is a correct badge for
    // the moment the page is sent.
    if (this.isBrowser) {
      const timer = setInterval(() => this.nowTick.set(Date.now()), 30_000);
      this.destroyRef.onDestroy(() => clearInterval(timer));
    }
  }

  set<K extends keyof ContactForm>(key: K, value: ContactForm[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  async onSubmit(): Promise<void> {
    if (this.submitting()) return;

    const form = this.form();
    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      subject: form.subject ? this.t(form.subject) : '',
      message: form.message.trim(),
      locale: this.locale.locale(),
    };

    if (!payload.name || !payload.email || !payload.message) {
      this.error.set(this.t('contact.error.required'));
      return;
    }

    this.submitting.set(true);
    this.error.set('');

    try {
      await firstValueFrom(this.http.post(`${this.apiBase}/contact`, payload));
      this.submitted.set(true);
      this.form.set({ name: '', email: '', phone: '', subject: '', message: '' });
    } catch {
      this.error.set(this.t('contact.error.submit'));
    } finally {
      this.submitting.set(false);
    }
  }


  private sanitizePhone(phone: string): string {
    return phone.trim().replace(/\D/g, '');
  }

  socialUrl(link: SocialLink): string {
    const h = link.handle.trim();
    const sanitized = this.sanitizePhone(h);
    switch (link.platform) {
      case 'whatsapp':  return `https://wa.me/${sanitized}`;
      case 'instagram': return `https://instagram.com/${h}`;
      case 'twitter':   return `https://x.com/${h}`;
      case 'facebook':  return `https://facebook.com/${h}`;
      case 'tiktok':    return `https://tiktok.com/@${h}`;
      case 'snapchat':  return `https://snapchat.com/add/${h}`;
      case 'youtube':   return `https://youtube.com/@${h}`;
      case 'linkedin':  return `https://linkedin.com/in/${h}`;
      default:          return '#';
    }
  }

  whatsappUrl(): string {
    const num = this.contactContent().whatsapp || '';
    return `https://wa.me/${this.sanitizePhone(num)}`;
  }

  socialLabel(platform: string): string {
    const labels: Record<string, string> = {
      whatsapp: 'WhatsApp', instagram: 'Instagram', twitter: 'X (Twitter)',
      facebook: 'Facebook', tiktok: 'TikTok', snapchat: 'Snapchat',
      youtube: 'YouTube', linkedin: 'LinkedIn',
    };
    return labels[platform] ?? platform;
  }
}
