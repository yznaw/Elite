import { Component, HostListener, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CartService } from '../../services/cart.service';
import { I18nService } from '../../services/i18n.service';
import { Locale, LocaleService } from '../../services/locale.service';

interface NavLink {
  path: string;
  labelKey: string;
  exact?: boolean;
}

@Component({
  selector: 'cw-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <nav class="nav-shell" [class.is-scrolled]="scrolled()" [attr.aria-label]="t('nav.menu')">
      <a routerLink="/" class="brand-link" [attr.aria-label]="t('brand.name')">
        <span class="brand-mark">{{ t('brand.name') }}</span>
        <span class="brand-subtitle">{{ t('brand.tagline') }}</span>
      </a>

      <div class="desktop-nav" [attr.aria-label]="t('nav.menu')">
        @for (l of links; track l.path) {
          <a
            [routerLink]="l.path"
            [routerLinkActiveOptions]="{ exact: !!l.exact }"
            routerLinkActive
            #rla="routerLinkActive"
            class="nav-link"
            [class.is-active]="rla.isActive"
          >
            {{ t(l.labelKey) }}
          </a>
        }
      </div>

      <div class="nav-actions">
        <div class="lang-switch" [attr.aria-label]="t('nav.language')">
          <button type="button" [class.active]="locale.locale() === 'en'" (click)="setLocale('en')">
            EN
          </button>
          <button type="button" [class.active]="locale.locale() === 'ar'" (click)="setLocale('ar')">
            عربي
          </button>
        </div>

        <button type="button" class="icon-btn cart-btn" (click)="cart.openDrawer()" [attr.aria-label]="t('nav.cart')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
          @if (cart.count() > 0) {
            <span class="cart-count">{{ cart.count() }}</span>
          }
        </button>

        <button type="button" class="icon-btn menu-btn" (click)="menuOpen.set(true)" [attr.aria-label]="t('nav.openMenu')">
          <span></span>
          <span></span>
        </button>
      </div>
    </nav>

    @if (menuOpen()) {
      <div class="mobile-menu">
        <button type="button" class="mobile-close" (click)="menuOpen.set(false)" [attr.aria-label]="t('nav.closeMenu')">×</button>

        <div class="mobile-kicker">{{ t('nav.menu') }}</div>

        @for (l of links; track l.path; let i = $index) {
          <a
            [routerLink]="l.path"
            [routerLinkActiveOptions]="{ exact: !!l.exact }"
            routerLinkActive
            #rla="routerLinkActive"
            (click)="menuOpen.set(false)"
            class="mobile-link anim-fade-up"
            [class.is-active]="rla.isActive"
            [style.animation-delay]="(i * 0.08) + 's'"
          >
            {{ t(l.labelKey) }}
          </a>
        }

        <div class="mobile-lang">
          <button type="button" [class.active]="locale.locale() === 'en'" (click)="setLocale('en')">
            {{ t('nav.lang.en') }}
          </button>
          <button type="button" [class.active]="locale.locale() === 'ar'" (click)="setLocale('ar')">
            {{ t('nav.lang.ar') }}
          </button>
        </div>

        <div class="mobile-footer">
          <p>{{ t('nav.bespokeAvailable') }}</p>
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      position: relative;
      z-index: 80;
    }

    .nav-shell {
      position: fixed;
      top: 18px;
      left: 50%;
      z-index: 80;
      width: min(1180px, calc(100vw - 32px));
      min-height: 66px;
      display: grid;
      grid-template-columns: minmax(178px, 0.84fr) auto minmax(92px, 0.84fr);
      align-items: center;
      gap: 22px;
      padding: 10px 12px 10px 24px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 999px;
      background: #004538;
      box-shadow: 0 20px 52px rgba(3, 99, 80, 0.22), 0 2px 0 rgba(255, 255, 255, 0.1) inset;
      transform: translateX(-50%);
      transition: min-height 0.28s ease, padding 0.28s ease, top 0.28s ease, box-shadow 0.28s ease;
      backdrop-filter: blur(22px) saturate(130%);
      -webkit-backdrop-filter: blur(22px) saturate(130%);
    }

    .nav-shell.is-scrolled {
      top: 12px;
      min-height: 58px;
      padding-top: 8px;
      padding-bottom: 8px;
      box-shadow: 0 16px 42px rgba(3, 99, 80, 0.26), 0 1px 0 rgba(255, 255, 255, 0.11) inset;
    }

    .brand-link {
      display: inline-flex;
      flex-direction: column;
      justify-self: start;
      min-width: 0;
      text-decoration: none;
    }

    .brand-mark {
      color: #fffaf0;
      font-family: var(--ff-serif);
      font-size: 18px;
      font-weight: 400;
      line-height: 1;
      letter-spacing: 0.18em;
    }

    .brand-subtitle {
      margin-top: 4px;
      color: rgba(255, 250, 240, 0.62);
      font-family: var(--ff-sans);
      font-size: 8px;
      line-height: 1;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .desktop-nav {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 5px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 999px;
      background: rgba(1, 55, 45, 0.28);
    }

    .nav-link {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 36px;
      padding: 0 15px;
      border-radius: 999px;
      color: rgba(255, 250, 240, 0.78);
      font-family: var(--ff-sans);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.16em;
      text-decoration: none;
      text-transform: uppercase;
      transition: background 0.24s ease, color 0.24s ease, transform 0.24s ease;
      white-space: nowrap;
    }

    .nav-link:hover,
    .nav-link.is-active {
      background: rgba(255, 250, 240, 0.13);
      color: #fffaf0;
    }

    .nav-link:hover {
      transform: translateY(-1px);
    }

    .nav-actions {
      display: inline-flex;
      align-items: center;
      justify-self: end;
      gap: 8px;
    }

    .lang-switch,
    .mobile-lang {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 999px;
      background: rgba(255, 250, 240, 0.08);
    }

    .lang-switch button,
    .mobile-lang button {
      min-width: 38px;
      min-height: 32px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: rgba(255, 250, 240, 0.7);
      cursor: pointer;
      font-family: var(--ff-sans);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0;
      transition: background 0.24s ease, color 0.24s ease;
    }

    .lang-switch button.active,
    .mobile-lang button.active {
      background: rgba(255, 250, 240, 0.16);
      color: #fffaf0;
    }

    .icon-btn {
      position: relative;
      width: 42px;
      height: 42px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 50%;
      background: rgba(255, 250, 240, 0.1);
      color: #fffaf0;
      cursor: pointer;
      transition: background 0.24s ease, border-color 0.24s ease, transform 0.24s ease;
    }

    .icon-btn:hover {
      border-color: rgba(255, 250, 240, 0.38);
      background: rgba(255, 250, 240, 0.17);
      transform: translateY(-1px);
    }

    .cart-btn svg {
      stroke: currentColor;
      stroke-width: 1.55;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .cart-count {
      position: absolute;
      top: -3px;
      right: -3px;
      min-width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
      border: 2px solid var(--green-2, #036350);
      border-radius: 999px;
      background: var(--gold);
      color: #1a1208;
      font-family: var(--ff-sans);
      font-size: 9px;
      font-weight: 700;
      line-height: 1;
    }

    .menu-btn {
      display: none;
      flex-direction: column;
      gap: 5px;
    }

    .menu-btn span {
      display: block;
      width: 18px;
      height: 1px;
      background: currentColor;
    }

    .menu-btn span:last-child {
      width: 12px;
      margin-left: 6px;
      background: var(--gold);
    }

    .mobile-menu {
      position: fixed;
      inset: 10px;
      z-index: 90;
      display: flex;
      flex-direction: column;
      padding: 78px 28px 28px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 24px;
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.11), transparent 46%),
        var(--green-2, #004538);
      box-shadow: 0 24px 70px rgba(3, 99, 80, 0.28);
      animation: fadeIn 0.24s ease;
    }

    .mobile-close {
      position: absolute;
      top: 18px;
      right: 18px;
      width: 42px;
      height: 42px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 50%;
      background: rgba(255, 250, 240, 0.1);
      color: #fffaf0;
      cursor: pointer;
      font-size: 25px;
      line-height: 1;
    }

    .mobile-kicker {
      margin-bottom: 36px;
      color: rgba(255, 250, 240, 0.58);
      font-family: var(--ff-sans);
      font-size: 10px;
      letter-spacing: 0.32em;
      text-transform: uppercase;
    }

    .mobile-link {
      padding: 8px 0;
      color: rgba(255, 250, 240, 0.78);
      font-family: var(--ff-serif);
      font-size: clamp(40px, 13vw, 64px);
      font-weight: 300;
      line-height: 1;
      letter-spacing: 0;
      text-decoration: none;
      transition: color 0.24s ease, transform 0.24s ease;
    }

    .mobile-link.is-active {
      color: #fffaf0;
    }

    .mobile-link:hover {
      transform: translateX(4px);
    }

    .mobile-footer {
      margin-top: auto;
      padding-top: 22px;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
    }

    .mobile-footer p {
      color: rgba(255, 250, 240, 0.68);
      font-family: var(--ff-sans);
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    .mobile-lang {
      align-self: flex-start;
      margin-top: 28px;
    }

    @media (max-width: 920px) {
      .nav-shell {
        grid-template-columns: 1fr auto;
      }

      .desktop-nav {
        display: none;
      }

      .lang-switch {
        display: none;
      }

      .menu-btn {
        display: inline-flex;
      }
    }

    @media (max-width: 560px) {
      .nav-shell {
        top: 10px;
        width: calc(100vw - 20px);
        min-height: 60px;
        padding: 8px 9px 8px 18px;
        gap: 12px;
      }

      .nav-shell.is-scrolled {
        top: 8px;
      }

      .brand-mark {
        font-size: 17px;
      }

      .brand-subtitle {
        max-width: 150px;
        overflow: hidden;
        letter-spacing: 0.22em;
        text-overflow: ellipsis;
      }

      .icon-btn {
        width: 40px;
        height: 40px;
      }
    }
  `],
})
export class NavComponent {
  readonly cart = inject(CartService);
  readonly locale = inject(LocaleService);
  private readonly i18n = inject(I18nService);
  readonly t = (key: string): string => this.i18n.t(key);

  readonly scrolled = signal(false);
  readonly menuOpen = signal(false);

  readonly links: NavLink[] = [
    { path: '/', labelKey: 'nav.atelier', exact: true },
    { path: '/collection', labelKey: 'nav.collection' },
    { path: '/story', labelKey: 'nav.story' },
    { path: '/contact', labelKey: 'nav.contact' },
  ];

  setLocale(next: Locale): void {
    this.locale.set(next);
  }

  @HostListener('window:scroll')
  onScroll(): void {
    this.scrolled.set(window.scrollY > 40);
  }
}
