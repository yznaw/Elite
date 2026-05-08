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
| Admin Portal | http://localhost:4300 | Yes (ng serve) |

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

---

## Project Map (Quick Reference)

```
Elite/
├── brand.config.json                          ← WHITE-LABEL CONFIG
├── docs/                                      ← YOU ARE HERE
│
├── server/
│   ├── index.js                               ← Server entry
│   ├── .env.example                           ← Env template
│   └── routes/
│       ├── index.js                           ← Route aggregator
│       └── health.route.js                    ← Health endpoint
│
├── client/
│   ├── angular.json                           ← Angular workspace config
│   ├── tsconfig.json                          ← TS config + @shared/* alias
│   └── projects/
│       ├── client-web/src/
│       │   ├── index.html                     ← HTML shell
│       │   ├── styles.scss                    ← @FONT-FACE + DESIGN TOKENS + global CSS
│       │   └── app/
│       │       ├── app.routes.ts              ← Page routes
│       │       ├── i18n/strings.ts            ← EN/AR translations (600 lines)
│       │       ├── models/product.model.ts    ← Product + CartItem types
│       │       ├── services/
│       │       │   ├── products.service.ts    ← Product data (mock)
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
│               ├── app.routes.ts              ← 9 admin routes
│               ├── i18n/strings.ts            ← EN/AR translations (1200 lines)
│               ├── models/index.ts            ← All admin interfaces
│               ├── data/mock.ts               ← Mock data (products, orders, etc.)
│               ├── services/
│               │   ├── storefront.service.ts  ← Draft/publish flow
│               │   ├── toast.service.ts       ← Toast notifications
│               │   ├── confirm.service.ts     ← Confirm dialogs
│               │   ├── i18n.service.ts        ← Translation helper
│               │   └── locale.service.ts      ← Language + RTL
│               ├── pages/                     ← 9 lazy-loaded pages
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
