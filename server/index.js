require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const session = require('express-session');
const PgSimple = require('connect-pg-simple')(session);

const routes = require('./routes');
const nboxWebhookRouter = require('./routes/nbox-webhook.route');
const sadadWebhookRouter = require('./routes/sadad-webhook.route');
const db = require('./db/client');
const { ensureDefaultTenant } = require('./db/tenant');
const { ensureReferenceSchema } = require('./db/reference-schema');
const { ensureProductRecommendationsSchema } = require('./db/product-recommendations-schema');
const { ensureRestockNotificationsSchema } = require('./db/restock-notifications-schema');
const { ensurePosSchema } = require('./db/pos-schema');
const { ensureAllMigrations } = require('./db/ensure-migrations');
const { uploadsDir, publicBase: uploadsPublicBase } = require('./lib/storage');
const { startPendingOrderCleanup } = require('./lib/pending-order-cleanup');
const { startInventoryConsistencyJob } = require('./lib/pos/inventory-consistency-job');
const { assertProductionEnv, DEV_SESSION_SECRET } = require('./config/assert-env');
const { csrfProtection } = require('./middleware/csrf');
const { requestId } = require('./middleware/request-id');
const { logger, httpLoggerOptions } = require('./lib/logger');
const { recordError, serverErrorSurge, SURGE_THRESHOLD } = require('./lib/error-log');
const { sendAlert } = require('./lib/alerts');
const { startQueueWatchJob } = require('./lib/pos/queue-watch-job');

assertProductionEnv();

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
const sessionCookieSecure = process.env.SESSION_COOKIE_SECURE === 'true'
  ? 'auto'
  : process.env.SESSION_COOKIE_SECURE === 'auto'
    ? 'auto'
    : false;

