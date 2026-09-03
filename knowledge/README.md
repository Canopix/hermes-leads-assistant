# Client knowledge base

Place client-specific **narrative** documents here before provisioning or re-ingesting:

- `faqs.md` — frequently asked questions
- `policies.md` — returns, shipping, privacy
- `como-trabajamos.md` — process / tone of the business
- Any `.md`, `.txt`, or `.json` files for RAG

**Inventory / products / prices** do **not** belong here as free-form Markdown.
Use the structured catalog (`catalog.db` via plugin `lead-catalog` and Portal → Inventario):

```bash
hermes -p {slug}-leads lead-catalog init --vertical autos   # or inmobiliaria
hermes -p {slug}-leads lead-catalog seed canova-autos       # optional demo
hermes -p {slug}-leads lead-catalog export-rag --ingest
```

After adding or updating Markdown FAQs, run:

```bash
hermes -p {slug}-leads lead-rag ingest
```

The RAG index is stored at `{HERMES_HOME}/.lead-rag/` and is **not** shared across client profiles.
