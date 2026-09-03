import { NextRequest, NextResponse } from "next/server";
import { getLeadStats } from "@/lib/db";
import { resolveTenantContext } from "@/lib/tenant-context";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const resolved = await resolveTenantContext(request);
  if ("error" in resolved) return resolved.error;
  const { ctx } = resolved.ctx;

  try {
    const stats = getLeadStats(ctx.tenant.slug);
    if (!stats) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 404 });
    }
    return NextResponse.json(stats);
  } catch (error) {
    logger.error(
      { err: error, tenant: ctx.tenant.slug, route: "GET /api/stats" },
      "stats_fetch_failed"
    );
    return NextResponse.json({ error: "Error al obtener estadísticas" }, { status: 500 });
  }
}
