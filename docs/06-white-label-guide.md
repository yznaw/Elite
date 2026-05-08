# 06 — White-Label Guide

> **Audience:** Dev team when onboarding a new client  
> **Reading time:** ~15 minutes

---

## What Is White-Label?

This codebase is designed to be **resold to multiple clients** under different brand identities. "White-label" means:

- Same underlying product functionality
- Different brand name, logo, colors, and copy
- Configurable feature set (enable/disable pages and modules)
- Each client gets their own deployment

---

## Quick Start: New Client in 10 Steps

| # | Step | File(s) to Edit | Time |
|---|---|---|---|
| 1 | Fork/branch the repo | Git | 1 min |
| 2 | Edit brand config | `brand.config.json` | 10 min |
| 3 | Update storefront CSS tokens | `client-web/src/styles.scss` `:root` | 5 min |
| 4 | Update admin CSS tokens | `admin-portal/src/styles.scss` `:root` | 5 min |
| 5 | Update storefront i18n strings | `client-web/src/app/i18n/strings.ts` | 30 min |
| 6 | Update admin i18n strings | `admin-portal/src/app/i18n/strings.ts` | 20 min |
| 7 | Replace product data | `client-web/services/products.service.ts` + `admin-portal/data/mock.ts` | 15 min |
| 8 | Replace assets (logo, favicon, OG image) | `src/assets/`, `src/favicon.ico` | 5 min |
| 9 | Replace fonts (if different typeface needed) | `src/assets/fonts/`, `styles.scss` @font-face | 10 min |
| 10 | Update env & deploy | `server/.env`, hosting config | 15 min |

**Total: ~2 hours for a basic rebrand**

---

## Step-by-Step Details

### Step 1: Fork/Branch

```bash
# Option A: Git branch (same repo, different branch per client)
git checkout -b client/acme-shoes

# Option B: Full fork (separate repo per client)
# Fork on GitHub/GitLab, then clone
```

> **Recommendation:** Use branches for clients you manage internally. Use forks for clients who get their own repo access.

---

### Step 2: Edit `brand.config.json`

This is the **single source of truth** for all brand-specific values:

```json
{
  "brand": {
    "name": "ACME Shoes",
    "tagline": "Handcrafted Italian Leather",
    "established": "Est. 2015 · Milan",
    "copyright": "© 2026 ACME Shoes. All rights reserved."
  },
  "theme": {
    "clientWeb": {
      "bg": "#fafaf8",
      "gold": "#8B6914",
      "fontSerif": "'Playfair Display', Georgia, serif"
    },
    "adminPortal": {
      "green": "#1a365d",
      "gold": "#D4A537"
    }
  },
  "features": {
    "pages": {
      "story": false,
      "contact": true,
      "checkout": true
    },
    "admin": {
      "analytics": true,
      "sync": false,
      "media": true,
      "storefrontEditor": true
    }
  }
}
```

> **Note:** This file is currently used as a **reference document**. To make it runtime-configurable, you would load it via an Angular environment file or an API endpoint.

---

### Step 3: Update Storefront CSS Tokens

Open `client/projects/client-web/src/styles.scss` and change the `:root` block:

```scss
// BEFORE (Elite — cream & gold, Thmanyah fonts)
:root {
  --bg:        #faf8f4;
  --surface:   #f4f0e8;
  --gold:      #b8924a;
  --gold-dim:  #9a7535;
  --cream:     #1a1208;
  --muted:     #8a7a62;
  --ff-serif:  'Thmanyah Serif Display', Georgia, serif;
  --ff-sans:   'Thmanyah Sans', system-ui, sans-serif;
}

// AFTER (ACME — white & navy, custom fonts)
// If keeping Thmanyah: just change the colors, fonts stay the same.
// If using a different typeface: update @font-face at top of file too.
:root {
  --bg:        #fafaf8;
  --surface:   #f0f0ed;
  --gold:      #8B6914;
  --gold-dim:  #6b5010;
  --cream:     #1a1a2e;
  --muted:     #6b6b7b;
  --ff-serif:  'Playfair Display', Georgia, serif;
  --ff-sans:   'Inter', system-ui, sans-serif;
}
```

**Everything downstream** (buttons, cards, accents, borders) uses these variables — so this one change rebrands the entire storefront.

Also update the gold gradient in `.btn-gold`:

