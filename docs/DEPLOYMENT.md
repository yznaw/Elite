# Elite Production Deployment Guide

> Production host: `vmi3327182` · repository: `/var/www/elite` · API: PM2 process `elite-api` on port `3000` · public traffic: Nginx over HTTPS.

This release deploys the API, both Angular applications, migrations `022`–`025`, POS diagnostics, inventory operations, and the production POS offline package. Deploy them as one coordinated release; do not upload only selected files.

## 1. Before pushing from the development machine

```bash
git status --short
git diff --check
cd server && npm ci && npm test
cd ../client && npm ci && npm run build:all && npm run test:e2e
```

Expected gate for the 1 August 2026 release: server tests `33/33`, POS browser tests `8/8`, and both production Angular builds successful. Generated directories (`client/dist`, `client/out-tsc`, `client/test-results`, `client/playwright-report`) must not be committed.

Verify that no `.env`, certificate, private key, database dump, upload directory, or local signer log is staged. Push the complete commit and wait for GitHub CI to pass before touching production.

## 2. Pre-deploy checks on the VPS

```bash
ssh root@vmi3327182
cd /var/www/elite
git status --short
git rev-parse HEAD
node --version
pm2 status
```

- The worktree must be clean. Stop if it contains uncommitted server edits.
- Node must satisfy the server requirement (`22.x`).
- Record the current commit hash for rollback.
- Take and verify an encrypted database + uploads backup using [the backup/restore runbook](./18-backup-restore-runbook.md). Do not deploy migrations without a usable backup.

## 3. Pull, install, and build

```bash
cd /var/www/elite
git pull --ff-only origin main
cd server
npm ci --omit=dev
cd ../client
npm ci
npm run build:all
```

`build:admin` also generates and audits the POS-only precache manifest. A failure there is a release failure; do not serve a manually copied old `dist` directory.

Do not run `npm audit fix` during a deploy. Dependency remediation is a reviewed code change with its own tests. Do not run `npm run db:migrate` for this release: that legacy script applies only `001_initial_schema.sql`, not incremental POS migrations.

## 4. Restart API and apply database migrations

```bash
cd /var/www/elite
pm2 reload elite-api --update-env
pm2 logs elite-api --lines 100
```

At startup the API applies migrations `015`–`027` in order under a PostgreSQL advisory lock. The API refuses to start if database preparation fails; PM2 logs must not contain `Database preparation failed`. (`027_pos_branches.sql` — multi-branch receipt profiles, see `docs/12-pos-system.md` §13.2 — is additive and idempotent like the others; its backfill runs once per tenant automatically, no manual step required.)

Verify the new schema. `DATABASE_URL` lives in `server/.env` and is **not** exported into the deploy shell, so a bare `psql "$DATABASE_URL"` connects as the OS user and fails with `role "root" does not exist`. Do not reach for `. ./.env` either: the file holds unquoted values containing spaces (the receipt printer name, for one), which `source` tries to execute as commands. `dotenv` parses them correctly, so go through node and reuse the API's own pool:

```bash
cd /var/www/elite/server && node -e 'require("dotenv").config();const db=require("./db/client");db.pool.query("select to_regclass($1) tbl",["public.app_errors"]).then(r=>console.log(r.rows)).finally(()=>process.exit(0))'
```

To confirm one column exists (swap the table and column names as needed):

```bash
cd /var/www/elite/server && node -e 'require("dotenv").config();const db=require("./db/client");db.pool.query("select column_name from information_schema.columns where table_name=$1 and column_name=$2",["tenants","pos_self_close_shift_enabled"]).then(r=>{console.log(r.rowCount?"OK - column exists":"MISSING - migration has not run");process.exit(0)}).catch(e=>{console.error("ERROR:",e.message);process.exit(1)})'
```

Columns worth spot-checking after a release: `pos_transaction_items.product_name_ar`, `customers.phone_key`, `tenants.pos_self_close_shift_enabled`.

Every value must be present. These migrations are additive and idempotent, but verification is mandatory.

## 5. Health and smoke verification

