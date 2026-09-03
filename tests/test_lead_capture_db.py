"""Tests for lead-capture db module.

Covers the critical "respect human override" contract:
- Manual moves from the portal set manual_override=1.
- Subsequent LLM extractor calls must NOT overwrite kanban_column when
  manual_override is set, even if temperature diverges.
- Without manual_override, the extractor follows the inferred temperature.
"""

from __future__ import annotations

# The plugin imports `hermes_constants` opportunistically but falls back to
# the HERMES_HOME env var. We set the env var in the fixture before import.
import os
import sqlite3
from datetime import UTC
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolated_hermes_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / ".hermes"
    home.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("HERMES_HOME", str(home))
    # Drop any cached module so HERMES_HOME is re-read on next import.
    import sys
    for key in list(sys.modules):
        if key == "lead_capture_db" or key.startswith("lead_capture_db."):
            del sys.modules[key]
    return home


def _import_db():
    """Import the plugin's db.py by absolute path.

    This avoids pytest collecting __init__.py from the plugin package (which
    uses relative imports that fail outside an import as a package).
    """
    import importlib.util
    import sys

    plugin_db = (
        Path(__file__).resolve().parent.parent
        / "packages"
        / "hermes-dist"
        / "plugins"
        / "lead-capture"
        / "db.py"
    )
    spec = importlib.util.spec_from_file_location("lead_capture_db", plugin_db)
    assert spec and spec.loader, "could not load spec for db.py"
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    # Also inject the module name so internal `from hermes_constants import ...`
    # calls in db.py resolve through the same sys.modules.
    sys.modules["lead_capture_db"] = mod
    return mod


def _set_manual_override(db, lead_id: str, column: str) -> None:
    """Simulate a portal move: set kanban_column + manual_override flags."""
    conn = db.get_connection()
    try:
        from datetime import datetime, timezone
        now = datetime.now(UTC).isoformat(timespec="seconds")
        conn.execute(
            """UPDATE leads
               SET kanban_column = ?,
                   column_source = 'manual',
                   manual_override = 1,
                   column_locked_at = ?
               WHERE id = ?""",
            (column, now, lead_id),
        )
        conn.execute(
            "INSERT INTO lead_events (lead_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)",
            (lead_id, "moved_manual", f'{{"to": "{column}"}}', now),
        )
        conn.commit()
    finally:
        conn.close()


def _get_lead(db, lead_id: str) -> sqlite3.Row:
    conn = db.get_connection()
    try:
        return conn.execute(
            "SELECT id, kanban_column, temperature, manual_override FROM leads WHERE id = ?",
            (lead_id,),
        ).fetchone()
    finally:
        conn.close()


def test_extractor_follows_temperature_in_auto_mode(isolated_hermes_home) -> None:
    db = _import_db()
    lead_id = db.upsert_lead(
        user_id="u1",
        platform="telegram",
        temperature="tibio",
        last_user_message="hola",
        last_assistant_message="buenas",
    )
    # Second extraction with a different temperature and manual_override unset:
    db.upsert_lead(
        user_id="u1",
        platform="telegram",
        temperature="caliente",
        last_user_message="quiero comprar ya",
        last_assistant_message="genial",
    )
    row = _get_lead(db, lead_id)
    assert row["kanban_column"] == "caliente"
    assert row["temperature"] == "caliente"
    assert bool(row["manual_override"]) is False


def test_manual_override_blocks_extractor_from_changing_column(isolated_hermes_home) -> None:
    db = _import_db()
    lead_id = db.upsert_lead(
        user_id="u2",
        platform="telegram",
        temperature="tibio",
        last_user_message="hola",
        last_assistant_message="buenas",
    )

    # Operator drags the lead to "frio" from the portal.
    _set_manual_override(db, lead_id, "frio")

    # The user sends a message that the extractor would classify as "caliente".
    db.upsert_lead(
        user_id="u2",
        platform="telegram",
        temperature="caliente",
        last_user_message="urgente, necesito ya",
        last_assistant_message="ok",
    )

    row = _get_lead(db, lead_id)
    # Column must stay "frio" — manual override wins.
    assert row["kanban_column"] == "frio"
    # But temperature is still recorded for analytics.
    assert row["temperature"] == "caliente"
    assert bool(row["manual_override"]) is True


def test_descartado_is_valid_manual_state(isolated_hermes_home) -> None:
    db = _import_db()
    lead_id = db.upsert_lead(
        user_id="u3",
        platform="telegram",
        temperature="tibio",
        last_user_message="hola",
        last_assistant_message="buenas",
    )
    # Operator discards the lead from the portal.
    _set_manual_override(db, lead_id, "descartado")

    # Even if the LLM later infires "caliente", the column must stay descartado.
    db.upsert_lead(
        user_id="u3",
        platform="telegram",
        temperature="caliente",
        last_user_message="necesito atención urgente",
        last_assistant_message="ok",
    )

    row = _get_lead(db, lead_id)
    assert row["kanban_column"] == "descartado"
    assert row["temperature"] == "caliente"


def test_schema_migration_adds_override_columns_idempotently(isolated_hermes_home) -> None:
    """A DB created before the new columns must gain them on next ensure_schema."""
    db = _import_db()
    # Trigger schema creation.
    db.upsert_lead(
        user_id="u4",
        platform="telegram",
        temperature="tibio",
    )
    # Verify columns exist.
    conn = db.get_connection()
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(leads)").fetchall()}
    finally:
        conn.close()
    assert "column_source" in cols
    assert "column_locked_at" in cols
    assert "manual_override" in cols
