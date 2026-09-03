"""Tool schemas for lead-catalog — what the LLM sees."""

CATALOG_SEARCH = {
    "name": "catalog_search",
    "description": (
        "Buscá ítems del catálogo del negocio (autos o propiedades según el vertical). "
        "Usá esta tool para listar opciones, filtrar por precio, marca, barrio, etc. "
        "No inventes precios ni disponibilidad: siempre consultá el catálogo."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Texto libre (título, modelo, barrio, sku). Opcional.",
            },
            "status": {
                "type": "string",
                "enum": ["available", "reserved", "sold", "draft"],
                "description": "Default: available",
            },
            "price_min": {
                "type": "integer",
                "description": "Precio mínimo (entero, misma moneda del catálogo)",
            },
            "price_max": {
                "type": "integer",
                "description": "Precio máximo (entero)",
            },
            "marca": {"type": "string", "description": "Filtro autos: marca"},
            "modelo": {"type": "string", "description": "Filtro autos: modelo"},
            "condicion": {
                "type": "string",
                "enum": ["0km", "usado"],
                "description": "Filtro autos: condición",
            },
            "anio_min": {"type": "integer", "description": "Filtro autos: año mínimo"},
            "barrio": {"type": "string", "description": "Filtro inmobiliaria: barrio"},
            "ciudad": {"type": "string", "description": "Filtro inmobiliaria: ciudad"},
            "tipo": {
                "type": "string",
                "enum": ["depto", "casa", "ph", "local", "terreno"],
                "description": "Filtro inmobiliaria: tipo",
            },
            "operacion": {
                "type": "string",
                "enum": ["venta", "alquiler"],
                "description": "Filtro inmobiliaria: operación",
            },
            "ambientes": {
                "type": "integer",
                "description": "Filtro inmobiliaria: cantidad de ambientes",
            },
            "limit": {
                "type": "integer",
                "description": "Máximo de resultados (default 10, max 50)",
            },
        },
        "required": [],
        "additionalProperties": False,
    },
}

CATALOG_GET = {
    "name": "catalog_get",
    "description": (
        "Obtené el detalle exacto de un ítem del catálogo por id o sku "
        "(precio, estado y atributos). Usá esto antes de cotizar o confirmar datos."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "id": {"type": "string", "description": "UUID del ítem"},
            "sku": {"type": "string", "description": "SKU / código interno"},
        },
        "required": [],
        "additionalProperties": False,
    },
}
