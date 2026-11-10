-- Fixes a real bug: settings.component.ts's "Remove member" action has always
-- written status='removed' via PATCH /admin/settings/team/:id, but the
-- team_member_status enum (001_initial_schema.sql) only ever defined
-- 'invited' | 'active' | 'disabled' — every remove attempt fails at the DB
-- layer. A hard DELETE isn't safe here: admin_users is referenced with
-- ON DELETE RESTRICT by pos_shifts/pos_transactions/pos_cash_movements
-- (cashier_id/manager_id) precisely so a till operator's sale history can't
-- vanish out from under an audit trail. Soft-delete via status is the only
-- option, so the enum needs the value the app already assumes exists.
--
-- Not wrapped in BEGIN/COMMIT, and kept as this file's only enum change:
-- PostgreSQL forbids using a new enum value in the same transaction that
-- added it, and this file runs as a single statement outside any
-- surrounding transaction (server/db/pos-schema.js), same precedent as
-- 019_cashier_role.sql.
ALTER TYPE team_member_status ADD VALUE IF NOT EXISTS 'removed';

-- Lets the invitations list show real delivery status per row (not just at
-- the moment of sending) and gives a "resend" action a re-send counter to
-- render "resent Nx" / a fresh "sent just now" state instead of only ever
-- showing the original created_at.
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS last_sent_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS email_sent boolean NOT NULL DEFAULT false;
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS resend_count integer NOT NULL DEFAULT 0;
