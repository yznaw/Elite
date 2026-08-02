# 30 — Admin Portal & Storefront: Everything Open

Consolidated from every planning/QA doc that touches these two apps, so
there's one place to hand to the team instead of ~15 scattered files.
Compiled 2026-08-03.

**Scope:** Admin Portal (`client/projects/admin-portal`) and the storefront
(`client/projects/client-web`) only. **POS is deliberately not in this file**
— it has its own, more mature set of docs:
- `docs/25-pos-readiness-master-plan.md` — the full POS feature/readiness plan.
- `docs/27-server-ops-followups.md` — server/infra ops checklist (mostly done as of 2026-08-02).
- `docs/29-pos-till-device-signer-runbook.md` — standalone till install runbook.

Every item below cites its source doc — go there for full context before
starting something non-trivial. This file is a map, not a replacement for
the originals.

---

## 0. Uncommitted work already sitting in the working tree

Before anyone starts anything below, this needs a look — it's not part of
this backlog, it's in-progress work nobody has committed yet:

```
M client/projects/admin-portal/src/app/i18n/strings.ts
M client/projects/admin-portal/src/app/pages/settings/settings.component.ts
M client/projects/client-web/src/app/pages/home/home.component.scss
```

- The two admin-portal files: the receipt business-profile fix (Arabic
  address/trade-name made optional, since the receipt is English-only and
  never printed them — see `docs/12-pos-system.md` §13). Safe, tested,
  ready to commit.
