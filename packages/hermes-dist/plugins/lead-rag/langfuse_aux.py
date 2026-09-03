"""Optional Langfuse tracing for auxiliary LLM / embedding calls.

Fail-open: missing SDK/keys/errors never break the agent loop.
Does not flush synchronously (avoids adding latency to the user reply).

Observations are tagged with the Hermes ``session_id`` so they group with
the main ``Hermes turn`` in Langfuse (same session filter), even when the
root turn span has already closed.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from typing import Any

logger = logging.getLogger(__name__)

_MAX_PREVIEW = 4000


def langfuse_configured() -> bool:
    return bool(
        (
            os.environ.get("HERMES_LANGFUSE_PUBLIC_KEY")
            or os.environ.get("LANGFUSE_PUBLIC_KEY")
            or ""
        ).strip()
        and (
            os.environ.get("HERMES_LANGFUSE_SECRET_KEY")
            or os.environ.get("LANGFUSE_SECRET_KEY")
            or ""
        ).strip()
    )


def _ensure_sdk_env() -> None:
    pub = (
        os.environ.get("HERMES_LANGFUSE_PUBLIC_KEY")
        or os.environ.get("LANGFUSE_PUBLIC_KEY")
        or ""
    ).strip()
    sec = (
        os.environ.get("HERMES_LANGFUSE_SECRET_KEY")
        or os.environ.get("LANGFUSE_SECRET_KEY")
        or ""
    ).strip()
    base = (
        os.environ.get("HERMES_LANGFUSE_BASE_URL")
        or os.environ.get("LANGFUSE_BASE_URL")
        or os.environ.get("LANGFUSE_HOST")
        or ""
    ).strip()
    if pub and not os.environ.get("LANGFUSE_PUBLIC_KEY"):
        os.environ["LANGFUSE_PUBLIC_KEY"] = pub
    if sec and not os.environ.get("LANGFUSE_SECRET_KEY"):
        os.environ["LANGFUSE_SECRET_KEY"] = sec
    if base and not os.environ.get("LANGFUSE_BASE_URL"):
        os.environ["LANGFUSE_BASE_URL"] = base
        os.environ.setdefault("LANGFUSE_HOST", base)


def _client() -> Any | None:
    if not langfuse_configured():
        return None
    _ensure_sdk_env()
    try:
        from langfuse import get_client

        return get_client()
    except Exception as exc:
        logger.debug("langfuse client unavailable: %s", exc)
        return None


def _truncate(value: Any, limit: int = _MAX_PREVIEW) -> Any:
    if isinstance(value, str):
        return value if len(value) <= limit else value[:limit] + "…"
    if isinstance(value, list):
        return [_truncate(v, limit) for v in value[:20]]
    if isinstance(value, dict):
        return {str(k): _truncate(v, limit) for k, v in list(value.items())[:30]}
    return value


def _usage_from_response(response: Any) -> dict[str, int]:
    usage = getattr(response, "usage", None)
    if usage is None and isinstance(response, dict):
        usage = response.get("usage")
    if usage is None:
        return {}
    if isinstance(usage, dict):
        prompt = usage.get("prompt_tokens") or usage.get("input_tokens") or usage.get("input")
        completion = (
            usage.get("completion_tokens")
            or usage.get("output_tokens")
            or usage.get("output")
        )
        total = usage.get("total_tokens") or usage.get("total")
    else:
        prompt = getattr(usage, "prompt_tokens", None) or getattr(
            usage, "input_tokens", None
        )
        completion = getattr(usage, "completion_tokens", None) or getattr(
            usage, "output_tokens", None
        )
        total = getattr(usage, "total_tokens", None)
    out: dict[str, int] = {}
    if prompt is not None:
        out["input"] = int(prompt)
    if completion is not None:
        out["output"] = int(completion)
    if total is not None:
        out["total"] = int(total)
    elif "input" in out or "output" in out:
        out["total"] = int(out.get("input", 0) + out.get("output", 0))
    return out


def _model_from_response(response: Any, fallback: str = "") -> str:
    model = getattr(response, "model", None)
    if not model and isinstance(response, dict):
        model = response.get("model")
    return str(model or fallback or "")


def _content_preview(response: Any) -> str:
    try:
        if response and getattr(response, "choices", None):
            msg = response.choices[0].message
            return _truncate(getattr(msg, "content", "") or "")
        if isinstance(response, dict):
            choices = response.get("choices") or []
            if choices:
                msg = choices[0].get("message") or {}
                return _truncate(msg.get("content") or "")
    except Exception:
        pass
    return ""


@contextmanager
def _generation_scope(
    *,
    name: str,
    session_id: str = "",
    model: str = "",
    metadata: dict[str, Any] | None = None,
    input_value: Any = None,
) -> Iterator[Any | None]:
    client = _client()
    if client is None or not hasattr(client, "start_as_current_observation"):
        yield None
        return

    meta = {"auxiliary": True, **(metadata or {})}
    tags = ["auxiliary", name]
    try:
        from langfuse import propagate_attributes
    except Exception:
        propagate_attributes = None

    def _open() -> Any:
        return client.start_as_current_observation(
            as_type="generation",
            name=name,
            model=model or None,
            input=_truncate(input_value) if input_value is not None else None,
            metadata=meta,
        )

    try:
        if propagate_attributes is not None and session_id:
            with propagate_attributes(
                session_id=session_id,
                tags=tags,
                metadata={"task": name},
            ), _open() as gen:
                yield gen
        else:
            with _open() as gen:
                if session_id and hasattr(gen, "update_trace"):
                    with suppress(Exception):
                        gen.update_trace(session_id=session_id)
                yield gen
    except Exception as exc:
        logger.debug("langfuse generation scope failed (%s): %s", name, exc)
        yield None


def _end_generation(
    gen: Any | None,
    *,
    output: Any = None,
    usage: dict[str, int] | None = None,
    model: str = "",
    latency_s: float | None = None,
    level: str = "DEFAULT",
    status_message: str = "",
) -> None:
    if gen is None:
        return
    try:
        kwargs: dict[str, Any] = {}
        if output is not None:
            kwargs["output"] = _truncate(output)
        if usage:
            kwargs["usage_details"] = usage
        if model:
            kwargs["model"] = model
        meta: dict[str, Any] = {}
        if latency_s is not None:
            meta["latency_s"] = round(latency_s, 3)
        if status_message:
            meta["status_message"] = status_message[:500]
        if meta:
            kwargs["metadata"] = meta
        if level and level != "DEFAULT":
            kwargs["level"] = level
        if hasattr(gen, "update"):
            gen.update(**kwargs)
    except Exception as exc:
        logger.debug("langfuse end generation failed: %s", exc)


def traced_call_llm(
    *,
    task: str,
    messages: list,
    session_id: str = "",
    **kwargs: Any,
) -> Any:
    """Wrap ``agent.auxiliary_client.call_llm`` with a Langfuse generation."""
    from agent.auxiliary_client import call_llm

    started = time.perf_counter()
    explicit_model = str(kwargs.get("model") or "")
    with _generation_scope(
        name=task,
        session_id=session_id,
        model=explicit_model,
        metadata={"task": task},
        input_value=messages,
    ) as gen:
        try:
            response = call_llm(task=task, messages=messages, **kwargs)
        except Exception as exc:
            _end_generation(
                gen,
                output={"error": str(exc)[:500]},
                latency_s=time.perf_counter() - started,
                level="ERROR",
                status_message=str(exc)[:200],
            )
            raise
        latency_s = time.perf_counter() - started
        _end_generation(
            gen,
            output=_content_preview(response),
            usage=_usage_from_response(response),
            model=_model_from_response(response, explicit_model),
            latency_s=latency_s,
        )
        return response


def observe_embedding(
    *,
    model: str,
    input_count: int,
    prompt_tokens: int | None = None,
    total_tokens: int | None = None,
    latency_ms: float | None = None,
    session_id: str = "",
    metadata: dict[str, Any] | None = None,
) -> None:
    """Record a generation-style observation for an embeddings HTTP call."""
    usage: dict[str, int] = {}
    if prompt_tokens is not None:
        usage["input"] = int(prompt_tokens)
    if total_tokens is not None:
        usage["total"] = int(total_tokens)
    elif prompt_tokens is not None:
        usage["total"] = int(prompt_tokens)
    latency_s = (latency_ms / 1000.0) if latency_ms is not None else None
    meta = {
        "task": "lead_rag_embeddings",
        "input_count": input_count,
        **(metadata or {}),
    }
    with _generation_scope(
        name="lead_rag_embeddings",
        session_id=session_id,
        model=model,
        metadata=meta,
        input_value={"input_count": input_count},
    ) as gen:
        _end_generation(
            gen,
            output={"embedded": input_count},
            usage=usage,
            model=model,
            latency_s=latency_s,
        )
