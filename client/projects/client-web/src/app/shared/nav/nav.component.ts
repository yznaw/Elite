import { Component, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Product } from '../../models/product.model';
import { CartService } from '../../services/cart.service';
import { I18nService } from '../../services/i18n.service';
import { Locale, LocaleService } from '../../services/locale.service';
import { ProductsService } from '../../services/products.service';

interface NavLink {
  path: string;
  labelKey: string;
  exact?: boolean;
}

const FALLBACK_SEARCH_IMAGE =
  'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80&auto=format&fit=crop';

@Component({
  selector: 'cw-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <nav class="nav-shell" [class.is-scrolled]="scrolled()" [attr.aria-label]="t('nav.menu')">
      <a routerLink="/" class="brand-link" [attr.aria-label]="t('brand.name')">
        <span class="brand-logo-wrap">
          <img class="brand-logo" src="assets/brand/elite-logo-cream.png" [alt]="t('brand.name')" />
        </span>
        <span class="brand-copy">
          <span class="brand-subtitle">{{ t('brand.tagline') }}</span>
        </span>
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
        <div class="search-wrap" [class.is-open]="searchOpen()">
          <button
            type="button"
            class="icon-btn search-btn"
            (click)="toggleSearch()"
            [attr.aria-label]="t('nav.search')"
            [attr.aria-expanded]="searchOpen()"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.6-3.6" />
            </svg>
          </button>

          @if (searchOpen()) {
            <section class="search-panel" [attr.aria-label]="t('nav.search')">
              <label class="search-field">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.6-3.6" />
                </svg>
                <input
                  type="search"
                  autocomplete="off"
                  [value]="searchQuery()"
                  (input)="setSearchQuery($event)"
                  (keydown.escape)="closeSearch()"
                  [placeholder]="t('nav.searchPlaceholder')"
                  [attr.aria-label]="t('nav.searchPlaceholder')"
                />
              </label>

              <div class="search-body">
                @if (hasSearchQuery()) {
                  @if (searchResults().length > 0) {
                    <p class="search-kicker">{{ searchResults().length }} {{ t('nav.searchResults') }}</p>
                    <div class="search-results">
                      @for (item of searchResults(); track item.id) {
                        <button type="button" class="search-result" (click)="selectSearchResult(item)">
                          <span class="search-thumb">
                            <img [src]="item.image" alt="" (error)="onSearchImgError($event)" />
                          </span>
                          <span class="search-copy">
                            <span class="search-name">{{ productName(item) }}</span>
                            <span class="search-meta">{{ productStyle(item.style) }} · {{ productLeather(item.leather) }}</span>
                          </span>
                          <span class="search-price">{{ price(item.price) }}</span>
                        </button>
                      }
                    </div>
                  } @else {
                    <div class="search-empty">
                      <p>{{ t('nav.searchEmpty') }}</p>
                    </div>
                  }
                } @else {
                  <div class="search-empty">
                    <p>{{ t('nav.searchHint') }}</p>
                  </div>
                }
              </div>
            </section>
          }
        </div>

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

        <a routerLink="/" class="mobile-brand" (click)="menuOpen.set(false)" [attr.aria-label]="t('brand.name')">
          <img src="assets/brand/elite-logo-cream.png" [alt]="t('brand.name')" />
          <span>{{ t('brand.tagline') }}</span>
        </a>

        <section class="mobile-search" [attr.aria-label]="t('nav.search')">
          <label class="mobile-search-field">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.6-3.6" />
            </svg>
            <input
              type="search"
              autocomplete="off"
              [value]="searchQuery()"
              (input)="setSearchQuery($event)"
              [placeholder]="t('nav.searchPlaceholder')"
              [attr.aria-label]="t('nav.searchPlaceholder')"
            />
          </label>

          @if (hasSearchQuery()) {
            <div class="mobile-search-results">
              @for (item of searchResults(); track item.id) {
                <button type="button" class="mobile-search-result" (click)="selectSearchResult(item)">
                  <span>{{ productName(item) }}</span>
                  <small>{{ productStyle(item.style) }} · {{ price(item.price) }}</small>
                </button>
              } @empty {
                <p>{{ t('nav.searchEmpty') }}</p>
              }
            </div>
          }
        </section>

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
      grid-template-columns: minmax(248px, 0.9fr) auto minmax(92px, 0.9fr);
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
      align-items: center;
      gap: 13px;
      justify-self: start;
      min-width: 0;
      text-decoration: none;
    }

    .brand-logo-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
      width: 92px;
      min-height: 40px;
    }

    .brand-logo {
      display: block;
      width: 100%;
      height: auto;
      filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.12));
    }

    .brand-copy {
      display: inline-flex;
      align-items: center;
      min-width: 0;
      padding-left: 13px;
      border-left: 1px solid rgba(255, 250, 240, 0.2);
    }

    .brand-subtitle {
      color: rgba(255, 250, 240, 0.62);
      font-family: var(--ff-sans);
      font-size: 8px;
      line-height: 1;
      letter-spacing: 0;
      text-transform: uppercase;
      white-space: nowrap;
    }

    :host-context(html[dir='rtl']) .brand-copy {
      padding-right: 13px;
      padding-left: 0;
      border-right: 1px solid rgba(255, 250, 240, 0.2);
      border-left: 0;
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

    .search-wrap {
      position: relative;
      display: inline-flex;
    }

    .search-btn svg,
    .search-field svg,
    .mobile-search-field svg {
      stroke: currentColor;
      stroke-width: 1.65;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .search-panel {
      position: absolute;
      top: calc(100% + 14px);
      right: 0;
      width: min(420px, calc(100vw - 32px));
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 22px;
      background:
        linear-gradient(145deg, rgba(255, 255, 255, 0.11), transparent 44%),
        rgba(0, 69, 56, 0.98);
      box-shadow: 0 28px 70px rgba(3, 47, 39, 0.34);
      animation: searchReveal 0.2s ease;
    }

    :host-context(html[dir='rtl']) .search-panel {
      right: auto;
      left: 0;
    }

    .search-field,
    .mobile-search-field {
      display: flex;
      align-items: center;
      gap: 10px;
      color: rgba(255, 250, 240, 0.7);
    }

    .search-field {
      margin: 12px;
      padding: 0 14px;
      min-height: 48px;
      border: 1px solid rgba(255, 250, 240, 0.16);
      border-radius: 999px;
      background: rgba(1, 55, 45, 0.5);
    }

    .search-field input,
    .mobile-search-field input {
      width: 100%;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: #fffaf0;
      font-family: var(--ff-sans);
      font-size: 13px;
      letter-spacing: 0;
    }

    .search-field input::placeholder,
    .mobile-search-field input::placeholder {
      color: rgba(255, 250, 240, 0.45);
    }

    .search-field input::-webkit-search-cancel-button,
    .mobile-search-field input::-webkit-search-cancel-button {
      filter: invert(1);
      opacity: 0.55;
    }

    .search-body {
      padding: 2px 12px 12px;
    }

    .search-kicker {
      margin: 0 4px 9px;
      color: rgba(255, 250, 240, 0.5);
      font-family: var(--ff-sans);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }

    .search-results {
      display: grid;
      gap: 6px;
      max-height: 390px;
      overflow: auto;
      padding-right: 2px;
    }

    .search-result {
      width: 100%;
      min-height: 76px;
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      padding: 9px;
      border: 1px solid transparent;
      border-radius: 16px;
      background: rgba(255, 250, 240, 0.07);
      color: #fffaf0;
      cursor: pointer;
      text-align: start;
      transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
    }

    .search-result:hover,
    .search-result:focus-visible {
      border-color: rgba(211, 166, 72, 0.38);
      background: rgba(255, 250, 240, 0.12);
      transform: translateY(-1px);
      outline: 0;
    }

    .search-thumb {
      width: 56px;
      height: 58px;
      overflow: hidden;
      border-radius: 13px;
      background: rgba(255, 250, 240, 0.1);
    }

    .search-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .search-copy {
      min-width: 0;
      display: grid;
      gap: 5px;
    }

    .search-name {
      overflow: hidden;
      color: #fffaf0;
      font-family: var(--ff-serif);
      font-size: 17px;
      line-height: 1.08;
      letter-spacing: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .search-meta,
    .search-price {
      color: rgba(255, 250, 240, 0.58);
      font-family: var(--ff-sans);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .search-price {
      color: var(--gold);
      white-space: nowrap;
    }

    .search-empty {
      min-height: 96px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
      border: 1px dashed rgba(255, 250, 240, 0.16);
      border-radius: 16px;
      background: rgba(255, 250, 240, 0.05);
      text-align: center;
    }

    .search-empty p {
      margin: 0;
      color: rgba(255, 250, 240, 0.58);
      font-family: var(--ff-sans);
      font-size: 12px;
      line-height: 1.55;
      letter-spacing: 0;
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

    .mobile-brand {
      width: fit-content;
      display: inline-flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 34px;
      text-decoration: none;
    }

    .mobile-brand img {
      width: 112px;
      height: auto;
      filter: drop-shadow(0 10px 22px rgba(0, 0, 0, 0.13));
    }

    .mobile-brand span {
      color: rgba(255, 250, 240, 0.58);
      font-family: var(--ff-sans);
      font-size: 10px;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .mobile-search {
      display: grid;
      gap: 10px;
      margin: -10px 0 26px;
    }

    .mobile-search-field {
      min-height: 50px;
      padding: 0 15px;
      border: 1px solid rgba(255, 250, 240, 0.16);
      border-radius: 999px;
      background: rgba(255, 250, 240, 0.08);
    }

    .mobile-search-results {
      display: grid;
      gap: 7px;
      max-height: min(245px, 32vh);
      overflow: auto;
    }

    .mobile-search-result {
      display: grid;
      gap: 4px;
      padding: 12px 14px;
      border: 1px solid rgba(255, 250, 240, 0.1);
      border-radius: 16px;
      background: rgba(255, 250, 240, 0.07);
      color: #fffaf0;
      cursor: pointer;
      text-align: start;
    }

    .mobile-search-result span {
      font-family: var(--ff-serif);
      font-size: 20px;
      line-height: 1.1;
    }

    .mobile-search-result small,
    .mobile-search-results p {
      margin: 0;
      color: rgba(255, 250, 240, 0.58);
      font-family: var(--ff-sans);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .mobile-link {
      padding: 8px 0 25px;
      color: rgba(255, 250, 240, 0.78);
      font-family: var(--ff-serif);
      font-size: clamp(35px, 7vw, 64px);
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

      .search-panel {
        display: none;
      }

      .menu-btn {
        display: inline-flex;
      }

      .brand-copy {
        display: none;
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

      .brand-logo-wrap {
        width: 82px;
        min-height: 36px;
      }

      .brand-link {
        gap: 10px;
      }

      .icon-btn {
        width: 40px;
        height: 40px;
      }
    }

    @keyframes searchReveal {
      from {
        opacity: 0;
        transform: translateY(-8px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `],
})
export class NavComponent {
  readonly cart = inject(CartService);
  readonly locale = inject(LocaleService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly i18n = inject(I18nService);
  private readonly products = inject(ProductsService);
  private readonly router = inject(Router);
  readonly t = (key: string): string => this.i18n.t(key);
  readonly price = (value: number): string => this.i18n.price(value);
  readonly productName = (product: Product): string => this.i18n.productName(product);
  readonly productLeather = (value: string): string => this.i18n.productLeather(value);
  readonly productStyle = (value: string): string => this.i18n.productStyle(value);

  readonly scrolled = signal(false);
  readonly menuOpen = signal(false);
  readonly searchOpen = signal(false);
  readonly searchQuery = signal('');

  readonly hasSearchQuery = computed(() => this.searchQuery().trim().length > 0);
  readonly searchResults = computed<Product[]>(() => {
    const query = this.normalize(this.searchQuery());
    if (!query) return [];

    const terms = query.split(/\s+/).filter(Boolean);
    return this.products.getAll()
      .map((product) => ({
        product,
        text: this.searchText(product),
      }))
      .filter(({ text }) => terms.every((term) => text.includes(term)))
      .sort((a, b) => this.searchRank(a.product, query) - this.searchRank(b.product, query))
      .slice(0, 6)
      .map(({ product }) => product);
  });

  readonly links: NavLink[] = [
    { path: '/', labelKey: 'nav.atelier', exact: true },
    { path: '/collection', labelKey: 'nav.collection' },
    { path: '/story', labelKey: 'nav.story' },
    { path: '/contact', labelKey: 'nav.contact' },
  ];

  setLocale(next: Locale): void {
    this.locale.set(next);
  }

  toggleSearch(): void {
    this.searchOpen.update((open) => !open);
    this.menuOpen.set(false);
    if (!this.searchOpen()) return;

    void this.products.ensureLoaded();
    window.setTimeout(() => {
      this.host.nativeElement.querySelector<HTMLInputElement>('.search-field input')?.focus();
    });
  }

  closeSearch(): void {
    this.searchOpen.set(false);
  }

  setSearchQuery(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  selectSearchResult(product: Product): void {
    this.searchOpen.set(false);
    this.menuOpen.set(false);
    this.searchQuery.set('');
    void this.router.navigate(['/product', product.id]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  onSearchImgError(event: Event): void {
    const image = event.target as HTMLImageElement;
    if (image.src === FALLBACK_SEARCH_IMAGE) return;
    image.src = FALLBACK_SEARCH_IMAGE;
  }

  @HostListener('window:scroll')
  onScroll(): void {
    this.scrolled.set(window.scrollY > 40);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.searchOpen()) return;
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.closeSearch();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeSearch();
  }

  private searchText(product: Product): string {
    return this.normalize([
      this.i18n.productName(product),
      product.name,
      this.i18n.productLeather(product.leather),
      product.leather,
      this.i18n.productStyle(product.style),
      product.style,
      this.i18n.productTag(product.tag),
      product.tag,
      product.brand,
      product.category,
      ...(product.categories || []),
      product.color,
      ...(product.colors || []),
      product.material,
      ...(product.materials || []),
      product.price,
    ].filter(Boolean).join(' '));
  }

  private searchRank(product: Product, query: string): number {
    const name = this.normalize(`${this.i18n.productName(product)} ${product.name}`);
    if (name.startsWith(query)) return 0;
    if (name.includes(query)) return 1;
    return 2;
  }

  private normalize(value: unknown): string {
    return String(value ?? '')
      .toLocaleLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }
}
