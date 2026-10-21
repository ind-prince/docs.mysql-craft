# Express resource router

`createResourceRouter()` builds a router for one database table. It provides
basic list, detail, create, update, and delete routes. Use it when the table
maps cleanly to an API resource; use your own controller when the API needs
multi-table workflows or application-specific authorization.

Install Express in your application first:

```bash
npm install express
npm install --save-dev @types/express
```

## Mount a router

This example exposes customer records while keeping password hashes out of
responses. The explicit allowlists matter: they limit the data clients can
read, search, sort, filter, and write.

```typescript
import { createRequire } from 'node:module';
import express from 'express';

const require = createRequire(import.meta.url);
const { createDbClient } = require('mysql-craft') as typeof import('mysql-craft');

const app = express();
app.use(express.json());

const db = createDbClient({
  host: process.env.DB_HOST ?? 'localhost',
  user: process.env.DB_USER ?? 'shop_app',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'shop'
});

app.use(
  '/api/customers',
  db.createResourceRouter('customers', {
    primaryKey: 'id',
    allowedFields: ['id', 'email', 'first_name', 'last_name', 'created_at'],
    readOnlyFields: ['id', 'created_at'],
    hiddenFields: ['password_hash'],
    searchableFields: ['email', 'first_name', 'last_name'],
    defaultLimit: 25,
    maxLimit: 100,
    hooks: {
      beforeCreate: async (data, req) => {
        data.signup_ip = req.ip;
        return data;
      }
    }
  })
);

app.listen(3000);
```

The CommonJS package entry is used here because the current ESM build's lazy
Express loader calls `require()` from an ESM module. In Node.js that `require`
is undefined, so `createResourceRouter()` fails with its “express package is
required” message even when Express is installed. The `createRequire()` bridge
above loads the CommonJS entry and lets the router resolve Express. Other
database APIs can still use normal ESM imports. This is a library limitation,
not an Express configuration problem.

The `beforeCreate` hook runs after the router filters client fields, so it can
add trusted server-side values such as the request IP. For registration, prefer
a custom route that validates the password separately, hashes it, and passes
only the hash to the database. `hiddenFields` only removes response properties;
it is not an input filter.

## Routes and responses

Mounting the router at `/api/customers` creates the following routes:

| Method | Path | Behavior | Typical response |
| --- | --- | --- | --- |
| `GET` | `/api/customers` | Paginated list with filters, sort, projection, and search | `200` with `data` and `meta` |
| `GET` | `/api/customers/:id` | Fetch one row by the configured primary key | `200`, or `404` |
| `POST` | `/api/customers` | Insert one row after removing read-only/disallowed fields | `201` |
| `PUT` | `/api/customers/:id` | Update writable fields on an existing row | `200`, or `404` |
| `PATCH` | `/api/customers/:id` | Update writable fields on an existing row | `200`, or `404` |
| `DELETE` | `/api/customers/:id` | Delete an existing row | `200`, or `404` |

`PUT` and `PATCH` currently use the same handler. Both perform a partial update;
`PUT` does not replace the whole resource. Create and update requests with no
writable fields are passed to Express as a `ValidationError`. The router itself
does not parse JSON, so install `express.json()` before mounting it.

The list response has the following shape:

```json
{
  "success": true,
  "data": [
    {
      "id": 42,
      "email": "maya@example.com",
      "first_name": "Maya",
      "last_name": "Chen"
    }
  ],
  "meta": {
    "total": 63,
    "page": 2,
    "limit": 25,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": true
  }
}
```

Hidden fields are stripped from list, detail, and create/update response records.
Delete returns `{ "success": true, "message": "..." }`. Not-found responses have
`success: false` and an `error` object with `code: "NOT_FOUND"` and a message.

## Pagination, search, sorting, and filters

Page numbers start at 1. The default limit is 20 and the default maximum is 100.
Non-positive or non-numeric page and limit values fall back to their defaults;
larger limits are capped. The offset is `(page - 1) * limit`.

```http
GET /api/customers?page=2&limit=25
```

If `defaultLimit: 25` is configured, omitting `limit` returns up to 25 rows.
The response includes the total number of rows matching the same filters and
search. Count and list are separate queries, so concurrent writes can make
their results reflect slightly different database moments.

Search uses `LIKE` with a `%term%` pattern for each configured searchable
column:

```http
GET /api/customers?search=maya
```

Sorting accepts a comma-separated `column:direction` list or a minus prefix:

```http
GET /api/customers?sort=created_at:desc,first_name:asc
GET /api/customers?sort=-created_at,first_name
```

