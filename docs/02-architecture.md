# 02 — Architecture

> **Audience:** Developers  
> **Reading time:** ~10 minutes

---

## Monorepo Structure

```
Elite/
├── package.json              ← Root orchestrator (concurrently runs all services)
├── brand.config.json         ← White-label configuration (brand, colors, features)
├── .gitignore
│
├── server/                   ← Express API (port 3000)
│   ├── index.js              ← Entry point — middleware + server bootstrap
│   ├── package.json          ← Server-only dependencies
│   ├── .env.example          ← Environment variable template
│   └── routes/
│       ├── index.js          ← Route aggregator — mounts all route modules
│       └── health.route.js   ← GET /api/health
│
├── client/                   ← Angular 17 Workspace (two apps, one workspace)
│   ├── angular.json          ← Multi-project configuration
│   ├── package.json          ← All Angular dependencies
│   ├── tsconfig.json         ← Shared TS config with @shared/* path alias
│   └── projects/
│       ├── client-web/       ← Customer storefront (port 4200, prefix: cw)
│       └── admin-portal/     ← Admin dashboard (port 4300, prefix: ap)
│
├── shared/                   ← TypeScript models & interfaces
│   ├── models/
│   │   └── user.model.ts
│   └── interfaces/
│       └── api-response.interface.ts
│
└── docs/                     ← This documentation folder
```

---

## Angular Workspace

The Angular workspace (`client/`) contains **two separate applications** in a single workspace. This allows shared `node_modules`, shared `tsconfig.json`, and shared build tooling.

### Project Configuration

| Property | client-web | admin-portal |
|---|---|---|
| **Prefix** | `cw` | `ap` |
| **Port** | 4200 | 4300 |
| **Root Selector** | `<cw-root>` | `<ap-root>` |
| **Style** | SCSS | SCSS |
| **Builder** | `@angular-devkit/build-angular:application` | Same |
| **Output** | `dist/client-web/browser/` | `dist/admin-portal/browser/` |
| **Strict Mode** | Yes | Yes |

### The `@shared/*` Path Alias

Both apps can import shared TypeScript types via:

```typescript
import { User, UserRole } from '@shared/models/user.model';
import { ApiResponse, PaginatedResponse } from '@shared/interfaces/api-response.interface';
```

This alias is defined in `client/tsconfig.json`:

```json
"paths": {
  "@shared/*": ["../shared/*"]
}
```

The `shared/` directory lives **outside** the `client/` folder, making it accessible to the server as well.

---

## Express Server Architecture

### Middleware Stack (in order)

```
Request
  │
  ├── CORS (dynamic origin check via CORS_ORIGINS env var)
  ├── express.json() — parse JSON bodies
  ├── express.urlencoded() — parse form bodies
  ├── morgan('dev') — HTTP request logging
  │
  ├── /api/* routes (mounted via route aggregator)
  │
  ├── 404 Handler — catches unmatched routes
  └── Global Error Handler — catches all thrown errors
```

### Route Registration Pattern

Routes follow a **modular file pattern**:

1. Create a new file: `server/routes/<name>.route.js`
2. Export a `Router()` with handlers
3. Import and mount in `server/routes/index.js`

```javascript
// server/routes/index.js
const healthRouter = require('./health.route');
const router = Router();
router.use('/health', healthRouter);
module.exports = router;
```

All routes are automatically prefixed with `/api` by the main `app.use('/api', routes)` in `server/index.js`.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server listening port |
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `CORS_ORIGINS` | `localhost:4200,4300` | Comma-separated allowed origins |
| `NODE_ENV` | `development` | Environment identifier |
| `SESSION_SECRET` | — | Long random string for signing the session cookie (required) |

---

## Data Flow

```
┌─────────────┐         HTTP/JSON          ┌──────────────┐
│  client-web  │  ◄─────────────────────►  │              │
│  (Angular)   │                           │   Express    │
└──────────────┘                           │   Server     │
                                           │  /api/*      │
┌──────────────┐         HTTP/JSON         │              │
│ admin-portal │  ◄─────────────────────►  │              │
│  (Angular)   │                           └──────┬───────┘
└──────────────┘                                  │
                                                  │
                                           ┌──────▼───────┐
                                           │  PostgreSQL  │
                                           │  (live, pg)  │
                                           └──────────────┘
```

