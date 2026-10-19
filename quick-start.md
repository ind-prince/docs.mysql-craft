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