Only `asc` and `desc` have meaning in the direction position; other values
become ascending. If no `sort` parameter is supplied, `defaultSort` is used. The
default is `<primaryKey>:asc`.

`fields` selects a comma-separated projection, and other query parameters become
exact-match filters:

```http
GET /api/customers?fields=id,email,first_name&status=active
```

The reserved query parameter names are `page`, `limit`, `sort`, `fields`, and
`search`. An `allowedFields` list is used to filter requested projection,
sorting, filters, and writable payload fields. When no allowlist is provided,
the router accepts any valid identifier as a filter or sort column, so define
one for public endpoints. Search fields are separately controlled by
`searchableFields`.

If a requested `fields` list contains no allowed fields, the parser falls back
to no projection (SQL `*`), not an empty result. `hiddenFields` are still
stripped from the response, but this behavior is not a substitute for a
well-designed allowlist.

## Authentication and roles

You can apply authentication to every route in the resource router. With
`auth: true`, it reads `JWT_SECRET` or `JWT_ACCESS_SECRET` from the environment.
For an explicit secret, pass `ExpressAuthOptions`:

```typescript
app.use(
  '/api/customers',
  db.createResourceRouter('customers', {
    primaryKey: 'id',
    allowedFields: ['id', 'email', 'first_name', 'last_name'],
    auth: { secret: process.env.JWT_ACCESS_SECRET! },
    requireRoles: ['support', 'admin']
  })
);
```

`requireRoles` reads `req.user.role`; pair it with authentication or another
middleware that sets `req.user`. A custom Express `RequestHandler` can be passed
as `auth` when the application uses a different authentication scheme. The
router does not implement resource-level ownership checks. Add custom
authorization when a user should only access particular rows.

## Lifecycle hooks

Hooks receive the Express request and run around the corresponding database
operation. A `beforeCreate` or `beforeUpdate` hook can return replacement data,
or mutate and return the supplied object. An `afterCreate`, `afterUpdate`, or
`afterDelete` hook runs after the database operation. Errors are passed to
Express error handling.

```typescript
const customerRouter = db.createResourceRouter('customers', {
  primaryKey: 'id',
  allowedFields: ['id', 'email', 'first_name', 'last_name', 'created_at'],
  readOnlyFields: ['id', 'created_at'],
  hiddenFields: ['password_hash'],
  hooks: {
    beforeCreate: async (data, req) => {
      data.signup_ip = req.ip;
      return data;
    },
    afterCreate: async (created, req) => {
      await auditLog.record('customer.created', {
        customerId: created.id,
        requestId: req.get('x-request-id')
      });
    },
    beforeUpdate: async (id, data) => {
      data.updated_at = new Date();
      return data;
    },
    beforeDelete: async (id) => {
      const activeOrders = await db.count({
        table: 'orders',
        where: { customer_id: id, status: 'open' }
      });
      if (activeOrders > 0) {
        throw new Error('Close this customer’s open orders before deleting the account.');
      }
    }
  }
});
```

Hooks are not wrapped in a transaction. For example, an `afterCreate` error is
reported after the row has already been inserted. Use an explicit
`db.transaction()` in a custom controller when several database writes must be
atomic.

## Configuration reference

| Option | Type | Default | What it controls |
| --- | --- | --- | --- |
| `primaryKey` | `string` | `'id'` | Column used for detail, update, and delete routes. |
| `allowedFields` | `string[]` | `undefined` | Columns accepted for projection, sorting, exact filters, and request payloads. |
| `readOnlyFields` | `string[]` | `[primaryKey, 'created_at']` | Request fields removed before create and update. |
| `hiddenFields` | `string[]` | `['password', 'password_hash', 'hash', 'secret']` | Properties removed from returned records. |
| `searchableFields` | `string[]` | `[]` | Columns searched when `?search=` is present. |
| `defaultLimit` | `number` | `20` | Page size when the request has no valid positive limit. |
| `maxLimit` | `number` | `100` | Upper bound for the page size. |
| `defaultSort` | `string` | `${primaryKey}:asc` | Sort used when the request does not supply `sort`. |
| `auth` | `boolean \| ExpressAuthOptions \| RequestHandler` | `undefined` | JWT or custom authentication middleware applied to all routes. |
| `requireRoles` | `string[]` | `undefined` | Allowed `req.user.role` values; requires a user to be set. |
| `hooks` | `ResourceHooks` | `{}` | Optional lifecycle callbacks for writes. |

For joins, multi-table writes, custom filtering, and stronger request validation,
use your own Express route and call the regular database API. The router is
intentionally limited to one table.
