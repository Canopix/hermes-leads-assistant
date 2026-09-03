---
title: Why WAL
description: ADR — better-sqlite3 + WAL + synchronous=NORMAL.
template: doc
---

# ADR: better-sqlite3 + WAL

**Status:** Accepted

## Context

The portal (Next.js) and the Hermes plugins (Python) **share** the same `leads.db`:

- Plugins write (every lead extraction).
- The portal reads (every list page, detail, stats) + occasionally writes (manual moves).

Without the right configuration, this leads to "database is locked" under load.

## Decision

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;
```

Drivers: `better-sqlite3` (synchronous) on Node, `sqlite3` stdlib on Python.

## Why WAL

### Reader/writer concurrency

In rollback journal mode (default):

- Writer takes a **RESERVED lock** → readers get blocked.
- Reader takes a **SHARED lock** → writers get blocked.

In WAL:

- Writers append to the WAL file and don't touch the main DB until checkpoint.
- **Multiple readers can read concurrently with a writer.**
- Only writers block each other (one writer at a time).

For the workload (1 bot writing per tenant + portal reads), this is critical.

### Performance

- Reads don't block writes and vice versa.
- Sequential writes to the WAL are fast (append-only).
- Automatic checkpointing when the WAL passes a threshold.

## Why `synchronous=NORMAL`

| Setting | Tradeoff |
|---|---|
| `FULL` (default) | fsync on every txn → survives power loss, but slow |
| `NORMAL` | fsync only at checkpoint → a txn **may** survive power loss, DB is never corrupted |

For a leads workload where losing the last txn in a power crash is acceptable (the bot will re-extract on the next message), `NORMAL` is the sweet spot.

> **Critical:** `NORMAL` **never corrupts the DB**. You can only lose the last non-checkpointed txn. For accounting data you'd need `FULL`.

## Why `busy_timeout=5000`

When a writer holds the lock, others wait up to 5s before failing with `SQLITE_BUSY`. Default is 0 (fail immediately).

For the lead-capture plugin, `BEGIN IMMEDIATE` eagerly takes the write lock. If two extractors run concurrently for the same lead, the second waits up to 5s and then proceeds — instead of failing.

```python
conn.execute("BEGIN IMMEDIATE")
# SELECT existing, INSERT/UPDATE, COMMIT
```

## Why better-sqlite3

In Node.js:

| Driver | API | Performance | Multi-tenancy |
|---|---|---|---|
| `better-sqlite3` | **Synchronous** | Very fast | Simple — opens N handles |
| `sqlite3` (async) | Callbacks/promises | Slower | Requires manual connection pooling |

Synchronous is **better** for this case:

- Each request reads a couple of rows and returns.
- No event loop overhead for I/O.
- No race conditions in the conn pool.

## Connection pool

Before (Phase 0): open/close a handle on every call. Expensive.

Now (Phase 1): LRU handle cache in the portal:

```ts
const DB_CACHE_MAX = 16;
const dbCache = new Map<string, { db: Database; expiry: number; readonly: boolean }>();
// TTL 5 min, readonly flag separates read/write paths
```

- Read path uses `readonly: true` (no WAL switch).
- Write path opens with `readonly: false` (applies PRAGMAs).
- Reopens if the flag changes.

## Py ↔ TS coordination

Both sides apply the **same PRAGMAs** on open:

| PRAGMA | Python (plugin) | Node (portal) |
|---|---|---|
| `journal_mode=WAL` | ✅ | ✅ (write path) |
| `synchronous=NORMAL` | ✅ | ✅ (write path) |
| `busy_timeout=5000` | ✅ | ✅ |

And the plugin uses explicit `BEGIN IMMEDIATE`. The portal uses better-sqlite3's default transactions.

## When to re-evaluate

- **More than one high-frequency writer** → WAL bottleneck → consider Postgres.
- **Multi-region** → Litestream replication or Postgres.
- **Heavy reporting/analytics** → read replica.
