const DEV_SESSION_SECRET = 'dev-session-secret-change-me-in-production';

/**
 * Fail closed in production: refuse to boot rather than silently run with a
 * default secret or missing DB/origin config (see docs/15, Phase 1).
 * Development keeps today's console.warn-and-continue behavior unchanged.
 */
function assertProductionEnv(env = process.env) {
  if (env.NODE_ENV !== 'production') return;

  const problems = [];

  if (!env.SESSION_SECRET || env.SESSION_SECRET === DEV_SESSION_SECRET) {
    problems.push('SESSION_SECRET is missing or set to the known dev default.');
  }
  if (!env.DATABASE_URL) {
    problems.push('DATABASE_URL is not set.');
  }
  if (!env.CORS_ORIGINS || !env.CORS_ORIGINS.trim()) {
    problems.push('CORS_ORIGINS is not set (production must not rely on the localhost/dev defaults).');
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production due to unsafe configuration:\n  - ${problems.join('\n  - ')}`,
    );
  }
}

module.exports = { assertProductionEnv, DEV_SESSION_SECRET };
