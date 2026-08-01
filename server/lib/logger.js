const pino = require('pino');

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

/**
 * Structured application logger.
 *
 * Replaces `morgan('dev')`, which printed a coloured single line with no
 * timestamp, no request id, no user and no tenant — unusable for
 * reconstructing an incident an hour after a cashier reported it.
 *
 * Output shape by environment:
 *   production  → one JSON line per event on stdout, captured by pm2 and
 *                 rotated by pm2-logrotate (see docs/DEPLOYMENT.md). Query
 *                 with `grep '"requestId":"…"' … | jq .`
 *   development → pino-pretty, human-readable, morgan-like
 *   test        → silent, so `node --test` output stays readable
 *
 * Level is `LOG_LEVEL` when set, otherwise info in production and debug in
 * development.
 */
function buildTransport() {
  if (isProd || isTest) return undefined;
  try {
    require.resolve('pino-pretty');
  } catch {
    // pino-pretty is a devDependency. If a production-style install runs with
    // NODE_ENV unset, fall back to plain JSON rather than crashing at boot.
    return undefined;
  }
  return {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
  };
}

const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? 'silent' : isProd ? 'info' : 'debug'),
  base: undefined, // pid/hostname add noise on a single-instance deployment
  transport: buildTransport(),
  // Defence in depth: even if a caller passes a whole request/body through,
  // these paths never reach disk. The client-side shipper redacts separately
  // (see client-logger.service.ts) so nothing sensitive leaves the browser
  // in the first place.
  // pino's `*.x` wildcard matches exactly one level down, so a top-level
  // `token` is NOT covered by `*.token` — both forms are listed deliberately.
  // (Verified: without the bare keys, `logger.error({ managerPin }, …)` wrote
  // the PIN to disk in clear text.)
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      ...['password', 'passwordHash', 'pin', 'managerPin', 'managerOverrideToken', 'token', 'secret', 'csrfToken']
        .flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
    ],
    censor: '[redacted]',
  },
});

/**
 * pino-http options. Every request line carries the correlation id plus the
 * identity fields that make a POS incident reconstructable: which user, which
 * tenant, which register. `requestId` is assigned upstream by
 * middleware/request-id.js, so a log line, an `app_errors` row, an
 * `audit_events` row and the reference code shown to the cashier all share
 * one value.
 */
const httpLoggerOptions = {
  logger,
  genReqId: (req) => req.requestId,
  quietReqLogger: true,
  customProps: (req) => ({
    userId: req.user?.id,
    tenantId: req.user?.tenantId,
    role: req.user?.role,
    registerId: req.session?.posRegisterId,
  }),
  // Keep the serialized request/response small: a full header dump per line
  // is what makes JSON logs unreadable and expensive to rotate.
  serializers: {
    req: (req) => ({ method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Health checks would otherwise dominate the log once an uptime monitor
  // starts polling every 30 seconds.
  autoLogging: {
    ignore: (req) => req.url === '/api/health' || req.url === '/api/health/',
  },
};

module.exports = { logger, httpLoggerOptions };
