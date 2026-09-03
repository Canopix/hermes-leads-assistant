import { NextRequest, NextResponse } from "next/server";
import { getLeads } from "@/lib/db";
import { resolveTenantContext } from "@/lib/tenant-context";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const resolved = await resolveTenantContext(request);
  if ("error" in resolved) return resolved.error;
  const { ctx } = resolved.ctx;

  const period = request.nextUrl.searchParams.get("period") || "7d";

  try {
    const leads = getLeads(ctx.tenant.slug);

    const days = period === "30d" ? 30 : period === "90d" ? 90 : 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startStr = startDate.toISOString().split("T")[0];

    const periodLeads = leads.filter((l) => l.created_at >= startStr);

    const prevStart = new Date(startDate);
    prevStart.setDate(prevStart.getDate() - days);
    const prevStartStr = prevStart.toISOString().split("T")[0];
    const prevLeads = leads.filter(
      (l) => l.created_at >= prevStartStr && l.created_at < startStr
    );

    const byDay: {
      date: string;
      frio: number;
      tibio: number;
      caliente: number;
      descartado: number;
      total: number;
    }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const dayLeads = periodLeads.filter((l) => l.created_at.startsWith(dateStr));
      byDay.push({
        date: dateStr,
        frio: dayLeads.filter((l) => l.column === "frio").length,
        tibio: dayLeads.filter((l) => l.column === "tibio").length,
        caliente: dayLeads.filter((l) => l.column === "caliente").length,
        descartado: dayLeads.filter((l) => l.column === "descartado").length,
        total: dayLeads.length,
      });
    }

    const byPlatform: Record<string, number> = {};
    for (const lead of periodLeads) {
      const p = lead.platform || "unknown";
      byPlatform[p] = (byPlatform[p] || 0) + 1;
    }

    const fieldCounts: Record<string, number> = {};
    for (const lead of periodLeads) {
      if (lead.raw_fields) {
        for (const key of Object.keys(lead.raw_fields)) {
          fieldCounts[key] = (fieldCounts[key] || 0) + 1;
        }
      }
    }
    const topFields = Object.entries(fieldCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([field, count]) => ({ field, count }));

    const current = periodLeads.length;
    const previous = prevLeads.length;
    const change =
      previous > 0
        ? Math.round(((current - previous) / previous) * 100)
        : current > 0
        ? 100
        : 0;

    const urgencyCounts = { low: 0, medium: 0, high: 0 };
    for (const lead of periodLeads) {
      const u = lead.urgency as keyof typeof urgencyCounts;
      if (u in urgencyCounts) urgencyCounts[u]++;
    }

    return NextResponse.json({
      byDay,
      byPlatform,
      topFields,
      trend: { current, previous, change },
      urgencyCounts,
      totalInPeriod: current,
    });
  } catch (error) {
    logger.error(
      { err: error, tenant: ctx.tenant.slug, route: "GET /api/analytics" },
      "analytics_fetch_failed"
    );
    return NextResponse.json({ error: "Error al obtener analytics" }, { status: 500 });
  }
}
