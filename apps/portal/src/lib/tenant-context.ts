import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionFromRequest } from "./session";
import {
  getMembership,
  getTenantBySlug,
  listTenantsForUser,
  type TenantWithContext,
  type TenantRole,
} from "./tenants";
import { recordAudit } from "./audit";
import { ACTIVE_TENANT_COOKIE } from "./active-tenant";

/**
 * Per-request tenant context. `activeTenantSlug` is read from the request
 * body/query for client flexibility, but it must be a tenant the user is
 * a member of — otherwise we return 403. Anonymous users never reach this
 * (middleware catches them) but we double-check here for defense in depth.
 */
export interface TenantContext {
  userId: string;
  userEmail: string;
  userRole: "viewer" | "admin" | "owner" | "super_admin";
  tenant: TenantWithContext;
  tenantRole: TenantRole;
  isSuperAdmin: boolean;
}

export interface ResolvedContext {
  ctx: TenantContext;
  /** Helper to record an audit entry scoped to this request. */
  audit: (action: string, target?: string, payload?: unknown) => Promise<void>;
}

function unauthorized() {
  return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
}

function forbidden(message = "forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Resolves a tenant context for a request that targets a single tenant.
 *
 * Slug resolution order:
 *   1. Explicit `?slug=` (query) or `{ slug }` (JSON body) — kept for deep links.
 *   2. `active_tenant` cookie (set by the sidebar ProfileSwitcher).
 *   3. The user's first tenant (convenience for single-tenant users).
 *
 * Pass `allowFallback: false` to require an explicit slug (legacy behavior,
 * e.g. endpoints that must not silently infer the tenant from a cookie).
 *
 * The URL/cookie value is only used to *select* the active tenant — it is
 * never authoritative on its own; the user MUST be a member (or super admin).
 */
export async function resolveTenantContext(
  request: NextRequest,
  opts: { requireRole?: TenantRole[]; allowFallback?: boolean } = {}
): Promise<{ ctx: ResolvedContext } | { error: NextResponse }> {
  const session = await getSessionFromRequest(request);
  if (!session) return { error: unauthorized() };

  const userId = session.user.id;
  const userEmail = session.user.email;
  const userRole = (session.user as { role?: string }).role as
    | TenantRole
    | "super_admin"
    | undefined;
  const isSuperAdmin = userRole === "super_admin";

  // 1. Slug may come from query or JSON body. Try query first (cheap).
  let slug = request.nextUrl.searchParams.get("slug");
  if (!slug && request.method !== "GET" && request.method !== "HEAD") {
    try {
      const cloned = request.clone();
      const body = (await cloned.json().catch(() => null)) as
        | { slug?: string }
        | null;
      if (body && typeof body.slug === "string") slug = body.slug;
    } catch {
      /* ignore body parse errors */
    }
  }

  const allowFallback = opts.allowFallback !== false;

  // 2. Fall back to the active_tenant cookie.
  if (!slug && allowFallback) {
    slug = request.cookies.get(ACTIVE_TENANT_COOKIE)?.value || null;
  }

  // 3. Fall back to the user's first tenant.
  if (!slug && allowFallback) {
    if (isSuperAdmin) {
      const { listTenants } = await import("./tenants");
      const all = await listTenants();
      slug = all[0]?.slug ?? null;
    } else {
      const tenants = await listTenantsForUser(userId);
      slug = tenants[0]?.slug ?? null;
    }
  }

  if (!slug) return { error: badRequest("slug required") };

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { error: badRequest("unknown tenant") };
  if (tenant.status !== "active" && !isSuperAdmin) {
    return { error: forbidden("tenant suspended") };
  }

  // Super admins skip membership but still operate on the chosen tenant.
  let tenantRole: TenantRole;
  if (isSuperAdmin) {
    tenantRole = "owner";
  } else {
    const membership = await getMembership(userId, tenant.id);
    if (!membership) return { error: forbidden("not a member of this tenant") };
    tenantRole = membership.role;
  }

  if (opts.requireRole && !opts.requireRole.includes(tenantRole)) {
    return { error: forbidden("insufficient role") };
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;

  const ctx: TenantContext = {
    userId,
    userEmail,
    userRole: (userRole as TenantContext["userRole"]) ?? "viewer",
    tenant,
    tenantRole,
    isSuperAdmin,
  };

  return {
    ctx: {
      ctx,
      audit: (action, target, payload) =>
        recordAudit({
          actor_user_id: userId,
          actor_email: userEmail,
          tenant_id: tenant.id,
          action,
          target,
          payload,
          ip,
        }),
    },
  };
}

/**
 * For endpoints that list the user's tenants (no specific slug required).
 * Super admins see all tenants.
 */
export async function resolveUserTenants(
  request: NextRequest
): Promise<
  | { tenants: Array<TenantWithContext & { role: TenantRole }>; userId: string; isSuperAdmin: boolean }
  | { error: NextResponse }
> {
  const session = await getSessionFromRequest(request);
  if (!session) return { error: unauthorized() };

  const isSuperAdmin =
    (session.user as { role?: string }).role === "super_admin";

  if (isSuperAdmin) {
    const { listTenants } = await import("./tenants");
    const all = await listTenants();
    return {
      tenants: all.map((t) => ({ ...t, role: "owner" as TenantRole })),
      userId: session.user.id,
      isSuperAdmin,
    };
  }

  const tenants = await listTenantsForUser(session.user.id);
  return { tenants, userId: session.user.id, isSuperAdmin };
}
