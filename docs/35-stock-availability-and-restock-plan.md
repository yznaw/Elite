# 35 · Stock Availability and Restock Alerts Plan

> **Status:** Implemented locally on 2026-09-14; deployment and real SMTP delivery checks remain. The audit below records the original defects.
> **Arabic version:** [35-stock-availability-and-restock-plan.ar.md](./35-stock-availability-and-restock-plan.ar.md)
> **Related:** [03 Client Web](./03-client-web.md), [05 API Server](./05-api-server.md), [25 POS Readiness](./25-pos-readiness-master-plan.md) (shared inventory, no stock reservation)

---

## Implementation record · 2026-09-14

All seven phases are implemented. The recommended decisions are used: notify everyone waiting, preselect the first available size, retain closed requests for 180 days and pending requests for 365 days, and use the existing authenticated Catalog access policy. Email is the only alert channel.

- Shared availability helpers drive collection cards and product selection. The public product API now includes inactive variants with `isActive`, and product-level stock, so sold-out and variant-less products render correctly. Client and server share `shared/color-key.js`; migration SQL normalization is checked against the same alias map in tests.
- Restock requests validate the exact offered, sold-out combination under transaction locks. Size-less products use `ONE_SIZE`. The form never substitutes a size, and a stale `409 IN_STOCK` refreshes the selection.
- Migration **039_restock_dispatch.sql** owns the schema, deduplicates alias collisions, backfills legacy `0` only on products without sizes, and adds tokens, retries, claims and indexes. An archive trigger cancels waiting requests immediately, including archive/reactivate cycles between worker runs.
- The worker polls every two minutes and receives coalesced kicks after stock transactions commit. Claims use `SKIP LOCKED`, a claim token and a heartbeat. It rechecks stock, retries with backoff, recovers stale claims, reports missing configuration and runs retention cleanup once per UTC day.
- English/Arabic HTML and text emails contain the selected colour/size link and an unsubscribe link. The admin page supplies summary/detail filters, retry/cancel, paginated requests and CSV export; the editor shows per-variant demand and the dashboard shows the top five sold-out selections.
- Existing privacy policies gain the bilingual restock consent sentence through the migration. New signup forms show the same purpose clearly.

Validation completed:

- Server suite: **101 passed, 0 failed, 1 skipped**. The existing image-preview test skips because the local Sharp native runtime is unavailable.
- Restock database tests cover every stock channel, concurrent workers, stock changing before send, all retries, missing SMTP, crash recovery, unsubscribe, tenant isolation, admin actions and retention. Mail delivery is mocked; no real customers are emailed by tests.
- The focused stock suite passes all **24 tests**, including the database and email checks. Pure availability tests cover ordering, defaults, aliases, inactive variants and size-less/variant-less products.
- Production storefront and admin builds pass. Builds report style-budget/CommonJS warnings.
- Browser fixtures verify collection SSR/hydration, fixed card height, disabled sold-out choices, explicit restock size, quantity cap, `?color=&size=`, `?notify=1`, one-size submission, stale `409` recovery, admin filters/actions and Arabic mobile layouts. Run `node scripts/test-stock-storefront.mjs` and `node scripts/test-restock-admin.mjs` from `client/` after building.

Deployment: apply migration 039 through normal API startup, rebuild/reload both frontends, and set `STOREFRONT_BASE_URL=https://elitecollections.qa` plus SMTP settings before enabling delivery. Verify actual Arabic and English delivery on staging. This task did not deploy or send live email.

Delivery guarantee: overlapping workers do not send the same claimed request twice. SMTP acceptance and the database success update cannot be one atomic transaction; a crash between them can still cause a retry email. A stable Message-ID helps mail systems identify that retry but is not an exactly-once guarantee. Cancelled consent cannot be reopened by the admin resend action.

---

## 1. Why this plan exists

A customer could pick a sold-out size, add it to the bag, fill in the whole checkout, and only learn at "Proceed to Payment" that the item was unavailable. The server-side guard shipped on 2026-09-14 (commit `1145d17`) now stops that at add-to-bag, but the storefront still **offers** sold-out sizes as if they were buyable. The "Notify Me" alert that should catch that demand has gaps of its own: it can register the wrong size, never fires for most stock channels, and nobody on the team can see the requests.

