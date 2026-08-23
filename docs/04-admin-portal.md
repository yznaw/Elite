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
| `/catalog` | `CatalogComponent` | Product grid **and list** view (toggle persisted via `StorageService` — tenant-scoped). Search (matches name, SKU, **and brand**), status quick-filter (All / Active / Hidden / **Out of Stock** (red badge) / **Low Stock** (amber badge)), sort (Name A–Z, Price ↑↓, Stock ↑↓, Newest). The **Low Stock** filter pill is pre-activated via `?stock=low` from the dashboard KPI card. Low-stock threshold from `StoreConfigService.lowStockThreshold()`. **Advanced filter panel**: collection, **brand** (auto-populated from loaded products), **color** (custom swatch picker — hex dot or texture thumbnail per color, from `ref_colors`; supports `?color=X` URL param from reference page usage badge), price range, page size (25/50/100/All). Active filters shown as dismissible chips with color swatch dot. **Bulk Select**: Select All, Set Status, Delete with confirm. **Export CSV** (SKU, Name, Brand, Price, Stock, Status, Variants). **Product drawer** section order (Shopify-style): ① Image Gallery ② Product Info (title EN/AR, brand, SKU) ③ Pricing & Stock ④ Variants ⑤ Description ⑥ Organization (collections + related) ⑦ SEO ⑧ Sync ⑨ Danger Zone. **Variant table** (compact single-row per variant, researched against Shopify / WooCommerce / BigCommerce / Etsy): always-visible columns — Photo · Color · Size · Stock · Price · SKU; collapsible columns (⌄ expand) — Material · Cost · Margin (auto-calculated) · **Size note EN/AR** (a detail this size has and others do not, e.g. a back zipper on the small sizes; shown on the storefront beside the picked size). Stock input turns red when 0 / amber when < 5. Price shows inline "QAR" prefix. SKU is always visible (used for warehouse/POS daily). Color→image linking: click the photo cell in each variant row to open an image picker popover — maps `imageColors[imageUrl] = colorName` so the storefront shows the correct image per color. Image gallery thumbnails show a read-only color badge for linked images. "Generate sizes" wizard. **`ap-save-bar` component**: green sliding bar with Discard / Save changes; appears when the form is dirty, hides when idle. **Arabic Name field** (`nameAr`) stored in `product_translations`. **Cost price per variant** (`cost_price_cents`) with real-time **margin formula** (color-coded pill: green ≥ 40 %, amber 20–40 %, red < 20 %). **Stock is auto-computed** from variant sum when variants exist. **SEO fields** (`meta_title`, `meta_desc` 160-char counter, slug). **Duplicate Product**. **Bulk Import** + **Stock Update mode** (Dry-Run, Retry Failed, Import History). **Description section** is split into three purpose-named fields: **Hook** (`shortEn`/`shortAr`, plain text, ~90 chars) seeds the home hero tagline when a product is linked to a slide; **Short description** (`teaserEn`/`teaserAr`, plain text, ~160 chars) shows directly under the product name on the storefront product page; **Material & Care** (`careEn`/`careAr`, rich text, stored in the `care_instructions` JSONB column) fills the Material & Care section on the storefront product page, falling back to the legacy `enDesc`/`arDesc` long description for products saved before this split existed. **SKU renaming** when a color group is renamed now also updates the SKU segment in all affected variants automatically. |
| `/reference` | `ReferenceComponent` | Reference data management — **Colors** (name EN/AR + hex, inline color picker, swatch preview), **Materials** (name EN/AR), **Size Charts** (named size sets with comma-editable size arrays). Full CRUD for each, changes immediately available as dropdowns in the product drawer and filters in the catalog. Owner/admin only. |
| `/collections` | `CollectionsComponent` | Grouping products into collections with **sub-collection hierarchy**. Top-level collections show sub-collections as chips below their card; clicking a chip opens it. **"Add sub-collection"** quick-add button per parent. Search mode switches to flat list. **Collection drawer:** editable **URL Handle** (`/collection/{handle}` preview), **Parent Collection** selector (dropdown, self + descendants excluded, cycle-protected on server), cover image (drag/drop + URL paste). **Manage Products section:** grid/list view toggle — grid cards are draggable; list view shows explicit drag handles + ↑/↓ buttons for precise reordering (touch-friendly). Order is persisted to `collection_products.sort_order`. **Product drawer Organization section** now groups collections by parent with indented sub-collection checkboxes. DB migration: `007_sub_collections.sql` adds `parent_id` to `collections`. |
| `/media` | `MediaComponent` | Live grid from `GET /api/admin/media`, real multipart upload (drag/drop or browse, per-file progress), auto-link by SKU, detail drawer. **Google Drive import:** "Google Drive" button opens a modal — paste a file or folder URL (folder requires `GOOGLE_DRIVE_API_KEY` env var). Images are downloaded, saved to storage, and **auto-linked by SKU** via 4-tier matching: (1) folder name = SKU, (2) filename stem = SKU, (3) filename contains SKU, (4) two-segment prefix matches SKU start. Success toast reports how many were auto-linked. **Set as Default Fallback** button in the detail drawer saves the image URL to tenant config (`PATCH /api/admin/settings/store { config: { defaultImage } }`). Delete removes the DB row and the file from storage. |
| `/storefront` | `StorefrontComponent` | **3-tab unified content editor** with sticky Publish/Preview bar. **Tab: Home Page** — sub-tabs: Section Order (drag/drop visibility), Landing Hero (heroSlider items with name, subtitle, EN/AR short description, image, alt, linked product + up to 4 colour swatches, feature callouts, EN/AR CTA), Collections (3 tiles + featured collections picker), Promotion Section (image/title/body/CTA), Craft Promise (3 cards EN/AR), Stats Reel (4 values EN/AR). **Tab: Our Story** — sub-tabs: Hero, Intro, Chapters (4), Quote, Atelier. **Tab: Contact Us** — sub-tabs: Page Header (EN/AR headline), Info Blocks (3 blocks with lines), Phone & Promise. All image slots have Upload + Pick from Media. Save Content writes to `PATCH /api/admin/storefront-content`; Publish Layout writes to `POST /api/admin/storefront/publish`. |
| `/home-content` | — | **Redirects to `/storefront`** (deprecated — all editing moved into the Storefront tabs). |
| `/orders` | `OrdersComponent` | Searchable order table, payment/fulfillment filters, **Date Range filter** (All Time / Today / This Week / This Month / Custom — custom shows `date from/to` inputs). Active date range displayed as a dismissible chip. `clearFilters()` resets date range along with other filters. **CSV export** of the current filtered set (UTF-8 BOM). **Production hardening (2026-06):** skeleton table/card loaders while `loading()` is true; `loadError` signal shows a red error banner with Retry button on initial load failure (silent background refresh swallows errors); 300ms RxJS search debounce via `Subject` + `takeUntil` teardown; 15s background polling syncs the list while the drawer is open; `OrderDrawerComponent` now routes all `PATCH /status` calls through `safeUpdateStatus()` which re-fetches the order from the server on API error to resync local state. Full-height drawer with status workflow stepper, tracking number, internal notes & timeline, **Print Invoice** button that opens a new browser tab with a fully formatted printable invoice. |
| `/customers` | `CustomersComponent` | Customer table/cards view (toggle persisted), **Add Customer** create flow (synthesises a draft, discards on close without save), fully editable detail drawer with real linked-orders history (rows navigate to `/orders?id=…`). **Production hardening (2026-06):** skeleton loaders while `loading()` is true; `loadError` banner with Retry; 300ms debounced search; **Export CSV** wired (was previously a no-op button); EU size pill hidden when `sizePref` is `0` or `null`. Customer drawer fetches orders from `GET /admin/customers/:id/orders` (matches by `customer_id` OR `customer_email`), 30s polling with silent refresh + "Updated HH:MM" timestamp, `phone` field, async save that only shows "Saved" after API response and reverts to dirty on error, soft-delete that preserves order history. |
| `/analytics` | `AnalyticsComponent` | Revenue chart, traffic sources, conversion funnel |
| `/settings` | `SettingsComponent` | **General tab:** Store info (name, currency, timezone, language — `PATCH /api/admin/settings/store`) + **Low Stock Threshold** number input — sets `StoreConfigService.lowStockThreshold()`, persisted tenant-scoped via `StorageService`, consumed by catalog and dashboard. **Team tab:** team members (list, role change, status toggle — `GET/PATCH /api/admin/settings/team/:id`). **Team Invitations** — invite by email + role (`POST /api/admin/settings/invitations`), shows generated invite link in a copy-able input, lists pending invitations with revoke button. **Integrations tab.** Owner/admin only. |
| `/accept-invite` | `AcceptInviteComponent` | Public — reads `?token=` query param, validates via `GET /api/invitations/validate`, shows name/password/confirm form. On submit calls `POST /api/invitations/accept`. Redirects to login on success. Invitation token is single-use and expires after 48 h. |
| `/pos` | `PosComponent` | **Point of Sale.** Full-screen cashier interface with product/SKU/barcode search, customer link/walk-in, cash/manual-card checkout, reserved receipt numbers, persistent QZ hardware with automatic reconnect, IndexedDB offline queue/freshness guard, parked carts, refunds, voids, morning shift recovery, shift summary/Z close, live shared-stock events, and manager PIN approvals. Owner/admin/manager/cashier. See [12 – POS System and Integration](./12-pos-system.md). |
| `/stocktake` | `StocktakeComponent` | **Shared-inventory operations.** Owner/admin only. Start blind/open counts, count/recount variants, block unresolved disagreements, post race-safe discrepancies without undoing sales made during counting, and review immutable history. Physical replenishment between the two shops and stock room is deliberately not entered here because it does not change the shared total. |
| `/diagnostics` | `DiagnosticsComponent` | **Errors & audit trail.** Owner/admin only. **Errors tab:** application errors grouped by fingerprint (repeats increment a count instead of adding rows) from three sources — the server, the register/admin browsers via `POST /api/client-logs`, and CSP violation reports. Filter by source/severity/open-resolved, search by message, code, route **or the reference code the cashier reads off an error toast**, expand for stack + context, and mark resolved (a recurrence then opens a new entry, so regressions stay visible). **Audit tab:** `audit_events` — the audit trail has existed since migration 001 and had no UI at all before this; filter by action, date range, or `requestId` to see exactly what a given request did. Nav entry appears for owner/admin only, in both the sidebar and the mobile bottom-nav. See [24 – Logging & Observability](./24-logging-observability-plan.md). |
| `**` | — | Redirects to `/dashboard` |

