import { Component, Input, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Nous agency signature badge. The mint accent and Vazirmatn font are the
 * agency's own fixed identity — the same on every client site, not themed
 * per-project. Only the ink color adapts, to stay legible against whichever
 * surface it sits on (light footer vs. the dark green mobile drawer).
 */
@Component({
    selector: 'cw-nous-badge',
    imports: [CommonModule],
    template: `
    <div class="nous-badge nous-badge--{{ placement }}" aria-label="Built by Nous">
      <div class="nous-logo-wrapper">
        <svg class="nous-logo" viewBox="0 0 250 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path class="nous-fill-mint" d="M104.81,52.15c.9,1.25,2.14,2.87,3.73,4.68,1.27,1.45,2.73,2.97,4.95,5.02,4.19,3.87,6.28,5.8,9.43,7.8.43.27,5.73,3.59,11.87,5.15,2.16.55,3.68.7,4.75.75.48.02,2.44.09,4.95-.34,2.28-.39,3.94-1.01,4.48-1.22.92-.36,1.67-.72,2.24-1.02.36.2.87.48,1.49.81,1.2.65,2.24,1.2,3.53,1.83.62.3,1.47.7,2.51,1.15-.21.13-.51.32-.88.54-.7.42-1.99,1.13-4.27,2.03-1.22.48-2.74,1.09-4.82,1.63-3.3.86-6,1.04-7.19,1.09-1.61.07-4.7.17-8.55-.75-2.41-.58-4.06-1.3-6.04-2.17-1.39-.61-4.83-2.2-8.89-5.02-2.66-1.85-4.4-3.41-7.12-5.83-2.75-2.45-4.63-4.39-6.17-5.97-1.42-1.45-2.38-2.5-3.39-3.73-.89-1.08-1.6-2.02-2.1-2.71,1.83-1.24,3.66-2.49,5.49-3.73Z"/>
          <path class="nous-fill-mint" d="M179.32,50.26c-1.58,1.72-2.91,3.15-3.9,4.21-2.77,2.97-3.45,3.63-3.93,4.1-1.37,1.33-2.46,2.27-3.9,3.53-1.38,1.2-2.19,1.78-4,3.36-.78.68-1.42,1.25-1.83,1.63.25.09.64.23,1.11.41,1.68.64,1.92.84,3.06,1.22.26.09.98.32,1.93.54.45.11.85.18,1.15.24.48-.36,1.24-.94,2.14-1.7.96-.8,2.12-1.83,6.1-5.87,3.09-3.13,2.94-3.07,3.83-3.87.47-.42,1.23-1.08,2.17-2.1.75-.81,1.3-1.52,1.66-2-1.87-1.23-3.73-2.46-5.6-3.7Z"/>
          <circle class="nous-fill-mint" cx="133.36" cy="48.08" r="8.29"/>
          <path class="nous-fill-dark" d="M72.32,32.21c-.29-.22-1.29-1.06-3.39-1.76,0,0-1.03-.35-3.66-.54-.04,0-.1,0-.17.02-.09.04-.15.1-.16.11-2.42,2-4.89,3.97-7.07,6.24-3.82,3.99-3.28,2.95-9.02,8.82-3.48,3.56-3.81,4.07-6.24,6.38-1.57,1.49-3.55,3.35-6.38,5.56-2.07,1.62-4.35,3.38-7.66,5.22-3.02,1.68-5.36,2.56-5.97,2.78-1,.37-2.79.81-6.38,1.7-.34.08-.96.23-1.76.2-1.08-.04-1.15-.34-1.63-.27-2.13.31-3.8,6.74-4,6.92,0,0-.05.04-.04.08,0,.05.12.08.15.08,1.53.34,4.28-.03,4.28-.03,1.08-.14.97-.02,2.4-.14,2.85-.24,5.12-.9,6.38-1.27,1.23-.36,5.53-1.7,10.99-4.88,4.07-2.38,6.85-4.65,9.04-6.47,2.84-2.35,4.7-4.21,8.37-7.87,3.55-3.54,5.32-5.31,7.62-7.87,1.92-2.13,3.64-4.17,6.04-6.1.48-.39,1.34-1.06,3.05-2.44,2.32-1.87,2.24-1.85,2.71-2.17.87-.59,1.7-1.26,2.54-1.87.02-.01.12-.04.16-.14,0,0,.03-.08,0-.16-.04-.1-.17-.12-.19-.14Z"/>
          <path class="nous-fill-dark" d="M76.39,22.58c3.25-1.76,4.57-2.17,4.57-2.17,3.34-1.04,5.29-1.65,8.32-2.08,1.84-.26,3.84-.54,6.51-.41,3.12.15,5.45.77,6.96,1.18,1.16.31,3.68,1.06,6.69,2.53,2.79,1.36,4.68,2.71,6.51,4.02,3.57,2.56,6.02,4.93,7.42,6.29,1.67,1.63,3.41,3.5,3.89,4.02.4.44,1.44,1.63,1.58,1.76.07.06.12.15.19.21.03.02.07.05.06.09,0,.04-.05.06-.07.07-.02.01.35-.18-.3.23-.6.38-.9.57-.97.6-.79.42-1.54,1.17-1.72,1.35,0,0-.69.69-1.27,1.55-.07.11-.15.21-.21.32-.06.09-.15.16-.18.26,0,.01-.02.05-.05.06-.03,0-.07-.04-.08-.05-.09-.11-.21-.19-.29-.31-.6-.94-1.5-1.65-2.22-2.5-1.12-1.32-2.58-2.68-3.89-3.89-1.09-1.01-2.38-2.2-4.23-3.62-1.11-.85-2.87-2.18-5.39-3.58-1.24-.69-2.7-1.49-4.78-2.24-1.06-.38-3.03-1.02-5.6-1.39-1.4-.2-3.88-.46-6.92-.17-.55.05-2.72.27-4.61.85,0,0-.86.26-2.54.92-.42.16-.63.24-.68.29-.05.04-.15.14-.25.12-.06-.02-.08-.07-.14-.14-.05-.07-.13-.12-.27-.22-1.18-.84-2.17-1.41-2.17-1.41-.88-.5-1.58-.91-2.34-1.29-.43-.22-1.27-.62-1.53-.75-.15-.07-.15-.08-.21-.1-.11-.04-.17-.04-.18-.08,0-.02,0-.06.13-.16.07-.06.15-.12.22-.17Z"/>
          <path class="nous-fill-dark" d="M142.39,63.31c-.13-.06-2.73-2.79-2.73-2.79-.13-.15-.69-.8-1.18-1.26-.18-.17-.36-.41-.58-.67-.06-.07-.14-.19-.28-.33-.14-.14-.19-.23-.2-.24-.05-.07-.08-.1-.09-.14,0-.04.07-.07.1-.08.15-.06.29-.14.43-.22.18-.1.41-.2.87-.47.4-.24.67-.45,1.09-.77.25-.19.57-.44.96-.8.15-.14.61-.56.88-.92.1-.13.15-.22.29-.4.05-.07.1-.13.16-.22.05-.1.08-.15.1-.19.03-.08.04-.12.07-.13.03,0,.06.03.1.07.06.07.13.12.19.19.07.08.15.15.22.23.16.18,1.14,1.26,1.77,1.93,1.34,1.42,2.12,2.05,2.16,2.08,0,0,.04.04.08.09.03.03.05.05.05.05,0,0,.21.25.24.28.05.07.13.13.16.2.1.22-.68.13-.68.13-.68.4-3.79,4.07-3.89,4.2,0,0-.05.07-.11.11-.01,0-.02.01-.05.03-.03.02-.04.03-.06.03-.02,0-.04,0-.04,0,0,0-.01,0-.02,0,0,0,0,0,0,0Z"/>
          <path class="nous-stroke-dark" d="M8.79,70.64c3.77-8.75,8.14-16.48,11.3-20.93,4.95-6.94,9.86-13.02,17.91-18.72,4.06-2.88,10.23-6.55,18.99-7.05,9.75-.56,17.07,3.37,19.81,4.88,5.27,2.92,8.77,6.5,12.48,10.31,3.02,3.09,6.02,6.72,9.22,10.58,1.94,2.34,3.52,4.31,4.61,5.7"/>
          <path class="nous-stroke-dark" d="M144.49,60.7c1.57,1.65,3.87,3.89,6.92,6.24,2.68,2.07,5.15,3.97,8.82,5.56,1.09.47,5.18,2.17,10.85,2.58,7.19.52,12.64-1.35,15.33-2.31,5.17-1.83,8.73-4.27,10.99-5.83,3.12-2.16,5.26-4.15,7.05-5.83,2.08-1.95,5-4.71,8-8.82,1.7-2.32,1.24-2.08,4.88-7.73,2.26-3.5,3.7-5.73,5.83-8.55,2.09-2.76,3.6-4.77,6.1-7.19,2.03-1.97,4.05-3.89,7.19-5.56,2.75-1.46,4.81-1.91,4.75-2.17-.13-.5-7.92,1.09-9.22,1.36-6.89,1.4-10.34,2.11-13.7,3.26-6.95,2.38-11.8,5.43-15.19,7.6-1.26.81-6.47,4.18-12.48,9.77-4.18,3.88-7.4,7.58-9.77,10.58"/>
        </svg>

        <button
          type="button"
          class="nous-badge__copy"
          [attr.aria-label]="'Copy domain'"
          (click)="copyDomain()"
        >{{ copied() ? 'copied!' : 'nous.qa' }}</button>
      </div>

      <span class="nous-badge__sep" aria-hidden="true"></span>

      <span class="nous-badge__text">
        <span class="nous-badge__arabic" dir="rtl">صُنع بإحسان، من <strong class="nous-name">نُوس</strong></span>
        <span class="nous-badge__english">An <strong class="nous-name">Nous</strong> Masterpiece</span>
      </span>
    </div>
  `,
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [`
    .nous-badge {
      --nous-mint: #5FB89A;
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 7px;
      text-decoration: none;
      border-radius: 10px;
      padding: 6px 10px;
      box-shadow: 0 0 0 1px rgba(95, 184, 154, 0.20);
    }

    .nous-fill-mint   { fill: var(--nous-mint); }
    .nous-fill-dark   { fill: var(--nous-dark); }
    .nous-stroke-dark {
      fill: none;
      stroke: var(--nous-dark);
      stroke-width: 6.64px;
      stroke-linecap: round;
      stroke-miterlimit: 10;
    }

    .nous-logo-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .nous-logo { display: block; flex-shrink: 0; }

    .nous-badge__copy {
      background: transparent;
      border: none;
      padding: 0;
      margin: 0;
      font-family: 'Vazirmatn', sans-serif;
      font-weight: 500;
      text-transform: lowercase;
      letter-spacing: 1.5px;
      text-align: center;
      color: var(--nous-mint);
      cursor: pointer;
      transition: opacity 0.2s ease, transform 0.1s ease;
    }

    @media (hover: hover) and (pointer: fine) {
      .nous-badge__copy:hover { opacity: 0.65; }
    }

    .nous-badge__copy:active { transform: scale(0.92); }

    .nous-badge__sep {
      background: rgba(95, 184, 154, 0.55);
      border-radius: 1px;
      flex-shrink: 0;
      display: block;
    }

    .nous-badge__text {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
    }

    .nous-badge__arabic {
      font-family: 'Vazirmatn', sans-serif;
      font-weight: 500;
      text-align: center;
      line-height: 1.6;
      color: var(--nous-dark);
      direction: rtl;
    }

    .nous-badge__english {
      font-family: 'Vazirmatn', sans-serif;
      font-weight: 300;
      text-transform: uppercase;
      letter-spacing: 2.5px;
      text-align: center;
      color: var(--nous-dark);
      direction: ltr;
    }

    .nous-name {
      color: var(--nous-mint);
      font-weight: 700;
      font-style: normal;
    }

    /* ── Footer placement: light surface, Elite's real ink ── */
    .nous-badge--footer {
      --nous-dark: var(--cream, #1a1208);
      flex-direction: row;
      align-items: center;
      gap: 13px;
    }
    .nous-badge--footer .nous-logo         { width: 44px; }
    .nous-badge--footer .nous-badge__sep   { width: 1px; height: 30px; }
    .nous-badge--footer .nous-badge__text  { align-items: flex-start; gap: 2px; }
    .nous-badge--footer .nous-badge__arabic  { font-size: 10.5px; }
    .nous-badge--footer .nous-badge__english { font-size: 7.5px; }
    .nous-badge--footer .nous-badge__copy    { font-size: 6.5px; }

    @media (min-width: 561px) {
      .nous-badge--footer .nous-logo         { width: 52px; }
      .nous-badge--footer .nous-badge__sep   { height: 34px; }
      .nous-badge--footer .nous-badge__arabic  { font-size: 12px; }
      .nous-badge--footer .nous-badge__english { font-size: 8.5px; }
      .nous-badge--footer .nous-badge__copy    { font-size: 7.5px; }
    }

    /* ── Drawer placement: dark green surface, light ink ── */
    .nous-badge--drawer {
      --nous-dark: rgba(255, 250, 240, 0.92);
      flex-direction: row;
      align-items: center;
      gap: 11px;
      box-shadow: 0 0 0 1px rgba(95, 184, 154, 0.30);
    }
    .nous-badge--drawer .nous-logo         { width: 34px; }
    .nous-badge--drawer .nous-badge__sep   { width: 1px; height: 26px; background: rgba(95, 184, 154, 0.45); }
    .nous-badge--drawer .nous-badge__text  { align-items: flex-start; gap: 2px; }
    .nous-badge--drawer .nous-badge__arabic  { font-size: 9.5px; }
    .nous-badge--drawer .nous-badge__english { font-size: 7px; letter-spacing: 2px; }
    .nous-badge--drawer .nous-badge__copy    { font-size: 6.5px; }
  `]
})
export class NousBadgeComponent {
  @Input() placement: 'footer' | 'drawer' = 'footer';

  readonly copied = signal(false);
  private copyResetTimer?: ReturnType<typeof setTimeout>;

  copyDomain(): void {
    navigator.clipboard.writeText('nous.qa');
    this.copied.set(true);
    clearTimeout(this.copyResetTimer);
    this.copyResetTimer = setTimeout(() => this.copied.set(false), 1500);
  }
}
