## 🚀 Quick Start Guide

### 1. Initialize the Database Client

Create a centralized database instance using `createDbClient`:

```typescript
// src/config/database.ts
import { createDbClient } from '@mysql-craft';

export const db = createDbClient({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'secret',
  database: process.env.DB_NAME || 'ecommerce_db',
  connectionLimit: 15, // Max 15 active pool connections
  debug: process.env.NODE_ENV !== 'production' // Colorized terminal logs in development
});
```

### 2. Execute Type-Safe Queries

```typescript
// src/services/userService.ts
import { db } from '../config/database';

interface User {
  iduser: number;
  email: string;
  first_name: string;
  role: 'user' | 'admin';
  created_at: Date;
}

// Fetch a single record (returns User or null)
const user = await db.queryOne<User>(
  'SELECT iduser, email, first_name, role, created_at FROM account WHERE email = ? LIMIT 1',
  ['alex@company.com']
);

// Fetch a typed array of records
const admins = await db.query<User>(
  'SELECT * FROM account WHERE role = ? ORDER BY created_at DESC',
  ['admin']
);
```

### 3. Build a Production Express Controller

```typescript
// src/controllers/AccountController.ts
import type { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { Security, ValidationError, AuthError } from '@mysql-craft';

export class AccountController {
  // Safe, transactional registration
  public static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, firstName, lastName } = req.body;

      if (!email || !password || !firstName || !lastName) {
        throw new ValidationError('All fields are required.');
      }

      // Check for duplicate account
      const existing = await db.queryOne(
        'SELECT iduser FROM account WHERE email = ? LIMIT 1',
        [email]
      );
      if (existing) {
        throw new ValidationError('An account with this email address already exists.');
      }

      // Hash password using cost factor 12
      const passwordHash = await Security.hashPassword(password);

      // Execute transaction with automatic rollback and deadlock recovery
      const createdUser = await db.transaction(async (trx) => {
        const result = await trx.insert('account', {
          email,
          first_name: firstName,
          last_name: lastName,
          password_hash: passwordHash,
          role: 'user'
        });

        // Initialize user profile record in the same atomic transaction
        await trx.insert('account_profile', {
          iduser: result.insertId,
          bio: 'Welcome to my profile!'
        });

        return trx.queryOne('SELECT * FROM account WHERE iduser = ?', [result.insertId]);
      });

      // Generate Access & Refresh tokens
      const tokens = Security.generateTokenPair(
        { sub: createdUser.iduser, email: createdUser.email, role: createdUser.role },
        { sub: createdUser.iduser },
        {
          accessSecret: process.env.JWT_ACCESS_SECRET!,
          refreshSecret: process.env.JWT_REFRESH_SECRET!
        }
      );

      res.status(201).json({
        success: true,
        data: {
          user: Security.sanitizeUser(createdUser),
          tokens
        }
      });
    } catch (err) {
      next(err);
    }
  }
}
```

---
