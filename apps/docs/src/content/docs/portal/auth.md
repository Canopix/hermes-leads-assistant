---
title: Auth and sessions
description: Better Auth config, roles, cookies, and HTTP handlers.
template: doc
---

# Auth and sessions

Auth via **Better Auth** on SQLite. A single instance per process, lazily memoized.

## Configuration

**File:** `apps/portal/src/lib/auth.ts`

### DB path

```ts
// Default: $HERMES_HOME/portal/auth.sqlite (i.e. ~/.hermes/portal/auth.sqlite)
// Override: PORTAL_AUTH_DB env var
```

better-sqlite3 with `journal_mode=WAL`, `foreign_keys=ON`. The handle is exposed via `getAuthDb()` so the portal tables live in the **same file** (consistent transactions with auth writes).

### Key config

| Setting | Value |
|---|---|
| `secret` | `BETTER_AUTH_SECRET` (fallback `NEXTAUTH_SECRET`; throws if missing) |
| `baseURL` | `BETTER_AUTH_URL` |
| `emailAndPassword` | enabled, min 8 / max 128 chars, no mandatory verification |
| `session.expiresIn` | 7 days |
| `session.updateAge` | 1 day |
| `session.cookieCache` | enabled, maxAge 5 min |
| `user.additionalFields.role` | default `"viewer"`, `input: false` (not settable at signup) |
| cookies | `httpOnly`, `sameSite=lax`, `secure` in prod |
| `rateLimit` | 20 req / 60s |

### Migrations

Auto-run on boot via `getMigrations()` from `better-auth/db/migration`. Idempotent — only applies the diff. Replaces the manual `npx auth migrate`.

## Tables

Better Auth creates and owns: **`user`, `session`, `account`, `verification`**.

The portal attaches to the same DB: **`tenants`, `tenant_members`, `audit_log`** (see [multi-tenancy](../multi-tenancy/)).

## Roles

There are **two role dimensions**:

### 1. Global user role

In the `user` table, `role` column:

| Value | Permissions |
|---|---|
| `viewer` | Default. Read-only over their tenants. |
| `admin` | Manage members of their tenants. |
| `owner` | Full control over their tenants. |
| `super_admin` | **Bypass membership**. Operates as synthetic owner on any tenant. Sees all tenants. Can access `/admin/*`. |

`super_admin` is a **global** flag, not per-tenant. Settable only via direct DB access or via `/admin/users` (with a "last super admin" guard).

### 2. Per-tenant role

In `tenant_members.role`:

| Value | Permissions in that tenant |
|---|---|
| `viewer` | View leads, conversations |
| `admin` | + edit config |
| `owner` | + everything |

A user can be `owner` of tenant A and `viewer` of tenant B.

## HTTP handlers

**Mount:** `apps/portal/src/app/api/auth/[...all]/route.ts`

Delegates GET/POST to `auth.handler(req)`. Serves sign-in, sign-up, sign-out, session, verification under `/api/auth/*`.

## Browser client

**File:** `apps/portal/src/lib/auth-client.ts`

```ts
createAuthClient({ baseURL: NEXT_PUBLIC_BETTER_AUTH_URL })
```

Relative URLs → same-origin `/api/auth/*`.

## Middleware (Edge)

**File:** `apps/portal/src/middleware.ts`

Early gate. Verifies the **signed cookie** via `getSessionCookie()` from `better-auth/cookies`:

- **It's a signature check, not an existence check.** Forged cookies don't pass.
- Public routes: `/login`, `/signup`, `/api/auth`, `/api/health`.
- No cookie → API routes get 401, pages redirect to `/login?redirect=...`.
- Bad cookie signature → same behavior.

> **Defense in depth:** the middleware only validates the signature. Real authorization (DB lookup, membership, roles) happens in the route handlers via `resolveTenantContext` or `requireSuperAdminRequest`.

## Helpers

| Function | File | Use |
|---|---|---|
| `getAuth()` | `lib/auth.ts` | Lazy singleton |
| `getAuthDb()` | `lib/auth.ts` | Shared SQLite handle |
| `getSessionFromRequest(req)` | `lib/session.ts` | `auth.api.getSession({headers})` |
| `createAuthClient()` | `lib/auth-client.ts` | Browser client |

## Creating a super_admin

Since `role` is not settable at signup (`input: false`), the first super_admin is created via a direct script:

```bash
# After deploying:
cd apps/portal && pnpm exec tsx scripts/create-super-admin.ts user@example.com
```

Or via direct SQL:

```sql
UPDATE user SET role = 'super_admin' WHERE email = 'user@example.com';
```

There's a guard in `/api/admin/users` that prevents demoting the **last remaining super_admin**.
