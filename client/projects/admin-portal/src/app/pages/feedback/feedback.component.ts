import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IconComponent } from '../../shared/icons/icon.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { ApiClient } from '../../services/api-client.service';
import { I18nService } from '../../services/i18n.service';

interface FeedbackProduct {
  productId:     string;
  productName:   string;
  productNameAr: string;
  productImage:  string;
  reviewCount:   number;
  avgRating:     number | null;
  latestAt:      string;
}

interface FeedbackSummary {
  totalReviews: number;
  avgRating:    number | null;
  productCount: number;
}

@Component({
  selector: 'ap-feedback',
  standalone: true,
  imports: [CommonModule, IconComponent, EmptyStateComponent],
  template: `
    <div class="page-fade">

      <!-- Header -->
      <div class="fb-header">
        <div>
          <h1 class="fb-title">{{ t('nav.feedback') }}</h1>
          <p class="fb-sub">Private — collected from storefront visitors and in-store kiosk. Never shown publicly.</p>
        </div>
        <a [href]="kioskBaseUrl" target="_blank" rel="noopener noreferrer" class="fb-kiosk-btn">
          <ap-icon name="phone" [size]="13"/>
          Open Kiosk
        </a>
      </div>

      <!-- Stats row -->
      @if (!loading() && products().length > 0) {
        <div class="fb-stats">
          <div class="card card-pad fb-stat">
            <div class="fb-stat-val">{{ summary().totalReviews }}</div>
            <div class="fb-stat-lbl">Total Reviews</div>
          </div>
          <div class="card card-pad fb-stat">
            <div class="fb-stat-val fb-avg">
              @if (summary().avgRating) {
                ★ {{ summary().avgRating | number:'1.1-1' }}
              } @else {
                —
              }
            </div>
            <div class="fb-stat-lbl">Average Rating</div>
          </div>
          <div class="card card-pad fb-stat">
            <div class="fb-stat-val">{{ summary().productCount }}</div>
            <div class="fb-stat-lbl">Products with Feedback</div>
          </div>
        </div>
      }

      <!-- Loading -->
      @if (loading()) {
        <div class="card">
          @for (_ of [1,2,3]; track $index) {
            <div class="fb-skeleton-row">
              <div class="fb-skeleton-img"></div>
              <div class="fb-skeleton-lines">
                <div class="fb-skeleton-line wide"></div>
                <div class="fb-skeleton-line narrow"></div>
              </div>
            </div>
          }
        </div>
      }

      <!-- Empty -->
      @if (!loading() && products().length === 0) {
        <div class="card">
          <ap-empty-state icon="star" title="No feedback yet" sub="Feedback submitted through the storefront or in-store kiosk will appear here."/>
        </div>
      }

      <!-- Product list -->
      @if (!loading() && products().length > 0) {
        <div class="card">
          <div class="card-header">
            <div class="card-title">Products with Feedback</div>
            <div class="muted small">Click a product to see its reviews</div>
          </div>
          @for (p of products(); track p.productId) {
            <button class="fb-row" type="button" (click)="openDetail(p.productId)">
              <!-- Thumbnail -->
              <div class="fb-thumb">
                @if (p.productImage) {
                  <img [src]="imgUrl(p.productImage)" [alt]="p.productName" class="fb-thumb-img"/>
                } @else {
                  <ap-icon name="catalog" [size]="18"/>
                }
              </div>

              <!-- Info -->
              <div class="fb-row-info">
                <div class="fb-row-name">{{ p.productName }}</div>
                <div class="fb-row-meta">
                  <span class="fb-stars">{{ starsLabel(p.avgRating) }}</span>
                  @if (p.avgRating) {
                    <span class="fb-avg-num">{{ p.avgRating | number:'1.1-1' }}</span>
                  }
                  <span class="fb-sep">·</span>
                  <span>{{ p.reviewCount }} {{ p.reviewCount === 1 ? 'review' : 'reviews' }}</span>
                  <span class="fb-sep">·</span>
                  <span class="muted">{{ p.latestAt | date:'d MMM y' }}</span>
                </div>
              </div>

              <!-- Arrow -->
              <ap-icon name="arrow" [size]="16" class="fb-row-arrow"/>
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .fb-header { margin-bottom: 24px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .fb-title  { font-size: 22px; font-weight: 700; color: var(--ink); margin-bottom: 4px; }
    .fb-sub    { font-size: 12px; color: var(--muted); }

    .fb-kiosk-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 16px; font-size: 12px; font-weight: 700;
      border-radius: 6px; border: 1px solid rgba(124,92,191,.3);
      background: rgba(124,92,191,.06); color: #7c5cbf;
      text-decoration: none; white-space: nowrap; flex-shrink: 0;
      transition: all .13s;
    }
    .fb-kiosk-btn:hover { background: rgba(124,92,191,.12); border-color: #7c5cbf; color: #6a4aae; }

    .fb-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
      margin-bottom: 20px;
    }
    @media (max-width: 600px) {
      .fb-stats { grid-template-columns: 1fr 1fr; }
      .fb-stats .fb-stat:last-child { grid-column: 1 / -1; }
    }

    .fb-stat     { text-align: center; }
    .fb-stat-val { font-size: 28px; font-weight: 700; color: var(--ink); line-height: 1.1; }
    .fb-stat-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-top: 4px; }
    .fb-avg      { color: var(--gold); }

    /* List rows */
    .fb-row {
      display: flex; align-items: center; gap: 14px;
      width: 100%; padding: 14px 16px;
      border: none; background: none; cursor: pointer; text-align: start;
      border-bottom: 1px solid var(--border);
      transition: background .12s;
      font-family: inherit;
    }
    .fb-row:last-child { border-bottom: none; }
    .fb-row:hover { background: var(--bg); }

    .fb-thumb {
      width: 44px; height: 44px; border-radius: 8px;
      background: var(--bg); border: 1px solid var(--border);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; overflow: hidden; color: var(--muted);
    }
    .fb-thumb-img { width: 100%; height: 100%; object-fit: cover; }

    .fb-row-info { flex: 1; min-width: 0; }
    .fb-row-name { font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 3px; }
    .fb-row-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; font-size: 11px; color: var(--muted); }
    .fb-stars    { color: var(--gold); letter-spacing: 1px; }
    .fb-avg-num  { font-weight: 700; color: var(--ink); }
    .fb-sep      { opacity: .4; }

    .fb-row-arrow { color: var(--muted); flex-shrink: 0; margin-inline-start: auto; }

    /* Skeleton */
    .fb-skeleton-row {
      display: flex; align-items: center; gap: 14px;
      padding: 14px 16px; border-bottom: 1px solid var(--border);
    }
    .fb-skeleton-row:last-child { border-bottom: none; }
    .fb-skeleton-img {
      width: 44px; height: 44px; border-radius: 8px;
      background: var(--bg); flex-shrink: 0;
      animation: shimmer 1.5s linear infinite;
      background: linear-gradient(90deg, var(--bg) 25%, var(--border) 50%, var(--bg) 75%);
      background-size: 200% 100%;
    }
    .fb-skeleton-lines { flex: 1; display: flex; flex-direction: column; gap: 8px; }
    .fb-skeleton-line {
      height: 10px; border-radius: 4px;
      background: linear-gradient(90deg, var(--bg) 25%, var(--border) 50%, var(--bg) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s linear infinite;
    }
    .fb-skeleton-line.wide   { width: 60%; }
    .fb-skeleton-line.narrow { width: 35%; }
    @keyframes shimmer { to { background-position: -200% 0; } }
  `],
})
export class FeedbackComponent implements OnInit {
  private readonly api    = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly i18n   = inject(I18nService);

