import { NextRequest, NextResponse } from "next/server";
import { getLeads } from "@/lib/db";
import { resolveTenantContext } from "@/lib/tenant-context";
import { logger } from "@/lib/logger";
import { isGatewayOnline } from "@/lib/gateway-status";

export async function GET(request: NextRequest) {
  const resolved = await resolveTenantContext(request);
  if ("error" in resolved) return resolved.error;
  const { ctx } = resolved.ctx;

  try {
    const leads = getLeads(ctx.tenant.slug);

    const total = leads.length;
    const today = new Date().toISOString().split("T")[0];
    const todayCount = leads.filter((l) => l.created_at.startsWith(today)).length;
    const byColumn = { frio: 0, tibio: 0, caliente: 0, descartado: 0 };
    for (const lead of leads) {
      const col = lead.column as keyof typeof byColumn;
      if (col in byColumn) byColumn[col]++;
    }

    const activity: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const count = leads.filter((l) => l.created_at.startsWith(dateStr)).length;
      activity.push({ date: dateStr, count });
    }

    const hotLeads = leads.filter((l) => l.column === "caliente").slice(0, 5);

    return NextResponse.json({
      stats: {
        total,
        today: todayCount,
        byColumn,
        conversionRate: total > 0 ? Math.round((byColumn.caliente / total) * 100) : 0,
      },
      activity,
      hotLeads,
      botStatus: isGatewayOnline(ctx.tenant.hermes_profile)
        ? "online"
        : "offline",
    });
  } catch (error) {
    logger.error(
      { err: error, tenant: ctx.tenant.slug, route: "GET /api/dashboard" },
      "dashboard_fetch_failed"
    );
    return NextResponse.json({ error: "Error al obtener dashboard" }, { status: 500 });
  }
}
