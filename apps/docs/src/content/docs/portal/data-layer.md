---
title: Data layer
description: DB resolution by slug and connection pool.
template: doc
---

# Portal data layer

The portal has **two data layers** in two physical locations. This doc covers the per-tenant one (`lib/db.ts`). For the shared one, see [Auth](../auth/).

## Per-tenant path resolution

**File:** `apps/portal/src/lib/db.ts`

```ts
export function leadsDbPath(slug: string): string | null {
  const safe = safeSlug(slug);  // re-validates ^[a-z0-9-]+$
  const dbPath = path.join(
    getProfilesDir(),
    `${safe}-leads`,
    ".lead-capture",
    "leads.db"
  );
  return fs.existsSync(dbPath) ? dbPath : null;
}
```

| DB | Path |
|---|---|
| Leads | `~/.hermes/profiles/{slug}-leads/.lead-capture/leads.db` |
| Conversation state | `~/.hermes/profiles/{slug}-leads/state.db` |

Returns `null` (does not throw) if the file doesn't exist — callers treat it as "empty".

## Slug hardening

`safeSlug()` re-validates `^[a-z0-9-]+$` before any path join. **Defense in depth**: the upstream check in `resolveTenantContext` is the real gate, but `safeSlug` protects against path traversal if a caller skips it.

## API surface

Every function takes `slug` as its first argument. **There's no global handle or implicit tenant** — forgetting to pass the slug is a compile error.

```ts
// Reads
getLeads(slug)
getLeadById(slug, id)
getLeadStats(slug)
getConversation(slug, sessionId)
getLeadWithConversation(slug, id)

// Writes
updateLeadColumn(slug, id, column, opts)  // sets manual_override=1
clearLeadManualOverride(slug, id)          // sets manual_override=0
```

## Connection pool (LRU cache)

**Important improvement (Phase 1):** previously a connection was opened/closed per call. Now there's an LRU cache.

```ts
const DB_CACHE_MAX = 16;
const dbCache = new Map<string, { db: Database; expiry: number; readonly: boolean }>();

function getDb(path: string, opts: { readonly?: boolean } = {}): Database {
  // cache hit if not expired and flags match
  // otherwise, open a new handle with PRAGMAs and cache it
}
```

| Setting | Value |
|---|---|
| Max entries | 16 |
| TTL | 5 min |
| Read PRAGMAs | `busy_timeout=5000` |
| Write PRAGMAs | + `journal_mode=WAL`, `synchronous=NORMAL` |

If a cached handle has a `readonly` flag different from the one requested, it's closed and reopened.

### `closeAllDbForTests()` and `_evictExpired()`

Exposed for test isolation and manual eviction.

## Auditable writes

`updateLeadColumn` runs in a transaction:

1. UPDATE `leads` setting `kanban_column`, `manual_override=1`, `column_source='manual'`, `column_locked_at`.
2. INSERT into `lead_events` of type `moved_manual` with payload `{from, to}`.

This unifies the portal's audit with the bot's — both write to the same `lead_events` table.

Additionally, the route handler writes an `audit_log` entry in the shared DB via the `audit` closure.

## Reads vs writes

| Function | Readonly | Reason |
|---|---|---|
| `getLeads`, `getLeadById`, `getConversation` | yes | Read-only path |
| `updateLeadColumn`, `clearLeadManualOverride` | no | Write path |

Reads use `readonly: true` → no WAL switch (lighter).

## Tables shared with plugins

The portal **reads the same tables** the Hermes plugins write to:

| Table | Written by | Read by |
|---|---|---|
| `leads` | lead-capture plugin | Portal (read + write for moves) |
| `lead_events` | lead-capture + portal | Portal |
| `schema_migrations` | lead-capture (auto) | None (metadata only) |

**There's no other API** between portal and bot. They share the `.db` file. That's why the WAL PRAGMAs are critical: they allow reader/writer concurrency without "database is locked".

## Coordination with plugins

| Aspect | Portal | lead-capture plugin |
|---|---|---|
| Same file | ✅ | ✅ |
| WAL mode | ✅ | ✅ |
| `synchronous=NORMAL` | ✅ | ✅ |
| `busy_timeout=5000` | ✅ | ✅ |
| Begin transaction mode | `better-sqlite3` default | `BEGIN IMMEDIATE` (explicit) |

`BEGIN IMMEDIATE` in the plugin takes the write lock eagerly → two concurrent extractors can't both pass the "exists?" check and duplicate rows.
