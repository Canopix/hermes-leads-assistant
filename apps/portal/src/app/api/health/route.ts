import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Public health probe — middleware allowlists this path. It must NOT
 * touch the filesystem or auth DB to remain cheap and leak-free.
 */
export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "portal",
    time: new Date().toISOString(),
  });
}
