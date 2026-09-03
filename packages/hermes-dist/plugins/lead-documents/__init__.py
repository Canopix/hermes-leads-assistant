"""lead-documents — per-lead document ingestion and retrieval."""

from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path
from typing import Any

from . import extractor, store

logger = logging.getLogger(__name__)

_PATH_NOTE_RE = re.compile(
    r"\[The user sent (?:a text )?document: '([^']+)'\.[^\]]*saved at: ([^\]]+)\]",
    re.IGNORECASE,
)


def _load_config() -> dict[str, Any]:
    try:
        from hermes_cli.config import load_config

        cfg = load_config() or {}
        block = cfg.get("lead_documents") or {}
        return block if isinstance(block, dict) else {}
    except Exception:
        return {}


def _user_id_from_event(event: Any) -> str:
    source = getattr(event, "source", None)
    if source is not None:
        uid = getattr(source, "user_id", None)
        if uid:
            return str(uid)
    return ""


def _user_id_from_session(session_id: str) -> str:
    if not session_id:
        return ""
    parts = session_id.split(":")
    return parts[-1] if parts else session_id


def _platform_from_event(event: Any) -> str:
    source = getattr(event, "source", None)
    if source is None:
        return ""
    platform = getattr(source, "platform", None)
    if platform is None:
        return ""
    return str(getattr(platform, "value", platform) or "")


def _session_id_from_event(event: Any) -> str:
    try:
        from gateway.session import build_session_key

        source = getattr(event, "source", None)
        if source is None:
            return ""
        return build_session_key(source)
    except Exception:
        return ""


def _document_cache_roots() -> list[Path]:
    roots: list[Path] = []
    try:
        from hermes_constants import get_hermes_dir, get_hermes_home

        roots.append(get_hermes_dir("cache/documents", "document_cache"))
        roots.append(get_hermes_home() / "cache")
        roots.append(get_hermes_home() / "cache" / "documents")
    except Exception:
        pass
    roots.append(Path.home() / ".hermes" / "cache" / "documents")
    roots.append(Path.home() / ".hermes" / "document_cache")
    seen = set()
    out: list[Path] = []
    for r in roots:
        try:
            key = str(r.resolve())
        except Exception:
            key = str(r)
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def _safe_cache_path(path: str) -> Path | None:
    if not path:
        return None
    try:
        p = Path(path).expanduser().resolve()
    except Exception:
        return None
    if not p.is_file():
        return None
    for root in _document_cache_roots():
        try:
            root = root.resolve()
            if p == root or root in p.parents:
                return p
        except Exception:
            continue
    return None


