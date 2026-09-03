"""lead-verify — safety net that judges the bot's reply before delivery.

Hook:
  * transform_llm_output — fires once per turn, after the LLM produces its
    final response and BEFORE delivery to the user (CLI/Telegram/WhatsApp).
    Returning a non-empty string replaces the reply.

Fail-open: any error or unavailable auxiliary client → pass through unchanged.
"""

from __future__ import annotations

import logging
from typing import Any

from . import verifier

logger = logging.getLogger(__name__)

_AUTO_REPLY_PREFIX = "[lead-scope:auto-reply]"
_MIN_LEN_TO_JUDGE = 20


def _load_verify_config() -> dict[str, Any]:
    try:
        from hermes_cli.config import load_config

        cfg = load_config() or {}
        block = cfg.get("lead_verify") or {}
        return block if isinstance(block, dict) else {}
    except Exception:
        return {}


def _resolve_client_name() -> str:
    try:
        from hermes_cli.config import load_config

        lead_cfg = (load_config() or {}).get("lead_assistant") or {}
        return str(lead_cfg.get("client_name") or "el negocio")
    except Exception:
        return "el negocio"


def _on_transform_llm_output(
    response_text: str = "",
    session_id: str = "",
    model: str = "",
    platform: str = "",
    **_: Any,
) -> str | None:
    cfg = _load_verify_config()
    if cfg.get("enabled") is False:
        return None
    if not response_text:
        return None
    # Auto-replies are pre-formed by lead-scope — skip to avoid second-guessing
    # deterministic out-of-hours / threat-scan messages.
    if response_text.startswith(_AUTO_REPLY_PREFIX):
        return None
    # Very short replies (greetings, acks) carry no factual claims to judge.
    if len(response_text.strip()) < _MIN_LEN_TO_JUDGE:
        return None

    client = _resolve_client_name()
    verdict = verifier.verify_response(
        response_text, client, verify_config=cfg, session_id=session_id
    )
    if verdict is None:
        # Verifier failed to produce a verdict → fail-open, pass through.
        return None
    if verdict.ok:
        return None
    if verdict.replacement and verdict.replacement.strip():
        logger.info(
            "lead-verify: replaced response (reason=%s, session=%s)",
            verdict.reason or "unspecified",
            session_id,
        )
        return verdict.replacement
    return None


def register(ctx) -> None:
    ctx.register_auxiliary_task(
        key="lead_verifier",
        display_name="Lead verifier",
        description="Safety net LLM judge: hallucination + policy + security checks on bot replies",
        defaults={"provider": "auto", "model": "", "timeout": 20},
    )
    ctx.register_hook("transform_llm_output", _on_transform_llm_output)
