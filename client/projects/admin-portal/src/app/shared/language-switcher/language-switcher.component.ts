import { Component, HostListener, ElementRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LocaleService, Locale } from '../../services/locale.service';
import { I18nService } from '../../services/i18n.service';

@Component({
  selector: 'ap-language-switcher',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="lang-switch" #root>
      <button class="lang-trigger" (click)="toggleOpen()" [attr.aria-label]="i18n.t('topbar.language')" [attr.aria-expanded]="open()">
        <span class="lang-code">{{ locale.locale().toUpperCase() }}</span>
        <span class="lang-globe" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/>
          </svg>
        </span>
      </button>
      @if (open()) {
        <div class="lang-menu" role="menu">
          @for (l of options; track l.code) {
            <button
              class="lang-option"
              [class.active]="locale.locale() === l.code"
              (click)="select(l.code)"
              role="menuitemradio"
              [attr.aria-checked]="locale.locale() === l.code"
            >
              <span>{{ l.label }}</span>
              @if (locale.locale() === l.code) {
                <span class="lang-check">✓</span>
              }
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .lang-switch { position: relative; }
    .lang-trigger {
      display: inline-flex; align-items: center; gap: 6px;
      height: 36px;
      padding: 0 10px;
      background: none;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--ink-2);
      font: inherit;
      font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
      cursor: pointer;
      transition: all 0.15s;
    }
    .lang-trigger:hover { background: var(--bg); border-color: rgba(2, 70, 56, 0.18); color: var(--ink); }
    .lang-code { line-height: 1; }
    .lang-globe { display: inline-flex; color: var(--muted); }

    .lang-menu {
      position: absolute;
      top: calc(100% + 6px);
      inset-inline-end: 0;
      min-width: 160px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: var(--shadow-lg);
      padding: 6px;
      z-index: 50;
      animation: fadeIn 0.15s ease;
    }
    .lang-option {
      display: flex; align-items: center; justify-content: space-between;
      width: 100%;
      padding: 9px 12px;
      background: none; border: none;
      border-radius: 6px;
      cursor: pointer;
      color: var(--ink-2);
      font: inherit; font-size: 13px;
      text-align: start;
      transition: background 0.12s;
    }
    .lang-option:hover { background: var(--bg); color: var(--ink); }
    .lang-option.active { background: var(--gold-3); color: var(--green); font-weight: 600; }
    .lang-check { color: var(--gold); font-weight: 700; }
  `],
})
export class LanguageSwitcherComponent {
  readonly locale = inject(LocaleService);
  readonly i18n = inject(I18nService);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly open = signal(false);
  readonly options: { code: Locale; label: string }[] = [
    { code: 'en', label: 'English' },
    { code: 'ar', label: 'العربية' },
  ];

  toggleOpen(): void {
    this.open.update((o) => !o);
  }

  select(code: Locale): void {
    this.locale.set(code);
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (!this.open()) return;
    if (!this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  @HostListener('window:keydown.escape')
  onEsc(): void { this.open.set(false); }
}
