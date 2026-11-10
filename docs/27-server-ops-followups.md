# 27. Server Ops Follow-ups (2026-08-02 session)

Tracking list for the loose ends from the 2026-08-02 remote session (receipt printing fix, shift/approval policy, QZ signing key relocation, backup setup). Check items off as they're done; delete this file once everything is ✅ and folded into the runbooks it references.

## Done this session

- [x] Fixed `quantization: 'dither'` → `'luma'` (QZ 2.2.6 does not implement dither) — receipts print again.
- [x] Fixed the QZ reconnect loop spinning every 32s on a healthy printer.
- [x] Moved the QZ signing key off `/run` (tmpfs, wiped on reboot) to `/var/lib/elite-pos/qz/`. Updated `server/.env` and restarted `elite-api`.
- [x] Created `/etc/elite-backup.env` with correct `BACKUP_UPLOADS_DIR=/var/www/elite-uploads`, `BACKUP_DIR=/var/backups/elite-postgres`, permissions `600`.
- [x] Ran `scripts/backup-database.sh` manually — succeeded, 2905 upload files included.
- [x] Installed the daily 03:00 cron job for the backup script.
- [x] POS self-close-shift and self-approval policy toggles shipped (Settings → Devices & Security → Approvals).

## Still open — do these next, in order

### 1. Save the two secrets to a password manager — **do this first** — ✅ done 2026-08-02
Nothing else here matters if these are lost.
- [x] `/var/lib/elite-pos/qz/private-key.pem` (QZ signing key — saved as "Elite POS · QZ Signing Private Key"). Losing it means re-issuing a certificate and re-trusting QZ on every physical register.
- [x] `BACKUP_GPG_PASSPHRASE` from `/etc/elite-backup.env` (saved as "Elite · Backup GPG Passphrase"). Losing it makes every existing and future backup file unrecoverable.

### 2. Confirm cleanup — ✅ done 2026-08-02
- [x] Confirmed: `ls -la /etc/elite` → "No such file or directory". Already gone, nothing further to do.

### 3. Prove the backup is real, not just running — ✅ done 2026-08-02
- [x] Ran `scripts/restore-database.sh` against a **scratch/throwaway** database (`elite_restore_drill`), not production. Restored `elite-20260802T054706Z.backup.tar.gpg` (the real 03:00 cron backup): uploads manifest matched restored count (2905 files), core table row counts matched production exactly, and `pos_transactions`/`orders` differed only by the transactions production took in after the backup ran — expected. Spot-checked receipt #1803 byte-for-byte identical (amount, timestamp) in both copies. Cleaned up (`DROP DATABASE`, tmp uploads removed) afterward. Full record in `docs/18-backup-restore-runbook.md` §5.

### 4. Wire up failure alerts — ✅ done 2026-08-02
- [x] Added `BACKUP_ALERT_EMAIL=hello@elitecollections.qa` and the real `SMTP_*` values to `/etc/elite-backup.env`. **Tested for real**, not just configured: ran `backup-database.sh` with a deliberately wrong `DATABASE_URL` (real SMTP config, real alert email, everything else untouched — no real backup or config file affected), `pg_dump` failed as expected, and the failure email was received in the `hello@elitecollections.qa` inbox within about a minute — subject "Elite Collection: database backup FAILED", correct timestamp and reason. Closes the Phase 9 test gate in docs/16 and the matching follow-up in docs/18 §6.

### 5. Offsite copy of backups — decided 2026-08-02: manual periodic download
`/var/backups/elite-postgres` and the live data are on the same disk, so a disk
failure takes both. Owner chose the manual route over `rclone`/cloud for now —
cheapest, no new credentials to secure, revisit once volume/risk justifies
automating it. This is a recurring human task, not a one-time fix: it only
protects the business if it actually happens on a schedule.
```bash
ls -lt /var/backups/elite-postgres/ | head -5   # find the newest
scp root@vmi3327182:/var/backups/elite-postgres/<latest-file> ~/Backups/
```
- [ ] Pick a cadence (weekly, matching the monthly restore-drill rhythm in
      docs/18 is a reasonable minimum) and put a recurring reminder on it —
      nothing in the system prompts this download, so without a standing
      reminder it will lapse silently.
- [ ] Do the first download now, to confirm the command works end-to-end
      before relying on it.

### 6. Finish the offline device signer install (till, not server)
Node.js confirmed installed on the till (v24). This has its own complete,
standalone, team-shareable runbook — **`docs/29-pos-till-device-signer-runbook.md`**
— written so whoever does it needs no other context. Use that file, not this
line item, when actually doing the install. Summary: copy the cert + key to
the till, install the signer as a startup service, point Elite's own
Hardware settings at it, then prove it with a real offline print (not just a
`/health` check).
- [ ] Done, per `docs/29`'s own report-back checklist.
- [ ] Verify `http://127.0.0.1:8182/health` responds.
- [ ] **Real test:** disconnect the till's Wi-Fi and print a receipt. `health` responding only proves the service is up, not that offline signing actually works.

### 7. Broken product image
- [ ] `ms3aaetl-b2346277.webp` (and its `-zoom`/`-pdp` variants) throws `ENOENT` under `/var/www/elite-uploads` — referenced in the DB but the file is missing from disk. Re-upload the image or unlink the dead reference.
