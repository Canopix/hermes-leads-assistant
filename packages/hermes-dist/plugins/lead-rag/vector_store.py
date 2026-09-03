"""Vector storage and cosine search for lead-rag.

Two backends are supported:
  * **ann** (preferred): `sqlite-vec` virtual tables. O(log N) cosine search
    using an approximate nearest-neighbour index. Requires the optional
    `sqlite-vec` package — installed in the per-profile venv via
    `requirements.txt`. Falls back automatically if unavailable.
  * **brute** (default): load all rows into Python, compute cosine in a loop.
    O(N) per query. Fine up to a few thousand chunks; becomes unusably slow
    past that. Kept as the safety net because the existing per-profile vectors
    DBs were authored before sqlite-vec existed.

The schema is identical for both backends: the `chunks` table stores
embeddings as JSON for portability. When `sqlite-vec` is available, an extra
`vec_chunks` virtual table mirrors the same rows in native float32 format
and is the source of truth for search; the `chunks` table remains the source
of truth for storage.
"""

from __future__ import annotations

import contextlib
import json
import math
import sqlite3
from collections.abc import Sequence
from pathlib import Path

_VECTORS_DB = "vectors.db"


def _vectors_path(base_dir: Path) -> Path:
    return base_dir / _VECTORS_DB


# ---- Optional sqlite-vec bootstrap ------------------------------------------
# `sqlite-vec` exposes a loadable extension. If it cannot be loaded (package
# not installed, or platform unsupported), the module-level `_VEC_AVAILABLE`
# flag stays False and every search call transparently falls back to the
# brute-force path. This means existing per-profile vectors.db files keep
# working unchanged on hosts that don't have sqlite-vec.

_VEC_AVAILABLE = False
_VEC_LOAD_ERRORS: list[str] = []


def _try_enable_vec(conn: sqlite3.Connection) -> bool:
    """Enable sqlite-vec on `conn` if possible. Idempotent + cached."""
    global _VEC_AVAILABLE
    if _VEC_AVAILABLE:
        try:
            conn.enable_load_extension(True)
            import sqlite_vec  # type: ignore[import-not-found]

            conn.load_extension(sqlite_vec.loadable_path())
            conn.enable_load_extension(False)
        except Exception as e:  # noqa: BLE001
            _VEC_LOAD_ERRORS.append(f"{type(e).__name__}: {e}")
            return False
        return True
    return False


def _probe_vec_available() -> bool:
    """Probe whether sqlite-vec can be loaded on this Python. Called once."""
    global _VEC_AVAILABLE
    try:
        import sqlite_vec  # type: ignore[import-not-found]
    except Exception as e:  # noqa: BLE001
        _VEC_LOAD_ERRORS.append(f"import: {type(e).__name__}: {e}")
        return False
    probe = sqlite3.connect(":memory:")
    try:
        probe.enable_load_extension(True)
        probe.load_extension(sqlite_vec.loadable_path())
        probe.enable_load_extension(False)
        # Smoke-test the vec0 virtual table actually loads.
        probe.execute("CREATE VIRTUAL TABLE IF NOT EXISTS probe USING vec0(dummy float[1])")
        _VEC_AVAILABLE = True
        return True
    except Exception as e:  # noqa: BLE001
        _VEC_LOAD_ERRORS.append(f"runtime: {type(e).__name__}: {e}")
        return False
    finally:
        probe.close()


