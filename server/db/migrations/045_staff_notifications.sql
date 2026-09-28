-- Staff notifications: the admin bell and the new-order emails.
-- 2026-09-26; adds admin_notifications and admin_notification_reads.
--
-- Until this migration the bell in the admin top bar rendered a hard-coded
-- seed list (client notification.service.ts), so staff saw orders that never
-- existed and were told about none that did. Rows here are written by
-- server/lib/staff-notify.js and read by GET /api/admin/notifications.
--
-- 001 created a `notifications` table that nothing ever wrote to. It is not
-- reused: its uuid ids cannot serve as the bell's polling cursor, and it has
-- no key to make "notify once per order" atomic.
--
-- Recipients for the email side live in tenants.config.notifications
-- (owner/admin only, see admin-settings.route.js), not in a table: it is a
-- short list edited as a whole.

CREATE TABLE IF NOT EXISTS admin_notifications (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  -- Admin route opened when the notification is clicked, e.g. /orders?id=...
  route       text,
  entity_type text,
  entity_id   uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One notification per (kind, entity). This is what makes notifying
-- idempotent: Sadad delivers its webhook more than once and the browser
-- callback can race it, so every caller simply tries to insert and only the
-- caller whose insert lands sends the email.
CREATE UNIQUE INDEX IF NOT EXISTS admin_notifications_once
  ON admin_notifications (tenant_id, kind, entity_id)
  WHERE entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS admin_notifications_feed
  ON admin_notifications (tenant_id, id DESC);

-- Read state is a per-user high-water mark rather than a row per
-- (user, notification): "mark all read" is the only read action the bell
-- offers, and a cursor keeps it one row per person.
CREATE TABLE IF NOT EXISTS admin_notification_reads (
  user_id      uuid PRIMARY KEY REFERENCES admin_users(id) ON DELETE CASCADE,
  last_read_id bigint NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
