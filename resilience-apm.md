## 🌊 Resilience, Pool Management & Health Checks

### Bounded Connection Pooling & Fail-Fast 503

In standard `mysql2`, connection queues are unbounded by default (`queueLimit: 0`). When high traffic spikes exceed database capacity, requests pile up in Node.js memory indefinitely until the process crashes with an Out Of Memory (OOM) error.

`@mysql-craft` enforces **bounded connection pooling**:
- Default `connectionLimit`: `10`
- Default `queueLimit`: `connectionLimit * 10` (e.g., 100 queued requests)
- When the queue limit is reached, incoming requests fail fast with **`PoolExhaustedError`** (HTTP 503 Service Unavailable), preserving server stability and allowing upstream load balancers to shed load gracefully.

```typescript
const db = createDbClient({
  connectionLimit: 20, // 20 concurrent database connections
  queueLimit: 200      // Max 200 waiting queries before failing fast with HTTP 503
});
```

### Exponential Backoff with Full Jitter

Transient read queries (SELECT) and deadlocks are retried using AWS-recommended **Full Jitter** to prevent the "thundering herd" problem:

$$\text{Sleep} = \text{random}(0, \min(\text{maxDelay}, \text{baseDelay} \times 2^{\text{attempt}-1}))$$

```typescript
const db = createDbClient({
  retryPolicy: {
    maxAttempts: 3,     // Try up to 3 times
    baseDelayMs: 200,   // Initial delay 200ms
    maxDelayMs: 3000,   // Max delay cap 3s
    jitter: true        // Distribute uniformly across [0, exponential]
  }
});
```

### Kubernetes Liveness, Readiness & Health Checks

Easily wire up Kubernetes or Docker health probes:

```typescript
// 1. Process Liveness Probe (/healthz/live)
app.get('/healthz/live', (req, res) => {
  const live = db.liveness();
  res.status(live.alive ? 200 : 503).json(live);
});

// 2. Database Readiness Probe (/healthz/ready)
app.get('/healthz/ready', async (req, res) => {
  const ready = await db.readiness();
  res.status(ready.ready ? 200 : 503).json(ready);
});

// 3. Combined Health Endpoint (/health)
app.get('/health', async (req, res) => {
  const health = await db.healthCheck();
  res.status(health.status === 'healthy' ? 200 : 503).json(health);
});
```

Example `/health` response:
```json
{
  "status": "healthy",
  "timestamp": "2026-10-19T01:24:00.000Z",
  "liveness": {
    "alive": true,
    "uptimeSeconds": 3600
  },
  "readiness": {
    "ready": true,
    "latencyMs": 1.15,
    "pool": {
      "totalConnections": 15,
      "activeConnections": 2,
      "idleConnections": 13,
      "queuedRequests": 0
    }
  }
}
```

### Graceful Shutdown (Drain)

Ensure no ongoing queries are aborted during deployments or server shutdowns:

```typescript
async function shutdown() {
  console.log('Received termination signal. Draining database pool...');
  // Rejects new queries immediately, waits up to 5s for in-flight queries to finish
  await db.drain(5000);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

---

## 🎨 Visual Diagnostics, Masking & Instrumentation

### Colorized SQL Terminal Logger

When `debug: true` is enabled, queries are logged with syntax-highlighted SQL, execution latencies, and execution badges:

```text
[MYSQL] 11:34:20 AM  ⚡ 1.25ms
  SQL:    SELECT * FROM `account` WHERE `email` = ? LIMIT 1
  Params: ["alex@company.com"]
  Result: 1 row(s)

[TX:START] 11:34:20 AM [Conn #14] Transaction started.
[MYSQL] 11:34:20 AM  ⚡ 2.45ms
  SQL:    INSERT INTO `account` (`email`, `password_hash`) VALUES (?, ?)
  Params: ["alex@company.com", "********"]
  Result: 1 row(s)
[TX:COMMIT] 11:34:20 AM [Conn #14] Transaction committed.
```

- **⚡ Fast Query Badge:** Queries completing in `< 50ms`.
- **⏱ Moderate Query Badge:** Queries completing in `50ms - 200ms`.
- **🐢 Slow Query Badge:** Queries exceeding `200ms` (or custom `slowQueryThresholdMs`).

### Automatic Credential Masking

The built-in `ParameterSanitizer` automatically inspects all logged query parameters. Any object key matching sensitive patterns (`password`, `passwd`, `password_hash`, `secret`, `token`, `accesstoken`, `refreshtoken`, `jwt`, `credit_card`, `card_number`, `cvv`, `hash`, `salt`, `authorization`) is masked with `********`. Large strings (`>250` chars) and binary `Buffer` payloads are safely truncated to protect terminal performance.

### Custom Telemetry & APM Integration

Broadcast database events directly to OpenTelemetry, Datadog, or Prometheus:

```typescript
const db = createDbClient({
  host: 'localhost',
  // ...db credentials,
  instrumentation: {
    onQuery: (event) => {
      metrics.histogram('db.query.duration_ms', event.durationMs, { sql: event.sql });
    },
    onError: (event) => {
      logger.error('Database query error', { sql: event.sql, error: event.error });
    },
    onRetry: (event) => {
      metrics.increment('db.retries.total', { isDeadlock: String(event.isDeadlock) });
    },
    onTransaction: (action, connectionId) => {
      logger.info(`Transaction ${action} on connection ${connectionId}`);
    },
    onPoolMetrics: (metrics) => {
      gauge('db.pool.active', metrics.activeConnections);
      gauge('db.pool.queued', metrics.queuedRequests);
    }
  }
});
```

---
