# What's new and migration guide

This guide covers the library changes in version 1.2.0. The source repository
does not include a changelog, so this page is based on the release diff from
1.0.4 and the current package implementation.

## What's new in 1.2.0

- The package now publishes ESM and CommonJS builds with explicit package
  exports for the root, core, security, middleware, and errors entry points.
- Builds use `tsup`. The package includes declarations for each supported
  entry point.
- Password hashing now uses Node.js `crypto.scrypt`, removing the runtime
  `bcryptjs` dependency.
- `Database.create()` can load an optional AWS RDS TLS profile on demand.
- Native UTF-8 helpers `safeDecodeBuffer()` and `safeEncodeString()` are
  exported.
- Express is no longer declared as a peer dependency. Applications install it
  themselves when using Express middleware or the resource router.
- The ESM build currently cannot initialize the resource router because its
  lazy loader uses `require()`. The [CRUD guide](/crud-engine#mount-a-router)
  documents the verified CommonJS bridge workaround.

The npm package remains named `mysql-craft`, requires Node.js 18 or later, and
continues to depend on `mysql2`, `jsonwebtoken`, and `picocolors`.

## Password hash migration

This is the most important application-level change. Previous versions used
bcrypt hashes; the current `Security.verifyPassword()` accepts only values in
the `scrypt:<salt>:<hexKey>` format. A bcrypt hash will return `false`, even
when the supplied password is correct.

### Old code

```typescript
const passwordHash = await Security.hashPassword(password, 12);
const isValid = await Security.verifyPassword(password, storedBcryptHash);
```

### New code

New passwords can use the current library directly:

```typescript
const passwordHash = await Security.hashPassword(password);
const isValid = await Security.verifyPassword(password, passwordHash);
```

Existing bcrypt hashes need a staged migration because hashes cannot be
converted without the original password. During login, retain an application
dependency that can verify bcrypt (for example, the bcrypt package your
application already uses). If verification succeeds, generate and persist a
scrypt hash before completing the login:

```typescript
import bcrypt from 'bcryptjs';
import { Security } from 'mysql-craft/security';
import { db } from './database.js';

async function verifyAndUpgradePassword(
  customerId: number,
  password: string,
  storedHash: string
): Promise<boolean> {
  if (storedHash.startsWith('scrypt:')) {
    return Security.verifyPassword(password, storedHash);
  }

  const legacyMatch = await bcrypt.compare(password, storedHash);
  if (!legacyMatch) {
    return false;
  }

  const upgradedHash = await Security.hashPassword(password);
  await db.update('customers', { password_hash: upgradedHash }, '`id` = ?', [customerId]);
  return true;
}
```

Keep the legacy bcrypt verifier installed in your application only until its
remaining bcrypt hashes have been upgraded or reset. The new library version
does not install `bcryptjs`, and `Security.verifyPassword()` does not fall back
to it. Do not replace stored hashes in bulk; without the password, they cannot
be re-hashed.

The old numeric work-factor argument is not equivalent to a scrypt setting. In
the current implementation, a numeric second argument to `hashPassword()` is
ignored. Omit it. A string second argument is used as a salt, but application
code should normally let the library generate a fresh random salt.

## Express dependency change

Express was previously listed as a peer dependency. In 1.2.0 it is not a
runtime dependency or peer dependency; the router resolves it when used.

### Old installation

```bash
npm install mysql-craft
```

This used to install Express through the peer dependency relationship. Do not
rely on that in the current release.

### New installation

Install Express directly in any application using Express features:

```bash
npm install mysql-craft express
npm install --save-dev @types/express
```

This is only needed for Express middleware or `createResourceRouter()`.
Database-only applications do not need Express.

## Module format and package paths

The package declares `type: module` and provides explicit `import` and
`require` paths. Use supported package paths rather than files inside `dist`.

```typescript
// ESM / TypeScript
import { createDbClient } from 'mysql-craft';
import { Security } from 'mysql-craft/security';
```

```javascript
// CommonJS
const { createDbClient } = require('mysql-craft');
const { Security } = require('mysql-craft/security');
```

The supported subpaths are `mysql-craft`, `mysql-craft/core`,
`mysql-craft/security`, `mysql-craft/middleware`, and `mysql-craft/errors`.
Only these paths are exported by the package map. If your application
previously relied on a private deep import, change it to a public entry point.

## Build script changes

The library build changed from `tsc -p tsconfig.build.json` to `tsup`, which
produces ESM and CommonJS output plus declarations. The old `npm run watch`
script was removed. Available scripts include `npm run build`,
`npm run typecheck`, `npm test`, and `npm run test:watch`.

This change affects contributors and forks that used the old script. It does
not require a different command to consume the published package.

## AWS RDS TLS initialization

AWS RDS profile loading is new in 1.2.0 and opt-in. Install its optional peer
dependency and use the asynchronous factory:

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

`createDbClient()` and `new Database()` remain synchronous and do not load that
profile. They continue to accept a normal mysql2 `ssl` option for custom
certificate configuration.

## Deprecation notes

The current exported source does not mark any API with a formal deprecation
annotation. `retryAttempts` and `retryDelayMs` are retained as compatibility
aliases for `retryPolicy.maxAttempts` and `retryPolicy.baseDelayMs`; new code
should use `retryPolicy`. `Logger` is still exported as a compatibility wrapper.

There is no automatic bcrypt compatibility layer. The old bcrypt hash format
is unsupported by `Security.verifyPassword()` and requires the staged migration
above.

## Open questions

- The current `hashPassword()` type retains `costOrSalt`, although numeric
  values are ignored and the scrypt work factor is fixed. Confirm the intended
  public contract before documenting that argument as a supported tuning
  option.
- `getPoolMetrics()` derives `activeConnections` from a private mysql2
  acquisition list; confirm whether consumers should interpret it as checked
  out connections.
- `healthCheck()` does not use its liveness result when computing its status.
  Confirm whether draining should report `unhealthy`.
- `drain()` logs and swallows timeout and pool-end errors. Confirm whether this
  is intended to resolve successfully after a failed drain.
- `Instrumentation.onPoolMetrics` is part of the public interface but is not
  currently called by the database client. Confirm whether the callback is
  planned for a later release.
- `createResourceRouter()` fails from the published ESM entry even when
  Express is installed: the lazy loader references `require()` in an ESM
  module. The CommonJS bridge documented on the CRUD page was verified; confirm
  when the library will replace the ESM-incompatible loader.
