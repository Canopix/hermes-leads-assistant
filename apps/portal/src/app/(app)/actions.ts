"use server";

import { cookies, headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import {
  getTenantBySlug,
  listTenants,
  listTenantsForUser,
  type TenantRole,
} from "@/lib/tenants";
import {
  ACTIVE_TENANT_COOKIE,
  ACTIVE_TENANT_MAX_AGE,
} from "@/lib/active-tenant";

async function getCurrentSession() {
  const auth = await getAuth();
  const h = await headers();
  return auth.api.getSession({ headers: h });
}

export interface SwitchResult {
  ok: true;
  slug: string;
  name: string;
  role: TenantRole;
}

export interface SwitchError {
  ok: false;
  error: string;
}

/**
 * Persist the active tenant for the signed-in user as a signed-by-membership
 * cookie. Super admins may pick any tenant; everyone else must be a member.
 */
export async function setActiveTenant(slug: string): Promise<SwitchResult | SwitchError> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "unauthenticated" };

  const cleanSlug = slug.trim().toLowerCase();
  if (!cleanSlug) return { ok: false, error: "slug vacío" };

  const userRole = (session.user as { role?: string }).role ?? "viewer";
  const isSuperAdmin = userRole === "super_admin";

  const tenant = await getTenantBySlug(cleanSlug);
  if (!tenant) return { ok: false, error: "perfil inexistente" };
  if (tenant.status !== "active" && !isSuperAdmin) {
    return { ok: false, error: "perfil suspendido" };
  }

  let role: TenantRole;
  if (isSuperAdmin) {
    role = "owner";
  } else {
    const tenants = await listTenantsForUser(session.user.id);
    const match = tenants.find((t) => t.slug === cleanSlug);
    if (!match) return { ok: false, error: "no tenés acceso a este perfil" };
    role = match.role;
  }

  const store = await cookies();
  store.set(ACTIVE_TENANT_COOKIE, cleanSlug, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ACTIVE_TENANT_MAX_AGE,
  });

  return { ok: true, slug: cleanSlug, name: tenant.name, role };
}

/**
 * Clear the active-tenant cookie. Used on sign-out.
 */
export async function clearActiveTenant(): Promise<void> {
  const store = await cookies();
  store.delete(ACTIVE_TENANT_COOKIE);
}

/**
 * Resolve the sidebar state: the tenants the user can switch between, plus the
 * slug that should be marked active (cookie > first tenant > null).
 *
 * Safe to call from server components that already have a session.
 */
export async function getSidebarTenantState(): Promise<{
  tenants: Array<{ slug: string; name: string; hermesProfile: string; role: TenantRole }>;
  activeSlug: string | null;
  isSuperAdmin: boolean;
}> {
  const session = await getCurrentSession();
  const empty = {
    tenants: [],
    activeSlug: null,
    isSuperAdmin: false,
  };
  if (!session) return empty;

  const userRole = (session.user as { role?: string }).role ?? "viewer";
  const isSuperAdmin = userRole === "super_admin";

  let tenants: Array<{ slug: string; name: string; hermesProfile: string; role: TenantRole }>;
  if (isSuperAdmin) {
    const all = await listTenants();
    tenants = all.map((t) => ({
      slug: t.slug,
      name: t.name,
      hermesProfile: t.hermes_profile,
      role: "owner" as TenantRole,
    }));
  } else {
    const list = await listTenantsForUser(session.user.id);
    tenants = list.map((t) => ({
      slug: t.slug,
      name: t.name,
      hermesProfile: t.hermes_profile,
      role: t.role,
    }));
  }

  if (tenants.length === 0) {
    return { tenants: [], activeSlug: null, isSuperAdmin };
  }

  // This function is called from the layout (a Server Component), where
  // cookies are READ-ONLY. We only resolve the active slug here; the cookie
  // is written lazily by setActiveTenant the first time the user actually
  // picks a tenant (or kept in sync by it on every switch).
  const store = await cookies();
  const cookieSlug = store.get(ACTIVE_TENANT_COOKIE)?.value;
  const cookieValid = cookieSlug && tenants.some((t) => t.slug === cookieSlug);
  const activeSlug = cookieValid ? cookieSlug! : tenants[0].slug;

  return { tenants, activeSlug, isSuperAdmin };
}
