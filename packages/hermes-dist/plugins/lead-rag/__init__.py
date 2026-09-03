"""lead-rag — client knowledge retrieval with embeddings + optional FTS hybrid."""

from __future__ import annotations

import argparse
import logging
import sqlite3
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import embeddings, fts, rerank, vector_store

logger = logging.getLogger(__name__)

_INDEX_DIR = ".lead-rag"
_SUPPORTED_SUFFIXES = {".md", ".txt", ".json", ".csv", ".html", ".htm"}


def _hermes_home() -> Path:
    try:
        from hermes_constants import get_hermes_home

        return get_hermes_home()
    except Exception:
        import os

        return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))


def _index_dir() -> Path:
    return _hermes_home() / _INDEX_DIR


def _knowledge_dir() -> Path:
    return _hermes_home() / "knowledge"


def _load_rag_config() -> dict[str, Any]:
    try:
        from hermes_cli.config import load_config

        cfg = load_config() or {}
        block = cfg.get("lead_rag") or {}
        return block if isinstance(block, dict) else {}
    except Exception:
        return {}


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
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks


def _read_document(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        logger.warning("lead-rag: could not read %s: %s", path, exc)
        return ""


def _collect_files(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    files: list[Path] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name.startswith("."):
            continue
        if path.suffix.lower() in _SUPPORTED_SUFFIXES or path.suffix == "":
            files.append(path)
    return files


def ingest(knowledge_root: Path | None = None) -> int:
    root = knowledge_root or _knowledge_dir()
    cfg = _load_rag_config()
    backend = str(cfg.get("backend") or "embeddings").lower()
    chunk_size = int(cfg.get("chunk_size") or 800)
    overlap = int(cfg.get("chunk_overlap") or 100)
    batch_size = int(cfg.get("embed_batch_size") or 16)

    index_dir = _index_dir()
    index_dir.mkdir(parents=True, exist_ok=True)
    files = _collect_files(root)

    all_chunks: list[tuple[str, int, str]] = []
    for doc_path in files:
        rel = str(doc_path.relative_to(root))
        raw = _read_document(doc_path)
        if not raw.strip():
            continue
        for idx, chunk in enumerate(_chunk_text(raw, chunk_size, overlap)):
            all_chunks.append((rel, idx, chunk))

    embedded_count = 0
    if backend in ("embeddings", "hybrid"):
        vpath = vector_store._vectors_path(index_dir)
        conn = sqlite3.connect(str(vpath))
        try:
            vector_store.ensure_schema(conn)
            vector_store.clear_index(conn)
            for i in range(0, len(all_chunks), batch_size):
                batch = all_chunks[i : i + batch_size]
                texts = [c[2] for c in batch]
                embs = embeddings.embed_texts(texts)
                for (source, cidx, content), emb in zip(batch, embs, strict=False):
                    if emb:
                        vector_store.insert_chunk(conn, source, cidx, content, emb)
                        embedded_count += 1
            vector_store.set_meta(conn, "last_ingest", datetime.now(UTC).isoformat())
            vector_store.set_meta(conn, "backend", backend)
            vector_store.set_meta(conn, "chunk_count", str(embedded_count or len(all_chunks)))
            conn.commit()
        finally:
            conn.close()

    build_fts = backend in ("fts", "hybrid") or (backend == "embeddings" and embedded_count == 0)
    if build_fts:
        fpath = fts.fts_path(index_dir)
        conn = sqlite3.connect(str(fpath))
        try:
            fts.ensure_fts_schema(conn)
            fts.clear_fts(conn)
            seen_sources = set()
            for source, cidx, content in all_chunks:
                if source not in seen_sources:
                    fts.register_document(conn, source, content)
                    seen_sources.add(source)
                fts.insert_fts_chunk(conn, source, cidx, content)
            conn.commit()
        finally:
            conn.close()

    logger.info("lead-rag: indexed %d chunks (%s) from %s", len(all_chunks), backend, root)
    return len(all_chunks)


def _merge_hybrid(
    vector_hits: Sequence[tuple[str, int, str, float]],
    fts_hits: Sequence[tuple[str, int, str, float]],
    fts_weight: float,
) -> list[tuple[str, int, str, float]]:
    merged: dict[tuple[str, int], tuple[str, float]] = {}
    for source, idx, content, score in vector_hits:
        key = (source, idx)
        merged[key] = (content, score * (1.0 - fts_weight))
    for source, idx, content, score in fts_hits:
        key = (source, idx)
        if key in merged:
            c, s = merged[key]
            merged[key] = (c, s + score * fts_weight)
        else:
            merged[key] = (content, score * fts_weight)
    ranked = [(k[0], k[1], v[0], v[1]) for k, v in merged.items()]
    ranked.sort(key=lambda x: x[3], reverse=True)
    return ranked


def search(
    query: str, top_k: int | None = None, session_id: str = ""
) -> list[tuple[str, int, str, float]]:
    if not query.strip():
        return []
    cfg = _load_rag_config()
    backend = str(cfg.get("backend") or "embeddings").lower()
    retrieval_k = int(cfg.get("retrieval_top_k") or 20)
    final_k = top_k or int(cfg.get("final_top_k") or cfg.get("top_k") or 5)
    fts_weight = float(cfg.get("hybrid_fts_weight") or 0.25)
    index_dir = _index_dir()

    hits: list[tuple[str, int, str, float]] = []

    if backend in ("embeddings", "hybrid"):
        qemb = embeddings.embed_query(query, session_id=session_id)
        if qemb:
            hits = vector_store.search_vectors(index_dir, qemb, top_k=retrieval_k)

    if backend == "fts" or (backend == "hybrid" and not hits):
        hits = fts.search_fts(index_dir, query, top_k=retrieval_k)
    elif backend == "hybrid":
        fts_hits = fts.search_fts(index_dir, query, top_k=retrieval_k)
        hits = _merge_hybrid(hits, fts_hits, fts_weight)

    if backend == "fts":
        hits = fts.search_fts(index_dir, query, top_k=retrieval_k)

    if not hits and backend in ("embeddings", "hybrid"):
        fts_hits = fts.search_fts(index_dir, query, top_k=retrieval_k)
        if fts_hits:
            hits = fts_hits

    hits = rerank.rerank_hits(query, hits, top_k=final_k)
    return hits[:final_k]


def knowledge_status() -> dict[str, Any]:
    index_dir = _index_dir()
    cfg = _load_rag_config()
    status: dict[str, Any] = {
        "backend": str(cfg.get("backend") or "embeddings"),
        "chunk_count": 0,
        "last_ingest": "",
        "vectors_db": str(vector_store._vectors_path(index_dir)),
        "fts_db": str(fts.fts_path(index_dir)),
    }
    vpath = vector_store._vectors_path(index_dir)
    if vpath.is_file():
        conn = sqlite3.connect(str(vpath))
        try:
            vector_store.ensure_schema(conn)
            status["chunk_count"] = vector_store.chunk_count(conn)
            status["last_ingest"] = vector_store.get_meta(conn, "last_ingest")
        finally:
            conn.close()
    return status


def _format_context(hits: Sequence[tuple[str, int, str, float]], client_name: str) -> str:
    if not hits:
        return (
            f"[KNOWLEDGE BASE — {client_name}]\n"
            "No hay documentos indexados o ningún fragmento coincide con la consulta. "
            "Respondé solo con lo que sepas de la memoria del lead; no inventes datos del negocio."
        )
    lines = [f"[KNOWLEDGE BASE — {client_name}]", "Usá SOLO estos fragmentos para datos del negocio:"]
    for source, idx, content, _rank in hits:
        lines.append(f"\n--- {source} (chunk {idx}) ---\n{content.strip()}")
    return "\n".join(lines)


def _on_pre_llm_call(
    user_message: str = "", session_id: str = "", **_: Any
) -> dict[str, str] | None:
    if not user_message or user_message.startswith("[lead-scope:auto-reply]"):
        return None
    try:
        from hermes_cli.config import load_config

        lead_cfg = (load_config() or {}).get("lead_assistant") or {}
        client = str(lead_cfg.get("client_name") or "el negocio")
    except Exception:
        client = "el negocio"
    hits = search(user_message, session_id=session_id)
    return {"context": _format_context(hits, client)}


def _cli_ingest(args: argparse.Namespace) -> int:
    root = Path(args.path).expanduser() if args.path else _knowledge_dir()
    count = ingest(root)
    print(f"lead-rag: indexed {count} chunks from {root}")
    return 0


def _cli_search(args: argparse.Namespace) -> int:
    hits = search(args.query, top_k=args.top_k)
    for source, idx, content, score in hits:
        print(f"[{score:.3f}] {source}#{idx}\n{content[:300]}...\n")
    return 0


def register(ctx) -> None:
    ctx.register_auxiliary_task(
        key="embeddings",
        display_name="Lead RAG embeddings",
        description="Embedding model for client knowledge retrieval",
        defaults={"provider": "custom", "model": "", "base_url": "", "timeout": 60},
    )
    ctx.register_auxiliary_task(
        key="reranker",
        display_name="Lead RAG reranker",
        description="Rerank retrieved knowledge chunks",
        defaults={"provider": "custom", "model": "", "base_url": "", "timeout": 30},
    )
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)

    ctx.register_cli_command(
        name="lead-rag",
        help="Lead RAG — ingest knowledge/ and search the index",
        setup_fn=_cli_setup,
        handler_fn=_cli_handler,
        description="Index client knowledge/ and search with embeddings or hybrid FTS.",
    )


def _cli_setup(subparser: argparse.ArgumentParser) -> None:
    subs = subparser.add_subparsers(dest="rag_command")
    ingest_p = subs.add_parser("ingest", help="Index knowledge/ documents")
    ingest_p.add_argument("--path", help="Override knowledge directory")
    search_p = subs.add_parser("search", help="Search the index")
    search_p.add_argument("query")
    search_p.add_argument("--top-k", type=int, default=5)


def _cli_handler(args: argparse.Namespace) -> int:
    cmd = getattr(args, "rag_command", None)
    if cmd == "ingest":
        return _cli_ingest(args)
    if cmd == "search":
        return _cli_search(args)
    print("Usage: hermes lead-rag <ingest|search>")
    return 1
