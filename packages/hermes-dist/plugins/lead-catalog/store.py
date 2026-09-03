"""SQLite catalog store — one catalog.db per Hermes profile."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import templates

_DB_NAME = "catalog.db"
_SCHEMA_VERSION = 1
_EXPORT_FILENAME = "catalog-generated.md"


def _hermes_home() -> Path:
    try:
        from hermes_constants import get_hermes_home

        return get_hermes_home()
    except Exception:
        import os

        return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))


def db_path(home: Path | None = None) -> Path:
    return (home or _hermes_home()) / _DB_NAME


def knowledge_dir(home: Path | None = None) -> Path:
    return (home or _hermes_home()) / "knowledge"


def export_path(home: Path | None = None) -> Path:
    return knowledge_dir(home) / _EXPORT_FILENAME


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def get_connection(home: Path | None = None) -> sqlite3.Connection:
    path = db_path(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
    except sqlite3.OperationalError:
        pass
    ensure_schema(conn)
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
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


def _m1_init(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            sku TEXT,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            price_amount INTEGER,
            price_currency TEXT NOT NULL DEFAULT 'ARS',
            price_kind TEXT NOT NULL DEFAULT 'fixed',
            summary TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            attrs_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_items_status_price ON items(status, price_amount)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_items_status ON items(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_items_sku ON items(sku)")
    # Default vertical if unset
    row = conn.execute("SELECT value FROM meta WHERE key = 'vertical'").fetchone()
    if not row:
        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('vertical', 'autos')"
        )
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)",
        (str(_SCHEMA_VERSION),),
    )


_MIGRATIONS = (
    (1, "init catalog meta + items", _m1_init),
)


def get_meta(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return str(row["value"]) if row else default


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def get_vertical(conn: sqlite3.Connection) -> str:
    return templates.validate_vertical(get_meta(conn, "vertical", "autos"))


def set_vertical(conn: sqlite3.Connection, vertical: str) -> str:
    v = templates.validate_vertical(vertical)
    set_meta(conn, "vertical", v)
    conn.commit()
    return v


def _row_to_item(row: sqlite3.Row) -> dict[str, Any]:
    attrs: dict[str, Any]
    try:
        attrs = json.loads(row["attrs_json"] or "{}")
        if not isinstance(attrs, dict):
            attrs = {}
    except json.JSONDecodeError:
        attrs = {}
    return {
        "id": row["id"],
        "sku": row["sku"],
        "title": row["title"],
        "status": row["status"],
        "price_amount": row["price_amount"],
        "price_currency": row["price_currency"],
        "price_kind": row["price_kind"],
        "summary": row["summary"] or "",
        "description": row["description"] or "",
        "attrs": attrs,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def count_items(conn: sqlite3.Connection, status: str | None = None) -> int:
    if status:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM items WHERE status = ?", (status,)
        ).fetchone()
    else:
        row = conn.execute("SELECT COUNT(*) AS n FROM items").fetchone()
    return int(row["n"]) if row else 0


def get_item(
    conn: sqlite3.Connection, *, item_id: str | None = None, sku: str | None = None
) -> dict[str, Any] | None:
    if item_id:
        row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    elif sku:
        row = conn.execute("SELECT * FROM items WHERE sku = ?", (sku,)).fetchone()
    else:
        return None
    return _row_to_item(row) if row else None


def search_items(
    conn: sqlite3.Connection,
    *,
    query: str = "",
    status: str | None = "available",
    price_min: int | None = None,
    price_max: int | None = None,
    attrs_eq: dict[str, Any] | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []

    if status:
        clauses.append("status = ?")
        params.append(templates.validate_status(status))

    if price_min is not None:
        clauses.append("price_amount IS NOT NULL AND price_amount >= ?")
        params.append(int(price_min))
    if price_max is not None:
        clauses.append("price_amount IS NOT NULL AND price_amount <= ?")
        params.append(int(price_max))

    q = (query or "").strip()
    if q:
        clauses.append("(title LIKE ? OR summary LIKE ? OR IFNULL(sku, '') LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like])

    for key, value in (attrs_eq or {}).items():
        if value is None or value == "":
            continue
        # Only allow simple attr keys to avoid SQL injection via json path.
        if not isinstance(key, str) or not key.replace("_", "").isalnum():
            continue
        path = "$." + key
        clauses.append("json_extract(attrs_json, ?) = ?")
        params.extend([path, value if not isinstance(value, bool) else value])

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"""
        SELECT * FROM items
        {where}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
    """
    params.extend([max(1, min(int(limit), 100)), max(0, int(offset))])
    rows = conn.execute(sql, params).fetchall()
    return [_row_to_item(r) for r in rows]


def create_item(conn: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    vertical = get_vertical(conn)
    title = str(payload.get("title") or "").strip()
    if not title:
        raise templates.TemplateError("title es obligatorio")

    status = templates.validate_status(str(payload.get("status") or "available"))
    price_kind = templates.validate_price_kind(str(payload.get("price_kind") or "fixed"))
    currency = str(payload.get("price_currency") or "ARS").strip().upper() or "ARS"

    price_amount = payload.get("price_amount")
    if price_kind == "on_request":
        price_amount = None
    elif price_amount is None or price_amount == "":
        raise templates.TemplateError("price_amount es obligatorio salvo price_kind=on_request")
    else:
        price_amount = int(price_amount)
        if price_amount < 0:
            raise templates.TemplateError("price_amount debe ser >= 0")

    attrs = templates.normalize_attrs(vertical, payload.get("attrs") or {})
    now = _now_iso()
    item_id = str(payload.get("id") or uuid.uuid4())
    sku = payload.get("sku")
    sku = str(sku).strip() if sku not in (None, "") else None

    conn.execute(
        """
        INSERT INTO items (
            id, sku, title, status, price_amount, price_currency, price_kind,
            summary, description, attrs_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            item_id,
            sku,
            title,
            status,
            price_amount,
            currency,
            price_kind,
            str(payload.get("summary") or "").strip(),
            str(payload.get("description") or "").strip(),
            json.dumps(attrs, ensure_ascii=False),
            now,
            now,
        ),
    )
    conn.commit()
    item = get_item(conn, item_id=item_id)
    assert item is not None
    return item


