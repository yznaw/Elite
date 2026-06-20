import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IconComponent } from '../../shared/icons/icon.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { ToastService } from '../../services/toast.service';
import { ApiClient } from '../../services/api-client.service';
import { I18nService } from '../../services/i18n.service';

interface ReviewProduct {
  id:          string;
  name:        string;
  image:       string | null;
  reviewCount: number;
  avgRating:   number | null;
}

interface Review {
  id:          string;
  rating:      number | null;
  title:       string | null;
  body:        string | null;
  authorName:  string | null;
  authorEmail: string | null;
  authorPhone: string | null;
  source:      string;
  createdAt:   string;
  _copied?:    'phone' | 'email';
}

@Component({
  selector: 'ap-feedback-detail',
  standalone: true,
  imports: [CommonModule, IconComponent, EmptyStateComponent],
  template: `
    <div class="page-fade">

      <!-- Back -->
      <button class="fbd-back" type="button" (click)="goBack()">
        <ap-icon name="arrow" [size]="14" style="transform:rotate(180deg)"/>
        {{ t('feedback.backToFeedback') }}
      </button>

      <!-- Product summary -->
      @if (product()) {
        <div class="card card-pad fbd-product-bar">
          <div class="fbd-prod-thumb" [class.fbd-general-thumb]="isGeneral">
            @if (!isGeneral && product()!.image) {
              <img [src]="imgUrl(product()!.image!)" [alt]="product()!.name" class="fbd-prod-img"/>
            } @else {
              <ap-icon [name]="isGeneral ? 'users' : 'catalog'" [size]="20"/>
            }
          </div>
          <div class="fbd-prod-info">
            <div class="fbd-prod-name">{{ product()!.name }}</div>
            <div class="fbd-prod-meta">
              <span class="fbd-stars">{{ starsLabel(product()!.avgRating) }}</span>
              @if (product()!.avgRating) {
                <span class="fbd-avg">{{ product()!.avgRating | number:'1.1-1' }}</span>
              }
              <span class="fbd-sep">·</span>
              <span>{{ product()!.reviewCount }} {{ product()!.reviewCount === 1 ? t('feedback.review') : t('feedback.reviews') }}</span>
            </div>
          </div>
          <!-- Kiosk actions (product only) -->
          @if (!isGeneral) {
            <div class="fbd-kiosk-actions">
              <a [href]="kioskUrl(product()!.id)" target="_blank" rel="noopener noreferrer"
                 class="fbd-action-btn fbd-kiosk-open" title="Open kiosk for this product">
                <ap-icon name="phone" [size]="12"/>
                {{ t('feedback.detail.kioskOpen') }}
              </a>
              <button class="fbd-action-btn" type="button"
                      [class.copied]="kioskLinkCopied()"
                      (click)="copyKioskLink(product()!.id)"
                      title="Copy kiosk URL for iPad setup">
                <ap-icon [name]="kioskLinkCopied() ? 'check' : 'copy'" [size]="12"/>
                {{ kioskLinkCopied() ? t('feedback.copied') : t('feedback.copyLink') }}
              </button>
            </div>
          }
        </div>
      }

      <!-- Loading -->
      @if (loading()) {
        <div class="card">
          @for (_ of [1,2]; track $index) {
            <div class="fbd-skeleton">
              <div class="fbd-sk-line wide"></div>
              <div class="fbd-sk-line narrow" style="margin-top:8px"></div>
              <div class="fbd-sk-line full" style="margin-top:12px; height:40px"></div>
            </div>
          }
        </div>
      }

      <!-- Empty -->
      @if (!loading() && reviews().length === 0) {
        <div class="card">
          <ap-empty-state icon="star" [title]="t('feedback.detail.empty.title')" [sub]="t('feedback.detail.empty.sub')"/>
        </div>
      }

      <!-- Reviews -->
      @if (!loading() && reviews().length > 0) {
        <div class="fbd-reviews">
          @for (r of reviews(); track r.id) {
            <div class="card card-pad fbd-rev">

              <!-- Header row -->
              <div class="fbd-rev-head">
                <span class="fbd-stars">{{ starsLabel(r.rating) }}</span>
                <div class="fbd-rev-meta">
                  <span class="fbd-source-badge" [class.kiosk]="r.source === 'kiosk'">
                    {{ r.source === 'kiosk' ? t('feedback.source.kiosk') : t('feedback.source.storefront') }}
                  </span>
                  <span class="muted small">{{ r.createdAt | date:'d MMM y' }}</span>
                </div>
              </div>

              <!-- Title -->
              @if (r.title) {
                <div class="fbd-rev-title">"{{ r.title }}"</div>
              }

              <!-- Body -->
              @if (r.body) {
                <div class="fbd-rev-body">{{ r.body }}</div>
              }

              <!-- Contact info -->
              @if (r.authorName || r.authorEmail || r.authorPhone) {
                <div class="fbd-contact">
                  @if (r.authorName) {
                    <div class="fbd-contact-row">
                      <ap-icon name="users" [size]="13"/>
                      <span>{{ r.authorName }}</span>
                    </div>
                  }

                  @if (r.authorPhone) {
                    <div class="fbd-contact-row">
                      <ap-icon name="phone" [size]="13"/>
                      <span class="fbd-contact-val">{{ r.authorPhone }}</span>
                      <div class="fbd-contact-actions">
                        <a [href]="whatsappUrl(r.authorPhone)"
                           target="_blank" rel="noopener noreferrer"
                           class="fbd-action-btn fbd-wa"
                           title="Open in WhatsApp">
                          <ap-icon name="whatsapp" [size]="13"/>
                          {{ t('feedback.whatsapp') }}
                        </a>
                        <button class="fbd-action-btn"
                                [class.copied]="r._copied === 'phone'"
                                type="button"
                                (click)="copyPhone(r)"
                                title="Copy phone number">
                          <ap-icon [name]="r._copied === 'phone' ? 'check' : 'copy'" [size]="12"/>
                          {{ r._copied === 'phone' ? t('feedback.copied') : t('feedback.copy') }}
                        </button>
                      </div>
                    </div>
                  }

                  @if (r.authorEmail) {
                    <div class="fbd-contact-row">
                      <ap-icon name="mail" [size]="13"/>
                      <span class="fbd-contact-val">{{ r.authorEmail }}</span>
                      <div class="fbd-contact-actions">
                        <a [href]="'mailto:' + r.authorEmail"
                           class="fbd-action-btn"
                           title="Send email">
                          <ap-icon name="mail" [size]="12"/>
                          {{ t('feedback.email') }}
                        </a>
                        <button class="fbd-action-btn"
                                [class.copied]="r._copied === 'email'"
                                type="button"
                                (click)="copyEmail(r)"
                                title="Copy email address">
                          <ap-icon [name]="r._copied === 'email' ? 'check' : 'copy'" [size]="12"/>
                          {{ r._copied === 'email' ? t('feedback.copied') : t('feedback.copy') }}
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- No contact info -->
              @if (!r.authorName && !r.authorEmail && !r.authorPhone) {
                <div class="fbd-anon">{{ t('feedback.anonymous') }}</div>
              }

              <!-- Delete -->
              <div class="fbd-rev-foot">
                <button class="fbd-delete" type="button" (click)="deleteReview(r)">
                  <ap-icon name="trash" [size]="13"/>
                  {{ t('feedback.deleteReview') }}
                </button>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .fbd-back {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 600; color: var(--muted);
      background: none; border: none; cursor: pointer;
      font-family: inherit; padding: 0; margin-bottom: 16px;
      transition: color .14s;
    }
    .fbd-back:hover { color: var(--ink); }

    /* Product bar */
    .fbd-product-bar {
      display: flex; align-items: center; gap: 14px; margin-bottom: 20px; flex-wrap: wrap;
    }
    .fbd-prod-thumb {
      width: 52px; height: 52px; border-radius: 10px; flex-shrink: 0;
      background: var(--bg); border: 1px solid var(--border);
      display: flex; align-items: center; justify-content: center;
      overflow: hidden; color: var(--muted);
    }
    .fbd-general-thumb {
      background: rgba(184,146,74,.1) !important;
      border-color: rgba(184,146,74,.2) !important;
      color: var(--gold) !important;
    }
    .fbd-prod-img  { width: 100%; height: 100%; object-fit: cover; }
    .fbd-prod-name { font-size: 15px; font-weight: 700; color: var(--ink); margin-bottom: 4px; }
    .fbd-prod-meta { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
    .fbd-avg       { font-weight: 700; color: var(--ink); }
    .fbd-sep       { opacity: .4; }

    /* Kiosk actions */
    .fbd-kiosk-actions {
      display: flex; gap: 6px; margin-inline-start: auto; flex-shrink: 0;
    }
    .fbd-kiosk-open {
      color: #7c5cbf; border-color: rgba(124,92,191,.3); background: rgba(124,92,191,.06);
    }
    .fbd-kiosk-open:hover { background: rgba(124,92,191,.12); border-color: #7c5cbf; color: #6a4aae; }

    /* Review cards */
    .fbd-reviews   { display: flex; flex-direction: column; gap: 14px; }
    .fbd-rev { display: flex; flex-direction: column; gap: 10px; }

    .fbd-rev-head  { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
    .fbd-stars     { color: var(--gold); letter-spacing: 1.5px; font-size: 16px; }
    .fbd-rev-meta  { display: flex; align-items: center; gap: 8px; }

    .fbd-source-badge {
      font-size: 10px; font-weight: 700; padding: 2px 8px;
      border-radius: 99px; background: rgba(2,70,56,.06); color: var(--green);
      border: 1px solid rgba(2,70,56,.12);
    }
    .fbd-source-badge.kiosk { background: rgba(184,146,74,.08); color: var(--gold-dim, #8a7a62); border-color: rgba(184,146,74,.2); }

    .fbd-rev-title { font-size: 14px; font-weight: 700; color: var(--ink); font-style: italic; }
    .fbd-rev-body  { font-size: 13px; color: var(--ink-2); line-height: 1.65; }

    .fbd-anon { font-size: 12px; color: var(--muted); font-style: italic; }

    /* Contact block */
    .fbd-contact {
      display: flex; flex-direction: column; gap: 8px;
      padding: 12px 14px; border-radius: 8px;
      background: var(--bg); border: 1px solid var(--border);
    }
    .fbd-contact-row {
      display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
      font-size: 12px; color: var(--ink);
    }
    .fbd-contact-row ap-icon { color: var(--muted); flex-shrink: 0; }
    .fbd-contact-val { flex: 1; min-width: 0; font-weight: 500; }

    .fbd-contact-actions { display: flex; gap: 6px; flex-wrap: wrap; }

    .fbd-action-btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 10px; font-size: 11px; font-weight: 600;
      border-radius: 5px; border: 1px solid var(--border);
      background: var(--surface); color: var(--ink-2);
      cursor: pointer; font-family: inherit; text-decoration: none;
      transition: all .13s; white-space: nowrap;
    }
    .fbd-action-btn:hover { border-color: var(--gold); color: var(--gold); }
    .fbd-action-btn.copied { border-color: var(--green); color: var(--green); background: rgba(2,70,56,.05); }

    .fbd-wa { color: #25d366; border-color: rgba(37,211,102,.3); background: rgba(37,211,102,.06); }
    .fbd-wa:hover { background: rgba(37,211,102,.12); border-color: #25d366; color: #1aad57; }

    /* Footer */
    .fbd-rev-foot {
      display: flex; justify-content: flex-end;
      padding-top: 10px; border-top: 1px solid var(--border);
    }
    .fbd-delete {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 6px 12px; font-size: 11px; font-weight: 600;
      border-radius: 6px; border: 1px solid rgba(239,68,68,.25);
      background: transparent; color: var(--danger);
      cursor: pointer; font-family: inherit; transition: all .13s;
    }
    .fbd-delete:hover { background: rgba(239,68,68,.07); border-color: var(--danger); }

    /* Skeleton */
    .fbd-skeleton { padding: 16px; border-bottom: 1px solid var(--border); }
    .fbd-skeleton:last-child { border-bottom: none; }
    .fbd-sk-line {
      height: 12px; border-radius: 4px;
      background: linear-gradient(90deg, var(--bg) 25%, var(--border) 50%, var(--bg) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s linear infinite;
    }
    .fbd-sk-line.wide   { width: 45%; }
    .fbd-sk-line.narrow { width: 25%; }
    .fbd-sk-line.full   { width: 100%; }
    @keyframes shimmer { to { background-position: -200% 0; } }
  `],
})
export class FeedbackDetailComponent implements OnInit {
  private readonly api    = inject(ApiClient);
  private readonly route  = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast  = inject(ToastService);
  private readonly i18n   = inject(I18nService);

