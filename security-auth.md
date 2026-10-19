## 🔐 Security & Authentication Module

Cleanly exported from `mysql-craft/security` (or root):

```typescript
import { Security } from 'mysql-craft';
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
