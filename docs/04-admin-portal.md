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
| `/dashboard` | `DashboardComponent` | Live KPIs, revenue chart, 3D heatmap, recent orders — all sourced from `/api/admin/{orders,products,customers}`. No `mock.ts` after login. **Date Range Filter** (Today / 7 Days / 30 Days / 90 Days) pill-bar above KPIs — all 5 KPI computeds (revenue, active orders, new customers, top 3D views, low stock) react to the selected range. Uses `latestDate` from the latest order as reference so historical seed data works correctly. **Low Stock KPI card** — 5th card showing count of products with stock between 1 and the configurable threshold (default: 8, set via `StoreConfigService`). Clicking the card navigates to `/catalog?stock=low`. Card shows 0 when all items are stocked. |
| `/catalog` | `CatalogComponent` | Product grid **and list** view (toggle persisted via `StorageService` — tenant-scoped). Search, status quick-filter (All / Active / Hidden / **Low Stock**), sort (Name A–Z, Price ↑↓, Stock ↑↓, Newest). The **Low Stock** filter pill (badge shows count) is pre-activated when navigating from the dashboard `?stock=low` query param. Low-stock threshold comes from `StoreConfigService.lowStockThreshold()` (configurable in Settings). **Advanced filter panel**: collection, image status, 3D status, variant count, color (from `ref_colors`), price range, page size (25/50/100/All). All filter changes reset pagination to page 1. Active filters shown as dismissible chips. **Bulk Select** with checkbox overlay: Select All, **Set Status** (Active/Hidden) for selection, **Delete** with inline confirm. **Export CSV** button generates a UTF-8 BOM CSV of the visible product set. **New Product** create flow: inline drawer with image gallery (drag-reorder + primary, real multipart upload with per-file progress bar, drag/drop + tap-to-browse), **variants table with color swatch select from `ref_colors`, material select from `ref_materials`, size input with datalist suggestions from `ref_size_sets`**, "Generate sizes" wizard, rich-text descriptions EN & AR, draft auto-save (tenant-scoped via `StorageService`). **SEO fields** (`meta_title`, `meta_desc` with 160-char counter + red overflow indicator, URL slug with format validation) — persisted to the `products` table via migration `004_product_meta_seo.sql`. **Duplicate Product** button: creates a hidden copy with auto-incremented SKU (`-COPY`, `-COPY-2`, …). **Bulk Import** (CSV → products, live NDJSON streaming) **and Stock Update mode**. **Dry-Run toggle** — sends `?dryRun=true`; server ROLLBACKs the transaction so preview is identical to a real import. **Retry Failed (N)** button reconstructs a CSV from failed rows. **Import History** tab — last 20 imports persisted via `StorageService` (tenant-scoped), each entry expandable with per-product detail and a "Download Report" button. |
| `/reference` | `ReferenceComponent` | Reference data management — **Colors** (name EN/AR + hex, inline color picker, swatch preview), **Materials** (name EN/AR), **Size Charts** (named size sets with comma-editable size arrays). Full CRUD for each, changes immediately available as dropdowns in the product drawer and filters in the catalog. Owner/admin only. |
| `/collections` | `CollectionsComponent` | Grouping products into collections, title/desc, cover image upload (drag/drop + URL paste), drag-to-reorder linked products to control storefront display order |
| `/media` | `MediaComponent` | Live grid from `GET /api/admin/media`, **real multipart upload to `POST /api/admin/media` via drag/drop or tap-to-browse** (per-file thumbnail + progress row, 15 % / 60 % / 100 % … ), 415 / 413 errors surfaced inline, auto-link by SKU, detail drawer. Delete removes the file from storage too. |
| `/storefront` | `StorefrontComponent` | Section editor with drag & drop, draft → publish, preview |
| `/orders` | `OrdersComponent` | Searchable order table, payment/fulfillment filters, **Date Range filter** (All Time / Today / This Week / This Month / Custom — custom shows `date from/to` inputs). Active date range displayed as a dismissible chip. `clearFilters()` resets date range along with other filters. **CSV export** of the current filtered set (UTF-8 BOM), full-height drawer with status workflow stepper, tracking number, internal notes & timeline, **Print Invoice** button that opens a new browser tab with a fully formatted printable invoice (brand header, shipping address, line-items table, totals, `@media print` styles). |
| `/customers` | `CustomersComponent` | Customer table/cards, tier filter, **Add Customer** create flow, fully editable detail drawer with real linked-orders history (rows navigate to /orders?id=…) |
| `/analytics` | `AnalyticsComponent` | Revenue chart, traffic sources, conversion funnel, top 3D interactions |
| `/settings` | `SettingsComponent` | **General tab:** Store info (name, currency, timezone, language — `PATCH /api/admin/settings/store`) + **Low Stock Threshold** number input — sets `StoreConfigService.lowStockThreshold()`, persisted tenant-scoped via `StorageService`, consumed by catalog and dashboard. **Team tab:** team members (list, role change, status toggle — `GET/PATCH /api/admin/settings/team/:id`). **Team Invitations** — invite by email + role (`POST /api/admin/settings/invitations`), shows generated invite link in a copy-able input, lists pending invitations with revoke button. **Integrations tab.** Owner/admin only. |
| `/accept-invite` | `AcceptInviteComponent` | Public — reads `?token=` query param, validates via `GET /api/invitations/validate`, shows name/password/confirm form. On submit calls `POST /api/invitations/accept`. Redirects to login on success. Invitation token is single-use and expires after 48 h. |
| `/pos` | `PosComponent` | **Point of Sale** *(planned — not yet built)*. Full-screen dark-theme cashier interface. Touch-optimized product grid, live cart panel, USB + camera barcode scanning, Cash / Card / Split checkout, ESC/POS thermal receipt printing (Bixolon 80mm via WebUSB/TCP), automated cash drawer trigger (RJ12), barcode label generation (Code 128/EAN-13 30×20mm), Park & Resume multi-session carts, offline-first PWA with IndexedDB queue, X Report (mid-shift read), Z Report (end-of-day close with cash float & variance), full/partial returns & refunds, Manager PIN role-based security. Hides sidebar/topbar — renders standalone full-width. See [`docs/pos-system-plan.html`](./pos-system-plan.html) for acceptance criteria. |
| `**` | — | Redirects to `/dashboard` |

