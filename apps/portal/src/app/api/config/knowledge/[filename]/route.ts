import { NextRequest, NextResponse } from "next/server";
import {
  getKnowledgeFile,
  updateKnowledgeFile,
  deleteKnowledgeFile,
} from "@/lib/config-service";
import { resolveTenantContext } from "@/lib/tenant-context";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { knowledgeContentSchema } from "@/lib/schemas";

export async function GET(
  request: NextRequest,
  { params }: { params: { filename: string } }
) {
  const rl = await rateLimitOr429(request);
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request);
  if ("error" in resolved) return resolved.error;
  const { ctx } = resolved.ctx;

  const content = getKnowledgeFile(ctx.tenant.slug, params.filename);
  if (content === null) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  return NextResponse.json({ content });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { filename: string } }
) {
  const rl = await rateLimitOr429(request, { max: 20, windowMs: 60_000 });
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request, {
    requireRole: ["admin", "owner"],
  });
  if ("error" in resolved) return resolved.error;
  const { ctx, audit } = resolved.ctx;

  const raw = await request.json().catch(() => null);
  const parsed = knowledgeContentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "content inválido" },
      { status: 400 }
    );
  }

  const ok = updateKnowledgeFile(
    ctx.tenant.slug,
    params.filename,
    parsed.data.content
  );
  if (!ok) {
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
  await audit("knowledge.update", params.filename, {
    bytes: parsed.data.content.length,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { filename: string } }
) {
  const rl = await rateLimitOr429(request, { max: 20, windowMs: 60_000 });
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request, {
    requireRole: ["admin", "owner"],
  });
  if ("error" in resolved) return resolved.error;
  const { ctx, audit } = resolved.ctx;

  const ok = deleteKnowledgeFile(ctx.tenant.slug, params.filename);
  if (!ok) {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
  await audit("knowledge.delete", params.filename, {});
  return NextResponse.json({ ok: true });
}