  readonly t = (k: string) => this.i18n.t(k);

  readonly loading  = signal(true);
  readonly products = signal<FeedbackProduct[]>([]);
  readonly summary  = signal<FeedbackSummary>({ totalReviews: 0, avgRating: null, productCount: 0 });

  readonly kioskBaseUrl = (() => {
    if (typeof window === 'undefined') return '/kiosk';
    const h = window.location.hostname;
    const base = (h === 'localhost' || h === '127.0.0.1')
      ? `${window.location.protocol}//${h}:4200`
      : window.location.origin;
    return `${base}/kiosk`;
  })();

  async ngOnInit(): Promise<void> {
    try {
      const data = await this.api.get<{ summary: FeedbackSummary; products: FeedbackProduct[] }>('/admin/reviews').toPromise();
      if (data) {
        this.summary.set(data.summary);
        this.products.set(data.products);
      }
    } finally {
      this.loading.set(false);
    }
  }

  openDetail(productId: string): void {
    void this.router.navigate(['/feedback', productId]);
  }

  imgUrl(path: string): string {
    return this.api.mediaUrl(path);
  }

  starsLabel(avg: number | null): string {
    if (!avg) return '☆☆☆☆☆';
    const full  = Math.round(avg);
    const empty = 5 - full;
    return '★'.repeat(full) + '☆'.repeat(empty);
  }
}
