import type { NextRequest } from "next/server";
import { getSessionFromRequest } from "./session";

/**
 * Minimal in-memory rate limiter.
 *
 * Production-grade rate limiting should live in Redis or Upstash if you run
 * more than one portal instance; for a single-VPS deployment this is enough.
 * Buckets are keyed by user id when authenticated, by IP otherwise.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

interface RateLimitOptions {
  /** Request window in ms. Default 60s. */
  windowMs?: number;
  /** Max requests per window. Default 60. */
  max?: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

export async function rateLimit(
  request: NextRequest,
  opts: RateLimitOptions = {}
): Promise<RateLimitResult> {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 60;

  let key: string;
  const session = await getSessionFromRequest(request).catch(() => null);
  if (session) {
    key = `u:${session.user.id}`;
  } else {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "anon";
    key = `ip:${ip}`;
  }

  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: max - 1, resetAt };
  }
  if (existing.count >= max) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt };
  }
  existing.count += 1;
  return { ok: true, remaining: max - existing.count, resetAt: existing.resetAt };
}

/**
 * Convenience wrapper for route handlers: returns null on allow, a 429
 * NextResponse on block.
 */
export async function rateLimitOr429(
  request: NextRequest,
  opts?: RateLimitOptions
): Promise<null | Response> {
  const r = await rateLimit(request, opts);
  if (r.ok) return null;
  return new Response(
    JSON.stringify({ error: "too_many_requests", retry_after: Math.ceil((r.resetAt - Date.now()) / 1000) }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil((r.resetAt - Date.now()) / 1000)),
      },
    }
  );
}
