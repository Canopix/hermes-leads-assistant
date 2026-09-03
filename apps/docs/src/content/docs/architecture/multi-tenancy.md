---
title: Tenant isolation
description: How data is physically separated between clients.
template: doc
---

# Tenant isolation (multi-tenancy)

The system is multi-tenant through **physical isolation**: each client has its own Hermes process, its own DB, its own knowledge base. **There is no `tenant_id` column in shared tables**. Isolation comes from the filesystem.

## Physical layout

Each tenant lives under `~/.hermes/profiles/{slug}-leads/`:

```
~/.hermes/profiles/{slug}-leads/
├── .env                          # tenant secrets (chmod 600)
├── config.yaml                   # Hermes + plugin config
├── SOUL.md                       # bot persona
├── knowledge/                    # FAQs / policies (RAG via lead-rag)
├── catalog.db                    # Structured inventory (lead-catalog)
├── .lead-capture/
│   └── leads.db                  # leads + lead_events
├── .lead-rag/
│   ├── vectors.db                # embeddings + meta
│   └── index.db                  # FTS5
├── .lead-documents/
│   ├── docs.db                   # lead documents (FTS5)
│   └── files/                    # originals
├── sessions/                     # conversation history
└── logs/                         # gateway logs
```

**Nothing is shared between tenants** except the Hermes binary, the Python venv, and the portal (which opens each `.db` in read or write mode depending on the operation).

## Identity and scoping

### The `slug` is the key

The `slug` (regex `^[a-z0-9-]+$`) is the canonical tenant identifier. Everything derives from it:

- Profile name: `{slug}-leads`
- DB path: `~/.hermes/profiles/{slug}-leads/.lead-capture/leads.db`
- Mem0 agent ID: `{slug}-leads`

### Resolution in the portal

Every HTTP request to the portal that touches tenant data goes through [`resolveTenantContext`](../../portal/multi-tenancy/):

1. Reads the session from the cookie (Better Auth).
2. Resolves the `slug` from query param, body, or the `active_tenant` cookie.
3. Verifies the user is a **member** of the tenant (or a `super_admin`).
4. Returns `{ tenant, tenantRole, ... }` with the `slug` already validated.

### Data layer

In `apps/portal/src/lib/db.ts`, **every function takes `slug` as its first argument**:

```ts
getLeads(slug)
getLeadById(slug, id)
updateLeadColumn(slug, id, column, opts)
```

Internally it resolves the path with `leadsDbPath(slug)`, which re-validates the slug (`safeSlug`) before concatenating. **There is no global handle or implicit tenant** — forgetting the slug is a compile error.

```ts
export function leadsDbPath(slug: string): string | null {
  const safe = safeSlug(slug);  // ^[a-z0-9-]+$
  const dbPath = path.join(getProfilesDir(), `${safe}-leads`, ".lead-capture", "leads.db");
  return fs.existsSync(dbPath) ? dbPath : null;
}
```

### Runtime isolation (plugins)

Plugins resolve their `HERMES_HOME` with `hermes_constants.get_hermes_home()`, which returns the profile path of the current Hermes process. Each Hermes process starts with a different profile:

```bash
hermes gateway start --profile acme-leads
hermes gateway start --profile beta-leads
```

Each one has its own `HERMES_HOME` → its own `.db` files → they never mix.

## Intentionally shared

| Resource | Shared between | Reason |
|---|---|---|
| `hermes` binary | All tenants | Centralized updates |
| Python venv `~/.hermes/hermes-agent/venv` | All tenants | Current limitation (see ADR) |
| Portal (Next.js process) | All tenants | One app opening N DBs |
| `auth.sqlite` | All users + tenants | Tables `users`, `tenants`, `tenant_members`, `audit_log` |

The **shared venv** is the only real concession to isolation: if a tenant needs a plugin with specific deps (e.g. `sqlite-vec`), it cannot be installed without affecting the others. [ADR pending on per-profile venvs].

## Threats and mitigations

| Vector | Mitigation |
|---|---|
| Path traversal from the portal | `safeSlug()` re-validates the regex before any path join |
| Tenant A reads tenant B's DB | Membership check in `resolveTenantContext` + separate physical path |
| Plugin writes to a cross-tenant DB | Each Hermes process has its own `HERMES_HOME` |
| SQL injection in API routes | zod schemas + prepared statements (`?` placeholders) |
| Forged `active_tenant` cookie | HttpOnly + signature check in middleware |
| Suspended tenant still accessible | `tenant.status !== "active"` → 403 unless super_admin |

## Backup / restore per tenant

Since everything lives in the profile directory:

```bash
# Backup
tar -czf acme-backup.tar.gz ~/.hermes/profiles/acme-leads/

# Restore
tar -xzf acme-backup.tar.gz -C ~/.hermes/profiles/
```

`deploy.sh` installs a daily cron that runs an [online backup](https://www.sqlite.org/lang_vacuum.html) of each `leads.db` (via `sqlite3 .backup`) plus a tar of the full profile → `/var/backups/lead-ai/`.