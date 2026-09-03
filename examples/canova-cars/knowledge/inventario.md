# Canova Cars — Inventario

El inventario estructurado vive en `catalog.db` (plugin `lead-catalog`).

- Portal: **Configuración → Inventario**
- CLI: `hermes -p canova-cars-leads lead-catalog search "Toyota"`
- Seed: `hermes -p canova-cars-leads lead-catalog seed canova-autos`

Este archivo ya no es la fuente de verdad de precios/stock. Se conserva como
nota histórica; el bot usa `catalog_search` / `catalog_get` y la proyección
`knowledge/catalog-generated.md` para RAG narrativo.
