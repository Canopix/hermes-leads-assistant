import { NextRequest, NextResponse } from "next/server";
import { resolveTenantContext } from "@/lib/tenant-context";
import { restartGateway, reindexRag } from "@/lib/config-service";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { opsSchema } from "@/lib/schemas";

/**
 * Explicit supervisor operations. The body must contain `{ op: "restart" | "reindex" }`.
 * Requires admin/owner role. This replaces the old implicit "save → auto-restart"
 * side effect from the knowledge and SOUL routes.
 */
export async function POST(request: NextRequest) {
  const rl = await rateLimitOr429(request, { max: 6, windowMs: 60_000 });
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request, {
    requireRole: ["admin", "owner"],
  });
  if ("error" in resolved) return resolved.error;
  const { ctx, audit } = resolved.ctx;

  const raw = await request.json().catch(() => null);
  const parsed = opsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "op inválido" },
      { status: 400 }
    );
  }

  const result =
    parsed.data.op === "restart"
      ? restartGateway(ctx.tenant.slug)
      : reindexRag(ctx.tenant.slug);

  await audit(`config.ops.${parsed.data.op}`, ctx.tenant.hermes_profile, {
    ok: result.ok,
  });
  return NextResponse.json({ op: parsed.data.op, ...result });
}
