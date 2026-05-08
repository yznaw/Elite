# 05 — API Server

> **Audience:** Backend developers  
> **Reading time:** ~8 minutes

---

## Overview

The Express API server is the backend for both Angular applications. It runs at `http://localhost:3000` in development and is typically reverse-proxied behind Nginx in production.

- **Entry point:** `server/index.js`
- **Port:** 3000 (configurable via `PORT` env var)
- **Base path:** All routes are prefixed with `/api`

---

## Server Architecture

```
server/
├── index.js          ← Entry point — middleware, error handling, bootstrap
├── package.json      ← Server-only dependencies
├── .env.example      ← Environment variable template
└── routes/
    ├── index.js      ← Route aggregator — imports and mounts all route files
    └── health.route.js  ← GET /api/health — liveness check
```

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `express` | ^4.19.2 | Web framework |
| `cors` | ^2.8.5 | Cross-Origin Resource Sharing |
| `dotenv` | ^16.4.5 | Environment variable loading |
| `morgan` | ^1.10.0 | HTTP request logger |
| `nodemon` | ^3.1.0 (dev) | Auto-restart on file changes |

---

## Middleware Stack

The middleware is applied in this exact order in `server/index.js`:

### 1. CORS

```javascript
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: origin ${origin} not allowed`));
    }
  },
  credentials: true,
}));
```

- Origins are loaded from `CORS_ORIGINS` env var (comma-separated)
- Default allows `localhost:4200` and `localhost:4300`
- Requests with no origin (e.g., curl, Postman) are always allowed

### 2. Body Parsing

```javascript
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
```

### 3. Request Logging

```javascript
app.use(morgan('dev'));
```

Logs: `GET /api/health 200 3.421 ms`

### 4. Route Mounting

```javascript
app.use('/api', routes);
```

### 5. 404 Handler

```javascript
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`
  });
});
```

### 6. Global Error Handler

```javascript
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});
```

---

## Current Endpoints

| Method | Path | Description | Response |
|---|---|---|---|
| `GET` | `/api/health` | Server liveness check | `{ success, status, timestamp, uptime }` |

---

## Environment Variables

Create `server/.env` from the template:

```bash
cp server/.env.example server/.env
```

| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `3000` | No | Server listening port |
| `CORS_ORIGINS` | `http://localhost:4200,http://localhost:4300` | No | Comma-separated allowed origins. Add production domains here. |
| `NODE_ENV` | `development` | No | `development` or `production` |

---

## Response Format

All API responses follow this standard shape (defined in `shared/interfaces/api-response.interface.ts`):

### Success Response

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message"
}
```

### Error Response

```json
{
  "success": false,
  "message": "What went wrong",
  "errors": ["Field-level error 1", "Field-level error 2"]
}
```

### Paginated Response

```json
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 156,
    "totalPages": 8
  }
}
```

---

## How To: Add a New Route

### Step 1: Create the Route File

```javascript
// server/routes/products.route.js
const { Router } = require('express');

const router = Router();

/**
 * GET /api/products
 * Returns all products.
 */
router.get('/', (req, res) => {
  // TODO: replace with database query
  res.json({
    success: true,
    data: [],
    message: 'Products retrieved',
  });
});

/**
 * GET /api/products/:id
 * Returns a single product by ID.
 */
router.get('/:id', (req, res) => {
  const { id } = req.params;
  // TODO: replace with database query
  res.json({
    success: true,
    data: { id },
  });
});

/**
 * POST /api/products
 * Creates a new product.
 */
router.post('/', (req, res) => {
  const body = req.body;
  // TODO: validate and persist
  res.status(201).json({
    success: true,
    data: body,
    message: 'Product created',
  });
});

module.exports = router;
```

### Step 2: Register in Route Aggregator

```javascript
// server/routes/index.js
const { Router } = require('express');
const healthRouter   = require('./health.route');
const productsRouter = require('./products.route');  // ← add import

const router = Router();

router.use('/health',   healthRouter);
router.use('/products', productsRouter);  // ← mount at /api/products

module.exports = router;
```

### Step 3: Test

```bash
curl http://localhost:3000/api/products
```

---

## Future: Database Integration

When connecting to a database, the recommended approach is:

1. **Add a database client** (e.g., `@supabase/supabase-js`, `pg`, `mongoose`)
2. **Create a `db/` folder** for connection setup and query helpers
3. **Keep routes thin** — routes validate input, call a service/query, return response
4. **Add middleware** for authentication (e.g., JWT verification)

### Suggested Structure

```
server/
├── index.js
├── db/
│   ├── client.js        ← Database connection
│   └── queries/
│       ├── products.js  ← Product-specific queries
│       └── orders.js
├── middleware/
│   ├── auth.js          ← JWT verification
│   └── validate.js      ← Request body validation
└── routes/
    ├── index.js
    ├── health.route.js
    ├── auth.route.js
    ├── products.route.js
    └── orders.route.js
```

---

## Running the Server

### Development (with auto-restart)

```bash
cd server && npm run dev
# or from root:
npm run server
```

### Production

```bash
cd server && npm start
# or use PM2:
pm2 start server/index.js --name elite-api
```

---

## Related Documents

- [02 – Architecture](./02-architecture.md) — Full system architecture
- [07 – Developer Guide](./07-dev-guide.md) — Local setup instructions