This plan fixes the whole journey: **see availability → choose → notify me → get emailed → come back and buy**.

### Already shipped (not part of this plan)

| Guard | Where |
|---|---|
| Bag lines carry `available` stock | `GET /api/carts/current` |
| Add-to-bag refuses quantity beyond stock (409 `INSUFFICIENT_STOCK`) | `POST /api/carts/current/items` |
| Checkout re-checks stock under row locks and names the failing line | `POST /api/carts/checkout` |
| Drawer and checkout flag "Sold out" / "Only N left" with Remove / Change to N | `cart-drawer`, `checkout` |

These stay as the last line of defence for the one case the storefront cannot prevent: a unit that sells in the ~60 seconds before the product list refreshes.

---

## 2. Current behaviour (audit)

### 2.1 Collection page card (`pages/collection/`)

| # | Finding | Effect |
|---|---|---|
| C1 | `availableSizes()` returns **every** size when no colour is selected (the default state) | Sold-out sizes appear in the size dropdown |
| C2 | Default size is the **smallest** size, stock ignored | Quick Add targets a sold-out size; the customer sees the rejection only after clicking |
| C3 | Once a colour is hovered, sold-out sizes **disappear** instead of being marked | Customer cannot tell "sold out" from "never made in this size" |
| C4 | No colour is selected by default; tile leave clears the preview | The card's stock logic has no colour to work with |
| C5 | Colour swatches show no stock state | A fully sold-out colour looks identical to an available one |
| C6 | A fully sold-out product still shows Add to Cart and Buy Now | No "Out of stock", no Notify Me on the card |

### 2.2 Product page (`pages/product/`)

| # | Finding | Effect |
|---|---|---|
| P1 | Sizes sorted ascending, sold-out sizes left in place (greyed) | Available sizes are scattered between sold-out ones |
| P2 | No size pre-selected | Extra step even when only one size is in stock |
| P3 | Default colour is the first colour even when all its sizes are sold out | Page opens on a dead end |
| P4 | Quantity `+` has no upper bound | Customer can request 3 when 2 exist; rejected only at add |
| P5 | Fully sold-out product shows Notify Me but no "Out of stock" statement | Unclear page state |
| P6 | `submitRestockRequest()` falls back to `p.sizes[0]` when no size is chosen | **Alert is saved for the wrong size**, customer never hears back |
| P7 | Products without sizes send size `0`; the dispatcher matches `pv.size = '0'`, which never exists | Alert can never fire |

### 2.3 Restock alerts (`lib/restock-notifications.js`, `routes/products.route.js`)

| # | Finding | Effect |
|---|---|---|
| R1 | Emails are dispatched only from 3 admin endpoints: product create, product edit, `PATCH /bulk-stock` | Every other stock increase is silent (table below) |
| R2 | English-only plain-text email, although `locale` is stored | Arabic customers get an English email |
| R3 | Link built from `STOREFRONT_BASE_URL`, defaulting to `http://localhost:4200` | An unset variable in production sends **localhost links** |
| R4 | Link has no `?color=` / size | Customer lands on the default colour, not the one they asked for |
| R5 | No claim/lock before sending | Two concurrent saves of the same product can email the same person twice |
| R6 | Failures only write `last_error`; no retry count or back-off | Every later save retries a broken address forever; SMTP outages are invisible |
| R7 | SMTP not configured → request saved, nothing sent, nothing reported | Silent black hole |
| R8 | `POST /restock-notifications` has no rate limit, and does not validate that the size/colour exists or is actually sold out | Spam risk; alerts for impossible combinations; an in-stock size gets an instant "back in stock" email |
| R9 | No admin screen | Team cannot see demand, resend, or clean up |
| R10 | No unsubscribe/cancel link, no retention rule | Privacy and consent gap |
| R11 | Archived products keep `pending` requests forever | Dead rows, and emails if the product is later un-archived with stale stock |
| R12 | Colour matching is `lower(color)` on the server, but the storefront also applies aliases (`brwon` → `brown`) | A request saved under an alias may never match its variant |

**Stock increase channels today:**

