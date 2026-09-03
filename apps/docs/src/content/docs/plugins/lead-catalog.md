---
title: lead-catalog
description: Structured catalog (autos / real estate) with SQLite, deterministic tools and RAG projection.
template: doc
---

# lead-catalog

**Purpose:** keep the business inventory (cars or properties) in SQLite per tenant, expose deterministic tools to the bot (`catalog_search`, `catalog_get`), and project narrative text to `knowledge/catalog-generated.md` for `lead-rag`.

**Location:** `packages/hermes-dist/plugins/lead-catalog/`

## Why not Markdown

FAQs and policies stay in Markdown (`lead-rag`). The **inventory** (prices, stock, attributes) is structured: the client loads listings in the portal; the bot does not invent numbers.

## Verticals (fixed templates)

| Vertical | Use |
|---|---|
| `autos` | Car dealerships (make, model, year, mileage, condition, …) |
| `inmobiliaria` | Real estate (type, operation, rooms, neighborhood, …) |

The vertical is set at provisioning time (`--catalog-vertical` / `lead_catalog.vertical`). The client does **not** configure columns.

## Storage

`HERMES_HOME/catalog.db` (one file per profile):

| Table | Role |
|---|---|
| `meta` | `vertical`, `version` |
| `items` | listing: price, status, `attrs_json`, description |

## Tools

| Tool | What it does |
|---|---|
| `catalog_search` | Filters by text, price, status and vertical attrs |
| `catalog_get` | Exact detail by `id` or `sku` |

Public allowlist in `lead-scope`: both tools are allowed.

## CLI

```bash
# Existing profiles: sync dist plugins first, then enable
hermes profile update {slug}-leads --yes
hermes -p {slug}-leads plugins enable lead-catalog

hermes -p {slug}-leads lead-catalog init --vertical autos
hermes -p {slug}-leads lead-catalog seed canova-autos
hermes -p {slug}-leads lead-catalog export-rag --ingest
hermes -p {slug}-leads lead-catalog search "Toyota"
hermes -p {slug}-leads lead-catalog get --id <uuid>
```

## Portal

**Settings → Inventory**: listings + item detail. On save it exports `catalog-generated.md` and reindexes the RAG.

**Settings → Documents and FAQs**: narrative only (FAQ / policies).
