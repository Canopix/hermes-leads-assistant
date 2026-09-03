import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminRequest } from "@/lib/admin-guard";
import { listTenants, createTenant, updateTenantStatus } from "@/lib/tenants";
import { recordAudit } from "@/lib/audit";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { adminCreateTenantSchema, adminPatchTenantSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  const rl = await rateLimitOr429(request);
  if (rl) return rl as Response;
  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;
  const tenants = await listTenants();
  return NextResponse.json({ tenants });
}

/**
 * NOTE: this POST only registers a tenant row in the portal DB. It does NOT
 * provision the Hermes profile (no .env, no config.yaml, no plugins, no
 * gateway). For real provisioning, use the CLI wizard from the server:
 *
 *   python cli/leadai.py tenants add --slug X --name Y
 *   bash packages/ops/provision-client.sh --slug X --name Y --telegram-token ...
 *
 * The web UI on /admin/tenants deliberately does NOT call this endpoint —
 * it shows CLI instructions instead. This endpoint is kept for two cases:
 *   1. A tenant was provisioned via CLI but never made it into the DB
 *      (legacy migration, manual recovery).
 *   2. Programmatic registration from scripts that already handle the
 *      Hermes side separately.
 */
export async function POST(request: NextRequest) {
  const rl = await rateLimitOr429(request, { max: 10, windowMs: 60_000 });
  if (rl) return rl as Response;
  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;

  const raw = await request.json().catch(() => null);
  const parsed = adminCreateTenantSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "slug/name inválido" },
      { status: 400 }
    );
  }

  try {
    const tenant = await createTenant({
      slug: parsed.data.slug,
      name: parsed.data.name,
      channels: parsed.data.channels,
    });
    await recordAudit({
      actor_user_id: guard.userId,
      actor_email: guard.userEmail,
      tenant_id: tenant.id,
      action: "tenant.register",
      target: tenant.slug,
      payload: {
        name: tenant.name,
        note: "DB-only registration; Hermes profile not provisioned by this call.",
      },
    });
    return NextResponse.json({
      tenant,
      warning:
        "Tenant registered in DB only. Hermes profile was NOT provisioned — run provision-client.sh from the server.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "create failed" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const rl = await rateLimitOr429(request, { max: 10, windowMs: 60_000 });
  if (rl) return rl as Response;
  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;

  const raw = await request.json().catch(() => null);
  const parsed = adminPatchTenantSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "slug/status inválido" },
      { status: 400 }
    );
  }

  const ok = await updateTenantStatus(parsed.data.slug, parsed.data.status);
  if (!ok) {
    return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  }
  await recordAudit({
    actor_user_id: guard.userId,
    actor_email: guard.userEmail,
    tenant_id: null,
    action: "tenant.status",
    target: parsed.data.slug,
    payload: { status: parsed.data.status },
  });
  return NextResponse.json({ ok: true });
}