- The client-web scss file: **not this session's work** — someone already
  fixed a real bug (a hero product image drop-shadow was rasterizing against
  its full rectangular layer bounds on real mobile GPUs instead of the
  image's alpha silhouette, showing a faint rectangular seam around the hero
  on phones — invisible in desktop Chrome including its device-emulation
  mode, which is presumably why it wasn't caught earlier). The fix looks
  correct on read-through but **has not been verified on a real phone** by
  whoever is reading this. Verify on-device, then commit.

---

## 1. Admin Portal

### 1.1 Storefront content is not actually editable from the admin — the biggest gap here

**Source:** `docs/storefront-content-plan.html`, corroborated by
`docs/progress-tracker.html` F5+F7.

The storefront's Home, Our Story, and Contact pages **do not read from the
`storefront-content` service at all** — they render hardcoded values in the
Angular components (`home.component.ts`, `story.component.ts`,
`contact.component.ts`). An admin editing "Our Story" or "Contact Us" content
has no effect on the live site, because there is no admin UI for those pages
to begin with, and even if there were, the storefront doesn't read from it.

To actually close this:
- Extend the `storefront-content` schema and `HomeContentData` model to cover
  Story and Contact page content (not just the home hero/promise/stats it
  already covers).
- Wire `home.component.ts` fully, and `story.component.ts` /
  `contact.component.ts` from scratch, to read from the content service
  instead of hardcoded values.
- Build a 3-tab admin editor (Home / Our Story / Contact Us) with sub-tab
  editors per section.
- Deprecate the old `/home-content` route once the new one covers everything
  it did.

This is a real feature build, not a bug fix — size it accordingly before
committing to it.

### 1.2 Product catalog feature backlog (0 of 52 tasks — `docs/progress-tracker.html`)

An explicit, unstarted backlog across 6 features. Each is independent and
can be picked up separately:

- **F1 — Stock auto-compute.** Product `stock_quantity` should be computed
  automatically from the sum of its variants on save
  (`admin-products.route.js`), and the manual stock input in the product
  drawer should hide/omit itself once variants exist — right now it's
  possible for the two to disagree.
- **F2 — Cost price.** ⚠ **Check this before starting** — the tracker
  describes adding a `cost_price_cents` migration on `product_variants`, but
  `docs/25-pos-readiness-master-plan.md` states that column has existed
  since migration 006. These two claims conflict; reconcile which is true
  (`grep cost_price_cents server/db/migrations/*.sql`) before assuming the
  migration itself is the open part — the *server include + TS model field +
  variants-table UI column* pieces of F2 are very likely still genuinely
  unbuilt even if the column already exists.
- **F3 — Margin formula.** A computed `variantMargins` signal, a
  color-coded margin column in the variants table, and an average-margin
  summary in the product drawer. Depends on F2's cost data actually being
  populated to be useful.
- **F4 — Remove 3D fields entirely.** `has3d`/`views3d` should be removed
  from the Product model, `normalizeProduct()`, the product-drawer 3D fact
  row and views badge, the catalog's 3D filter chip, the analytics "Top 3D
  Interactions" card, and the `product.fact.3d*` i18n keys. **Read together
  with §1.4 below** — the 3D/GLB upload buttons flagged as broken in QA are
  the same feature area this item removes; don't spend time wiring click
  handlers onto something slated for deletion.
- **F6 — Sidebar collapse.** A scrollable nav-links container, a desktop
  collapse toggle, `SidebarToggleService` collapsed state, and the app-shell
  CSS variable binding it drives. Pure UI, no backend.
- **F8 — Arabic product name.** Server-side upsert of `nameAr` into
  `product_translations`, the TS model field, a drawer input field, and
  bulk-import column mapping.

### 1.3 Arabic translation coverage (`docs/04-admin-portal.md`)

Sidebar Nav and Dashboard are fully translated. Product Catalog is "in
progress" per the doc's own tracker. **Storefront Editor, Order Management,
and Customer CRM have no Arabic translation started at all.**

### 1.4 Known-broken UI, already found and deferred (`docs/admin-portal-qa-plan.html`)

Three specific findings from a QA pass, explicitly marked deferred rather
than fixed:

- **Logo upload has no handler.** Settings → General → Logo section shows a
  display and an "Edit" button, but the button has no `(click)` handler at
  all — it's a visual stub.
- **Currency setting doesn't propagate.** The currency value saves correctly
  to the API, but `QAR()` — the price-formatting utility used everywhere
  prices are displayed — is a hardcoded static function that never reads it.
  Changing the currency setting currently does nothing visible anywhere.
- **3D/GLB upload buttons in the product drawer are stubs.** Replace,
  Unlink, Upload 3D, and Link URL all render but none have click handlers.
  **Do not implement these** — see F4 above, the direction is to remove the
  3D feature, not finish it.

### 1.5 Orders/Customers tracker — status unverified, check before acting

`docs/orders-customers-tracker.html` and
`docs/orders-customers-production-plan.html` describe a 3-phase backlog
(customer soft-delete, order idempotency keys, a 401 session-expiry modal,
skeleton loaders, CSV export wiring, mobile/size-stat fixes, ~30 tasks
total). The tracker file stores no real completion state — its tasks default
to "To Do" in embedded JS with only client-side `localStorage` toggling, and
separately `docs/04-admin-portal.md` states Orders/Customers already run on
live API data. **Do a direct code check against current
`orders.component.ts`/`customers.component.ts` before treating any item in
this tracker as open** — some or most of it may already be done and the
tracker just never got updated.

---

## 2. Storefront (Client Web)

### 2.1 Hero product photo re-cut — tooling built, the actual re-cut is not started

**Source:** `docs/26-hero-mobile-production-hardening-plan.md` §9.7, Phase 1.

The visible defect (color streaks/matte edges in the hero product cut-outs'
alpha channel, showing as a faint rectangle on Retina screens) needs a human
to re-cut the source photography — no code change fixes pixels that are
already wrong in the uploaded master.

**What already exists, ready to use:**
- `server/scripts/audit-hero-alpha.js` — run with `--sheets` to get a
  per-image report plus a 4-background QA contact sheet for every hero image
  currently in use. Read-only, no repair flag on purpose.
- A written team brief covering defect types, the export spec, and delivery
  steps (published as an artifact earlier in this project — ask whoever ran
  that session for the link, or regenerate one from the same script's
  output if it's been lost).

**Important caveat carried over from docs/26:** the original defect report
named one specific file (`ms3a8ern-21229187-pdp.webp`) which does not exist
on the dev database at all. **Run the audit script against whichever
environment is actually being fixed (production) before cutting anything** —
the scope of this task may be different from what the original report
assumed.

### 2.2 Hero physical-device test gate — not started

**Source:** `docs/26-hero-mobile-production-hardening-plan.md` Phase 5.

Code-level hardening (touch handling, reduced-motion, srcset correctness) is
done and covered by 30 passing automated tests, but automation cannot
certify Safari's double-tap-zoom behavior or real-device rendering. Needs a
real device matrix: current + previous iPhone Safari (normal and reduced
motion), Android Chrome, desktop Safari/Chrome — 30 mixed interactions per
row, per the doc's own checklist.

### 2.3 Broken product image on production

**Source:** `docs/27-server-ops-followups.md` item 7 (kept in that file
since it's a server-side fix, cross-listed here since the *symptom* is
storefront-facing).

`ms3aaetl-b2346277.webp` (and its `-zoom`/`-pdp` variants) is referenced in
the database but missing from `/var/www/elite-uploads` — throws `ENOENT`.
Needs either a re-upload of the correct image or unlinking the dead
reference; find out which product this belongs to first.

### 2.4 Color/variant swatches — not started

**Source:** `docs/variant-color-image-plan.html` (storefront-facing items
only; the DB/admin-side portion of this same doc is §1.2-adjacent work not
listed here since it's admin, not storefront).

- **Product cards** (collection grid): no color-dot swatches, and no
  hover-to-preview-a-color image swap. Currently a card only ever shows one
  photo regardless of how many colorways the product has.
- **Product detail page**: size availability isn't filtered to the
  currently-selected color's actual stock, there's no `?color=camel`-style
  URL param for deep-linking a specific colorway, and exotic-leather
  colorways have no texture-swatch treatment (they render as a flat color
  dot like any other color, which misrepresents the material).

---

## 3. How to prioritize (a starting recommendation, not a mandate)

If picking one thing to start with:

1. **Commit or discard §0** first — it's blocking a clean baseline for
   everything else.
2. **§2.1 (hero re-cut)** if the storefront's first impression matters most
   right now — the tooling is already built, so this is mostly the human
   photo-retouching step plus an upload.
3. **§1.1 (storefront content editability)** if the content team is
   currently blocked from updating Story/Contact pages — this is the
   largest single gap in the whole list, but it's a real feature build, not
   a quick fix.
4. Everything else in §1.2–§1.5 and §2.2–§2.4 can be parallelized across
   different people since they don't depend on each other.

---

*If any item here turns out to already be done, or any doc it cites has
since been updated, fix this file rather than leaving it stale — it exists
so nobody has to re-derive this list from scratch again.*
