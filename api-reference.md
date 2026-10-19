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
