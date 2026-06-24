require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
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
const defaultAllowedOrigins = ['http://localhost:4200', 'http://localhost:4300'];
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
  })
);

function captureRawBody(req, _res, buf) {
  if (buf && buf.length > 0) req.rawBody = Buffer.from(buf);
}

app.use(express.json({ limit: '10mb', verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// ─── Sessions (cookie + Postgres-backed store) ───────────────────────────────
app.use(
  session({
    name: process.env.SESSION_COOKIE_NAME || 'elite.sid',
    secret: process.env.SESSION_SECRET || 'dev-session-secret-change-me-in-production',
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
      message: 'Request body is too large. Upload images through the media uploader instead of saving large inline data URLs.',
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

  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// ─── Boot: seed default tenant + admin user, then start ──────────────────────
async function prepareDatabase() {
  if (process.env.DATABASE_URL) {
    const client = await db.pool.connect();
    try {
      const tenant = await ensureDefaultTenant(client);
      await ensureAllMigrations(client);           // migrations 002 – 006
      await ensureReferenceSchema(client, tenant.id);
      await ensureProductRecommendationsSchema(client);
      await ensureRestockNotificationsSchema(client);
      await ensurePosSchema(client);
    } catch (err) {
      console.warn('Tenant bootstrap failed (the server will still start):', err.message);
    } finally {
      client.release();
    }
  } else {
    console.warn('DATABASE_URL not set — skipping tenant + admin-user bootstrap.');
  }
}

async function startServer(port = PORT) {
  await prepareDatabase();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const address = server.address();
      const activePort = typeof address === 'object' && address ? address.port : port;
      console.log(`Elite API running at http://localhost:${activePort}/api`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      resolve(server);
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
