# API reference

The root package exports the main client, query helpers, security utilities,
middleware, errors, and native helpers. `mysql-craft/core`, `mysql-craft/security`,
`mysql-craft/middleware`, and `mysql-craft/errors` expose those areas separately.
See [package exports](/advanced-configuration#package-exports) for the complete
map.

## Creating a client

```typescript
import { Database, createDbClient } from 'mysql-craft';

const db = createDbClient({
  host: 'localhost',
  user: 'shop_app',
  password: process.env.DB_PASSWORD ?? '',
  database: 'shop'
});
```

`createDbClient(config)` is synchronous and returns `Database`. It passes
standard connection options to `mysql2/promise`. `new Database(config)` is
equivalent.

Use the asynchronous static factory to resolve optional AWS RDS certificates:

```typescript
const rdsDb = await Database.create({
  host: process.env.DB_HOST!,
  user: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  database: 'shop',
  useAwsRds: true
});
```

`Database.create(config)` returns `Promise<Database>`. It dynamically loads
`aws-ssl-profiles` only when `useAwsRds` is true. The package must be installed
for that option. With `useAwsRds` omitted or false, it returns a client without
adding an AWS profile.

## Query methods

`Database` and `Transaction` inherit all methods in this section from
`BaseClient`. Query methods accept `params: any[] = []` and an optional
`QueryExecutionOptions` object, `{ idempotent?: boolean }`.

### `query<T>(sql, params?, options?)`

Runs a parameterized query and returns `Promise<T[]>`. The generic describes
your expected row shape; it is not schema validation. MySQL errors from this
operation are wrapped in `DatabaseError`.

```typescript
interface CustomerOrder {
  id: number;
  customer_email: string;
  total_cents: number;
}

const orders = await db.query<CustomerOrder>(
  `SELECT o.id, c.email AS customer_email, o.total_cents
   FROM orders AS o
   JOIN customers AS c ON c.id = o.customer_id
   WHERE o.status = ?
   ORDER BY o.id DESC
   LIMIT ?`,
  ['paid', 20]
);
```

Use `query()` for joins, aggregates, and SQL features not modeled by the
structured builders. Keep values in the parameter array. Parameters cannot
stand in for table or column names.

### `queryOne<T>(sql, params?, options?)`

Runs the query and returns its first row or `null` when no rows are returned.
The SQL itself is not automatically limited to one row; add `LIMIT 1` if that
is the intended query.

```typescript
const customer = await db.queryOne<{ id: number; email: string }>(
  'SELECT id, email FROM customers WHERE email = ? LIMIT 1',
  ['maya@example.com']
);
```

### `execute(sql, params?, options?)`

Runs a prepared mutation with mysql2 `execute()` and returns its
`ResultSetHeader`. This is useful when you need driver fields beyond the
library’s simplified result:

```typescript
const result = await db.execute(
  'UPDATE orders SET status = ? WHERE id = ?',
  ['shipped', 1042]
);
console.log(result.affectedRows);
```

The method does not restrict the SQL text to mutations; use it for prepared
statements supported by mysql2. Database failures are wrapped in
`DatabaseError`.

### `insert<TRecord>(table, records, options?)`

Accepts one record or an array of records and returns
`Promise<InsertResult>` (`{ insertId: number, affectedRows: number }`). The
helper escapes table and column identifiers and binds record values.

```typescript
const result = await db.insert('orders', {
  customer_id: 42,
  status: 'pending',
  total_cents: 8900
});
console.log(`Created order ${result.insertId}`);
```

For a bulk insert, use records with the same columns. The current builder uses
the first record’s keys for every row; missing values in later records become
`NULL`, and additional keys in later records are ignored.

```typescript
const result = await db.insert('order_items', [
  { order_id: 1042, product_id: 7, quantity: 2 },
  { order_id: 1042, product_id: 9, quantity: 1 }
]);
console.log(`Inserted ${result.affectedRows} order items.`);
```

An empty record array returns `{ insertId: 0, affectedRows: 0 }` without
querying the database. A record with no keys causes a `DatabaseError` in the
SQL builder.

### `update<TData>(table, data, whereClause, whereParams?, options?)`

Updates columns from `data` and returns
`Promise<UpdateResult>` (`{ affectedRows, changedRows }`). Column names are
escaped; values and `whereParams` are bound. `whereClause` is inserted into the
SQL as written, so keep it as trusted SQL and never interpolate user input.

```typescript
const result = await db.update(
  'orders',
  { status: 'paid' },
  '`id` = ? AND `customer_id` = ?',
  [1042, 42]
);
console.log(`Changed ${result.changedRows} row(s).`);
```

The current helper requires at least one key in `data`; an empty object produces
a `DatabaseError`.

### `delete(table, whereClause, whereParams?, options?)`

Deletes matching rows and returns `Promise<DeleteResult>` (`{ affectedRows }`).
As with `update`, the where-clause text is trusted SQL and its values should be
bound:

```typescript
const result = await db.delete('orders', '`id` = ?', [1042]);
console.log(`Deleted ${result.affectedRows} row(s).`);
```

The helper does not add safety checks for an empty or overly broad where
clause. Build the clause in application code and require a specific condition
before calling it.

## Structured query helpers

### `select<T>(options, queryOpts?)`

Returns `Promise<T[]>`. `SelectQueryOptions` contains:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `table` | `string` | required | Table name. |
| `fields` | `string[]` | `undefined` | Projected columns; omitted or empty means `*`. |
| `where` | `Record<string, any> \| WhereCondition[]` | `undefined` | Equality filters or explicit conditions. |
| `search` | `{ fields: string[]; term: string }` | `undefined` | Adds a parameterized `%term%` `LIKE` across the fields. |
| `orderBy` | `OrderByCondition[]` | `undefined` | Ordered columns and `ASC`/`DESC` direction. |
| `limit` | `number` | `undefined` | Adds a bound `LIMIT`. |
| `offset` | `number` | `undefined` | Adds a bound `OFFSET` only when `limit` is provided. |

Object filters use `=`, except `null` becomes `IS NULL` and `undefined` is
skipped. A condition array supports operators `=`, `!=`, `<>`, `>`, `>=`, `<`,
`<=`, `LIKE`, `IN`, `IS NULL`, and `IS NOT NULL`. `IN` values are bound
individually; an empty list becomes `1 = 0`. Null operators do not need a
`value`. `WhereCondition.operator` is a TypeScript union, but the builder does
not validate the operator at runtime. Choose operators from a fixed
server-controlled allowlist; never copy an operator string directly from
request input.

```typescript
const paidOrders = await db.select<{
  id: number;
  customer_id: number;
  total_cents: number;
}>({
  table: 'orders',
  fields: ['id', 'customer_id', 'total_cents'],
  where: [
    { column: 'status', operator: 'IN', value: ['paid', 'shipped'] },
    { column: 'total_cents', operator: '>=', value: 5000 }
  ],
  orderBy: [{ column: 'id', direction: 'DESC' }],
  limit: 25,
  offset: 0
});
```

### `count(options, queryOpts?)`

Accepts the same table, filter, and search options as `select()` except fields,
sort, and pagination. Returns `Promise<number>`.

```typescript
const openOrderCount = await db.count({
  table: 'orders',
  where: { status: 'open', customer_id: 42 }
});
```

### `paginate<T>(table, queryParams, queryOpts?)`

Takes a table name and `ParsedQueryParams`, usually produced by
`parseQueryParams()`. It first counts matching records and then fetches the
requested page. It returns:

```typescript
interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
```

`totalPages` is at least 1, including when there are no records. `hasNext` and
`hasPrev` are calculated from `page` and `totalPages`.

```typescript
import { parseQueryParams } from 'mysql-craft';

const params = parseQueryParams(
  { page: '2', limit: '15', status: 'paid' },
  { allowedFields: ['id', 'status', 'customer_id'] }
);
const page = await db.paginate<{ id: number; status: string }>('orders', params);
```

## Transactions

### `transaction<T>(action, options?)`

Runs `action(trx)` on one acquired pool connection and returns
`Promise<T>`. The callback’s result is returned after commit. Errors cause a
rollback and are rethrown as a `DatabaseError` unless they are already a
`DatabaseError` or a retryable deadlock is retried.

`TransactionOptions` accepts `retries?: number` (default `3`) and
`retryDelayMs?: number` (default `200`). These are retry counts after the first
execution: up to four executions are possible with the default. Retries apply
to deadlock (`1213`) and lock-wait timeout (`1205`) errors only. Backoff uses
full jitter and caps at 3000ms.

```typescript
await db.transaction(async (trx) => {
  const stock = await trx.queryOne<{ quantity: number }>(
    'SELECT quantity FROM inventory WHERE product_id = ? FOR UPDATE',
    [7]
  );
  if (!stock || stock.quantity < 2) {
    throw new Error('Not enough stock for this order.');
  }

  await trx.update('inventory', { quantity: stock.quantity - 2 }, '`product_id` = ?', [7]);
  await trx.insert('order_items', { order_id: 1042, product_id: 7, quantity: 2 });
}, { retries: 3, retryDelayMs: 200 });
```

The transaction can be re-executed after a deadlock. Keep external side effects
out of the callback or make them safe to repeat.

## Query and retry behavior

`QueryExecutionOptions` is `{ idempotent?: boolean }`. Network errors such as
connection loss or reset are retried for `query()` reads. A write is retried
for those network errors only when `idempotent: true`; deadlocks and lock-wait
timeouts are retried regardless. With the default `maxAttempts: 3`, the
implementation can retry three times after the first execution (four total
executions).

The client-level `retryPolicy` defaults are `maxAttempts: 3`,
`baseDelayMs: 200`, `maxDelayMs: 3000`, and `jitter: true`. The implementation
uses full jitter for retry delays. The `jitter` option is currently part of the
type but is not consulted by the delay calculation.

```typescript
await db.execute(
  'UPDATE order_jobs SET claimed = 1 WHERE id = ? AND claimed = 0',
  [17],
  { idempotent: true }
);
```

Only mark an operation idempotent when repeating it cannot cause an incorrect
result. Pool exhaustion is raised as `PoolExhaustedError` instead of being
retried.

## Database lifecycle

| Method | Return type | Behavior |
| --- | --- | --- |
| `getPoolMetrics()` | `PoolMetrics` | Returns `totalConnections`, `activeConnections`, `idleConnections`, and `queuedRequests`. |
| `getPool()` | `mysql2/promise.Pool` | Returns the underlying pool for driver features not wrapped by this library. |
| `liveness()` | `{ alive: boolean; uptimeSeconds: number }` | Reports whether the client is draining and its process uptime. |
| `readiness()` | `Promise<{ ready; latencyMs; pool; error? }>` | Runs `SELECT 1` and includes a pool snapshot. Connection failures are returned in `error`. |
| `healthCheck()` | `Promise<HealthCheckResult>` | Combines liveness and readiness with `healthy`, `degraded`, or `unhealthy` status. |
| `drain(timeoutMs = 5000)` | `Promise<void>` | Marks the client draining and waits for `pool.end()` or the timeout. Errors are logged and swallowed. |
| `close()` | `Promise<void>` | Calls `pool.end()` and propagates its rejection. |
| `createResourceRouter(table, options?)` | `express.Router` | Builds a single-table Express router. In Node.js ESM, use the CommonJS bridge described in [CRUD engine](/crud-engine#mount-a-router) until the lazy Express loader is fixed. |

The same router factory is also exported as
`createResourceRouter(client, table, options?)` from the root and core entry
points. It takes a `BaseClient` instance and the same options described in the
[CRUD guide](/crud-engine#configuration-reference). It returns an Express
router and has the same ESM loader limitation as the instance method.

After `drain()` starts, calls through the regular client reject with
`DatabaseError` stating that the pool is draining. `close()` does not set that
flag; use it to end the pool when the application is ready to stop.

## SQL builders and URL parser

The pure helpers are exported from the root and `mysql-craft/core`:

```typescript
import {
  escapeIdentifier,
  buildSelectQuery,
  buildCountQuery,
  buildInsertQuery,
  buildUpdateQuery,
  buildDeleteQuery,
  parseQueryParams
} from 'mysql-craft/core';
```

Each builder returns `{ sql, params }` without connecting to MySQL.
`escapeIdentifier('order_items')` returns `` `order_items` ``; a dotted name such
as `customers.id` becomes `` `customers`.`id` ``. Invalid identifiers throw
`ValidationError`.

```typescript
const built = buildSelectQuery({
  table: 'orders',
  fields: ['id', 'status'],
  where: { customer_id: 42 },
  orderBy: [{ column: 'id', direction: 'DESC' }],
  limit: 10
});
// built.sql: SELECT `id`, `status` FROM `orders` WHERE `customer_id` = ? ORDER BY `id` DESC LIMIT ?
// built.params: [42, 10]
```

The other builders use the same `{ sql, params }` shape:

```typescript
const countSql = buildCountQuery({
  table: 'orders',
  where: { status: 'paid' }
});

const insertSql = buildInsertQuery('order_events', [
  { order_id: 1042, event_type: 'paid' },
  { order_id: 1043, event_type: 'paid' }
]);

const updateSql = buildUpdateQuery(
  'orders',
  { status: 'shipped' },
  '`id` = ?',
  [1042]
);

const deleteSql = buildDeleteQuery('order_events', '`order_id` = ?', [1042]);
```

`buildInsertQuery(table, records)` requires at least one record and at least one
key. `buildUpdateQuery(table, data, whereClause, whereParams?)` requires
non-empty data. As with the client mutation methods, the where-clause string is
trusted SQL. `buildDeleteQuery(table, whereClause, whereParams?)` does not
validate that the where clause is safe or restrictive.

`parseQueryParams(rawQuery = {}, options = {})` returns `ParsedQueryParams` with
`page`, `limit`, `offset`, `filters`, and optional `fields`, `orderBy`, and
`search`. Its options are `allowedFields`, `searchableFields`, `defaultLimit`,
`maxLimit`, and `defaultSort`. Page defaults to 1, limit to 20, and maximum
limit to 100. Fields, sort, search, and exact filter values are trimmed or
filtered as described in the [resource router guide](/crud-engine#pagination-search-sorting-and-filters).

## Security API

`Security` is exported from the root and `mysql-craft/security`. It provides:

| Method | Signature | Return / behavior |
| --- | --- | --- |
| `hashPassword` | `(password: string, costOrSalt?: number \| string)` | `Promise<string>` in `scrypt:<salt>:<hexKey>` format. Rejects empty/non-string input and strings longer than 1024 characters. |
| `verifyPassword` | `(password: string, hash: string)` | `Promise<boolean>`; verifies scrypt hashes and returns false for other formats. |
| `generateToken` | `<T extends object>(payload, secret, options?)` | Signed JWT string; default signing expiration is `1h`. Missing secret throws `AuthError` with status 500 and code `AUTH_CONFIG_ERROR`. |
| `verifyToken` | `<T = BaseTokenPayload>(token, secret, options?)` | Decoded payload; missing, invalid, or expired tokens throw `AuthError`. |
| `generateTokenPair` | `(accessPayload, refreshPayload, config)` | Access and refresh token strings, default expirations `15m` and `7d`, `tokenType: 'Bearer'`. |
| `generateSecureToken` | `(byteLength = 32)` | Cryptographically random hex string, normally 64 characters. |
| `sanitizeUser` | `(user, extraFieldsToStrip = [])` | Shallow copy without `password`, `passwd`, `password_hash`, `hash`, `salt`, or extra named fields. |

The `costOrSalt` argument is retained in the signature, but the current scrypt
implementation uses a supplied string as the salt and ignores a numeric value.
See the [migration guide](/migration#password-hash-migration) before upgrading
from bcrypt hashes.

## Middleware, errors, and native utilities

Middleware exports from `mysql-craft/middleware` are `authenticateJwt(options)`,
`requireRole(...roles)`, `validateBody(validator)`, and `errorMiddleware`.
`authenticateJwt` sets `req.user`; optional mode allows missing tokens and also
continues on token verification errors. `validateBody` expects a validator
returning `{ valid: boolean, errors?: Record<string, string> | string[] }`.
`errorMiddleware` serializes `AppError` values and logs unknown errors before
returning HTTP 500. See [security and authentication](/security-auth) for
details.

The root and `mysql-craft/errors` export:

| Error | Status / code | Notes |
| --- | --- | --- |
| `AppError` | Abstract base | Includes `isOperational`, `timestamp`, `toJSON()`, and optional `details`. |
| `DatabaseError` | `500`; underlying code or `DATABASE_ERROR` | May include `sql`, `sqlState`, `errno`, and `sqlMessage`. |
| `PoolExhaustedError` | `503`; `POOL_EXHAUSTED` | Pool queue has reached its configured limit. |
| `AuthError` | Usually `401` or `403` | Static constructors include `unauthorized`, `invalidToken`, `tokenExpired`, `forbidden`, and `invalidCredentials`. |
| `ValidationError` | `400`; `VALIDATION_ERROR` | `details` contains validation errors when supplied. |

`DatabaseError` wraps query failures and failed transactions. Transaction
failures that are not already `DatabaseError` use a message beginning
`Transaction failed:` and default to code `TRANSACTION_FAILED` when the
underlying error has no code. Empty insert/update-builder inputs also raise
`DatabaseError`. Invalid SQL identifiers throw `ValidationError`.

Other useful implementation messages include:

- An empty or non-string identifier produces `Database identifier must be a non-empty string.`
- An invalid identifier reports its value and that only letters, digits, and underscores are allowed.
- A database client that is draining rejects a new query with `Database pool is currently draining and cannot accept new queries.`
- Enabling `auth: true` on a resource router without `JWT_SECRET` or `JWT_ACCESS_SECRET` throws `JWT_SECRET or JWT_ACCESS_SECRET must be set when auth: true is enabled.`
- Setting `useAwsRds: true` without the optional dependency throws `The "aws-ssl-profiles" package is required for AWS RDS TLS. Run: npm install aws-ssl-profiles`

The package does not add new error classes in 1.2.0; the classes and status
codes listed above are the current exported hierarchy.

Native helpers exported from root and core are `safeDecodeBuffer(buffer:
Buffer | Uint8Array): string` and `safeEncodeString(value: string): Uint8Array`.
They use UTF-8 `TextDecoder` and `TextEncoder`; empty inputs return an empty
string or byte array. `applySecureSSLProfile(config)` asynchronously adds the
AWS RDS profile when `useAwsRds` is true.

```typescript
import { safeDecodeBuffer, safeEncodeString } from 'mysql-craft/core';

const encoded = safeEncodeString('Order #1042 – paid');
const decoded = safeDecodeBuffer(encoded);
console.log(decoded); // Order #1042 – paid
```

## Logging and instrumentation types

The core entry point exports `Logger`, `TerminalLoggerInstrumentation`,
`InstrumentationManager`, and `ParameterSanitizer`.

| API | Parameters and return |
| --- | --- |
| `new Logger(options?)` | `options` is a boolean or `LoggerConfig`; defaults to the terminal logger settings. The boolean overload does not disable logging when passed `false`; use `DatabaseConfig.debug: false` to disable the database logger. |
| `Logger.logQuery(sql, params?, durationMs, rowsAffectedOrCount?)` | Logs one query; returns `void`. |
| `Logger.logTransaction(action, connectionId?)` | `action` is `START`, `COMMIT`, or `ROLLBACK`; returns `void`. |
| `Logger.logError(error, sql?, params?)` | Logs an error and optional SQL context; returns `void`. |
| `new TerminalLoggerInstrumentation(options?)` | Accepts `slowThresholdMs` (default 500), `maxSqlLength` (default 1000), `maskSensitive` (default true), and `sensitiveKeys`. |
| `TerminalLoggerInstrumentation.onQuery/onError/onRetry/onTransaction(...)` | Implements the matching instrumentation callbacks; each returns `void`. |
| `new InstrumentationManager(initialListeners = [])` | Creates a dispatcher; returns an `InstrumentationManager`. |
| `InstrumentationManager.addListener(listener)` | Adds an `Instrumentation`; returns `void`. |
| `new ParameterSanitizer(options?)` | Accepts `maskSensitive` (default true), `sensitiveKeys`, and `maxStringLength` (default 250). |
| `ParameterSanitizer.sanitize(params)` | Returns a sanitized `unknown[]`; buffers and long strings are represented safely. |

`Instrumentation` callbacks receive query, error, retry, transaction, and pool
metric event data. See [custom instrumentation](/resilience-apm#custom-instrumentation)
for the fields and note that pool-metric callbacks are declared but not
currently invoked by `Database`.

## Public TypeScript types

The package exposes these main types through its root/core and subpath
declarations:

| Group | Public types |
| --- | --- |
| Database | `DatabaseConfig`, `RetryPolicyOptions`, `QueryExecutionOptions`, `TransactionOptions`, `InsertResult`, `UpdateResult`, `DeleteResult`, `PaginatedResult<T>`, `HealthCheckResult`, `DatabaseRow`, and mysql2 `ResultSetHeader`. |
| SQL | `SelectQueryOptions`, `CountQueryOptions`, `WhereCondition`, `OrderByCondition`, `ParsedQueryParams`, and `QueryParseOptions`. |
| Resource router | `ResourceEngineOptions` and `ResourceHooks`. |
| Express middleware | `ExpressAuthOptions`. |
| Security | `BaseTokenPayload`, `TokenGenerationOptions`, `TokenPairResult`, and `TokenVerificationOptions`. |
| Instrumentation | `Instrumentation`, `QueryEvent`, `ErrorEvent`, `RetryEvent`, `PoolMetrics`, `LoggerConfig`, and `MaskingOptions`. |

`DatabaseConfig` extends mysql2 `PoolOptions`; `WhereCondition` describes the
operator set documented under [structured queries](#structured-query-helpers). Type
generics do not add runtime schema checks.

## TypeScript notes

The package includes declaration files for its published exports. Query
generics describe expected results but do not validate returned data, so keep
types aligned with the columns and aliases in the SQL:

```typescript
interface OrderRow {
  order_id: number;
  item_count: number;
}

const rows = await db.query<OrderRow>(
  `SELECT o.id AS order_id, COUNT(oi.id) AS item_count
   FROM orders AS o
   LEFT JOIN order_items AS oi ON oi.order_id = o.id
   WHERE o.customer_id = ?
   GROUP BY o.id`,
  [42]
);
```

Express request types are augmented with optional `req.user`, typed as
`BaseTokenPayload & Record<string, any>`. The payload requires `sub` to be a
string or number; `email` and `role` are optional.
