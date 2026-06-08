# 07 — Developer Guide

> **Audience:** Developers working on the codebase  
> **Reading time:** ~10 minutes

---

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 18+ | `node -v` |
| npm | 9+ | `npm -v` |
| Angular CLI | 17+ | `npx ng version` |
| Git | 2.30+ | `git --version` |

---

## Local Setup

### 1. Clone the Repository

```bash
git clone <repo-url> Elite
cd Elite
```

### 2. Install Dependencies

```bash
npm run install:all
```

This runs `npm install` in both `server/` and `client/` directories.

### 3. Configure Environment

```bash
cp server/.env.example server/.env
# Edit server/.env if needed (defaults are fine for local dev)
```

### 4. Start Everything

```bash
npm run dev
```

This starts all three processes concurrently:

| Service | URL | Watch Mode |
|---|---|---|
| Express API | http://localhost:3000/api | Yes (nodemon) |
| Client Web | http://localhost:4200 | Yes (ng serve) |
| Admin Portal | http://localhost:4300 | Yes (ng serve, with proxy) |

> **Dev proxy** — `client/proxy.conf.json` proxies `/api` and `/uploads` from the Angular dev server (port 4300) to Express (port 3000). This means `<img src="/uploads/...">` in the admin portal correctly resolves to the Express static file server in development. No proxy changes needed in production (same origin).

### Start Individually

```bash
npm run server   # Express API only
npm run client   # client-web only
npm run admin    # admin-portal only
```

---

## Available Scripts

### Root (`Elite/package.json`)

| Script | Command | Description |
|---|---|---|
| `npm run dev` | Runs all 3 services | Full development environment |
| `npm run server` | Express only | Backend development |
| `npm run client` | client-web only | Storefront development |
| `npm run admin` | admin-portal only | Admin development |
| `npm run install:all` | Install everywhere | First-time setup |

### Client (`Elite/client/package.json`)

| Script | Command | Description |
|---|---|---|
| `npm run start` | `ng serve client-web` | Storefront on :4200 |
| `npm run start:admin` | `ng serve admin-portal --port 4300` | Admin on :4300 |
| `npm run build:web` | Production build (client-web) | → `dist/client-web/` |
| `npm run build:admin` | Production build (admin-portal) | → `dist/admin-portal/` |
| `npm run build:all` | Build both apps | Full production build |
| `npm run lint` | `ng lint` | Run linter |
| `npm run test` | `ng test` | Run unit tests |

### Server (`Elite/server/package.json`)

| Script | Command | Description |
|---|---|---|
| `npm start` | `node index.js` | Production start |
| `npm run dev` | `nodemon index.js` | Development with auto-restart |

---

## Code Conventions

### Angular Components

- **Standalone only** — No `NgModule` declarations. Every component sets `standalone: true`
- **Lazy-loaded pages** — All page components are loaded via `loadComponent()` in routes
- **Signals for state** — Use `signal()`, `computed()`, `effect()` instead of `BehaviorSubject`
- **Never use raw `localStorage`** — Always use `StorageService` so keys are tenant-scoped (`elite:{tenantId}:{base}`). Raw `localStorage` calls will bleed state across tenants if multiple users share a browser session.

```typescript
// ✅ Do this
private readonly storage = inject(StorageService);
const view = this.storage.get('my-view-key') ?? 'table';
this.storage.set('my-view-key', 'cards');

// ❌ Not this — not tenant-scoped
localStorage.getItem('my-view-key');
localStorage.setItem('my-view-key', 'cards');
```

- **Shared config via `StoreConfigService`** — Store-level settings that multiple pages read (e.g., `lowStockThreshold`) live in `StoreConfigService`. Don't hardcode thresholds in individual components; read `storeConfig.lowStockThreshold()` instead.
- **No arrow functions in templates** — Angular 17 templates do not allow `=>` in event bindings. Extract to named component methods: `(click)="doThing()"` not `(click)="sig.update(v => !v)"`
- **No self-closing non-void tags** — `<option [value]="x">{{ x }}</option>`, never `<option [value]="x"/>`
- **Inject function** — Use `inject()` instead of constructor injection:

