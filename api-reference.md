## 🛡️ Core Database & Query API

Both the primary `Database` client and scoped `Transaction` objects inherit from `BaseClient`, providing a unified, type-safe query interface.

### 1. Parameterized Queries (`query`, `queryOne`)

Pure parameterized execution prevents SQL injection by strictly segregating SQL statements from user inputs:

```typescript
// Fetch multiple typed rows
const users = await db.query<UserAccount>(
  'SELECT * FROM account WHERE role = ? AND active = ?',
  ['admin', 1]
);

// Fetch a single row or null
const user = await db.queryOne<UserAccount>(
  'SELECT * FROM account WHERE iduser = ? LIMIT 1',
  [42]
);

if (!user) {
  console.log('User not found');
}
```

### 2. High-Level Mutations (`insert`, `update`, `delete`)

Eliminate manual `INSERT INTO ...` string formatting with automated column escaping and value binding:

```typescript
// 1. Single Insert
const insertResult = await db.insert('account', {
  email: 'alex@company.com',
  first_name: 'Alex',
  last_name: 'Rivera',
  password_hash: await Security.hashPassword('Secret123!')
});
console.log(`Created account with ID: ${insertResult.insertId}`);

// 2. High-Performance Bulk Insert
await db.insert('account_profile', [
  { iduser: 1, phone: '555-0100', bio: 'Engineer' },
  { iduser: 2, phone: '555-0101', bio: 'Architect' },
  { iduser: 3, phone: '555-0102', bio: 'Product Lead' }
]);

// 3. Update
const updateResult = await db.update(
  'account',
  { first_name: 'Alexander', role: 'admin' },
  'iduser = ?',
  [1]
);
console.log(`Updated ${updateResult.affectedRows} row(s)`);

// 4. Delete
const deleteResult = await db.delete('account', 'iduser = ?', [10]);
console.log(`Deleted ${deleteResult.affectedRows} row(s)`);
```

### 3. Structured Query Builders (`select`, `count`)

For programmatic query construction with complex conditional logic:

```typescript
// Structured SELECT
const users = await db.select<UserAccount>({
  table: 'account',
  fields: ['iduser', 'email', 'role'],
  where: [
    { column: 'role', operator: 'IN', value: ['admin', 'moderator'] },
    { column: 'deleted_at', operator: 'IS NULL' }
  ],
  orderBy: [{ column: 'created_at', direction: 'DESC' }],
  limit: 10,
  offset: 0
});

// Structured COUNT
const totalAdmins = await db.count({
  table: 'account',
  where: { role: 'admin' }
});
```

---

### Database Methods Reference Table

| Method Signature | Return Type | Description |
| :--- | :--- | :--- |
| `query<T>(sql, params?, options?)` | `Promise<T[]>` | Executes parameterized SELECT with automatic transient retry policies. |
| `queryOne<T>(sql, params?, options?)` | `Promise<T \| null>` | Executes query and returns first element or `null`. |
| `execute(sql, params?, options?)` | `Promise<ResultSetHeader>` | Executes raw mutation query (INSERT, UPDATE, DELETE). |
| `insert(table, records, options?)` | `Promise<InsertResult>` | Inserts single record or batch records with identifier escaping. Returns `{ insertId, affectedRows }`. |
| `update(table, data, where, params?, options?)` | `Promise<UpdateResult>` | Executes parameterized UPDATE. Returns `{ affectedRows, changedRows }`. |
| `delete(table, where, params?, options?)` | `Promise<DeleteResult>` | Executes parameterized DELETE. Returns `{ affectedRows }`. |
| `select<T>(options, queryOpts?)` | `Promise<T[]>` | Programmatic structured SELECT query. |
| `count(options, queryOpts?)` | `Promise<number>` | Programmatic COUNT query matching filters. |
| `paginate<T>(table, queryParams, options?)` | `Promise<PaginatedResult<T>>` | Executes dual count + select queries with pagination metadata. |
| `transaction<T>(action, options?)` | `Promise<T>` | Executes callback inside atomic transaction with deadlock retries. |
| `createResourceRouter(table, options?)` | `Router` | Generates Express CRUD router. |
| `getPoolMetrics()` | `PoolMetrics` | Inspects active, idle, total, and queued pool connections. |
| `liveness()` | `{ alive: boolean, uptimeSeconds: number }` | Verifies process health and uptime. |
| `readiness()` | `Promise<{ ready: boolean, latencyMs: number, pool: PoolMetrics }>` | Executes `SELECT 1` ping and checks queue saturation. |
| `healthCheck()` | `Promise<HealthCheckResult>` | Comprehensive diagnostic combining liveness and readiness. |
| `drain(timeoutMs?)` | `Promise<void>` | Gracefully stops accepting queries and flushes active connections. |
| `close()` | `Promise<void>` | Immediately closes the MySQL connection pool. |

---

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

## 🔨 Pure SQL Builders & Sanitizers

Exported from `@mysql-craft/core`:

```typescript
import {
  escapeIdentifier,
  buildSelectQuery,
  buildInsertQuery,
  buildUpdateQuery,
  buildDeleteQuery,
  buildCountQuery,
  parseQueryParams
} from '@mysql-craft';
```

### Identifier Escaping
Protects table and column names by safely escaping with backticks and strictly rejecting non-alphanumeric characters:

```typescript
escapeIdentifier('users');             // "`users`"
escapeIdentifier('accounts.iduser');   // "`accounts`.`iduser`"
escapeIdentifier('users; DROP TABLE'); // Throws ValidationError
```

### Pure Query Builders
Generate safe SQL strings paired with parameter arrays without touching the database:

```typescript
// Pure INSERT builder
const { sql, params } = buildInsertQuery('account', [
  { email: 'alex@company.com', role: 'admin' },
  { email: 'beth@company.com', role: 'user' }
]);
// sql: "INSERT INTO `account` (`email`, `role`) VALUES (?, ?), (?, ?)"
// params: ["alex@company.com", "admin", "beth@company.com", "user"]
```

---

## 🚨 Error Hierarchy & HTTP Status Mapping

All errors inherit from the abstract `AppError` class and feature `isOperational: true`, allowing centralized error handlers to distinguish trusted operational errors from unknown programming bugs.

```text
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

## 📦 Package Subpath Exports

Import only the modules you need with clean subpath imports:

```typescript
// Root import (everything)
import { createDbClient, Security } from '@mysql-craft';

// Core database client & query builders
import { Database, BaseClient, escapeIdentifier } from '@mysql-craft/core';

// Security & auth module
import { Security } from '@mysql-craft/security';

// Express middleware
import { authenticateJwt, requireRole, errorMiddleware } from '@mysql-craft/middleware';

// Operational errors
import { DatabaseError, PoolExhaustedError, ValidationError, AuthError } from '@mysql-craft/errors';
```

---

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

## 📜 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.

<!-- Developed with ❤️ by the **Principal Node.js Architecture Team**. -->
<p align="center">
  Crafted with ❤️ by <a href="https://github.com/ind-prince">ind-prince</a>
</p>
