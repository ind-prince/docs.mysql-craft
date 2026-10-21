# Advanced configuration

`DatabaseConfig` extends `mysql2/promise`'s `PoolOptions`. It also accepts
settings used by `mysql-craft` for logging, retries, instrumentation, and AWS
TLS. Client-specific settings are removed before the remaining options are
passed to mysql2.

## Database configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `host` | `string` | mysql2 default (`'localhost'`) | MySQL server host. |
| `port` | `number` | mysql2 default (`3306`) | MySQL server port. |
| `user` | `string` | mysql2 default (`'root'`) | Database account. |
| `password` | `string` | mysql2 default (`''`) | Database password. |
| `database` | `string` | mysql2 default | Initial database. |
| `connectionLimit` | `number` | `10` | Maximum connection count in the pool. |
| `queueLimit` | `number` | `connectionLimit * 10` | Maximum number of queued pool requests. |
| `waitForConnections` | `boolean` | `true` | Whether mysql2 queues requests while all connections are busy. |
| `maxIdle` | `number` | `connectionLimit` | Maximum idle connections. |
| `idleTimeout` | `number` | `60000` | mysql2 idle connection timeout in milliseconds. |
| `enableKeepAlive` | `boolean` | `true` | Enables TCP keep-alive. |
| `keepAliveInitialDelay` | `number` | `0` | Initial keep-alive delay in milliseconds. |
| `debug` | `boolean \| LoggerConfig` | `false` | Enables the terminal logger. An object can configure its threshold, SQL length, masking, and extra sensitive keys. |
| `slowQueryThresholdMs` | `number` | `500` | Logger threshold for marking a query slow. |
| `retryPolicy` | `RetryPolicyOptions` | See retry section | Retry settings for query calls. |
| `retryAttempts` | `number` | `3` | Compatibility alias for `retryPolicy.maxAttempts`. |
| `retryDelayMs` | `number` | `200` | Compatibility alias for `retryPolicy.baseDelayMs`. |
| `sensitiveKeys` | `string[]` | `[]` | Additional exact property names to mask in terminal logs. |
| `instrumentation` | `Instrumentation \| Instrumentation[]` | `undefined` | Listener or listeners for query, error, retry, and transaction events. |
| `useAwsRds` | `boolean` | `false` | With `Database.create()`, loads the AWS RDS TLS profile from optional `aws-ssl-profiles`. |

The mysql2 options not listed here can be passed through too, including `ssl`
and `timezone`. The explicit values above are the defaults assigned by
`Database`; mysql2 may supply defaults for other pool options.

```typescript
import { createDbClient } from 'mysql-craft';

const db = createDbClient({
  host: process.env.DB_HOST ?? 'localhost',
  user: process.env.DB_USER ?? 'shop_app',
  password: process.env.DB_PASSWORD ?? '',
  database: 'shop',
  connectionLimit: 12,
  queueLimit: 60,
  ssl: { rejectUnauthorized: true },
  debug: {
    slowThresholdMs: 400,
    maxSqlLength: 800,
    maskSensitive: true,
    sensitiveKeys: ['customer_email']
  },
  retryPolicy: {
    maxAttempts: 3,
    baseDelayMs: 200,
    maxDelayMs: 3000
  }
});
```

`queueLimit` is a waiting-request bound, not an additional connection count.
When the pool queue is exhausted, recognized pool saturation errors become
`PoolExhaustedError`. The library does not automatically turn every thrown
error into an HTTP response; an Express application can use `errorMiddleware`
to map this operational error to its 503 status.

### Retry policy

`RetryPolicyOptions` contains:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `maxAttempts` | `number` | `3` | Number of retry attempts after the initial query execution. |
| `baseDelayMs` | `number` | `200` | Starting backoff bound. |
| `maxDelayMs` | `number` | `3000` | Maximum backoff bound for query retries. |
| `jitter` | `boolean` | `true` | Present in the type, but the current implementation always uses full jitter. |

Each retry delay is a random value between zero and the lesser of the
exponential delay and `maxDelayMs`. `maxAttempts: 3` permits up to three
retries, or four total executions.

Deadlocks (`ER_LOCK_DEADLOCK` / `1213`) and lock wait timeouts
(`ER_LOCK_WAIT_TIMEOUT` / `1205`) can be retried. Transient network errors are
retried for reads, and for writes only if the call uses
`{ idempotent: true }`. Only opt into write retries when the operation is safe
to repeat.

The legacy `retryAttempts` and `retryDelayMs` settings remain supported. A
value in `retryPolicy` takes precedence over the corresponding alias.

### AWS RDS SSL

The synchronous constructor and factory do not load the AWS profile. Use the
async static factory:

```typescript
import { Database } from 'mysql-craft';

const db = await Database.create({
  host: process.env.DB_HOST!,
  user: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  database: 'shop',
  useAwsRds: true
});
```

`aws-ssl-profiles` must be installed in the application when this option is
enabled. The package is optional for all other users. For custom TLS settings,
pass mysql2's `ssl` option directly and leave `useAwsRds` disabled.

## Transactions and atomic work

Transactions use a dedicated pool connection. `Database.transaction(callback,
options?)` starts a transaction, supplies a `Transaction` client, commits when
the callback succeeds, and rolls back when it throws. The transaction client
inherits the normal query, mutation, and pagination helpers.

```typescript
await db.transaction(async (trx) => {
  const inventory = await trx.queryOne<{ available: number }>(
    'SELECT available FROM inventory WHERE product_id = ? FOR UPDATE',
    [7]
  );

  if (!inventory || inventory.available < 2) {
    throw new Error('This product is no longer available in that quantity.');
  }

  await trx.update(
    'inventory',
    { available: inventory.available - 2 },
    '`product_id` = ?',
    [7]
  );
  await trx.insert('order_items', {
    order_id: 1042,
    product_id: 7,
    quantity: 2
  });
});
```

