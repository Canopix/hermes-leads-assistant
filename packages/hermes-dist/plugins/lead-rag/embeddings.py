"""OpenAI-compatible embedding client for lead-rag."""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)


def _embedding_config() -> dict:
    try:
        from hermes_cli.config import load_config

        cfg = load_config() or {}
        aux = (cfg.get("auxiliary") or {}).get("embeddings") or {}
        return aux if isinstance(aux, dict) else {}
    except Exception:
        return {}


def _resolve_credentials() -> tuple[str, str, str]:
    cfg = _embedding_config()
    api_key = (
        os.environ.get("LEAD_EMBEDDING_API_KEY", "").strip()
        or str(cfg.get("api_key") or "").strip()
        or os.environ.get("OPENAI_API_KEY", "").strip()
    )
    base_url = (
        os.environ.get("LEAD_EMBEDDING_BASE_URL", "").strip()
        or str(cfg.get("base_url") or "").strip()
        or "https://api.openai.com/v1"
    ).rstrip("/")
    model = (
        os.environ.get("LEAD_EMBEDDING_MODEL", "").strip()
        or str(cfg.get("model") or "").strip()
        or "text-embedding-3-small"
    )
    return api_key, base_url, model


def embed_texts(texts: list[str], session_id: str = "") -> list[list[float]]:
    if not texts:
        return []
    api_key, base_url, model = _resolve_credentials()
    if not api_key:
        logger.warning("lead-rag: no embedding API key configured")
        return []

    url = f"{base_url}/embeddings"
    payload = json.dumps({"model": model, "input": texts}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    timeout = int(_embedding_config().get("timeout") or 60)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        logger.warning("lead-rag embedding request failed: %s", exc)
        return []
    latency_ms = (time.perf_counter() - started) * 1000.0

    data = body.get("data") or []
    out: list[list[float] | None] = [None] * len(texts)
    for item in data:
        if not isinstance(item, dict):
            continue
        idx = item.get("index", 0)
        emb = item.get("embedding")
        if isinstance(idx, int) and 0 <= idx < len(out) and isinstance(emb, list):
            out[idx] = [float(x) for x in emb]

    usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
    prompt_tokens = usage.get("prompt_tokens")
    total_tokens = usage.get("total_tokens")
    try:
        from .langfuse_aux import observe_embedding

        observe_embedding(
            model=model,
            input_count=len(texts),
            prompt_tokens=int(prompt_tokens) if prompt_tokens is not None else None,
            total_tokens=int(total_tokens) if total_tokens is not None else None,
            latency_ms=latency_ms,
            session_id=session_id,
            metadata={"base_url": base_url},
        )
    except Exception:
        pass

    return [e for e in out if e is not None]


def embed_query(text: str, session_id: str = "") -> list[float] | None:
    results = embed_texts([text], session_id=session_id)
    return results[0] if results else None
