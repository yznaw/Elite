# 36 — Customer identity collision: storefront checkout 500

**Status:** implemented and regression-tested locally on 2026-09-18; production rollout is pending. Written after the incident described in §1 took storefront checkout down in production. See §11 for implementation and verification notes.

**For the implementer:** this is a complete spec. Every schema fact in §3 was verified against the migrations rather than inferred — you should not need to re-derive them, but §9 tells you what to verify on the live database before deploying.

**Original starting state:** clean, with email-first matching in `server/lib/customer-identity.js`. The implementation now uses phone-first matching and guarded identifier writes.

---

## 1. Context

Storefront checkout returns HTTP 500 on `POST /api/carts/checkout`. Production log:

```
duplicate key value violates unique constraint "customers_tenant_phone_key_idx"
  at resolveCustomer   (server/lib/customer-identity.js:98)
  at upsertCustomer    (server/routes/carts.route.js:150)
  at POST /api/carts/checkout (server/routes/carts.route.js:475)
```

Line 98 is the **UPDATE**, not the INSERT. A customer *was* matched; writing an identifier onto it collided.

This is a revenue-path outage. It is **not** a regression from the September 2026 performance work — nothing in that change set touched this path (verified against `git log` for `carts.route.js`, `customer-identity.js`, `order-number.js`).

### Why it happens

`findExistingCustomer` (`customer-identity.js:60-84`) matches **email first**. On an email match it returns immediately and never consults the phone. `resolveCustomer` then runs an UPDATE that fills blanks:

```sql
email        = COALESCE(email, $4::citext),
phone_number = COALESCE(phone_number, $5),
phone        = COALESCE(phone, $5),
```

If the matched row has no phone, this writes the incoming phone. If a **different live customer already holds that `phone_key`**, the partial unique index aborts the transaction and the whole checkout 500s.

The triggering shape is the exact scenario this file exists to reconcile:

| Row | Origin | Has |
|---|---|---|
| Customer A | online order | email, no phone |
| Customer B | till walk-in | phone, no email |

A new online order sends **A's email + B's phone** → matches A by email → writes B's phone onto A → collision.

### There is a second, unreported crash path

`findExistingCustomer` filters `deleted_at IS NULL`, but `UNIQUE (tenant_id, email)` (`001_initial_schema.sql:134`) is a **plain table constraint with no `deleted_at` filter**. So when the only row holding an email is soft-deleted:

1. the matcher does not see it and returns no match;
2. `resolveCustomer` falls through to the **INSERT** (`customer-identity.js:130`);
3. the INSERT violates `(tenant_id, email)` → checkout 500s identically.

The stack trace for this variant points at line ~130, not 98. **Fix both paths.** A fix that only reorders matching leaves this one live.

---

## 2. Decision

