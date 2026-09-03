import { pino } from "pino";

/**
 * Single logger for the portal. Emits structured JSON in production and
 * pretty-printed output in development. Per-request context (request id,
 * tenant id, user id) is added via `logger.child({...})` at the route layer
 * — we don't use AsyncLocalStorage to keep the surface area small.
 *
 * Level is configurable via `LOG_LEVEL` (default `info`; tests use `warn`).
 * In `NODE_ENV=production` logs are JSON to stdout, suitable for
 * `journalctl` / `docker logs` / any log shipper.
 */

const isProd = process.env.NODE_ENV === "production";
const level = process.env.LOG_LEVEL ?? (isProd ? "info" : "debug");

export const logger = pino({
  level,
  base: { service: "portal" },
  redact: {
    // Never log these keys even if they sneak into a meta object.
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-api-key']",
      "password",
      "token",
      "accessToken",
      "refreshToken",
      "*.password",
      "*.token",
      "*.bot_token",
      "*.api_key",
    ],
    censor: "[REDACTED]",
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l" },
        },
      }),
});

/**
 * Create a child logger with the standard request context fields. Use at
 * the top of an API route after resolving auth/tenant:
 *
 *   const log = reqLogger({ requestId, userId, tenantSlug });
 *   log.info("config.soul.update", { bytes: content.length });
 */
export function reqLogger(ctx: {
  requestId?: string;
  userId?: string;
  tenantSlug?: string;
  route?: string;
}) {
  return logger.child({
    request_id: ctx.requestId,
    user_id: ctx.userId,
    tenant: ctx.tenantSlug,
    route: ctx.route,
  });
}

/**
 * Generate a short request id if no `x-request-id` header is present.
 * Used to correlate logs across middleware, route, and downstream calls.
 */
export function requestIdFromRequest(headers: Headers): string {
  return (
    headers.get("x-request-id") ||
    headers.get("x-correlation-id") ||
    globalThis.crypto.randomUUID().slice(0, 8)
  );
}