| Channel | Code path | Sends alert today |
|---|---|---|
| Product create / edit | `admin-products.route.js` `POST /`, `PATCH /:id` | Yes |
| Bulk stock update | `admin-products.route.js` `PATCH /bulk-stock` | Yes |
| Inventory adjustment | `inventory-ops-service.js` via `POST /admin/inventory/adjustments` | **No** |
| Stocktake post | `inventory-ops-service.js` via `POST /admin/inventory/stocktakes/:id/post` | **No** |
| CSV stock import | `admin-bulk-import.route.js` `POST /stock/:id/commit` | **No** |
| Catalog CSV import | `admin-bulk-import.route.js` | **No** |
| POS refund / void with restock | `pos/correction-service.js` | **No** |
| Web order cancelled / refunded | `order-stock.js` `reversePaidOrderStock()` | **No** |

---

## 3. Target behaviour

### 3.1 Shared availability rules (both pages)

1. A size is **available** for a colour when an active variant with that size and colour has `stock > 0`.
2. A size is **sold out** when variants exist for it but none has stock (or all are inactive).
3. A size with no variant at all for that colour is **not offered** (hidden on the card; stays struck-through on the product page as today).
4. A colour is **sold out** when none of its sizes is available.
5. A product is **sold out** when no colour/size is available. Products without variants use `product.stock`.
6. Ordering: available sizes ascending, then sold-out sizes ascending.
7. Default colour: a `?color=` deep link wins (even if sold out, the customer asked for it); otherwise the **first colour that has an available size**; otherwise the first colour.
8. Default size: the **first available size** of the default colour; none if the colour is sold out.
9. Colour keys use one normalisation on client **and** server (trim, lower-case, alias map) so a request and its variant always match.
10. Rules must be deterministic from product data (no hover state) so server render and browser render agree.

### 3.2 Collection card

Approved states (owner, 2026-09-14):

| State | Card shows |
|---|---|
| Available (default) | Colour and size pre-selected, Add to Cart + Buy Now enabled |
| Just added | "Added ✓" for ~2 s (existing) |
| Visible colour sold out, other colours available | Size list with every size "(Sold out)", single **Notify Me** button, Buy Now hidden |
| Whole product sold out | "Out of stock" under the price, all swatches marked, single **Notify Me** button |

Details:

- **Size dropdown:** all offered sizes; sold-out options are `disabled` and labelled `41 (Sold out)`. Native `<select>` is kept (works on mobile, screen readers announce disabled options).
- **Swatches:** a sold-out colour is faded with a diagonal line, **still clickable/hoverable** so the customer can see it and request an alert. `aria-label` becomes "Green, sold out".
- **Tile leave:** returns to the default available colour, not to "no colour".
- **Notify Me** navigates to the product page with `?color=<colour>&notify=1`.
- No badges or pills over the product image.
- Not included (owner decision): "Only N left" hint, "All available already in your bag" state.

### 3.3 Product page

- Sizes ordered per §3.1; sold-out sizes stay selectable (to request an alert) and are labelled.
- Default colour and size per §3.1.
- Quantity `+` capped at the selected variant's stock; the cap is shown ("Max 2").
- Sold-out product: "Out of stock" statement above Notify Me.
- `?notify=1`: open the restock panel and scroll to it after load.
- **Restock form requires an explicit size** when the product has sizes: the panel contains its own size choice limited to the sold-out sizes of the current colour, pre-filled only if the customer already selected a sold-out size. No silent fallback to `sizes[0]`.
- Products without sizes send no size; server stores the sentinel `ONE_SIZE` and matches it against variant-less / size-less stock.
- If the chosen size turns out to be in stock (stale page), the API answers 409 `IN_STOCK` and the page switches that size back to Add to Cart instead of saving an alert.

### 3.4 Restock request API

`POST /api/products/:id/restock-notifications`

- New `restockRequestLimiter` in `middleware/rate-limit.js` (suggested: 10 requests / 15 min per IP).
- Validate: product active; colour belongs to the product (normalised); size is offered for that colour; the combination is currently **sold out**. Otherwise 422 (invalid) or 409 `IN_STOCK`.
- Locale normalised to `ar` | `en`.
- Store normalised colour key alongside the display colour.
- Generate an `unsubscribe_token` per request.
- Stop calling `processRestockNotifications()` from this endpoint (it is only needed because of R8; validation removes the reason).

### 3.5 Reliable dispatch

