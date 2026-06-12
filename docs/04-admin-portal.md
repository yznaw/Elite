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
| `/dashboard` | `DashboardComponent` | Live KPIs, revenue chart, top-products-by-price heatmap, recent orders — all sourced from `/api/admin/{orders,products,customers}`. No `mock.ts` after login. **Date Range Filter** (Today / 7 Days / 30 Days / 90 Days) pill-bar above KPIs. **Low Stock KPI card** — shows count of products with stock between 1 and the configurable threshold (default: 8, set via `StoreConfigService`). Clicking the card navigates to `/catalog?stock=low`. Card shows 0 when all items are stocked. |
| `/catalog` | `CatalogComponent` | Product grid **and list** view (toggle persisted via `StorageService` — tenant-scoped). Search (matches name, SKU, **and brand**), status quick-filter (All / Active / Hidden / **Out of Stock** (red badge) / **Low Stock** (amber badge)), sort (Name A–Z, Price ↑↓, Stock ↑↓, Newest). The **Low Stock** filter pill is pre-activated via `?stock=low` from the dashboard KPI card. Low-stock threshold from `StoreConfigService.lowStockThreshold()`. **Advanced filter panel**: collection, **brand** (auto-populated from loaded products), color (from `ref_colors`), price range, page size (25/50/100/All). Active filters shown as dismissible chips. **Bulk Select**: Select All, Set Status, Delete with confirm. **Export CSV** (SKU, Name, Brand, Price, Stock, Status, Variants). **Product drawer** section order (Shopify-style): ① Image Gallery ② Product Info (title EN/AR, brand, SKU) ③ Pricing & Stock ④ Variants ⑤ Description ⑥ Organization (collections + related) ⑦ SEO ⑧ Sync ⑨ Danger Zone. **Variant table** (compact single-row per variant, researched against Shopify / WooCommerce / BigCommerce / Etsy): always-visible columns — Photo · Color · Size · Stock · Price · SKU; collapsible columns (⌄ expand) — Material · Cost · Margin (auto-calculated). Stock input turns red when 0 / amber when < 5. Price shows inline "QAR" prefix. SKU is always visible (used for warehouse/POS daily). Color→image linking: click the photo cell in each variant row to open an image picker popover — maps `imageColors[imageUrl] = colorName` so the storefront shows the correct image per color. Image gallery thumbnails show a read-only color badge for linked images. "Generate sizes" wizard. **`ap-save-bar` component**: green sliding bar with Discard / Save changes; appears when the form is dirty, hides when idle. **Arabic Name field** (`nameAr`) stored in `product_translations`. **Cost price per variant** (`cost_price_cents`) with real-time **margin formula** (color-coded pill: green ≥ 40 %, amber 20–40 %, red < 20 %). **Stock is auto-computed** from variant sum when variants exist. **SEO fields** (`meta_title`, `meta_desc` 160-char counter, slug). **Duplicate Product**. **Bulk Import** + **Stock Update mode** (Dry-Run, Retry Failed, Import History). |
| `/reference` | `ReferenceComponent` | Reference data management — **Colors** (name EN/AR + hex, inline color picker, swatch preview), **Materials** (name EN/AR), **Size Charts** (named size sets with comma-editable size arrays). Full CRUD for each, changes immediately available as dropdowns in the product drawer and filters in the catalog. Owner/admin only. |
| `/collections` | `CollectionsComponent` | Grouping products into collections with **sub-collection hierarchy**. Top-level collections show sub-collections as chips below their card; clicking a chip opens it. **"Add sub-collection"** quick-add button per parent. Search mode switches to flat list. **Collection drawer:** editable **URL Handle** (`/collection/{handle}` preview), **Parent Collection** selector (dropdown, self + descendants excluded, cycle-protected on server), cover image (drag/drop + URL paste). **Manage Products section:** grid/list view toggle — grid cards are draggable; list view shows explicit drag handles + ↑/↓ buttons for precise reordering (touch-friendly). Order is persisted to `collection_products.sort_order`. **Product drawer Organization section** now groups collections by parent with indented sub-collection checkboxes. DB migration: `007_sub_collections.sql` adds `parent_id` to `collections`. |
| `/media` | `MediaComponent` | Live grid from `GET /api/admin/media`, real multipart upload (drag/drop or browse, per-file progress), auto-link by SKU, detail drawer. **Google Drive import:** "Google Drive" button opens a modal — paste a file or folder URL (folder requires `GOOGLE_DRIVE_API_KEY` env var). Images are downloaded, saved to storage, and **auto-linked by SKU** via 4-tier matching: (1) folder name = SKU, (2) filename stem = SKU, (3) filename contains SKU, (4) two-segment prefix matches SKU start. Success toast reports how many were auto-linked. **Set as Default Fallback** button in the detail drawer saves the image URL to tenant config (`PATCH /api/admin/settings/store { config: { defaultImage } }`). Delete removes the DB row and the file from storage. |
| `/storefront` | `StorefrontComponent` | **3-tab unified content editor** with sticky Publish/Preview bar. **Tab: Home Page** — sub-tabs: Section Order (drag/drop visibility), Landing Hero (heroSlider items + feature callouts, EN/AR CTA), Collections (3 tiles + featured collections picker), Promotion Section (image/title/body/CTA), Craft Promise (3 cards EN/AR), Stats Reel (4 values EN/AR). **Tab: Our Story** — sub-tabs: Hero, Intro, Chapters (4), Quote, Atelier. **Tab: Contact Us** — sub-tabs: Page Header (EN/AR headline), Info Blocks (3 blocks with lines), Phone & Promise. All image slots have Upload + Pick from Media. Save Content writes to `PATCH /api/admin/storefront-content`; Publish Layout writes to `POST /api/admin/storefront/publish`. |
| `/home-content` | — | **Redirects to `/storefront`** (deprecated — all editing moved into the Storefront tabs). |
| `/orders` | `OrdersComponent` | Searchable order table, payment/fulfillment filters, **Date Range filter** (All Time / Today / This Week / This Month / Custom — custom shows `date from/to` inputs). Active date range displayed as a dismissible chip. `clearFilters()` resets date range along with other filters. **CSV export** of the current filtered set (UTF-8 BOM), full-height drawer with status workflow stepper, tracking number, internal notes & timeline, **Print Invoice** button that opens a new browser tab with a fully formatted printable invoice (brand header, shipping address, line-items table, totals, `@media print` styles). |
| `/customers` | `CustomersComponent` | Customer table/cards, tier filter, **Add Customer** create flow, fully editable detail drawer with real linked-orders history (rows navigate to /orders?id=…) |
| `/analytics` | `AnalyticsComponent` | Revenue chart, traffic sources, conversion funnel |
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
| `SidebarComponent` | `sidebar/` | Fixed left navigation (desktop) / spring-physics drawer (tablet). Footer card shows signed-in user with Sign-out. On ≤768 px forced off-screen — bottom nav owns mobile navigation. |
| `TopbarComponent` | `topbar/` | Top bar with title/breadcrumb, search overlay, language switcher, notification bell, and **avatar dropdown** (name/role/email/logout). On phone shows a `←` back button (via `Location.back()`) on secondary pages; hidden on primary tab pages. |
| `BottomNavComponent` | `bottom-nav/` | **Phone-only** (`display: none` at ≥769 px). Fixed 56 px tab bar: Dashboard · Catalog · Orders · Customers · More. Smart-hide on scroll-down. Unread badge from `NotificationService`. More tab opens a slide-up sheet with 6 secondary nav items + logout. |

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
| `IconsComponent` | `icons/` | Centralized SVG icon library. Available icon names: `dash`, `catalog`, `collections` (envelope stack — sidebar nav for Collections, collection empty states), `store`, `orders`, `users`, `chart`, `sync`, `settings`, `media`, `search`, `bell`, `plus`, `x`, `drag`, `edit`, `trash`, `eye`, `upload`, `download`, `cube`, `link`, `unlink`, `wand`, `check`, `arrow`, `arrowUp`, `arrowDn`, `csv`, `clock`, `spinner`, `list`, `filter`, `grid`, `rows`, `copy`, `print`, `warning`, `mail`, `info`, `team`, `reference` (tag/label — sidebar nav for Reference data), `hierarchy` (nested-list — sub-collection tree). See `icon.component.ts` for SVG definitions. |
| `RichTextComponent` | `rich-text/` | Lightweight `contenteditable` editor with bold/italic/underline/list/link/clear toolbar. Honours `dir` for RTL editing. Used for product descriptions (EN + AR). |

