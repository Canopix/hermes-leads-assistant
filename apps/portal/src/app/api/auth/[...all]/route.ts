import { getAuth } from "@/lib/auth";

/**
 * Better Auth catch-all handler.
 * Mounts every auth endpoint under /api/auth/* (sign-in, sign-up, session,
 * sign-out, verification, etc.) — see https://www.better-auth.com/docs
 */
async function handler(req: Request) {
  const auth = await getAuth();
  return auth.handler(req);
}

export {
  handler as GET,
  handler as POST,
};
