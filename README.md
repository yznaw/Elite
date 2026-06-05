# Elite — Full-Stack Monorepo

> Node.js/Express API · Angular 17 Workspace · Two Apps · Shared Models

---

## Project Structure

```
Elite/
├── package.json              ← Root: run everything from here
├── .gitignore
│
├── server/                   ← Express API (port 3000)
│   ├── index.js
│   ├── package.json
│   ├── .env.example          ← Copy to .env and fill in values
│   └── routes/
│       ├── index.js          ← Route aggregator
│       └── health.route.js   ← GET /api/health
│
├── client/                   ← Angular Workspace
│   ├── angular.json          ← Multi-project config
│   ├── package.json
│   ├── tsconfig.json         ← @shared/* alias defined here
│   └── projects/
│       ├── client-web/       ← Main website (port 4200)
│       │   └── src/
│       │       ├── app/
│       │       │   ├── app.component.html   ← PASTE YOUR HTML HERE
│       │       │   ├── app.component.scss
│       │       │   ├── app.component.ts
│       │       │   ├── app.config.ts
│       │       │   ├── app.routes.ts
│       │       │   └── pages/home/
│       │       │       └── home.component.ts
│       │       ├── styles.scss              ← PASTE YOUR CSS HERE
│       │       ├── index.html
│       │       └── main.ts
│       │
│       └── admin-portal/     ← Admin subdomain (port 4300)
│           └── src/
│               ├── app/
│               │   ├── app.component.html   ← PASTE YOUR HTML HERE
│               │   ├── app.component.scss
│               │   ├── app.component.ts
│               │   ├── app.config.ts
│               │   ├── app.routes.ts
│               │   └── pages/dashboard/
│               │       └── dashboard.component.ts
│               ├── styles.scss              ← PASTE YOUR CSS HERE
│               ├── index.html
│               └── main.ts
│
└── shared/                   ← TypeScript models (used by both apps)
    ├── models/
    │   └── user.model.ts
    └── interfaces/
        └── api-response.interface.ts
```

---

## Quick Start

### 1. Install all dependencies

```bash
# From the root Elite/ directory
npm run install:all
```

### 2. Configure the server environment

```bash
cp server/.env.example server/.env
# Edit server/.env with your values
```

### 3. Run everything at once

```bash
npm run dev
```

This starts all three processes in parallel:
| Process      | URL                       |
|--------------|---------------------------|
| API Server   | http://localhost:3000/api |
| client-web   | http://localhost:4200     |
| admin-portal | http://localhost:4300     |

### Run individually

```bash
npm run server   # Express API only
npm run client   # client-web only
npm run admin    # admin-portal only
```

---

## API Endpoints

| Method | Path          | Description         |
|--------|---------------|---------------------|
| GET    | /api/health   | Server liveness check |

Add new routes in `server/routes/` and register them in `server/routes/index.js`.

---

## Angular Apps

### Serving

```bash
# From client/
ng serve client-web               # port 4200
ng serve admin-portal --port 4300 # port 4300
```

### Building for production

```bash
npm run build:web    # → client/dist/client-web/browser/
npm run build:admin  # → client/dist/admin-portal/browser/
npm run build:all    # both
```

---

## Shared Models

Both Angular apps can import shared TypeScript types using the `@shared/*` alias:

```typescript
import { User, UserRole } from '@shared/models/user.model';
import { ApiResponse, PaginatedResponse } from '@shared/interfaces/api-response.interface';
```

This alias is configured in `client/tsconfig.json` and resolves to `../shared/`.

---

## Subdomain Routing (Production)

| App          | Domain                    |
|--------------|---------------------------|
| client-web   | https://elitecollections.qa       |
| admin-portal | https://admin.elitecollections.qa |

Point each domain to its respective `dist/` build output via your web server (Nginx/Apache) or hosting platform (Vercel, Netlify, etc.). In production, let Nginx handle HTTPS and keep Express private on `localhost:3000`; see [`docs/09-nginx-https.md`](docs/09-nginx-https.md) for the full Certbot setup.

**Example Nginx config:**

```nginx
upstream elite_api {
  server 127.0.0.1:3000;
}

# Main website - Certbot will add the HTTPS listen/certificate lines.
server {
  listen 80;
  server_name elitecollections.qa www.elitecollections.qa;
  root /var/www/elite/client/dist/client-web/browser;
  index index.html;

  location / { try_files $uri $uri/ /index.html; }

  location /api/ {
    proxy_pass http://elite_api;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location /uploads/ {
    alias /var/www/elite/server/uploads/;
  }
}

# Admin subdomain - Certbot will add the HTTPS listen/certificate lines.
server {
  listen 80;
  server_name admin.elitecollections.qa;
  root /var/www/elite/client/dist/admin-portal/browser;
  index index.html;

  location / { try_files $uri $uri/ /index.html; }

  location /api/ {
    proxy_pass http://elite_api;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location /uploads/ {
    alias /var/www/elite/server/uploads/;
  }
}
```

---

## Pasting Your Assets

| File | What to paste |
|------|---------------|
| `projects/client-web/src/app/app.component.html` | Your client app shell HTML |
| `projects/client-web/src/styles.scss` | Your client global CSS |
| `projects/admin-portal/src/app/app.component.html` | Your admin app shell HTML |
| `projects/admin-portal/src/styles.scss` | Your admin global CSS |

Each file contains `<!-- Paste here -->` comment markers to guide you.