  readonly t = (k: string) => this.i18n.t(k);

  readonly loading         = signal(true);
  readonly product         = signal<ReviewProduct | null>(null);
  readonly reviews         = signal<Review[]>([]);
  readonly kioskLinkCopied = signal(false);

  isGeneral = false;

  private readonly storefrontBase = (() => {
    if (typeof window === 'undefined') return '';
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') {
      return `${window.location.protocol}//${h}:4200`;
    }
    return window.location.origin;
  })();

  async ngOnInit(): Promise<void> {
    const productId = this.route.snapshot.paramMap.get('productId')!;
    this.isGeneral  = productId === 'general';
    const url = this.isGeneral ? '/admin/reviews/general' : `/admin/reviews/${productId}`;
    try {
      const data = await this.api
        .get<{ product: ReviewProduct; reviews: Review[] }>(url)
        .toPromise();
      if (data) {
        this.product.set(data.product);
        this.reviews.set(data.reviews);
      }
    } catch {
      this.toast.error(this.t('feedback.toast.loadError.title'), this.t('feedback.toast.reviewsError'));
    } finally {
      this.loading.set(false);
    }
  }

  goBack(): void {
    void this.router.navigate(['/feedback']);
  }

  imgUrl(path: string): string {
    return this.api.mediaUrl(path);
  }

  starsLabel(rating: number | null): string {
    if (!rating) return '☆☆☆☆☆';
    const full = Math.round(rating);
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  }

  whatsappUrl(phone: string): string {
    return `https://wa.me/${phone.replace(/\D/g, '')}`;
  }

  kioskUrl(productId: string): string {
    return `${this.storefrontBase}/kiosk?product=${productId}`;
  }

  copyKioskLink(productId: string): void {
    navigator.clipboard.writeText(this.kioskUrl(productId)).then(() => {
      this.kioskLinkCopied.set(true);
      setTimeout(() => this.kioskLinkCopied.set(false), 2000);
    });
  }

  copyPhone(r: Review): void {
    if (!r.authorPhone) return;
    navigator.clipboard.writeText(r.authorPhone).then(() => {
      this.reviews.update((rs) => rs.map((x) => x.id === r.id ? { ...x, _copied: 'phone' } : x));
      setTimeout(() => {
        this.reviews.update((rs) => rs.map((x) => x.id === r.id ? { ...x, _copied: undefined } : x));
      }, 2000);
    });
  }

  copyEmail(r: Review): void {
    if (!r.authorEmail) return;
    navigator.clipboard.writeText(r.authorEmail).then(() => {
      this.reviews.update((rs) => rs.map((x) => x.id === r.id ? { ...x, _copied: 'email' } : x));
      setTimeout(() => {
        this.reviews.update((rs) => rs.map((x) => x.id === r.id ? { ...x, _copied: undefined } : x));
      }, 2000);
    });
  }

  async deleteReview(r: Review): Promise<void> {
    if (!confirm(this.t('feedback.deleteConfirm'))) return;
    try {
      await this.api.delete<void>(`/admin/reviews/${r.id}`).toPromise();
      this.reviews.update((rs) => rs.filter((x) => x.id !== r.id));
      this.product.update((p) =>
        p ? { ...p, reviewCount: p.reviewCount - 1 } : p,
      );
      this.toast.success(this.t('feedback.toast.deleted'), this.t('feedback.toast.deletedSub'));
    } catch {
      this.toast.error(this.t('error.unknown.title'), this.t('feedback.toast.deleteError'));
    }
  }
}
