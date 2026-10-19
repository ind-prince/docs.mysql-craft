## ⚡ Instant CRUD Resource Engine (1-Line REST API)

Stop writing repetitive controllers, services, and queries for every relational table. With **`db.createResourceRouter()`**, you generate an enterprise-grade, hardened Express router in **a single line of code**.

### Basic Resource Router Setup

```typescript
import express from 'express';
import { createDbClient, Security } from 'mysql-craft';

const app = express();
app.use(express.json());

const db = createDbClient({ /* db config */ });

// Mount a full CRUD REST API for table "account" under /api/accounts
app.use('/api/accounts', db.createResourceRouter('account', {
  primaryKey: 'iduser',
  allowedFields: ['iduser', 'email', 'first_name', 'last_name', 'role', 'created_at'],
  readOnlyFields: ['iduser', 'created_at'], // Clients cannot inject/override these on POST/PUT
  hiddenFields: ['password_hash'],           // Stripped from all HTTP responses
  searchableFields: ['email', 'first_name', 'last_name'], // Enabled for ?search=
  defaultLimit: 20,
  maxLimit: 100,
  auth: { secret: process.env.JWT_ACCESS_SECRET! }, // Enforces Bearer JWT
  hooks: {
    beforeCreate: async (data) => {
      if (data.password) {
        data.password_hash = await Security.hashPassword(data.password);
        delete data.password;
      }
      return data;
    }
  }
}));

app.listen(3000, () => console.log('API listening on http://localhost:3000'));
```

### Endpoints Generated Automatically

| Method | Endpoint | Description | Status Codes |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Paginated listing with filtering, sorting, field selection, and search | `200 OK` |
| `GET` | `/:id` | Fetch single record by primary key | `200 OK`, `404 Not Found` |
| `POST` | `/` | Create new record (strips read-only fields & executes lifecycle hooks) | `201 Created`, `400 Bad Request` |
| `PUT` | `/:id` | Full update of existing record | `200 OK`, `404 Not Found`, `400 Bad Request` |
| `PATCH`| `/:id` | Partial update of existing record | `200 OK`, `404 Not Found`, `400 Bad Request` |
| `DELETE`| `/:id` | Remove record by primary key | `200 OK`, `404 Not Found` |

---

### Query Parameter Capabilities

The generated `GET /` endpoint inspects the URL query string and dynamically compiles safe, pure parameterized SQL queries:

#### 1. Pagination (`?page=` & `?limit=`)
```http
GET /api/accounts?page=2&limit=25
```
Automatically generates `LIMIT 25 OFFSET 25` and executes an associated `COUNT(*)` query, returning standardized pagination metadata:
```json
{
  "success": true,
  "data": [ /* 25 account items */ ],
  "meta": {
    "total": 100,
    "page": 2,
    "limit": 25,
    "totalPages": 4,
    "hasNext": true,
    "hasPrev": true
  }
}
```

#### 2. Safe Sorting (`?sort=`)
Supports comma-separated column definitions with explicit `:asc`/`:desc` directives or minus-prefix notation. All columns are strictly validated against `allowedFields`:
```http
GET /api/accounts?sort=created_at:desc,first_name:asc
GET /api/accounts?sort=-created_at,first_name
```

#### 3. Field Projection (`?fields=`)
Allows clients to request only a subset of columns, minimizing bandwidth:
```http
GET /api/accounts?fields=iduser,email,role
```
*Compiles to: `SELECT \`iduser\`, \`email\`, \`role\` FROM \`account\` ...`*

#### 4. Multi-Column Search (`?search=`)
Performs a parameterized `LIKE %term%` across all columns registered in `searchableFields`:
```http
GET /api/accounts?search=alex
```
*Compiles to: `WHERE (\`email\` LIKE ? OR \`first_name\` LIKE ? OR \`last_name\` LIKE ?)` with bound params `['%alex%', '%alex%', '%alex%']`.*

#### 5. Exact Column Filters
Any query parameter matching an allowed column acts as an exact equality filter (reserved parameters `page`, `limit`, `sort`, `fields`, and `search` are automatically segregated):
```http
GET /api/accounts?role=admin&status=active
```
*Compiles to: `WHERE \`role\` = ? AND \`status\` = ?`.*

---

### Lifecycle Hooks

Intercept and mutate payloads or trigger side-effects (auditing, email notifications, password hashing) during the CRUD lifecycle:

```typescript
const router = db.createResourceRouter('account', {
  hooks: {
    // Modify or validate payload before writing to the database
    beforeCreate: async (data, req) => {
      data.created_by_ip = req.ip;
      if (data.password) {
        data.password_hash = await Security.hashPassword(data.password);
        delete data.password;
      }
      return data;
    },

    // Trigger asynchronous side effects after database commit
    afterCreate: async (createdRecord, req) => {
      await emailService.sendWelcome(createdRecord.email);
    },

    // Intercept updates
    beforeUpdate: async (id, data, req) => {
      data.updated_at = new Date();
      return data;
    },

    // Audit logging after update
    afterUpdate: async (updatedRecord, req) => {
      auditLogger.info(`User ${updatedRecord.iduser} updated by ${req.user?.sub}`);
    },

    // Verify constraints before deletion
    beforeDelete: async (id, req) => {
      const orderCount = await db.count({ table: 'orders', where: { user_id: id } });
      if (orderCount > 0) {
        throw new ValidationError('Cannot delete user with active orders.');
      }
    },

    // Clean up associated resources after deletion
    afterDelete: async (id, req) => {
      await s3Client.deleteFolder(`avatars/${id}`);
    }
  }
});
```

---

### Resource Configuration Options

Pass a `ResourceEngineOptions` object to customize the router behavior:

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `primaryKey` | `string` | `'id'` | Primary key column name of the underlying table. |
| `allowedFields` | `string[]` | `undefined` | Strict whitelist of column names permitted for selection, filtering, and sorting. |
| `readOnlyFields` | `string[]` | `['id', 'created_at']` | Fields stripped from incoming client payloads on `POST`, `PUT`, and `PATCH`. |
| `hiddenFields` | `string[]` | `['password', 'password_hash', 'hash', 'secret']` | Sensitive fields omitted from all JSON responses. |
| `searchableFields` | `string[]` | `[]` | Columns targeted when clients supply the `?search=term` query parameter. |
| `defaultLimit` | `number` | `20` | Default number of records returned per page when `limit` is omitted. |
| `maxLimit` | `number` | `100` | Hard upper ceiling for `limit` to prevent denial-of-service queries. |
| `defaultSort` | `string` | `${primaryKey}:asc` | Fallback sort clause if client omits `?sort=`. |
| `auth` | `boolean \| ExpressAuthOptions \| RequestHandler` | `undefined` | Enforces authentication. If `true`, requires valid JWT via `JWT_SECRET` / `JWT_ACCESS_SECRET`. |
| `requireRoles` | `string[]` | `undefined` | Enforces RBAC permissions (checks `req.user.role`). |
| `hooks` | `ResourceHooks` | `{}` | Lifecycle interceptors (`beforeCreate`, `afterCreate`, etc.). |

---
