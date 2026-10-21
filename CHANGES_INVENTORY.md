# mysql-craft 1.2.0 change inventory

This inventory records the implementation and documentation review for the 1.2.0
release. The library source is authoritative. No `CHANGELOG` file is present.
Generated `.d.ts` files are present under `dist/`; the public declarations and
package export map were checked against the exported TypeScript source.

## Package and release facts

- Package: `mysql-craft`, version `1.2.0`; it is not published under an npm scope.
- Runtime requirement: Node.js `>=18.0.0`.
- Package is ESM-aware (`type: module`) and publishes ESM and CommonJS entry
  points. The package export map provides `.`, `./core`, `./security`,
  `./middleware`, and `./errors`, each with ESM, CommonJS, and declaration paths.
- Runtime dependencies: `mysql2 ^3.11.3`, `jsonwebtoken ^9.0.2`, and
  `picocolors ^1.1.0`.
- Optional peer dependency: `aws-ssl-profiles ^1 || ^2`. Express is no longer a
  peer dependency; applications need to install Express themselves to use the
  router or middleware features.
- Build uses `tsup`; scripts are `build`, `typecheck`, `test`, `test:watch`,
  `clean`, and `prepublishOnly`. The former `watch` build script is gone.
- The release diff from 1.0.4 to 1.2.0 changes module packaging, removes
  `bcryptjs`, makes AWS SSL profiles optional, and adds native encoding helpers
  and lazy AWS RDS TLS loading. No source `CHANGELOG` exists.

## API and behavior inventory

### Database, pool, and query API

- `Database` and `createDbClient(config)` create a synchronous MySQL pool client.
  `Database.create(config)` is the async initializer that resolves
  `useAwsRds: true` into an AWS RDS SSL profile before constructing the client.
- New public configuration option `useAwsRds?: boolean`; the optional profile
  package must be installed if enabled. Direct construction or
  `createDbClient()` does not run that async profile resolution.
- Pool defaults include `connectionLimit: 10`, `queueLimit: connectionLimit * 10`,
  `waitForConnections: true`, `maxIdle: connectionLimit`, `idleTimeout: 60000`,
  and keep-alive. Database-specific options are removed before passing the
  remaining options to mysql2.
- `query`, `queryOne`, `execute`, `insert`, `update`, `delete`, `select`, `count`,
  and `paginate` are methods on `BaseClient`, and are therefore available on
  both `Database` and `Transaction`.
- Query options expose `idempotent?: boolean`. Network errors retry for reads;
  writes retry for transient network errors only when explicitly marked
  idempotent. Deadlock and lock-wait errors are retryable. Query retry settings
  use `retryPolicy` (`maxAttempts: 3`, `baseDelayMs: 200`, `maxDelayMs: 3000`,
  `jitter: true` defaults) or the compatibility aliases `retryAttempts` and
  `retryDelayMs`. The implementation always uses full jitter and ignores the
  `jitter` option.
- Transactions take a callback and optional `{ retries?: number, retryDelayMs?: number }`
  (defaults 3 and 200ms) and retry the whole callback only on deadlock/lock-wait
  errors. The callback can run again, so external side effects must be safe to
  repeat.
- `Database.getPool()` exposes the underlying mysql2 pool. `getPoolMetrics()`,
  `liveness()`, `readiness()`, `healthCheck()`, `drain(timeoutMs = 5000)`, and
  `close()` are also public methods.
- Query errors are wrapped in `DatabaseError`; saturated queue errors are
  mapped to `PoolExhaustedError`. `drain()` currently catches and logs timeout
  or pool-end errors rather than rejecting them.

### SQL builders and parsing

- `escapeIdentifier`, `buildSelectQuery`, `buildCountQuery`, `buildInsertQuery`,
  `buildUpdateQuery`, `buildDeleteQuery`, and `parseQueryParams` are exported
  from root and `mysql-craft/core`.
- Structured select/count support equality object filters and condition arrays
  with `=`, `!=`, `<>`, `>`, `>=`, `<`, `<=`, `LIKE`, `IN`, `IS NULL`, and
  `IS NOT NULL`. An empty `IN` list compiles to a false condition.
