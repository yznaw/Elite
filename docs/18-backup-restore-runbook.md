# 18 — Backup, Restore Drill, and Disaster Recovery Runbook

Implements [16-launch-roadmap.md](16-launch-roadmap.md) Phase 9. This is the
written, rehearsed restore procedure that phase's test gate requires — read
it end to end once before the first real production restore drill, not just
when something has already gone wrong.

**Status as of 2026-08-01:** scripts written and tested end-to-end against a
local dev database (verified: backup → encrypt → decrypt → restore → row
counts match exactly across `tenants`, `admin_users`, `products`). The backup
format now also carries `uploads/` in the same encrypted bundle and verifies
the extracted file count before restore. A 2026-08-01 smoke test created a real
local `pg_dump`, encrypted/decrypted the bundle, verified its manifest and
restored the upload file to an empty target. The local database user cannot
create a disposable database, so the new bundle has not had a second real
`pg_restore`; that remains part of the production drill below. **Not yet
run against the production VPS** — this session has no SSH access to it.
Everything below (cron install, first production backup, first production
restore drill) still needs to be done once by whoever has server access.

---

## 1. What this covers, and what it deliberately doesn't (yet)

- **Covers:** the PostgreSQL database plus the persistent uploads directory
  (`/var/www/elite-uploads`: product photos/media) in one AES256-encrypted
  bundle. The bundle records dump size and uploads file count/bytes; restore
  refuses a bundle whose extracted file count disagrees with its manifest.
- **Does NOT cover (known gap):** offsite storage. Backups are written to
  local disk on the same VPS they back up (`BACKUP_DIR`, default
  `/var/backups/elite-postgres`). **A total VPS loss (disk failure, account
  termination, provider incident) takes the backups down with the data they
  were protecting.** This was a deliberate scope decision to ship something
  real now rather than nothing while an offsite destination gets set up —
  see §6 for what to add later.

---

## 2. Setup (one-time, on the production VPS)

### 2.1 Install GPG (if not already present)

```bash
apt-get update && apt-get install -y gnupg
```

### 2.2 Generate and store the backup encryption passphrase

Generate a strong passphrase and store it in **two places that are not the
VPS itself** (e.g. a password manager and a printed copy in a safe) — if the
only copy of the passphrase lives on the same disk as the encrypted backups,
losing that disk loses both the backup and the only key to open it.

```bash
openssl rand -base64 32
```

### 2.3 Create the backup directory

```bash
mkdir -p /var/backups/elite-postgres
chmod 700 /var/backups/elite-postgres
```

### 2.4 Create an environment file for the backup job (not committed to git)

```bash
cat > /etc/elite-backup.env <<'EOF'
DATABASE_URL=postgresql://elite:REPLACE_ME@localhost:5432/elite
BACKUP_DIR=/var/backups/elite-postgres
BACKUP_UPLOADS_DIR=/var/www/elite-uploads
BACKUP_GPG_PASSPHRASE=REPLACE_WITH_THE_PASSPHRASE_FROM_2.2
BACKUP_RETENTION_DAYS=14
SMTP_HOST=REPLACE_WITH_SAME_VALUE_AS_SERVER_ENV
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=REPLACE_ME
SMTP_PASS=REPLACE_ME
SMTP_FROM="Elite Collections <hello@elitecollections.qa>"
BACKUP_ALERT_EMAIL=REPLACE_WITH_OWNER_EMAIL
EOF
chmod 600 /etc/elite-backup.env
```

### 2.5 Install the cron job (daily at 03:00 Qatar time)

`03:00` is chosen as a quiet-hours window unlikely to overlap a live sale —
adjust if the shop ever runs 24-hour POS shifts.

```bash
crontab -e
```

Add:

```cron
0 3 * * * set -a && . /etc/elite-backup.env && set +a && /var/www/elite/scripts/backup-database.sh >> /var/log/elite-backup.log 2>&1
```

### 2.6 Confirm the first run manually before trusting the cron schedule

```bash
set -a && . /etc/elite-backup.env && set +a && /var/www/elite/scripts/backup-database.sh
ls -la /var/backups/elite-postgres/
```

You should see one `elite-<timestamp>.backup.tar.gpg` file, and the script's log
output should end with `Done.` and no `FAILED` lines.

---

## 3. Restore drill procedure (run this now, and monthly thereafter)

**Never restore into the live production database.** Always restore into a
freshly created, differently-named database — `restore-database.sh` refuses
to run if the target database is named exactly `elite` as a safety check,
but the discipline of always using a disposable target matters more than
that one guard.

### 3.1 Create a disposable target database

```bash
sudo -u postgres psql -c "CREATE DATABASE elite_restore_drill OWNER elite;"
```

### 3.2 Pick the backup file to restore (the most recent one, normally)

```bash
ls -la /var/backups/elite-postgres/
```

### 3.3 Run the restore

