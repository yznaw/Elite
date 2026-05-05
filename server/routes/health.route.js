const { Router } = require('express');

const router = Router();

/**
 * GET /api/health
 * Quick liveness check — useful for load balancers and uptime monitors.
 */
router.get('/', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(process.uptime())}s`,
  });
});

module.exports = router;
