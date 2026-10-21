# Quick start

This guide uses an imaginary shop database with an `orders` table. The first
example is deliberately small; the later examples show how to apply the same
client to everyday application work.

## Create a client and fetch a record

`createDbClient()` creates a pool synchronously. It accepts mysql2 pool options
along with `mysql-craft` settings such as `debug` and `retryPolicy`.

```typescript
import { createDbClient } from 'mysql-craft';

export const db = createDbClient({
  host: process.env.DB_HOST ?? 'localhost',
  user: process.env.DB_USER ?? 'shop_app',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'shop',
  connectionLimit: 10
});
```

Use a generic to describe the fields your query selects. The generic is a
TypeScript type; it does not inspect the database schema at runtime.

```typescript
interface OrderSummary {
  id: number;
  customer_id: number;
  status: 'pending' | 'paid' | 'shipped';
  total_cents: number;
}

const order = await db.queryOne<OrderSummary>(
  'SELECT id, customer_id, status, total_cents FROM orders WHERE id = ? LIMIT 1',
  [1042]
);

if (order === null) {
  console.log('Order 1042 was not found.');
} else {
  console.log(`Order ${order.id}: ${order.status}`);
}
```

`query()` returns an array. `queryOne()` returns the first row or `null`, so
check for the missing-row case before reading its fields.

## Create a row with a transaction

Use the client helpers to bind values and escape table and column identifiers.
The transaction callback receives a scoped client, `trx`; run every query that
belongs to the transaction through that client.

```typescript
const createdOrder = await db.transaction(async (trx) => {
  const inserted = await trx.insert('orders', {
    customer_id: 42,
    status: 'pending',
    total_cents: 12_500
  });

  await trx.insert('order_events', {
    order_id: inserted.insertId,
    event_type: 'created'
  });

  return trx.queryOne<OrderSummary>(
    'SELECT id, customer_id, status, total_cents FROM orders WHERE id = ?',
    [inserted.insertId]
  );
});

console.log(createdOrder);
```

The transaction commits when the callback resolves and rolls back if it throws.
Deadlock retries can rerun the callback, so avoid placing non-repeatable
side-effects such as sending email inside it. See [transactions](/api-reference#transactions).

## Use a structured query for a paginated list

For filters built from application state, `select()` and `count()` keep values
bound without hand-building the SQL:

```typescript
const recentOrders = await db.select<OrderSummary>({
  table: 'orders',
  fields: ['id', 'customer_id', 'status', 'total_cents'],
  where: [
    { column: 'status', operator: 'IN', value: ['paid', 'shipped'] },
    { column: 'total_cents', operator: '>=', value: 5_000 }
  ],
  orderBy: [{ column: 'id', direction: 'DESC' }],
  limit: 20,
  offset: 0
});

const matchingOrders = await db.count({
  table: 'orders',
  where: { status: 'paid' }
});
```

Structured helpers cover one table at a time. Use `query()` when you need a join,
aggregation, or SQL feature the helpers do not model:

```typescript
const orderRows = await db.query<{
  id: number;
  customer_email: string;
  total_cents: number;
}>(
  `SELECT o.id, c.email AS customer_email, o.total_cents
   FROM orders AS o
   INNER JOIN customers AS c ON c.id = o.customer_id
   WHERE o.status = ?
   ORDER BY o.id DESC
   LIMIT ?`,
  ['paid', 20]
);
```

Keep user input in the parameter array. Do not interpolate it into SQL strings.

## Handle database errors and close the pool

Database operations can reject with exported error classes. Catch errors at an
application boundary where you can decide whether to retry, report, or return
an HTTP response. `close()` ends the underlying mysql2 pool:

```typescript
import { DatabaseError, PoolExhaustedError } from 'mysql-craft';

try {
  const results = await db.query('SELECT id FROM orders WHERE customer_id = ?', [42]);
  console.log(`Found ${results.length} orders.`);
} catch (error) {
  if (error instanceof PoolExhaustedError) {
    console.error('The database pool is full; ask the caller to retry later.');
  } else if (error instanceof DatabaseError) {
    console.error(`Database operation failed (${error.code}).`);
  } else {
    throw error;
  }
} finally {
  await db.close();
}
```

In a long-running server, close the pool during application shutdown rather
than after each request. The [resilience guide](/resilience-apm) covers draining,
health checks, pool limits, and instrumentation.
