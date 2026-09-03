import { NextRequest, NextResponse } from "next/server";
import { resolveTenantContext } from "@/lib/tenant-context";
import { rateLimitOr429 } from "@/lib/rate-limit";
import {
  CatalogError,
  listCatalogItems,
  createCatalogItem,
  getCatalogVertical,
  initCatalog,
  syncCatalogToRag,
  type Vertical,
} from "@/lib/catalog-service";
import { z } from "zod";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  sku: z.string().max(80).optional().nullable(),
  status: z.enum(["available", "reserved", "sold", "draft"]).optional(),
  price_amount: z.number().int().optional().nullable(),
  price_currency: z.string().max(8).optional(),
  price_kind: z.enum(["fixed", "from", "on_request"]).optional(),
  summary: z.string().max(500).optional(),
  description: z.string().max(8000).optional(),
  attrs: z.record(z.unknown()).optional(),
});

export async function GET(request: NextRequest) {
  const rl = await rateLimitOr429(request);
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request);
  if ("error" in resolved) return resolved.error;
  const { ctx } = resolved.ctx;

  const slug = ctx.tenant.slug;
  // Ensure DB exists for older profiles
  if (getCatalogVertical(slug) === null) {
    initCatalog(slug, "autos");
  }

  const sp = request.nextUrl.searchParams;
  const status = sp.get("status") || undefined;
  const q = sp.get("q") || undefined;
  const limit = Number(sp.get("limit") || 25);
  const offset = Number(sp.get("offset") || 0);
  const price_min = sp.get("price_min") ? Number(sp.get("price_min")) : undefined;
  const price_max = sp.get("price_max") ? Number(sp.get("price_max")) : undefined;
  const sort = (sp.get("sort") || "updated_at") as
    | "updated_at"
    | "title"
    | "price_amount"
    | "status";
  const order = (sp.get("order") || "desc") as "asc" | "desc";

  const attrs: Record<string, string | number> = {};
  for (const key of [
    "marca",
    "modelo",
    "condicion",
    "barrio",
    "ciudad",
    "tipo",
    "operacion",
  ]) {
    const val = sp.get(key);
    if (val) attrs[key] = key === "ambientes" ? Number(val) : val;
  }
  const ambientes = sp.get("ambientes");
  if (ambientes) attrs.ambientes = Number(ambientes);

  const data = listCatalogItems(slug, {
    status,
    q,
    limit,
    offset,
    price_min: Number.isFinite(price_min) ? price_min : undefined,
    price_max: Number.isFinite(price_max) ? price_max : undefined,
    attrs: Object.keys(attrs).length ? attrs : undefined,
    sort,
    order,
  });
  if (!data) {
    return NextResponse.json({ error: "perfil no encontrado" }, { status: 404 });
  }
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const rl = await rateLimitOr429(request, { max: 30, windowMs: 60_000 });
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request, {
    requireRole: ["admin", "owner"],
  });
  if ("error" in resolved) return resolved.error;
  const { ctx, audit } = resolved.ctx;
  const slug = ctx.tenant.slug;

  if (getCatalogVertical(slug) === null) {
    initCatalog(slug, "autos");
  }

  const raw = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "payload inválido" },
      { status: 400 }
    );
  }

  try {
    const item = createCatalogItem(slug, parsed.data);
    const sync = syncCatalogToRag(slug);
    await audit("catalog.create", item.id, { title: item.title });
    return NextResponse.json({ ok: true, item, sync });
  } catch (e) {
    const msg = e instanceof CatalogError ? e.message : "error al crear";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/** Optional: set vertical (ops). Body: { vertical: "autos" | "inmobiliaria" } */
export async function PUT(request: NextRequest) {
  const rl = await rateLimitOr429(request, { max: 10, windowMs: 60_000 });
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request, {
    requireRole: ["admin", "owner"],
  });
  if ("error" in resolved) return resolved.error;
  const { ctx, audit } = resolved.ctx;

  const body = z
    .object({ vertical: z.enum(["autos", "inmobiliaria"]) })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "vertical inválido" }, { status: 400 });
  }
  const vertical = body.data.vertical as Vertical;
  initCatalog(ctx.tenant.slug, vertical);
  await audit("catalog.set_vertical", vertical);
  return NextResponse.json({ ok: true, vertical });
}
