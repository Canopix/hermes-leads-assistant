"""Per-lead document storage and FTS search."""

from __future__ import annotations

import hashlib
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_DOCS_DIR = ".lead-documents"
_DB_NAME = "docs.db"


def _hermes_home() -> Path:
    try:
        from hermes_constants import get_hermes_home

        return get_hermes_home()
    except Exception:
        import os

        return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))


def base_dir() -> Path:
    return _hermes_home() / _DOCS_DIR


def db_path() -> Path:
    return base_dir() / _DB_NAME


def files_dir(user_id: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in user_id) or "unknown"
    return base_dir() / "files" / safe


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def get_connection() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            platform TEXT,
            session_id TEXT,
            filename TEXT NOT NULL,
            source_path TEXT,
            stored_path TEXT,
            content_hash TEXT NOT NULL,
            char_count INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            UNIQUE(user_id, content_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_docs_user ON documents(user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            FOREIGN KEY (document_id) REFERENCES documents(id)
        );
        CREATE INDEX IF NOT EXISTS idx_chunks_user ON chunks(user_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            content,
            user_id UNINDEXED,
            document_id UNINDEXED,
            chunk_index UNINDEXED,
            tokenize='unicode61'
        );
        """
    )
    conn.commit()


def _chunk_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= chunk_size:
        return [text]
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def ingest_document(
    *,
    user_id: str,
    platform: str,
    session_id: str,
    filename: str,
    source_path: str,
    stored_path: str,
    text: str,
    chunk_size: int = 800,
    chunk_overlap: int = 100,
) -> str | None:
    if not user_id or not text.strip():
        return None
    digest = content_hash(text)
    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM documents WHERE user_id = ? AND content_hash = ?",
            (user_id, digest),
        ).fetchone()
        if existing:
            return existing["id"]

        doc_id = str(uuid.uuid4())
        now = _now_iso()
        conn.execute(
            """
            INSERT INTO documents (
                id, user_id, platform, session_id, filename, source_path,
                stored_path, content_hash, char_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                doc_id, user_id, platform or "", session_id or "",
                filename, source_path, stored_path, digest, len(text), now,
            ),
        )
        chunks = _chunk_text(text, chunk_size, chunk_overlap)
        for idx, chunk in enumerate(chunks):
            conn.execute(
                """
                INSERT INTO chunks (document_id, user_id, chunk_index, content)
                VALUES (?, ?, ?, ?)
                """,
                (doc_id, user_id, idx, chunk),
            )
            conn.execute(
                """
                INSERT INTO chunks_fts (content, user_id, document_id, chunk_index)
                VALUES (?, ?, ?, ?)
                """,
                (chunk, user_id, doc_id, idx),
            )
        conn.commit()
        return doc_id
    finally:
        conn.close()


def _fts_query(text: str) -> str:
    import re

    tokens = re.findall(r"[\w\u00c0-\u024f]+", text, flags=re.UNICODE)
    if not tokens:
        return ""
    return " OR ".join(f'"{t}"' for t in tokens[:10])


def search(
    user_id: str,
    query: str,
    top_k: int = 3,
) -> list[tuple[str, str, int, str, float]]:
    """Return (document_id, filename, chunk_index, content, score)."""
    if not user_id or not query.strip():
        return []
    fts_q = _fts_query(query)
    if not fts_q:
        return []
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT
                f.document_id,
                d.filename,
                f.chunk_index,
                f.content,
                bm25(chunks_fts) AS score
            FROM chunks_fts f
            JOIN documents d ON d.id = f.document_id
            WHERE chunks_fts MATCH ? AND f.user_id = ?
            ORDER BY score
            LIMIT ?
            """,
            (fts_q, user_id, top_k),
        ).fetchall()
        return [
            (r["document_id"], r["filename"], int(r["chunk_index"]), r["content"], float(r["score"]))
            for r in rows
        ]
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()


def list_documents(user_id: str, limit: int = 20) -> list[dict[str, Any]]:
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT id, filename, char_count, created_at
            FROM documents WHERE user_id = ?
            ORDER BY created_at DESC LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def stats(user_id: str | None = None) -> dict[str, Any]:
    conn = get_connection()
    try:
        if user_id:
            total = conn.execute(
                "SELECT COUNT(*) FROM documents WHERE user_id = ?", (user_id,)
            ).fetchone()[0]
            chunks = conn.execute(
                "SELECT COUNT(*) FROM chunks WHERE user_id = ?", (user_id,)
            ).fetchone()[0]
            return {"user_id": user_id, "documents": total, "chunks": chunks}
        total = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        users = conn.execute("SELECT COUNT(DISTINCT user_id) FROM documents").fetchone()[0]
        return {"documents": total, "leads_with_docs": users}
    finally:
        conn.close()
