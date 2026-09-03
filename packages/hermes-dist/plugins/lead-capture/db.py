"""SQLite persistence for captured leads — shared by lead-capture and lead-dashboard."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_CAPTURE_DIR = ".lead-capture"
_DB_NAME = "leads.db"

KANBAN_COLUMNS = (
    {"id": "frio", "label": "Frío"},
    {"id": "tibio", "label": "Tibio"},
    {"id": "caliente", "label": "Caliente"},
)

# frio/tibio/caliente are assigned by the LLM extractor.
# descartado is a manual-only state (operator discards a lead from the portal).
# The extractor never assigns "descartado", but we treat it as a valid column
# so manual moves to descartado are respected and never auto-revived.
VALID_COLUMNS = {c["id"] for c in KANBAN_COLUMNS} | {"descartado"}
VALID_TEMPERATURES = {c["id"] for c in KANBAN_COLUMNS}
VALID_URGENCY = {"low", "medium", "high"}


def _hermes_home() -> Path:
    try:
        from hermes_constants import get_hermes_home

        return get_hermes_home()
    except Exception:
        import os

        return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))


def db_path() -> Path:
    return _hermes_home() / _CAPTURE_DIR / _DB_NAME


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def get_connection() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=5.0)
    conn.row_factory = sqlite3.Row
    # WAL lets the Hermes extractor (writer) and the portal (reader/writer)
    # work concurrently without "database is locked" under normal load.
    # NORMAL sync is the safe companion: a single txn may survive a power
    # loss, but the DB never goes corrupt. See sqlite.org/wal.html.
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
    except sqlite3.OperationalError:
        # PRAGMAs can fail on locked / read-only DBs; don't block the caller.
        pass
    ensure_schema(conn)
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Apply pending schema migrations in order.

    Each migration is idempotent (IF NOT EXISTS / PRAGMA checks), so running
    one against a DB that already has its effects is a no-op. The
    schema_migrations table records which versions have been applied so
    we skip the work on subsequent connections. Existing tenant DBs created
    before this runner was introduced will simply run all migrations once
    (cheaply, since each no-ops) and then record them.
    """
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
        """
    )
    applied = {
        row[0]
        for row in conn.execute("SELECT version FROM schema_migrations").fetchall()
    }
    for version, description, fn in _MIGRATIONS:
        if version in applied:
            continue
        fn(conn)
        conn.execute(
            "INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)",
            (version, description, _now_iso()),
        )
    conn.commit()


def _migration_001_base(conn: sqlite3.Connection) -> None:
    # Detect partial-legacy tables (created before the migration runner
    # existed). We reconcile them to the full v1 schema instead of assuming
    # CREATE TABLE IF NOT EXISTS will fix everything — the table may exist
    # but be missing columns or indexes that v1 expects.
    table_info = conn.execute("PRAGMA table_info(leads)").fetchall()
    if table_info:
        # Table already exists from a legacy install. Add any missing v1 columns.
        existing = {row[1] for row in table_info}
        expected_cols = {
            "id": "TEXT PRIMARY KEY",
            "user_id": "TEXT NOT NULL DEFAULT ''",
            "session_id": "TEXT",
            "platform": "TEXT",
            "name": "TEXT",
            "email": "TEXT",
            "phone": "TEXT",
            "interest": "TEXT",
            "urgency": "TEXT DEFAULT 'medium'",
            "temperature": "TEXT DEFAULT 'tibio'",
            "kanban_column": "TEXT DEFAULT 'tibio'",
            "position": "REAL DEFAULT 0",
            "summary": "TEXT",
            "notes": "TEXT",
            "last_user_message": "TEXT",
            "last_assistant_message": "TEXT",
            "raw_extraction": "TEXT",
            "last_extracted_at": "TEXT",
            "created_at": "TEXT",
            "updated_at": "TEXT",
        }
        for col_name, col_def in expected_cols.items():
            if col_name not in existing:
                conn.execute(f"ALTER TABLE leads ADD COLUMN {col_name} {col_def}")
    else:
        conn.execute(
            """
            CREATE TABLE leads (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                session_id TEXT,
                platform TEXT,
                name TEXT,
                email TEXT,
                phone TEXT,
                interest TEXT,
                urgency TEXT DEFAULT 'medium',
                temperature TEXT DEFAULT 'tibio',
                kanban_column TEXT DEFAULT 'tibio',
                position REAL DEFAULT 0,
                summary TEXT,
                notes TEXT,
                last_user_message TEXT,
                last_assistant_message TEXT,
                raw_extraction TEXT,
                last_extracted_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, platform)
            )
            """
        )
    # Individual execute() calls rather than executescript(): the latter can
    # issue an implicit COMMIT that, combined with WAL + pending DDL, leaves
    # newly-added columns invisible to subsequent statements in some sqlite3
    # versions. Plain execute() reuses the same txn handle reliably.
    conn.execute("CREATE INDEX IF NOT EXISTS idx_leads_column ON leads(kanban_column, position)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_leads_user ON leads(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_leads_updated_at ON leads(updated_at)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS lead_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (lead_id) REFERENCES leads(id)
        )
        """
    )
    # Reconcile lead_events the same way — a legacy install may have created
    # the table with a subset of columns.
    events_info = conn.execute("PRAGMA table_info(lead_events)").fetchall()
    if events_info:
        ev_existing = {row[1] for row in events_info}
        ev_expected = {
            "created_at": "TEXT",
            "event_type": "TEXT DEFAULT ''",
            "lead_id": "TEXT DEFAULT ''",
            "payload": "TEXT",
        }
        for col_name, col_def in ev_expected.items():
            if col_name not in ev_existing:
                conn.execute(f"ALTER TABLE lead_events ADD COLUMN {col_name} {col_def}")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON lead_events(lead_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_lead_events_lead_created ON lead_events(lead_id, created_at)")


def _migration_002_manual_override(conn: sqlite3.Connection) -> None:
    # Add columns for manual-override tracking. Idempotent: skip if column
    # already exists (PRAGMA table_info returns existing columns).
    existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(leads)").fetchall()}
    new_cols = {
        "column_source": "TEXT DEFAULT 'llm'",
        "column_locked_at": "TEXT",
        "manual_override": "INTEGER DEFAULT 0",
    }
    for col_name, col_def in new_cols.items():
        if col_name not in existing_cols:
            conn.execute(f"ALTER TABLE leads ADD COLUMN {col_name} {col_def}")
    # Commit the ALTERs so the index statement below sees the new column.
    conn.commit()
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_leads_manual_override ON leads(manual_override)"
    )


