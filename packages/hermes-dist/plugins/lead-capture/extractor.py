"""LLM-based structured lead extraction via auxiliary lead_extractor task."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Disable thinking/reasoning on models like qwen3.6 (nan). See lead-verify.
_NO_THINKING_EXTRA_BODY = {
    "enable_thinking": False,
    "chat_template_kwargs": {"enable_thinking": False},
}

_BASE_EXTRACT_PROMPT = """Analizá esta conversación de un potencial lead y extraé datos estructurados.
Respondé ÚNICAMENTE con JSON válido (sin markdown).

Campos base (siempre presentes):
{
  "name": "string o vacío",
  "email": "string o vacío",
  "phone": "string o vacío",
  "interest": "qué busca o necesita",
  "urgency": "low|medium|high",
  "temperature": "frio|tibio|caliente",
  "summary": "resumen de 1-2 oraciones con los hechos clave del lead",
  "confidence": 0.0
}

Reglas para temperature:
- frio: solo curiosidad, sin datos concretos ni urgencia
- tibio: interés real, hace preguntas, da algún dato útil
- caliente: urgencia alta, pide cotización/reserva/seguimiento con asesor, datos completos

Usá todo el historial reciente provisto — no ignores datos dichos en mensajes anteriores.
"""


def build_extract_prompt(extraction_hints: str = "") -> str:
    """Compose system prompt: generic base + optional per-profile business hints."""
    prompt = _BASE_EXTRACT_PROMPT
    hints = (extraction_hints or "").strip()
    if hints:
        prompt += (
            "\n\n## Orientación del negocio (lead_capture.extraction_hints)\n"
            f"{hints}\n\n"
            "Agregá campos adicionales pedidos arriba como claves top-level en el mismo JSON. "
            "Usá string vacío si no hay dato. Todo se persiste en raw_extraction."
        )
    return prompt


def _parse_json_response(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return None
    return None


def _format_history(conversation_history: list | None) -> str:
    if not conversation_history:
        return ""
    recent = conversation_history[-10:]
    lines: list[str] = []
    for msg in recent:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role", "")
        content = msg.get("content", "")
        if isinstance(content, str) and content.strip():
            lines.append(f"{role}: {content[:500]}")
    return "\n".join(lines)


def _call_extractor_llm(*, messages: list, session_id: str = ""):
    try:
        from .langfuse_aux import traced_call_llm

        return traced_call_llm(
            task="lead_extractor",
            messages=messages,
            session_id=session_id,
            temperature=0.1,
            max_tokens=512,
            extra_body=_NO_THINKING_EXTRA_BODY,
        )
    except Exception:
        from agent.auxiliary_client import call_llm

        return call_llm(
            task="lead_extractor",
            messages=messages,
            temperature=0.1,
            max_tokens=512,
            extra_body=_NO_THINKING_EXTRA_BODY,
        )


def extract_lead_fields(
    user_message: str,
    assistant_response: str,
    conversation_history: list | None = None,
    capture_config: dict[str, Any] | None = None,
    session_id: str = "",
) -> dict[str, Any] | None:
    try:
        # Probe import early so we fail to None cleanly if aux client missing.
        from agent.auxiliary_client import call_llm  # noqa: F401
    except ImportError:
        logger.warning("lead-capture: auxiliary_client unavailable")
        return None

    cfg = capture_config or {}
    hints = str(cfg.get("extraction_hints") or "")
    system_prompt = build_extract_prompt(hints)
    history_snip = _format_history(conversation_history)

    user_block = (
        f"Historial reciente:\n{history_snip or '(sin historial)'}\n\n"
        f"Último mensaje del usuario:\n{user_message}\n\n"
        f"Respuesta del asistente:\n{assistant_response}"
    )

    try:
        response = _call_extractor_llm(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_block},
            ],
            session_id=session_id,
        )
        content = ""
        if response and getattr(response, "choices", None):
            msg = response.choices[0].message
            content = getattr(msg, "content", "") or ""
        return _parse_json_response(content)
    except Exception as exc:
        logger.warning("lead-capture extraction failed: %s", exc)
        return None