**Principle:** detect "back in stock" from the data, not from the code path that changed it. That covers every channel in §2.3, current and future, including manual SQL.

1. **Worker job** `lib/restock-dispatch-job.js`, started in `server/index.js` beside `startInventoryConsistencyJob()`, runs every **2 minutes**.
2. Claims due rows in one statement:
   ```sql
   UPDATE restock_notifications rn SET status = 'sending', claimed_at = now()
    WHERE rn.id IN (
      SELECT rn2.id FROM restock_notifications rn2
       WHERE rn2.status = 'pending' AND rn2.next_attempt_at <= now()
         AND EXISTS (<active variant, size + colour key match, stock > 0>)
       ORDER BY rn2.requested_at
       LIMIT 50
       FOR UPDATE SKIP LOCKED)
   RETURNING ...
   ```
   `SKIP LOCKED` plus the `sending` status prevents double sends across PM2 instances and overlapping runs (fixes R5).
3. **Re-check stock** right before sending; if it sold out again, return the row to `pending`.
4. On success: `notified`, `notified_at`. On failure: `attempts + 1`, `last_error`, `next_attempt_at` with back-off (5 min, 30 min, 2 h, 12 h), `failed` after 5 attempts.
5. SMTP not configured: do not consume attempts; log once per run and raise one alert through `lib/alerts.js` per day (fixes R7).
6. Rows stuck in `sending` for more than 15 minutes (process crash) are returned to `pending`.
7. **Fast path:** the three existing admin call sites, plus inventory adjustments, stocktake post, stock import commit, POS refund restock and order reversal, call `kickRestockDispatch(productIds)` **after COMMIT**. It only schedules an immediate worker run; it never sends inside a transaction. The periodic run remains the safety net.
8. Archived/deleted products: the worker marks their pending rows `cancelled` (fixes R11). Deletion already cascades.

**Fairness decision (recommended):** email **everyone** waiting for that size/colour when it returns, even if fewer units came back. The email says quantities are limited. Alternative (batch by stock count) is listed in §6.

### 3.6 Email

- Templates in `lib/restock-email.js`: **Arabic and English**, chosen by `locale`, HTML with a plain-text part.
- Content: product name (Arabic name when available), image, size, colour label, price, one button to the product page.
- Link: `${STOREFRONT_BASE_URL}/product/<id>?color=<slug>&size=<size>`. The product page pre-selects that size when it is in stock.
- Footer: "You asked to be told when this was back" + **unsubscribe link** (`GET /api/restock-notifications/unsubscribe?token=...` → marks `cancelled`, shows a small confirmation page).
- `STOREFRONT_BASE_URL` becomes **required in production**: the server logs an error at startup and the worker refuses to send when it is unset or points at localhost (fixes R3).

### 3.7 Admin portal

New page **Restock Requests** (`/restock-requests`, catalog permission), linked from Catalog.

- Summary table grouped by product, colour and size: waiting count, oldest request, current stock.
- Row detail: email, locale, requested at, status, attempts, last error.
- Actions: resend now (sets `next_attempt_at = now()`), cancel, export CSV.
- Filters: status, product, date range.
- Product editor shows "N customers waiting" next to each variant with pending requests.
- Dashboard card: top 5 most-requested sold-out sizes (purchasing signal).

API: `GET /api/admin/restock-requests`, `GET /api/admin/restock-requests/summary`, `POST /api/admin/restock-requests/:id/resend`, `POST /api/admin/restock-requests/:id/cancel`, `GET /api/admin/restock-requests/export.csv`.

### 3.8 Privacy and retention

- Form helper text: "We will only use this email to tell you when this size is back."
- Privacy policy gains one sentence on restock alerts (content change in admin Policies).
- Nightly cleanup deletes `notified`, `cancelled` and `failed` rows older than **180 days**, and `pending` rows older than **365 days**.
- Unsubscribe works without login.

---

## 4. Database changes

The following is the original proposal. The applied, idempotent migration is [039_restock_dispatch.sql](../server/db/migrations/039_restock_dispatch.sql); it additionally includes claim tokens, safe alias deduplication, archive cancellation and privacy copy.

One migration via the `elite-migration` skill (next free number at implementation time). The table is currently created by `db/restock-notifications-schema.js`; the migration becomes the source of truth and that runtime ensure is reduced to a no-op check.

