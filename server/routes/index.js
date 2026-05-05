const { Router } = require('express');
const healthRouter = require('./health.route');
// Import additional route modules here as you build them
// const authRouter = require('./auth.route');
// const userRouter = require('./user.route');

const router = Router();

// ─── Mount Routes ─────────────────────────────────────────────────────────────
router.use('/health', healthRouter);
// router.use('/auth',   authRouter);
// router.use('/users',  userRouter);

module.exports = router;
