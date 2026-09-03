import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminRequest } from "@/lib/admin-guard";
import { getTenantBySlug, updateTenantStatus } from "@/lib/tenants";
import { recordAudit } from "@/lib/audit";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { deprovisionTenant } from "@/lib/provisioning";
import { logger } from "@/lib/logger";
import { z } from "zod";

const deprovisionSchema = z.object({
  // Two-step confirmation: the client must echo the slug back as `confirm`.
  // This makes accidental clicks ("I just clicked the red button") non-fatal.
  confirm: z.string().min(1).max(64),
  // Optional explicit password; if omitted the server generates one.
  password: z.string().min(8).max(200).optional(),
  // Dry-run: archive but don't wipe the profile dir.
  keepProfile: z.boolean().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const rl = await rateLimitOr429(request, { max: 5, windowMs: 60_000 });
  if (rl) return rl as Response;
  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;

  const tenant = await getTenantBySlug(params.slug);
  if (!tenant) {
    return NextResponse.json({ error: "tenant not found" }, { status: 404 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = deprovisionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "confirm inválido" },
      { status: 400 }
    );
  }
  if (parsed.data.confirm !== tenant.slug) {
    return NextResponse.json(
      {
        error:
          "confirmation failed: 'confirm' must match the tenant slug exactly",
      },
      { status: 400 }
    );
  }

  logger.warn(
    { actor: guard.userId, tenant: tenant.slug, action: "tenant.deprovision" },
    "deprovision_invoked"
  );

  let result;
  try {
    result = deprovisionTenant({
      slug: tenant.slug,
      hermesProfile: tenant.hermes_profile,
      password: parsed.data.password,
      keepProfile: parsed.data.keepProfile,
    });
  } catch (e) {
    logger.error(
      { err: e, tenant: tenant.slug, actor: guard.userId },
      "deprovision_failed"
    );
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "deprovision failed" },
      { status: 500 }
    );
  }

  // Mark the tenant row suspended. We do this AFTER the archive succeeds so a
  // crash mid-archive leaves the row "active" — the super-admin can retry.
  await updateTenantStatus(tenant.slug, "suspended");

  await recordAudit({
    actor_user_id: guard.userId,
    actor_email: guard.userEmail,
    tenant_id: tenant.id,
    action: "tenant.deprovision",
    target: tenant.slug,
    payload: {
      archive: result.archivePath,
      wiped: result.wipedProfile,
      keepProfile: !!parsed.data.keepProfile,
    },
  });

  /**
   * The archive password is returned in the body ONCE. The frontend displays
   * it with a copy button and a warning. It is NEVER retrievable later —
   * store it in the operator's password manager immediately.
   */
  return NextResponse.json({
    ok: true,
    slug: tenant.slug,
    archive_path: result.archivePath,
    archive_password: result.archivePassword,
    wiped_profile: result.wipedProfile,
    note:
      "Guardá esta contraseña ahora: el backup es inutilizable sin ella y no se puede recuperar.",
  });
}