```bash
RESTORE_DATABASE_URL="postgresql://elite:REPLACE_ME@localhost:5432/elite_restore_drill" \
BACKUP_GPG_PASSPHRASE="REPLACE_WITH_THE_PASSPHRASE_FROM_2.2" \
RESTORE_UPLOADS_DIR="/var/tmp/elite-uploads-restore-drill" \
/var/www/elite/scripts/restore-database.sh /var/backups/elite-postgres/elite-<timestamp>.backup.tar.gpg
```

`RESTORE_UPLOADS_DIR` must be empty. The script verifies the restored file
count. Omitting it verifies the bundled uploads but restores only PostgreSQL;
that is useful for a database-only investigation, but it does not count as a
full disaster-recovery drill. Legacy `.dump.gpg` database-only backups remain
supported for the duration of their retention window.

### 3.4 Verify the restored data is complete and correct

Compare row counts between the live database and the restored one for a
handful of core tables — they should match exactly (or be very close, if
new data landed in production between the backup and the drill):

```bash
for db in elite elite_restore_drill; do
  echo "=== $db ==="
  psql "postgresql://elite:REPLACE_ME@localhost:5432/$db" -t \
    -c "SELECT count(*) FROM tenants;" \
    -c "SELECT count(*) FROM admin_users;" \
    -c "SELECT count(*) FROM products;" \
    -c "SELECT count(*) FROM pos_transactions;" \
    -c "SELECT count(*) FROM orders;"
done
```

Also spot-check one real record end-to-end (e.g. pull up the most recent
real order/transaction in both databases and confirm the details match).
Compare `find /var/www/elite-uploads -type f | wc -l` with the restored uploads
directory, then open at least one real product image from the restored copy.

### 3.5 Record the drill

Log the date, who ran it, the backup file used, the row-count comparison
result, and the elapsed time (see §4 for RPO/RTO) — either in this file's
drill log (§5) or wherever the team already tracks operational runbooks.

### 3.6 Clean up

```bash
sudo -u postgres psql -c "DROP DATABASE elite_restore_drill;"
rm -rf /var/tmp/elite-uploads-restore-drill
```

---

## 4. RPO / RTO

The original production-readiness audit ([14](14-pos-production-readiness-audit-2026-07-13.md))
and hardening plan ([15](15-pos-production-hardening-plan.md)) both left the
actual RPO/RTO target as **an open decision, never confirmed with the
owner** — flagging that explicitly rather than inventing a number and
presenting it as agreed.

**What the current design implies, as a starting point for that
conversation:**
- **RPO (Recovery Point Objective) ≈ 24 hours.** A single daily backup at
  03:00 means, in the worst case (a failure at 02:59, just before that
  night's backup runs), up to ~24 hours of transactions could be lost on
  restore. If that's not acceptable for a live money-handling system, the
  backup frequency needs to increase (e.g. every 4-6 hours) — this is a
  real tradeoff (more backups = more disk usage + more GPG/pg_dump load)
  that the owner should weigh in on, not something to silently decide here.
- **RTO (Recovery Time Objective), measured from this session's actual
  drill:** decrypt + restore took **under 5 seconds** for a small dev-sized
  database. This will scale up with real production data volume and,
  unlike this local test, will also involve the time to physically
  provision/access a working Postgres instance if the original VPS itself
  is gone — the drill above only measures the "have a working Postgres,
  restore into it" portion, not a full bare-metal recovery timeline.

**Action needed:** the owner should explicitly confirm or adjust these
numbers before Phase 10 (pilot). Until then, treat "we could lose up to a
day of transactions in the worst case" as the honest current state, not a
signed-off target.

---

## 5. Drill log

| Date | Run by | Backup file | Result | Notes |
|---|---|---|---|---|
| 2026-07-20 | Claude (this session) | local dev DB, not production | ✅ Row counts matched exactly (`tenants`, `admin_users`, `products`) | End-to-end test of the scripts themselves against a local dev database — proves the scripts work, does NOT count as the production restore drill Phase 9's test gate requires. That still needs to be run once by someone with VPS access, against a real production backup. |
| 2026-08-01 | Codex (local workspace) | temporary combined bundle, not production | ✅ Real pg_dump + GPG + tar manifest + upload restore passed | One upload file was bundled, verified and copied to an empty restore directory. `pg_restore` was safely stubbed because the local DB role cannot create a disposable database; the 2026-07-20 drill remains the proof of the database restore path. |

Add a new row every time this drill is actually run against production.

---

## 6. Follow-ups (not yet built, tracked here so they aren't lost)

- **Offsite backup copy.** Sync `/var/backups/elite-postgres` to an
  S3-compatible bucket (Backblaze B2 is inexpensive and S3-compatible) or a
  second server after each successful backup, so a total VPS loss doesn't
  also destroy the backups. Needs the owner to pick/provision a
  destination.
- **Backup-failure alert test.** The email-alert path
  (`scripts/backup-database.sh`'s `send_failure_alert`) has not yet been
  tested against a deliberately broken backup run on the production SMTP
  config — Phase 9's test gate explicitly calls for this ("temporarily
  break the backup job and confirm someone gets notified"). Easiest way:
  temporarily point `DATABASE_URL` at a wrong port/password for one manual
  run and confirm the failure email actually arrives.
- **RPO/RTO sign-off** — see §4.
