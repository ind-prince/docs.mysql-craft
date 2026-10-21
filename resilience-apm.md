# Resilience, pool management, and instrumentation

`mysql-craft` uses a bounded mysql2 connection pool, can retry selected
transient failures, and exposes health and instrumentation hooks. These
features help an application respond to database pressure, but they do not
replace server-level limits, request timeouts, or operational monitoring.

## Bounded connection pooling

The defaults are 10 connections and a queue limit of 10 times the connection
limit. With those defaults, up to 100 requests may wait for a connection.
Configure both values to fit the capacity of your MySQL server and the amount of
work your application can safely queue:

```typescript
import { createDbClient } from 'mysql-craft';

const db = createDbClient({
  host: process.env.DB_HOST ?? 'localhost',
  user: process.env.DB_USER ?? 'shop_app',
  password: process.env.DB_PASSWORD ?? '',
  database: 'shop',
  connectionLimit: 12,
  queueLimit: 48
});
```

When mysql2 reports one of the pool saturation conditions recognized by the
client, operations reject with `PoolExhaustedError` (status code 503). The
library does not itself send an HTTP response. In Express, the library's
`errorMiddleware` serializes that error using its status code.

`getPoolMetrics()` returns `totalConnections`, `activeConnections`,
`idleConnections`, and `queuedRequests`. These values are read from mysql2
internal pool fields. In the current implementation,
`activeConnections` is based on mysql2's `_acquiringConnections` list, so do
not assume it is a count of every checked-out connection. Treat the values as
operational hints, not a stable driver-independent metric contract.

## Retry policy

The default query retry settings are three retries, a 200ms base delay, a
3000ms maximum delay, and full jitter. The code recognizes deadlock
(`ER_LOCK_DEADLOCK` or `1213`), lock-wait timeout
(`ER_LOCK_WAIT_TIMEOUT` or `1205`), and transient network codes such as
`ECONNRESET`, `ETIMEDOUT`, and `PROTOCOL_CONNECTION_LOST`.

Reads can retry on recognized transient network failures. Writes can retry on
those network failures only when called with `{ idempotent: true }`. Deadlocks
and lock-wait timeouts can retry regardless of operation type. A configured
`maxAttempts: 3` means three retries after the first execution, so there may be
four total executions.

```typescript
const db = createDbClient({
  host: process.env.DB_HOST ?? 'localhost',
  user: process.env.DB_USER ?? 'shop_app',
  database: 'shop',
  retryPolicy: {
    maxAttempts: 3,
    baseDelayMs: 150,
    maxDelayMs: 2500
  }
});

const customer = await db.queryOne(
  'SELECT id, email FROM customers WHERE id = ? LIMIT 1',
  [42]
);
```

The backoff delay is a random value between zero and the capped exponential
delay. The `jitter` property exists in the public retry type, but the current
implementation always applies full jitter and does not read that property.

Transactions use separate `retries` and `retryDelayMs` options. Their default
allows three deadlock retries after the initial callback execution, and each
retry re-runs the entire transaction callback. Keep external side effects
outside retryable callbacks unless they are safe to repeat.

## Health checks

`liveness()` returns `{ alive, uptimeSeconds }`. `alive` becomes false after
`drain()` starts. `readiness()` runs `SELECT 1` and returns a `ready` flag, its
latency in milliseconds, a pool snapshot, and an optional error string.

`healthCheck()` combines those results. It returns `healthy` when readiness
succeeds without a queue or latency concern, `degraded` when there are queued
requests or latency exceeds 250ms, and `unhealthy` when readiness fails.
Current implementation detail: the overall `status` is based on readiness and
does not include the `liveness.alive` value, so a draining client can still
report `healthy` if readiness succeeds.

```typescript
import express from 'express';
import { createDbClient } from 'mysql-craft';

const app = express();
const db = createDbClient({
  host: process.env.DB_HOST ?? 'localhost',
  user: process.env.DB_USER ?? 'shop_app',
  database: 'shop'
});

app.get('/healthz/live', (_req, res) => {
  const result = db.liveness();
  res.status(result.alive ? 200 : 503).json(result);
});

app.get('/healthz/ready', async (_req, res) => {
  const result = await db.readiness();
  res.status(result.ready ? 200 : 503).json(result);
});

app.get('/health', async (_req, res) => {
  const result = await db.healthCheck();
  res.status(result.status === 'healthy' ? 200 : 503).json(result);
});
```

