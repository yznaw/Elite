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
| `/dashboard` | `DashboardComponent` | KPIs, revenue chart, 3D heatmap, recent orders |
| `/catalog` | `CatalogComponent` | Product grid/list, search, filter, inline editor with draft auto-save |
| `/media` | `MediaComponent` | Upload zone, file grid, auto-link by SKU, detail drawer |
| `/storefront` | `StorefrontComponent` | Section editor with drag & drop, draft → publish, preview |
| `/orders` | `OrdersComponent` | Searchable order table, payment/fulfillment filters, order detail drawer |
| `/customers` | `CustomersComponent` | Customer table/cards, tier filter, detail drawer with notes |
| `/analytics` | `AnalyticsComponent` | Revenue chart, traffic sources, conversion funnel, top 3D interactions |
| `/sync` | `SyncComponent` | Sync source cards, activity feed, manual queue, schedule management |
| `/settings` | `SettingsComponent` | Store info, team members, integrations |
| `**` | — | Redirects to `/dashboard` |

---

## Shared Components (15+)

Located in `app/shared/`:

### Layout

| Component | Folder | Description |
|---|---|---|
| `SidebarComponent` | `sidebar/` | Fixed left navigation with workspace sections, active route highlighting |
| `TopbarComponent` | `topbar/` | Top bar with search, notification bell, language switcher, user avatar |

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
| `Product` | id, name, sku, brand, category, price, stock, has3d, hidden | Catalog, Dashboard |
| `MediaFile` | id, name, kind (image/glb), size, linkedTo, preview | Media Library |
| `Order` | id, date, customer, total, payment, fulfillment, items[] | Orders |
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

- **UI Font:** `'Montserrat'` — Navigation, labels, buttons
- **Display Font:** `'Cormorant Garamond'` — KPI values, card titles
- **Mono Font:** `'SF Mono', Menlo` — Code, IDs, timestamps

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

## Related Documents

- [03 – Client Web](./03-client-web.md) — The storefront app
- [05 – API Server](./05-api-server.md) — Express API details
- [06 – White-Label Guide](./06-white-label-guide.md) — Rebranding the admin