```bash
pm2 status
curl --fail --silent http://127.0.0.1:3000/api/health
nginx -t
```

Then verify through the public HTTPS URLs:

- Storefront loads and an existing product opens.
- Admin sign-in works.
- Owner/Admin can open `/diagnostics` and `/stocktake`.
- `/pos` restores the enrolled register without re-enrollment.
- Existing hardware settings remain, QZ reconnects, and a test receipt prints.
- Open/current shift behavior is correct for the signed-in cashier.
- Complete one low-value sale, find it by receipt number, and confirm shared stock decreased once.
- If testing offline, confirm the queue returns to zero and only one server transaction exists after reconnection.

Keep the old POS available until both production registers pass this smoke check.

## 6. Logs and diagnostics

Production API logs are structured JSON:

```bash
pm2 logs elite-api --lines 100
pm2 logs elite-api --err --lines 100
grep 'a3f9c1' ~/.pm2/logs/elite-api-out.log | jq .
```

The cashier-visible reference is the last six characters of the request ID. The same ID links `app_errors`, audit events, and the Owner/Admin Diagnostics page.

Install PM2 rotation once:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 save
```

Relevant environment variables:

```dotenv
LOG_LEVEL=info
ALERT_EMAIL=owner@example.com
```

Leaving `ALERT_EMAIL` unset disables operational email alerts. Register-side signer logs rotate under `C:\ProgramData\ElitePOS\device-signer\logs\signer.log`.

## 7. Rollback

If the smoke test fails, preserve logs and the failing request ID first. Then return the server checkout to the previously recorded commit and rebuild from that code:

```bash
cd /var/www/elite
git switch --detach <previous-commit-hash>
cd server && npm ci --omit=dev
cd ../client && npm ci && npm run build:all
cd .. && pm2 reload elite-api --update-env
```

Migrations `022`–`025` are additive, so the prior application can normally run with the added tables/columns. Do not reverse database migrations or restore the production backup merely to remove unused additive schema. Restore data only for confirmed data corruption and follow the restore runbook.

After recovery, return the checkout to `main` before the next deploy:

```bash
cd /var/www/elite
git switch main
```

## 7b. Storefront mobile-performance release (September 2026)

This release has **no migration and no schema change**. It is an Angular rebuild
plus one one-time data backfill. Sections 1 to 3 apply unchanged; the API restart
in section 4 is not strictly required (nothing the running API loads changed),
but reloading is harmless and keeps the standard flow.

### What is in it

| Change | Where the effect shows |
|---|---|
| Every `client-web` component moved to `OnPush` | Taps and scrolling respond faster across the shop |
| `provideAnimations()` removed (nothing used it) | Initial bundle 136 KB to 119 KB gzipped |
| Double-tap-zoom guard, grain overlay off on touch, sticky bar blur dropped, gallery layers reduced | Zooming on tap stops; scroll frames get cheaper |
| Collection page translated (filter panel, page copy, aria labels, Arabic plural counts) | The Arabic storefront stops rendering a half-English sidebar |
| `backfill-image-variants.js` fixed | See below. This is the large one. |

### The image backfill is the step that matters

The storefront hands the browser a `srcset` and lets it choose a size. Where an
asset's `imageVariants` is missing or empty that fails silently to the full-size
original, so phones were downloading originals: 7 MB and 17 MB PNGs were being
served into the product gallery. The client-side changes in this release are
worth a few hundred kilobytes; this one is worth megabytes per page view. **The
rebuild alone does not fix it.** Run the script.

Two bugs kept the existing script from reaching those rows, both fixed here: it
skipped assets whose `imageVariants` was an empty object (the state a failed
derive leaves behind), and it required `metadata.storagePath`, which the rows
the live galleries link to do not have.

**Before running:** take the database + uploads backup from section 2. The
script rewrites `preview_url`, `width`, `height` and `metadata` on
`media_assets`. It does not touch or delete any original file.

**Check `sharp` is installed.** It is a normal dependency, so `npm ci --omit=dev`
in section 3 installs it, but the script degrades to skipping everything if it
is missing rather than failing loudly:

```bash
cd /var/www/elite/server && node -e 'require("sharp");console.log("sharp OK")'
```

**Check free disk.** On the development catalogue, 752 images produced about
3,600 derived files and grew `uploads/` from 510 MB to 630 MB, roughly a quarter
more. Confirm the headroom before starting:

```bash
df -h /var/www/elite && du -sh /var/www/elite/server/uploads
```

**Count what will be repaired** (run before and after; the second number should
be far lower, and what remains should be remote URLs with no local file):

```bash
cd /var/www/elite/server && node <<'EOF'
require("dotenv").config();
const db = require("./db/client");
db.pool.query(`
  select count(*) c
  from media_links ml
  join media_assets m on m.id = ml.media_id
  where ml.role in ('gallery','primary')
    and coalesce(m.metadata->'imageVariants', '{}'::jsonb) = '{}'::jsonb
`).then(r => console.log("gallery images with no variants:", r.rows[0].c))
  .finally(() => process.exit(0));
