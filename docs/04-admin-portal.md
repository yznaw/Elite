# 04 — Admin Portal

> **Audience:** Frontend developers  
> **Reading time:** ~15 minutes

---

## Overview

The **admin-portal** is a comprehensive back-office dashboard for managing the e-commerce platform. It runs at `http://localhost:4300` in development and at `https://admin.website.com` in production.

- **Prefix:** `ap` (all components use `<ap-*>` selectors)
- **Port:** 4300
- **Output:** `client/dist/admin-portal/`

---

## App Shell

```html
<div class="app">
  <ap-sidebar/>          <!-- Fixed left sidebar navigation -->
  <div class="main">
    <ap-topbar/>          <!-- Top bar with search, notifications, language -->
    <div class="scroll-area">
      <router-outlet/>    <!-- Active page -->
    </div>
  </div>
</div>

<ap-toast/>              <!-- Global toast notification stack -->
<ap-confirm-dialog/>     <!-- Global confirmation modal -->
```

---

## Pages & Routes

All pages are lazy-loaded:

| Route | Component | Description |
|---|---|---|
| `/login` | `LoginComponent` | Public — email + password sign-in against `/api/auth/login`. Bounces authed users straight to the return URL. "Forgot password?" link below the form. Sidebar/topbar are hidden on auth routes. |
| `/forgot-password` | `ForgotPasswordComponent` | Public — collects email, calls `/api/auth/forgot`. Always shows "check your inbox" so we never leak account existence. |
| `/reset-password` | `ResetPasswordComponent` | Public — reads `?token=…`, validates `password ≥ 8` chars + matches confirmation, then calls `/api/auth/reset`. Bounces to `/login` on success. |
| `/dashboard` | `DashboardComponent` | Live KPIs, revenue chart, 3D heatmap, recent orders — all sourced from `/api/admin/{orders,products,customers}`. No `mock.ts` after login. |
| `/catalog` | `CatalogComponent` | Product grid/list, search, collection filtering, **New Product** create flow, inline editor with image gallery (drag-reorder + primary, **real multipart upload to `POST /api/admin/products/:id/images` with per-file progress bar**, drag/drop on desktop + tap-to-browse on mobile), variants table (size/color/material × SKU/price/stock), rich-text descriptions for EN & AR, top save bar, draft auto-save |
| `/collections` | `CollectionsComponent` | Grouping products into collections, title/desc, cover image upload (drag/drop + URL paste), drag-to-reorder linked products to control storefront display order |
| `/media` | `MediaComponent` | Live grid from `GET /api/admin/media`, **real multipart upload to `POST /api/admin/media` via drag/drop or tap-to-browse** (per-file thumbnail + progress row, 15 % / 60 % / 100 % … ), 415 / 413 errors surfaced inline, auto-link by SKU, detail drawer. Delete removes the file from storage too. |
| `/storefront` | `StorefrontComponent` | Section editor with drag & drop, draft → publish, preview |
| `/orders` | `OrdersComponent` | Searchable order table, payment/fulfillment filters, full-height drawer with status workflow stepper, tracking number, internal notes & timeline |
| `/customers` | `CustomersComponent` | Customer table/cards, tier filter, **Add Customer** create flow, fully editable detail drawer with real linked-orders history (rows navigate to /orders?id=…) |
| `/analytics` | `AnalyticsComponent` | Revenue chart, traffic sources, conversion funnel, top 3D interactions |
| `/sync` | `SyncComponent` | Sync source cards, activity feed, manual queue, schedule management |
| `/settings` | `SettingsComponent` | Store info, team members, integrations |
| `**` | — | Redirects to `/dashboard` |

