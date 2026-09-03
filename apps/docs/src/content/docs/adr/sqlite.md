---
title: Why SQLite
description: ADR — choosing SQLite as the primary database.
template: doc
---

# ADR: SQLite as the primary database

**Status:** Accepted (2025)

## Context

We needed a database for:

- Portal auth (users, sessions).
- Tenant metadata (registry, memberships, audit).
- Per-tenant leads (Kanban, events).
- RAG vectors.
- Lead documents.

## Decision

**SQLite** for everything. No Postgres, no Redis, no Qdrant.

## Reasons

### 1. Physical multi-tenancy

Each tenant gets its own SQLite file. Isolation for free via the filesystem. No need to model `tenant_id` on every table or fight with RLS.

### 2. Single-VPS operation

The deploy is a single server. SQLite shines in that scenario:

- No separate DB process.
- No network/conn pool configuration.
- No DB secret rotation.
- Backup = copy the file.

### 3. Zero cost

No managed DB. SQLite is serverless — one file per tenant, automatic migrations on boot.

### 4. Concurrent reads with WAL

With `journal_mode=WAL`:

- Multiple readers don't block each other.
- A writer doesn't block readers.
- For the workload (1 bot writing per tenant + N portal reads), this is enough.

### 5. better-sqlite3 is synchronous and fast

In Node.js, `better-sqlite3` is **synchronous** — no callback hell, no promises. For an app where each request reads a couple of rows, this greatly simplifies the code and is faster than async drivers at low load.

## Consequences

### Accepted downsides

| Limitation | Mitigation |
|---|---|
| Doesn't scale horizontally (a file can't be sharded) | Single-VPS until it can't take any more |
| Write lock per DB (one writer at a time) | WAL + `busy_timeout` + short writes |
| No read replicas | If needed, Litestream or migrate to Postgres |
| In-memory rate limiter (not shared between processes) | Accepted for a single VPS |

### When to re-evaluate

- **>1 VPS for the portal** → you need a shared rate limiter (Redis) + shared DB.
- **>100 active tenants on one server** → FS I/O contention.
- **>10k leads per tenant** → SQLite still holds up, but index carefully.
- **Multi-region** → Litestream or Postgres with replicas.

## Alternatives considered

- **Postgres + RLS**: more scalable but more ops overhead. Overkill for the current size.
- **Turso / libSQL**: SQLite-compatible with edge replication. Attractive but adds a service dependency.
- **DuckDB**: geared to OLAP, not OLTP. Not applicable.

## Migration path if needed

The data contract is abstracted in `lib/db.ts` (portal) and `db.py` (plugins). Switching backends is feasible:

1. Rewrite the N data layer functions with the new driver.
2. One-shot migration: read each `leads.db` → write to the new backend.
3. Keep the `.db` files as backup.

[See the WAL ADR for configuration details →](./wal/)
