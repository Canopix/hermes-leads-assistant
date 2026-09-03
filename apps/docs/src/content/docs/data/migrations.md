---
title: Migrations
description: Versioned runner with legacy DB reconciliation.
template: doc
---

# Schema migrations

**File:** `packages/hermes-dist/plugins/lead-capture/db.py`

## Versioned runner

The `schema_migrations` table records which versions were applied:

```sql
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL
);
```

`ensure_schema(conn)` runs on every `get_connection()`:

```python
def ensure_schema(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (...)")

    applied = {row[0] for row in conn.execute("SELECT version FROM schema_migrations")}

    for version, description, fn in _MIGRATIONS:
        if version in applied:
            continue
        fn(conn)
        conn.execute(
            "INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)",
            (version, description, _now_iso()),
        )
    conn.commit()
```

## Ordered registry

```python
_MIGRATIONS = (
    (1, "base schema: leads + lead_events + indexes", _migration_001_base),
    (2, "manual-override tracking columns", _migration_002_manual_override),
)
```

**Rules:**

- ✅ Append new migrations at the end.
- ❌ Never edit/reorder existing ones — it breaks the contract for already-migrated DBs.
- ✅ Each migration must be idempotent (safe re-run).

## Migration 001 — base

Smart reconciliation of legacy DBs:

```python
def _migration_001_base(conn):
    table_info = conn.execute("PRAGMA table_info(leads)").fetchall()
    if table_info:
        # Legacy table exists — add missing columns
        existing = {row[1] for row in table_info}
        for col_name, col_def in EXPECTED_COLS.items():
            if col_name not in existing:
                conn.execute(f"ALTER TABLE leads ADD COLUMN {col_name} {col_def}")
    else:
        # Fresh — full CREATE TABLE
        conn.execute("CREATE TABLE leads (...)")

    # Same for lead_events
    # Create indexes
```

## Migration 002 — manual override

```python
def _migration_002_manual_override(conn):
    existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(leads)").fetchall()}
    new_cols = {
        "column_source": "TEXT DEFAULT 'llm'",
        "column_locked_at": "TEXT",
        "manual_override": "INTEGER DEFAULT 0",
    }
    for col_name, col_def in new_cols.items():
        if col_name not in existing_cols:
            conn.execute(f"ALTER TABLE leads ADD COLUMN {col_name} {col_def}")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_leads_manual_override ON leads(manual_override)")
```

## Three validated scenarios

Tests cover:

1. **Fresh DB** — applies both migrations, records v1 and v2.
2. **Partial legacy DB** (table exists but columns are missing) — reconciles by adding columns, records versions.
3. **Re-open** — skips already-applied migrations (idempotent).

## Subtle bug found

`executescript()` commits implicitly and, combined with WAL + pending DDL, left newly added columns **invisible** to subsequent statements in some versions of `sqlite3`.

**Fix:** replace `executescript` with individual `execute()` calls. Each `execute` reliably reuses the same txn handle.

```python
# BEFORE (broke):
conn.executescript("CREATE INDEX ...; CREATE INDEX ...;")

# AFTER (stable):
conn.execute("CREATE INDEX ...")
conn.execute("CREATE INDEX ...")
```

## How to add a new migration

1. Append to `_MIGRATIONS`:

   ```python
   _MIGRATIONS = (
       (1, "...", _migration_001_base),
       (2, "...", _migration_002_manual_override),
       (3, "add new field X", _migration_003_x),  # new
   )

   def _migration_003_x(conn):
       existing = {row[1] for row in conn.execute("PRAGMA table_info(leads)").fetchall()}
       if "x" not in existing:
           conn.execute("ALTER TABLE leads ADD COLUMN x TEXT")
   ```

2. If the TS schema also changes, update `packages/shared/src/types/lead.ts` and regenerate `packages/shared/schemas/lead.json` from `schema.py`.

3. The [contract test](./contract-test/) validates that Python and TS match.

4. Run the 3 test scenarios to verify idempotency.
