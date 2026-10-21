# Security and authentication

Security helpers live on the `Security` class and are available from the root
package or `mysql-craft/security`. Express middleware is a separate optional
module; install Express in your application before using it.

## Password hashing

`Security.hashPassword()` uses Node.js `crypto.scrypt`. It creates a random
16-byte salt by default and derives a 64-byte key. The returned value has the
form `scrypt:<salt>:<hexKey>`.

```typescript
import { Security } from 'mysql-craft/security';

const passwordHash = await Security.hashPassword('correct horse battery staple');
console.log(passwordHash.startsWith('scrypt:')); // true
```

Empty strings, non-string values, and passwords longer than 1024 characters
are rejected with `ValidationError`. The current error messages are:

- `Password is required and must be a non-empty string.`
- `Password length exceeds maximum allowed limit.`

Verify a candidate with `verifyPassword()`:

```typescript
const matches = await Security.verifyPassword(
  'correct horse battery staple',
  passwordHash
);
console.log(matches); // true

const wrongPassword = await Security.verifyPassword('not the password', passwordHash);
console.log(wrongPassword); // false
```

The verifier uses constant-time comparison for valid scrypt hashes. Missing
values, malformed scrypt strings, and hashes from unrecognized formats return
`false`. It does not accept bcrypt hashes. Read the [password migration guide](/migration#password-hash-migration)
before replacing a bcrypt-based release.

The optional second `hashPassword` argument is typed as `number | string`. A
string is used as the salt; a number is ignored and does not change scrypt's
work factor. Prefer omitting it so each hash receives a random salt.

## JWTs

### Sign and verify one token

`generateToken(payload, secret, options?)` returns a signed JWT string. When
`options` is omitted, the default expiration is `1h`. If `secret` is empty it
throws an `AuthError` with status 500 and code `AUTH_CONFIG_ERROR`.

```typescript
const token = Security.generateToken(
  { sub: 42, email: 'maya@example.com', role: 'support' },
  process.env.JWT_ACCESS_SECRET!,
  { expiresIn: '15m' }
);
```

`verifyToken<T>(token, secret, options?)` verifies the signature and returns
the decoded value as `T`. The generic is a compile-time assertion; it does not
validate claims. Missing tokens become `UNAUTHORIZED`, expired tokens become
`TOKEN_EXPIRED`, and malformed or invalid-signature tokens become
`INVALID_TOKEN`.

```typescript
interface AccessClaims {
  sub: number;
  email: string;
  role: string;
}

const claims = Security.verifyToken<AccessClaims>(
  token,
  process.env.JWT_ACCESS_SECRET!
);
console.log(claims.sub);
```

Store secrets in environment or secret-management systems. Use different
secrets for access and refresh tokens, and never send signing secrets to
clients.

### Access and refresh token pairs

`generateTokenPair(accessPayload, refreshPayload, config)` returns
`{ accessToken, refreshToken, expiresIn, tokenType: 'Bearer' }`.
`accessExpiresIn` defaults to `15m`; `refreshExpiresIn` defaults to `7d`.

```typescript
const tokens = Security.generateTokenPair(
  { sub: 42, email: 'maya@example.com', role: 'customer' },
  { sub: 42 },
  {
    accessSecret: process.env.JWT_ACCESS_SECRET!,
    refreshSecret: process.env.JWT_REFRESH_SECRET!
  }
);
```

The helper signs both JWTs. It does not store or rotate refresh tokens, revoke
them, or provide a refresh endpoint. Your application must implement that
lifecycle.

### Random tokens

`generateSecureToken(byteLength = 32)` returns cryptographically random bytes
encoded as hexadecimal. The default is 32 bytes, or 64 hexadecimal characters:

```typescript
const resetToken = Security.generateSecureToken();
// Store a one-way digest of resetToken; send the token to the account owner.
```

This helper does not persist tokens, set an expiry, or provide verification.
Keep those controls in the application.

## Removing sensitive user fields

`sanitizeUser(user, extraFieldsToStrip = [])` makes a shallow copy and removes
the exact property names `password`, `passwd`, `password_hash`, `hash`, and
`salt`, followed by any additional names supplied by the caller.

```typescript
const safeCustomer = Security.sanitizeUser(
  {
    id: 42,
    email: 'maya@example.com',
    password_hash: 'scrypt:...',
    billing_customer_id: 'cus_123'
  },
  ['billing_customer_id']
);

console.log(safeCustomer);
// { id: 42, email: 'maya@example.com' }
```

This is a shallow filter, not a general-purpose data-loss-prevention tool.
Nested objects are not traversed. The runtime also removes `password_hash`,
although the current TypeScript return type does not omit that property from
its static type. Use explicit response DTOs when you need a strict public shape.

## Express JWT middleware

`authenticateJwt({ secret, optional?, tokenExtractor? })` reads a bearer token
from the `Authorization` header by default, verifies it, and sets
`req.user`. The expected header is `Authorization: Bearer <token>`.

```typescript
import express from 'express';
import { authenticateJwt } from 'mysql-craft/middleware';

const app = express();

app.get(
  '/api/profile',
  authenticateJwt({ secret: process.env.JWT_ACCESS_SECRET! }),
  (req, res) => {
    res.json({ userId: req.user?.sub, role: req.user?.role });
  }
);
```

When `optional: true`, requests without a token continue without a user. In the
current implementation, token verification errors also continue in optional
mode. Do not use it for a route that must reject invalid credentials.

Use `tokenExtractor(req)` to return a token string or `null` when your
application uses a different token location. Missing or invalid credentials in
required mode are forwarded as an `AuthError`.

## Role-based access control

`requireRole(...roles)` requires an existing `req.user` and checks whether
`req.user.role` matches any allowed role:

```typescript
import { authenticateJwt, requireRole } from 'mysql-craft/middleware';

app.delete(
  '/api/customers/:id',
  authenticateJwt({ secret: process.env.JWT_ACCESS_SECRET! }),
  requireRole('admin', 'support'),
  deleteCustomerHandler
);
```

Without a user it forwards an unauthorized error. A user with no matching role
gets a forbidden error. It does not check ownership or permissions beyond the
role string; add those checks in your route or service.

## Body validation middleware

`validateBody(validator)` accepts a function that returns
`{ valid, errors? }`. It forwards a `ValidationError` with message
`Request payload validation failed.` when `valid` is false.

```typescript
import { validateBody } from 'mysql-craft/middleware';

app.post(
  '/api/customers',
  validateBody((body) => {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { valid: false, errors: ['Expected a customer object.'] };
    }

    const customer = body as Record<string, unknown>;
    const errors: Record<string, string> = {};
    if (typeof customer.email !== 'string' || !customer.email.includes('@')) {
      errors.email = 'Enter a valid email address.';
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }),
  createCustomerHandler
);
```

The middleware does not know about schema libraries. Adapt their validation
result to the expected object before returning it.

## Error middleware and classes

Mount `errorMiddleware` after the routes. It formats `AppError` instances with
their status, name, code, message, and optional details. Unknown errors are
logged and returned as HTTP 500; production responses hide the underlying
message.

| Error | Status | Code | When it is used |
| --- | --- | --- | --- |
| `DatabaseError` | `500` | Mysql2 code or `DATABASE_ERROR` | Query or transaction failure; may include SQL metadata. |
| `PoolExhaustedError` | `503` | `POOL_EXHAUSTED` | Pool queue saturation. |
| `AuthError.unauthorized()` | `401` | `UNAUTHORIZED` | Missing credentials or unauthenticated access. |
| `AuthError.invalidToken()` | `401` | `INVALID_TOKEN` | Malformed or invalid token. |
| `AuthError.tokenExpired()` | `401` | `TOKEN_EXPIRED` | Expired token. |
| `AuthError.forbidden()` | `403` | `FORBIDDEN` | Role check failed. |
| `AuthError.invalidCredentials()` | `401` | `INVALID_CREDENTIALS` | Application-level credential failure. |
| `ValidationError` | `400` | `VALIDATION_ERROR` | Invalid input or identifier. |

The static `AuthError` constructors accept an optional message. `ValidationError`
takes a message and optional `Record<string, string> | string[]` details.

## Security notes

- Parameterized SQL protects bound values, not SQL fragments or identifiers
  assembled by your application. Use the structured builders for dynamic
  identifiers and keep raw clauses trusted.
- Do not log access tokens, refresh tokens, or passwords. The terminal logger
  masks known sensitive object keys, but a raw string parameter has no key to
  inspect and may still appear in logs.
- Hash passwords before inserting them. `createResourceRouter` does not hash or
  validate passwords automatically.
- Use HTTPS for token-bearing requests and apply application-specific rate
  limits, account lockout, and authorization rules where appropriate.