### Feedback

| Component | Folder | Description |
|---|---|---|
| `ToastComponent` | `toast/` | Stackable toast notifications. On ≤768 px stack anchors bottom-centre above the bottom nav bar (safe-area aware). |
| `SpinnerComponent` | `spinner/` | Loading spinner overlay |
| `SkeletonComponent` | `skeleton/` | Shimmer loading placeholders. Variants: `line`, `card`, `table-row` (stacks vertically on mobile), `kpi`, `chart`, `order-card` (matches Phase 3 mobile order card layout). All variants respect `prefers-reduced-motion`. |
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
- **`mediaUrl(path)`** — converts `/uploads/abc.jpg` → `/api/uploads/abc.jpg` so every media URL routes through the Nginx `/api` proxy in production. Returns absolute `https://` or `data:` URLs unchanged. Used by `AdminMediaService`, `AdminProductsService`, `MediaUploadService`, and `HomeContentComponent`.

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
- **`SaveCollectionPayload`** now accepts `parentId?: string | null` — server validates it (not self, not descendant, must exist in same tenant)
- Product `sort_order` within a collection is set server-side from the `productIds` array index

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
| `MEDIA_INIT` | `MediaFile[]` | 17 media files (images) |
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
| `Product` | id, name, nameAr?, sku, brand, price, stock, hidden, image, images[]?, variants[]?, metaTitle?, metaDesc?, slug? | Catalog, Dashboard |
| `ProductVariant` | id, sku, size, color, material, price, stock, costPrice? | Product drawer (Variants section) |
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

