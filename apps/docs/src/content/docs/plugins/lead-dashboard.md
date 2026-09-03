---
title: lead-dashboard
description: Kanban tab in the Hermes dashboard for operators.
template: doc
---

# lead-dashboard

**Purpose:** a **tab in the Hermes dashboard** (not the Next.js portal) that renders the leads captured by `lead-capture` as a drag-and-drop Kanban. It exposes a REST API on top of `leads.db`.

**Audience:** the **operator**, not the B2B client. The client has the portal.

**Location:** `packages/hermes-dist/plugins/lead-dashboard/`

## How it mounts

Not a standard plugin hook. It declares a `dashboard` hook in `plugin.yaml` and is loaded via `manifest.json`:

```json
{
  "name": "lead-dashboard",
  "label": "Leads",
  "icon": "Users",
  "tab": { "path": "/leads", "position": "after:sessions" },
  "entry": "dist/index.js",
  "css": "dist/style.css",
  "api": "plugin_api.py"
}
```

The tab shows up at `http://127.0.0.1:9119/leads` in the Hermes dashboard, right after "sessions".

## Frontend

`dashboard/dist/index.js` + `dashboard/dist/style.css` — **React SPA** mounted via `window.__HERMES_PLUGIN_SDK__`.

## REST API

`plugin_api.py` exposes a FastAPI `APIRouter` mounted at `/api/plugins/lead-dashboard/`:

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/columns` | `KANBAN_COLUMNS` from `lead-capture/db.py` (frio, tibio, caliente) |
| `GET` | `/leads` | `list_leads_by_column()` → `{columns: {frio: [...], tibio: [...], caliente: [...]}}` |
| `GET` | `/leads/{id}` | Lead row + last 50 `lead_events` |
| `PATCH` | `/leads/{id}` | Update of allowlisted fields (name, email, phone, interest, urgency, summary, notes, temperature) |
| `POST` | `/leads/{id}/move` | `{column, position}` → `move_lead`, logs a `moved` event |
| `GET` | `/stats` | `{total, by_column, created_today}` |
| `GET` | `/knowledge/status` | Loads `lead-rag` dynamically and returns `knowledge_status()` |
| `POST` | `/knowledge/reingest` | Runs `lead-rag.ingest()` to re-index the KB |

## Coupling with other plugins

`plugin_api.py` loads via **dynamic `importlib` by file path**:

1. **`lead-capture/db.py`** — aliased `lead_capture_db` to read/write leads.
2. The full **`lead-rag` package** — aliased `lead_rag_plugin` (because the hyphenated name is not a valid identifier).

This means:

- `lead-dashboard` reads/writes the same `leads.db` written by `lead-capture`.
- `lead-dashboard` can call `lead-rag.ingest()` and read its status.
- The plugins can be enabled/disabled independently — the dashboard only breaks if `lead-capture` is missing.

## Difference from the portal

| | lead-dashboard | Next.js portal |
|---|---|---|
| Audience | Operator | Client + super_admin |
| Auth | Hermes dashboard auth (local) | Better Auth with roles and multi-tenancy |
| Where | `http://127.0.0.1:9119/leads` | Deployed, public domain |
| Multi-tenant | One per profile | All tenants in a single app |
| Stack | Bundled React SPA | Next.js + server components |

The **portal is what clients see**. The **dashboard is what you see** when you are provisioning/debugging a specific tenant.
