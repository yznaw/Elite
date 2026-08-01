const { Router } = require('express');
const db = require('../db/client');

const router = Router();

// The check is cached briefly so an uptime monitor (or a scraper) polling every
// few seconds cannot turn the health endpoint into database load. 5s is short
// enough that a real outage is reported almost immediately.
const CACHE_MS = 5000;
const PING_TIMEOUT_MS = 3000;
let cached = { at: 0, ok: false, error: null, latencyMs: null };

async function pingDatabase() {
  if (!process.env.DATABASE_URL) return { ok: false, error: 'DATABASE_URL is not configured', latencyMs: null };
  const startedAt = Date.now();
  try {
    // A hung pool would otherwise make the health check itself hang, which
    // reads to a monitor as a timeout rather than as a clear 503.
    await Promise.race([
      db.pool.query('SELECT 1'),
      new Promise((_resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`database ping exceeded ${PING_TIMEOUT_MS}ms`)),
          PING_TIMEOUT_MS,
        );
        timer.unref();
      }),
    ]);
    return { ok: true, error: null, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, error: error.message, latencyMs: Date.now() - startedAt };
  }
}

async function databaseStatus() {
  if (Date.now() - cached.at < CACHE_MS) return cached;
  const result = await pingDatabase();
  cached = { at: Date.now(), ...result };
  return cached;
}

/**
 * GET /api/health
 *
 * Liveness AND readiness. This used to return `ok` unconditionally, which meant
 * an external monitor stayed green while Postgres was down — the API process
 * being alive says nothing about whether a sale can actually be saved. It now
 * performs a real (cached, timeout-bounded) database ping and answers 503 when
 * the database is unreachable.
 *
 * The original response fields are preserved so any existing monitor keeps
 * parsing it; the `database` block and `success: false` on failure are additive.
 */
router.get('/', async (req, res) => {
  const database = await databaseStatus();
  res.status(database.ok ? 200 : 503).json({
    success: database.ok,
    status: database.ok ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(process.uptime())}s`,
    database: {
      ok: database.ok,
      latencyMs: database.latencyMs,
      ...(database.error ? { error: database.error } : {}),
    },
  });
});

module.exports = router;
