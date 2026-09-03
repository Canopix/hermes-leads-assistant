---
title: API routes
description: Guard patterns — tenant-scoped, super_admin, shared-secret.
template: doc
---

# API routes and guards

Three guard patterns, depending on the endpoint type.

## Pattern A — Tenant-scoped: `resolveTenantContext`

For endpoints that operate on a specific tenant (leads, config, etc).

Representative: `apps/portal/src/app/api/leads/route.ts`

```ts
export async function GET(request: NextRequest) {
  const rl = await rateLimitOr429(request);
  if (rl) return rl as Response;

  const resolved = await resolveTenantContext(request);
  if ("error" in resolved) return resolved.error;
  const { ctx } = resolved.ctx;

  const leads = getLeads(ctx.tenant.slug);
  return NextResponse.json(leads);
}
```

Flow: rate-limit → resolve context (auth + membership + status) → data layer with `ctx.tenant.slug`.

### With role restriction

For mutations, pass `requireRole`:

```ts
const resolved = await resolveTenantContext(request, {
  requireRole: ["admin", "owner"],
});
```

`viewers` get a 403.

### With audit

The context's `audit` closure writes to `audit_log`:

```ts
const { ctx, audit } = resolved.ctx;
await audit("lead.move", leadId, { from, to });
```

## Pattern B — Super-admin: `requireSuperAdminRequest`

For admin endpoints (`/api/admin/*`).

**File:** `apps/portal/src/lib/admin-guard.ts`

Returns `{ ok: true, userId, userEmail } | { ok: false, response }`.

Representative: `apps/portal/src/app/api/admin/tenants/route.ts`

```ts
export async function GET(request: NextRequest) {
  const rl = await rateLimitOr429(request);
  if (rl) return rl as Response;

  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;

  const tenants = await listTenants();
  return NextResponse.json({ tenants });
}
```

All `/api/admin/*` routes follow this pattern: rate-limit → super_admin check → action.

### Last super_admin guard

The `/api/admin/users` PATCH includes a check that **prevents demoting the last remaining super_admin**. Prevents lockout.

### Deprovision route

`/api/admin/tenants/[slug]/deprovision` requires:

- super_admin
- **Two-step confirm**: `confirm` in the body must match the slug.
- Rate-limited to 5/min.
- Writes the `tenant.deprovision` audit entry **before** deleting (because `audit_log` has no FK cascade).
- Returns the **archive password once** in the response body.

## Pattern C — Shared-secret (watchdog)

For endpoints that external watchdogs (Uptime Kuma, etc.) need to hit without being users.

Representative: `apps/portal/src/app/api/health/tenants/route.ts`

- **NOT** behind `requireSuperAdminRequest`.
- Reads the `WATCHDOG_TOKEN` env var. If missing or < 16 chars → `503 watchdog_token_not_configured` (fails closed).
- Compares the `X-Watchdog-Token` header with `timingSafeEqualString` (constant-time to prevent timing attacks).
- Returns aggregate status + per-tenant flags. HTTP 200 when OK, 503 when degraded.

> This route is under the public `/api/health` prefix that the middleware allowlists, so the cookie gate doesn't apply. Auth is **token-only**.

## Cross-cutting

### Rate limiting

**File:** `apps/portal/src/lib/rate-limit.ts`

- In-memory token bucket per process.
- Key: `u:<user_id>` if authenticated, otherwise `ip:<x-forwarded-for|x-real-ip>`.
- Default 60 req/60s. Mutable per route (e.g. tenant PATCH uses 10/60s).
- Returns 429 with `Retry-After`.

> **Limitation:** single-VPS. For HA you'd need Redis/Upstash as the backend.

### Input validation

**File:** `apps/portal/src/lib/schemas.ts` (zod)

Every mutation is parsed before touching the DB. Examples:

- `leadColumnSchema` — validates that the column is valid.
- `adminCreateTenantSchema` — slug must match `^[a-z0-9-]+$`.
- `adminPatchUserSchema` — role enum includes `super_admin`.

### Audit trail

**File:** `apps/portal/src/lib/audit.ts`

`recordAudit()` writes to `audit_log` in the shared DB. The `audit` closure from `resolveTenantContext` pre-binds actor/tenant/IP.

### Structured logging

**File:** `apps/portal/src/lib/logger.ts` (pino)

Structured logging on every error path.

## Route list

| Route | Pattern | Role |
|---|---|---|
| `GET /api/health` | Public (no auth) | Liveness |
| `GET /api/health/tenants` | Shared-secret | Multi-tenant watchdog |
| `GET /api/admin/health` | Super-admin | Detailed health |
| `* /api/auth/[...all]` | Better Auth | Auth handlers |
| `GET/PATCH /api/leads` | Tenant-scoped | Lists the tenant's leads |
| `GET/PATCH /api/leads/[id]` | Tenant-scoped (admin/owner for PATCH) | Detail + moves |
| `POST /api/leads/[id]/unlock` | Tenant-scoped (admin/owner) | Removes manual_override |
| `* /api/config/*` | Tenant-scoped | Settings, soul, knowledge, etc |
| `GET/POST /api/admin/tenants` | Super-admin | Lists + creates tenants |
| `GET/DELETE /api/admin/tenants/[slug]` | Super-admin | Detail + delete |
| `POST /api/admin/tenants/[slug]/deprovision` | Super-admin (two-step) | Archive + wipe |
| `GET/PATCH /api/admin/users` | Super-admin | Users + roles |
| `* /api/admin/playground/*` | Super-admin | Test chat |
