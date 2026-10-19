## Contents

- [Atomic Transactions with Deadlock Retries](#transactions)
- [Express Middleware Suite](#express-middleware)
- [Error Hierarchy & HTTP Status Mapping](#error-hierarchy)
- [TypeScript Integration & Type Safety](#typescript-integration)
- [Package Subpath Exports](#package-exports)
- [Configuration Reference](#configuration-reference)
- [Contributing & Development](#contributing)
- [License](#license)

---

<a id="transactions"></a>

## 🔄 Atomic Transactions with Deadlock Retries

In high-concurrency environments, competing transactions accessing intersecting rows cause MySQL deadlocks (`ER_LOCK_DEADLOCK`, errno `1213` or `1205`). 

`@mysql-craft` handles transactions safely:
1. Acquires a dedicated `PoolConnection` from the pool.
2. Issues `START TRANSACTION`.
3. Passes a scoped `Transaction` client to your callback function.
4. Automatically invokes `COMMIT` upon successful resolution.
5. Catches errors, invokes `ROLLBACK`, and releases the connection back to the pool.
6. **Automatic Deadlock Retry:** If a deadlock or lock wait timeout occurs, rolls back and retries the entire callback block using exponential backoff with full jitter up to the configured retry limit.

```typescript
// Safe financial transfer with deadlock retry guarantees
await db.transaction(async (trx) => {
  const senderId = 101;
  const recipientId = 202;
  const transferAmount = 250.00;

  // 1. Check sender balance inside transaction
  const sender = await trx.queryOne<{ balance: number }>(
    'SELECT balance FROM account_balance WHERE iduser = ? FOR UPDATE',
    [senderId]
  );

  if (!sender || sender.balance < transferAmount) {
    throw new ValidationError('Insufficient funds for transfer.');
  }

  // 2. Deduct from sender
  await trx.update(
    'account_balance',
    { balance: sender.balance - transferAmount },
    'iduser = ?',
    [senderId]
  );

  // 3. Credit recipient
  await trx.query(
    'UPDATE account_balance SET balance = balance + ? WHERE iduser = ?',
    [transferAmount, recipientId]
  );

  // 4. Record audit ledger entry
  await trx.insert('transfer_ledger', {
    from_user: senderId,
    to_user: recipientId,
    amount: transferAmount,
    status: 'COMPLETED'
  });
}, {
  retries: 3,        // Retry up to 3 times on deadlock
  retryDelayMs: 200  // Base backoff delay
});
```

---

<a id="express-middleware"></a>

## 🔌 Express Middleware Suite

Imported from `mysql-craft/middleware` or root:

```typescript
import {
  authenticateJwt,
  requireRole,
  validateBody,
  errorMiddleware
} from 'mysql-craft';
```

### 1. JWT Authentication Middleware

Validates the `Authorization: Bearer <token>` header, decodes the payload, and augments `req.user`:

```typescript
// Protect a route
app.get(
  '/api/me',
  authenticateJwt({ secret: process.env.JWT_ACCESS_SECRET! }),
  (req, res) => {
    // req.user is automatically typed and available
    res.json({ userId: req.user?.sub, role: req.user?.role });
  }
);

// Optional authentication (proceeds with req.user = undefined if no token provided)
app.get(
  '/api/posts',
  authenticateJwt({ secret: process.env.JWT_ACCESS_SECRET!, optional: true }),
  postsHandler
);
```

### 2. Role-Based Access Control (RBAC)

Guarantees the authenticated user possesses one of the allowed roles:

```typescript
// Require admin or superadmin role
app.delete(
  '/api/accounts/:id',
  authenticateJwt({ secret: process.env.JWT_ACCESS_SECRET! }),
  requireRole('admin', 'superadmin'),
  deleteAccountHandler
);
```

### 3. Request Body Validation

Lightweight, framework-agnostic validator compatible with custom functions, Zod, Joi, or Yup:

```typescript
app.post(
  '/api/accounts',
  validateBody((body: any) => {
    const errors: Record<string, string> = {};
    if (!body.email) errors.email = 'Email address is required.';
    if (!body.password) errors.password = 'Password is required.';
    return {
      valid: Object.keys(errors).length === 0,
      errors
    };
  }),
  createAccountHandler
);
```

### 4. Centralized Error Middleware

Standardizes all application errors into a predictable JSON API structure:

```typescript
import { errorMiddleware } from 'mysql-craft';

// Register at the end of your Express middleware stack
app.use(errorMiddleware);
```

Standardized JSON output:
```json
{
  "success": false,
  "error": {
    "name": "ValidationError",
    "code": "VALIDATION_ERROR",
    "message": "Request payload validation failed.",
    "details": {
      "email": "Email address is required."
    }
  }
}
```

---

<a id="error-hierarchy"></a>

## 🚨 Error Hierarchy & HTTP Status Mapping

All errors inherit from the abstract `AppError` class and feature `isOperational: true`, allowing centralized error handlers to distinguish trusted operational errors from unknown programming bugs.

```
AppError (abstract)
 ├── DatabaseError (HTTP 500)
 ├── PoolExhaustedError (HTTP 503)
 ├── AuthError (HTTP 401 / 403)
 └── ValidationError (HTTP 400)
```

| Error Class | HTTP Status | Code | Description |
| :--- | :---: | :--- | :--- |
| `DatabaseError` | `500` | `DATABASE_ERROR` | Database query failure (contains `sql`, `errno`, `sqlState`). |
| `PoolExhaustedError` | `503` | `POOL_EXHAUSTED` | Connection pool queue limit reached. Server is saturated. |
| `AuthError.unauthorized` | `401` | `UNAUTHORIZED` | Missing or invalid authentication token. |
| `AuthError.invalidToken` | `401` | `INVALID_TOKEN` | Token corrupted or malformed signature. |
| `AuthError.tokenExpired` | `401` | `TOKEN_EXPIRED` | JWT has expired. |
| `AuthError.forbidden` | `403` | `FORBIDDEN` | Authenticated user lacks required RBAC permissions. |
| `AuthError.invalidCredentials`| `401` | `INVALID_CREDENTIALS` | Invalid email/username or password. |
| `ValidationError` | `400` | `VALIDATION_ERROR` | Request payload or parameter validation failure. |

---

<a id="typescript-integration"></a>

## 🦾 TypeScript Integration & Type Safety

### End-to-End Type Safety with Generics

```typescript
interface Order {
  idorder: number;
  customer_id: number;
  total_amount: number;
  created_at: Date;
}

// 1. Typed queryOne returns Order | null
const order = await db.queryOne<Order>(
  'SELECT * FROM orders WHERE idorder = ?',
  [1001]
);

// 2. Typed query returns Order[]
const orders = await db.query<Order>(
  'SELECT * FROM orders WHERE customer_id = ?',
  [42]
);

// 3. Typed structured select
const topOrders = await db.select<Order>({
  table: 'orders',
  where: [{ column: 'total_amount', operator: '>', value: 500 }]
});
```

### Request User Type Augmentation

`@mysql-craft` automatically extends the Express `Request` interface:

```typescript
// Express Request interface is globally merged:
declare global {
  namespace Express {
    interface Request {
      user?: BaseTokenPayload & Record<string, any>;
    }
  }
}
```

---

<a id="package-exports"></a>

## 📦 Package Subpath Exports

Import only the modules you need with clean subpath imports:

```typescript
// Root import (everything)
import { createDbClient, Security } from 'mysql-craft';

// Core database client & query builders
import { Database, BaseClient, escapeIdentifier } from 'mysql-craft/core';

// Security & auth module
import { Security } from 'mysql-craft/security';

// Express middleware
import { authenticateJwt, requireRole, errorMiddleware } from 'mysql-craft/middleware';

// Operational errors
import { DatabaseError, PoolExhaustedError, ValidationError, AuthError } from 'mysql-craft/errors';
```

---

<a id="configuration-reference"></a>

## ⚙️ Configuration Reference

### `DatabaseConfig` (extends `mysql2.PoolOptions`)

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `host` | `string` | `'localhost'` | MySQL server hostname. |
| `port` | `number` | `3306` | MySQL server port. |
| `user` | `string` | `'root'` | Database username. |
| `password` | `string` | `''` | Database password. |
| `database` | `string` | `undefined` | Database name. |
| `connectionLimit` | `number` | `10` | Maximum number of active connections in pool. |
| `queueLimit` | `number` | `connectionLimit * 10` | Maximum queued requests before failing fast with HTTP 503. |
| `waitForConnections` | `boolean` | `true` | Whether to queue requests when pool is saturated. |
| `debug` | `boolean \| LoggerConfig` | `false` | Enables terminal SQL diagnostics with syntax highlighting. |
| `slowQueryThresholdMs` | `number` | `500` | Latency threshold (in ms) before tagging query as slow. |
| `retryPolicy` | `RetryPolicyOptions` | `{ maxAttempts: 3, baseDelayMs: 200 }` | Exponential backoff retry policy for transient errors and deadlocks. |
| `sensitiveKeys` | `string[]` | `[]` | Additional parameter keys to mask in debug logs. |
| `instrumentation` | `Instrumentation \| Instrumentation[]` | `[]` | APM and logging event listeners. |

---

<a id="contributing"></a>

## 🧪 Contributing & Development

Contributions are welcome! Please follow these steps:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/arch/mysql-craft.git
   cd mysql-craft
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run unit & integration tests:**
   ```bash
   npm test
   ```

4. **Verify TypeScript compilation:**
   ```bash
   npm run typecheck
   npm run build
   ```

---

<a id="license"></a>

## 📜 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.

<!-- Developed with ❤️ by the **Principal Node.js Architecture Team**. -->
<p align="center">
  Crafted with ❤️ by <a href="https://github.com/ind-prince">ind-prince</a>
</p>
