# Elite POS Device Signer

This loopback-only service lets QZ Tray verify print and drawer commands while
the Elite API is offline. It never returns the private key to the browser.

Required environment variables:

- `ELITE_POS_QZ_CERT_PATH`: QZ `digital-certificate.txt` path.
- `ELITE_POS_QZ_KEY_PATH`: QZ PKCS#8 private key path. Restrict this file to the
  dedicated signer OS account using operating-system ACLs or a managed secret.
- `ELITE_POS_PRINTER_ALLOWLIST`: comma-separated exact QZ printer names.
- `ELITE_POS_ALLOWED_ORIGINS`: comma-separated Elite admin origins.

Optional: `ELITE_POS_SIGNER_PORT` defaults to `8182`.

Run the signer as a restricted startup service on the POS device. Provision and
revoke its certificate per register. Validate the exact Posiflex, Bixolon,
Windows startup, Chrome local-network permission, drawer pin, and QZ trust chain
before production rollout.
