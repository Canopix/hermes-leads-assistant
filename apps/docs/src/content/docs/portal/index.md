---
title: Web portal
description: Overview of the Next.js portal.
template: doc
---

# Web portal (Next.js)

Interface for **customers** (B2B) and **super_admin**. Deployed on the VPS, runs as a separate Node.js process, and reads the same `leads.db` files the Hermes plugins write to.

```mermaid
flowchart TB
    subgraph Browser
        PAGES[React pages]
    end

    subgraph Edge["middleware.ts (Edge)"]
        COOKIE[Cookie signature check]
    end

    subgraph API["API routes (Node)"]
        RATE[rateLimitOr429]
        AUTH[resolveTenantContext / requireSuperAdminRequest]
        ROUTES[/api/leads /api/admin/tenants ...]
    end

    subgraph DataLayer["src/lib/"]
        TENANTS[tenants.ts → auth.sqlite]
        DB[db.ts → leads.db per slug]
    end

    Browser -->|HTTP| Edge
    Edge --> API
    API --> DataLayer
    DataLayer -->|path safeSlug| FS["~/.hermes/profiles/{slug}-leads/"]
```

## Stack

| Technology | Use |
|---|---|
| Next.js 14 (App Router) | Web framework |
| Better Auth | Email/password auth + cookie sessions |
| better-sqlite3 | Synchronous SQLite driver |
| zod | Input validation |
| Tailwind + Radix UI | UI |
| pino | Structured logging |

## Two data layers

The portal has **two data layers in two distinct physical locations**:

| Layer | File | Contents |
|---|---|---|
| Portal metadata | `~/.hermes/portal/auth.sqlite` | `user`, `session`, `account`, `verification` (Better Auth) + `tenants`, `tenant_members`, `audit_log` (portal) |
| Per-tenant data | `~/.hermes/profiles/{slug}-leads/.lead-capture/leads.db` | `leads`, `lead_events` (shared with plugins) |

**Auth.sqlite is shared** across all users and tenants. **Leads.db is one per tenant** and is resolved by slug on every query.

## Pages and routes

### Public pages

- `/login`, `/signup` — auth
- `/api/health` — public liveness

### Customer pages (behind auth)

- `/dashboard` — overview
- `/leads` — Kanban board for the active tenant
- `/leads/[id]` — detail with conversation
- `/config/*` — settings, soul, knowledge, business, platforms, extraction-hints
- `/analytics` — metrics

### Admin pages (behind `super_admin`)

- `/admin/tenants` — list and management
- `/admin/tenants/[slug]` — detail + deprovision
- `/admin/users` — users and roles
- `/admin/audit` — audit log
- `/admin/health` — detailed health with per-tenant metrics
- `/admin/playground` — test chat

### API routes

See [API routes](./api-routes/) for the guard patterns.

## What's next

- [Auth and sessions](./auth/) — Better Auth config, roles, cookies.
- [Multi-tenancy](./multi-tenancy/) — `resolveTenantContext`, membership, active tenant cookie.
- [API routes](./api-routes/) — guard patterns (tenant-scoped, super_admin, shared-secret).
- [Data layer](./data-layer/) — how the `.db` is resolved by slug and the connection pool.