def update_item(conn: sqlite3.Connection, item_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    existing = get_item(conn, item_id=item_id)
    if not existing:
        raise templates.TemplateError(f"ítem no encontrado: {item_id}")

    vertical = get_vertical(conn)
    merged = {**existing, **payload}
    if "attrs" in payload:
        merged["attrs"] = payload["attrs"]
    else:
        merged["attrs"] = existing["attrs"]

    title = str(merged.get("title") or "").strip()
    if not title:
        raise templates.TemplateError("title es obligatorio")

    status = templates.validate_status(str(merged.get("status") or "available"))
    price_kind = templates.validate_price_kind(str(merged.get("price_kind") or "fixed"))
    currency = str(merged.get("price_currency") or "ARS").strip().upper() or "ARS"

    price_amount = merged.get("price_amount")
    if price_kind == "on_request":
        price_amount = None
    elif price_amount is None or price_amount == "":
        raise templates.TemplateError("price_amount es obligatorio salvo price_kind=on_request")
    else:
        price_amount = int(price_amount)
        if price_amount < 0:
            raise templates.TemplateError("price_amount debe ser >= 0")

    attrs = templates.normalize_attrs(vertical, merged.get("attrs") or {})
    sku = merged.get("sku")
    sku = str(sku).strip() if sku not in (None, "") else None
    now = _now_iso()

    conn.execute(
        """
        UPDATE items SET
            sku = ?, title = ?, status = ?, price_amount = ?, price_currency = ?,
            price_kind = ?, summary = ?, description = ?, attrs_json = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            sku,
            title,
            status,
            price_amount,
            currency,
            price_kind,
            str(merged.get("summary") or "").strip(),
            str(merged.get("description") or "").strip(),
            json.dumps(attrs, ensure_ascii=False),
            now,
            item_id,
        ),
    )
    conn.commit()
    item = get_item(conn, item_id=item_id)
    assert item is not None
    return item


def delete_item(conn: sqlite3.Connection, item_id: str) -> bool:
    cur = conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
    conn.commit()
    return cur.rowcount > 0


def format_price(item: dict[str, Any]) -> str:
    kind = item.get("price_kind") or "fixed"
    currency = item.get("price_currency") or "ARS"
    amount = item.get("price_amount")
    if kind == "on_request" or amount is None:
        return "A consultar"
    formatted = f"${amount:,}".replace(",", ".")
    if kind == "from":
        return f"Desde {formatted} {currency}"
    return f"{formatted} {currency}"


def item_to_markdown(item: dict[str, Any], vertical: str) -> str:
    labels = templates.field_labels(vertical)
    lines = [f"### {item['title']}", f"- **Precio:** {format_price(item)}"]
    if item.get("sku"):
        lines.append(f"- **SKU:** {item['sku']}")
    lines.append(f"- **Estado:** {item['status']}")
    if item.get("summary"):
        lines.append(f"- **Resumen:** {item['summary']}")
    for key, label in labels.items():
        val = (item.get("attrs") or {}).get(key)
        if val is not None and val != "":
            lines.append(f"- **{label}:** {val}")
    if item.get("description"):
        lines.append("")
        lines.append(item["description"].strip())
    return "\n".join(lines)


def export_rag_markdown(conn: sqlite3.Connection, home: Path | None = None) -> Path:
    """Write knowledge/catalog-generated.md from available (+ reserved) narrative fields."""
    vertical = get_vertical(conn)
    rows = conn.execute(
        """
        SELECT * FROM items
        WHERE status IN ('available', 'reserved')
        ORDER BY title COLLATE NOCASE
        """
    ).fetchall()
    items = [_row_to_item(r) for r in rows]

    header = (
        f"# Catálogo ({vertical})\n\n"
        "Documento generado automáticamente desde el catálogo estructurado.\n"
        "Para precios y disponibilidad exactos el bot debe usar las tools "
        "`catalog_search` / `catalog_get`.\n\n"
    )
    if not items:
        body = "_No hay ítems publicados en el catálogo._\n"
    else:
        body = "\n\n".join(item_to_markdown(it, vertical) for it in items) + "\n"

    path = export_path(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(header + body, encoding="utf-8")
    return path


def init_catalog(vertical: str = "autos", home: Path | None = None) -> Path:
    conn = get_connection(home)
    try:
        set_vertical(conn, vertical)
        return db_path(home)
    finally:
        conn.close()
