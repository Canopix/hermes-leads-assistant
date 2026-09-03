/**
 * Cookie name for the user's last-selected tenant slug. Shared between:
 *  - the server action in app/(app)/actions.ts (sets it)
 *  - resolveTenantContext in lib/tenant-context.ts (reads it as fallback)
 *  - the middleware if it ever needs to read it
 *
 * Kept here (not in the "use server" file) because "use server" modules may
 * only export async functions.
 */
export const ACTIVE_TENANT_COOKIE = "active_tenant";

/** Matches the session lifetime configured in lib/auth.ts. */
export const ACTIVE_TENANT_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