// ─── Allowed Origins ────────────────────────────────────────────────────────
function csv(value) {
  return String(value || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

function originFromUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

const configuredOrigins = csv(process.env.CORS_ORIGINS);
// Dev-only convenience defaults — never trusted in production, where
// CORS_ORIGINS must be set explicitly (enforced by assertProductionEnv above).
const defaultAllowedOrigins = isProd ? [] : ['http://localhost:4200', 'http://localhost:4300'];
const sadadAllowedOrigins = new Set([
  'https://sadadqa.com',
  'https://www.sadadqa.com',
  originFromUrl(process.env.SADAD_ENDPOINT || 'https://sadadqa.com/webpurchase'),
  ...csv(process.env.SADAD_CORS_ORIGINS),
].filter(Boolean));

function isAllowedOrigin(origin) {
  if (configuredOrigins.includes(origin)) return true;
  if (sadadAllowedOrigins.has(origin)) return true;
  if (defaultAllowedOrigins.includes(origin)) return true;
  if (isProd) return false;

  try {
    const { hostname } = new URL(origin);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)
      || /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  } catch {
    return false;
  }
}

// Behind a proxy/load-balancer the secure-cookie check needs trust-proxy.
if (isProd) app.set('trust proxy', 1);

// ─── Middleware ──────────────────────────────────────────────────────────────
// First in the chain: every log line, error row, audit row and cashier-facing
// reference code downstream shares this one id (docs/24, Phase A).
app.use(requestId());

app.use(
  helmet({
    // Report-only for the first rollout window (docs/15 Phase 1) — flips to
    // enforcing via CSP_REPORT_ONLY=false once violation reports are clean.
    contentSecurityPolicy: {
      reportOnly: process.env.CSP_REPORT_ONLY !== 'false',
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        // Report-only mode was previously emitting reports to nowhere, which
        // made docs/15 Phase 1's "review violation reports before enforcing"
        // gate impossible to satisfy. Reports now land in app_errors with
        // source='csp' and are visible on the Diagnostics page.
        reportUri: ['/api/client-logs/csp'],
      },
    },
    // The admin portal loads uploaded images/media cross-origin in dev.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, Postman)
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: origin ${origin} not allowed`));
      }
    },
    credentials: true,
    // The admin portal is cross-origin in dev (4300 → 3000). Without this the
    // browser cannot read the correlation id off a response, so the client
    // log shipper would have nothing to tie its entries to a server request.
    exposedHeaders: ['X-Request-Id'],
  })
);

function captureRawBody(req, _res, buf) {
  if (buf && buf.length > 0) req.rawBody = Buffer.from(buf);
}

app.use(express.json({ limit: '10mb', verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Structured request logging. Replaces morgan('dev'), which carried no
// timestamp, request id, user or tenant and so could not be used to
// reconstruct an incident after the fact (docs/24, Phase B).
app.use(pinoHttp(httpLoggerOptions));

// ─── Sessions (cookie + Postgres-backed store) ───────────────────────────────
app.use(
  session({
    name: process.env.SESSION_COOKIE_NAME || 'elite.sid',
    secret: process.env.SESSION_SECRET || DEV_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: new PgSimple({
      pool: db.pool,
      tableName: 'admin_sessions',
      createTableIfMissing: true,
    }),
    cookie: {
      httpOnly: true,
      secure: sessionCookieSecure,
      sameSite: process.env.SESSION_COOKIE_SAMESITE || 'lax',
      maxAge: Number.parseInt(process.env.SESSION_MAX_AGE_MS, 10) || 12 * 60 * 60 * 1000,
    },
  }),
);

// ─── CSRF (Origin/Sec-Fetch-Site + double-submit cookie) ─────────────────────
// Behind a flag for the initial rollout per docs/15 Phase 1; defaults on.
if (process.env.CSRF_ENFORCE !== 'false') {
  app.use(csrfProtection({ allowedOriginCheck: isAllowedOrigin }));
}

// ─── Static uploads ──────────────────────────────────────────────────────────
// Served at both /uploads/ (legacy, direct host access) AND /api/uploads/
// (via the /api proxy so admin.example.com/api/uploads/… always resolves).
const staticOpts = { maxAge: '1y', immutable: true, fallthrough: false };
app.use(uploadsPublicBase, express.static(uploadsDir, staticOpts));
app.use('/api/uploads', express.static(uploadsDir, staticOpts));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/webhooks/nbox', nboxWebhookRouter);
app.use('/webhooks/sadad', sadadWebhookRouter);
app.use('/api', routes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'This file is too large to save here. Use the media uploader for images instead — it supports files up to 50 MB.',
    });
  }

  // Friendly multer errors — file too big, wrong type, etc.
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: 'One of the uploaded files exceeds the 50 MB limit.',
      });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err && /Unsupported file type/.test(err.message || '')) {
    return res.status(415).json({ success: false, message: err.message });
  }

  const status = err.status || 500;
  const isServerFault = status >= 500;

  // Structured, correlated, and searchable. The raw message and stack always
  // go here even when the client response hides them (see below).
  (req.log || logger).error(
    { err: { message: err.message, code: err.code, stack: err.stack }, status },
    'request failed',
  );

  // Persist to app_errors: 5xx always; 4xx only for POS routes, where a
  // cashier hitting INSUFFICIENT_STOCK or a rejected receipt number is
  // exactly the forensic trail we want. Other 4xx are ordinary client
  // validation noise and would drown the table.
  const isPosRoute = String(req.originalUrl || '').startsWith('/api/pos');
  if (isServerFault || isPosRoute) {
    void recordError({
      source: 'server',
      severity: isServerFault ? 'error' : 'warn',
      code: err.code || null,
      message: err.message || 'Internal Server Error',
      stack: err.stack || null,
      route: `${req.method} ${req.originalUrl}`,
      httpStatus: status,
      requestId: req.requestId,
      tenantId: req.user?.tenantId,
      userId: req.user?.id,
      registerId: req.session?.posRegisterId,
      context: { role: req.user?.role, details: err.details ?? undefined },
    }).then(() => {
      if (!isServerFault) return;
      const surge = serverErrorSurge();
      if (!surge.surging) return;
      void sendAlert(
        'server-error-surge',
        `${surge.count} server errors in ${surge.windowMinutes} minutes`,
        `The API recorded ${surge.count} 5xx responses in the last ${surge.windowMinutes} minutes `
        + `(threshold ${SURGE_THRESHOLD}).\nMost recent: ${req.method} ${req.originalUrl}\n`
        + `Reference: ${req.requestId}\n\nCheck the Diagnostics page in the admin portal.`,
      );
    });
  }

  // Do not leak internal detail on a 500 in production: err.message can carry
  // SQL text, file paths, or connection strings. Deliberately-modelled errors
  // (PosError and anything with an explicit status < 500) keep their message,
  // because those are written to be read by a cashier.
  // NODE_ENV is read here rather than via the module-level `isProd` so this
  // branch is testable without spawning a second process.
  const message = isServerFault && process.env.NODE_ENV === 'production'
    ? 'Something went wrong on our side. Please try again.'
    : err.message || 'Internal Server Error';

  res.status(status).json({
    success: false,
    message,
    ...(err.code ? { code: err.code } : {}),
    // Field-level validation detail carried by PosError. Preserved here
    // because the POS/reconciliation routers used to shape their own error
    // responses and no longer do — see the note on those routers.
    ...(err.details ? { details: err.details } : {}),
    // Shown to the cashier as a short reference code, and the key an
    // investigator greps for in the logs / Diagnostics page.
    requestId: req.requestId,
  });
});

// ─── Boot: seed default tenant + admin user, then start ──────────────────────

// One arbitrary but fixed key, so every process doing boot-time schema work
// queues on the same lock.
const SCHEMA_LOCK_KEY = 8150025;

/**
 * Applies schema/bootstrap work, one process at a time.
 *
 * `CREATE TABLE IF NOT EXISTS` is not safe against *itself* running
 * concurrently: two processes can both pass the existence check and then race
 * on `pg_type`/`pg_class`, and the loser gets a duplicate-key error. The
 * migration files wrap their statements in `BEGIN … COMMIT`, so that error
 * aborts the rest of the file and the next query on that connection returns
 * `25P02 current transaction is aborted` — leaving the schema half-applied,
 * silently, because the catch below only warns.
 *
 * The lock has to cover **all** the ensure* calls, not just one of them. An
 * earlier attempt that guarded only `ensurePosSchema` made things worse: that
 * process held the advisory lock while waiting for a table lock held by a
 * second process, which was itself waiting for the advisory lock — a textbook
 * deadlock, and the suite started failing with `40P01`.
 *
 * This is not only a test concern, though that is where it surfaced. The same
 * race exists whenever two API processes start together, or a deploy restarts
 * one instance while another is still booting.
 */
async function prepareDatabase() {
  if (process.env.DATABASE_URL) {
    const client = await db.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK_KEY]);
      try {
        const tenant = await ensureDefaultTenant(client);
        await ensureAllMigrations(client);           // migrations 002 – 015
        await ensureReferenceSchema(client, tenant.id);
        await ensureProductRecommendationsSchema(client);
        await ensureRestockNotificationsSchema(client);
        await ensurePosSchema(client);
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK_KEY]).catch(() => undefined);
      }
    } catch (err) {
      // Never serve a new binary against a partially migrated schema.
      console.error('Database preparation failed; refusing to start:', err);
      throw err;
    } finally {
      client.release();
    }
  } else {
    console.warn('DATABASE_URL not set — skipping tenant + admin-user bootstrap.');
  }
}

async function startServer(port = PORT) {
  await prepareDatabase();
  const stopInventoryConsistencyJob = startInventoryConsistencyJob();
  // Watches pos_sync_states for a register whose offline queue has stopped
  // draining — unsynced money sitting in a browser is the top offline risk
  // (docs/24, Phase E).
  const stopQueueWatchJob = startQueueWatchJob();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const address = server.address();
      const activePort = typeof address === 'object' && address ? address.port : port;
      console.log(`Elite API running at http://localhost:${activePort}/api`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      resolve(server);
    });
    server.once('close', () => {
      stopInventoryConsistencyJob();
      stopQueueWatchJob();
    });
    server.once('error', reject);
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}

module.exports = { app, prepareDatabase, startServer };