> Every route except `/login`, `/forgot-password`, and `/reset-password` is gated by `authGuard` (`canMatch`). `/settings` is additionally gated by `roleGuard(['owner','admin'])`. See [08 – Database & API Implementation › Authentication](./08-database-api-implementation.md#authentication-session-based) for the server side and the full reset-password flow.

---

## Shared Components (15+)

Located in `app/shared/`:

### Layout

| Component | Folder | Description |
|---|---|---|
| `SidebarComponent` | `sidebar/` | Fixed left navigation with workspace sections, active route highlighting. Footer card shows the live signed-in user (avatar initials, full name, translated role, email) with a Sign-out button — sourced from `AuthService.user()`, not hardcoded. |
| `TopbarComponent` | `topbar/` | Top bar with title/breadcrumb, search, language switcher, and notification bell. The avatar + sign-out used to live here too — both moved to the sidebar to remove the duplicate. |

### Data Display

| Component | Folder | Description |
|---|---|---|
| `KpiComponent` | `kpi/` | KPI card with icon, value, delta indicator |
| `SortableTableComponent` | `sortable-table/` | Reusable sortable, paginated data table |
| `ChartComponent` | `charts/` | Canvas-based chart rendering (line, area, bar) |
| `SparklineComponent` | `sparkline/` | Tiny inline sparkline chart |
| `PillComponent` | `pill/` | Status pill badge (green/amber/red/blue/grey/gold) |
| `AvatarComponent` | `avatar/` | User avatar with initials |
| `TriggerBadgeComponent` | `trigger-badge/` | Shows who triggered an action (manual vs auto) |
| `EmptyStateComponent` | `empty-state/` | Empty data state with icon and message |
| `IconsComponent` | `icons/` | Centralized SVG icon library |
| `RichTextComponent` | `rich-text/` | Lightweight `contenteditable` editor with bold/italic/underline/list/link/clear toolbar. Honours `dir` for RTL editing. Used for product descriptions (EN + AR). |

### Feedback

| Component | Folder | Description |
|---|---|---|
| `ToastComponent` | `toast/` | Stackable toast notifications with auto-dismiss |
| `SpinnerComponent` | `spinner/` | Loading spinner overlay |
| `ConfirmDialogComponent` | `confirm-dialog/` | Modal confirmation dialog with customizable title/message/buttons |
| `LanguageSwitcherComponent` | `language-switcher/` | Language toggle dropdown |

---

## Services

### `StorefrontService`

- **File:** `services/storefront.service.ts`
- **Purpose:** Manages the storefront layout with draft/publish workflow
- **State:** Two signals — `draft` and `published` (each is a `Snapshot` with blocks + timestamp)
- **Persistence:** `localStorage` (designed to be swapped for API calls)
- **API:**
  - `saveDraft(blocks)` — Save working copy
  - `publish()` — Promote draft → published
  - `revertPublished(snapshot)` — Undo a publish
  - `hasUnpublishedChanges` — Computed boolean
  - `storefrontUrl()` — Generates the storefront preview URL
  - `buildPreviewLink()` — Generates a one-time preview link with token
  - `reset()` — Clear both draft and published

### `ToastService`

- **File:** `services/toast.service.ts`
- **Purpose:** Global toast notification management
- Shows success/error/info messages with auto-dismiss
- Supports undo actions on delete operations

### `NotificationService`

- **File:** `services/notification.service.ts`
- **Purpose:** Manages global notification state and unread counts
- **Features:** Supports `push()`, `dismiss()`, `markRead()`, `markAllRead()`, and time-ago formatting
- **Current State:** Seeded with mock data, ready to be wired to Server-Sent Events (SSE) or WebSockets

### `ConfirmService`

- **File:** `services/confirm.service.ts`
- **Purpose:** Promise-based confirmation dialogs
- Opens a modal and returns a Promise that resolves with the user's choice

### `I18nService` (Admin)

- **File:** `services/i18n.service.ts`
- **Same pattern** as client-web but with admin-specific string keys
- Additional `translator` computed signal for template use

### `LocaleService` (Admin)

- **File:** `services/locale.service.ts`
- **Same pattern** as client-web
- Uses localStorage key `elite-admin:locale`

### `SidebarToggleService`

- **File:** `shared/sidebar-toggle.service.ts`
- **Purpose:** Controls sidebar collapse/expand state

### `httpErrorInterceptor`

- **File:** `interceptors/http-error.interceptor.ts`
- **Purpose:** Global HTTP error interceptor
- **Features:** Catches all failed HTTP requests globally and displays contextual toasts via `ToastService` based on status code (401, 403, 404, 422, etc.).

---

## i18n System

The admin portal has its own i18n dictionary with **640+ keys** covering all admin UI strings.

### Key Categories

| Prefix | Content |
|---|---|
| `brand.*` | Admin brand identity |
| `nav.*` | Sidebar navigation labels |
| `page.*` | Page titles and breadcrumbs |
| `topbar.*` | Top bar labels |
| `common.*` | Shared actions (save, cancel, delete, etc.) |
| `pill.*` | Status pill labels |
| `catalog.*` | Product catalog UI |
| `product.*` | Product editor (50+ keys for full editor UI) |
| `storefront.*` | Storefront editor (60+ keys) |
| `orders.*` | Orders page |
| `customers.*` | Customer CRM |
| `media.*` | Media library (40+ keys including auto-link) |
| `analytics.*` | Analytics page |
| `sync.*` | Sync engine (80+ keys for feed, sources, queue) |
| `settings.*` | Settings page |
| `dash.*` | Dashboard KPIs and charts |
| `orderModal.*` | Order detail modal |
| `customerDrawer.*` | Customer detail drawer |

### Translation Strategy: Transcreation

Unlike standard auto-translation, the Arabic localization for the Elite platform follows a **Transcreation** (Creative Copywriting) approach. This ensures the tone remains premium, professional, and culturally relevant for luxury e-commerce.

**Key Principles:**
- **Luxury Terminology:** Using high-end terms (e.g., `المعروضات` for Catalog, `التشكيلات` for Collections, `القطعة` for Product).
- **Direct Tone:** Avoiding literal translations of English idioms.
- **Common Dictionary:** All shared terms (Save, Discard, Cancel, etc.) are centralized under the `common.*` prefix to ensure 100% consistency across all pages.

### Current Translation Progress

- [x] **Sidebar Navigation** (transcreated)
- [x] **Dashboard Page** (transcreated)
- [/] **Product Catalog** (in progress)
- [ ] **Storefront Editor**
- [ ] **Order Management**
- [ ] **Customer CRM**

---

## Mock Data Layer

All admin data is currently mocked in `app/data/mock.ts`:

| Export | Type | Description |
|---|---|---|
| `PRODUCTS` | `Product[]` | 12 products (6 Elite + 6 other brands) |
| `MEDIA_INIT` | `MediaFile[]` | 17 media files (images + 3D models) |
| `CUSTOMERS` | `Customer[]` | 10 customers with profiles |
| `ORDERS` | `Order[]` | 12 orders with line items |
| `SYNC_LOGS` | `SyncLog[]` | 11 sync log entries |
| `SYNC_SOURCES` | `SyncSource[]` | 1 sync source (Counterpoint POS) |
| `REVENUE_30D` | `RevenueDay[]` | 30 days of generated revenue data |
| `TRAFFIC` | `TrafficSource[]` | 4 traffic sources |
| `FUNNEL` | `FunnelStep[]` | 5-step conversion funnel |
| `TEAM` | `TeamMember[]` | 4 team members |
| `INTEGRATIONS` | `Integration[]` | 3 integrations |
| `STOREFRONT_DEFAULT` | `StorefrontBlock[]` | 5 default storefront sections |
| `PALETTE` | `PaletteEntry[]` | 5 available block types |

### Helper Functions

- `extractSkuFromName(name)` — Extract SKU from a filename
- `findProductBySkuPrefix(sku)` — Find product by SKU
- `suggestProduct(media)` — Auto-suggest product link for a media file (high/medium/low confidence)

### Hardcoded User

```typescript
export const ME = { id: 'T-1', name: 'Yusuf Hamad', initials: 'YH', role: 'Admin' as const };
```

> **For white-label:** Replace `ME` with the client's admin user, and update `PRODUCTS`, `CUSTOMERS`, etc. with client-specific data — or remove mock data entirely when connecting to a real API.

---

## Models

All models are defined in `app/models/index.ts`:

| Interface | Key Fields | Used By |
|---|---|---|
| `Product` | id, name, sku, brand, price, stock, has3d, hidden, image, images[]?, variants[]? | Catalog, Dashboard |
| `ProductVariant` | id, sku, size, color, material, price, stock | Product drawer (Variants section) |
| `MediaFile` | id, name, kind (image/glb), size, linkedTo, preview | Media Library |
| `Order` | id, date, customer, total, payment, fulfillment, items[], trackingNumber?, timeline[]?, notes[]? | Orders |
| `OrderTimelineEntry` | id, ts, kind, detail?, actor? | Order drawer timeline |
| `OrderNote` | id, ts, author, initials, body | Order drawer internal notes |
| `Customer` | id, name, email, orders, ltv, sizePref, notes | Customers |
| `SyncLog` | id, ts, type, processed, updated, status, triggeredBy | Sync Feed |
| `SyncSource` | id, name, status, schedule, successRate, spark7d | Sync Sources |
| `StorefrontBlock` | id, type, title, visible, config, ctaText, productIds | Storefront Editor |
| `TeamMember` | id, name, email, role, initials | Settings |
| `Integration` | id, name, desc, connected | Settings |
| `RevenueDay` | day, rev, sessions, conversions | Analytics, Dashboard |

### Utility Functions

```typescript
export const QAR = (n: number): string => 'QAR ' + n.toLocaleString();
export const fmtBytes = (n: number): string => { /* formats B/KB/MB */ };
```

---

## Design System

### Color Palette

```scss
:root {
  // Primary Brand — Deep green
  --green:   #024638;    // Base
  --green-2: #036350;    // Lighter
  --green-3: #012b23;    // Darker
  --green-4: #048269;    // Lightest

  // Gold Accents
  --gold:   #c5a572;
  --gold-2: #d6bc91;

  // Backgrounds & Surfaces
  --bg:      #f5f6fa;    // Page background
  --surface: #ffffff;    // Cards, panels

  // Text
  --ink:    #1a1f36;     // Primary text
  --ink-2:  #3d4159;     // Secondary text
  --muted:  #6b7088;     // Tertiary text

  // Status
  --success: #10b981;    // Green
  --warning: #f59e0b;    // Amber
  --danger:  #ef4444;    // Red
  --info:    #3b82f6;    // Blue
}
```

### Typography

- **UI Font:** `'Thmanyah Sans'` — Navigation, labels, buttons
- **Display Font:** `'Thmanyah Serif Display'` — KPI values, card titles
- **Mono Font:** `'SF Mono', Menlo` — Code, IDs, timestamps

All fonts are self-hosted from `assets/fonts/thmanyah/` (woff2). The Thmanyah family natively supports both Latin and Arabic, so no separate Arabic font is needed.

### Component Library (CSS Classes)

| Class | Description |
|---|---|
| `.card` / `.card-pad` / `.card-header` / `.card-title` | Card container system |
| `.panel` | Card variant with overflow hidden |
| `.btn` / `.btn-primary` / `.btn-gold` / `.btn-outline` / `.btn-ghost` / `.btn-danger` | Button variants |
| `.btn-sm` | Small button |
| `.icon-btn` / `.x-btn` | Icon-only buttons |
| `.pill` + `.green` / `.amber` / `.red` / `.blue` / `.grey` / `.gold` | Status pills |
| `.tbl` + `th` / `td` | Sortable data table |
| `.inp` / `.inp-search` / `.lbl` | Form inputs |
| `.kpi` / `.kpi-grid` / `.kpi-value` / `.kpi-delta` | KPI cards |
| `.avatar` / `.avatar.lg` / `.avatar.muted` | User avatars |
| `.toggle` / `.toggle.on` | Toggle switch |
| `.tabs` / `.tab` / `.tab.active` | Tab navigation |
| `.chip` / `.chip.active` | Filter chips |
| `.save-bar-top` / `.save-bar-top.shake` | Sticky top save banner with shake animation |
| `.overlay` / `.drawer` | Drawer/modal overlays |

---

## Storefront Editor Architecture

The storefront editor is the most complex feature in the admin portal:

```
┌──────────────────────────────────────┐
│         StorefrontService            │
│                                      │
│  ┌─────────────┐  ┌──────────────┐  │
│  │    Draft     │  │  Published   │  │
│  │  (working)   │  │   (live)     │  │
│  └──────┬──────┘  └──────┬───────┘  │
│         │                 │          │
│    saveDraft()       publish()       │
│         │                 │          │
│    localStorage     localStorage     │
│         │                 │          │
└─────────┼─────────────────┼──────────┘
          │                 │
          ▼                 ▼
    Admin edits →→→→ Shoppers see
```

### Flow

1. Admin drags/edits sections → `saveDraft()` called automatically
2. Admin clicks "Publish" → `publish()` promotes draft to published
3. Customer-web reads from `published` localStorage key
4. Admin can preview via `buildPreviewLink()` → opens storefront with draft data
5. Admin can undo publish via `revertPublished(previousSnapshot)`

---

## How To: Add a New Admin Page

1. **Create folder:** `client/projects/admin-portal/src/app/pages/your-page/`
2. **Create component:**

```typescript
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { I18nService } from '../../services/i18n.service';

@Component({
  selector: 'ap-your-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page-fade" style="padding: 28px 32px">
      <h1 class="card-title">{{ t('page.yourPage.title') }}</h1>
    </div>
  `,
})
export class YourPageComponent {
  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t;
}
```

3. **Add route** in `app.routes.ts`:

```typescript
{
  path: 'your-page',
  loadComponent: () =>
    import('./pages/your-page/your-page.component').then(m => m.YourPageComponent),
},
```

4. **Add sidebar link** in `SidebarComponent`
5. **Add i18n keys** for `nav.yourPage`, `page.yourPage.title`, `page.yourPage.crumb`

---

## Backend Persistence Map

Each admin section maps to one or more PostgreSQL tables defined in `server/db/migrations/001_initial_schema.sql`. The schema is multi-tenant — every row is scoped by `tenant_id`.

| Section | Tables |
|---|---|
| Dashboard KPIs / charts | `daily_metrics`, `orders`, `analytics_events`, `product_interactions` |
| Catalog · Product editor | `products`, `product_translations`, `product_variants`, `media_assets`, `media_links` (gallery role), `inventory_movements` |
| Collections | `collections`, `collection_translations`, `collection_products` (`sort_order` drives storefront order), `media_assets` (cover image) |
| Media library | `media_assets`, `media_links`, plus disk storage under `server/uploads/` (served as `/uploads/*`) via the storage adapter in `server/lib/storage.js` |
| Storefront editor | `storefront_snapshots`, `storefront_blocks`, `storefront_block_products` |
| Orders · drawer | `orders`, `order_items`, `payments`, `shipments` (tracking number), `order_timeline_entries`, `order_notes` |
| Customers · drawer | `customers`, `customer_addresses`, `orders` (history join), view `v_customer_order_stats` |
| Sync | `sync_sources`, `sync_logs` |
| Settings · team | `admin_users`, `store_settings`, `integrations`, `audit_events` |
| Notifications bell | `notifications` |

See [08 – Database & API Implementation](./08-database-api-implementation.md) for the endpoint-to-SQL map and the May 2026 admin-portal → schema mapping.

---

## Related Documents

- [03 – Client Web](./03-client-web.md) — The storefront app
- [05 – API Server](./05-api-server.md) — Express API details
- [06 – White-Label Guide](./06-white-label-guide.md) — Rebranding the admin
- [08 – Database & API Implementation](./08-database-api-implementation.md) — PostgreSQL schema and endpoint map
