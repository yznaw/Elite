# Elite — Documentation Hub

> All documentation for the Elite full-stack monorepo.  
> **Last updated:** June 2026

---

## 📚 Table of Contents

| # | Document | Audience | Description |
|---|----------|----------|-------------|
| 1 | [Project Overview](./01-project-overview.md) | Everyone | What the product is, what it does, key features, and business model |
| 2 | [Architecture](./02-architecture.md) | Developers | Monorepo structure, data flow, build pipeline, deployment |
| 3 | [Client Web (Storefront)](./03-client-web.md) | Frontend Devs | Pages, components, services, styling, i18n, RTL |
| 4 | [Admin Portal](./04-admin-portal.md) | Frontend Devs | Dashboard, catalog, orders, storefront editor, design system |
| 5 | [API Server](./05-api-server.md) | Backend Devs | Express setup, routes, middleware, adding endpoints |
| 6 | [White-Label Guide](./06-white-label-guide.md) | Dev Team | How to rebrand and resell for a new client |
| 7 | [Developer Guide](./07-dev-guide.md) | Dev Team | Local setup, conventions, how-to recipes |
| 8 | [Database & API Implementation](./08-database-api-implementation.md) | Backend/Frontend Devs | PostgreSQL schema, endpoint map, SQL behavior, wired UI state |
| 9 | [Nginx HTTPS](./09-nginx-https.md) | DevOps | Production Nginx reverse proxy, HTTPS termination, Certbot, and upload routing |
| 10 | [NBOX Integration](./10-nbox-integration.md) | Backend/DevOps | Delivery quote, shipment booking, and shipment status webhook flow |
| 11 | [Storefront Analytics](./11-storefront-analytics.md) | Frontend/Backend Devs | First-party click/session/visitor tracking, ingestion, and the live admin analytics page |
| 12 | [POS System and Integration](./12-pos-system.md) | Operations/Developers/DevOps | Implemented POS architecture, Elite data integration, offline sync, API, security, deployment, testing, and rollout |

---

## Quick Links

- **Root README** → [`../README.md`](../README.md) — Quick start & project structure
- **Brand Config** → [`../brand.config.json`](../brand.config.json) — White-label configuration
- **Server ENV** → [`../server/.env.example`](../server/.env.example) — Environment variables

## Planning & Tracking

| Document | Description |
|---|---|
| [Master Plan](./master-plan.html) | Full backlog — what's live vs what still needs building, with acceptance criteria per feature. Click items to track progress. |
| [POS System Plan](./pos-system-plan.html) | POS build — acceptance criteria per phase and sign-off gates for milestone payments (QAR 19,000 total). |
| [POS Hardware Runbook](./pos-hardware-runbook.md) | Physical terminal, QZ Tray, Bixolon printer, cash drawer, scanner, offline signer, and acceptance procedure. |
| [Production Launch](./production-launch.html) | Pre-launch checklist and go-live readiness tracker. |

---

## How to Use These Docs

- **New to the project?** Start with [01 – Project Overview](./01-project-overview.md), then [07 – Developer Guide](./07-dev-guide.md).
- **Onboarding a new client?** Go straight to [06 – White-Label Guide](./06-white-label-guide.md).
- **Working on the frontend?** Read [03](./03-client-web.md) or [04](./04-admin-portal.md) depending on which app you're modifying.
- **Adding an API endpoint?** See [05 – API Server](./05-api-server.md).
- **Working with database-backed features?** See [08 – Database & API Implementation](./08-database-api-implementation.md).
- **Deploying HTTPS with Nginx?** See [09 – Nginx HTTPS](./09-nginx-https.md).
- **Connecting NBOX delivery?** See [10 – NBOX Integration](./10-nbox-integration.md).
- **Tracking storefront visits/clicks?** See [11 – Storefront Analytics](./11-storefront-analytics.md).
- **Deploying or operating POS?** See [12 – POS System and Integration](./12-pos-system.md) and the [POS Hardware Runbook](./pos-hardware-runbook.md).
