import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminRequest } from "@/lib/admin-guard";
import { getTenantBySlug, getMembership, deleteTenant } from "@/lib/tenants";
import { listAudit, recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;

  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) {
    return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  }

  // Get members (need a small query helper, reuse getDb)
  const { getDb } = await import("@/lib/tenants");
  const db = await getDb();
  const members = db
    .prepare(
      `SELECT m.user_id, m.role, m.created_at, u.email, u.name
       FROM tenant_members m
       INNER JOIN user u ON u.id = m.user_id
       WHERE m.tenant_id = ?
       ORDER BY m.created_at ASC`
    )
    .all(tenant.id) as Array<{
    user_id: string;
    role: string;
    created_at: string;
    email: string;
    name: string | null;
  }>;

  const recent = await listAudit({ tenantId: tenant.id, limit: 20 });

  return NextResponse.json({ tenant, members, recent_audit: recent });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;

  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) {
    return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  }

  // Record the deletion event BEFORE deleting the tenant row so the audit
  // entry carries the tenant_id. audit_log has no FK cascade by design; the
  // entry survives the delete and stays in history.
  await recordAudit({
    actor_user_id: guard.userId,
    actor_email: guard.userEmail,
    tenant_id: tenant.id,
    action: "tenant_deleted",
    target: tenant.slug,
    payload: { name: tenant.name, hermes_profile: tenant.hermes_profile },
    ip: request.headers.get("x-forwarded-for") ?? null,
  });

  const deleted = await deleteTenant(tenant.slug);
  if (!deleted) {
    return NextResponse.json(
      { error: "tenant vanished before delete" },
      { status: 409 }
    );
  }

  logger.info(
    { slug: tenant.slug, actor: guard.userEmail, route: "DELETE /api/admin/tenants/[slug]" },
    "tenant_deleted"
  );

  return NextResponse.json({ ok: true, slug: tenant.slug });
}
