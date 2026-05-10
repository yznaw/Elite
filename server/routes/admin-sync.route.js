const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, notFound, ok, validationError } = require('./lib');

const router = Router();

router.get('/sources', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query('SELECT * FROM sync_sources WHERE tenant_id = $1 ORDER BY name', [tenant.id]);
    ok(res, result.rows);
  } finally {
    client.release();
  }
}));

router.post('/sources', asyncHandler(async (req, res) => {
  const key = String(req.body.key || req.body.sourceKey || '').trim();
  if (!key) return validationError(res, ['Sync source key is required.']);
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        INSERT INTO sync_sources (tenant_id, source_key, name, description, icon_bg, status, schedule_label, cron_expression, config)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        ON CONFLICT (tenant_id, source_key) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            icon_bg = EXCLUDED.icon_bg,
            status = EXCLUDED.status,
            schedule_label = EXCLUDED.schedule_label,
            cron_expression = EXCLUDED.cron_expression,
            config = EXCLUDED.config
        RETURNING *
      `,
      [tenant.id, key, req.body.name || key, req.body.desc || req.body.description || '', req.body.iconBg || null, req.body.status || 'pending', req.body.schedule || null, req.body.cron || null, JSON.stringify(req.body.config || {})],
    );
    created(res, result.rows[0], 'Sync source saved.');
  } finally {
    client.release();
  }
}));

router.get('/logs', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        SELECT l.*, s.source_key, s.name AS source_name, u.full_name AS triggered_by_user
        FROM sync_logs l
        JOIN sync_sources s ON s.id = l.sync_source_id
        LEFT JOIN admin_users u ON u.id = l.triggered_by_user_id
        WHERE l.tenant_id = $1
        ORDER BY l.started_at DESC
        LIMIT 100
      `,
      [tenant.id],
    );
    ok(res, result.rows);
  } finally {
    client.release();
  }
}));

router.post('/sources/:sourceId/run', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    const source = await client.query(
      'SELECT * FROM sync_sources WHERE tenant_id = $1 AND (id::text = $2 OR source_key = $2)',
      [tenant.id, req.params.sourceId],
    );
    if (source.rowCount === 0) {
      await client.query('ROLLBACK');
      return notFound(res, 'Sync source not found.');
    }

    const log = await client.query(
      `
        INSERT INTO sync_logs (tenant_id, sync_source_id, run_type, status, triggered_by, trigger_context)
        VALUES ($1, $2, $3, 'running', $4, $5)
        RETURNING *
      `,
      [tenant.id, source.rows[0].id, req.body.runType || 'Manual Sync', 'manual', req.body.context || null],
    );
    await client.query("UPDATE sync_sources SET status = 'running', last_run_at = now() WHERE id = $1", [source.rows[0].id]);
    await client.query('COMMIT');
    created(res, log.rows[0], 'Sync queued.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.patch('/logs/:id/complete', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    const log = await client.query(
      `
        UPDATE sync_logs
        SET processed_count = $3,
            updated_count = $4,
            status = $5,
            duration_ms = $6,
            error_message = COALESCE($7, ''),
            finished_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING *
      `,
      [tenant.id, req.params.id, req.body.processed || 0, req.body.updated || 0, req.body.status || 'success', req.body.durationMs || 0, req.body.error || null],
    );
    if (log.rowCount === 0) {
      await client.query('ROLLBACK');
      return notFound(res, 'Sync log not found.');
    }
    await client.query('UPDATE sync_sources SET status = $2, last_run_at = now() WHERE id = $1', [log.rows[0].sync_source_id, log.rows[0].status]);
    await client.query('COMMIT');
    ok(res, log.rows[0], 'Sync completed.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
