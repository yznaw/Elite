-- Password reset flow for the admin portal.
-- Tokens are one-shot, time-bound, and stored as a SHA-256 hash so the raw
-- value never lives in the database — the email/SMS recipient gets the
-- plaintext exactly once.

BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  requested_ip inet,
  requested_user_agent text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
  ON password_reset_tokens (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_hash_uq
  ON password_reset_tokens (token_hash);

CREATE INDEX IF NOT EXISTS password_reset_tokens_active_idx
  ON password_reset_tokens (tenant_id, expires_at)
  WHERE used_at IS NULL;

COMMIT;
