"""Vertical templates for catalog items — fixed schemas in code."""

from __future__ import annotations

from typing import Any

VERTICALS = ("autos", "inmobiliaria")

STATUS_VALUES = ("available", "reserved", "sold", "draft")
PRICE_KINDS = ("fixed", "from", "on_request")

AUTOS_REQUIRED = ("marca", "modelo", "anio", "km", "condicion")
AUTOS_OPTIONAL = ("version", "combustible", "transmision", "equipamiento", "ideal_para")
AUTOS_CONDICION = ("0km", "usado")

INMO_REQUIRED = ("tipo", "operacion", "ambientes", "barrio", "ciudad")
INMO_OPTIONAL = ("m2", "amenities")
INMO_TIPOS = ("depto", "casa", "ph", "local", "terreno")
INMO_OPERACIONES = ("venta", "alquiler")


class TemplateError(ValueError):
    """Invalid catalog payload for the active vertical."""


def validate_vertical(vertical: str) -> str:
    v = (vertical or "").strip().lower()
    if v not in VERTICALS:
        raise TemplateError(f"vertical inválido: {vertical!r} (esperado: {', '.join(VERTICALS)})")
    return v


def validate_status(status: str) -> str:
    s = (status or "").strip().lower()
    if s not in STATUS_VALUES:
        raise TemplateError(f"status inválido: {status!r}")
    return s


def validate_price_kind(kind: str) -> str:
    k = (kind or "").strip().lower()
    if k not in PRICE_KINDS:
        raise TemplateError(f"price_kind inválido: {kind!r}")
    return k


def _require_str(attrs: dict[str, Any], key: str) -> str:
    val = attrs.get(key)
    if val is None or str(val).strip() == "":
        raise TemplateError(f"attrs.{key} es obligatorio")
    return str(val).strip()


def _optional_str(attrs: dict[str, Any], key: str) -> str | None:
    val = attrs.get(key)
    if val is None or str(val).strip() == "":
        return None
    return str(val).strip()


def _require_int(attrs: dict[str, Any], key: str, *, min_value: int | None = None) -> int:
    if key not in attrs or attrs[key] is None or attrs[key] == "":
        raise TemplateError(f"attrs.{key} es obligatorio")
    try:
        n = int(attrs[key])
    except (TypeError, ValueError) as exc:
        raise TemplateError(f"attrs.{key} debe ser entero") from exc
    if min_value is not None and n < min_value:
        raise TemplateError(f"attrs.{key} debe ser >= {min_value}")
    return n


def _optional_int(attrs: dict[str, Any], key: str, *, min_value: int | None = None) -> int | None:
    if key not in attrs or attrs[key] is None or attrs[key] == "":
        return None
    try:
        n = int(attrs[key])
    except (TypeError, ValueError) as exc:
        raise TemplateError(f"attrs.{key} debe ser entero") from exc
    if min_value is not None and n < min_value:
        raise TemplateError(f"attrs.{key} debe ser >= {min_value}")
    return n


def normalize_attrs(vertical: str, attrs: dict[str, Any] | None) -> dict[str, Any]:
    """Validate and normalize attrs_json for the given vertical."""
    v = validate_vertical(vertical)
    raw = dict(attrs or {})

    if v == "autos":
        out: dict[str, Any] = {
            "marca": _require_str(raw, "marca"),
            "modelo": _require_str(raw, "modelo"),
            "anio": _require_int(raw, "anio", min_value=1900),
            "km": _require_int(raw, "km", min_value=0),
            "condicion": _require_str(raw, "condicion").lower(),
        }
        if out["condicion"] not in AUTOS_CONDICION:
            raise TemplateError(f"attrs.condicion inválido: {out['condicion']!r}")
        for key in AUTOS_OPTIONAL:
            val = _optional_str(raw, key)
            if val is not None:
                out[key] = val
        return out

    # inmobiliaria
    out = {
        "tipo": _require_str(raw, "tipo").lower(),
        "operacion": _require_str(raw, "operacion").lower(),
        "ambientes": _require_int(raw, "ambientes", min_value=0),
        "barrio": _require_str(raw, "barrio"),
        "ciudad": _require_str(raw, "ciudad"),
    }
    if out["tipo"] not in INMO_TIPOS:
        raise TemplateError(f"attrs.tipo inválido: {out['tipo']!r}")
    if out["operacion"] not in INMO_OPERACIONES:
        raise TemplateError(f"attrs.operacion inválido: {out['operacion']!r}")
    m2 = _optional_int(raw, "m2", min_value=0)
    if m2 is not None:
        out["m2"] = m2
    amenities = _optional_str(raw, "amenities")
    if amenities is not None:
        out["amenities"] = amenities
    return out


def field_labels(vertical: str) -> dict[str, str]:
    """Human-readable labels for portal / RAG export."""
    v = validate_vertical(vertical)
    if v == "autos":
        return {
            "marca": "Marca",
            "modelo": "Modelo",
            "version": "Versión",
            "anio": "Año",
            "km": "Kilómetros",
            "condicion": "Condición",
            "combustible": "Combustible",
            "transmision": "Transmisión",
            "equipamiento": "Equipamiento",
            "ideal_para": "Ideal para",
        }
    return {
        "tipo": "Tipo",
        "operacion": "Operación",
        "ambientes": "Ambientes",
        "m2": "m²",
        "barrio": "Barrio",
        "ciudad": "Ciudad",
        "amenities": "Amenities",
    }
