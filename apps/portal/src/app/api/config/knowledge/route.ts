import { NextRequest, NextResponse } from "next/server";
import {
  listKnowledgeFiles,
  createKnowledgeFile,
} from "@/lib/config-service";
import { resolveTenantContext } from "@/lib/tenant-context";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { knowledgeFileSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  const rl = await rateLimitOr429(request);
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request);
  if ("error" in resolved) return resolved.error;
  const { ctx } = resolved.ctx;

  const files = listKnowledgeFiles(ctx.tenant.slug);
  return NextResponse.json({ files });
}

export async function POST(request: NextRequest) {
  const rl = await rateLimitOr429(request, { max: 20, windowMs: 60_000 });
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request, {
    requireRole: ["admin", "owner"],
  });
  if ("error" in resolved) return resolved.error;
  const { ctx, audit } = resolved.ctx;

  const raw = await request.json().catch(() => null);
  const parsed = knowledgeFileSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "filename/content inválido" },
      { status: 400 }
    );
  }

  const ok = createKnowledgeFile(
    ctx.tenant.slug,
    parsed.data.filename,
    parsed.data.content
  );
  if (!ok) {
    return NextResponse.json(
      { error: "Failed to create (invalid filename or file already exists)" },
      { status: 400 }
    );
  }
  await audit("knowledge.create", parsed.data.filename, {
    bytes: parsed.data.content.length,
  });
  // RAG reindex / gateway restart are now explicit via POST /api/config/ops.
  return NextResponse.json({ ok: true });
}
