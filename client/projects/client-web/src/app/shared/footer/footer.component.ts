import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../services/i18n.service';

interface FooterLink {
  labelKey: string;
  path: string;
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
    <footer style="border-top: 1px solid var(--border); padding: 48px 24px 32px; background: var(--surface);">
      <div style="max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 40px;">
        <div>
          <div style="font-family: var(--ff-serif); font-size: 20px; letter-spacing: 0.15em; color: var(--gold); margin-bottom: 6px;">{{ t('brand.name') }}</div>
          <div style="font-family: var(--ff-sans); font-size: 9px; letter-spacing: 0.25em; color: var(--muted); text-transform: uppercase; margin-bottom: 16px;">{{ t('brand.tagline') }}</div>
          <p style="font-family: var(--ff-sans); font-size: 11px; color: var(--muted); line-height: 1.8; max-width: 220px;">
            {{ t('footer.tagline') }}
          </p>
        </div>

        @for (col of columns; track col.titleKey) {
          <div>
            <div style="font-family: var(--ff-sans); font-size: 9px; letter-spacing: 0.25em; text-transform: uppercase; color: var(--gold); margin-bottom: 16px;">{{ t(col.titleKey) }}</div>
            @for (l of col.links; track l.labelKey) {
              <a [routerLink]="l.path"
                style="display: block; text-decoration: none; font-family: var(--ff-sans); font-size: 12px; color: var(--muted); text-align: left; padding: 4px 0; letter-spacing: 0.04em; transition: color 0.2s;">
                {{ t(l.labelKey) }}
              </a>
            }
          </div>
        }
      </div>

      <div class="divider" style="max-width: 1200px; margin: 32px auto 24px;"></div>

      <div style="max-width: 1200px; margin: 0 auto; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <p style="font-family: var(--ff-sans); font-size: 10px; color: var(--muted); letter-spacing: 0.06em;">
          {{ t('footer.copyright') }}
        </p>
        <p style="font-family: var(--ff-sans); font-size: 10px; color: var(--muted); letter-spacing: 0.06em;">
          {{ t('footer.cities') }}
        </p>
      </div>
    </footer>
  `,
})
export class FooterComponent {
  private readonly i18n = inject(I18nService);
  readonly t = (key: string): string => this.i18n.t(key);

  readonly columns: FooterColumn[] = [
    {
      titleKey: 'footer.col.collection',
      links: [
        { labelKey: 'footer.link.allPieces', path: '/collection' },
        { labelKey: 'footer.link.newArrivals', path: '/collection' },
        { labelKey: 'footer.link.signature', path: '/collection' },
        { labelKey: 'footer.link.limitedEdition', path: '/collection' },
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
