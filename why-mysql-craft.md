# Why mysql-craft?

`mysql-craft` is a small layer on top of `mysql2/promise`. It is for teams that
want to keep writing SQL, but would rather not repeat connection, transaction,
parameter-binding, and pagination plumbing throughout an application.

## What it helps with

Values passed to `query()`, `execute()`, and the structured helpers are sent as
parameters instead of being joined into SQL text. Identifiers used by the
structured builders are validated and quoted. The library does not make
arbitrary SQL safe: if you concatenate untrusted input into a query string or a
`whereClause`, you still have an injection risk.

`Database` and `Transaction` share a query interface, including parameterized
queries, inserts, updates, deletes, selects, counts, and pagination. A
transaction callback gets a scoped client so related writes can succeed or fail
together.

The library also includes optional Express middleware and a generated
single-table CRUD router. Those features are not required to use the database
client. You still need to configure field allowlists, authentication, and
validation to fit your application; the router is not a replacement for
application-specific authorization. The current ESM router loader has a
known limitation; the [CRUD guide](/crud-engine#mount-a-router) explains the
workaround and when to use it.

## Choosing the right tool

| If you need... | Use... |
| --- | --- |
| Full control over SQL, including joins or aggregates | `query()` or `execute()` with bound values |
| A simple single-table read/count with dynamic filters | `select()` and `count()` |
| A small Express API for one table | `createResourceRouter()` with field allowlists and auth |
| ORM models, schema migrations, or relationship management | A separate ORM or migration tool; `mysql-craft` does not provide these |

Compared with using `mysql2` directly, the client adds helpers for common
operations and retry/instrumentation configuration. It is not an ORM, does not
discover your schema, and does not remove the need to understand SQL. Prefer a
different tool if you need generated models or a migration system.

## Package details

The npm package is named `mysql-craft` and supports Node.js 18 and later. It
ships ESM and CommonJS entry points and has explicit subpath exports. Express is
optional and must be installed by applications that use its router or
middleware. AWS RDS certificate loading is also optional.

Start with [installation](/installation), or compare the 1.2.0 changes in the
[migration guide](/migration).
