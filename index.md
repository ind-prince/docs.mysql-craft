---
layout: home

hero:
  name: "mysql-craft"
  text: "A small MySQL client layer for Node.js and TypeScript."
  tagline: "Parameterized queries, structured SQL helpers, transactions, and optional Express tools."
  actions:
    - theme: brand
      text: Get started
      link: /installation
    - theme: alt
      text: API reference
      link: /api-reference

features:
  - title: Parameterized SQL
    details: Bind values separately from SQL and use escaped identifiers in the structured query helpers.
  - title: One client for queries and transactions
    details: Use the same query, CRUD, select, count, and pagination methods inside or outside a transaction.
  - title: Optional web and operations tools
    details: Add an Express resource router, JWT middleware, pool metrics, retries, and instrumentation where you need them.
---

`mysql-craft` is a Node.js and TypeScript library built on `mysql2/promise`. It keeps SQL visible while providing common database helpers, transaction handling, and optional Express utilities. Start with the [installation guide](/installation), then follow the [quick start](/quick-start).
