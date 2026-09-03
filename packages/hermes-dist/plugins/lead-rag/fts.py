"""FTS5 fallback index for lead-rag."""

from __future__ import annotations

import hashlib
import re
import sqlite3
from pathlib import Path

_FTS_DB = "index.db"


def fts_path(base_dir: Path) -> Path:
    return base_dir / _FTS_DB


def ensure_fts_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY,
            source TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            UNIQUE(source)
        )
        """
    )
    conn.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
            source, chunk_index, content, tokenize='porter'
        )
        """
    )
    conn.commit()


def clear_fts(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM chunks")
    conn.execute("DELETE FROM documents")
    conn.commit()


def insert_fts_chunk(conn: sqlite3.Connection, source: str, chunk_index: int, content: str) -> None:
    conn.execute(
        "INSERT INTO chunks (source, chunk_index, content) VALUES (?, ?, ?)",
        (source, chunk_index, content),
    )


def register_document(conn: sqlite3.Connection, source: str, raw: str) -> None:
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    conn.execute(
        "INSERT INTO documents (source, content_hash) VALUES (?, ?)",
        (source, digest),
    )


def _tokenize_query(query: str) -> str:
    tokens = re.findall(r"\w+", query.lower())
    return " OR ".join(tokens) if tokens else query


def search_fts(index_dir: Path, query: str, top_k: int = 10) -> list[tuple[str, int, str, float]]:
    path = fts_path(index_dir)
    if not path.is_file() or not query.strip():
        return []
    conn = sqlite3.connect(str(path))
    try:
        rows = conn.execute(
            """
            SELECT source, chunk_index, content, bm25(chunks) AS rank
            FROM chunks WHERE chunks MATCH ? ORDER BY rank LIMIT ?
            """,
            (_tokenize_query(query), top_k),
        ).fetchall()
        # bm25 lower is better — invert for unified scoring
        return [(r[0], int(r[1]), r[2], -float(r[3])) for r in rows]
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()