### Current State

- **PostgreSQL** is the production database — all admin and storefront data is persisted there
- Session-based authentication via `express-session` + `connect-pg-simple`
- All major admin routes are live: products, variants, orders, customers, media, collections, storefront, analytics, settings, team invitations
- `StorageService` wraps localStorage with tenant-scoped keys (`elite:{tenantId}:{key}`)
- `StoreConfigService` exposes shared settings (e.g. `lowStockThreshold`) via Angular signals
- The storefront editor saves drafts and published snapshots to the `storefront_snapshots` table

---

## Build & Deploy Pipeline

### Development

```bash
npm run dev    # Runs all 3 services concurrently
```

| Service | Command | URL |
|---|---|---|
| Express API | `nodemon index.js` | `http://localhost:3000/api` |
| client-web | `ng serve client-web` | `http://localhost:4200` |
| admin-portal | `ng serve admin-portal --port 4300` | `http://localhost:4300` |

### Production Build

```bash
npm run build:all    # Builds both Angular apps
```

Output:
- `client/dist/client-web/browser/` → Static files for storefront
- `client/dist/admin-portal/browser/` → Static files for admin

### Production Deployment

Both Angular builds produce static files that are served by a web server (Nginx, Apache, Vercel, Netlify, etc.). The Express server runs as a Node.js process behind a reverse proxy.

```
                    ┌─────────────────────────────────┐
                    │       Nginx HTTPS edge           │
                    │                                  │
  elitecollections.qa ─► /          → client-web dist  │
                    │                                  │
  admin.elitecollections.qa ─► /    → admin-portal dist│
                    │                                  │
  */api/*  ─────────┤──► proxy_pass → Express :3000    │
  */uploads/*  ─────┤──► proxy_pass → Express :3000    │
                    └─────────────────────────────────┘
```

### Example Nginx Config

Nginx terminates HTTPS in production. Express should remain private on `localhost:3000`; see [09 - Nginx HTTPS](./09-nginx-https.md) for the complete Certbot setup.

```nginx
upstream elite_api {
  server 127.0.0.1:3000;
}

server {
  listen 80;
  server_name elitecollections.qa www.elitecollections.qa;
  root /var/www/elite/client/dist/client-web/browser;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }
  location /api/ { proxy_pass http://elite_api; }
}
```

---

## Key Design Decisions

### 1. Standalone Components
All Angular components use the `standalone: true` pattern (Angular 17+). No `NgModule` declarations — each component imports what it needs.

### 2. Angular Signals
State management uses Angular's native **Signals** API rather than RxJS `BehaviorSubject` or third-party state libraries. Services like `CartService`, `LocaleService`, and `StorefrontService` use `signal()`, `computed()`, and `effect()`.

### 3. Lazy-Loaded Routes
All page components are lazy-loaded via `loadComponent()` in the route definitions. This means each page is a separate JavaScript chunk, loaded on demand.

### 4. CSS Custom Properties for Theming
All colors, fonts, and spacing tokens are defined as CSS custom properties (variables) in `:root`. This makes white-label rebranding possible by editing a single block of CSS variables.

### 5. Self-Hosted Typography (Thmanyah Font Family)
Instead of relying on Google Fonts CDN, all fonts are self-hosted as woff2 files in `assets/fonts/thmanyah/` and loaded via `@font-face` declarations in `styles.scss`. The Thmanyah family natively supports Arabic + Latin, eliminating the need for a separate Arabic font. This improves load performance and removes external dependencies.

### 6. i18n via Dictionary Object
Instead of Angular's built-in i18n (which requires separate builds per language), both apps use a **runtime dictionary** approach — a single TypeScript file with all strings in both EN and AR. Language can be switched at runtime without reload.

---

## Related Documents

- [03 – Client Web](./03-client-web.md) — Storefront app deep dive
- [04 – Admin Portal](./04-admin-portal.md) — Admin app deep dive
- [05 – API Server](./05-api-server.md) — Express server details
