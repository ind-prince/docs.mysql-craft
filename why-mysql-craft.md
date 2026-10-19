## 💡 Why @mysql-craft?

Writing direct MySQL code in Node.js applications frequently leads to four recurring architectural liabilities:

1. **SQL Injection Vulnerabilities:** Developers inadvertently concatenate strings or mismanage identifiers in dynamic `WHERE`, `ORDER BY`, or `LIMIT` clauses.
2. **Repetitive CRUD Boilerplate:** Teams spend dozens of hours writing identical controllers, services, and queries for simple database tables.
3. **Connection Starvation & Memory Leaks:** Unbounded connection pools queue incoming requests indefinitely under traffic spikes, causing Node.js processes to run out of memory (OOM) instead of failing fast.
4. **Unhandled Deadlocks & Transient Drops:** MySQL deadlocks (`ER_LOCK_DEADLOCK` / code `1213`) crash concurrent transactions if not wrapped in retry logic.
5. **Credential Leaks in Developer Logs:** Debug statements dump raw SQL queries containing plaintext passwords, hashes, and credit cards directly to stdout.

`@mysql-craft` was engineered from the ground up to eliminate these risks with zero runtime overhead and an exceptional developer experience.

---

## ⚖️ Architectural Comparison

| Feature | Raw `mysql2` | Prisma / TypeORM | Knex.js | `@mysql-craft` |
| :--- | :---: | :---: | :---: | :---: |
| **Instant 1-Line REST Routers** | ❌ No | ❌ No | ❌ No | ✅ **Yes (`createResourceRouter`)** |
| **SQL Injection Proof By Default** | ⚠️ Developer-dependent | ✅ Yes | ✅ Yes | ✅ **Yes (Guaranteed Parameterization)** |
| **Deadlock Retries with Full Jitter** | ❌ No | ❌ Manual | ❌ Manual | ✅ **Built-in (`retries: 3`)** |
| **Bounded Queue (Fail-Fast 503)** | ❌ Infinite queue | ⚠️ Configurable | ⚠️ Configurable | ✅ **Yes (`connectionLimit * 10`)** |
| **Visual Colorized Query Logger** | ❌ None | ⚠️ Third-party | ⚠️ Third-party | ✅ **Built-in Syntax & Timing Badges** |
| **Automated Credential Masking** | ❌ No | ❌ No | ❌ No | ✅ **Built-in (`password`, `token`, etc.)** |
| **Integrated Bcrypt & JWT Auth** | ❌ None | ❌ None | ❌ None | ✅ **Built-in Security Module** |
| **K8s Health & Liveness Checks** | ❌ Manual | ❌ Manual | ❌ Manual | ✅ **Built-in (`healthCheck`, `drain`)** |
| **Engine Footprint** | Lightweight | Heavy (Binary engines) | Medium | ⚡ **Ultra-lightweight (<25KB)** |

---