**The phone number is the primary identifier.** (Owner's decision.) The till runs on phone, customers keep a number for years, one person has several email addresses.

So: match on **normalized phone first, then email**.

**Reordering alone is insufficient.** The same UPDATE also writes `email = COALESCE(email, …)`, and `(tenant_id, email)` is unique too. The mirrored scenario simply moves the 500 from the phone index onto the email constraint. **Both identifier writes must be guarded, and the INSERT must be guarded too.**

---

## 3. Verified schema facts

Do not re-derive these; they were checked against the migrations.

| Fact | Source |
|---|---|
| `UNIQUE (tenant_id, email)` — plain constraint, **not** partial, does **not** exclude soft-deleted | `001_initial_schema.sql:134` |
| `customers.email` is **nullable** (since migration 023); Postgres treats NULLs as distinct, so any number of phone-only customers coexist | `023_pos_customer_link.sql:22` |
| `customers_tenant_phone_key_idx` — **partial** unique: `ON customers (tenant_id, phone_key) WHERE phone_key IS NOT NULL AND deleted_at IS NULL` | `023:65-67` |
| `phone_key` is a STORED GENERATED column: `NULLIF(regexp_replace(COALESCE(phone_number, phone, ''), '[^0-9]', '', 'g'), '')` — **no minimum length** | `023:30-34` |
| Migration 023 creates the unique index **conditionally** — it skips creation and only `RAISE NOTICE`s when duplicate live phones already exist. The index may not exist on a given database. | `023:57-69` |

**Asymmetry to respect:** phone guards must be scoped to live rows (`deleted_at IS NULL`, matching the partial index). Email guards must **not** be, because the email constraint covers deleted rows too.

### Phone normalisation divergence (the landmine)

Three different implementations exist:

| Where | Rule |
|---|---|
| `customer-identity.js:51` `normalizePhone` | digits only, **returns null below 6 digits** |
| `023:30-34` generated column | digits only, **no floor** |
| `pos.route.js:299` POS search | digits only, `LIKE '%…%'` substring, 3-char floor |

A 4-digit phone gets a non-null `phone_key` in the database and is therefore subject to the unique index, but `normalizePhone` returns null so the matcher never looks it up — a guaranteed unguarded collision. And this is reachable through validated input: `pos.route.js:349` accepts `^[0-9+\-\s()]{6,25}$`, so `"(12) 3"` is 6 characters and 3 digits.

Independent normalisers that are **not** identity and should be left alone: `lib/sadad.js:84-88`, `lib/nbox.js:320`.

---

## 4. Scope

**In scope**

1. `server/lib/customer-identity.js` — reorder to phone-first; guard both identifier writes; guard the INSERT; align the normalisation floor; add a retry for the concurrent race.
2. `server/routes/admin-customers.route.js` — three unguarded write paths that can produce the identical 500 from the admin portal.
3. `server/routes/lib.js` — add a `conflict()` helper (only `ok`, `created`, `notFound`, `validationError` exist today).
4. Admin client — surface the new 409 instead of a generic failure.
5. Tests.

**Explicitly out of scope** (flag to the owner, do not fix here)

- Merging customer rows that are already duplicated. See §7.
- `v_customer_order_stats` (`016_pos_operations.sql:66-88`) does not filter `deleted_at IS NULL`, so soft-deleted and duplicate rows both appear in LTV reporting.
- Unfiltered `deleted_at` joins at `lib/pos/sale-service.js:281`, `routes/pos.route.js:372`, `lib/pos/correction-service.js:180,459`.
- `server/db/seed.js:426-428` upserts on email (dev-only). Add a comment, change nothing.

---

## 5. Implementation

### 5.1 `server/lib/customer-identity.js`

**a. Reorder `findExistingCustomer` (lines 60-84).** Move the `phoneKey` block above the `cleanEmail` block. Keep `FOR UPDATE` on both. Keep `ORDER BY created_at LIMIT 1` on the phone branch — it is what makes behaviour deterministic on databases where the conditional index was skipped and duplicates exist.

**b. Guard both identifier writes inside the UPDATE (lines ~114-127).**

Use `NOT EXISTS` subqueries **inside the single UPDATE statement**, not separate SELECTs. Rationale: a SELECT-then-UPDATE opens a TOCTOU window that the `FOR UPDATE` on the matched row does not close — the *conflicting* row is a different row and is not locked. `NOT EXISTS` keeps the window to one statement. The unique index remains the final arbiter; the residual race is handled in (d).

Shape (adapt parameter numbering to the existing call):

```sql
email = CASE
  WHEN customers.email IS NOT NULL OR $4::citext IS NULL THEN customers.email
  WHEN EXISTS (SELECT 1 FROM customers c2
                WHERE c2.tenant_id = $1 AND c2.id <> $2
                  AND c2.email = $4::citext)            -- NO deleted_at filter
    THEN customers.email
  ELSE $4::citext END,
phone_number = CASE
  WHEN customers.phone_number IS NOT NULL OR $5 IS NULL THEN customers.phone_number
  WHEN EXISTS (SELECT 1 FROM customers c3
                WHERE c3.tenant_id = $1 AND c3.id <> $2
                  AND c3.deleted_at IS NULL              -- partial index scope
                  AND c3.phone_key = $8)
    THEN customers.phone_number
  ELSE $5 END,
phone = /* same CASE, guarding customers.phone */,
```

Pass the digits form as its own parameter (`$8`) computed by `normalizePhone` in JS — do **not** inline `regexp_replace` — so the comparison is byte-identical to what the matcher looked up. `c.id <> $2` ensures a row never blocks its own value.

**c. Guard the INSERT (lines ~130-142).** Append `ON CONFLICT (tenant_id, email) DO NOTHING RETURNING id`. When `rowCount === 0`, a soft-deleted or concurrently-created row holds the email: re-run the lookup **including soft-deleted rows for the email branch**, and return that row's id with `matchedOn: 'email'`, `created: false`.

**Do not auto-undelete.** Leave `deleted_at` alone. The order attaches and completes; staff decide whether to restore the customer.

**d. Concurrent-race retry.** Two checkouts for the same new person can both pass `NOT EXISTS` and both insert. Wrap the body of `resolveCustomer`:

- `SAVEPOINT resolve_customer` on entry. **This is required** — callers already hold an open transaction (`carts.route.js:475`, `pos.route.js:358`) and a 23505 poisons it.
- Catch `err.code === '23505'`; if `err.constraint` is `customers_tenant_id_email_key`, `customers_tenant_email_key`, or `customers_tenant_phone_key_idx`, `ROLLBACK TO SAVEPOINT resolve_customer` and re-run once from the lookup. The `_tenant_id_` spelling is PostgreSQL's actual generated name for migration 001's unnamed email constraint, verified during implementation; accept the originally documented spelling too.
- One retry only. A second failure rethrows.

This mirrors the existing, working pattern in `server/lib/order-number.js` (`insertWithRetry`) — read it first and follow its savepoint discipline.

**e. Align the normalisation floor.** Change `normalizePhone` (`customer-identity.js:51-54`) from `digits.length >= 6` to `digits.length >= 1`.

The generated column has no floor, so any divergence is by construction an unguardable collision. The database owns the constraint, so the database's definition wins.

Do **not** change the generated column instead: that means dropping and re-adding a STORED column plus both indexes on a live table, and `pos.route.js:299` searches on it.

State the consequence in the PR: a 3-digit phone now becomes a matchable identifier. That is *already* true at the database level; this only makes the matcher agree. If junk-phone matching is a concern, fix it at **input validation** — tighten `pos.route.js:349` to require ≥6 digits after stripping, and add the same check to the storefront checkout payload — never by desynchronising the matcher. Leave `pos.route.js:299` alone; that is search, not identity.

**f. Return shape.** Add `adopted: { email: boolean, phone: boolean }` so callers can record that a fill was skipped. Do **not** change `matchedOn` or `created` semantics — the till UI depends on them (`pos.route.js:358-372` returns `matchedOn` and `linkedExisting` to the operator).

**g. Keep the header comment truthful.** Rewrite it to describe what the code now does, including the guard asymmetry (email guard ignores `deleted_at`, phone guard respects it) and why.

### 5.2 `server/routes/lib.js`

Add a `conflict(res, code, message)` helper beside `notFound` (line 40) and `validationError` (line 44), returning 409 with `{ success: false, code, message }`. Export it.

### 5.3 `server/routes/admin-customers.route.js`

Same bug class, same 500, reachable from the admin portal. Shipping the matcher fix without these means the incident recurs from a different door.

- **`POST /` (lines ~233-237)** — `ON CONFLICT (tenant_id, email) DO UPDATE` writes `phone_number` unguarded → phone index violation. It also sets `deleted_at = NULL`, silently resurrecting a soft-deleted customer. Catch 23505 → `conflict(res, 'CUSTOMER_IDENTIFIER_TAKEN', …)` with `field` derived from `err.constraint`.
- **`PATCH /:id` (line ~308)** — sets email/phone_number directly with no guard. Same catch.
- **`PATCH /:id/restore` (line ~346)** — sets `deleted_at = NULL` with no uniqueness check. Restoring a row whose email or phone was adopted by a live row violates the constraint. **Check before updating**: select the row, compare its `email` and `phone_key` against live rows, and on collision return 409 naming the blocking customer's id and name so an admin can merge deliberately.

### 5.4 Admin client

The customer create/edit/restore forms must show the 409 `message` rather than a generic failure toast. Start from `client/projects/admin-portal/src/app/services/admin-customers.service.ts` and follow its callers.

---

## 6. Edge cases (all must be handled)

| Case | Required behaviour |
|---|---|
| Blank/null email | Phone branch only. Never write `''` as an email — the existing `\|\| null` coercion handles this; keep it. |
| Blank/null phone | Email branch only. |
| Both blank | Early return `{ customerId: null }` — unchanged (`customer-identity.js:105`). A genuine walk-in, never a blank row. |
| Phone < 6 digits | Now normalises and matches; guarded; no 500. |
| Same phone, different formatting | `phone_key` equality already handles it. Covered by existing test line 108. |
| **Soft-deleted row holds the email** | Matcher misses it → INSERT `ON CONFLICT DO NOTHING` → re-lookup including deleted → attach, **do not undelete**. |
| Soft-deleted row holds the phone | Irrelevant — the partial index excludes it, so the fill is legal. |
| Unique index absent (conditional skip) | Phone branch's `ORDER BY created_at LIMIT 1` picks the oldest deterministically; guards become harmless no-ops. |
| POS offline walk-in | Unchanged. Quick-create is refused offline; the sale records with no customer. |
| Concurrent checkouts, same new person | Savepoint + single 23505 retry converges on one row. |
| Matched row already has both identifiers, input differs | Neither field is overwritten (`COALESCE` semantics preserved). The order still attaches to the matched row. |

---

## 7. Existing duplicate rows

This fix stops new duplicates and stops the crash. **It does not merge what already exists, and must not try to.**

Merging means reassigning `orders.customer_id`, recomputing the additive counters written at `carts.route.js:604`, `lib/pos/sale-service.js:715` and decremented at `lib/pos/correction-service.js:180,459`, and choosing a survivor. Those counters are cumulative, so a wrong merge permanently mis-credits a row. Migration 023's own comment says this is a human decision. **Do not auto-merge, auto-delete, or backfill.**

Ship a read-only diagnostic instead — add to `server/lib/diagnostics-service.js` or document in the runbook:

```sql
-- live customers sharing a phone
SELECT tenant_id, phone_key, count(*), array_agg(id ORDER BY created_at)
  FROM customers WHERE phone_key IS NOT NULL AND deleted_at IS NULL
 GROUP BY 1,2 HAVING count(*) > 1;

-- is the conditional unique index actually present on this database?
SELECT to_regclass('customers_tenant_phone_key_idx');

-- likely split identities: same name, one row email-only, one row phone-only
SELECT a.id, b.id, a.email, b.phone_key
  FROM customers a JOIN customers b
    ON a.tenant_id = b.tenant_id
 WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL
   AND a.email IS NOT NULL AND a.phone_key IS NULL
   AND b.email IS NULL     AND b.phone_key IS NOT NULL
   AND lower(a.full_name) = lower(b.full_name);
```

Run these on production **before** deploying and record the counts — they are the baseline for judging whether the fix stopped new duplicates.

---

## 8. Test plan

Create **a new file**, `server/test/customer-identity-collision.test.js`, with its own pool. Do not append to `customer-link-and-race-e2e.test.js`: it calls `db.pool.end()` in its second test, and a third block would hit the closed pool.

**Write test A first and watch it fail with a 500.** A regression test that never failed proves nothing.

| Test | Proves |
|---|---|
| **A — the reported crash** | Insert customer A (email, no phone) and B (phone, no email) in one tenant. `resolveCustomer` with A's email + B's phone. Today: throws 23505 on `customers_tenant_phone_key_idx`. After: returns `matchedOn: 'phone'`, `customerId === B.id`, `created: false`, and A's row is unchanged. |
| **B — the mirror** | A has phone-no-email, B has email-no-phone. Resolve with A's phone + B's email → matches A by phone, the email fill is skipped, no throw, B untouched. Proves the email guard. |
| **C — soft-deleted email holder** | Soft-delete a customer holding `x@y.test`, then resolve with that email and a fresh phone. Proves the INSERT path no longer 500s **and** does not silently undelete. |
| **D — short phone** | Resolve with `"123"` twice using different emails. Proves the normalisation floor is aligned and the second call links instead of colliding. |
| **E — concurrency** | Two `resolveCustomer` calls on two connections, same new email+phone, one delayed. Mirror the `attemptSale(holdMs)` pattern at the bottom of `customer-link-and-race-e2e.test.js`. Assert exactly one row exists and both calls return the same id. |
| **F — admin 409** | `POST /api/admin/customers` with a free email but a phone already held by another live customer → 409 `CUSTOMER_IDENTIFIER_TAKEN`, not 500. Repeat for `PATCH /:id` and `PATCH /:id/restore`. |

**Existing assertions must still pass.** `customer-link-and-race-e2e.test.js` asserts `matchedOn === 'phone'` (lines 108, 126) and `matchedOn === 'email'` (line 157). Analysis says all three survive — line 157 passes email with **no** phone, so the phone branch is skipped. **Run them; do not reason about it.**

```bash
cd server
DATABASE_URL=… node --test test/customer-identity-collision.test.js test/customer-link-and-race-e2e.test.js
```

---

## 9. Rollout

1. **Snapshot the database** (`docs/18-backup-restore-runbook.md`) before anything. The fix is code-only, but §5.3 touches write paths.
2. Run the §7 diagnostics on production and record the counts.
3. Deploy code. **No migration is required by this plan.**
4. **`pm2 reload elite-api`** — this is the process containing `server/lib/customer-identity.js`. A prior incident in this project was caused by reloading only `elite-web` after changing API code, leaving the fix inert for hours. Because §5.4 changes the admin client too, rebuild it and reload **both**, API first:

```bash
cd /var/www/elite && git pull
cd client && npm run build:admin
pm2 reload elite-api elite-web
pm2 list   # confirm fresh uptime and restart count +1 on both
```

5. **Smoke test on production:**
   - one storefront checkout with a known-good email + phone;
   - one POS quick-create by phone for a customer who already exists online — expect `linkedExisting: true` and `matchedOn: 'phone'` in the till UI;
   - one admin customer edit setting a phone already in use — expect a clean 409 message, not a red error toast.
6. Watch `pm2 logs elite-api` for `23505` for 24 hours. **Any remaining 23505 means a write path outside the four addressed here** — capture the `constraint` field and the stack before changing anything.

---

## 10. If the conditional index is missing

If `SELECT to_regclass('customers_tenant_phone_key_idx')` returns NULL, migration 023 skipped index creation because duplicate live phones already existed. In that state the phone guard is a harmless no-op and no 500 occurs on the phone path — but duplicates keep accumulating.

Creating the index is a **separate, later change**, not part of this deploy: it requires merging the existing duplicates first (§7), which is a human decision. Record the finding and hand it back to the owner.

---

## 11. Implementation and local verification — 2026-09-18

- Reproduced test A against an isolated local PostgreSQL database before changing the resolver: the UPDATE threw `23505` on `customers_tenant_phone_key_idx`, exactly as reported.
- Implemented phone-first lookup, guarded fills, deleted-email INSERT fallback, and one retry inside savepoints. `adopted.email` / `adopted.phone` mean a previously missing identifier was stored during this call; existing or skipped identifiers return false. A phone fill is true if either previously-null phone column was filled.
- The email guard includes deleted rows; the phone guard only includes live rows. A deleted email holder can receive the order without being restored or otherwise edited by the resolver.
- Admin create/edit return 409 for identifier collisions. Create preserves existing live-email upsert behavior but returns 409 for a deleted email holder instead of silently restoring it. Explicit restore locks the target, checks live blockers, and names the blocking customer's ID and name. A concurrent uniqueness failure also returns 409.
- The shared admin HTTP interceptor displays the specific conflict message as a warning for create, edit, and restore. Form edits remain available for correction.
- Normalization now accepts any nonempty digits, matching the generated column. **A 3-digit phone is now matchable.** Input validation and POS search rules were deliberately left unchanged.
- 33 checks passed across `customer-identity-collision.test.js`, `customer-link-and-race-e2e.test.js`, `admin-orders-customers-e2e.test.js`, and `order-number.test.js`. Coverage includes real concurrent inserts and UPDATE conflicts, bounded retry, deleted identifiers, tenant isolation, short phones, missing-index legacy duplicates, and HTTP 409 responses.
- Admin production build and POS precache generation passed using the installed Node 24.15.0 runtime. The build reported warnings for the unchanged POS stylesheet size and `jsbarcode` CommonJS dependency. The local shell's default Node 24.10.0 inside `client/` is below Angular's minimum; use a supported runtime for deployment.

### Production baseline remains required

After taking the §9 snapshot, run the read-only diagnostic and save its output:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f server/scripts/diagnose-customer-identities.sql \
  > customer-identity-baseline.txt
```

The script records actual constraint names, phone-index presence/validity, duplicate live phone groups, deleted email holder count, and possible split identities. Its split-identity query omits the original UUID ordering filter: the email-only/phone-only predicates already distinguish the two sides, and UUID ordering would hide valid candidates. Shared names are only a review hint, never authorization to merge.

No production baseline, snapshot, deployment, smoke test, or monitoring has been performed by this local fix. No migration, merge, deletion, or backfill is included. The reporting view and unfiltered deleted-customer joins listed in §4 remain follow-up work. If the production phone index is missing, record it and resolve existing duplicates separately before creating it.
