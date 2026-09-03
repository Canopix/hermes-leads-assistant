import { NextRequest, NextResponse } from "next/server";
import { getLeadWithConversation, updateLeadColumn } from "@/lib/db";
import { resolveTenantContext } from "@/lib/tenant-context";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { leadColumnSchema } from "@/lib/schemas";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const rl = await rateLimitOr429(request);
  if (rl) return rl;
  const resolved = await resolveTenantContext(request);
  if ("error" in resolved) return resolved.error;
  const { ctx } = resolved.ctx;

  try {
    const lead = getLeadWithConversation(ctx.tenant.slug, params.id);
    if (!lead) {
      return NextResponse.json({ error: "Lead no encontrado" }, { status: 404 });
    }
    return NextResponse.json(lead);
  } catch (error) {
    logger.error(
      { err: error, tenant: ctx.tenant.slug, lead_id: params.id, route: "GET /api/leads/[id]" },
      "lead_fetch_failed"
    );
    return NextResponse.json({ error: "Error al obtener lead" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const rl = await rateLimitOr429(request, { max: 30, windowMs: 60_000 });
  if (rl) return rl;
  const resolved = await resolveTenantContext(request, {
    requireRole: ["admin", "owner"],
  });
  if ("error" in resolved) return resolved.error;
  const { ctx, audit } = resolved.ctx;

  try {
    const raw = await request.json();
    const parsed = leadColumnSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Columna inválida. Valores permitidos: frio, tibio, caliente, descartado" },
        { status: 400 }
      );
    }
    const { column } = parsed.data;

    const result = updateLeadColumn(ctx.tenant.slug, params.id, column, {
      actorEmail: ctx.userEmail,
    });
    if (!result.updated) {
      return NextResponse.json({ error: "Lead no encontrado" }, { status: 404 });
    }
    await audit("lead.move", params.id, {
      column,
      previous_column: result.previousColumn ?? null,
      locked_manual: true,
    });
    return NextResponse.json({ ok: true, column, manual_override: true });
  } catch (error) {
    logger.error(
      { err: error, tenant: ctx.tenant.slug, lead_id: params.id, route: "PATCH /api/leads/[id]" },
      "lead_update_failed"
    );
    return NextResponse.json({ error: "Error al actualizar lead" }, { status: 500 });
  }
}
