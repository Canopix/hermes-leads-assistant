"""lead-capture — structured lead extraction on post_llm_call."""

from __future__ import annotations

import logging
import re
from typing import Any

from . import db
from .extractor import extract_lead_fields

logger = logging.getLogger(__name__)

# Contact signals: never skip extract when the user just shared phone/email.
# Hermes already debounces inbound bursts (~seconds); a long plugin throttle
# can span a whole short chat and drop the phone/email turn.
_PHONE_SIGNAL_RE = re.compile(r"(?:\+?\d[\d\s\-().]{6,}\d)")
_EMAIL_SIGNAL_RE = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")


def _load_capture_config() -> dict[str, Any]:
    try:
        from hermes_cli.config import load_config

        cfg = load_config() or {}
        block = cfg.get("lead_capture") or {}
        return block if isinstance(block, dict) else {}
    except Exception:
        return {}


def _has_contact_signal(text: str) -> bool:
    if not text:
        return False
    return bool(_PHONE_SIGNAL_RE.search(text) or _EMAIL_SIGNAL_RE.search(text))


def _on_post_llm_call(
    session_id: str = "",
    user_message: str = "",
    assistant_response: str = "",
    platform: str = "",
    conversation_history: list | None = None,
    **_: Any,
) -> None:
    cfg = _load_capture_config()
    if cfg.get("enabled") is False:
        return
    if not user_message or not assistant_response:
        return
    if user_message.startswith("[lead-scope:auto-reply]"):
        return

    user_id = db.parse_user_id_from_session(session_id)
    # Default 0: Hermes inbound debounce covers bursts; throttle is optional.
    raw_interval = cfg.get("min_interval_seconds", 0)
    try:
        min_interval = int(raw_interval)
    except (TypeError, ValueError):
        min_interval = 0
    if (
        min_interval > 0
        and not _has_contact_signal(user_message)
        and db.should_throttle_extract(user_id, platform, min_interval)
    ):
        return

    extracted = extract_lead_fields(
        user_message,
        assistant_response,
        conversation_history=conversation_history,
        capture_config=cfg,
        session_id=session_id,
    )
    if not extracted:
        extracted = {
            "summary": user_message[:200],
            "temperature": "tibio",
            "urgency": "medium",
            "confidence": 0.0,
        }

    default_col = str(cfg.get("default_column") or "tibio")
    db.upsert_lead(
        user_id=user_id,
        platform=platform or "",
        session_id=session_id,
        name=str(extracted.get("name") or ""),
        email=str(extracted.get("email") or ""),
        phone=str(extracted.get("phone") or ""),
        interest=str(extracted.get("interest") or ""),
        urgency=str(extracted.get("urgency") or "medium"),
        temperature=str(extracted.get("temperature") or default_col),
        summary=str(extracted.get("summary") or ""),
        last_user_message=user_message[:2000],
        last_assistant_message=assistant_response[:2000],
        raw_extraction=extracted,
        default_column=default_col,
        preserve_manual_column=True,
    )


def register(ctx) -> None:
    ctx.register_auxiliary_task(
        key="lead_extractor",
        display_name="Lead extractor",
        description="Extract structured lead fields from conversation turns",
        defaults={"provider": "auto", "model": "", "timeout": 30},
    )
    ctx.register_hook("post_llm_call", _on_post_llm_call)
