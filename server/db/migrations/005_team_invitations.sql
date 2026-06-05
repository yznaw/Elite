-- Migration 005: Team invitation tokens
-- Invitations allow admins to onboard new team members via a secure email link.
-- Tokens are 48h one-shot; once accepted the row is deleted.

CREATE TABLE IF NOT EXISTS team_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'viewer',
  token_hash   TEXT NOT NULL,          -- SHA-256 of the raw token
  invited_by   UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON team_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_invitations_tenant      ON team_invitations(tenant_id);