An example healthy result has this shape:

```json
{
  "status": "healthy",
  "timestamp": "2026-10-21T04:30:00.000Z",
  "liveness": {
    "alive": true,
    "uptimeSeconds": 3600
  },
  "readiness": {
    "ready": true,
    "latencyMs": 1.15,
    "pool": {
      "totalConnections": 12,
      "activeConnections": 1,
      "idleConnections": 11,
      "queuedRequests": 0
    }
  }
}
```

The pool values are illustrative. The `activeConnections` caveat above applies
to this response too.

## Graceful shutdown

`drain(timeoutMs = 5000)` marks the client as draining, rejects new queries
through the `Database` client, and races `pool.end()` against a timeout. Use it
when shutting down a server:

```typescript
async function shutdown(): Promise<void> {
  await db.drain(5000);
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
```

The current implementation logs and swallows timeout or pool-end errors, so
`drain()` resolves even if the wait fails. A timed-out `pool.end()` is not
cancelled. `close()` calls `pool.end()` directly and propagates its rejection.
Avoid calling `process.exit()` before the pool has had a chance to finish.

## Terminal query logging

Set `debug: true` to add the terminal logger, or pass a logger options object:

```typescript
const db = createDbClient({
  host: process.env.DB_HOST ?? 'localhost',
  user: process.env.DB_USER ?? 'shop_app',
  database: 'shop',
  debug: {
    slowThresholdMs: 400,
    maxSqlLength: 1000,
    maskSensitive: true,
    sensitiveKeys: ['customer_email']
  }
});
```

The logger prints a query, its duration, sanitized parameters, and row count
when available. It marks events at or above `slowThresholdMs` as slow. Duration
badges are fast below 50ms, moderate from 50ms to under 200ms, and slow at
200ms or longer. SQL text is shortened after `maxSqlLength` characters, which
defaults to 1000.

Sensitive parameter masking is enabled by default. The sanitizer matches
property names case-insensitively against `password`, `passwd`,
`password_hash`, `secret`, `token`, `refreshtoken`, `accesstoken`, `jwt`,
`credit_card`, `card_number`, `cvv`, `hash`, `salt`, and `authorization`.
Additional exact property names can be added through `sensitiveKeys`. Strings
longer than 250 characters are shortened; `Buffer` values are displayed as
`<Buffer len=...>`.

The sanitizer can inspect object properties and nested arrays/objects. A
standalone string parameter has no property name to match, so treat query
parameters as sensitive unless you have checked what the logger will emit.
Disabling masking can expose credentials.

## Custom instrumentation

Pass one listener or an array of `Instrumentation` listeners in the database
configuration. Each callback is optional:

```typescript
const db = createDbClient({
  host: process.env.DB_HOST ?? 'localhost',
  user: process.env.DB_USER ?? 'shop_app',
  database: 'shop',
  instrumentation: {
    onQuery(event) {
      metrics.observe('mysql.query.duration_ms', event.durationMs, {
        query: event.sql
      });
    },
    onError(event) {
      logger.error('MySQL operation failed', {
        message: event.error.message,
        code: event.error.code
      });
    },
    onRetry(event) {
      metrics.increment('mysql.retry', { type: event.operationType });
    },
    onTransaction(action, connectionId) {
      logger.info('MySQL transaction', { action, connectionId });
    }
  }
});
```

Event types are:

| Callback | Data |
| --- | --- |
| `onQuery(event)` | `sql`, raw `params`, `durationMs`, optional `rowCount`, `connectionId`, and `isSlow`. |
| `onError(event)` | Original `error`, optional `sql` and `params`, and optional `durationMs`. |
| `onRetry(event)` | Retry number, configured retry count, delay, error, deadlock flag, and operation type (`read`, `write`, or `transaction`). |
| `onTransaction(action, connectionId?)` | `START`, `COMMIT`, or `ROLLBACK`, plus an optional connection id. |
| `onPoolMetrics(metrics)` | Pool metric shape; the callback is declared but is not currently invoked by the database client. |

Unlike the terminal logger, custom listeners receive the original parameters.
Avoid storing or exporting secrets in telemetry. `InstrumentationManager`
broadcasts events to registered listeners and logs listener exceptions without
failing the database operation.

The exported `Logger` class remains as a compatibility wrapper around
`TerminalLoggerInstrumentation`; its `logQuery`, `logTransaction`, and
`logError` methods can be used when an application previously created a logger
directly.
