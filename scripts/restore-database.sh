#!/usr/bin/env bash
#
# Restores an encrypted backup produced by scripts/backup-database.sh
# (docs/16 launch-roadmap.md Phase 9). Always restores into a NEW/EMPTY
# target database — never runs against the live production database
# directly, so a restore drill can never accidentally clobber production
# data. See docs/18-backup-restore-runbook.md for the full drill procedure.
#
# Usage:
#   RESTORE_DATABASE_URL=postgresql://elite:pass@localhost:5432/elite_restore_test \
#   BACKUP_GPG_PASSPHRASE=... \
#   RESTORE_UPLOADS_DIR=/var/tmp/elite-uploads-restore \
#   ./scripts/restore-database.sh /var/backups/elite-postgres/elite-20260101T030000Z.backup.tar.gpg
#
# Required environment:
#   RESTORE_DATABASE_URL   — connection string for the TARGET database. This
#                             must point at an empty database that is NOT the
#                             live production database — pg_restore will drop
#                             conflicting objects if they exist.
#   BACKUP_GPG_PASSPHRASE   — same passphrase used to encrypt the backup.
# Optional environment:
#   RESTORE_UPLOADS_DIR       — empty target directory for uploads. If omitted,
#                               the database is restored and bundled uploads are
#                               verified but not copied out.
# Argument:
#   $1 — path to the .dump.gpg file to restore.

set -euo pipefail

log() { echo "[restore-database] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }
fail() { log "FAILED: $*"; exit 1; }

encrypted_file="${1:-}"
[ -n "${encrypted_file}" ] || fail "Usage: $0 <path-to-backup.dump.gpg>"
[ -f "${encrypted_file}" ] || fail "File not found: ${encrypted_file}"

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${BACKUP_GPG_PASSPHRASE:?BACKUP_GPG_PASSPHRASE is required}"

command -v pg_restore >/dev/null 2>&1 || fail "pg_restore is not installed or not on PATH."
command -v gpg >/dev/null 2>&1 || fail "gpg is not installed or not on PATH."
command -v psql >/dev/null 2>&1 || fail "psql is not installed or not on PATH."
command -v tar >/dev/null 2>&1 || fail "tar is not installed or not on PATH."

# Hard safety check: refuse to run against exactly the production database
# name, unless explicitly overridden. This is a deliberate speed bump, not a
# foolproof guard — the real safety measure is always using a dedicated,
# disposable restore-test database. Matches only an exact "/elite" database
# name (optionally followed by a query string), not names that merely start
# with "elite" (e.g. "elite_restore_test" must NOT trip this check).
if [[ "${RESTORE_DATABASE_URL}" =~ /elite(\?.*)?$ ]] && [ "${RESTORE_ALLOW_PRODUCTION_NAME:-false}" != "true" ]; then
  fail "RESTORE_DATABASE_URL looks like it points at the production database name ('elite'). Restore into a differently-named database (e.g. elite_restore_test) instead. If this is genuinely intentional, re-run with RESTORE_ALLOW_PRODUCTION_NAME=true."
fi

decrypted_file="$(mktemp)"
extracted_dir="$(mktemp -d)"
cleanup() {
  rm -f -- "${decrypted_file}"
  rm -rf -- "${extracted_dir}"
}
trap cleanup EXIT

log "Decrypting ${encrypted_file}"
if ! gpg --batch --yes --passphrase "${BACKUP_GPG_PASSPHRASE}" --decrypt -o "${decrypted_file}" "${encrypted_file}"; then
  fail "GPG decryption failed — wrong passphrase, or the file is corrupted."
fi

database_dump="${decrypted_file}"
uploads_source=""
manifest_file=""

# New backups are tar bundles; old .dump.gpg files remain restorable so the
# retention window does not become useless on the day this format ships.
if tar -tf "${decrypted_file}" >/dev/null 2>&1; then
  log "Detected database + uploads backup bundle"
  archive_entries="$(tar -tf "${decrypted_file}")"
  if echo "${archive_entries}" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    fail "Backup bundle contains an unsafe absolute or parent-relative path."
  fi
  tar -xf "${decrypted_file}" -C "${extracted_dir}" || fail "Could not extract the backup bundle."
  database_dump="${extracted_dir}/database.dump"
  uploads_source="${extracted_dir}/uploads"
  manifest_file="${extracted_dir}/backup-manifest.env"
  [ -f "${database_dump}" ] || fail "Backup bundle does not contain database.dump."
  [ -d "${uploads_source}" ] || fail "Backup bundle does not contain uploads/."
  [ -f "${manifest_file}" ] || fail "Backup bundle does not contain backup-manifest.env."

  expected_upload_count="$(awk -F= '$1 == "uploads_file_count" { print $2 }' "${manifest_file}")"
  actual_upload_count="$(find "${uploads_source}" -type f | wc -l | tr -d ' ')"
  [ -n "${expected_upload_count}" ] || fail "Backup manifest has no uploads_file_count."
  [ "${actual_upload_count}" = "${expected_upload_count}" ] \
    || fail "Uploads verification failed: expected ${expected_upload_count} files, extracted ${actual_upload_count}."
  log "Uploads verified: ${actual_upload_count} files"
else
  log "Detected legacy database-only backup; no uploads are available in this file."
fi

log "Restoring database into ${RESTORE_DATABASE_URL}"
if ! pg_restore --clean --if-exists --no-owner --no-privileges -d "${RESTORE_DATABASE_URL}" "${database_dump}"; then
  fail "pg_restore reported errors — review the output above before trusting this restore."
fi

if [ -n "${uploads_source}" ] && [ -n "${RESTORE_UPLOADS_DIR:-}" ]; then
  mkdir -p "${RESTORE_UPLOADS_DIR}" || fail "Could not create RESTORE_UPLOADS_DIR (${RESTORE_UPLOADS_DIR})."
  if find "${RESTORE_UPLOADS_DIR}" -mindepth 1 -print -quit | grep -q . \
    && [ "${RESTORE_UPLOADS_ALLOW_NONEMPTY:-false}" != "true" ]; then
    fail "RESTORE_UPLOADS_DIR is not empty. Use a disposable empty directory, or explicitly set RESTORE_UPLOADS_ALLOW_NONEMPTY=true."
  fi
  cp -R "${uploads_source}/." "${RESTORE_UPLOADS_DIR}/" || fail "Could not restore uploads into RESTORE_UPLOADS_DIR."
  restored_upload_count="$(find "${RESTORE_UPLOADS_DIR}" -type f | wc -l | tr -d ' ')"
  [ "${restored_upload_count}" = "${actual_upload_count}" ] \
    || fail "Restored uploads count mismatch: expected ${actual_upload_count}, found ${restored_upload_count}."
  log "Uploads restored into ${RESTORE_UPLOADS_DIR}: ${restored_upload_count} files"
elif [ -n "${uploads_source}" ]; then
  log "RESTORE_UPLOADS_DIR not set — bundled uploads were verified but not copied."
fi

log "Restore complete. Run the verification queries in docs/18-backup-restore-runbook.md before considering this drill successful."
