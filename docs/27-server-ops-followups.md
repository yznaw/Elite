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

### 1. Save the two secrets to a password manager — **do this first**
Nothing else here matters if these are lost.
- [ ] `/var/lib/elite-pos/qz/private-key.pem` (QZ signing key — save as "Elite POS · QZ Signing Private Key"). Losing it means re-issuing a certificate and re-trusting QZ on every physical register.
- [ ] `BACKUP_GPG_PASSPHRASE` from `/etc/elite-backup.env` (save as "Elite · Backup GPG Passphrase"). Losing it makes every existing and future backup file unrecoverable.

### 2. Confirm cleanup
- [ ] `rm -f /etc/elite` (superseded by `/etc/elite-backup.env` — confirm it's actually gone, not just planned).

### 3. Prove the backup is real, not just running
- [ ] Run `scripts/restore-database.sh` against a **scratch/throwaway** database, not production. A backup that has never been restored is a guess, not a backup. Procedure: `docs/18-backup-restore-runbook.md`.

### 4. Wire up failure alerts
- [ ] Add `BACKUP_ALERT_EMAIL` and the `SMTP_*` values (same as `server/.env`) to `/etc/elite-backup.env`. Right now a silent cron failure at 3am stays silent until someone needs a restore and there isn't one.

### 5. Offsite copy of backups
Deferred by choice — `/var/backups/elite-postgres` and the live data are on the same disk, so a disk failure takes both. Revisit this. Cheapest interim fix: periodically `scp` the newest file down to a laptop:
```bash
ls -lt /var/backups/elite-postgres/ | head -5   # find the newest
scp root@<server-ip>:/var/backups/elite-postgres/<latest-file> ~/Backups/
```
- [ ] Decide: manual periodic download, or set up `rclone` to a cloud bucket (Backblaze B2 / S3 / Drive) later.

### 6. Finish the offline device signer install (till, not server)
Node.js confirmed installed on the till (v24). Remaining steps, all on the till:
- [ ] Copy `private-key.pem` from `/var/lib/elite-pos/qz/private-key.pem` (server) to `C:\ProgramData\ElitePOS\qz\private-key.pem` (till) — via USB or `scp`, never through chat.
- [ ] Lock down its permissions: `icacls 'C:\ProgramData\ElitePOS\qz\private-key.pem' /inheritance:r /grant:r "$env:USERNAME:(R)" /grant:r 'Administrators:(F)'`
- [ ] Copy `tools/pos-device-signer/` to the till.
- [ ] Run `install-windows-startup.ps1` as Administrator with the cert/key paths and `-AllowedOrigins 'https://admin.elitecollections.qa'`.
- [ ] Verify `http://127.0.0.1:8182/health` responds.
- [ ] **Real test:** disconnect the till's Wi-Fi and print a receipt. `health` responding only proves the service is up, not that offline signing actually works.

### 7. Broken product image
- [ ] `ms3aaetl-b2346277.webp` (and its `-zoom`/`-pdp` variants) throws `ENOENT` under `/var/www/elite-uploads` — referenced in the DB but the file is missing from disk. Re-upload the image or unlink the dead reference.
