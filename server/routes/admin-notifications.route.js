const { Router } = require('express');
const db = require('../db/client');
const { asyncHandler, ok, validationError } = require('./lib');

/**
 * Feed for the admin bell. Rows are written by server/lib/staff-notify.js.
 *
 * The client polls `GET /?after=<last id it has>`; with no cursor it gets the
 * most recent page. Read state is one high-water mark per user
 * (admin_notification_reads), so "mark all read" is a single upsert.
 *
 * Mounted under the authenticated admin router, so every signed-in role can
 * read it; tenant scoping comes from the session, never from the request.
 */
const router = Router();

const PAGE = 30;

function mapRow(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    title: row.title,
    body: row.body,
    route: row.route,
    createdAt: row.created_at,
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const tenantId = req.user.tenantId;
  const after = Number.parseInt(req.query.after, 10);
  const hasCursor = Number.isSafeInteger(after) && after >= 0;

  const items = hasCursor
    ? await db.query(
      `SELECT id, kind, title, body, route, created_at FROM admin_notifications
        WHERE tenant_id = $1 AND id > $2 ORDER BY id DESC LIMIT $3`,
      [tenantId, after, PAGE],
    )
    : await db.query(
      `SELECT id, kind, title, body, route, created_at FROM admin_notifications
        WHERE tenant_id = $1 ORDER BY id DESC LIMIT $2`,
      [tenantId, PAGE],
    );
  const read = await db.query('SELECT last_read_id FROM admin_notification_reads WHERE user_id = $1', [req.user.id]);

  ok(res, {
    items: items.rows.map(mapRow),
    lastReadId: Number(read.rows[0]?.last_read_id || 0),
  });
}));

router.post('/read', asyncHandler(async (req, res) => {
  const upToId = Number.parseInt(req.body?.upToId, 10);
  if (!Number.isSafeInteger(upToId) || upToId < 0) return validationError(res, ['upToId must be a non-negative integer.']);
  // Clamp to what actually exists for this tenant so a client cannot park the
  // cursor past future notifications and silently hide them.
  const { rows } = await db.query(
    `INSERT INTO admin_notification_reads (user_id, last_read_id, updated_at)
     SELECT $1, LEAST($2::bigint, COALESCE((SELECT max(id) FROM admin_notifications WHERE tenant_id = $3), 0)), now()
     ON CONFLICT (user_id) DO UPDATE
       SET last_read_id = GREATEST(admin_notification_reads.last_read_id, EXCLUDED.last_read_id),
           updated_at = now()
     RETURNING last_read_id`,
    [req.user.id, upToId, req.user.tenantId],
  );
  ok(res, { lastReadId: Number(rows[0].last_read_id) });
}));

module.exports = router;
