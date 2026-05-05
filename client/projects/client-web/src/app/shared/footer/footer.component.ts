import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

interface FooterLink {
  label: string;
  path: string;
}

interface FooterColumn {
  title: string;
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
          <div style="font-family: var(--ff-serif); font-size: 20px; letter-spacing: 0.15em; color: var(--gold); margin-bottom: 6px;">ELITE</div>
          <div style="font-family: var(--ff-sans); font-size: 9px; letter-spacing: 0.25em; color: var(--muted); text-transform: uppercase; margin-bottom: 16px;">Arabic Leather Artisans</div>
          <p style="font-family: var(--ff-sans); font-size: 11px; color: var(--muted); line-height: 1.8; max-width: 220px;">
            Handcrafted in Doha since 1962. Limited to 400 pairs per year.
          </p>
        </div>

        @for (col of columns; track col.title) {
          <div>
            <div style="font-family: var(--ff-sans); font-size: 9px; letter-spacing: 0.25em; text-transform: uppercase; color: var(--gold); margin-bottom: 16px;">{{ col.title }}</div>
            @for (l of col.links; track l.label) {
              <a [routerLink]="l.path"
                style="display: block; text-decoration: none; font-family: var(--ff-sans); font-size: 12px; color: var(--muted); text-align: left; padding: 4px 0; letter-spacing: 0.04em; transition: color 0.2s;">
                {{ l.label }}
              </a>
            }
          </div>
        }
      </div>

      <div class="divider" style="max-width: 1200px; margin: 32px auto 24px;"></div>

      <div style="max-width: 1200px; margin: 0 auto; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <p style="font-family: var(--ff-sans); font-size: 10px; color: var(--muted); letter-spacing: 0.06em;">
          © 2026 Elite Collection. All rights reserved.
        </p>
        <p style="font-family: var(--ff-sans); font-size: 10px; color: var(--muted); letter-spacing: 0.06em;">
          Doha · Dubai · Doha
        </p>
      </div>
    </footer>
  `,
})
export class FooterComponent {
  readonly columns: FooterColumn[] = [
    {
      title: 'Collection',
      links: [
        { label: 'All Pieces', path: '/collection' },
        { label: 'New Arrivals', path: '/collection' },
        { label: 'Signature', path: '/collection' },
        { label: 'Limited Edition', path: '/collection' },
      ],
    },
    {
      title: 'Atelier',
      links: [
        { label: 'Our Story', path: '/story' },
        { label: 'Craftsmanship', path: '/story' },
        { label: 'Bespoke', path: '/contact' },
        { label: 'Appointments', path: '/contact' },
      ],
    },
    {
      title: 'Client',
      links: [
        { label: 'Contact Us', path: '/contact' },
        { label: 'Size Guide', path: '/contact' },
        { label: 'Care Guide', path: '/contact' },
        { label: 'Returns', path: '/contact' },
      ],
    },
  ];
}
