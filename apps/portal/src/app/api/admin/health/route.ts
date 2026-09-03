import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminRequest } from "@/lib/admin-guard";
import { listProfiles } from "@/lib/profiles";
import { listTenants } from "@/lib/tenants";
import { isSentryActive } from "@/lib/sentry";
import { logger } from "@/lib/logger";
import { PROFILES_DIR, profileDir, readGatewayRuntime } from "@/lib/gateway-status";
import fs from "node:fs";
import path from "node:path";

interface ProfileHealth {
  slug: string;
  profile: string;
  name: string;
  status: string;
  channels: string[];
  lead_count: number;
  gateway_online: boolean;
  gateway_pid: number | null;
  gateway_state: string | null;
  gateway_source: "runtime_status" | "pid_file" | "none";
  has_kb: boolean;
  db_size_bytes: number | null;
  last_lead_at: string | null;
}

export async function GET(request: NextRequest) {
  const guard = await requireSuperAdminRequest(request);
  if (!guard.ok) return guard.response;

  const tenants = await listTenants();
  const profiles = listProfiles();
  const profilesBySlug = new Map(profiles.map((p) => [p.slug, p]));

  const rows: ProfileHealth[] = tenants.map((t) => {
    const dir = profileDir(t.hermes_profile);
    const fsProfile = profilesBySlug.get(t.slug);
    const runtime = readGatewayRuntime(t.hermes_profile);
    const dbPath = path.join(dir, ".lead-capture", "leads.db");
    let dbSizeBytes: number | null = null;
    const lastLeadAt: string | null = null;
    if (fs.existsSync(dbPath)) {
      try {
        dbSizeBytes = fs.statSync(dbPath).size;
      } catch {
        /* ignore */
      }
    }
    const kbDir = path.join(dir, "knowledge");
    return {
      slug: t.slug,
      profile: t.hermes_profile,
      name: t.name,
      status: t.status,
      channels: t.channels,
      lead_count: fsProfile?.lead_count ?? 0,
      gateway_online: runtime.online,
      gateway_pid: runtime.pid,
      gateway_state: runtime.gateway_state,
      gateway_source: runtime.source,
      has_kb: fs.existsSync(kbDir)
        ? fs.readdirSync(kbDir).filter((f) => f.endsWith(".md")).length > 0
        : false,
      db_size_bytes: dbSizeBytes,
      last_lead_at: lastLeadAt,
    };
  });

  // Roll up into a single system status: ok | degraded | down.
  //  - down:   ≥1 active tenant's gateway offline
  //  - degraded: any tenant is suspended OR any profile dir missing
  //  - ok:     everything green
  const activeGatewaysDown = rows.filter(
    (r) => r.status === "active" && !r.gateway_online
  ).length;
  const suspendedCount = rows.filter((r) => r.status === "suspended").length;

  const system_status: "ok" | "degraded" | "down" =
    activeGatewaysDown > 0 ? "down" : suspendedCount > 0 ? "degraded" : "ok";

  const summary = {
    system_status,
    total_tenants: rows.length,
    active_tenants: rows.filter((r) => r.status === "active").length,
    suspended_tenants: suspendedCount,
    gateways_online: rows.filter((r) => r.gateway_online).length,
    gateways_down: rows.filter((r) => !r.gateway_online).length,
    total_leads: rows.reduce((sum, r) => sum + r.lead_count, 0),
    sentry_active: isSentryActive(),
  };

  if (system_status !== "ok") {
    logger.warn(
      { ...summary, route: "GET /api/admin/health" },
      "health_check_non_ok"
    );
  }

  return NextResponse.json({
    summary,
    profiles: rows,
    profiles_dir: PROFILES_DIR,
    generated_at: new Date().toISOString(),
  });
}
