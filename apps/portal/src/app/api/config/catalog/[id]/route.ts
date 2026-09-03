import { NextRequest, NextResponse } from "next/server";
import { resolveTenantContext } from "@/lib/tenant-context";
import { rateLimitOr429 } from "@/lib/rate-limit";
import {
  CatalogError,
  getCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  syncCatalogToRag,
} from "@/lib/catalog-service";
import { z } from "zod";

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  sku: z.string().max(80).optional().nullable(),
  status: z.enum(["available", "reserved", "sold", "draft"]).optional(),
  price_amount: z.number().int().optional().nullable(),
  price_currency: z.string().max(8).optional(),
  price_kind: z.enum(["fixed", "from", "on_request"]).optional(),
  summary: z.string().max(500).optional(),
  description: z.string().max(8000).optional(),
  attrs: z.record(z.unknown()).optional(),
});

type Ctx = { params: { id: string } };

export async function GET(request: NextRequest, context: Ctx) {
  const rl = await rateLimitOr429(request);
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request);
  if ("error" in resolved) return resolved.error;
  const { ctx } = resolved.ctx;
  const { id } = context.params;
  const item = getCatalogItem(ctx.tenant.slug, id);
  if (!item) {
    return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ item });
}

export async function PUT(request: NextRequest, context: Ctx) {
  const rl = await rateLimitOr429(request, { max: 30, windowMs: 60_000 });
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request, {
    requireRole: ["admin", "owner"],
  });
  if ("error" in resolved) return resolved.error;
  const { ctx, audit } = resolved.ctx;
  const { id } = context.params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "payload inválido" },
      { status: 400 }
    );
  }

  try {
    const item = updateCatalogItem(ctx.tenant.slug, id, parsed.data);
    const sync = syncCatalogToRag(ctx.tenant.slug);
    await audit("catalog.update", id, { title: item.title });
    return NextResponse.json({ ok: true, item, sync });
  } catch (e) {
    const msg = e instanceof CatalogError ? e.message : "error al actualizar";
    const status = msg.includes("no encontrado") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(request: NextRequest, context: Ctx) {
  const rl = await rateLimitOr429(request, { max: 20, windowMs: 60_000 });
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request, {
    requireRole: ["admin", "owner"],
  });
  if ("error" in resolved) return resolved.error;
  const { ctx, audit } = resolved.ctx;
  const { id } = context.params;

  const ok = deleteCatalogItem(ctx.tenant.slug, id);
  if (!ok) {
    return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  }
  const sync = syncCatalogToRag(ctx.tenant.slug);
  await audit("catalog.delete", id);
  return NextResponse.json({ ok: true, sync });
}
