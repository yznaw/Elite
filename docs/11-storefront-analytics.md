# 11 — Storefront Analytics

> **Audience:** Frontend & Backend developers
> **Reading time:** ~10 minutes

---

## Overview

First-party, privacy-friendly analytics for the storefront — **no third-party tools** (no Google Analytics, Clarity, PostHog). Customer clicks, sessions, visitors, page views, and product engagement are tracked client-side, ingested through a public endpoint, stored in the existing `analytics_events` table, and surfaced **live** on the admin **`/analytics`** page alongside real financial figures from the `orders` table.

The design is **performance-first**: one delegated event listener, in-memory batching, and `navigator.sendBeacon` on unload — so tracking never blocks the customer's page or competes with LCP.

| Concern | Choice |
|---|---|
| Tracking | First-party (`data-track` attributes + delegated listener) |
| Transport | Batched, flushed every 10s + on page hide via `sendBeacon` |
| Storage | Existing `analytics_events` table (no migration) |
| Ingestion | Public `POST /api/analytics/collect` (anonymous) |
| Aggregation | `GET /api/admin/analytics/storefront` (auth) |
| Display | Admin `/analytics` page, real data |

---

## Data Flow

```
Customer browses storefront
      │
      ▼
AnalyticsService (client-web)
  • ONE delegated click listener (document root, capture + passive)
  • elements opt in via  data-track="label"  (+ optional data-track-product)
  • session_start / pageview / click / product_view events
  • queued in memory, batched
      │  every 10s, or on pagehide/visibilitychange (sendBeacon)
      ▼
POST /api/analytics/collect   ← PUBLIC, no auth, batch insert
      │
      ▼
analytics_events  (PostgreSQL)
      │
      ▼
GET /api/admin/analytics/storefront?range=  ← auth, live aggregation
      │
      ▼
Admin /analytics page  (KPIs, charts, top-N tables)
```

---

## Client — `AnalyticsService`

**File:** `client/projects/client-web/src/app/services/analytics.service.ts`
Initialised once from `AppComponent` (skipped when the storefront is embedded in the admin preview iframe).

### How it tracks

