require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const PgSimple = require('connect-pg-simple')(session);

const routes = require('./routes');
const db = require('./db/client');
const { ensureDefaultTenant } = require('./db/tenant');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ─── Allowed Origins ────────────────────────────────────────────────────────
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:4200', 'http://localhost:4300'];

// Behind a proxy/load-balancer the secure-cookie check needs trust-proxy.
if (isProd) app.set('trust proxy', 1);

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, Postman)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: origin ${origin} not allowed`));
      }
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
      secure: process.env.SESSION_COOKIE_SECURE === 'true',
      sameSite: process.env.SESSION_COOKIE_SAMESITE || 'lax',
      maxAge: Number.parseInt(process.env.SESSION_MAX_AGE_MS, 10) || 12 * 60 * 60 * 1000,
    },
  }),
);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

// ─── Boot: seed default tenant + admin user, then start ──────────────────────
async function bootstrap() {
  if (process.env.DATABASE_URL) {
    const client = await db.pool.connect();
    try {
      await ensureDefaultTenant(client);
    } catch (err) {
      console.warn('Tenant bootstrap failed (the server will still start):', err.message);
    } finally {
      client.release();
    }
  } else {
    console.warn('DATABASE_URL not set — skipping tenant + admin-user bootstrap.');
  }

  app.listen(PORT, () => {
    console.log(`✅  Elite API running at http://localhost:${PORT}/api`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
