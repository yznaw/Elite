# 01 — Project Overview

> **Audience:** Stakeholders, project managers, new team members  
> **Reading time:** ~5 minutes

---

## What Is This Product?

Elite is a **premium e-commerce platform** designed for luxury and artisan brands. It consists of two web applications backed by a shared API server:

| Application | Purpose | Who Uses It |
|---|---|---|
| **Client Web** (Storefront) | The customer-facing shopping experience — browse products, view 3D models, add to cart, checkout | End customers / shoppers |
| **Admin Portal** | Business management dashboard — manage catalog, orders, customers, analytics, storefront layout | Store owners & staff |

The platform is built as a **white-label product** — meaning the same codebase can be reskinned and deployed for multiple different brands. Change the logo, colors, copy, and feature set to serve any luxury goods client.

---

## Key Features

### Customer Storefront
- 🏠 **Hero landing page** with editorial design and 3D product viewer
- 📦 **Product catalog** with filtering by style, leather type, and price sorting
- 🛒 **Cart drawer** with live subtotal and quantity management
- 💳 **Multi-step checkout** (details → delivery → payment → confirmation)
- 📖 **Brand story page** with cinematic timeline chapters
- ✉️ **Contact page** with form and advisor info
- 🌐 **Bilingual (EN/AR)** with full RTL support
- 📱 **Fully responsive** — mobile, tablet, desktop

### Admin Portal
- 📊 **Dashboard** — revenue charts, KPIs, recent orders, 3D heatmap
- 📋 **Product Catalog** — search, filter, inline editing, visibility toggle, draft auto-save
- 🖼️ **Media Library** — upload images and 3D models, auto-link by SKU, link/unlink
- 🏗️ **Storefront Editor** — drag & drop section ordering, draft → publish flow, preview
- 📦 **Orders** — search, filter by payment/fulfillment status, order detail drawer
- 👥 **Customer CRM** — customer cards, order history, size preferences, internal notes
- 📈 **Analytics** — sessions vs conversions, traffic sources, conversion funnel, top 3D interactions
- 🔄 **Sync Engine** — sync logs, system health, schedule management, manual triggers
- ⚙️ **Settings** — store info, team members with roles, integrations
- 🌐 **Bilingual (EN/AR)** with full RTL support

---

## Architecture at a Glance

```
┌──────────────────────────────────────────────────────┐
│                    MONOREPO (Elite/)                  │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │  client-web   │  │ admin-portal │  │   server   │ │
│  │  Angular 17   │  │  Angular 17  │  │  Express   │ │
│  │  Port 4200    │  │  Port 4300   │  │  Port 3000 │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
│         │                 │                 │        │
│         └────────┬────────┘                 │        │
│                  │                          │        │
│          ┌───────▼────────┐                 │        │
│          │    shared/     │                 │        │
│          │  TS Models &   │  ◄──── API ────►│        │
│          │  Interfaces    │                 │        │
│          └────────────────┘                 │        │
└──────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend Framework | Angular | 17.3 |
| Language | TypeScript | 5.4 |
| Styling | SCSS + CSS Custom Properties | — |
| Backend | Node.js + Express | 4.19 |
| Build Tool | Angular CLI + Webpack (via `@angular-devkit`) | 17.3 |
| Package Manager | npm | — |

---

## Business Model: White-Label SaaS

This project is designed to be **sold as a product** to multiple clients:

1. **Fork/branch** the codebase for each new client
2. **Edit `brand.config.json`** to set the new brand's identity (name, colors, fonts, etc.)
3. **Update i18n strings** with client-specific copy
4. **Toggle features** on/off based on client needs
5. **Deploy** to client's domain

See [06 – White-Label Guide](./06-white-label-guide.md) for the full step-by-step process.

---

## Production Deployment

| App | Domain | Served From |
|---|---|---|
| Client Web | `https://website.com` | `client/dist/client-web/` |
| Admin Portal | `https://admin.website.com` | `client/dist/admin-portal/` |
| API Server | `https://website.com/api` or `https://api.website.com` | Node.js process |

Both Angular apps share the same Express API server. The server proxies API calls via Nginx (or equivalent) reverse proxy.

---

## Related Documents

- [02 – Architecture](./02-architecture.md) — Deep technical details
- [06 – White-Label Guide](./06-white-label-guide.md) — Rebranding for new clients
- [07 – Developer Guide](./07-dev-guide.md) — Local setup and coding conventions
