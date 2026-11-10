-- Adds a low-privilege 'cashier' role: POS sale/park/resume/reprint/own-shift
-- only (server/routes/pos.route.js), no access to settings/catalog/orders
-- admin (docs/15 Phase 3, P0-7). Not wrapped in BEGIN/COMMIT: PostgreSQL
-- forbids using a new enum value in the same transaction that added it, and
-- this file is executed as a single statement outside any surrounding
-- transaction by server/db/pos-schema.js, so keeping it standalone avoids
-- ever tripping that restriction if this file is ever combined with others.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'cashier';

-- Emergency self-approval flag: off by default. When enabled, a manager can
-- approve their own void/refund/etc. via the PIN flow (server/lib/pos/
-- manager-service.js) instead of the request being rejected outright. Any
-- tenant that flips this on has that fact captured in audit_events at the
-- point they enable it (see the update-tenant-settings route this feeds).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pos_emergency_self_approval_enabled boolean NOT NULL DEFAULT false;
