# Installation

`mysql-craft` requires Node.js 18 or later. The package installs `mysql2`,
`jsonwebtoken`, and `picocolors` as runtime dependencies, so you do not need to
install `mysql2` separately for the normal database API.

```bash
npm install mysql-craft
```

Use a TypeScript version compatible with your application. The package includes
generated TypeScript declarations when it is built and published.

# Using pnpm
pnpm add mysql-craft mysql2

# Using yarn
yarn add mysql-craft mysql2

# Using bun
bun add mysql-craft mysql2
```

If Express is missing, importing the package still works, but creating a
resource router requires Express. There is also a current ESM limitation:
`createResourceRouter()`'s lazy loader calls `require()` and fails from the ESM
build even when Express is installed. The
[CRUD guide](/crud-engine#mount-a-router) shows a `createRequire()` workaround
for Node.js applications. The middleware functions are typed against Express
request and handler types.

## AWS RDS TLS

AWS certificate profiles are optional. Install the supported peer dependency
only if you want `Database.create()` to load the AWS RDS CA profile for you:

```bash
npm install aws-ssl-profiles
```

Then initialize the client asynchronously:

```typescript
import { Database } from 'mysql-craft';

const db = await Database.create({
  host: process.env.DB_HOST!,
  user: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  database: process.env.DB_NAME!,
  useAwsRds: true
});
```

If `useAwsRds` is enabled without installing `aws-ssl-profiles`, initialization
throws an error that tells you how to install it. For other TLS setups, pass the
normal mysql2 `ssl` option to `new Database()` or `createDbClient()`.

## Module formats and imports

The package publishes ESM and CommonJS entry points. Use a package import rather
than importing files from `dist`:

```typescript
import { createDbClient } from 'mysql-craft';
import { Security } from 'mysql-craft/security';
import { DatabaseError } from 'mysql-craft/errors';
```

In a CommonJS application:

```javascript
const { createDbClient } = require('mysql-craft');
const { authenticateJwt } = require('mysql-craft/middleware');
```

Supported subpaths are `mysql-craft`, `mysql-craft/core`,
`mysql-craft/security`, `mysql-craft/middleware`, and `mysql-craft/errors`.
Unlisted deep imports are not part of the package API. See [package exports](/advanced-configuration#package-exports)
for the complete list.
