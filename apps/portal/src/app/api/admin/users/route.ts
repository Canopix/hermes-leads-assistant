import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminRequest } from "@/lib/admin-guard";
import { getDb } from "@/lib/tenants";
import { recordAudit } from "@/lib/audit";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { adminPatchUserSchema } from "@/lib/schemas";

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  created_at: string;
  member_of: number;
}

export async function GET(request: NextRequest) {
  const rl = await rateLimitOr429(request);
  if (rl) return rl as Response;
  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;

  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.createdAt AS created_at,
              (SELECT COUNT(*) FROM tenant_members m WHERE m.user_id = u.id) AS member_of
       FROM user u
       ORDER BY u.createdAt DESC
       LIMIT 500`
    )
    .all() as AdminUserRow[];
  return NextResponse.json({ users: rows });
}

export async function PATCH(request: NextRequest) {
  const rl = await rateLimitOr429(request, { max: 20, windowMs: 60_000 });
  if (rl) return rl as Response;
  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;

  const raw = await request.json().catch(() => null);
  const parsed = adminPatchUserSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "user_id/role inválido" },
      { status: 400 }
    );
  }
  const { user_id, role } = parsed.data;

  const db = await getDb();
  const target = db
    .prepare(`SELECT id, email, role FROM user WHERE id = ?`)
    .get(user_id) as { id: string; email: string; role: string } | undefined;
  if (!target) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  if (target.role === "super_admin" && role !== "super_admin") {
    const remaining = (
      db
        .prepare(`SELECT COUNT(*) as n FROM user WHERE role = 'super_admin'`)
        .get() as { n: number }
    ).n;
    if (remaining <= 1) {
      return NextResponse.json(
        { error: "cannot demote the last super admin" },
        { status: 400 }
      );
    }
  }

  db.prepare(`UPDATE user SET role = ? WHERE id = ?`).run(role, user_id);
  await recordAudit({
    actor_user_id: guard.userId,
    actor_email: guard.userEmail,
    tenant_id: null,
    action: "user.role.update",
    target: target.email,
    payload: { before: target.role, after: role },
  });
  return NextResponse.json({ ok: true });
}