```scss
.btn-gold {
  background: linear-gradient(135deg, #YOUR_ACCENT_LIGHT, #YOUR_ACCENT_DARK);
}
```

---

### Step 4: Update Admin CSS Tokens

Open `client/projects/admin-portal/src/styles.scss` and change the `:root` block:

```scss
// Key variables to change:
:root {
  --green:   #1a365d;    // ← Primary brand color (was deep green)
  --green-2: #2a4a7f;    // ← Lighter variant
  --green-3: #0f2040;    // ← Darker variant
  --gold:    #D4A537;     // ← Accent color
  --gold-2:  #E8C060;     // ← Lighter accent
  --ff-ui:   'Thmanyah Sans', system-ui, sans-serif;   // Keep or change
  --ff-disp: 'Thmanyah Serif Display', Georgia, serif; // Keep or change
}
```

**What this affects:** Sidebar background, button colors, KPI values, card titles, active tab indicators, chart colors.

---

### Step 5: Update Storefront i18n Strings

Open `client/projects/client-web/src/app/i18n/strings.ts`.

#### Brand-Specific Keys to Change

These keys contain the Elite brand identity and MUST be changed:

```typescript
// English — change these:
'brand.name': 'ACME SHOES',
'brand.tagline': 'Handcrafted Italian Leather',
'brand.heritageEst': 'Est. 2015 · Milan',
'brand.heritageEstFull': 'Est. 2015 · Milan, Italy',

// Footer
'footer.tagline': 'Handcrafted in Milan since 2015. Limited to 200 pairs per year.',
'footer.copyright': '© 2026 ACME Shoes. All rights reserved.',
'footer.cities': 'Milan · Rome · London',

// Contact info
'contact.info.atelier.title': 'Milan Atelier',
'contact.info.atelier.l1': 'Via Montenapoleone 8, Milan',
'contact.info.client.l1': '+39 02 XXX XXXX',
'contact.info.client.l2': 'advisors@acmeshoes.com',

// Story page (if enabled)
'story.chapter.1962.title': 'A Workshop in Brera',  // ← Rewrite the entire story
// ... all story.* keys

// Product descriptions
'product.handcraftedSuffix': 'Handcrafted in Milan',
'product.attr.originValue': 'Milan, Italy',
```

#### Generic Keys (Usually Keep As-Is)

These keys are generic UI labels that typically don't need changing:

```typescript
'common.viewDetails': 'View Details',    // ← Generic, keep
'cart.subtotal': 'Subtotal',             // ← Generic, keep
'checkout.step.details': 'Details',      // ← Generic, keep
```

#### Arabic Translations

If the new client doesn't need Arabic, you can:
- Remove the `AR` object entirely
- Set `supportedLocales: ['en']` in brand config
- Remove the language switcher from nav

If they need a different second language (e.g., French), replace `AR` with `FR` and update the `Locale` type.

---

### Step 6: Update Admin i18n Strings

Open `client/projects/admin-portal/src/app/i18n/strings.ts`.

Most admin strings are **generic** (e.g., "Save", "Delete", "Product Catalog") and don't need changing. Focus on:

```typescript
'brand.name': 'ACME',
'brand.tagline': 'Admin Portal',
// Currency formatting:
'product.field.price': 'Price (EUR)',    // Was 'Price (QAR)'
```

Also update the currency helper in `models/index.ts`:

```typescript
// BEFORE
export const QAR = (n: number): string => 'QAR ' + n.toLocaleString();

// AFTER
export const CURRENCY = (n: number): string => '€' + n.toLocaleString();
```

---

### Step 7: Replace Product Data

#### Client Web

In `client-web/src/app/services/products.service.ts`, replace the `ALL_PRODUCTS` array:

```typescript
const ALL_PRODUCTS: Product[] = [
  {
    id: 1,
    name: 'Milano Oxford',
    price: 450,
    tag: 'Signature',
    leather: 'Italian Calf',
    style: 'Oxford',
    sizes: [39, 40, 41, 42, 43, 44],
    image: 'https://your-cdn.com/milano-oxford.jpg'
  },
  // ... more products
];
```

#### Admin Portal

In `admin-portal/src/app/data/mock.ts`, replace all mock data arrays with client-specific data — or remove mock data entirely when connecting to a real API.

---