def _process_file(
    *,
    path: Path,
    user_id: str,
    platform: str,
    session_id: str,
    cfg: dict[str, Any],
) -> str | None:
    max_mb = float(cfg.get("max_file_mb") or 10)
    max_chars = int(cfg.get("max_extract_chars") or 50_000)
    if path.stat().st_size > max_mb * 1024 * 1024:
        logger.info("lead-documents: skip oversized file %s", path)
        return None

    ext = path.suffix.lower()
    if ext not in extractor.supported_extensions():
        return None

    text = extractor.extract_text(path, max_chars=max_chars)
    if not text.strip():
        return None

    dest_dir = store.files_dir(user_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    filename = extractor.display_name_from_path(path)
    dest = dest_dir / f"{path.stat().st_mtime_ns}_{filename}"
    if not dest.exists():
        shutil.copy2(path, dest)

    doc_id = store.ingest_document(
        user_id=user_id,
        platform=platform,
        session_id=session_id,
        filename=filename,
        source_path=str(path),
        stored_path=str(dest),
        text=text,
        chunk_size=int(cfg.get("chunk_size") or 800),
        chunk_overlap=int(cfg.get("chunk_overlap") or 100),
    )
    return doc_id


def _ingest_from_event(event: Any, cfg: dict[str, Any]) -> list[str]:
    user_id = _user_id_from_event(event)
    if not user_id:
        return []

    platform = _platform_from_event(event)
    session_id = _session_id_from_event(event)
    ingested: list[str] = []

    media_urls = getattr(event, "media_urls", None) or []
    for raw_path in media_urls:
        safe = _safe_cache_path(str(raw_path))
        if not safe:
            continue
        doc_id = _process_file(
            path=safe,
            user_id=user_id,
            platform=platform,
            session_id=session_id,
            cfg=cfg,
        )
        if doc_id:
            ingested.append(doc_id)

    return ingested


def _ingest_from_message_text(
    user_message: str,
    user_id: str,
    platform: str,
    session_id: str,
    cfg: dict[str, Any],
) -> list[str]:
    if not user_message or not user_id:
        return []
    ingested: list[str] = []
    for match in _PATH_NOTE_RE.finditer(user_message):
        _filename, raw_path = match.group(1), match.group(2).strip()
        safe = _safe_cache_path(raw_path)
        if not safe:
            continue
        doc_id = _process_file(
            path=safe,
            user_id=user_id,
            platform=platform,
            session_id=session_id,
            cfg=cfg,
        )
        if doc_id:
            ingested.append(doc_id)
    return ingested


def _format_context(
    hits: list[tuple],
    docs: list[dict[str, Any]],
    client_name: str,
) -> str:
    lines = [
        f"[DOCUMENTOS DEL LEAD — {client_name}]",
        "El lead envió archivos en esta conversación. Usá SOLO estos fragmentos para responder sobre esos documentos:",
    ]
    if docs and not hits:
        for d in docs[:5]:
            lines.append(f"- {d.get('filename')} ({d.get('char_count', 0)} caracteres)")
    for _doc_id, filename, chunk_idx, content, _score in hits:
        lines.append(f"\n--- {filename} (fragmento {chunk_idx}) ---\n{content.strip()}")
    return "\n".join(lines)


def _on_pre_gateway_dispatch(
    event: Any = None,
    **_: Any,
) -> dict[str, Any] | None:
    cfg = _load_config()
    if cfg.get("enabled") is False or not event:
        return None

    ingested = _ingest_from_event(event, cfg)
    if not ingested:
        return None

    logger.info("lead-documents: ingested %d document(s) for user", len(ingested))
    return None


def _on_pre_llm_call(
    session_id: str = "",
    user_message: str = "",
    platform: str = "",
    sender_id: str = "",
    **_: Any,
) -> dict[str, str] | None:
    cfg = _load_config()
    if cfg.get("enabled") is False:
        return None

    user_id = sender_id or _user_id_from_session(session_id)
    if not user_id:
        return None

    _ingest_from_message_text(user_message, user_id, platform, session_id, cfg)

    if not user_message or user_message.startswith("[lead-scope:auto-reply]"):
        return None

    docs = store.list_documents(user_id, limit=10)
    if not docs:
        return None

    top_k = int(cfg.get("inject_top_k") or 3)
    hits = store.search(user_id, user_message, top_k=top_k)
    if not hits and not docs:
        return None

    try:
        from hermes_cli.config import load_config

        lead_cfg = (load_config() or {}).get("lead_assistant") or {}
        client = str(lead_cfg.get("client_name") or "el negocio")
    except Exception:
        client = "el negocio"

    return {"context": _format_context(hits, docs, client)}


def register(ctx) -> None:
    ctx.register_hook("pre_gateway_dispatch", _on_pre_gateway_dispatch)
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)

    def _cli_setup(_sub) -> None:
        pass

    ctx.register_cli_command(
        name="lead-documents",
        help="Per-lead document index — stats and search",
        setup_fn=_cli_setup,
        handler_fn=_dispatch_cli,
        description="Documents uploaded by leads during conversations.",
    )


def _dispatch_cli(args: list) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog="lead-documents")
    sub = parser.add_subparsers(dest="command")
    stats_p = sub.add_parser("stats", help="Document index stats")
    stats_p.add_argument("--user-id")
    search_p = sub.add_parser("search", help="Search a lead's documents")
    search_p.add_argument("user_id")
    search_p.add_argument("query")
    search_p.add_argument("--top-k", type=int, default=5)
    parsed, _rest = parser.parse_known_args(list(args))
    if parsed.command == "stats":
        print(store.stats(getattr(parsed, "user_id", None)))
        return 0
    if parsed.command == "search":
        for hit in store.search(parsed.user_id, parsed.query, top_k=parsed.top_k):
            print(f"[{hit[4]:.3f}] {hit[1]}#{hit[2]}\n{hit[3][:400]}\n")
        return 0
    parser.print_help()
    return 1
