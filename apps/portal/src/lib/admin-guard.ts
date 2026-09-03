import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionFromRequest } from "./session";

/**
 * Reject the request unless the session user is a super admin.
 * Returns the session user on success; a NextResponse on failure.
 */
export async function requireSuperAdminRequest(
  request: NextRequest
): Promise<
  | { ok: true; userId: string; userEmail: string }
  | { ok: false; response: NextResponse }
> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    };
  }
  const role = (session.user as { role?: string }).role;
  if (role !== "super_admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, userId: session.user.id, userEmail: session.user.email };
}
