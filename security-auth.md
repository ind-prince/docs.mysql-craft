## 🔐 Security & Authentication Module

Cleanly exported from `@mysql-craft/security` (or root):

```typescript
import { Security } from '@mysql-craft';
```

### 1. Password Hashing (Bcrypt)

Uses `bcryptjs` with a secure default cost factor (salt rounds = 12):

```typescript
// Hash a password
const hash = await Security.hashPassword('MySecurePassword123!');
// Result: $2b$12$...

// Constant-time verification
const isMatch = await Security.verifyPassword('MySecurePassword123!', hash); // true
const isFake = await Security.verifyPassword('WrongPassword', hash);       // false
```

### 2. JWT Token Management & Rotation

Industry-standard dual-token rotation (short-lived Access Tokens + long-lived Refresh Tokens):

```typescript
// Generate Access + Refresh Token pair
const tokenPair = Security.generateTokenPair(
  { sub: user.iduser, email: user.email, role: user.role }, // Access payload
  { sub: user.iduser },                                     // Refresh payload
  {
    accessSecret: process.env.JWT_ACCESS_SECRET!,
    refreshSecret: process.env.JWT_REFRESH_SECRET!,
    accessExpiresIn: '15m', // Default: 15m
    refreshExpiresIn: '7d'  // Default: 7d
  }
);

console.log(tokenPair);
// {
//   accessToken: "eyJhbGciOiJIUzI1Ni...",
//   refreshToken: "eyJhbGciOiJIUzI1Ni...",
//   expiresIn: "15m",
//   tokenType: "Bearer"
// }

// Verify token (throws typed AuthError if invalid or expired)
const decoded = Security.verifyToken<{ sub: number; role: string }>(
  tokenPair.accessToken,
  process.env.JWT_ACCESS_SECRET!
);
console.log(decoded.sub); // 42
```

### 3. User Record Sanitization

Strip sensitive fields (`password`, `password_hash`, `salt`, `hash`) before sending user objects over the wire:

```typescript
const rawUser = {
  iduser: 1,
  email: 'alex@company.com',
  first_name: 'Alex',
  password_hash: '$2b$12$e683h2...',
  salt: 'random_salt',
  stripe_customer_id: 'cus_99999'
};

// Strips default credentials + custom fields
const safeUser = Security.sanitizeUser(rawUser, ['stripe_customer_id']);
console.log(safeUser);
// { iduser: 1, email: 'alex@company.com', first_name: 'Alex' }
```

### 4. Cryptographic Token Generation

Generates cryptographically secure, random hexadecimal tokens for password resets, email verifications, or API keys:

```typescript
const resetToken = Security.generateSecureToken(32); // 64 hex characters
```

---

## 🔌 Express Middleware Suite

Imported from `@mysql-craft/middleware` or root:

```typescript
import {
  authenticateJwt,
  requireRole,
  validateBody,
  errorMiddleware
} from '@mysql-craft';
```

### 1. JWT Authentication Middleware

Validates the `Authorization: Bearer <token>` header, decodes the payload, and augments `req.user`:

```typescript
// Protect a route
app.get(
  '/api/me',
  authenticateJwt({ secret: process.env.JWT_ACCESS_SECRET! }),
  (req, res) => {
    // req.user is automatically typed and available
    res.json({ userId: req.user?.sub, role: req.user?.role });
  }
);

// Optional authentication (proceeds with req.user = undefined if no token provided)
app.get(
  '/api/posts',
  authenticateJwt({ secret: process.env.JWT_ACCESS_SECRET!, optional: true }),
  postsHandler
);
```

### 2. Role-Based Access Control (RBAC)

Guarantees the authenticated user possesses one of the allowed roles:

```typescript
// Require admin or superadmin role
app.delete(
  '/api/accounts/:id',
  authenticateJwt({ secret: process.env.JWT_ACCESS_SECRET! }),
  requireRole('admin', 'superadmin'),
  deleteAccountHandler
);
```

### 3. Request Body Validation

Lightweight, framework-agnostic validator compatible with custom functions, Zod, Joi, or Yup:

```typescript
app.post(
  '/api/accounts',
  validateBody((body: any) => {
    const errors: Record<string, string> = {};
    if (!body.email) errors.email = 'Email address is required.';
    if (!body.password) errors.password = 'Password is required.';
    return {
      valid: Object.keys(errors).length === 0,
      errors
    };
  }),
  createAccountHandler
);
```

### 4. Centralized Error Middleware

Standardizes all application errors into a predictable JSON API structure:

```typescript
import { errorMiddleware } from '@mysql-craft';

// Register at the end of your Express middleware stack
app.use(errorMiddleware);
```

Standardized JSON output:
```json
{
  "success": false,
  "error": {
    "name": "ValidationError",
    "code": "VALIDATION_ERROR",
    "message": "Request payload validation failed.",
    "details": {
      "email": "Email address is required."
    }
  }
}
```

---
