import { NextRequest, NextResponse } from "next/server";
import { resolveTenantContext } from "@/lib/tenant-context";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { fetchAcaraModels } from "@/lib/acara";

export async function GET(request: NextRequest) {
  const rl = await rateLimitOr429(request, { max: 120, windowMs: 60_000 });
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request);
  if ("error" in resolved) return resolved.error;

  const brandId = Number(request.nextUrl.searchParams.get("brandId") || 0);
  if (!Number.isFinite(brandId) || brandId <= 0) {
    return NextResponse.json(
      { error: "brandId requerido", models: [] },
      { status: 400 }
    );
  }

  try {
    const { models, source } = await fetchAcaraModels(brandId);
    return NextResponse.json({
      source,
      brand_id: brandId,
      models,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ACARA unavailable";
    return NextResponse.json(
      { error: `No se pudo cargar modelos: ${msg}`, models: [] },
      { status: 502 }
    );
  }
}
