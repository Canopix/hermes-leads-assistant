import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { getAuth } from "./auth";

/**
 * Resolve the session for a server component / route handler by reading
 * the incoming request cookies via Next's headers() / request.
 *
 * Better Auth reads the signed session cookie from the request headers
 * and verifies it server-side. No client-controlled value is trusted.
 */
export async function getSessionFromRequest(request: NextRequest) {
  const auth = await getAuth();
  return auth.api.getSession({
    headers: request.headers,
  });
}

/** Server-component / page-level session lookup. */
export async function getSession() {
  const auth = await getAuth();
  const h = await headers();
  return auth.api.getSession({ headers: h });
}

/** Role-aware check; returns the user if it has the required role. */
export async function requireUser(roles?: Array<"viewer" | "admin" | "owner" | "super_admin">) {
  const session = await getSession();
  if (!session) return null;
  if (!roles || roles.length === 0) return session;
  const role = (session.user as { role?: string }).role ?? "viewer";
  if (!roles.includes(role as "viewer" | "admin" | "owner" | "super_admin")) {
    return null;
  }
  return session;
}

export async function requireSuperAdmin() {
  return requireUser(["super_admin"]);
}