> Every route except `/login`, `/forgot-password`, `/reset-password`, and `/accept-invite` is gated by `authGuard` (`canMatch`). `/settings`, `/reference`, `/stocktake`, and `/diagnostics` are additionally gated by `roleGuard(['owner','admin'])`. `/pos` is gated by `roleGuard(['owner','admin','manager','cashier'])`. See [08 – Database & API Implementation › Authentication](./08-database-api-implementation.md#authentication-session-based) for the server side and the full reset-password flow.

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
| `IconsComponent` | `icons/` | Centralized SVG icon library. Available icon names: `dash`, `catalog`, `collections` (envelope stack — sidebar nav for Collections, collection empty states), `store`, `orders`, `users`, `chart`, `sync`, `settings`, `media`, `search`, `barcode` (vertical bars — variant "Print Label" action), `bell`, `plus`, `x`, `drag`, `edit`, `trash`, `eye`, `upload`, `download`, `cube`, `link`, `unlink`, `wand`, `check`, `arrow`, `arrowUp`, `arrowDn`, `csv`, `clock`, `spinner`, `list`, `filter`, `grid`, `rows`, `copy`, `print`, `warning`, `mail`, `info`, `team`, `reference` (tag/label — sidebar nav for Reference data), `hierarchy` (nested-list — sub-collection tree). See `icon.component.ts` for SVG definitions. |
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
  - **GET retry:** `get<T>()` automatically retries twice (500ms, then 1000ms backoff) for transient network errors (`status 0`, `502`, `503`, `504`). Deterministic failures (401, 403, 404, 422) are NOT retried. Mutating requests (POST/PATCH/PUT/DELETE) are never auto-retried — idempotency keys handle those at the server.
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
- **Methods:** `list(params?: OrderListParams)`, `get(id)`, `updateStatus(id, payload: OrderStatusPayload)`, `addNote(id, body)`, `rebookDelivery(id)` → retries NBOX booking, returns updated `Order`
- **`list()`** now accepts `OrderListParams` (`{ page, limit, q, payment, fulfillment, from, to }`) and returns `OrderListResponse` (`{ orders[], total, page, limit, pages }`). All filtering and pagination is server-side.
- **`OrderListParams`** and **`OrderListResponse`** are exported interfaces.
- **`OrderStatusPayload`** is exported and used by `OrderDrawerComponent.safeUpdateStatus()` which re-fetches on error

### `AdminCustomersService`

- **File:** `services/admin-customers.service.ts`
- **Purpose:** Customer list, detail, create, update, soft-delete, restore, and linked order history — wraps `/api/admin/customers/*`
- **Methods:** `list()`, `get(id)`, `getOrders(id)` → `Order[]`, `create(payload)`, `update(id, payload)`, `remove(id)` (soft-delete), `restore(id)`
- `getOrders()` fetches from `GET /admin/customers/:id/orders` — matches orders by both `customer_id` FK and `customer_email` for full history attribution

### `AdminMediaService` / `MediaUploadService`

- **Files:** `services/admin-media.service.ts`, `services/media-upload.service.ts`
- **Purpose:** `AdminMediaService` fetches the media list and handles deletes. `MediaUploadService` wraps the multipart upload to `POST /api/admin/media` with per-file progress reporting via RxJS.
- **`validate(file, maxBytes = 50 MB)`:** local pre-flight check (type + size) shared by every upload call site, so mismatches are rejected before a round-trip. `maxBytes` is a parameter, not hard-coded — the product drawer's pre-save gallery (see below) calls it with a much lower cap, since that path doesn't hit this multipart endpoint at all.

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
  - `getPosPolicy()` / `updatePosPolicy({ selfCloseShiftEnabled?, emergencySelfApprovalEnabled? })` → `PosPolicy` — calls `GET`/`PUT /admin/pos-security/policy`. Backs the two switches in the **Approvals** card on the Devices & Security tab: self-close of one's own shift, and letting a manager approve refunds/voids with their own PIN. Either field may be sent alone. Read is owner/admin, write is owner-only. See [12 – POS System › The Approvals card](./12-pos-system.md).

> **Devices & Security lists show live rows only.** Revoked registers and used/expired/revoked setup codes are filtered out of both tables (`visibleRegisters` / `visibleTokens` computed signals) — nothing on the page can act on them and they buried the real devices. The rows are still stored server-side for the audit trail; this is a display filter, not a delete.

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

### Hero Slide: Linked Product & Colour Swatches

In **Storefront → Home Page → Landing Hero**, each slide can be linked to a product and given up to 4 featured colourways. These render as tappable swatches under the mobile hero.

**Editing flow**

Each slide card is ordered as three steps, so the product is linked *before* the copy it fills in:

| Step | Section | What it does |
|---|---|---|
| 1 | Linked Product | Pick the product; everything below fills in from it |
| 2 | Hero Copy | Name, subtitle, EN/AR description, alt text |
| 3 | Feature Callouts | Desktop-only annotation pills (collapsed by default) |

**Linking a product fills the slide automatically.** From the product it derives:

- **Name** from the product name
- **Subtitle** as `Arabic name / Brand`, the bilingual shape the hero splits on
- **Descriptions** from the product's **short description**. If that is empty it falls back to the first sentence of the long description with markup stripped, capped near 18 words
- **Alt text** as `Name by Brand`
- **Featured colours**, up to 4, preferring ones with a colour defined in Reference Data so the swatch row works immediately
- **Each colour's hero shot**, seeded from the product's gallery colour tagging as a starting point

**Your edits are never overwritten.** Fields you have already filled in are left alone when a product is linked or changed. **Refill** re-pulls everything from the product and does overwrite, for when the product has been updated and you want the slide to match.

Slides that were linked to a product before auto-fill existed are backfilled when the editor loads: any blank derivable field is filled from the product. Only empty fields are touched and the content is not marked dirty, so it persists on the next real save. The backfill runs from whichever of the products or content request finishes last, since either order is possible.
**Choosing the featured colours**

The colour grid lists the product's own colours first, then the rest of the Reference Data library. Click to toggle; the cap is 4 and further chips disable once reached. Library colours the product does not carry are dimmed and italicised, and selecting one raises a warning, since the "+" link opens that product where the colourway will not be found.

**Colour source and the missing-hex warning**

Swatch colours come from `ref_colors` (**Reference Data → Colors**), never from the slide itself. One colour edited there updates every swatch across the app.

A colour with no `ref_colors` entry **cannot render and is hidden on the storefront**. The editor surfaces this in two places: the chip shows a hatched dot with a warning icon, and a warning line lists the affected colour names. Fix it by adding the colour under Reference Data, where the existing editor provides a colour picker, hex field, and optional swatch image.

This matters because the catalog uses far more colour names than `ref_colors` currently defines, so linking a product whose colours are undefined produces an empty swatch row until they are added.

**Hero image per colour**

Each featured colour gets its own hero shot, set under **Hero Image Per Colour**. Upload directly or pick from the media library (the same modal used elsewhere in this editor). Tapping that colour on the storefront swaps the hero image to this shot.

Rows are reordered by **dragging the grip handle**; the order here is the swatch order on mobile.

**There is no separate slide-image field.** Mark one colour as **Default** and its hero shot becomes the slide image, so the hero always opens on a real colourway that the visitor can switch away from and back to. If no colour is marked, the first one is used. A default colour with no image of its own falls back to whatever slide image was previously stored.

These are **not** the product's gallery images. Two distinct datasets with different jobs:

| | Hero image per colour | Product gallery colour images |
|---|---|---|
| Set in | Storefront → Landing Hero | Catalog → product → gallery |
| Stored as | `colors[].imageUrl` on the slide | `product_color_images` |
| Used by | The home hero only | The product detail page gallery |
| Typical art | Cutout styled for the hero stage | Standard product photography |

A colour with no hero shot keeps the slide's default image. That is legitimate, and the editor lists those colours in a warning so it stays a deliberate choice rather than an oversight.

For visual consistency, hero shots should match the slide image's angle, crop, and background treatment, or the product appears to jump as a visitor taps between colours.

**Data shape** — the slide stores `productId` and `colors: [{ label, slug, imageUrl }]`. `slug` is generated with the same rule the storefront product page uses to read its `?color=` param, so the "+" link always resolves correctly. Colour *values* (hex, swatch dot) are still never copied onto the slide; they resolve from `ref_colors` at render time.

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
- **Features:** Catches all failed HTTP requests globally and displays contextual toasts via `ToastService` based on status code (401, 403, 404, 413, 422, 429, etc.).
- **401 handling:** Uses `toast.error` (not warning) and redirects to `/login?returnUrl=<current-path>` so the admin lands back on the same page after re-authenticating. Skipped when the request is the `/auth/me` auth probe or when already on `/login`.
- **403, 404, 413, 429 handling:** each shows a status-appropriate title, but the sub-text prefers the server's JSON `message` over the fixed generic copy, falling back to the generic string only when the response has none (e.g. a proxy-level block with no parseable body). Every `PosError` and rate-limit response already carries a specific, actionable reason — "Only owners and admins can enroll POS terminals.", "This POS register is disabled or revoked.", "No active product uses barcode 6291041500213." — and showing the fixed sub-text instead threw that away. This is what a raw `413 — Request Entity Too Large` and a flat "Access denied — You don't have permission for this action" both turned out to be: the specific reason existed, the toast just wasn't showing it.
- **Fallback branch (any status with no dedicated case):** same preference — the server's JSON `message` over the raw `${status} — ${statusText}` line, which is now only shown when there's truly no parseable body to explain what happened.

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
> **`ORDERS` and `CUSTOMERS` exports in `mock.ts` are legacy** — the Orders page, Customers page, and Customer drawer all fetch live data from the API. `ORDERS` is no longer imported anywhere. `CUSTOMERS` seed data is used only during `db/seed.js` (not in the Angular app).

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
| `Product` | id, name, nameAr?, sku, brand, price, stock, hidden, image, images[]?, variants[]?, metaTitle?, metaDesc?, slug?, enDesc?, arDesc? | Catalog, Dashboard |
| `ProductVariant` | id, sku, size, color, material, price, stock, costPrice? | Product drawer (Variants section) |
| `MediaFile` | id, name, kind (image/glb), size, linkedTo, preview | Media Library |
| `Order` | id, date, customer, total, payment, fulfillment, items[], trackingNumber?, timeline[]?, notes[]? | Orders |
| `OrderTimelineEntry` | id, ts, kind, detail?, actor? | Order drawer timeline |
| `OrderNote` | id, ts, author, initials, body | Order drawer internal notes |
| `Customer` | id, name, email, city, orders, ltv, sizePref, notes, phone?, joined?, lastOrder? | Customers |
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
| Barcode | ⌄ collapsible | Defaults to the variant's own SKU on save unless overridden — see "Barcode & label printing" below |
| Cost | ⌄ collapsible | Finance input entered once; drives margin |
| Margin | ⌄ collapsible | Read-only calculated output; "set cost to calculate" hint |
| Size note EN / AR | ⌄ collapsible | Copy shown on the storefront when this size is picked — see "Per-variant size note" below |

### Barcode & label printing (2026-07)

Every variant now carries a `barcode` (`product_variants.barcode`), scanned by POS (`GET /api/pos/products/barcode/:barcode`, see [12 — POS System](./12-pos-system.md)). There is no separate barcode-numbering scheme — barcode defaults to the variant's own SKU (encoded as Code128, which handles arbitrary alphanumeric strings), editable per-variant in the collapsible detail row if a real supplier-issued barcode exists instead.

- **Server default:** `replaceVariants()` in `admin-products.route.js` resolves `barcode = trim(variant.barcode) || sku` for every row before insert, and rejects (400) a save where two variants would resolve to the same barcode (`product_variants` has `UNIQUE(tenant_id, barcode)` partial index from `015_pos_foundation.sql`).
- **Existing catalog backfill:** `ensure-migrations.js` runs `UPDATE product_variants SET barcode = sku WHERE barcode IS NULL OR blank` on every server boot (idempotent), so pre-existing variants become scannable without being re-saved.
- **Size dropdown grouping:** the per-variant size field is a `<select>` grouped by Reference Size Set (`<optgroup>` per set) rather than one flattened list — prevents picking a value from the wrong set (e.g. a Belts-cm size on a shoe variant).
- **Label printing:** `LabelPrinterService` (`services/label-printer.service.ts`) renders Code128 barcodes via `jsbarcode` into a print-ready popup window (same `window.open` + `window.print()` pattern as the order invoice), showing brand, product name, variant, barcode, and price. Triggered per-variant ("Print barcode label" icon) or in bulk for the whole product ("Print Labels" in the variants footer).

### Product note and per-variant size note (2026-08)

Two fields, deliberately separate, that stack into one panel on the storefront:

| | Edited in | Applies to | Shows |
|---|---|---|---|
| **Product note** (`noteEn` / `noteAr`) | ⑤ Description section, under Short description | The whole product | Always, from page load |
| **Size note** (`noteEn` / `noteAr` on the variant) | ④ Variants → size row → ⌄ detail | One size + colour combination | Only when that size is selected |

On the product page the two render as one dark glass panel mounted **inside the gallery frame, bottom-inline-start**, over the photo itself: the product note on the first row, a hairline, then the size note prefixed by a gold size badge. Placing it on the image is deliberate — a note below the gallery can be scrolled past, and the photo is exactly where the question it answers gets asked.

The image counter moves into that same bar rather than floating beside it, so the frame carries one composed element instead of two competing chips. Two rules keep that from disturbing anything that already worked:

- **The counter does not mirror.** It holds the bottom-right corner in Arabic as well as English — it is a UI landmark people look for in a fixed spot, not prose. The bar reverses under RTL so the note falls on the free side instead. The note itself still inherits the document direction, so its Arabic text and gold size badge lay out right-to-left correctly.
- **The scrim appears only when a note is present.** With just the counter the photo is left undarkened, at the same 15px inset it always had.

The size picker column repeats only the size note, as a plain line under the size buttons (`aria-live="polite"` so a screen reader announces it on selection). The product note is not repeated there — it is permanent on the frame.

### Per-variant size note (2026-08)

`product_variants.note_en` / `note_ar` (migration `031_variant_notes.sql`) carry one short line describing a construction detail that belongs to some sizes and not others — the case that prompted it was a garment whose 2-4 sizes ship with a back zipper while the 6-10 sizes do not. Without it the only ways to state the difference were re-shooting the gallery per size range or splitting one product into two, both of which cost far more than a sentence.

- **Where it is edited:** the collapsible detail row of each variant, on its own full-width line below the Material / Barcode / Cost / Shipping / Total / Margin grid, because a note is a sentence rather than a figure. The Arabic input is `dir="rtl"`.
- **Where it surfaces:** the storefront product page, twice — as a line directly under the size options (`aria-live="polite"`, so screen readers announce it when the size changes), and again as a chip under the gallery carrying the size number, since by the time the customer has scrolled to the photos the size picker is out of view.
- **Scoping:** the note is read from the variant matching both the selected size and the selected colour, the same rule `availableSizes` uses. A note set on the sage variant never shows while the customer is looking at the navy one.
- **Empty is empty:** a blank note renders nothing at all — no placeholder line, no empty chip. Clearing the field in the admin clears the stored value rather than leaving the previous one behind.
- **Fallback:** if only one language is filled in, the other locale shows that one rather than nothing (same shape as `productTeaser` / `productDescription`).

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

> **Status: Implemented baseline.** The `/pos` route is a standalone full-screen Angular page backed by authenticated `/api/pos/*` routes, PostgreSQL POS records, IndexedDB offline state, a service-worker app shell, and QZ Tray hardware integration.

The implemented workflow covers register enrollment, shift open/close, catalog and barcode lookup, cash/manual-card checkout, offline synchronization, parked carts, receipt printing, refunds, same-shift voids, manager approvals, live stock events, and conflict reconciliation.

Printing uses QZ Tray with authenticated server-side signing and a loopback device signer for offline operation. It does not use the older proposed WebUSB or direct TCP printer design.

For architecture, data flow, current limitations, API behavior, setup, testing, and operations, use [12 – POS System and Integration](./12-pos-system.md). For physical terminal installation and acceptance, use the [POS Hardware Runbook](./pos-hardware-runbook.md).

---

## Related Documents

- [03 – Client Web](./03-client-web.md) — The storefront app
- [05 – API Server](./05-api-server.md) — Express API details
- [06 – White-Label Guide](./06-white-label-guide.md) — Rebranding the admin
- [08 – Database & API Implementation](./08-database-api-implementation.md) — PostgreSQL schema and endpoint map
