# Elite POS Device Signer

This loopback-only service lets QZ Tray verify print and drawer commands while
the Elite API is offline. It never returns the private key to the browser.

Required environment variables:

- `ELITE_POS_QZ_CERT_PATH`: QZ `digital-certificate.txt` path.
- `ELITE_POS_QZ_KEY_PATH`: QZ PKCS#8 private key path. Restrict this file to the
  dedicated signer OS account using operating-system ACLs or a managed secret.
- `ELITE_POS_ALLOWED_ORIGINS`: comma-separated Elite admin origins. Defaults to
  `http://localhost:4300,https://admin.elitecollections.qa`.

There is no printer/call-type allowlist here (or in the main API's signing
endpoint): QZ Tray's client only ever sends a SHA-256 hash of the call to be
signed, never the original printer name or call type, so this service cannot
verify what it is signing — it can only bound the request size and prove
possession of the private key. Printer scoping is enforced earlier, by the
authenticated/enrolled-register checks on the API's own `/pos/transactions`
and print endpoints.

Optional: `ELITE_POS_SIGNER_PORT` defaults to `8182`.

Run the signer as a restricted startup service on the POS device. Provision and
revoke its certificate per register. Validate the exact Posiflex, Bixolon,
Windows startup, Chrome local-network permission, drawer pin, and QZ trust chain
before production rollout.

## Windows automatic startup

Open an elevated PowerShell in this directory and run:

```powershell
.\install-windows-startup.ps1 `
  -CertificatePath 'C:\ProgramData\ElitePOS\qz\digital-certificate.txt' `
  -PrivateKeyPath 'C:\ProgramData\ElitePOS\qz\private-key.pem' `
  -AllowedOrigins 'https://admin.elitecollections.qa'
```

The installer copies the signer to `C:\ProgramData\ElitePOS\device-signer`,
registers a limited, current-user logon task, configures one-minute restart on
failure, starts it immediately, and verifies `http://127.0.0.1:8182/health`.
Run it once on each physical register. Keep the private key readable only by
that register's POS Windows account and administrators.

### Diagnostics and retained logs

The scheduled task writes newline-delimited JSON to:

```text
C:\ProgramData\ElitePOS\device-signer\logs\signer.log
```

At 5 MiB it rotates on the next task restart and retains `signer.log.1` through
`signer.log.5`. Events include signer start/stop, certificate delivery,
successful signature issuance, denied origins, invalid/oversized requests and
server errors. Signature input, private keys and certificate contents are never
logged.

QZ/printer connection changes are also persisted by the POS browser and appear
in Elite's Diagnostics page with codes such as `QZ_DISCONNECTED`,
`QZ_RECONNECT_FAILED`, `QZ_RECONNECT_SCHEDULED`, `HARDWARE_RESTORED`,
`PRINTER_DISCOVERY_FAILED` and `DRAWER_OPEN_FAILED`. Repeated identical events
are fingerprint-grouped server-side, so a long outage increments a counter
instead of creating an unbounded list of unrelated faults.
