import { NextRequest, NextResponse } from "next/server";
import { resolveTenantContext } from "@/lib/tenant-context";
import { rateLimitOr429 } from "@/lib/rate-limit";
import { fetchAcaraBrands, getCatalog } from "@/lib/acara";

export async function GET(request: NextRequest) {
  const rl = await rateLimitOr429(request, { max: 60, windowMs: 60_000 });
  if (rl) return rl as Response;
  const resolved = await resolveTenantContext(request);
  if ("error" in resolved) return resolved.error;

  try {
    const { brands, source, synced_at } = await fetchAcaraBrands();
    const cat = getCatalog();
    return NextResponse.json({
      source,
      vehicle_type: "autos",
      synced_at: synced_at || null,
      counts: cat?.counts || null,
      brands,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ACARA unavailable";
    return NextResponse.json(
      { error: `No se pudo cargar marcas: ${msg}`, brands: [] },
      { status: 502 }
    );
  }
}
