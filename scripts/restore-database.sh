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
#   ./scripts/restore-database.sh /var/backups/elite-postgres/elite-20260101T030000Z.dump.gpg
#
# Required environment:
#   RESTORE_DATABASE_URL   — connection string for the TARGET database. This
#                             must point at an empty database that is NOT the
#                             live production database — pg_restore will drop
#                             conflicting objects if they exist.
#   BACKUP_GPG_PASSPHRASE   — same passphrase used to encrypt the backup.
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
trap 'rm -f "${decrypted_file}"' EXIT

log "Decrypting ${encrypted_file}"
if ! gpg --batch --yes --passphrase "${BACKUP_GPG_PASSPHRASE}" --decrypt -o "${decrypted_file}" "${encrypted_file}"; then
  fail "GPG decryption failed — wrong passphrase, or the file is corrupted."
fi

log "Restoring into ${RESTORE_DATABASE_URL}"
if ! pg_restore --clean --if-exists --no-owner --no-privileges -d "${RESTORE_DATABASE_URL}" "${decrypted_file}"; then
  fail "pg_restore reported errors — review the output above before trusting this restore."
fi

log "Restore complete. Run the verification queries in docs/18-backup-restore-runbook.md before considering this drill successful."