```typescript
// ✅ Do this
private readonly i18n = inject(I18nService);

// ❌ Not this
constructor(private i18n: I18nService) {}
```

### File Naming

```
feature-name/
├── feature-name.component.ts      ← Component class
├── feature-name.component.html     ← Template
├── feature-name.component.scss     ← Styles (scoped)
└── feature-name.component.spec.ts  ← Tests (optional)
```

- **Components:** `kebab-case.component.ts`
- **Services:** `kebab-case.service.ts`
- **Models:** `kebab-case.model.ts`
- **Routes:** `kebab-case.route.js` (server)
- **Interfaces:** `kebab-case.interface.ts`

### Component Prefixes

| App | Prefix | Example |
|---|---|---|
| client-web | `cw` | `<cw-nav>`, `<cw-footer>` |
| admin-portal | `ap` | `<ap-sidebar>`, `<ap-topbar>` |

### CSS Conventions

- **Global tokens** in `styles.scss` `:root` — colors, fonts, shadows
- **Component-scoped styles** in `.component.scss` — layout, component-specific rules
- **Utility classes** in `styles.scss` — reusable patterns (`.card`, `.btn`, `.pill`, etc.)
- **No Tailwind** — Pure CSS with custom properties
- **Self-hosted fonts** — Thmanyah font family (woff2) in `assets/fonts/thmanyah/`, loaded via `@font-face` in `styles.scss`
- **BEM not required** — Simple class names are fine for this scale

### TypeScript

- **Strict mode** — `strict: true` in `tsconfig.json`
- **Type everything** — Avoid `any`. Use interfaces from `models/`
- **Const assertions** — i18n strings use `as const` for type safety
- **Barrel exports** — Models use `index.ts` for clean imports

---

## How-To Recipes

### Add a New i18n Key

1. Open the appropriate `i18n/strings.ts` file
2. Add the key to the `EN` object:
   ```typescript
   'your.new.key': 'English text',
   ```
3. Add the same key to the `AR` object:
   ```typescript
   'your.new.key': 'نص عربي ملائم',
   ```

> [!TIP]
> **Transcreation over Translation:** When adding Arabic strings, avoid literal translations. Use "Transcreation" to maintain a premium tone. For example, use `القطعة` (The Piece) instead of `المنتج` (The Product) where appropriate for luxury items. Always check the `common.*` keys first to reuse existing approved terminology.
4. Use in component:
   ```typescript
   readonly t = inject(I18nService).t;
   // in template: {{ t('your.new.key') }}
   ```

### Add a New CSS Design Token

1. Open the relevant `styles.scss`
2. Add a new custom property in `:root`:
   ```scss
   :root {
     --your-token: #value;
   }
   ```
3. Use in components:
   ```scss
   color: var(--your-token);
   ```

### Add a New Shared Component (Admin)

1. Create folder: `admin-portal/src/app/shared/your-component/`
2. Create the component:
   ```typescript
   @Component({
     selector: 'ap-your-component',
     standalone: true,
     imports: [CommonModule],
     template: `...`,
     styleUrl: './your-component.component.scss',
   })
   export class YourComponent {}
   ```
3. Import it in any page that needs it:
   ```typescript
   imports: [YourComponent],
   ```

### Add a New API Route

