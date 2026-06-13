import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';

export interface AnalyticsKpis {
  visitors: number;
  sessions: number;
  pageviews: number;
  clicks: number;
  events: number;
  pagesPerSession: number;
}

export interface AnalyticsPoint {
  day: string;
  sessions: number;
  clicks: number;
  pageviews: number;
}

export interface LabelValue { label: string; value: number; }
export interface EventSlice { source: string; count: number; pct: number; color: string; }

export interface FinancialKpis {
  revenue: number;
  orders: number;
  totalOrders: number;
  aov: number;
  conversionRate: number;
}

export interface RevenuePoint { day: string; revenue: number; }

export interface StorefrontAnalytics {
  kpis: AnalyticsKpis;
  financial: FinancialKpis;
  series: AnalyticsPoint[];
  revenueSeries: RevenuePoint[];
  topPages: LabelValue[];
  topClicks: LabelValue[];
  topProducts: LabelValue[];
  eventTypes: EventSlice[];
  traffic: EventSlice[];
}

const EMPTY: StorefrontAnalytics = {
  kpis: { visitors: 0, sessions: 0, pageviews: 0, clicks: 0, events: 0, pagesPerSession: 0 },
  financial: { revenue: 0, orders: 0, totalOrders: 0, aov: 0, conversionRate: 0 },
  series: [],
  revenueSeries: [],
  topPages: [],
  topClicks: [],
  topProducts: [],
  eventTypes: [],
  traffic: [],
};

/** Reads live storefront analytics (clicks/sessions) from the admin API. */
@Injectable({ providedIn: 'root' })
export class AdminAnalyticsService {
  private readonly api = inject(ApiClient);

  readonly data = signal<StorefrontAnalytics>(EMPTY);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async load(range: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(
        this.api.get<StorefrontAnalytics>(`/admin/analytics/storefront?range=${encodeURIComponent(range)}`),
      );
      this.data.set(res ?? EMPTY);
    } catch (e) {
      this.error.set('Could not load analytics.');
      this.data.set(EMPTY);
    } finally {
      this.loading.set(false);
    }
  }
}