Transaction options are `retries` (default `3`) and `retryDelayMs` (default
`200`). These allow three full retries after the initial attempt on deadlock or
lock-wait timeout; the whole callback runs again. Keep email, payment-provider,
and other external side effects outside the callback or make them repeat-safe.

## Express middleware

Install Express separately before using these exports.

### JWT authentication

`authenticateJwt({ secret, optional?, tokenExtractor? })` validates a bearer
token and sets `req.user`. A custom extractor can read a token from another
location. `optional: true` allows requests without a token and continues even
when token verification throws, so use it only when that behavior is intended.

```typescript
import express from 'express';
import { authenticateJwt } from 'mysql-craft/middleware';

const app = express();
app.get(
  '/api/me',
  authenticateJwt({ secret: process.env.JWT_ACCESS_SECRET! }),
  (req, res) => {
    res.json({ id: req.user?.sub, role: req.user?.role });
  }
);
```

### Role checks

`requireRole(...allowedRoles)` returns middleware that requires `req.user` and
allows the request only when its `role` matches one of the supplied values.
Mount authentication before role checks:

```typescript
import { authenticateJwt, requireRole } from 'mysql-craft/middleware';

app.delete(
  '/api/customers/:id',
  authenticateJwt({ secret: process.env.JWT_ACCESS_SECRET! }),
  requireRole('admin', 'support'),
  deleteCustomerHandler
);
```

Without an authenticated user, `requireRole` forwards an unauthorized
`AuthError`. A logged-in user with no matching role receives a forbidden error.

### Request body validation

`validateBody(validator)` calls your validator with `req.body`. Return
`{ valid: false, errors }` to forward a `ValidationError`; otherwise call
`next()`.

```typescript
import { validateBody } from 'mysql-craft/middleware';

app.post(
  '/api/orders',
  validateBody((body) => {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { valid: false, errors: ['Expected an order object.'] };
    }

    const order = body as Record<string, unknown>;
    const errors: Record<string, string> = {};
    if (typeof order.customer_id !== 'number') {
      errors.customer_id = 'Choose a customer.';
    }
    if (typeof order.total_cents !== 'number' || order.total_cents < 0) {
      errors.total_cents = 'Enter a non-negative amount in cents.';
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }),
  createOrderHandler
);
```

The validator can call a schema library such as Zod, Joi, or Yup, but this
middleware does not depend on those packages or convert their result formats
automatically.

### Central error handling

Place `errorMiddleware` after routes and other middleware:

```typescript
import { errorMiddleware } from 'mysql-craft/middleware';

app.use(errorMiddleware);
```

For library `AppError` instances it returns:

```json
{
  "success": false,
  "error": {
    "name": "ValidationError",
    "code": "VALIDATION_ERROR",
    "message": "Request payload validation failed.",
    "details": {
      "email": "Enter a valid email address."
    }
  }
}
```

The HTTP status comes from the error's `statusCode`. Unknown errors are logged
with `console.error` and returned as HTTP 500. In production, the response
message is the generic `An unexpected error occurred.`; outside production it
uses the original error message.

## Package exports

These are the supported package entry points. Type declarations are published
for each entry point.

| Import | Main exports |
| --- | --- |
| `mysql-craft` | Database, query helpers, security, errors, middleware, encoding, and SSL helpers. |
| `mysql-craft/core` | Database and transaction clients, query builders, instrumentation, and native helpers. |
| `mysql-craft/security` | `Security` and JWT payload/token types. |
| `mysql-craft/middleware` | Express authentication, role, validation, and error middleware. |
| `mysql-craft/errors` | `AppError`, `DatabaseError`, `PoolExhaustedError`, `AuthError`, and `ValidationError`. |

```typescript
import { createDbClient, Security } from 'mysql-craft';
import { Database, buildSelectQuery } from 'mysql-craft/core';
import { authenticateJwt } from 'mysql-craft/middleware';
import { DatabaseError } from 'mysql-craft/errors';
```

## TypeScript and API errors

The package ships declaration files generated by its build. Generics such as
`db.query<OrderRow>()` and `db.select<OrderRow>()` type the returned values but
do not validate database data.

The Express request declaration adds optional
`req.user: BaseTokenPayload & Record<string, any>`. The token payload includes a
required `sub: string | number` and optional `email` and `role`.

All exported application errors inherit from `AppError`:

| Error | Status | Default code / behavior |
| --- | --- | --- |
| `DatabaseError` | `500` | Uses the mysql2 error code when supplied; otherwise `DATABASE_ERROR`. Includes optional SQL metadata. |
| `PoolExhaustedError` | `503` | `POOL_EXHAUSTED`; default message says the pool is exhausted and the server cannot handle the request. |
| `AuthError` | `401` or `403` | Static constructors include `unauthorized`, `invalidToken`, `tokenExpired`, `forbidden`, and `invalidCredentials`. |
| `ValidationError` | `400` | `VALIDATION_ERROR`; optional validation details are available through `details`. |

`DatabaseError` wraps query failures and failed transactions. Transaction
failures that are not already `DatabaseError` use a message beginning
`Transaction failed:` and default to code `TRANSACTION_FAILED` when the
underlying error has no code. Empty insert/update-builder inputs also raise
`DatabaseError`. Invalid SQL identifiers raise `ValidationError`.

## Development and license

The library repository uses:

```bash
npm install
npm run typecheck
npm test
npm run build
```

The package is published under the MIT License. See the
[library repository](https://github.com/ind-prince/mysql-craft) for the license
file and development history.