- **One delegated `click` listener** at the document root (`capture: true, passive: true`). Elements opt in with `data-track="some-label"`; adding components never adds listeners. Uses `el.closest('[data-track]')` so clicks on inner spans/icons still resolve to the tagged element.
- **Page views** fire on `session_start` and on every Angular `NavigationEnd` (an SPA doesn't reload, so navigations must be tracked explicitly).
- **Batched & flushed** every 10s, when the queue hits 25 events, and reliably on `pagehide`/`visibilitychange` via `navigator.sendBeacon` (sent off the main thread, survives page close). Falls back to `fetch(..., { keepalive: true })`.
- **Runs outside Angular's zone** (`NgZone.runOutsideAngular`) so tracking never triggers change detection.

### Identity

| Id | Storage | Lifetime | Used for |
|---|---|---|---|
| `sessionId` | `sessionStorage` (`cw_a_sid`) | Per tab; resets after 30 min idle | **Sessions** (visits) |
| `visitorId` | `localStorage` (`cw_a_vid`) | Persistent across visits/days | **Unique Visitors** |

`visitorId` is stamped into every event's `metadata.visitorId`. `localStorage` access is wrapped in `try/catch` for private-mode/blocked storage.

### Event payload

```jsonc
{
  "type": "click",                 // session_start | pageview | click | product_view | add_to_cart | ...
  "sessionId": "uuid",
  "pagePath": "/collections/oxford",
  "productId": "uuid | null",      // from data-track-product, or product_view
  "collectionId": "uuid | null",
  "locale": "en | ar",
  "referrer": "https://google.com/", // entry referrer, on session_start only
  "metadata": { "label": "add-to-cart", "x": 120, "y": 340, "tag": "button",
                "visitorId": "uuid" },
  "ts": 1718200000000
}
```

> **Referrer note:** the real entry referrer is captured client-side from `document.referrer` and sent on the `session_start` event. The HTTP `Referer` header on the beacon points at our *own* page, so it is deliberately **ignored** server-side. Empty referrer → **Direct**.

### Tracking a custom event

Inject `AnalyticsService` and call `track()`:

```ts
private readonly analytics = inject(AnalyticsService);

this.analytics.track('product_view', { productId: product.id });
```

The product detail page (`product.component.ts`) does exactly this on load so **Most Engaged Products** reflects views, not just cart clicks.

---

## Tagging elements (`data-track`)

Add `data-track="label"` to any element to capture clicks on it. Optionally add `data-track-product="<uuid>"` to attribute the click to a product. Static or Angular-bound both work:

```html
<!-- static -->
<button data-track="nav-cart">Cart</button>

<!-- bound -->
<button data-track="product-card" [attr.data-track-product]="p.id">…</button>
<a [attr.data-track]="'nav:' + l.path">…</a>
```

### Currently tagged

| Area | Label(s) |
|---|---|
| Product page | `add-to-cart`, `buy-now`, `add-to-cart-sticky`, `buy-now-sticky` (+ product id) |
| Nav | `nav-brand`, `nav:<path>`, `search-open`, `search-result` (+ product id), `nav-cart` |
| Collection grid | `product-card`, `quick-add` (both + product id) |
| Checkout | `cart-checkout`, `checkout-continue`, `checkout-place-order` (dynamic by step) |

> Wishlist is currently commented out in the product template — when re-enabled, add `data-track="wishlist-toggle"` `[attr.data-track-product]="p.id"`.

---

## Server — Ingestion

**File:** `server/routes/analytics.route.js` — mounted **public** at `/api/analytics` in `routes/index.js`.

### `POST /api/analytics/collect`

Accepts a batch `{ events: [...] }` (also tolerates a single bare event). Inserts valid rows into `analytics_events` in one multi-row statement and always replies `200` quickly so `sendBeacon` never blocks.

Hardening:
- **Event-type whitelist** — `session_start`, `pageview`, `click`, `product_view`, `add_to_cart`, `begin_checkout`, `search`. Anything else is dropped.
- **Batch cap** 50 events/request; long strings trimmed; `productId`/`collectionId` validated as UUIDs.
- `occurred_at` trusts a sane client `ts`, else falls back to DB `now()`.

> The pre-existing `POST /events` under the **admin** router (`admin-analytics.route.js`, behind `requireAuth`) was unreachable by anonymous customers — `/collect` is the public path the tracker uses.

---

## Server — Aggregation

**File:** `server/routes/admin-analytics.route.js` → `GET /api/admin/analytics/storefront?range=` (auth-gated under `/api/admin`).

`range` ∈ `7d | 30d | 90d | 1y` (default `30d`), mapped to a Postgres interval. Everything is computed **live** — no pre-aggregation tables.

### Response shape

```jsonc
{
  "kpis": {
    "visitors": 0,        // count(DISTINCT metadata->>'visitorId')
    "sessions": 0,        // count(DISTINCT session_id)
    "pageviews": 0,
    "clicks": 0,
    "events": 0,
    "pagesPerSession": 0
  },
  "financial": {
    "revenue": 0,         // SUM(total_cents)/100 where payment_status='paid'
    "orders": 0,          // paid orders
    "totalOrders": 0,
    "aov": 0,             // revenue / paid orders
    "conversionRate": 0   // paid orders / sessions  (×100)
  },
  "series":        [{ "day": "2026-06-01", "sessions": 0, "clicks": 0, "pageviews": 0 }],
  "revenueSeries": [{ "day": "2026-06-01", "revenue": 0 }],
  "topPages":    [{ "label": "/collections/oxford", "value": 0 }],
  "topClicks":   [{ "label": "add-to-cart", "value": 0 }],        // metadata->>'label'
  "topProducts": [{ "label": "Oxford Brown", "value": 0 }],       // joined to products
  "eventTypes":  [{ "source": "click", "count": 0, "pct": 0, "color": "#C8A35B" }],
  "traffic":     [{ "source": "Search", "count": 0, "pct": 0, "color": "#2F6F5E" }]
}
```

### Key definitions

| Metric | Source / Rule |
|---|---|
| **Visitors** | `count(DISTINCT metadata->>'visitorId')` over `analytics_events` |
| **Sessions** | `count(DISTINCT session_id)` |
| **Revenue** | `orders` where `payment_status = 'paid'`, dated by `COALESCE(paid_at, created_at)` |
| **Conversion Rate** | paid orders ÷ tracked sessions |
| **Traffic Sources** | `session_start` entry referrer bucketed by regex → **Direct / Search / Social / Referral** |

---

## Admin — `/analytics` page

**Service:** `client/projects/admin-portal/src/app/services/admin-analytics.service.ts` (signal-based, via `ApiClient`).
**Component:** `pages/analytics/analytics.component.ts` — reloads on range change.

Layout, top to bottom:

1. **Financial** KPIs — Revenue · Paid Orders · Avg Order Value · Conversion Rate
2. **Revenue** trend (daily line chart)
3. **Behavior** KPIs — Visitors · Sessions · Page Views · Clicks
4. **Sessions & Clicks** trend (daily line chart)
5. **Traffic Sources** + **Event Breakdown** (pie + legend each)
6. **Top Pages** (bar) + **Most Clicked** (ranked list)
7. **Most Engaged Products** (bar)

Each panel has an empty state for when no data has accrued yet.

> The older `GET /admin/analytics/overview` endpoint and the `daily_metrics` / `traffic_sources` / `conversion_funnel_steps` tables still exist but are **no longer used** by this page (they backed the previous mock UI).

---

## Performance Notes

- **One** passive, delegated listener for the whole app — not per-element.
- Events batched in a plain array; network only every ~10s or on unload.
- `sendBeacon` / `keepalive` send off the main thread; no blocking on page close.
- No layout reads on the hot path (`clientX/Y` come straight off the event — never `getBoundingClientRect()`).
- All listeners run outside Angular's zone → zero change-detection churn.

This is intentionally lighter than any third-party replay/heatmap tool and does not affect Core Web Vitals.

---

## Limitations & Future Work

- **Counts accrue from deploy onward** — historical events predate `visitorId` and the corrected referrer, so Visitors/Traffic are only accurate for new traffic.
- **Visitor id is per-browser/device** (cookieless first-party) — same person across phone + laptop = 2 visitors; clearing storage resets it.
- **No conversion funnel yet** — the old mock funnel was removed. A real funnel (view → add-to-cart → begin_checkout → purchase) can be built once a `begin_checkout` event is fired on checkout load (`add_to_cart` and `product_view` already exist).
- **Traffic buckets** are regex-based on the referrer host; add UTM-parameter parsing for campaign-level attribution.

---

## File Reference

| File | Role |
|---|---|
| `client/projects/client-web/src/app/services/analytics.service.ts` | Tracker (listener, sessions, visitor id, batching, beacon) |
| `client/projects/client-web/src/app/app.component.ts` | Calls `analytics.init()` |
| `client/projects/client-web/src/app/pages/product/product.component.ts` | Fires `product_view` |
| `server/routes/analytics.route.js` | Public ingestion `POST /collect` |
| `server/routes/admin-analytics.route.js` | Aggregation `GET /storefront` |
| `client/projects/admin-portal/src/app/services/admin-analytics.service.ts` | Admin fetch + state |
| `client/projects/admin-portal/src/app/pages/analytics/analytics.component.ts` | Admin page UI |