> Every route except `/login`, `/forgot-password`, `/reset-password`, and `/accept-invite` is gated by `authGuard` (`canMatch`). `/settings` and `/reference` are additionally gated by `roleGuard(['owner','admin'])`. `/pos` will be gated by `roleGuard(['owner','admin','cashier'])` when built. See [08 – Database & API Implementation › Authentication](./08-database-api-implementation.md#authentication-session-based) for the server side and the full reset-password flow.

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
| `SortableTableComponent` | `sortable-table/` | Reusable sortable data table. Header click cycles **desc → asc → none** (third click restores original row order). Supports `defaultSort` input and custom `sort` functions per column. |
| `PaginationComponent` | `pagination/` | Pagination bar with **First «**, Prev, Next, **Last »** buttons and a page-size selector (25/50/100). Emits `pageChange` and `pageSizeChange` events. |
| `ChartComponent` | `charts/` | Canvas-based chart rendering (line, area, bar) |
| `SparklineComponent` | `sparkline/` | Tiny inline sparkline chart |
| `PillComponent` | `pill/` | Status pill badge (green/amber/red/blue/grey/gold) |
| `AvatarComponent` | `avatar/` | User avatar with initials |
| `TriggerBadgeComponent` | `trigger-badge/` | Shows who triggered an action (manual vs auto) |
| `EmptyStateComponent` | `empty-state/` | Empty data state with icon and message |
| `IconsComponent` | `icons/` | Centralized SVG icon library. Available icon names include: `warning` (triangle + exclamation, used for low-stock), `mail` (envelope), `team` (users group), plus all original icons (edit, trash, eye, etc.). |
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

### `ApiClient`

- **File:** `services/api-client.service.ts`
- **Purpose:** Single HTTP wrapper used by all admin services
- **Behaviour:**
  - Resolves base URL automatically — `localhost:3000/api` in dev, `/api` in production
  - Sends `withCredentials: true` on every request so the session cookie travels with admin calls
  - Unwraps the `{ success, data }` envelope — callers receive `data` directly
- **Methods:** `get<T>(path)`, `post<T>(path, body)`, `put<T>(path, body)`, `patch<T>(path, body)`, `delete<T>(path)`

All admin services inject `ApiClient` and call `firstValueFrom()` to return Promises.

### `AuthService`

- **File:** `services/auth.service.ts`
- **Purpose:** Login, logout, session user — wraps `/api/auth/*` endpoints and exposes the current user signal

### `AdminProductsService`

- **File:** `services/admin-products.service.ts`
- **Purpose:** CRUD for the product catalog
- **Methods:**
  - `list()` → `Product[]`
  - `get(id)` → `Product`
  - `saveProduct(payload)` → `Product`
  - `update(id, partial)` → `Product`
  - `archive(id)` → `{ id }`
  - `bulkDelete(ids[])` → `{ deleted: number }`
  - `duplicate(id)` → `Product` — calls `POST /admin/products/:id/duplicate`; server creates a hidden copy with auto-incremented SKU
  - `bulkStockUpdate(updates[])` → `{ updated: number; notFound: string[] }` — calls `PATCH /admin/products/bulk-stock`

### `AdminCollectionsService`

- **File:** `services/admin-collections.service.ts`
- **Purpose:** CRUD for product collections — list, create, update, delete, reorder products within a collection

### `AdminOrdersService`

- **File:** `services/admin-orders.service.ts`
- **Purpose:** Order list, status transitions, adding notes, and timeline entries — wraps `/api/admin/orders/*`

### `AdminCustomersService`

- **File:** `services/admin-customers.service.ts`
- **Purpose:** Customer list, detail, create, update — includes linked order history — wraps `/api/admin/customers/*`

### `AdminMediaService` / `MediaUploadService`

- **Files:** `services/admin-media.service.ts`, `services/media-upload.service.ts`
- **Purpose:** `AdminMediaService` fetches the media list and handles deletes. `MediaUploadService` wraps the multipart upload to `POST /api/admin/media` with per-file progress reporting via RxJS.

### `AdminRefService`

- **File:** `services/admin-ref.service.ts`
- **Purpose:** CRUD for reference data — colors, materials, size sets
- **Interfaces exported:** `RefColor`, `RefMaterial`, `RefSizeSet`
- **Methods:** `getColors/createColor/updateColor/deleteColor`, `getMaterials/createMaterial/updateMaterial/deleteMaterial`, `getSizeSets/createSizeSet/updateSizeSet/deleteSizeSet`
- Changes here are immediately reflected in the product drawer dropdowns and catalog filters.

### `AdminSettingsService`

- **File:** `services/admin-settings.service.ts`
- **Purpose:** Store settings + team management + team invitations
- **Methods:**
  - `getStore()` → `StoreSettingsResponse` — calls `GET /admin/settings/store`
  - `patchStore(payload)` → `void` — calls `PATCH /admin/settings/store`
  - `getTeam()` → `TeamMember[]` — calls `GET /admin/settings/team`
  - `inviteTeam(payload)` → `TeamMember` — calls `POST /admin/settings/team` (legacy; use `sendInvitation` for invite links)
  - `patchTeam(id, payload)` → `TeamMember` — calls `PATCH /admin/settings/team/:id`
  - `getInvitations()` → `Invitation[]` — calls `GET /admin/settings/invitations`
  - `sendInvitation({ email, role })` → `{ email, inviteLink }` — generates token, returns shareable link
  - `revokeInvitation(id)` → `void` — calls `DELETE /admin/settings/invitations/:id`

### `StorageService`

- **File:** `services/storage.service.ts`
- **Purpose:** Tenant-scoped wrapper around `localStorage`. All keys are namespaced as `elite:{tenantId}:{base}` (falls back to `elite:local:{base}` when no user is loaded). Use this service everywhere instead of raw `localStorage` to prevent cross-tenant state bleed.
- **API:** `get(base)`, `set(base, value)`, `remove(base)`, `key(base)` — thin wrappers that inject `AuthService` to derive the tenant ID at call time.

### `StoreConfigService`

- **File:** `services/store-config.service.ts`
- **Purpose:** Shared store-level configuration persisted via `StorageService`. Currently holds `lowStockThreshold` — the number below which a product is flagged as low stock across the catalog, dashboard, and settings pages.
- **State:** `lowStockThreshold = signal<number>(8)` (readonly), persisted as `storage.key('low-stock-threshold')`
- **API:** `setLowStockThreshold(value)` — clamped to `Math.max(1, Math.round(value))`
- **Used by:** `DashboardComponent`, `CatalogComponent`, `SettingsComponent`

### `StorefrontService`

- **File:** `services/storefront.service.ts`
- **Purpose:** Manages the storefront layout with draft/publish workflow
- **State:** Two signals — `draft` and `published` (each is a `Snapshot` with blocks + timestamp)
- **Persistence:** `StorageService` — keys `storefront:draft` and `storefront:published` are tenant-scoped (`elite:{tenantId}:storefront:draft`). Loaded in the constructor (not in field initializers) so `StorageService` is available.
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

> Most sections are now connected to the real PostgreSQL API. The mock layer (`app/data/mock.ts`) is only used for data that has not yet been wired to a live endpoint (analytics charts, storefront blocks).

All mock data lives in `app/data/mock.ts`:

| Export | Type | Description |
|---|---|---|
| `PRODUCTS` | `Product[]` | 12 products (6 Elite + 6 other brands) |
| `MEDIA_INIT` | `MediaFile[]` | 17 media files (images + 3D models) |
| `CUSTOMERS` | `Customer[]` | 10 customers with profiles |
| `ORDERS` | `Order[]` | 12 orders with line items |
| `REVENUE_30D` | `RevenueDay[]` | 30 days of generated revenue data |
| `TRAFFIC` | `TrafficSource[]` | 4 traffic sources |
| `FUNNEL` | `FunnelStep[]` | 5-step conversion funnel |
| `TEAM` | `TeamMember[]` | 4 team members |
| `INTEGRATIONS` | `Integration[]` | 2 integrations |
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
| `Product` | id, name, sku, brand, price, stock, has3d, hidden, image, images[]?, variants[]?, metaTitle?, metaDesc?, slug? | Catalog, Dashboard |
| `ProductVariant` | id, sku, size, color, material, price, stock | Product drawer (Variants section) |
| `MediaFile` | id, name, kind (image/glb), size, linkedTo, preview | Media Library |
| `Order` | id, date, customer, total, payment, fulfillment, items[], trackingNumber?, timeline[]?, notes[]? | Orders |
| `OrderTimelineEntry` | id, ts, kind, detail?, actor? | Order drawer timeline |
| `OrderNote` | id, ts, author, initials, body | Order drawer internal notes |
| `Customer` | id, name, email, orders, ltv, sizePref, notes | Customers |
| `StorefrontBlock` | id, type, title, visible, config, ctaText, productIds | Storefront Editor |
| `TeamMember` | id, name, email, role, initials | Settings |
| `Invitation` | id, email, role, expires_at, created_at, invited_by_name? | Settings — pending invitations |
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

### Mobile Responsiveness

Global responsive rules are in `client/projects/admin-portal/src/styles.scss`:

- **Touch targets:** All `button`, `input`, `select`, `textarea` have a minimum size of 44×44px on mobile (`@media (max-width: 768px)`)
- **Tables:** `ap-sortable-table` has `overflow-x: auto`; `.tbl` enforces `min-width: 600px` so columns scroll within the container rather than overflowing the page
- **KPI grid:** 2-col on tablet (≤900px), 1-col on small phones (≤390px)
- **Catalog top-bar:** wraps to multi-line on ≤768px
- **Filter panel:** stacks to 1 column on ≤600px
- **Date range pills (Orders):** wrap on ≤600px
- **Settings grids (`.grid-2`, `.grid-3`):** stack to 1 column on ≤600px

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
│  StorageService     StorageService   │
│  (tenant-scoped)    (tenant-scoped)  │
│         │                 │          │
└─────────┼─────────────────┼──────────┘
          │                 │
          ▼                 ▼
    Admin edits →→→→ Shoppers see
```

Keys: `elite:{tenantId}:storefront:draft` and `elite:{tenantId}:storefront:published`

### Flow

1. Admin drags/edits sections → `saveDraft()` called automatically
2. Admin clicks "Publish" → `publish()` promotes draft to published
3. Customer-web reads from the `storefront:published` key (tenant-scoped)
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
| POS | `pos_transactions`, `pos_transaction_items`, `pos_z_reports`, `pos_parked_carts`, `product_variants.barcode` (added column), `admin_users.pos_pin_hash` (added column) |
| Dashboard KPIs / charts | `daily_metrics`, `orders`, `analytics_events`, `product_interactions` |
| Catalog · Product editor | `products`, `product_translations`, `product_variants`, `media_assets`, `media_links` (gallery role), `inventory_movements` |
| Collections | `collections`, `collection_translations`, `collection_products` (`sort_order` drives storefront order), `media_assets` (cover image) |
| Media library | `media_assets`, `media_links`, plus disk storage under `server/uploads/` (served as `/uploads/*`) via the storage adapter in `server/lib/storage.js` |
| Storefront editor | `storefront_snapshots`, `storefront_blocks`, `storefront_block_products` |
| Orders · drawer | `orders`, `order_items`, `payments`, `shipments` (tracking number), `order_timeline_entries`, `order_notes` |
| Customers · drawer | `customers`, `customer_addresses`, `orders` (history join), view `v_customer_order_stats` |
| Settings · team | `admin_users`, `store_settings`, `integrations`, `audit_events`, `team_invitations` (migration `005_team_invitations.sql`) |
| Notifications bell | `notifications` |

See [08 – Database & API Implementation](./08-database-api-implementation.md) for the endpoint-to-SQL map and the May 2026 admin-portal → schema mapping.

---

## POS System

> **Status: Planned — not yet built.** The architecture below is the target design. Implementation follows the acceptance criteria in [`docs/pos-system-plan.html`](./pos-system-plan.html). The server route (`admin-pos.route.js`), Angular page (`pages/pos/`), and POS services do not yet exist in the codebase.

The `/pos` route will be a standalone full-screen page that hides the sidebar and topbar. It is designed as a **Progressive Web App (PWA)** with offline support.

### Target Architecture

```
pages/pos/                          (planned)
├── pos.component.ts                ← Main layout (left grid + right cart, full-width dark theme)
├── pos-product-grid.component.ts   ← Scrollable 3-col product grid, tap-to-add
├── pos-cart.component.ts           ← Live order panel with qty controls, discount field
├── pos-checkout.component.ts       ← Cash / Card / Split payment modals + change calculator
├── pos-receipt.component.ts        ← ESC/POS receipt overlay (print + email + new sale)
├── pos-scanner.component.ts        ← Camera viewfinder via @zxing/browser
├── pos-refund.component.ts         ← Returns flow (scan receipt QR or lookup by order ID)
├── pos-z-report.component.ts       ← X Report (mid-shift) and Z Report (end-of-day close)
├── pos-label-print.component.ts    ← Barcode label generation (Code 128/EAN-13, 30×20mm)
└── pos-manager-pin.component.ts    ← Manager PIN overlay for restricted actions

services/                           (planned)
├── pos.service.ts                  ← Cart state (Angular signals), scan logic, transaction API
├── pos-sync.service.ts             ← Offline IndexedDB queue + background sync on reconnect
└── escpos.service.ts               ← ESC/POS byte stream builder, WebUSB/TCP printer + cash drawer
```

### Scanner Input

**USB Barcode Scanner** (HID keyboard emulation) — zero config. The search input detects ≥ 6 keystrokes arriving within 100ms and treats the sequence as a scan, not manual typing. Auto-looks up `product_variants.barcode`.

**Camera Scanner** — `@zxing/browser`, triggered by the "📷 Camera Scan" button. Uses `facingMode: 'environment'` (rear camera). Supports EAN-13, EAN-8, Code 128, QR.

### ESC/POS Thermal Printing

Receipts are sent as raw ESC/POS byte streams to a Bixolon 80mm thermal printer via:
- **WebUSB** — direct USB connection from the browser (Chrome/Edge on Windows)
- **TCP Socket** — server calls `POST /api/pos/print/receipt`, which opens a TCP socket to the printer on port 9100

After each cash sale the server sends an RJ12 cash drawer pulse (`ESC p 0x00 0x19 0xFA`) through the printer.

### Offline PWA

Service Worker caches the app shell and product catalog. Sales made offline are queued to **IndexedDB** via `pos-sync.service.ts` and auto-posted to `POST /api/pos/transactions` when connectivity is restored. A banner shows pending queue count.

### Park & Resume

Up to 5 carts can be suspended simultaneously. Parked carts are stored in `pos_parked_carts` (server, 4-hour TTL) and also in IndexedDB for offline access.

### Role-Based Security (Manager PIN)

| Action | Cashier | Manager |
|---|---|---|
| Apply discount > 10% | ✗ | ✔ (PIN) |
| Void transaction | ✗ | ✔ (PIN) |
| Process refund | ✗ | ✔ (PIN) |
| Run Z Report (close day) | ✗ | ✔ (PIN) |
| Manual cash drawer open | ✗ | ✔ (PIN) |

PINs are stored as bcrypt hashes in `admin_users.pos_pin_hash`. The PIN overlay does not log out the active cashier session.

### X Report & Z Report

- **X Report** — read-only mid-shift snapshot. Any role can run it. Does not reset counters.
- **Z Report** — end-of-day close. Manager PIN required. Saves an immutable signed record to `pos_z_reports`. Includes: gross sales, refunds, net sales, cash/card breakdown, opening float, expected cash, physical cash count, and over/short variance.

### Barcode Label Printing

Labels are generated client-side using `bwip-js`. Format: Code 128 (alphanumeric SKU) or EAN-13 (numeric). Size: 30×20mm. Compatible with Dymo LabelWriter 450 and Zebra ZD220. Bulk print is available from the Catalog page (select variants → "Print Labels").

---

## Related Documents

- [03 – Client Web](./03-client-web.md) — The storefront app
- [05 – API Server](./05-api-server.md) — Express API details
- [06 – White-Label Guide](./06-white-label-guide.md) — Rebranding the admin
- [08 – Database & API Implementation](./08-database-api-implementation.md) — PostgreSQL schema and endpoint map
