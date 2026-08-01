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

At startup the API applies migrations `015`–`025` in order under a PostgreSQL advisory lock. The API refuses to start if database preparation fails; PM2 logs must not contain `Database preparation failed`.

Verify the new schema using the production `DATABASE_URL`:

```bash
cd /var/www/elite/server
psql "$DATABASE_URL" -c "select to_regclass('public.app_errors'), to_regclass('public.inventory_movements'), to_regclass('public.stocktakes');"
psql "$DATABASE_URL" -c "select column_name from information_schema.columns where table_name='pos_transaction_items' and column_name='product_name_ar';"
psql "$DATABASE_URL" -c "select column_name from information_schema.columns where table_name='customers' and column_name='phone_key';"
```

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