See [05 – API Server](./05-api-server.md#how-to-add-a-new-route) for the step-by-step guide.

### Update the Design Tokens for a New Brand

See [06 – White-Label Guide](./06-white-label-guide.md#step-3-update-storefront-css-tokens) for the complete rebranding process.

### Run the POS in Development

The POS page runs at `http://localhost:4300/pos`. The standard `npm run dev` command starts everything including the POS route.

For hardware testing (thermal printer, cash drawer), the Express server must be reachable from the POS terminal. Set `PRINTER_HOST` in `server/.env` to your Bixolon printer's IP address:

```bash
PRINTER_HOST=192.168.1.100
PRINTER_PORT=9100
```

To test USB printing via WebUSB, open the POS in Chrome/Edge (WebUSB is not supported in Firefox or Safari). The browser will prompt for USB device permission on first use.

To simulate a USB barcode scan in dev, focus the search input and type any 6+ character string followed by Enter within 100ms — or use a real USB scanner.

### POS npm Packages

| Package | Location | Purpose |
|---|---|---|
| `@zxing/browser` | `client/` | Camera-based barcode/QR scanning |
| `bwip-js` | `client/` | Barcode image generation for labels (Code 128, EAN-13) |
| `dexie` | `client/` | IndexedDB wrapper for offline cart queue |
| `escpos-buffer` | `server/` | ESC/POS byte stream builder for thermal receipts |
| `bcrypt` | `server/` | Manager PIN hashing |

Install after cloning:
```bash
# client
cd client && npm install @zxing/browser bwip-js dexie

# server
cd server && npm install escpos-buffer bcrypt
```

---

## Project Map (Quick Reference)

```
Elite/
├── brand.config.json                          ← WHITE-LABEL CONFIG
├── docs/                                      ← YOU ARE HERE
│
├── server/
│   ├── index.js                               ← Entry point — middleware, session, bootstrap
│   ├── .env.example                           ← Env template
│   ├── db/
│   │   ├── client.js                          ← pg Pool singleton
│   │   ├── tenant.js                          ← ensureDefaultTenant() + admin seed
│   │   ├── seed.js                            ← Idempotent fixture data
│   │   ├── seed-admins.js                     ← One admin per role; writes admins.local.txt
│   │   └── migrations/
│   │       ├── 001_initial_schema.sql         ← Full schema
│   │       ├── 002_password_reset_tokens.sql  ← Reset tokens (SHA-256, 30m TTL)
│   │       ├── 003_ref_tables.sql             ← ref_colors, ref_materials, ref_size_sets
│   │       ├── 004_product_seo_fields.sql     ← meta_title, meta_desc columns
│   │       └── 005_team_invitations.sql       ← team_invitations (token_hash, 48h TTL)
│   ├── middleware/
│   │   ├── require-auth.js                    ← requireAuth + requireRole helpers
│   │   └── upload.js                          ← Shared multer config
│   ├── lib/
│   │   └── storage.js                         ← Disk storage adapter
│   └── routes/
│       ├── index.js                           ← Route aggregator
│       ├── lib.js                             ← asyncHandler, ok, created, notFound, …
│       ├── health.route.js                    ← GET /api/health
│       ├── auth.route.js                      ← Login, logout, forgot/reset password
│       ├── admin-products.route.js            ← Product CRUD + bulk-delete + duplicate
│       ├── admin-bulk-import.route.js         ← CSV upload → NDJSON streaming (dry-run)
│       ├── admin-ref.route.js                 ← Colors, materials, size sets CRUD
│       ├── admin-media.route.js               ← Media library upload/delete/gdrive
│       ├── admin-collections.route.js         ← Collections CRUD
│       ├── admin-orders.route.js              ← Orders + workflow + notes + timeline
│       ├── admin-customers.route.js           ← Customers + order history
│       ├── admin-analytics.route.js           ← KPI + chart data
│       ├── admin-storefront.route.js          ← Storefront snapshots + publish
│       ├── admin-settings.route.js            ← Store settings + team + invitations
│       ├── invitations.route.js               ← Public: validate token + accept invite
│       ├── products.route.js                  ← Public storefront listing
│       ├── carts.route.js                     ← Public cart
│       └── contact.route.js                   ← Public contact form
│                                              (admin-pos.route.js — planned, not yet built)
│
├── client/
│   ├── angular.json                           ← Angular workspace config
│   ├── proxy.conf.json                        ← Dev proxy: /api + /uploads → :3000
│   ├── tsconfig.json                          ← TS config + @shared/* alias
│   └── projects/
│       ├── client-web/src/
│       │   ├── index.html                     ← HTML shell
│       │   ├── styles.scss                    ← @FONT-FACE + DESIGN TOKENS + global CSS
│       │   └── app/
│       │       ├── app.routes.ts              ← Page routes
│       │       ├── i18n/strings.ts            ← EN/AR translations
│       │       ├── models/product.model.ts    ← Product + CartItem types
│       │       ├── services/
│       │       │   ├── products.service.ts    ← Product data
│       │       │   ├── cart.service.ts        ← Cart state (signals)
│       │       │   ├── locale.service.ts      ← Language + RTL
│       │       │   └── i18n.service.ts        ← Translation helper
│       │       ├── pages/                     ← 6 lazy-loaded pages
│       │       └── shared/                    ← nav, footer, cart-drawer
│       │
│       └── admin-portal/src/
│           ├── index.html                     ← HTML shell
│           ├── styles.scss                    ← @FONT-FACE + DESIGN TOKENS (2700+ lines)
│           └── app/
│               ├── app.routes.ts              ← Admin routes (dashboard, catalog, reference, …)
│               ├── i18n/strings.ts            ← EN/AR translations (1200+ lines)
│               ├── models/index.ts            ← All admin interfaces
│               ├── data/mock.ts               ← Mock data (analytics — not yet live)
│               ├── interceptors/
│               │   └── http-error.interceptor.ts ← Global HTTP error handler
│               ├── services/
│               │   ├── api-client.service.ts  ← HTTP wrapper (envelope unwrap, credentials)
│               │   ├── auth.service.ts        ← Login, logout, session user
│               │   ├── admin-products.service.ts ← Product CRUD via API
│               │   ├── admin-ref.service.ts   ← Colors / materials / size sets via API
│               │   ├── admin-collections.service.ts ← Collections CRUD
│               │   ├── admin-orders.service.ts ← Orders + workflow + notes
│               │   ├── admin-customers.service.ts ← Customer CRM
│               │   ├── admin-media.service.ts ← Media library
│               │   ├── admin-settings.service.ts ← Store settings + team + invitations
│               │   ├── media-upload.service.ts ← Multipart upload with per-file progress
│               │   ├── storefront.service.ts  ← Draft/publish flow
│               │   ├── store-config.service.ts ← Shared signals (lowStockThreshold, etc.)
│               │   ├── storage.service.ts     ← Tenant-scoped localStorage wrapper
│               │   ├── notification.service.ts ← Global real-time alerts
│               │   ├── toast.service.ts       ← Toast notifications
│               │   ├── confirm.service.ts     ← Confirm dialogs
│               │   ├── i18n.service.ts        ← Translation helper
│               │   └── locale.service.ts      ← Language + RTL
│               │                              (pos.service.ts, pos-sync.service.ts,
│               │                               escpos.service.ts — planned, not yet built)
│               ├── pages/
│               │   ├── catalog/
│               │   │   ├── catalog.component.ts
│               │   │   ├── product-drawer.component.ts
│               │   │   └── bulk-import-dialog.component.ts
│               │   ├── accept-invite/         ← Public: set password from invitation link
│               │   ├── settings/              ← Store info + team + invitations
│               │   ├── reference/             ← Colors, materials, size sets management
│               │   └── …                      ← dashboard, orders, customers, media, etc.
│               └── shared/                    ← 15+ reusable components
│
└── shared/                                    ← Cross-app TypeScript types
    ├── models/user.model.ts
    └── interfaces/api-response.interface.ts
```

---

## Git Workflow Recommendations

### Branch Naming

```
feature/<description>     ← New feature
fix/<description>         ← Bug fix
client/<client-name>      ← Client-specific branch
release/<version>         ← Release preparation
```

### Commit Messages

```
feat: add product detail page
fix: cart drawer not closing on checkout
style: update admin KPI card spacing
refactor: extract media auto-link into service
docs: add white-label guide
chore: update Angular to 17.3.1
```

### Recommended Flow

1. `main` branch = stable base product
2. Client branches fork from `main`
3. Improvements to the core product go into `main`, then merge downstream into client branches
4. Client-specific customizations stay in their branch

---

## Related Documents

- [01 – Project Overview](./01-project-overview.md) — What the product does
- [02 – Architecture](./02-architecture.md) — System architecture
- [06 – White-Label Guide](./06-white-label-guide.md) — Rebranding process
