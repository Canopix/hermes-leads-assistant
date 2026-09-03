import { NextResponse, type NextRequest } from "next/server";
import { listTenants } from "@/lib/tenants";
import { readGatewayRuntime } from "@/lib/gateway-status";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Public, token-gated multi-tenant health probe for external watchdogs
 * (Uptime Kuma, Healthchecks.io, etc.).
 *
 * Unlike /api/admin/health (which needs a super-admin session cookie and
 * returns full tenant detail), this endpoint exposes only what a watchdog
 * needs: an aggregate status and a per-tenant online flag keyed by slug.
 *
 * Auth is a shared secret sent in the `X-Watchdog-Token` header. The
 * expected value is configured via the `WATCHDOG_TOKEN` env var. If that
 * env var is unset the endpoint refuses to serve anything — silently
 * enabling an unauthenticated health endpoint would be a regression.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function GET(request: NextRequest) {
  const expected = process.env.WATCHDOG_TOKEN;
  if (!expected || expected.length < 16) {
    return NextResponse.json(
      { error: "watchdog_token_not_configured" },
      { status: 503 }
    );
  }
  const provided = request.headers.get("x-watchdog-token");
  if (!provided || !timingSafeEqualString(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const tenants = await listTenants();
    const perTenant = tenants.map((t) => {
      const runtime = readGatewayRuntime(t.hermes_profile);
      return {
        slug: t.slug,
        status: t.status,
        gateway_online: runtime.online,
      };
    });

    const activeDown = perTenant.filter(
      (t) => t.status === "active" && !t.gateway_online
    ).length;
    const suspended = perTenant.filter(
      (t) => t.status === "suspended"
    ).length;

    const system_status: "ok" | "degraded" | "down" =
      activeDown > 0 ? "down" : suspended > 0 ? "degraded" : "ok";

    const httpStatus = system_status === "ok" ? 200 : 503;

    if (system_status !== "ok") {
      logger.warn(
        { system_status, activeDown, suspended, route: "GET /api/health/tenants" },
        "watchdog_health_non_ok"
      );
    }

    return NextResponse.json(
      {
        system_status,
        total_tenants: perTenant.length,
        gateways_online: perTenant.filter((t) => t.gateway_online).length,
        gateways_down: perTenant.filter((t) => !t.gateway_online).length,
        tenants: perTenant,
        generated_at: new Date().toISOString(),
      },
      { status: httpStatus }
    );
  } catch (err) {
    logger.error(
      { err, route: "GET /api/health/tenants" },
      "watchdog_health_error"
    );
    return NextResponse.json(
      { system_status: "down", error: "internal_error" },
      { status: 503 }
    );
  }
}