## Variant Table Design

### Field Order Rationale

The variant table column order was researched against Shopify, WooCommerce, BigCommerce, and Etsy. Every major platform keeps these fields always visible:

| Column | Always visible | Why |
|---|---|---|
| **Photo** | ✅ | Instant visual ID; first on all platforms |
| **Color** | ✅ | Primary differentiator; color swatch + select |
| **Size** | ✅ | Primary differentiator; centered mono text |
| **Stock** | ✅ | Critical ops metric; live colour: red = 0, amber < 5 |
| **Price** | ✅ | Core commercial field; inline "QAR" prefix |
| **SKU** | ✅ | All platforms keep it visible — warehouse, POS, barcodes |
| Material | ⌄ collapsible | Set once at setup, never changed day-to-day |
| Cost | ⌄ collapsible | Finance input entered once; drives margin |
| Margin | ⌄ collapsible | Read-only calculated output; "set cost to calculate" hint |

### CSS Grid

```
44px  minmax(120px,1.7fr)  60px   68px    96px    minmax(100px,1.3fr)  54px
Photo Color                 Size   Stock   Price   SKU                  Actions
```

### Color → Image Linking

Each color variant can be linked to one gallery image via the photo cell in the row:
- Click the photo cell → image picker popover opens (to the right)
- Selecting an image stores `imageColors[imageUrl] = colorName` in the product form
- The storefront uses this map to show the correct image for each color
- Gallery thumbnails display a read-only color badge for linked images
- A transparent full-screen backdrop closes the picker on outside click

### Collapsible Detail

The `⌄` expand button opens an inline detail panel with:
- **Material** — dropdown from `RefMaterial` reference data
- **Cost (QAR)** — cost price input; drives margin calculation
- **Margin** — auto-calculated: `((price − cost) / price) × 100`; colour-coded pill

### Responsive behaviour (≤ 600 px)

