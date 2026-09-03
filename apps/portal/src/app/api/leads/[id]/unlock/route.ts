import { NextRequest, NextResponse } from "next/server";
import { resolveTenantContext } from "@/lib/tenant-context";
import { clearLeadManualOverride } from "@/lib/db";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

/**
 * Clear the manual-override flag on a lead so the LLM extractor resumes
 * auto-categorizing it on the next inbound message.
 *
 * We do NOT trigger an immediate re-extraction from here because:
 *   1. There is no `hermes lead reextract <id>` CLI command today.
 *   2. Re-extracting without a fresh user message would just re-analyze the
 *      same conversation and produce noise. The classification is meant to
 *      react to the user's next turn.
 *
 * So this endpoint just unlocks the lead — the kanban_column stays where it is
 * until the next message arrives, at which point the extractor will update it.
 */
export async function POST(
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
    const cleared = clearLeadManualOverride(ctx.tenant.slug, params.id);
    if (!cleared) {
      return NextResponse.json({ error: "Lead no encontrado" }, { status: 404 });
    }
    await audit("lead.unlock_auto", params.id, {});
    return NextResponse.json({
      ok: true,
      note: "El LLM volverá a clasificar este lead en el próximo mensaje entrante.",
    });
  } catch (error) {
    logger.error(
      {
        err: error,
        tenant: ctx.tenant.slug,
        lead_id: params.id,
        route: "POST /api/leads/[id]/unlock",
      },
      "lead_unlock_failed"
    );
    return NextResponse.json(
      { error: "Error al desbloquear lead" },
      { status: 500 }
    );
  }
}