# Ordered migration registry. Append new migrations here; never edit or
# reorder existing entries — that breaks the version contract for tenant
# DBs that have already recorded earlier versions as applied.
_MIGRATIONS = (
    (1, "base schema: leads + lead_events + indexes", _migration_001_base),
    (2, "manual-override tracking columns", _migration_002_manual_override),
)


def parse_user_id_from_session(session_id: str) -> str:
    if not session_id:
        return ""
    parts = session_id.split(":")
    return parts[-1] if parts else session_id


def _normalize_column(value: str | None, default: str = "tibio") -> str:
    v = (value or default).strip().lower()
    return v if v in VALID_COLUMNS else default


def _next_position(conn: sqlite3.Connection, column: str) -> float:
    row = conn.execute(
        "SELECT COALESCE(MAX(position), 0) + 1 FROM leads WHERE kanban_column = ?",
        (column,),
    ).fetchone()
    return float(row[0] if row else 0)


def log_event(
    conn: sqlite3.Connection,
    lead_id: str,
    event_type: str,
    payload: dict[str, Any] | None = None,
) -> None:
    conn.execute(
        "INSERT INTO lead_events (lead_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)",
        (lead_id, event_type, json.dumps(payload or {}), _now_iso()),
    )


def upsert_lead(
    *,
    user_id: str,
    platform: str,
    session_id: str = "",
    name: str = "",
    email: str = "",
    phone: str = "",
    interest: str = "",
    urgency: str = "medium",
    temperature: str = "tibio",
    summary: str = "",
    last_user_message: str = "",
    last_assistant_message: str = "",
    raw_extraction: dict[str, Any] | None = None,
    default_column: str = "tibio",
    preserve_manual_column: bool = True,
) -> str:
    """Upsert lead by user_id+platform. Returns lead id.

    Uses BEGIN IMMEDIATE so two concurrent extractor runs for the same lead
    cannot both pass the "existing?" check and produce duplicate rows (the
    UNIQUE(user_id, platform) constraint would otherwise fire as an
    IntegrityError mid-INSERT). BEGIN IMMEDIATE acquires the write lock
    eagerly; PRAGMA busy_timeout=5000 lets the second caller wait up to 5s
    instead of failing with "database is locked".
    """
    if not user_id:
        user_id = parse_user_id_from_session(session_id) or str(uuid.uuid4())

    urgency = urgency if urgency in VALID_URGENCY else "medium"
    temperature = _normalize_column(temperature, default_column)
    now = _now_iso()

    conn = get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute(
            "SELECT id, kanban_column, temperature, manual_override FROM leads WHERE user_id = ? AND platform = ?",
            (user_id, platform or ""),
        ).fetchone()

        if existing:
            lead_id = existing["id"]
            prev_column = existing["kanban_column"]
            # manual_override may be NULL/missing on legacy rows; treat as 0.
            try:
                manual_override = bool(existing["manual_override"])
            except (KeyError, IndexError):
                manual_override = False

            # Strict human override: if an operator moved this lead from the
            # portal, the LLM never overwrites kanban_column. We still persist
            # the inferred temperature (for analytics) and the conversation
            # metadata, but the board position is locked.
            if manual_override:
                column = prev_column
            elif not preserve_manual_column:
                column = temperature
            else:
                # Default: in auto mode, follow the inferred temperature.
                column = temperature

            conn.execute(
                """
                UPDATE leads SET
                    session_id = COALESCE(?, session_id),
                    name = CASE WHEN ? != '' THEN ? ELSE name END,
                    email = CASE WHEN ? != '' THEN ? ELSE email END,
                    phone = CASE WHEN ? != '' THEN ? ELSE phone END,
                    interest = CASE WHEN ? != '' THEN ? ELSE interest END,
                    urgency = ?,
                    temperature = ?,
                    kanban_column = ?,
                    summary = CASE WHEN ? != '' THEN ? ELSE summary END,
                    last_user_message = ?,
                    last_assistant_message = ?,
                    raw_extraction = ?,
                    last_extracted_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    session_id or None,
                    name, name,
                    email, email,
                    phone, phone,
                    interest, interest,
                    urgency,
                    temperature,
                    column,
                    summary, summary,
                    last_user_message,
                    last_assistant_message,
                    json.dumps(raw_extraction or {}),
                    now,
                    now,
                    lead_id,
                ),
            )
            log_event(
                conn,
                lead_id,
                "extracted",
                {
                    "temperature": temperature,
                    "urgency": urgency,
                    "column_locked": manual_override,
                    **({"inferred_column": temperature} if manual_override and temperature != prev_column else {}),
                },
            )
            conn.commit()
            return lead_id

        lead_id = str(uuid.uuid4())
        column = _normalize_column(temperature, default_column)
        position = _next_position(conn, column)
        conn.execute(
            """
            INSERT INTO leads (
                id, user_id, session_id, platform, name, email, phone, interest,
                urgency, temperature, kanban_column, position, summary,
                last_user_message, last_assistant_message, raw_extraction,
                last_extracted_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                lead_id, user_id, session_id, platform or "",
                name, email, phone, interest,
                urgency, temperature, column, position, summary,
                last_user_message, last_assistant_message,
                json.dumps(raw_extraction or {}),
                now, now, now,
            ),
        )
        log_event(conn, lead_id, "created", {"temperature": temperature})
        conn.commit()
        return lead_id
    finally:
        conn.close()


