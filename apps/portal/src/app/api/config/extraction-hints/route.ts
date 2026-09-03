import { NextRequest, NextResponse } from "next/server";
import { getExtractionHints, updateExtractionHints } from "@/lib/config-service";
import { resolveTenantContext } from "@/lib/tenant-context";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { extractionHintsSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  const rl = await rateLimitOr429(request);
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request);
  if ("error" in resolved) return resolved.error;
  const { ctx } = resolved.ctx;

  const content = getExtractionHints(ctx.tenant.slug);
  if (content === null) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }
  return NextResponse.json({ content });
}

export async function PUT(request: NextRequest) {
  const rl = await rateLimitOr429(request, { max: 20, windowMs: 60_000 });
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request, {
    requireRole: ["admin", "owner"],
  });
  if ("error" in resolved) return resolved.error;
  const { ctx, audit } = resolved.ctx;

  const raw = await request.json().catch(() => null);
  const parsed = extractionHintsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "content inválido" },
      { status: 400 }
    );
  }

  const ok = updateExtractionHints(ctx.tenant.slug, parsed.data.content);
  if (!ok) {
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
  await audit("config.extraction_hints.update", "config.yaml", {
    bytes: parsed.data.content.length,
  });
  return NextResponse.json({ ok: true });
}
