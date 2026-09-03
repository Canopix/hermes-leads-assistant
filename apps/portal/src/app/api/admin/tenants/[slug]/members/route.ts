import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminRequest } from "@/lib/admin-guard";
import { getTenantBySlug, addMember, removeMember } from "@/lib/tenants";
import { recordAudit } from "@/lib/audit";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { adminAddMemberSchema } from "@/lib/schemas";

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const rl = await rateLimitOr429(request, { max: 20, windowMs: 60_000 });
  if (rl) return rl as Response;
  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;

  const raw = await request.json().catch(() => null);
  const parsed = adminAddMemberSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "user_id/role inválido" },
      { status: 400 }
    );
  }

  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) {
    return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  }

  const { getDb } = await import("@/lib/tenants");
  const db = await getDb();
  const user = db
    .prepare(`SELECT id, email FROM user WHERE id = ?`)
    .get(parsed.data.user_id) as { id: string; email: string } | undefined;
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  await addMember(parsed.data.user_id, tenant.id, parsed.data.role);
  await recordAudit({
    actor_user_id: guard.userId,
    actor_email: guard.userEmail,
    tenant_id: tenant.id,
    action: "tenant.member.add",
    target: user.email,
    payload: { role: parsed.data.role },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const rl = await rateLimitOr429(request, { max: 20, windowMs: 60_000 });
  if (rl) return rl as Response;
  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;

  const userId = request.nextUrl.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) {
    return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  }

  await removeMember(userId, tenant.id);
  await recordAudit({
    actor_user_id: guard.userId,
    actor_email: guard.userEmail,
    tenant_id: tenant.id,
    action: "tenant.member.remove",
    target: userId,
  });
  return NextResponse.json({ ok: true });
}
