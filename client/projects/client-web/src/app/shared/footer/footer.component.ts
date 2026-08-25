import { Component, OnInit, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../services/i18n.service';
import { LocaleService } from '../../services/locale.service';
import { HomeContentService } from '../../services/home-content.service';
import { SocialLink } from '../../models/home-content.model';
import { NousBadgeComponent } from '../nous-badge/nous-badge.component';

interface FooterLink {
  labelKey: string;
  path: string;
  queryParams?: Record<string, string>;
}

interface FooterColumn {
  titleKey: string;
  links: FooterLink[];
}

interface PolicyMeta {
  handle: string;
  title: string;
  titleAr: string;
}

@Component({
    selector: 'cw-footer',
    imports: [CommonModule, RouterLink, NousBadgeComponent],
    template: `
    <footer id="site-footer" class="site-footer">
      <div class="footer-grid" [class.has-legal]="policyLinks().length > 0">
        <div class="footer-brand">
          <a routerLink="/" class="footer-logo-link" [attr.aria-label]="t('brand.name')">
            <img class="footer-logo" src="assets/brand/elite-logo-green.png" [alt]="t('brand.name')" loading="lazy" />
          </a>
          <div class="footer-tagline">{{ t('brand.tagline') }}</div>
          <p>
            {{ t('footer.tagline') }}
          </p>

          @if (activeSocialLinks().length > 0) {
            <div class="footer-social">
              @for (link of activeSocialLinks(); track link.id) {
                <a
                  class="footer-social-btn"
                  [href]="socialUrl(link)"
                  target="_blank" rel="noopener noreferrer"
                  [attr.aria-label]="socialLabel(link.platform)"
                  [attr.title]="socialLabel(link.platform)"
                >
                  @switch (link.platform) {
                    @case ('whatsapp') {
                      <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    }
                    @case ('instagram') {
                      <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162S8.597 18.163 12 18.163s6.162-2.759 6.162-6.162S15.403 5.838 12 5.838zm0 10.162c-2.209 0-4-1.79-4-4s1.791-4 4-4 4 1.791 4 4-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                    }
                    @case ('twitter') {
                      <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    }
                    @case ('facebook') {
                      <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                    }
                    @case ('tiktok') {
                      <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.79 1.52V6.77a4.85 4.85 0 01-1.02-.08z"/></svg>
                    }
                    @case ('snapchat') {
                      <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M12.006.006C6.73.006 2.45 4.286 2.45 9.56c0 1.317.271 2.574.756 3.713-.154.077-.28.196-.354.36-.142.315-.098.738.133 1.053.218.297.535.47.867.477a6.72 6.72 0 00-.066.304c-.074.408-.052.748.07 1.006.133.27.382.468.73.582.375.12.88.151 1.546.097.234-.02.478-.05.73-.085.402.564 1.043 1.152 2.048 1.152.176 0 .365-.024.568-.072l.185-.042.185.042c.203.048.392.072.568.072 1.006 0 1.647-.588 2.049-1.152.251.035.495.065.73.085.665.054 1.17.023 1.546-.097.348-.114.597-.312.73-.582.122-.258.144-.598.07-1.006a6.72 6.72 0 00-.066-.304c.332-.007.649-.18.867-.477.231-.315.275-.738.133-1.053a.787.787 0 00-.354-.36c.485-1.14.756-2.396.756-3.713C21.556 4.286 17.276.006 12.006.006z"/></svg>
                    }
                    @case ('youtube') {
                      <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                    }
                    @case ('linkedin') {
                      <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    }
                  }
                </a>
              }
            </div>
          }
        </div>

        @for (col of columns; track col.titleKey) {
          <div class="footer-column">
            <div class="footer-column-title">{{ t(col.titleKey) }}</div>
            @for (l of col.links; track l.labelKey) {
              <a [routerLink]="l.path" [queryParams]="l.queryParams || null" class="footer-link">
                {{ t(l.labelKey) }}
              </a>
            }
          </div>
        }

        @if (policyLinks().length > 0) {
          <div class="footer-column">
            <div class="footer-column-title">{{ t('footer.col.legal') || 'Legal' }}</div>
            @for (p of policyLinks(); track p.handle) {
              <a [routerLink]="'/policy/' + p.handle" class="footer-link">{{ policyTitle(p) }}</a>
            }
          </div>
        }
      </div>

      <div class="divider footer-divider"></div>

      <div class="footer-bottom">
        <p>
          {{ t('footer.copyright', { year: currentYear }) }}
        </p>
        <p>
          {{ t('footer.cities') }}
        </p>
        <cw-nous-badge/>
      </div>
    </footer>
  `,
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [`
    .site-footer {
      border-top: 1px solid var(--border);
      padding: 52px 24px 32px;
      background:
        linear-gradient(180deg, rgba(255, 250, 240, 0.38), transparent 42%),
        var(--surface);
    }

    .footer-grid {
      max-width: 1200px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: minmax(260px, 1.15fr) repeat(3, minmax(150px, 0.75fr));
      gap: 42px;
      align-items: start;
    }
    .footer-grid.has-legal {
      grid-template-columns: minmax(220px, 1fr) repeat(4, minmax(120px, 0.7fr));
    }

    .footer-brand {
      max-width: 300px;
    }

    .footer-logo-link {
      width: fit-content;
      display: inline-flex;
      align-items: center;
      margin-bottom: 10px;
      text-decoration: none;
    }

    .footer-logo {
      display: block;
      width: 132px;
      height: auto;
    }

    .footer-tagline {
      position: relative;
      width: fit-content;
      margin-bottom: 18px;
      padding-top: 12px;
      color: var(--muted);
      font-family: var(--ff-sans);
      font-size: 10px;
      line-height: 1;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .footer-tagline::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 48px;
      height: 1px;
      background: var(--gold);
    }

    .footer-brand p,
    .footer-bottom p {
      color: var(--cream-dim);
      font-family: var(--ff-sans);
    }

    .footer-brand p {
      max-width: 270px;
      font-size: 13px;
      line-height: 1.7;
    }

    .footer-social {
      display: flex;
      gap: 8px;
      margin-top: 16px;
    }

    .footer-social-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border: 1px solid var(--border);
      border-radius: 50%;
      color: var(--muted);
      transition: color 0.2s ease, border-color 0.2s ease;
    }

    .footer-social-btn:hover {
      color: var(--green-2);
      border-color: var(--green-2);
    }

    .footer-column-title {
      margin-bottom: 16px;
      color: var(--gold);
      font-family: var(--ff-sans);
      font-size: 10px;
      line-height: 1;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .footer-link {
      display: block;
      width: fit-content;
      padding: 4px 0;
      color: var(--cream-dim);
      font-family: var(--ff-sans);
      font-size: 13px;
      line-height: 1.45;
      letter-spacing: 0;
      text-align: start;
      text-decoration: none;
      transition: color 0.2s ease, transform 0.2s ease;
    }

    .footer-link:hover {
      color: var(--green-2);
      transform: translateX(2px);
    }

    .footer-divider {
      max-width: 1200px;
      margin: 34px auto 24px;
    }

    .footer-bottom {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }

    .footer-bottom p {
      font-size: 11px;
      line-height: 1.4;
      letter-spacing: 0;
    }

    :host-context(html[dir='rtl']) .footer-tagline::before {
      right: 0;
      left: auto;
    }

    :host-context(html[dir='rtl']) .footer-link:hover {
      transform: translateX(-2px);
    }

    @media (max-width: 860px) {
      .footer-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .footer-brand {
        grid-column: 1 / -1;
      }
    }

    @media (max-width: 560px) {
      .site-footer {
        padding: 42px 20px 28px;
      }

      .footer-grid {
        grid-template-columns: 1fr;
        gap: 30px;
      }

      .footer-logo {
        width: 118px;
      }

      .footer-bottom {
        flex-direction: column;
      }
    }
  `]
})
export class FooterComponent implements OnInit {
  private readonly i18n = inject(I18nService);
  private readonly locale = inject(LocaleService);

  readonly policyTitle = (p: PolicyMeta): string =>
    this.locale.locale() === 'ar' ? (p.titleAr || p.title) : p.title;
  private readonly http = inject(HttpClient);
  private readonly homeContent = inject(HomeContentService);
  readonly t = this.i18n.t;
  readonly currentYear = new Date().getFullYear();
  readonly policyLinks = signal<PolicyMeta[]>([]);
  readonly activeSocialLinks = computed(() =>
    this.homeContent.contentData().contact?.socialLinks?.filter((s) => s.enabled) ?? []
  );

  private get apiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || /^192\.168\./.test(hostname);
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
  }

  async ngOnInit(): Promise<void> {
    void this.homeContent.refresh();

    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: PolicyMeta[] }>(`${this.apiBase}/policies`),
      );
      this.policyLinks.set(res.data ?? []);
    } catch {
      // Footer keeps rendering without legal column if API fails
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

  socialLabel(platform: string): string {
    const labels: Record<string, string> = {
      whatsapp: 'WhatsApp', instagram: 'Instagram', twitter: 'X (Twitter)',
      facebook: 'Facebook', tiktok: 'TikTok', snapchat: 'Snapchat',
      youtube: 'YouTube', linkedin: 'LinkedIn',
    };
    return labels[platform] ?? platform;
  }

  readonly columns: FooterColumn[] = [
    {
      titleKey: 'footer.col.collection',
      links: [
        { labelKey: 'footer.link.allPieces', path: '/collection/all-products' },
        { labelKey: 'footer.link.newArrivals', path: '/collection/all-products', queryParams: { sort: 'Newest' } },
        { labelKey: 'footer.link.signature', path: '/collection/all-products', queryParams: { tag: 'signature' } },
        { labelKey: 'footer.link.limitedEdition', path: '/collection/all-products', queryParams: { tag: 'limited' } },
      ],
    },
    {
      titleKey: 'footer.col.atelier',
      links: [
        { labelKey: 'footer.link.ourStory', path: '/story' },
        { labelKey: 'footer.link.craftsmanship', path: '/story' },
        { labelKey: 'footer.link.bespoke', path: '/contact' },
        { labelKey: 'footer.link.appointments', path: '/contact' },
      ],
    },
    {
      titleKey: 'footer.col.client',
      links: [
        { labelKey: 'footer.link.contactUs', path: '/contact' },
        { labelKey: 'footer.link.sizeGuide', path: '/contact' },
        { labelKey: 'footer.link.careGuide', path: '/contact' },
        { labelKey: 'footer.link.returns', path: '/contact' },
      ],
    },
  ];
}
