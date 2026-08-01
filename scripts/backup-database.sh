#!/usr/bin/env bash
#
# Automated encrypted PostgreSQL backup for Elite Collection (docs/16
# launch-roadmap.md Phase 9). Intended to run from cron on the production
# VPS, once per day. See docs/pos-hardware-runbook.md's sibling doc,
# docs/18-backup-restore-runbook.md, for the full setup/restore procedure —
# this script only performs one backup run; it does not install itself
# into cron.
#
# What it does:
#   1. pg_dump the database named in DATABASE_URL to a custom-format archive
#      (pg_dump -Fc — smaller, and restorable with pg_restore even to a
#      differently-named database or schema subset, unlike a plain SQL dump).
#   2. Bundle the dump with the persistent uploads directory and a verification
#      manifest. Physical moves between shops do not matter here; product media
#      does — the database references those files and a restore needs both.
#   3. Encrypt the bundle with GPG using a symmetric passphrase (BACKUP_GPG_PASSPHRASE)
#      — the dump contains customer PII (names, emails, phone numbers) and
#      full financial history, so it must never sit on disk unencrypted.
#   4. Write it to BACKUP_DIR with a UTC timestamp in the filename.
#   5. Delete backups older than BACKUP_RETENTION_DAYS.
#   6. On any failure, email BACKUP_ALERT_EMAIL via the app's existing
#      SMTP config (server/lib/mailer.js's same env vars) so a failed
#      backup is never silently discovered days later.
#
# Required environment (set these in the crontab entry or a sourced env
# file — do NOT hardcode secrets into this script):
#   DATABASE_URL             — same connection string the API server uses
#   BACKUP_DIR                — e.g. /var/backups/elite-postgres
#   BACKUP_UPLOADS_DIR         — persistent uploads path, e.g. /var/www/elite-uploads
#   BACKUP_GPG_PASSPHRASE      — symmetric encryption passphrase (keep this
#                                 secret somewhere OTHER than this VPS too —
#                                 an attacker/disk-loss scenario that has the
#                                 encrypted backup AND the passphrase stored
#                                 next to it defeats the point of encrypting)
#   BACKUP_RETENTION_DAYS      — e.g. 14
# Optional (for failure email alerting):
#   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
#   BACKUP_ALERT_EMAIL         — where to send failure notifications
#
# KNOWN GAP (see docs/18-backup-restore-runbook.md): the encrypted bundle still
# needs an offsite destination. A full VPS loss takes local backups with it.

set -euo pipefail

