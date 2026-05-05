import { Component, HostListener, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { CartService } from '../../services/cart.service';

interface NavLink {
  path: string;
  label: string;
  exact?: boolean;
}

@Component({
  selector: 'cw-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <nav
      [style.padding]="scrolled() ? '12px 24px' : '20px 24px'"
      [style.background]="scrolled() ? 'rgba(250,248,244,0.95)' : 'transparent'"
      [style.backdrop-filter]="scrolled() ? 'blur(24px)' : 'none'"
      [style.-webkit-backdrop-filter]="scrolled() ? 'blur(24px)' : 'none'"
      [style.border-bottom]="scrolled() ? '1px solid rgba(0,0,0,0.08)' : '1px solid transparent'"
      style="position: fixed; top: 0; left: 0; right: 0; z-index: 80; transition: all 0.4s ease; display: flex; align-items: center; justify-content: space-between;"
    >
      <a routerLink="/" style="text-decoration: none; padding: 0; cursor: pointer;">
        <div style="font-family: var(--ff-serif); font-size: 18px; letter-spacing: 0.18em; color: var(--gold); font-weight: 400;">ELITE</div>
        <div style="font-family: var(--ff-sans); font-size: 8px; letter-spacing: 0.35em; color: var(--muted); text-transform: uppercase; margin-top: 1px;">Arabic Leather Artisans</div>
      </a>

      <div class="desktop-nav" style="display: flex; gap: 36px; align-items: center;">
        @for (l of links; track l.path) {
          <a
            [routerLink]="l.path"
            [routerLinkActiveOptions]="{ exact: !!l.exact }"
            routerLinkActive
            #rla="routerLinkActive"
            style="text-decoration: none; font-family: var(--ff-sans); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 400; transition: color 0.25s; position: relative; padding: 4px 0; cursor: pointer;"
            [style.color]="rla.isActive ? 'var(--gold)' : 'var(--cream-dim)'"
          >
            {{ l.label }}
            @if (rla.isActive) {
              <span style="position: absolute; bottom: -2px; left: 0; right: 0; height: 1px; background: var(--gold);"></span>
            }
          </a>
        }
      </div>

      <div style="display: flex; align-items: center; gap: 20px;">
        <button (click)="cart.openDrawer()" aria-label="Open cart"
          style="background: none; border: none; cursor: pointer; position: relative; padding: 4px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--cream)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <path d="M16 10a4 4 0 01-8 0"/>
          </svg>
          @if (cart.count() > 0) {
            <span style="position: absolute; top: -2px; right: -2px; width: 16px; height: 16px; border-radius: 50%; background: var(--gold); color: var(--bg); font-size: 9px; font-family: var(--ff-sans); font-weight: 500; display: flex; align-items: center; justify-content: center;">
              {{ cart.count() }}
            </span>
          }
        </button>

        <button (click)="menuOpen.set(true)" aria-label="Open menu" class="hamburger-btn"
          style="background: none; border: none; cursor: pointer; padding: 4px; display: flex; flex-direction: column; gap: 5px;">
          <span style="display: block; width: 22px; height: 1px; background: var(--cream);"></span>
          <span style="display: block; width: 14px; height: 1px; background: var(--gold);"></span>
        </button>
      </div>
    </nav>

    @if (menuOpen()) {
      <div class="mobile-menu" style="display: flex; flex-direction: column; padding: 80px 40px 40px;">
        <button (click)="menuOpen.set(false)" aria-label="Close menu"
          style="position: absolute; top: 24px; right: 24px; background: none; border: none; cursor: pointer; color: var(--cream-dim); font-size: 24px; line-height: 1;">×</button>

        <div style="font-family: var(--ff-serif); font-size: 11px; letter-spacing: 0.3em; color: var(--muted); text-transform: uppercase; margin-bottom: 48px;">
          Navigation
        </div>

        @for (l of links; track l.path; let i = $index) {
          <a
            [routerLink]="l.path"
            [routerLinkActiveOptions]="{ exact: !!l.exact }"
            routerLinkActive
            #rla="routerLinkActive"
            (click)="menuOpen.set(false)"
            class="anim-fade-up"
            style="text-decoration: none; font-family: var(--ff-serif); font-size: 48px; font-weight: 300; padding: 8px 0; margin-bottom: 4px; transition: color 0.25s;"
            [style.color]="rla.isActive ? 'var(--gold)' : 'var(--cream)'"
            [style.animation-delay]="(i * 0.08) + 's'"
          >
            {{ l.label }}
          </a>
        }

        <div style="margin-top: auto; border-top: 1px solid var(--border); padding-top: 24px;">
          <p style="font-family: var(--ff-sans); font-size: 11px; letter-spacing: 0.1em; color: var(--muted); text-transform: uppercase;">
            Bespoke Appointments Available
          </p>
        </div>
      </div>
    }
  `,
  styles: [`
    @media (min-width: 768px) { .hamburger-btn { display: none !important; } }
    @media (max-width: 767px) { .desktop-nav { display: none !important; } }
  `],
})
export class NavComponent {
  readonly cart = inject(CartService);
  private readonly router = inject(Router);

  readonly scrolled = signal(false);
  readonly menuOpen = signal(false);

  readonly links: NavLink[] = [
    { path: '/', label: 'Atelier', exact: true },
    { path: '/collection', label: 'Collection' },
    { path: '/story', label: 'Our Story' },
    { path: '/contact', label: 'Contact' },
  ];

  @HostListener('window:scroll')
  onScroll(): void {
    this.scrolled.set(window.scrollY > 40);
  }
}