SKU column and Margin field are hidden on narrow screens. Detail panel collapses to 2 columns (Material + Cost).

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
| `ap-save-bar` | **Shared save bar component** — `[dirty]`, `[saving]`, `[justSaved]`, `[shake]`, `[label]`, `[saveLabel]`, `[discardLabel]` inputs; `(saved)`, `(discarded)` outputs. Uses host binding to apply `.save-bar-top` so global CSS rules apply automatically. Used by: product-drawer, collection-drawer, customer-drawer, section-drawer, home-content, settings (General tab). |
| `.save-bar-top` / `.save-bar-top.dirty` / `.save-bar-top.shake` | Global CSS: green sliding bar (height 0→54px), shake animation on validation error |
| `.overlay` / `.drawer` | Drawer/modal overlays |

### Mobile Responsiveness — Implemented Architecture

All 6 phases of the mobile UX plan are **complete** as of 2026-06-12. See [`docs/mobile-ux-plan.html`](./mobile-ux-plan.html) for the full interactive task tracker.

#### Breakpoints

| Token | Range | Device | Nav model |
|---|---|---|---|
| `xs` | ≤ 480 px | Small phone | Bottom tab bar |
| `sm` | 481–768 px | Large phone | Bottom tab bar |
| `md` | 769–1024 px | Tablet | Sidebar drawer |
| `lg` | ≥ 1025 px | Desktop | Fixed sidebar |

#### Phase 1 — Foundation (`styles.scss`, `app.component.scss`, `topbar.component.ts`)

- **Body scroll:** `overflow: hidden` stays on body (viewport-locked); `-webkit-overflow-scrolling: touch` added to `.scroll-area` for iOS momentum
- **Topbar:** 64 px (desktop) → 60 px (tablet) → **52 px** (phone); crumb hidden at ≤480 px
- **Base font:** 13 px (desktop/tablet) → **14 px** (≤768 px); inputs stay at `font-size: 16px` to prevent iOS auto-zoom
- **Touch targets:** `min-height/width: 44 px` at ≤1024 px; upgraded to **48 px** at ≤768 px for primary controls; `inp-sm` stays 38 px
- **Search overlay:** tapping the search icon on phone opens a `position: fixed; inset: 0` full-screen overlay with 52 px input and a back-arrow close button. Escape key dismisses it. Desktop retains the inline pane below the topbar.

#### Phase 2 — Navigation (`bottom-nav.component.ts`, `sidebar.component.ts`)

- **`BottomNavComponent` (`ap-bottom-nav`)** — fixed 56 px tab bar, visible only at ≤768 px via CSS. Five tabs: Dashboard · Catalog · Orders · Customers · More. Gold indicator line on the active tab. Smart-hide on scroll-down / show on scroll-up (passive listener on `.scroll-area`). Unread badge on More tab from `NotificationService.unreadCount`. Closes on `NavigationEnd`.
- **More slide-up sheet** — 6 secondary items (Media · Storefront · Collections · Analytics · Reference · Settings), drag handle, backdrop blur, Logout button in footer. Spring-physics animation `cubic-bezier(.34,1.1,.64,1)`.
- **Sidebar on phone (≤768 px):** forced off-screen (`inset-inline-start: -280px !important; visibility: hidden`) regardless of toggle signal — bottom nav is the sole mobile nav. Hamburger hidden via `display: none !important`.
- **Sidebar on tablet (769–1024 px):** drawer upgraded to 260 px width, spring-physics transition, backdrop blur 4 px, swipe-right gesture (80 px delta, RTL-aware) closes it.
- **Scroll-area safe-area padding:** `padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 16px)` on ≤768 px so content is never hidden behind the nav bar.

#### Phase 3 — Card views (`catalog`, `orders`, `customers`, `media`, `collections`)

