import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminRequest } from "@/lib/admin-guard";
import { listAudit } from "@/lib/audit";

export async function GET(request: NextRequest) {
  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;

  const tenantId = request.nextUrl.searchParams.get("tenant_id") || undefined;
  const actorUserId = request.nextUrl.searchParams.get("actor_user_id") || undefined;
  const action = request.nextUrl.searchParams.get("action") || undefined;
  const limit = Number(request.nextUrl.searchParams.get("limit") || "100");

  const rows = await listAudit({ tenantId, actorUserId, action, limit });
  return NextResponse.json({ entries: rows });
}
