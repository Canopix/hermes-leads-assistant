"""Optional reranker for lead-rag retrieval."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from collections.abc import Sequence

logger = logging.getLogger(__name__)


def _rerank_config() -> dict:
    try:
        from hermes_cli.config import load_config

        cfg = load_config() or {}
        rag = cfg.get("lead_rag") or {}
        aux = (cfg.get("auxiliary") or {}).get("reranker") or {}
        return {"rag": rag, "aux": aux}
    except Exception:
        return {"rag": {}, "aux": {}}


def is_enabled() -> bool:
    cfg = _rerank_config()
    return bool((cfg.get("rag") or {}).get("rerank_enabled"))


def rerank_hits(
    query: str,
    hits: Sequence[tuple[str, int, str, float]],
    top_k: int = 5,
) -> list[tuple[str, int, str, float]]:
    if not is_enabled() or not hits:
        return list(hits)[:top_k]

    cfg = _rerank_config()
    aux = cfg.get("aux") or {}
    api_key = (
        os.environ.get("LEAD_RERANKER_API_KEY", "").strip()
        or str(aux.get("api_key") or "").strip()
        or os.environ.get("LEAD_EMBEDDING_API_KEY", "").strip()
    )
    base_url = (
        os.environ.get("LEAD_RERANKER_BASE_URL", "").strip()
        or str(aux.get("base_url") or "").strip()
        or os.environ.get("LEAD_EMBEDDING_BASE_URL", "").strip()
    ).rstrip("/")
    model = (
        os.environ.get("LEAD_RERANKER_MODEL", "").strip()
        or str(aux.get("model") or "").strip()
    )
    if not api_key or not base_url or not model:
        return list(hits)[:top_k]

    documents = [h[2] for h in hits]
    url = f"{base_url}/rerank"
    payload = json.dumps({"model": model, "query": query, "documents": documents}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    try:
        timeout = int(aux.get("timeout") or 30)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError:
        # Fallback: some providers use /v1/rerank or scores in embeddings API
        return list(hits)[:top_k]

    results = body.get("results") or body.get("data") or []
    reranked: list[tuple[str, int, str, float]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        idx = item.get("index")
        score = float(item.get("relevance_score") or item.get("score") or 0)
        if isinstance(idx, int) and 0 <= idx < len(hits):
            src, cidx, content, _ = hits[idx]
            reranked.append((src, cidx, content, score))
    return reranked[:top_k] if reranked else list(hits)[:top_k]
