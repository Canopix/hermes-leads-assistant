---
title: Why Hermes profiles
description: ADR — one Hermes profile per tenant.
template: doc
---

# ADR: One Hermes profile per tenant

**Status:** Accepted

## Context

Hermes Agent is the bot runtime. Each Hermes instance runs an agent with its own config, plugins, memory, and sessions.

We had to decide how to map tenants → Hermes processes.

## Options considered

### A. One Hermes process, N tenants via `tenant_id`

A single Hermes instance serves all tenants. Each message carries tenant metadata.

**Pros:** fewer processes, fewer resources.
**Cons:**
- Plugins would have to be tenant-aware (load different config per tenant).
- Shared memory/sessions → cross-tenant leak risk.
- One bug hits all tenants at once.
- You can't restart one tenant without affecting the others.
- Complicated cross-tenant rate limiting.

### B. One Hermes process per tenant (CHOSEN)

Each tenant gets its own Hermes process, its own `HERMES_HOME`, its own files.

**Pros:**
- Real physical isolation — one tenant can't touch another.
- Granular restarts (one bot without affecting the rest).
- Bug blast radius limited to the tenant.
- Plugins don't need to know about multi-tenancy.
- Hermes core doesn't need to be modified.

**Cons:**
- More processes (1 per tenant).
- Each process has its Python venv (current limitation).
- More complex deploy (systemd unit per tenant or supervisor).

## Decision

**Option B** — one profile per tenant.

## Implementation

```bash
# Each tenant has its profile
~/.hermes/profiles/acme-leads/        # HERMES_HOME for acme
~/.hermes/profiles/beta-leads/        # HERMES_HOME for beta

# Each one starts separately
hermes gateway start --profile acme-leads
hermes gateway start --profile beta-leads
```

Each process has:

- Its own `HERMES_HOME` → its DBs, sessions, logs.
- Its own `.env` (isolated secrets).
- Its own `config.yaml`.
- Its own indexed knowledge base.

## Consequences

### Accepted downsides

| Limitation | Current mitigation |
|---|---|
| Python venv shared across all profiles | Accepted until a tenant needs specific deps. Pending ADR for per-profile venvs. |
| More processes | The VPS holds up with a small N (~50-100 tenants) |
| Per-bot restart requires a CLI wrapper | `cli/leadai.py bot start/stop/restart SLUG` |

### When to re-evaluate

- **>100 tenants on a VPS** → process memory pressure.
- **Tenant that needs a custom plugin / specific deps** → per-profile venv.
- **Tenant with a stronger runtime isolation SLA** → its own VM or container.

## Relationship with the portal

The portal is **a single app** that opens every tenant's `.db` files (via slug path resolution). This is consistent with the approach:

- Runtime (bots) = separate processes.
- UI/admin (portal) = a single process that accesses all data.

The portal **doesn't write** to the bot's `leads.db` frequently — only for manual moves. Everything else is reads, which WAL allows concurrently without blocking writers.