def list_leads_by_column() -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {c["id"]: [] for c in KANBAN_COLUMNS}
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM leads ORDER BY kanban_column, position ASC, updated_at DESC"
        ).fetchall()
        for row in rows:
            col = row["kanban_column"] or "tibio"
            if col not in result:
                result[col] = []
            result[col].append(_row_to_dict(row))
    finally:
        conn.close()
    return result


def get_lead(lead_id: str) -> dict[str, Any] | None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM leads WHERE id = ?", (lead_id,)).fetchone()
        if not row:
            return None
        data = _row_to_dict(row)
        events = conn.execute(
            "SELECT event_type, payload, created_at FROM lead_events WHERE lead_id = ? ORDER BY id DESC LIMIT 50",
            (lead_id,),
        ).fetchall()
        data["events"] = [
            {"event_type": e["event_type"], "payload": json.loads(e["payload"] or "{}"), "created_at": e["created_at"]}
            for e in events
        ]
        return data
    finally:
        conn.close()


def update_lead(lead_id: str, fields: dict[str, Any]) -> bool:
    allowed = {"name", "email", "phone", "interest", "urgency", "summary", "notes", "temperature"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return False
    if "temperature" in updates:
        updates["temperature"] = _normalize_column(str(updates["temperature"]))
    sets = ", ".join(f"{k} = ?" for k in updates)
    vals = list(updates.values()) + [_now_iso(), lead_id]
    conn = get_connection()
    try:
        cur = conn.execute(f"UPDATE leads SET {sets}, updated_at = ? WHERE id = ?", vals)
        if cur.rowcount:
            log_event(conn, lead_id, "updated", updates)
            conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def move_lead(lead_id: str, column: str, position: float) -> bool:
    column = _normalize_column(column)
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE leads SET kanban_column = ?, position = ?, temperature = ?, updated_at = ? WHERE id = ?",
            (column, position, column, _now_iso(), lead_id),
        )
        if cur.rowcount:
            log_event(conn, lead_id, "moved", {"column": column, "position": position})
            conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def get_stats() -> dict[str, Any]:
    conn = get_connection()
    try:
        total = conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
        by_col = {
            row[0]: row[1]
            for row in conn.execute(
                "SELECT kanban_column, COUNT(*) FROM leads GROUP BY kanban_column"
            ).fetchall()
        }
        today = conn.execute(
            "SELECT COUNT(*) FROM leads WHERE date(created_at) = date('now')"
        ).fetchone()[0]
    finally:
        conn.close()
    return {"total": total, "by_column": by_col, "created_today": today}


def should_throttle_extract(user_id: str, platform: str, min_interval: int) -> bool:
    if min_interval <= 0:
        return False
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT last_extracted_at FROM leads WHERE user_id = ? AND platform = ?",
            (user_id, platform or ""),
        ).fetchone()
        if not row or not row["last_extracted_at"]:
            return False
        try:
            last = datetime.fromisoformat(row["last_extracted_at"])
            if last.tzinfo is None:
                last = last.replace(tzinfo=UTC)
            elapsed = (datetime.now(UTC) - last).total_seconds()
            return elapsed < min_interval
        except Exception:
            return False
    finally:
        conn.close()


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row}
