import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminRequest } from "@/lib/admin-guard";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { deletePlaygroundSession } from "@/lib/playground";
import { recordAudit } from "@/lib/audit";

/**
 * Delete a playground session pointer. Only deletes the portal record —
 * the actual conversation history in the tenant's state.db is preserved
 * (Hermes can still resume that session by id from another tool).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const rl = await rateLimitOr429(request, { max: 30, windowMs: 60_000 });
  if (rl) return rl as Response;
  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;

  const deleted = await deletePlaygroundSession(params.id, guard.userId);
  if (!deleted) {
    return NextResponse.json(
      { error: "sesión no encontrada" },
      { status: 404 }
    );
  }
  await recordAudit({
    actor_user_id: guard.userId,
    actor_email: guard.userEmail,
    tenant_id: null,
    action: "playground.session.delete",
    target: params.id,
  });
  return NextResponse.json({ ok: true });
}
