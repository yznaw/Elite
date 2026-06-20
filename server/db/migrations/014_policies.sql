-- Migration 014 — Policies (Legal Pages)
-- Creates the policies table for storing legal content pages:
-- Privacy Policy, Terms of Service, Refund Policy, Shipping Policy, etc.
-- Safe to run multiple times (idempotent).

CREATE TABLE IF NOT EXISTS policies (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  handle      TEXT        NOT NULL,
  title       TEXT        NOT NULL,
  content     TEXT        NOT NULL DEFAULT '',
  policy_type TEXT        NOT NULL DEFAULT 'custom',
  status      TEXT        NOT NULL DEFAULT 'draft',
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT policies_tenant_handle_uq UNIQUE (tenant_id, handle),
  CONSTRAINT policies_status_chk CHECK (status IN ('active', 'draft')),
  CONSTRAINT policies_type_chk   CHECK (policy_type IN (
    'privacy_policy','terms_of_service','refund_policy',
    'shipping_policy','cookie_policy','contact_info','custom'
  ))
);

CREATE INDEX IF NOT EXISTS policies_tenant_status_idx
  ON policies (tenant_id, status);

CREATE INDEX IF NOT EXISTS policies_tenant_sort_idx
  ON policies (tenant_id, sort_order, created_at);
