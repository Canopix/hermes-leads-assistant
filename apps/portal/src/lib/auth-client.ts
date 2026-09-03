import { createAuthClient } from "better-auth/client";

/**
 * Browser-side auth client. Used by client components and the /login page.
 * The base URL is optional — Better Auth's client defaults to relative URLs
 * which hit the same origin's /api/auth/* handlers.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
});

export type { Session } from "better-auth/client";
