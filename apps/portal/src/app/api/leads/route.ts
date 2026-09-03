import { NextRequest, NextResponse } from "next/server";
import { getLeads } from "@/lib/db";
import { resolveTenantContext } from "@/lib/tenant-context";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const rl = await rateLimitOr429(request);
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request);
  if ("error" in resolved) return resolved.error;
  const { ctx } = resolved.ctx;

  try {
    const leads = getLeads(ctx.tenant.slug);
    return NextResponse.json(leads);
  } catch (error) {
    logger.error(
      { err: error, tenant: ctx.tenant.slug, route: "GET /api/leads" },
      "leads_fetch_failed"
    );
    return NextResponse.json({ error: "Error al obtener leads" }, { status: 500 });
  }
}