def vec_available() -> bool:
    """Public probe — RAG plugin uses this to log which backend is active."""
    if not _VEC_LOAD_ERRORS:
        _probe_vec_available()
    return _VEC_AVAILABLE


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            embedding TEXT NOT NULL,
            dims INTEGER NOT NULL,
            UNIQUE(source, chunk_index)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT
        )
        """
    )
    conn.commit()


def _ensure_vec_index(conn: sqlite3.Connection, dims: int) -> bool:
    """Create the vec_chunks virtual table mirroring `chunks`. Returns True
    if the index is usable on this connection."""
    if not _try_enable_vec(conn):
        return False
    conn.execute(
        f"""
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
            id INTEGER PRIMARY KEY,
            embedding float[{int(dims)}]
        )
        """
    )
    conn.commit()
    return True


def clear_index(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM chunks")
    with contextlib.suppress(sqlite3.OperationalError):
        conn.execute("DELETE FROM vec_chunks")
        # vec_chunks virtual table may not exist (sqlite-vec missing or
        # never indexed). Safe to ignore — chunks is the canonical store.
    conn.commit()


def insert_chunk(
    conn: sqlite3.Connection,
    source: str,
    chunk_index: int,
    content: str,
    embedding: Sequence[float],
) -> None:
    """Insert into `chunks` (canonical) and, if sqlite-vec is loaded, into
    `vec_chunks` (search index). The JSON column is always written so the
    row survives a backend switch."""
    cur = conn.execute(
        """
        INSERT OR REPLACE INTO chunks (source, chunk_index, content, embedding, dims)
        VALUES (?, ?, ?, ?, ?)
        """,
        (source, chunk_index, content, json.dumps(embedding), len(embedding)),
    )
    if _try_enable_vec(conn):
        try:
            # Mirror into vec_chunks. ON CONFLICT not supported on vec0 —
            # delete first to keep id stable.
            row_id = cur.lastrowid
            existing = conn.execute(
                "SELECT id FROM chunks WHERE source = ? AND chunk_index = ?",
                (source, chunk_index),
            ).fetchone()
            if existing:
                row_id = existing[0]
                with contextlib.suppress(sqlite3.OperationalError):
                    conn.execute("DELETE FROM vec_chunks WHERE id = ?", (row_id,))
            # Ensure the virtual table exists with the right dimensionality.
            _ensure_vec_index(conn, len(embedding))
            conn.execute(
                "INSERT INTO vec_chunks (id, embedding) VALUES (?, ?)",
                (row_id, _to_float32_bytes(embedding)),
            )
            conn.commit()
        except sqlite3.OperationalError:
            # Index is best-effort; canonical row already written.
            pass


def _to_float32_bytes(embedding: Sequence[float]) -> bytes:
    import struct

    return struct.pack(f"{len(embedding)}f", *embedding)


def _from_float32_bytes(data: bytes, dims: int) -> list[float]:
    import struct

    return list(struct.unpack(f"{dims}f", data))


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
        (key, value),
    )


def get_meta(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else default


def chunk_count(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()
    return int(row[0]) if row else 0


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _search_ann(
    conn: sqlite3.Connection,
    query_embedding: Sequence[float],
    top_k: int,
) -> list[tuple[str, int, str, float]] | None:
    """Search via sqlite-vec. Returns None if the backend is unavailable on
    this connection, so the caller can fall back to brute-force."""
    if not _try_enable_vec(conn):
        return None
    dims = len(query_embedding)
    if not _ensure_vec_index(conn, dims):
        return None
    try:
        rows = conn.execute(
            """
            SELECT c.source, c.chunk_index, c.content, v.distance
            FROM vec_chunks v
            JOIN chunks c ON c.id = v.id
            WHERE v.embedding MATCH ?
              AND k = ?
            ORDER BY v.distance
            """,
            (_to_float32_bytes(query_embedding), max(1, int(top_k))),
        ).fetchall()
    except sqlite3.OperationalError:
        return None
    # sqlite-vec returns cosine *distance* (1 - similarity) for the cosine
    # metric; convert back to similarity for a consistent score contract
    # with the brute-force path.
    return [
        (src, int(idx), content, max(0.0, 1.0 - float(dist)))
        for src, idx, content, dist in rows
    ]


def _search_brute(
    conn: sqlite3.Connection,
    query_embedding: Sequence[float],
    top_k: int,
) -> list[tuple[str, int, str, float]]:
    rows = conn.execute(
        "SELECT source, chunk_index, content, embedding FROM chunks"
    ).fetchall()
    scored: list[tuple[str, int, str, float]] = []
    for source, idx, content, emb_json in rows:
        try:
            emb = json.loads(emb_json)
        except (json.JSONDecodeError, TypeError):
            continue
        score = _cosine(query_embedding, emb)
        scored.append((source, int(idx), content, score))
    scored.sort(key=lambda x: x[3], reverse=True)
    return scored[:top_k]


def search_vectors(
    index_dir: Path,
    query_embedding: Sequence[float],
    top_k: int = 20,
) -> list[tuple[str, int, str, float]]:
    path = _vectors_path(index_dir)
    if not path.is_file():
        return []
    conn = sqlite3.connect(str(path))
    try:
        ensure_schema(conn)
        # Try ANN first; fall back to brute-force if sqlite-vec is missing
        # or the virtual table was never populated.
        ann_result = _search_ann(conn, query_embedding, top_k)
        if ann_result is not None:
            return ann_result
        return _search_brute(conn, query_embedding, top_k)
    finally:
        conn.close()