```sql
ALTER TABLE restock_notifications
  ADD COLUMN IF NOT EXISTS color_key text,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid();

-- status gains 'sending' and 'failed'
ALTER TABLE restock_notifications DROP CONSTRAINT restock_notifications_status_check;
ALTER TABLE restock_notifications ADD CONSTRAINT restock_notifications_status_check
  CHECK (status IN ('pending', 'sending', 'notified', 'failed', 'cancelled'));

UPDATE restock_notifications SET color_key = lower(trim(coalesce(color, ''))) WHERE color_key IS NULL;

-- Backfill for P6/P7 damage: rows saved with size '0' on size-less products
UPDATE restock_notifications SET size = 'ONE_SIZE' WHERE size = '0';

CREATE INDEX IF NOT EXISTS restock_notifications_due_idx
  ON restock_notifications (status, next_attempt_at) WHERE status IN ('pending', 'sending');
CREATE UNIQUE INDEX IF NOT EXISTS restock_notifications_unsubscribe_idx
  ON restock_notifications (unsubscribe_token);
```

The pending-unique index moves from `lower(COALESCE(color, ''))` to `color_key`. Additive; the previous release keeps working against the new schema.

---

## 5. Implementation phases

Each phase ships and deploys on its own. Order is chosen so the customer-visible bug is fixed first.

| Phase | Scope | Size | Depends on |
|---|---|---|---|
| 1 | Shared availability helper + collection card (§3.1, §3.2) | M | none |
| 2 | Product page (§3.3) incl. restock form size fix | M | 1 |
| 3 | Restock API hardening + migration (§3.4, §4) | S | none |
| 4 | Dispatch worker + fast-path kicks (§3.5) | M | 3 |
| 5 | Bilingual email + unsubscribe + base URL guard (§3.6) | S | 4 |
| 6 | Admin Restock Requests page (§3.7) | M | 3 |
| 7 | Privacy copy + retention job (§3.8) | S | 3 |

### Phase 1: Collection card

Files: new `client-web/src/app/shared/stock-availability.ts` (pure functions, no Angular), `pages/collection/collection.component.{ts,html,scss}`, `i18n/strings.ts`.

- `sizeOptions(product, color)` → `{ size, state: 'available' | 'sold-out' }[]` ordered per §3.1.
- `colorState(product, color)`, `productSoldOut(product)`, `defaultColor(product)`, `defaultSize(product, color)`.
- Replace `availableSizes()`, `selectedSize()`, `previewProductColor()`, `clearProductColorPreview()`, `addToCart()`, `buyNow()` logic with the helper.
- Strings: `stock.soldOutOption` "(Sold out)" / "(نفد)", `stock.outOfStock` "Out of stock" / "نفد المخزون", `stock.notifyMe` "Notify Me" / "أبلغني", `stock.colorSoldOut` "{color}, sold out" / "{color}، نفد".

Acceptance:
- [x] A product whose smallest size is sold out opens with the first available size selected.
- [x] Sold-out sizes are listed last, disabled, labelled.
- [x] Hovering a sold-out colour shows all sizes sold out and a single Notify Me.
- [x] A fully sold-out product shows "Out of stock" and Notify Me; no Add/Buy buttons.
- [x] Quick Add never produces the drawer's "sold out" notice with fresh data.
- [x] Card height does not change between states.
- [x] Arabic and English, mobile width, server render matches browser render (no hydration warning).

### Phase 2: Product page

Files: `pages/product/product.component.{ts,html,scss}`, `i18n/strings.ts`, reuse `stock-availability.ts`.

Acceptance:
- [x] Available sizes first; first available size pre-selected; deep-linked `?color=` respected.
- [x] `?size=` from the email pre-selects that size when in stock.
- [x] Quantity cannot exceed variant stock.
- [x] `?notify=1` opens and focuses the restock panel.
- [x] Restock form cannot be submitted without choosing a sold-out size (products with sizes).
- [x] Size-less product request is saved as `ONE_SIZE`.
- [x] 409 `IN_STOCK` switches the page back to Add to Cart for that size.

### Phase 3: Restock API hardening

Files: `routes/products.route.js`, `middleware/rate-limit.js`, `lib/restock-notifications.js`, new migration.