### Step 8: Replace Assets

| Asset | Location | Notes |
|---|---|---|
| Favicon | `projects/*/src/favicon.ico` | Replace in both apps |
| Logo | `projects/*/src/assets/logo.svg` | Used in nav and sidebar |
| OG Image | `projects/*/src/assets/og-image.jpg` | Social media preview |
| App Icons | `projects/*/src/assets/icons/` | PWA icons if applicable |

---

### Step 9: Replace Fonts (If Needed)

The project uses the **Thmanyah** font family, self-hosted from `assets/fonts/thmanyah/`. If the new client wants a different typeface:

1. Add the new font files (woff2) to `assets/fonts/` in both apps
2. Update the `@font-face` declarations at the top of both `styles.scss` files
3. Update the CSS custom properties:
   ```scss
   --ff-serif: 'Your Serif Font', Georgia, serif;
   --ff-sans:  'Your Sans Font', system-ui, sans-serif;
   ```
4. Optionally load Google Fonts by adding `<link>` tags back to both `index.html` files

If the client is fine with Thmanyah (which natively supports Arabic + Latin), **skip this step entirely** — just change the colors.

---

### Step 10: Update Environment & Deploy

1. Update `server/.env`:

```bash
PORT=3000
CORS_ORIGINS=https://acmeshoes.com,https://admin.acmeshoes.com
NODE_ENV=production
```

2. Update `index.html` meta tags:

```html
<title>ACME Shoes — Handcrafted Italian Leather</title>
<meta name="description" content="ACME Shoes — handcrafted Italian leather shoes since 2015." />
```

3. Build and deploy:

```bash
npm run build:all
# Deploy client/dist/client-web/ → acmeshoes.com
# Deploy client/dist/admin-portal/ → admin.acmeshoes.com
# Deploy server → API host
```

---

## Feature Toggles

### Disabling a Storefront Page

To remove the "Story" page for a client that doesn't need it:

1. **Remove the route** from `client-web/src/app/app.routes.ts`:

```typescript
// Delete or comment out:
// {
//   path: 'story',
//   loadComponent: () =>
//     import('./pages/story/story.component').then(m => m.StoryComponent),
// },
```

2. **Remove the nav link** from `NavComponent`
3. **Remove the footer link** from `FooterComponent`

### Disabling an Admin Module

To remove "Sync" for a client that doesn't use POS integration:

1. **Remove the route** from `admin-portal/src/app/app.routes.ts`
2. **Remove the sidebar link** from `SidebarComponent`
3. Optionally remove the component folder entirely

### Changing Currency

1. Update `QAR()` helper in `admin-portal/src/app/models/index.ts`
2. Update `common.currency.*` keys in both i18n files
3. Update price formatting in product display components

---

## White-Label Checklist

Use this checklist when onboarding a new client:

- [ ] Branch/fork created
- [ ] `brand.config.json` updated
- [ ] Storefront `:root` CSS variables updated
- [ ] Admin `:root` CSS variables updated
- [ ] Storefront `strings.ts` — brand keys updated (EN)
- [ ] Storefront `strings.ts` — brand keys updated (AR or removed)
- [ ] Admin `strings.ts` — brand keys updated (EN)
- [ ] Admin `strings.ts` — brand keys updated (AR or removed)
- [ ] Product data replaced or API connected
- [ ] Customer/order mock data replaced or API connected
- [ ] Logo replaced (both apps)
- [ ] Favicon replaced (both apps)
- [ ] Fonts: kept Thmanyah or replaced with client's typeface (both apps)
- [ ] `<title>` and `<meta>` tags updated (both apps)
- [ ] `.env` updated with production domains
- [ ] Currency helper updated
- [ ] Unwanted pages/modules removed
- [ ] Smoke test: storefront loads correctly
- [ ] Smoke test: admin portal loads correctly
- [ ] Smoke test: language toggle works
- [ ] Smoke test: RTL layout works (if applicable)
- [ ] Production build succeeds
- [ ] Deployed to client domain

---

## Related Documents

- [01 – Project Overview](./01-project-overview.md) — Product overview
- [03 – Client Web](./03-client-web.md) — Storefront technical details
- [04 – Admin Portal](./04-admin-portal.md) — Admin technical details
- [07 – Developer Guide](./07-dev-guide.md) — Development setup
