import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminRequest } from "@/lib/admin-guard";
import { listPlaygroundSessions } from "@/lib/playground";

/**
 * List playground sessions for the current super admin. Optionally filter
 * by tenant via `?tenant_slug=...`.
 */
export async function GET(request: NextRequest) {
  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;

  const tenantSlug = request.nextUrl.searchParams.get("tenant_slug") || undefined;
  const sessions = await listPlaygroundSessions({
    userId: guard.userId,
    tenantSlug,
  });
  return NextResponse.json({ sessions });
}