Acceptance:
- [x] 11th request from one IP within 15 min → 429.
- [x] Unknown size/colour → 422; in-stock combination → 409 `IN_STOCK`; archived product → 404.
- [x] Colour alias (`brwon`) saved with `color_key = 'brown'`.

### Phase 4: Dispatch worker

Files: new `lib/restock-dispatch-job.js`, `server/index.js`, call sites listed in §2.3.

Acceptance (server e2e, one test per channel):
- [x] Inventory adjustment 0 → 3 emails the waiting customer within one worker run.
- [x] Same for stocktake post, stock CSV commit, catalog import, POS refund with restock, web order reversal, product edit, bulk stock.
- [x] Two concurrent worker runs send exactly one email per request.
- [x] Stock returns to 0 between claim and send → no email, row back to `pending`.
- [x] SMTP failure → attempts/back-off recorded; 5th failure → `failed`.
- [x] SMTP not configured → attempts unchanged, one alert.
- [x] Crash mid-send (row left `sending` > 15 min) → recovered to `pending`.

### Phase 5: Email

Acceptance:
- [x] `locale = 'ar'` receives the Arabic template (RTL), `en` the English one.
- [x] Link contains colour and size and opens the right selection.
- [x] Unsubscribe link cancels the request and shows confirmation; second click is harmless.
- [x] Unset or localhost `STOREFRONT_BASE_URL` in production blocks sending and logs an error.

### Phase 6: Admin page

Files: `admin-portal` new page via `elite-admin-page` skill, new `routes/admin-restock-requests.route.js`, `docs/04-admin-portal.md`.

Acceptance:
- [x] Summary and detail views, filters, CSV export.
- [x] Resend and cancel work and are permission-gated.
- [x] Product editor shows waiting counts per variant.

### Phase 7: Privacy and retention

Acceptance:
- [x] Helper text under the email field in both languages.
- [x] Nightly job removes rows past retention; verified with backdated rows in a test.

---

## 6. Decisions applied at implementation

| # | Decision | Recommendation | Alternative |
|---|---|---|---|
| D1 | Who is emailed when fewer units return than people waiting | Everyone, email says "limited quantity" | Only as many as units returned, oldest first, rest stay pending |
| D2 | Auto-select a size on the product page | Yes, first available size | Keep "choose a size" as today |
| D3 | Retention | 180 days after closed, 365 days pending | Shorter (90 / 180) |
| D4 | Who sees Restock Requests in admin | Catalog permission | Owner only |
| D5 | Also offer WhatsApp/SMS alerts | Not now; email first | Phone field + WhatsApp template later |

---

## 7. Cases deliberately not changed

- **No stock reservation for pending (unpaid) orders.** Accepted in docs/25; the checkout 409 and the paid-order oversell flag remain the handling.
- **~60 s product list cache** (`ProductsService.cacheMs`, `Cache-Control: max-age=60`). The add-to-bag 409 covers the gap. After a 409 the storefront will call `ProductsService.refresh()` so the card updates immediately (Phase 1).
- **"All available already in your bag"** card state and **"Only N left"** hint: not requested.

---

## 8. Test plan summary

| Layer | What |
|---|---|
| Unit (`node --test`, like `test:sku`) | `stock-availability.ts`: ordering, defaults, aliases, size-less and variant-less products |
| Server e2e | Restock API validation and rate limit; worker per stock channel; concurrency; retries; unsubscribe; retention |
| Existing | `cart-stock-e2e`, `inventory-integrity-e2e`, POS suites must stay green |
| Browser (Playwright) | Collection card four states; product page `?notify=1`, `?color=&size=`; Arabic RTL |
| Manual on staging | Real SMTP delivery in both languages; link opens correct colour/size |

---

## 9. Deployment notes

- Phase 3 adds a migration; the API applies it at startup (docs/DEPLOYMENT.md §4).
- Phase 4 adds a background job; confirm only one PM2 API instance or rely on `SKIP LOCKED` (safe either way).
- Phase 5: set `STOREFRONT_BASE_URL=https://elitecollections.qa` and verify `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` on the server before deploying.
- Storefront phases require `npm run build:web` and `pm2 reload elite-web`; admin phase requires `npm run build:admin`.