log() { echo "[backup-database] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }

fail() {
  local message="$1"
  log "FAILED: ${message}"
  send_failure_alert "${message}"
  exit 1
}

send_failure_alert() {
  local message="$1"
  if [ -z "${BACKUP_ALERT_EMAIL:-}" ] || [ -z "${SMTP_HOST:-}" ]; then
    log "No BACKUP_ALERT_EMAIL/SMTP_HOST configured — skipping failure email (see the failure above in this log/cron output)."
    return 0
  fi
  # Reuses the app's own mailer rather than a second email dependency — run
  # from the server/ directory so its node_modules (nodemailer) resolve.
  # The failure message is passed via env var (BACKUP_FAILURE_MESSAGE), not
  # interpolated into the JS source, so it can never be mistaken for code.
  (
    cd "$(dirname "${BASH_SOURCE[0]}")/../server"
    BACKUP_FAILURE_MESSAGE="${message}" node -e "
      require('dotenv').config();
      const { sendMail } = require('./lib/mailer');
      sendMail({
        to: process.env.BACKUP_ALERT_EMAIL,
        subject: 'Elite Collection: database backup FAILED',
        text: 'The automated database backup failed on ' + new Date().toISOString() + '.\n\nReason: ' + process.env.BACKUP_FAILURE_MESSAGE + '\n\nCheck the backup cron log on the server for full details. No new backup was created for this run.',
      }).catch((err) => {
        console.error('[backup-database] Failed to send failure alert email:', err.message);
        process.exitCode = 1;
      });
    " || log "Failure-alert email itself failed to send — check SMTP config."
  )
}

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"
: "${BACKUP_UPLOADS_DIR:=${UPLOADS_DIR:-}}"
: "${BACKUP_UPLOADS_DIR:?BACKUP_UPLOADS_DIR (or UPLOADS_DIR) is required}"
: "${BACKUP_GPG_PASSPHRASE:?BACKUP_GPG_PASSPHRASE is required}"
: "${BACKUP_RETENTION_DAYS:?BACKUP_RETENTION_DAYS is required}"

command -v pg_dump >/dev/null 2>&1 || fail "pg_dump is not installed or not on PATH."
command -v gpg >/dev/null 2>&1 || fail "gpg is not installed or not on PATH."
command -v tar >/dev/null 2>&1 || fail "tar is not installed or not on PATH."

[ -d "${BACKUP_UPLOADS_DIR}" ] || fail "BACKUP_UPLOADS_DIR does not exist or is not a directory (${BACKUP_UPLOADS_DIR})."

mkdir -p "${BACKUP_DIR}" || fail "Could not create BACKUP_DIR (${BACKUP_DIR})."

timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
staging_dir="$(mktemp -d "${BACKUP_DIR}/.elite-backup-${timestamp}.XXXXXX")"
dump_file="${staging_dir}/database.dump"
bundle_file="${BACKUP_DIR}/elite-${timestamp}.backup.tar"
encrypted_file="${bundle_file}.gpg"

cleanup() {
  [ -z "${staging_dir:-}" ] || [ ! -d "${staging_dir}" ] || rm -rf -- "${staging_dir}"
  [ -z "${bundle_file:-}" ] || [ ! -f "${bundle_file}" ] || rm -f -- "${bundle_file}"
}
trap cleanup EXIT

log "Starting backup -> ${encrypted_file}"

pg_dump -Fc --no-owner --no-privileges "${DATABASE_URL}" -f "${dump_file}" || fail "pg_dump exited with an error."

dump_size=$(stat -f%z "${dump_file}" 2>/dev/null || stat -c%s "${dump_file}" 2>/dev/null || echo 0)
if [ "${dump_size}" -lt 1024 ]; then
  fail "pg_dump produced a suspiciously small file (${dump_size} bytes) — refusing to treat this as a valid backup."
fi

uploads_file_count="$(find "${BACKUP_UPLOADS_DIR}" -type f | wc -l | tr -d ' ')"
uploads_size_bytes="$(du -sk "${BACKUP_UPLOADS_DIR}" | awk '{print $1 * 1024}')"
{
  echo "format_version=1"
  echo "created_at=${timestamp}"
  echo "database_dump_bytes=${dump_size}"
  echo "uploads_file_count=${uploads_file_count}"
  echo "uploads_size_bytes=${uploads_size_bytes}"
} > "${staging_dir}/backup-manifest.env"

# A staging symlink avoids copying the whole media directory before archiving;
# tar -h follows it and stores normal files under the stable `uploads/` name.
ln -s "${BACKUP_UPLOADS_DIR}" "${staging_dir}/uploads"
tar -chf "${bundle_file}" -C "${staging_dir}" database.dump backup-manifest.env uploads \
  || fail "Could not create the database + uploads backup bundle."

gpg --batch --yes --passphrase "${BACKUP_GPG_PASSPHRASE}" --symmetric --cipher-algo AES256 \
  -o "${encrypted_file}" "${bundle_file}" || fail "GPG encryption failed."

# The EXIT trap removes every unencrypted intermediate.
rm -rf -- "${staging_dir}"
rm -f -- "${bundle_file}"
staging_dir=""
bundle_file=""

log "Backup complete: ${encrypted_file} ($(stat -f%z "${encrypted_file}" 2>/dev/null || stat -c%s "${encrypted_file}" 2>/dev/null || echo '?') bytes; ${uploads_file_count} upload files / ${uploads_size_bytes} bytes)"

log "Pruning backups older than ${BACKUP_RETENTION_DAYS} days from ${BACKUP_DIR}"
find "${BACKUP_DIR}" -name 'elite-*.dump.gpg' -type f -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete
find "${BACKUP_DIR}" -name 'elite-*.backup.tar.gpg' -type f -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete

log "Done."
