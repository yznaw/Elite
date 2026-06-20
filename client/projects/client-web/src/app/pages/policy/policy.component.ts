import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { I18nService } from '../../services/i18n.service';

interface PolicyPage {
  id: string;
  handle: string;
  title: string;
  content: string;
  policyType: string;
  status: 'active' | 'draft';
  updatedAt: string;
}

@Component({
  selector: 'cw-policy',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="policy-page">

      <!-- Breadcrumb -->
      <nav class="policy-breadcrumb" aria-label="Breadcrumb">
        <a routerLink="/" class="bc-link">{{ t('brand.name') }}</a>
        <span class="bc-sep">›</span>
        <span class="bc-current">{{ policy()?.title || '...' }}</span>
      </nav>

      @if (loading()) {
        <div class="policy-skeleton">
          <div class="sk sk-title"></div>
          <div class="sk sk-date"></div>
          <div class="sk sk-body"></div>
          <div class="sk sk-body sk-body-2"></div>
        </div>
      } @else if (error()) {
        <div class="policy-not-found">
          <div class="nf-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="11" x2="12" y2="17"/>
              <line x1="9" y1="14" x2="15" y2="14"/>
            </svg>
          </div>
          <h1>Page Not Found</h1>
          <p>This policy page could not be found or is not yet published.</p>
          <a routerLink="/" class="btn-back">Return Home</a>
        </div>
      } @else {
        @if (policy(); as p) {
          <article class="policy-article">
            <header class="policy-header">
              <h1 class="policy-title">{{ p.title }}</h1>
              <div class="policy-meta">
                Last updated {{ formatDate(p.updatedAt) }}
              </div>
            </header>

            <div class="policy-content" [innerHTML]="p.content"></div>

            <footer class="policy-footer">
              <a routerLink="/" class="footer-home-link">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
                Return to store
              </a>
            </footer>
          </article>
        }
      }
    </div>
  `,
  styles: [`
    .policy-page {
      max-width: 760px;
      margin: 0 auto;
      padding: 40px 24px 80px;
      min-height: 60vh;
    }

    /* ── Breadcrumb ──────────────────────────── */
    .policy-breadcrumb {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 36px;
    }
    .bc-link {
      color: var(--muted);
      text-decoration: none;
      transition: color 0.15s;
    }
    .bc-link:hover { color: var(--green); }
    .bc-sep { opacity: 0.5; }
    .bc-current { color: var(--ink-2); }

    /* ── Article layout ──────────────────────── */
    .policy-article {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
    }

    .policy-header {
      padding: 40px 48px 32px;
      border-bottom: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(26,77,46,0.03), transparent);
    }

    .policy-title {
      font-family: var(--ff-disp);
      font-size: clamp(24px, 4vw, 36px);
      font-weight: 600;
      color: var(--green);
      line-height: 1.2;
      margin: 0 0 12px;
    }

    .policy-meta {
      font-size: 12px;
      color: var(--muted);
    }

    /* ── Content ─────────────────────────────── */
    .policy-content {
      padding: 40px 48px;
      font-size: 14.5px;
      line-height: 1.8;
      color: var(--ink-2);
    }
    .policy-content :global(h2) {
      font-family: var(--ff-disp);
      font-size: 20px;
      font-weight: 600;
      color: var(--ink);
      margin: 32px 0 12px;
    }
    .policy-content :global(h3) {
      font-family: var(--ff-disp);
      font-size: 16px;
      font-weight: 600;
      color: var(--ink);
      margin: 24px 0 8px;
    }
    .policy-content :global(p) { margin: 0 0 14px; }
    .policy-content :global(p:last-child) { margin-bottom: 0; }
    .policy-content :global(ul),
    .policy-content :global(ol) {
      padding-inline-start: 22px;
      margin: 0 0 14px;
    }
    .policy-content :global(li) { margin-bottom: 6px; }
    .policy-content :global(a) {
      color: var(--green);
      text-decoration: underline;
    }
    .policy-content :global(strong) { color: var(--ink); font-weight: 600; }

    /* ── Footer ──────────────────────────────── */
    .policy-footer {
      padding: 20px 48px;
      border-top: 1px solid var(--border);
      background: var(--bg);
    }
    .footer-home-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
      text-decoration: none;
      transition: color 0.15s;
    }
    .footer-home-link:hover { color: var(--green); }

    /* ── Skeleton ────────────────────────────── */
    .policy-skeleton {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 48px;
    }
    .sk {
      border-radius: 6px;
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
      margin-bottom: 14px;
    }
    .sk-title  { height: 36px; width: 60%; }
    .sk-date   { height: 12px; width: 180px; margin-bottom: 32px; }
    .sk-body   { height: 14px; width: 100%; }
    .sk-body-2 { width: 80%; }
    @keyframes shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* ── Not found ───────────────────────────── */
    .policy-not-found {
      text-align: center;
      padding: 80px 24px;
      color: var(--ink-3);
    }
    .nf-icon {
      display: flex; align-items: center; justify-content: center;
      width: 72px; height: 72px;
      background: var(--bg-2);
      border: 1px solid var(--border);
      border-radius: 50%;
      margin: 0 auto 20px;
      color: var(--muted);
    }
    .policy-not-found h1 {
      font-size: 22px; font-weight: 700;
      color: var(--ink); margin: 0 0 10px;
    }
    .policy-not-found p { font-size: 14px; margin: 0 0 20px; }
    .btn-back {
      display: inline-block;
      padding: 10px 22px;
      background: var(--green);
      color: #fff;
      font-size: 13px; font-weight: 600;
      border-radius: 8px;
      text-decoration: none;
      transition: opacity 0.15s;
    }
    .btn-back:hover { opacity: 0.88; }

    /* ── Mobile ──────────────────────────────── */
    @media (max-width: 640px) {
      .policy-page { padding: 24px 16px 60px; }
      .policy-header { padding: 28px 20px 20px; }
      .policy-content { padding: 24px 20px; }
      .policy-footer { padding: 16px 20px; }
    }
  `],
})
export class PolicyComponent implements OnInit {
  private readonly route  = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http   = inject(HttpClient);
  private readonly i18n   = inject(I18nService);

  readonly t = (k: string): string => this.i18n.t(k);

  readonly loading = signal(true);
  readonly error   = signal(false);
  readonly policy  = signal<PolicyPage | null>(null);

  private get apiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || /^192\.168\./.test(hostname);
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
  }

  async ngOnInit(): Promise<void> {
    const handle = this.route.snapshot.paramMap.get('handle') ?? '';
    if (!handle) { this.error.set(true); this.loading.set(false); return; }

    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: PolicyPage }>(`${this.apiBase}/policies/${handle}`),
      );
      this.policy.set(res.data);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }
}
