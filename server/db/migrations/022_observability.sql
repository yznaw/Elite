-- Observability: correlation ids on the audit trail + a bounded error store
-- (docs/24-logging-observability-plan.md, Phases A and C).
--
-- Why a table at all, when request logs go to disk: disk logs are rotated
-- after 14 days, are only reachable over SSH, and cannot be grouped. The
-- errors that matter need to outlive rotation, be queryable, be visible to
-- the owner in the admin portal, and collapse duplicates so "3 problems"
-- doesn't read as "1200 log lines". Request-level logging deliberately stays
-- out of Postgres: this is the same database that serves checkout, and a
-- logging spike must never compete with a sale for connections or WAL.

BEGIN;

-- Ties an audit row to the exact HTTP request that produced it, and through
-- that request id to the pino line, the app_errors row, and the reference
-- code shown to the cashier.
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS request_id text;

CREATE INDEX IF NOT EXISTS audit_events_request_idx
  ON audit_events (tenant_id, request_id)
  WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_errors (
  id bigserial PRIMARY KEY,
  -- Hash of source + code + route + first stack frame. Identical failures
  -- collapse onto one row (seen_count/last_seen_at) instead of inserting
  -- again, which is what keeps this table small enough to live here.
  fingerprint text NOT NULL,
  source text NOT NULL CHECK (source IN ('server', 'pos-client', 'admin-client', 'csp')),
  severity text NOT NULL CHECK (severity IN ('error', 'warn')),
  code text,
  message text NOT NULL,
  stack text,
  route text,
  http_status integer,
  request_id text,
  -- Nullable: a client error can arrive before a session is established, and
  -- a CSP report carries no identity at all.
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  -- Deliberately not FK-constrained: these arrive from a browser and a stale
  -- or wiped register/shift id must still be recorded, not rejected.
  register_id uuid,
  shift_id uuid,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  seen_count integer NOT NULL DEFAULT 1 CHECK (seen_count > 0),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL
);

-- The dedup key. Partial on unresolved rows so that once a fault is marked
-- resolved, a later recurrence opens a NEW row instead of silently reviving
-- the old one — a regression after a fix has to be visible.
CREATE UNIQUE INDEX IF NOT EXISTS app_errors_open_fingerprint_idx
  ON app_errors (fingerprint)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS app_errors_recent_idx
  ON app_errors (tenant_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS app_errors_open_idx
  ON app_errors (last_seen_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS app_errors_request_idx
  ON app_errors (request_id)
  WHERE request_id IS NOT NULL;

COMMIT;
