import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../services/i18n.service';

interface FooterLink {
  labelKey: string;
  path: string;
  queryParams?: Record<string, string>;
}

interface FooterColumn {
  titleKey: string;
  links: FooterLink[];
}

@Component({
  selector: 'cw-footer',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <footer id="site-footer" class="site-footer">
      <div class="footer-grid">
        <div class="footer-brand">
          <a routerLink="/" class="footer-logo-link" [attr.aria-label]="t('brand.name')">
            <img class="footer-logo" src="assets/brand/elite-logo-green.png" [alt]="t('brand.name')" loading="lazy" />
          </a>
          <div class="footer-tagline">{{ t('brand.tagline') }}</div>
          <p>
            {{ t('footer.tagline') }}
          </p>
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
      </div>

      <div class="divider footer-divider"></div>

      <div class="footer-bottom">
        <p>
          {{ t('footer.copyright', { year: currentYear }) }}
        </p>
        <p>
          {{ t('footer.cities') }}
        </p>
        <p>
          {{ t('footer.poweredBy') }}
        </p>
      </div>
    </footer>
  `,
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
      font-size: 9px;
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
      color: var(--muted);
      font-family: var(--ff-sans);
    }

    .footer-brand p {
      max-width: 240px;
      font-size: 11px;
      line-height: 1.8;
    }

    .footer-column-title {
      margin-bottom: 16px;
      color: var(--gold);
      font-family: var(--ff-sans);
      font-size: 9px;
      line-height: 1;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .footer-link {
      display: block;
      width: fit-content;
      padding: 4px 0;
      color: var(--muted);
      font-family: var(--ff-sans);
      font-size: 12px;
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
      font-size: 10px;
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
  `],
})
export class FooterComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t;
  readonly currentYear = new Date().getFullYear();

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