EOF
```

**Run it.** It took a few minutes for 752 images locally, and it is CPU-bound on
`sharp`. Nothing goes down while it runs: it only adds files and updates rows,
so the site keeps serving originals until each row is rewritten. It is
idempotent (processed rows are no longer selected), so it is safe to re-run if
it is interrupted:

```bash
cd /var/www/elite/server && node scripts/backfill-image-variants.js
```

It prints `Updated N, skipped M` at the end. Skipped rows are images with no
local file to derive from, which on this catalogue means the remote Unsplash
seed URLs.

### Verifying the release

The products API sends `Cache-Control: public, max-age=60`, so allow a minute,
then confirm the storefront is actually being handed variants rather than
originals. On a product page, every gallery image should carry a `srcset` and
none should resolve to the original upload:

```bash
curl --silent "https://<storefront-host>/api/products?limit=1" | node -e '
let b="";
process.stdin.on("data", d => b += d).on("end", () => {
  const p = JSON.parse(b).data[0];
  const v = p.imageVariants || {};
  const empty = Object.values(v).filter(x => !x || !Object.keys(x).length).length;
  console.log("images:", (p.images||[]).length, "| variant maps:", Object.keys(v).length, "| still empty:", empty);
});'
```

`still empty: 0` is the result you want. Then, in a real browser on a phone:

- [ ] A product page opens and the gallery swipes between photos.
- [ ] DevTools/network shows `-card`, `-grid` or `-pdp` `.webp` files, not the original `.png`/`.jpg`.
- [ ] Double-tapping a size pill or "add to cart" no longer zooms the page.
- [ ] Pinch-to-zoom still works. (This is the accessibility guarantee that replaced the old viewport scale cap; if pinch is dead, something reintroduced `maximum-scale`.)
- [ ] Switch to Arabic on the collection page: the filter sidebar headings, "تم", "الترتيب", "مسح" and the piece counts all render in Arabic.
- [ ] Add to cart, open the drawer, reach checkout step 2, then press browser back. The footer must reappear. (This is the check that catches a broken `OnPush` root.)

### Rolling back

Section 7 applies for the code. The backfill does not need rolling back and
should not be: it only added derived files and populated empty metadata, and the
older code ignores both. Rolling the code back leaves the new variants sitting
unused.

## 8. Release sign-off

- [ ] Local diff clean of whitespace errors and secrets.
- [ ] Server `33/33`, POS browser `8/8`, storefront/admin production builds pass.
- [ ] GitHub CI green on the exact deployed commit.
- [ ] Encrypted database + uploads backup verified.
- [ ] VPS worktree clean; previous commit recorded.
- [ ] `git pull --ff-only`, deterministic installs, and both web builds complete.
- [ ] API starts without database-preparation errors; migrations `022`–`025` verified.
- [ ] Health, public HTTPS, POS, Diagnostics, Stocktake, receipt, and shared-stock smoke checks pass.
- [ ] Both shop registers retain enrollment/hardware and their queues are zero.
- [ ] PM2/API, browser Diagnostics, and Windows signer logs are available.