- SQL builder functions return `{ sql, params }`; values are bound, identifiers
  are escaped. `update`/`delete` accept a caller-provided where-clause string,
  which must not contain untrusted interpolated input.
- `WhereCondition.operator` is a TypeScript union, but its value is interpolated
  into SQL without runtime validation. Operators from request data must be
  selected from a server-side allowlist.
- `parseQueryParams` handles page/limit, projection, sorting, search, and exact
  filters; it defaults to page 1, limit 20, max limit 100. Invalid or
  non-positive page/limit inputs fall back to defaults; limit is capped.

### Resource router

- `Database.createResourceRouter(table, options?)` and exported
  `createResourceRouter(client, table, options?)` create an Express router.
  Express is resolved at runtime and must be installed by the application.
- Routes are `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `PATCH /:id`, and
  `DELETE /:id`. Both PUT and PATCH use the same partial-update handler; PUT is
  not a replace operation.
- Defaults are primary key `id`; read-only fields `[primaryKey, 'created_at']`;
  hidden fields `password`, `password_hash`, `hash`, and `secret`; default page
  size 20; maximum page size 100; and primary-key ascending sort.
- `allowedFields` filters list projection, sorting, and exact query filters and
  restricts input payload keys. It does not automatically constrain
  `searchableFields`; configure both independently.
- Hooks available: `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`,
  `beforeDelete`, and `afterDelete`.
- Authentication may be a custom `RequestHandler`, `ExpressAuthOptions`, or
  `true` (using `JWT_SECRET` or `JWT_ACCESS_SECRET`). `requireRoles` checks
  `req.user.role`.
- Router errors are forwarded to Express error handling. Missing records return
  their own 404 JSON response; empty or disallowed write payloads produce a
  `ValidationError`.

### Security, middleware, and errors

- `Security.hashPassword(password, costOrSalt?)` now uses native Node.js scrypt,
  returns `scrypt:<salt>:<hexKey>`, rejects empty/non-string passwords and
  passwords longer than 1024 characters. A numeric second argument does not
  control a work factor in the current implementation; a string is used as the
  salt.
- `Security.verifyPassword()` only recognizes the new scrypt format. Existing
  bcrypt hashes are not verified by this method, and the code contains no
  bcrypt migration or fallback.
- JWT helpers remain: `generateToken`, `verifyToken`, and `generateTokenPair`.
  Token-pair defaults are 15 minutes and 7 days. `verifyToken` maps missing,
  expired, and malformed tokens to `AuthError` variants.
- `Security.generateSecureToken(byteLength = 32)` returns random hex;
  `Security.sanitizeUser(user, extraFieldsToStrip = [])` strips the standard
  password/hash/salt keys and caller-specified keys.
- Middleware exports: `authenticateJwt`, `requireRole`, `validateBody`, and
  `errorMiddleware`. Optional authentication allows requests without a token
  and skips authentication errors when enabled.
- Errors exported: `AppError`, `DatabaseError`, `PoolExhaustedError`,
  `AuthError`, and `ValidationError`. `DatabaseError` retains SQL metadata;
  `ValidationError` is HTTP 400, pool exhaustion HTTP 503, and authentication
  errors use HTTP 401 or 403.

### Logging, telemetry, and native helpers

- `debug` accepts a boolean or `LoggerConfig`; slow query threshold defaults to
  500ms. Parameter masking is enabled by default for terminal logging, with
  configurable extra `sensitiveKeys`.
- Instrumentation exports include `InstrumentationManager`,
  `TerminalLoggerInstrumentation`, `ParameterSanitizer`, and event/config types
  for query, error, retry, transaction, and pool metrics.
- `Instrumentation.onPoolMetrics` is part of the interface but the client
  currently does not invoke it.
- `safeDecodeBuffer(Buffer | Uint8Array)` and `safeEncodeString(string)` use
  native UTF-8 `TextDecoder`/`TextEncoder` and are exported from root and core.
- `applySecureSSLProfile(config)` is exported from root and core; it only loads
  AWS SSL configuration when `useAwsRds` is true.

## Breaking changes and migration notes

The 1.2.0 release diff does not remove or rename any database, middleware, or
router method names, and the exported source has no formal `@deprecated`
annotations. The password-hash format and package installation/module behavior
are the breaking changes documented below.

1. **Password hashes changed from bcrypt to scrypt.** New hashes use a different
   format, and `verifyPassword()` returns false for bcrypt strings. Existing
   accounts need a staged migration (verify legacy bcrypt in application code
   during login, then re-hash with `Security.hashPassword()` after successful
   verification), or must retain a separate bcrypt verifier during transition.
   The package no longer installs bcryptjs.
2. **Express is no longer an installed peer dependency.** Install `express`
   directly in applications that use the router or Express middleware.
3. **Package module entry points changed.** ESM users can continue importing
   `mysql-craft`; CommonJS consumers should use `require('mysql-craft')`, now
   backed by `.cjs` exports. Deep paths not listed in the export map are not
   supported package imports.
4. **Build workflow changed.** `npm run watch` was removed; use the supported
   `npm run test:watch` for Vitest watch mode. The production build uses `tsup`.
5. **AWS RDS TLS needs asynchronous initialization.** Use
   `await Database.create({ ..., useAwsRds: true })`; `createDbClient()` and
   `new Database()` are synchronous and do not resolve the optional AWS
   certificate profile.

## Pre-update page audit

The statuses below describe each page before the documentation changes in this
update.

| Page | Status | Findings |
| --- | --- | --- |
| `index.md` | Outdated | Scoped package branding and unverified router/production claims. |
| `README.md` | Outdated | Scoped branding and promotional wording; update project description. |
| `installation.md` | Outdated | Implies mysql2 and Express peer-install behavior; omits optional AWS SSL package and current engines. |
| `quick-start.md` | Outdated | Uses unverified schema details and inaccurate async hash assumptions; update imports and examples. |
| `crud-engine.md` | Incomplete | Useful endpoint overview, but inaccurate auth/body and hook behavior; expand real route, filter, response, and limitation details. |
| `api-reference.md` | Incomplete | Existing core API list is incomplete; add real signatures/options/errors and missing exports. |
| `advanced-configuration.md` | Outdated | Retry configuration and middleware details need to match current runtime behavior. |
| `security-auth.md` | Outdated | Claims bcrypt; migration and scrypt behavior are undocumented. |
| `resilience-apm.md` | Incomplete | Some retry, metric, logging, and drain claims exceed implementation; document current semantics. |
| `why-mysql-craft.md` | Outdated | Scoped package name, bcrypt claim, unsubstantiated footprint/security comparisons. |

## Open questions from source review

- `Security.hashPassword()` retains the parameter name `costOrSalt`, but a
  numeric value is ignored and the scrypt parameters are fixed. Documentation
  should avoid presenting it as a work-factor option; confirm whether this
  parameter is intended to remain compatible or should be clarified in a later
  library release.
- `getPoolMetrics()` reads mysql2 private pool fields and labels
  `_acquiringConnections` as active connections. Confirm whether the published
  metric is intended to represent checked-out connections or acquisition
  operations.
- `healthCheck()` computes its status from readiness but does not use the
  `liveness.alive` value when setting `status`. Confirm whether a draining
  client should report `unhealthy`.
- `drain()` catches pool-end errors/timeouts, logs them, and resolves. Confirm
  whether callers are meant to receive a failure instead.
- `Security.sanitizeUser()` removes `password_hash` at runtime, but its
  declared `Omit` return type does not omit that key. Confirm whether the type
  should match the runtime filter.
- `LoggerConfig` declares `enabled` and `maskSensitiveParams`, but the terminal
  logger does not read those settings. Confirm whether they are intended to be
  supported.
- `ResourceEngine.resolveExpressRouter()` calls `require('express')` in the
  ESM build. A direct ESM invocation was tested and fails with the misleading
  "express package is required" error even though Express is installed. The
  CommonJS package entry works through Node.js `createRequire()`.
- Structured SQL condition operators are trusted from their static type but
  inserted into SQL without runtime validation. Confirm whether the library
  should validate this union at runtime.
