import { NextResponse } from "next/server";
import { resolveUserTenants } from "@/lib/tenant-context";

/**
 * Returns the tenants the current user is a member of.
 * Replaces the old public "list every profile" behavior — that was the
 * original multi-tenant isolation hole.
 */
export async function GET(request: Request) {
  const result = await resolveUserTenants(request as Parameters<typeof resolveUserTenants>[0]);
  if ("error" in result) return result.error;
  return NextResponse.json(result.tenants);
}