- **Catalog:** `effectiveView` computed forces `'grid'` on ≤768 px regardless of the persisted toggle. View toggle hidden on phone. Advanced filter panel becomes a `position: fixed` bottom sheet with backdrop + `sheetUp` animation on ≤768 px. Filter button shows active-filter badge.
- **Orders:** `isMobile` signal; on ≤768 px renders `.order-cards` stacked list instead of `ap-sortable-table`. Each card has a 4 px inline-start border coloured by fulfillment status (amber / blue / green / grey).
- **Customers:** `effectiveView` forces cards at ≤900 px (already existing). Gold/green 56 px FAB (`customers-fab`) floats bottom-right above the nav bar; toolbar Add button hidden on mobile.
- **Media:** 2-column grid on ≤480 px (3-col on 481–720 px, auto-fill on wider).
- **Collections:** `.sub-col-chips` become a single horizontal scroll row on ≤640 px instead of a multi-row wrap.
- **Pagination:** `«` / `»` first/last jump buttons hidden on ≤600 px — only Prev / Next shown.

#### Phase 4 — Drawers & Forms (`styles.scss`, `product-drawer.component.ts`)

- **Drawer animation:** all `.drawer` elements slide from the **bottom** on ≤768 px (`@keyframes drawerUp`, `inset: 0`), replacing the desktop `slideRight`. RTL `slideLeft` also overridden with `drawerUp` on phone. Safe-area bottom padding added to `.drawer-foot`.
- **Inputs:** `min-height: 48 px` for `input.inp`, `select.inp`, `textarea.inp` at ≤768 px.
- **Product drawer sections:** 7 of the 9 sections (Pricing, Variants, Description, Organization, SEO, Sync, Danger Zone) are collapsible on mobile. Toggling uses `openSections = signal(new Set(['gallery', 'basics', 'pricing', 'variants']))` — first four open by default. `[style.display]` binding keeps DOM alive so form state is never lost on collapse. Chevron icon rotates 180° when open.

#### Phase 5 — Page Polish

- **Dashboard:** Chart card legend row hidden on ≤640 px. Heat-row thumbnails 32 px, gap 8 px on phone. Date range pills full-width equal-flex on ≤768 px. Custom date inputs full-width (`width: 100%; flex: 1`).
- **Analytics:** Traffic sources card replaced inline `grid-template-columns: auto 1fr` with `.traffic-inner` class that stacks pie + legend vertically on ≤600 px. Range filter row scrolls horizontally on ≤640 px.
- **Settings:** `.tabs` bar scrolls horizontally on ≤640 px (`overflow-x: auto; flex-wrap: nowrap`); each `.tab` is `flex-shrink: 0`.
- **Collections:** Sub-collection chips horizontal scroll on ≤640 px.
- **Login / Auth:** Shell padding uses `env(safe-area-inset-*)` on all four sides for iPhone notch / Dynamic Island. All inputs already have `autocomplete` attributes.
- **Orders toolbar:** Row 1 = Search (flex:1) + Export. Row 2 = Payment filter + Fulfillment filter. Export label hidden at ≤480 px (icon-only).
- **Catalog toolbar:** 3-row structure — Row 1: search (full width) · Row 2: status pills (scrollable) · Row 3: sort/view/filter/select (left) + export/import/+New (right). On ≤640 px text labels hidden, New Product button gets `flex: 2`.

#### Phase 6 — Luxury Details

- **Toast position:** on ≤768 px stack anchors `bottom: calc(64px + env(safe-area-inset-bottom))`, `inset-inline: 12px`, each toast `width: 100%` — native bottom-notification pattern.
- **Skeleton:** new `'order-card'` variant matching Phase 3 mobile order card. `'table-row'` stacks vertically on ≤768 px. Both freeze shimmer under `prefers-reduced-motion`.
- **`prefers-reduced-motion`:** Single `@media (prefers-reduced-motion: reduce)` block in `styles.scss` disables: `pageFade`, drawer/sheet animations, toast entrance, bottom-nav transition, save-bar expand, filter sheet, sidebar backdrop, nav-tab & chevron transitions.
- **Back button (`topbar.component.ts`):** `showBack` computed returns `true` on ≤768 px when the current route is NOT a primary tab page (dashboard / catalog / orders / customers). `← ` chevron button calls `Location.back()`. Hidden on desktop via CSS.

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
| Collections | `collections` (`parent_id` self-ref FK added in migration `007_sub_collections.sql`), `collection_translations`, `collection_products` (`sort_order` drives storefront order), `media_assets` (cover image) |
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
