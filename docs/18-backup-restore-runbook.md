# 18 — Backup, Restore Drill, and Disaster Recovery Runbook

Implements [16-launch-roadmap.md](16-launch-roadmap.md) Phase 9. This is the
written, rehearsed restore procedure that phase's test gate requires — read
it end to end once before the first real production restore drill, not just
when something has already gone wrong.

**Status as of 2026-08-02: the full loop has now run once for real, in
production, and passed.** Daily cron backup installed and running since
2026-08-01. First genuine production restore drill completed 2026-08-02
against a real 03:00 automated backup (419MB encrypted bundle, 2905 upload
files) — restored into disposable `elite_restore_drill`, verified against
live production by row count and by a real transaction spot check, then
cleaned up. See §5 for the full record and §4 for the resulting RTO
measurement. This closes the Phase 9 test gate in docs/16 and item 3 in
docs/27.

Earlier local/dev-only verification (kept below for history): scripts were
first proven end-to-end against a local dev database (backup → encrypt →
decrypt → restore → row counts matched across `tenants`, `admin_users`,
`products`), then against a temporary local bundle including `uploads/`.
Neither of those substituted for a real production drill — this file used to
say that gap was still open; it no longer is.

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

First get the two secrets, don't guess at them:
- **Database password** — `grep DATABASE_URL /var/www/elite/server/.env` and take the part between `elite:` and `@localhost`.
- **`BACKUP_GPG_PASSPHRASE`** — from the password manager entry "Elite · Backup GPG Passphrase" (saved there per docs/27 item 1; it is not something to regenerate).

```bash
RESTORE_DATABASE_URL="postgresql://elite:REPLACE_ME@localhost:5432/elite_restore_drill" \
BACKUP_GPG_PASSPHRASE="REPLACE_WITH_THE_PASSPHRASE" \
RESTORE_UPLOADS_DIR="/var/tmp/elite-uploads-restore-drill" \
/var/www/elite/scripts/restore-database.sh /var/backups/elite-postgres/elite-<timestamp>.backup.tar.gpg
```

**Paste this as one line, not the multi-line form above.** The 2026-08-02
drill hit `RESTORE_DATABASE_URL: RESTORE_DATABASE_URL is required` from this
exact command — some terminals drop or mangle a trailing `\` line
continuation on paste, which silently splits it into separate commands and
the env vars never reach the script. The multi-line form above is kept for
readability; run the single-line version:

```bash
RESTORE_DATABASE_URL="postgresql://elite:REPLACE_ME@localhost:5432/elite_restore_drill" BACKUP_GPG_PASSPHRASE="REPLACE_WITH_THE_PASSPHRASE" RESTORE_UPLOADS_DIR="/var/tmp/elite-uploads-restore-drill" /var/www/elite/scripts/restore-database.sh /var/backups/elite-postgres/elite-<timestamp>.backup.tar.gpg
```

`RESTORE_UPLOADS_DIR` must be empty. The script verifies the restored file
count. Omitting it verifies the bundled uploads but restores only PostgreSQL;
that is useful for a database-only investigation, but it does not count as a
full disaster-recovery drill. Legacy `.dump.gpg` database-only backups remain
supported for the duration of their retention window.

### 3.4 Verify the restored data is complete and correct

Compare row counts between the live database and the restored one for a
handful of core tables — they should match exactly (or be very close, if
new data landed in production between the backup and the drill). Single line,
same reason as §3.3:

```bash
for db in elite elite_restore_drill; do echo "=== $db ==="; psql "postgresql://elite:REPLACE_ME@localhost:5432/$db" -t -c "SELECT count(*) FROM tenants;" -c "SELECT count(*) FROM admin_users;" -c "SELECT count(*) FROM products;" -c "SELECT count(*) FROM pos_transactions;" -c "SELECT count(*) FROM orders;"; done
```

A gap between `pos_transactions`/`orders` counts is expected and not a
failure, as long as it's explained by transactions production took in after
the backup ran — the spot check below is what actually proves that, rather
than assuming it.

Then spot-check one real transaction end-to-end. `pos_transactions` does not
carry the receipt number directly — it lives on `pos_receipts`, joined by
`receipt_id` — so pull both together:

```bash
psql "postgresql://elite:REPLACE_ME@localhost:5432/elite_restore_drill" -c "SELECT r.receipt_number, t.total_cents, t.created_at FROM pos_transactions t JOIN pos_receipts r ON r.id = t.receipt_id ORDER BY t.created_at DESC LIMIT 3;"
```

Run the same query against `elite` (production) in place of
`elite_restore_drill`. The oldest row common to both results should match
exactly — same receipt number, same `total_cents`, same `created_at` to the
microsecond. Anything newer only in production is the expected gap explained
above, not a discrepancy.

Uploads: the restore script already verifies the extracted file count against
the backup's own manifest and prints it (`Uploads restored into
<dir>: N files`) — that is the file-count check, not merely a log line. What
it does *not* prove is that the files are actually valid images, so open at
least one real product photo from `RESTORE_UPLOADS_DIR` to confirm that.

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
- **RTO (Recovery Time Objective), measured against the real production
  database (2026-08-02 drill, see §5):** decrypt + database restore +
  uploads restore (2905 files, 419MB encrypted bundle) took **under 3
  minutes** end to end. This is the "have a working Postgres, restore into
  it" portion only — it does not include the time to provision a new VPS
  or working Postgres instance if the original server itself is gone,
  which is the dominant term in a real bare-metal-loss scenario, not this
  step.

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
| 2026-08-02 | Owner, on the production VPS, walked through the procedure live | `elite-20260802T054706Z.backup.tar.gpg` (the daily 03:00 cron backup, taken 2026-08-02T05:47Z) | ✅ **First real production restore drill — passed.** Restored into disposable `elite_restore_drill`, not production. Uploads: manifest and restored-copy count both 2905, matching. Row counts on `tenants`/`admin_users`/`products` matched exactly; `pos_transactions` (29 vs 31) and `orders` (50 vs 52) differed by exactly the transactions that landed in production between the 05:47 backup and the drill — expected, not data loss. Spot check: receipt #1803 present in both the restored copy and live production with identical amount (80000 cents) and timestamp (2026-08-02 00:15:14.635088+02). | Cleaned up after (`DROP DATABASE`, uploads tmpdir removed). Closes docs/27 item 3 and the Phase 9 test gate in docs/16. Elapsed time from decrypt start to restore complete: under 3 minutes — see §4 for how this compares to the stated RTO target. |

Add a new row every time this drill is actually run against production.

---

## 6. Follow-ups (not yet built, tracked here so they aren't lost)

- **Offsite backup copy.** Decided 2026-08-02: manual periodic download
  rather than automated sync, see docs/27 item 5 for the command and the
  open item to pick a cadence. Revisit `rclone` to an S3-compatible bucket
  (Backblaze B2) once volume or risk tolerance justifies automating it.
- ~~**Backup-failure alert test.**~~ ✅ Done 2026-08-02. `/etc/elite-backup.env`
  now carries real `SMTP_*` and `BACKUP_ALERT_EMAIL=hello@elitecollections.qa`.
  Tested by pointing `DATABASE_URL` at a wrong password for one manual run
  (real alert config, no real backup or config file touched) — `pg_dump`
  failed as designed, and the failure email arrived in the real inbox within
  about a minute, correct subject/timestamp/reason. Closes this gap and the
  matching item in docs/27.
- **RPO/RTO sign-off** — see §4.
